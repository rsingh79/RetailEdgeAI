/**
 * Sales Analysis Service
 *
 * Queries canonical SalesTransaction/SalesLineItem tables for revenue,
 * margin, and product performance analysis. Used by the analytics API
 * endpoints and the Business Advisor agent tools.
 *
 * All functions accept a Prisma client (tenant-scoped) and return
 * structured data with a dataQuality object where applicable.
 *
 * ANALYSIS WINDOW: Every query is clamped to the tenant's tier-based
 * analysis window (e.g. 12 months for Starter). Data outside the window
 * is retained but excluded from analysis until the tenant upgrades.
 */

import { getCurrentUsage } from '../usageTracker.js';
import { isUnlimited } from '../../config/tierLimits.js';

// ── Helpers ──

function defaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { startDate: start, endDate: end };
}

function monthsBetween(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  return Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44));
}

// ── Analysis Window ──

/**
 * Get the earliest date allowed for analysis based on the tenant's tier.
 * Returns null for unlimited tiers (no restriction).
 */
export async function getAnalysisWindowStart(prisma, tenantId) {
  try {
    const usage = await getCurrentUsage(prisma, tenantId);
    const windowMonths = usage.historicalSyncMonths; // analysis_window_months stored here at creation

    if (isUnlimited(windowMonths)) return null;

    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - windowMonths);
    return windowStart;
  } catch {
    return null; // degrade gracefully — don't block analysis
  }
}

/**
 * Clamp a start date to the analysis window. If the requested start is
 * before the window boundary, returns the window boundary instead.
 */
async function clampToWindow(prisma, tenantId, startDate) {
  const windowStart = await getAnalysisWindowStart(prisma, tenantId);
  if (!windowStart) return startDate; // unlimited
  if (!startDate || startDate < windowStart) return windowStart;
  return startDate;
}

/**
 * Check if the tenant has data beyond their analysis window.
 * Returns info for upgrade prompts, or null for unlimited tiers.
 */
export async function getDataBeyondWindow(prisma, tenantId) {
  const windowStart = await getAnalysisWindowStart(prisma, tenantId);
  if (!windowStart) return null; // unlimited tier

  const [oldest, newest, countOutside, totalCount] = await Promise.all([
    prisma.salesTransaction.findFirst({
      orderBy: { transactionDate: 'asc' },
      select: { transactionDate: true },
    }),
    prisma.salesTransaction.findFirst({
      orderBy: { transactionDate: 'desc' },
      select: { transactionDate: true },
    }),
    prisma.salesTransaction.count({
      where: { transactionDate: { lt: windowStart } },
    }),
    prisma.salesTransaction.count(),
  ]);

  if (!oldest || totalCount === 0) return { hasDataBeyondWindow: false };

  if (oldest.transactionDate < windowStart) {
    let usage;
    try { usage = await getCurrentUsage(prisma, tenantId); } catch { usage = {}; }
    const totalDataMonths = monthsBetween(oldest.transactionDate, newest.transactionDate);

    return {
      hasDataBeyondWindow: true,
      totalDataMonths,
      analysisWindowMonths: usage.historicalSyncMonths || null,
      oldestDataDate: oldest.transactionDate,
      transactionsOutsideWindow: countOutside,
      totalTransactions: totalCount,
      percentOutsideWindow: Math.round((countOutside / totalCount) * 100),
    };
  }

  return { hasDataBeyondWindow: false };
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function buildDateFilter(startDate, endDate) {
  const s = parseDate(startDate);
  const e = parseDate(endDate);
  if (!s && !e) return {};
  const filter = {};
  if (s) filter.gte = s;
  if (e) filter.lte = e;
  return { transactionDate: filter };
}

// ── Data Quality ──

/**
 * Get cost data coverage metrics for a tenant.
 */
export async function getDataQuality(prisma, { startDate, endDate, tenantId } = {}) {
  const defaults = defaultDateRange();
  const rawStart = parseDate(startDate) || defaults.startDate;
  const s = tenantId ? await clampToWindow(prisma, tenantId, rawStart) : rawStart;
  const e = parseDate(endDate) || defaults.endDate;

  const dateFilter = buildDateFilter(s, e);

  // Count line items with and without cost data in the date range
  const [withCost, withoutCost, earliestCost] = await Promise.all([
    prisma.salesLineItem.count({
      where: {
        costDataAvailable: true,
        transaction: dateFilter,
      },
    }),
    prisma.salesLineItem.count({
      where: {
        costDataAvailable: false,
        transaction: dateFilter,
      },
    }),
    prisma.priceChangeLog.findFirst({
      where: { priceType: 'cost_price' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const totalProducts = withCost + withoutCost;
  const costDataCoverage = totalProducts > 0
    ? Math.round((withCost / totalProducts) * 1000) / 10
    : 0;

  return {
    totalLineItems: totalProducts,
    lineItemsWithCostData: withCost,
    lineItemsWithoutCostData: withoutCost,
    costDataCoverage,
    costDataAvailableFrom: earliestCost?.createdAt || null,
    note: costDataCoverage < 50 && totalProducts > 0
      ? 'Cost data is available for less than half your products. Process supplier invoices to improve margin accuracy.'
      : null,
  };
}

// ── Revenue Analysis ──

/**
 * Get revenue aggregated by period.
 * @param {string} period - 'daily' | 'weekly' | 'monthly'
 */
export async function getRevenueByPeriod(prisma, { period = 'monthly', startDate, endDate, tenantId } = {}) {
  const defaults = defaultDateRange();
  const rawStart = parseDate(startDate) || defaults.startDate;
  const s = tenantId ? await clampToWindow(prisma, tenantId, rawStart) : rawStart;
  const e = parseDate(endDate) || defaults.endDate;

  const transactions = await prisma.salesTransaction.findMany({
    where: {
      status: { not: 'cancelled' },
      ...buildDateFilter(s, e),
    },
    select: {
      transactionDate: true,
      totalAmount: true,
    },
    orderBy: { transactionDate: 'asc' },
  });

  // Group by period
  const buckets = new Map();
  for (const tx of transactions) {
    const key = periodKey(tx.transactionDate, period);
    const existing = buckets.get(key) || { period: key, revenue: 0, orderCount: 0 };
    existing.revenue += tx.totalAmount;
    existing.orderCount += 1;
    buckets.set(key, existing);
  }

  const results = Array.from(buckets.values());
  // Round revenue
  for (const r of results) {
    r.revenue = Math.round(r.revenue * 100) / 100;
  }

  return { periods: results, totalRevenue: Math.round(results.reduce((s, r) => s + r.revenue, 0) * 100) / 100 };
}

function periodKey(date, period) {
  const d = new Date(date);
  switch (period) {
    case 'daily':
      return d.toISOString().slice(0, 10);
    case 'weekly': {
      // ISO week: Monday-based
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return d.toISOString().slice(0, 10);
    }
    case 'monthly':
    default:
      return d.toISOString().slice(0, 7);
  }
}

/**
 * Compare revenue between two periods.
 */
export async function getRevenueComparison(prisma, { currentStart, currentEnd, previousStart, previousEnd }) {
  const [current, previous] = await Promise.all([
    sumRevenue(prisma, currentStart, currentEnd),
    sumRevenue(prisma, previousStart, previousEnd),
  ]);

  const change = current.revenue - previous.revenue;
  const changePercent = previous.revenue > 0
    ? Math.round((change / previous.revenue) * 1000) / 10
    : null;

  return {
    current: current.revenue,
    currentOrders: current.orderCount,
    previous: previous.revenue,
    previousOrders: previous.orderCount,
    change: Math.round(change * 100) / 100,
    changePercent,
  };
}

async function sumRevenue(prisma, startDate, endDate) {
  const transactions = await prisma.salesTransaction.findMany({
    where: {
      status: { not: 'cancelled' },
      ...buildDateFilter(startDate, endDate),
    },
    select: { totalAmount: true },
  });
  return {
    revenue: Math.round(transactions.reduce((s, t) => s + t.totalAmount, 0) * 100) / 100,
    orderCount: transactions.length,
  };
}

/**
 * Revenue split by channel.
 */
export async function getRevenueByChannel(prisma, { startDate, endDate, tenantId } = {}) {
  const defaults = defaultDateRange();
  const rawStart = parseDate(startDate) || defaults.startDate;
  const s = tenantId ? await clampToWindow(prisma, tenantId, rawStart) : rawStart;
  const e = parseDate(endDate) || defaults.endDate;

  const transactions = await prisma.salesTransaction.findMany({
    where: {
      status: { not: 'cancelled' },
      ...buildDateFilter(s, e),
    },
    select: { channel: true, totalAmount: true },
  });

  const channels = new Map();
  let total = 0;
  for (const tx of transactions) {
    const ch = tx.channel || 'unknown';
    const existing = channels.get(ch) || { channel: ch, revenue: 0, orderCount: 0 };
    existing.revenue += tx.totalAmount;
    existing.orderCount += 1;
    total += tx.totalAmount;
    channels.set(ch, existing);
  }

  const results = Array.from(channels.values())
    .map((c) => ({ ...c, revenue: Math.round(c.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue);

  return { channels: results, total: Math.round(total * 100) / 100 };
}

// ── Margin Analysis ──

/**
 * Margins by product (only where cost data available).
 */
export async function getMarginByProduct(prisma, { startDate, endDate, limit = 20, sortBy = 'revenue', tenantId } = {}) {
  const defaults = defaultDateRange();
  const rawStart = parseDate(startDate) || defaults.startDate;
  const s = tenantId ? await clampToWindow(prisma, tenantId, rawStart) : rawStart;
  const e = parseDate(endDate) || defaults.endDate;

  const lines = await prisma.salesLineItem.findMany({
    where: {
      costDataAvailable: true,
      matchStatus: 'matched',
      transaction: {
        status: { not: 'cancelled' },
        ...buildDateFilter(s, e),
      },
    },
    select: {
      productId: true,
      productName: true,
      quantity: true,
      unitPriceAtSale: true,
      costPriceAtSale: true,
      lineTotal: true,
      marginAmount: true,
    },
  });

  // Aggregate by product
  const products = new Map();
  for (const line of lines) {
    const key = line.productId || line.productName;
    const existing = products.get(key) || {
      productId: line.productId,
      productName: line.productName,
      revenue: 0,
      costOfGoods: 0,
      unitsSold: 0,
    };
    existing.revenue += line.lineTotal;
    existing.costOfGoods += (line.costPriceAtSale || 0) * line.quantity;
    existing.unitsSold += line.quantity;
    products.set(key, existing);
  }

  const results = Array.from(products.values()).map((p) => {
    const grossMargin = p.revenue - p.costOfGoods;
    return {
      ...p,
      revenue: Math.round(p.revenue * 100) / 100,
      costOfGoods: Math.round(p.costOfGoods * 100) / 100,
      grossMargin: Math.round(grossMargin * 100) / 100,
      marginPercent: p.revenue > 0
        ? Math.round((grossMargin / p.revenue) * 1000) / 10
        : null,
    };
  });

  // Sort
  const sortFn = sortBy === 'margin_percent'
    ? (a, b) => (b.marginPercent || 0) - (a.marginPercent || 0)
    : sortBy === 'units'
      ? (a, b) => b.unitsSold - a.unitsSold
      : (a, b) => b.revenue - a.revenue;
  results.sort(sortFn);

  // Data quality
  const dataQuality = await getDataQuality(prisma, { startDate: s, endDate: e });

  return {
    products: results.slice(0, limit),
    dataQuality,
  };
}

/**
 * Products below margin threshold.
 */
export async function getLowMarginProducts(prisma, { threshold = 20, startDate, endDate, tenantId } = {}) {
  const result = await getMarginByProduct(prisma, { startDate, endDate, limit: 1000, sortBy: 'margin_percent', tenantId });
  const lowMargin = result.products.filter((p) => p.marginPercent !== null && p.marginPercent < threshold);
  return {
    products: lowMargin,
    threshold,
    dataQuality: result.dataQuality,
  };
}

// ── Product Performance ──

/**
 * Top/bottom products by metric.
 */
export async function getTopProducts(prisma, { metric = 'revenue', limit = 10, startDate, endDate, tenantId } = {}) {
  return getProductRanking(prisma, { metric, limit, startDate, endDate, direction: 'top', tenantId });
}

export async function getBottomProducts(prisma, { metric = 'revenue', limit = 10, startDate, endDate, tenantId } = {}) {
  return getProductRanking(prisma, { metric, limit, startDate, endDate, direction: 'bottom', tenantId });
}

async function getProductRanking(prisma, { metric, limit, startDate, endDate, direction, tenantId }) {
  const defaults = defaultDateRange();
  const rawStart = parseDate(startDate) || defaults.startDate;
  const s = tenantId ? await clampToWindow(prisma, tenantId, rawStart) : rawStart;
  const e = parseDate(endDate) || defaults.endDate;

  // For margin metrics, only include items with cost data
  const costFilter = metric === 'margin' ? { costDataAvailable: true } : {};

  const lines = await prisma.salesLineItem.findMany({
    where: {
      matchStatus: 'matched',
      ...costFilter,
      transaction: {
        status: { not: 'cancelled' },
        ...buildDateFilter(s, e),
      },
    },
    select: {
      productId: true,
      productName: true,
      quantity: true,
      lineTotal: true,
      marginAmount: true,
      costPriceAtSale: true,
    },
  });

  // Aggregate
  const products = new Map();
  for (const line of lines) {
    const key = line.productId || line.productName;
    const existing = products.get(key) || {
      productId: line.productId,
      productName: line.productName,
      revenue: 0,
      unitsSold: 0,
      totalMargin: 0,
    };
    existing.revenue += line.lineTotal;
    existing.unitsSold += line.quantity;
    if (line.marginAmount !== null) {
      existing.totalMargin += line.marginAmount * line.quantity;
    }
    products.set(key, existing);
  }

  let results = Array.from(products.values()).map((p) => ({
    ...p,
    revenue: Math.round(p.revenue * 100) / 100,
    totalMargin: Math.round(p.totalMargin * 100) / 100,
    marginPercent: p.revenue > 0
      ? Math.round((p.totalMargin / p.revenue) * 1000) / 10
      : null,
  }));

  // Sort by metric
  const sortFn = metric === 'margin'
    ? (a, b) => b.totalMargin - a.totalMargin
    : metric === 'volume'
      ? (a, b) => b.unitsSold - a.unitsSold
      : (a, b) => b.revenue - a.revenue;

  results.sort(sortFn);

  if (direction === 'bottom') results.reverse();

  return { products: results.slice(0, limit) };
}

/**
 * Products with growing or declining sales.
 * Compares the most recent half of the date range to the first half.
 */
export async function getProductTrends(prisma, { startDate, endDate, tenantId } = {}) {
  const defaults = defaultDateRange();
  const rawStart = parseDate(startDate) || defaults.startDate;
  const s = tenantId ? await clampToWindow(prisma, tenantId, rawStart) : rawStart;
  const e = parseDate(endDate) || defaults.endDate;

  // Split the range in half
  const midpoint = new Date((s.getTime() + e.getTime()) / 2);

  const [firstHalf, secondHalf] = await Promise.all([
    getProductTotals(prisma, s, midpoint),
    getProductTotals(prisma, midpoint, e),
  ]);

  // Compare
  const allProducts = new Set([...firstHalf.keys(), ...secondHalf.keys()]);
  const trends = [];

  for (const productId of allProducts) {
    const first = firstHalf.get(productId) || { revenue: 0, units: 0, name: '' };
    const second = secondHalf.get(productId) || { revenue: 0, units: 0, name: '' };
    const name = second.name || first.name;

    const revenueChange = second.revenue - first.revenue;
    const revenueChangePercent = first.revenue > 0
      ? Math.round((revenueChange / first.revenue) * 1000) / 10
      : null;

    let trend = 'stable';
    if (revenueChangePercent !== null) {
      if (revenueChangePercent > 20) trend = 'growing';
      else if (revenueChangePercent < -20) trend = 'declining';
    }

    trends.push({
      productId,
      productName: name,
      firstPeriodRevenue: Math.round(first.revenue * 100) / 100,
      secondPeriodRevenue: Math.round(second.revenue * 100) / 100,
      revenueChange: Math.round(revenueChange * 100) / 100,
      revenueChangePercent,
      trend,
    });
  }

  // Sort: declining first (most attention needed), then growing, then stable
  const trendOrder = { declining: 0, growing: 1, stable: 2 };
  trends.sort((a, b) => trendOrder[a.trend] - trendOrder[b.trend] || b.revenueChange - a.revenueChange);

  return {
    trends,
    growing: trends.filter((t) => t.trend === 'growing').length,
    declining: trends.filter((t) => t.trend === 'declining').length,
    stable: trends.filter((t) => t.trend === 'stable').length,
  };
}

async function getProductTotals(prisma, startDate, endDate) {
  const lines = await prisma.salesLineItem.findMany({
    where: {
      matchStatus: 'matched',
      transaction: {
        status: { not: 'cancelled' },
        ...buildDateFilter(startDate, endDate),
      },
    },
    select: {
      productId: true,
      productName: true,
      quantity: true,
      lineTotal: true,
    },
  });

  const products = new Map();
  for (const line of lines) {
    const key = line.productId || line.productName;
    const existing = products.get(key) || { revenue: 0, units: 0, name: line.productName };
    existing.revenue += line.lineTotal;
    existing.units += line.quantity;
    products.set(key, existing);
  }
  return products;
}
