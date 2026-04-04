/**
 * Usage API — Exposes visible resource metrics to the frontend.
 * AI query usage is deliberately NOT included (invisible to user).
 */

import { Router } from 'express';
import { getUsageSummary } from '../services/usageTracker.js';
import { getDataBeyondWindow, getAnalysisWindowStart } from '../services/analytics/salesAnalysis.js';
import { adminPrisma } from '../lib/prisma.js';

const router = Router();

// ── GET /api/usage/summary — User-facing usage dashboard ──

router.get('/summary', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const usage = await getUsageSummary(req.prisma, tenantId);

    // Look up tier info
    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: { select: { slug: true, name: true } } },
    });

    // Historical data info from Shopify integration (if connected)
    let historicalData = null;
    try {
      const integration = await req.prisma.shopifyIntegration.findUnique({
        where: { tenantId },
        select: {
          historicalSyncMonths: true,
          historicalSyncedAt: true,
          lastSyncAt: true,
          orderCount: true,
        },
      });

      const oldest = await req.prisma.salesTransaction.findFirst({
        orderBy: { transactionDate: 'asc' },
        select: { transactionDate: true },
      });

      const windowStart = await getAnalysisWindowStart(req.prisma, tenantId);

      historicalData = {
        monthsImported: integration?.historicalSyncMonths || null,
        oldestOrderDate: oldest?.transactionDate || null,
        lastSyncAt: integration?.lastSyncAt || null,
        totalOrders: integration?.orderCount || 0,
        analysisWindowStart: windowStart || null,
      };
    } catch { /* integration may not exist */ }

    // Days remaining in billing period
    const periodEnd = usage.billingPeriod.end;
    const daysRemaining = Math.max(0, Math.ceil((new Date(periodEnd) - new Date()) / (1000 * 60 * 60 * 24)));

    res.json({
      products: usage.products,
      integrations: usage.integrations,
      historicalData,
      billingPeriod: {
        start: usage.billingPeriod.start,
        end: usage.billingPeriod.end,
        daysRemaining,
      },
      tier: tenant?.planTier?.slug || 'starter',
      tierName: tenant?.planTier?.name || 'Starter',
      // NOTE: AI usage is deliberately NOT included here
    });
  } catch (err) {
    console.error('Usage summary error:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
