/**
 * Sales-related tools for the Business AI Advisor.
 * Queries canonical SalesTransaction/SalesLineItem tables.
 * All queries use tenant-scoped Prisma (req.prisma) for automatic isolation.
 */

import {
  getRevenueByPeriod,
  getRevenueComparison,
  getRevenueByChannel,
  getMarginByProduct,
  getLowMarginProducts,
  getTopProducts,
  getBottomProducts,
  getProductTrends,
  getDataQuality,
} from '../../../services/analytics/salesAnalysis.js';

// ── Tool Definitions (sent to Claude) ──

export const salesToolDefs = [
  {
    name: 'get_revenue_summary',
    description:
      'Get revenue aggregated by day, week, or month for a time period. Use to answer questions about sales, revenue, income, or turnover.',
    input_schema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Aggregation period (default: monthly)',
        },
        startDate: {
          type: 'string',
          description: 'Start date (ISO format, e.g. 2026-03-01). Default: 30 days ago.',
        },
        endDate: {
          type: 'string',
          description: 'End date (ISO format). Default: today.',
        },
      },
    },
  },
  {
    name: 'compare_revenue',
    description:
      'Compare revenue between two time periods. Use for growth analysis, month-over-month, quarter-over-quarter, or year-over-year comparison questions.',
    input_schema: {
      type: 'object',
      properties: {
        currentStart: { type: 'string', description: 'Start of current period (ISO date)' },
        currentEnd: { type: 'string', description: 'End of current period (ISO date)' },
        previousStart: { type: 'string', description: 'Start of comparison period (ISO date)' },
        previousEnd: { type: 'string', description: 'End of comparison period (ISO date)' },
      },
      required: ['currentStart', 'currentEnd', 'previousStart', 'previousEnd'],
    },
  },
  {
    name: 'get_revenue_by_channel',
    description:
      'Split revenue by sales channel (online web, POS in-store, draft orders, etc.). Use to answer questions about channel performance, online vs in-store sales.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
      },
    },
  },
  {
    name: 'get_margin_analysis',
    description:
      'Get profit margins per product. Only includes products with known cost data. IMPORTANT: Always call get_data_quality first before using this tool, and report cost data coverage to the user. Use for profitability, margin, gross profit questions.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
        limit: { type: 'number', description: 'Max products to return (default 20)' },
        sortBy: {
          type: 'string',
          enum: ['revenue', 'margin_percent', 'units'],
          description: 'Sort products by this metric (default: revenue)',
        },
      },
    },
  },
  {
    name: 'get_low_margin_products',
    description:
      'Find products with margins below a threshold. Use to identify pricing problems, products that may need price increases, or items sold below profitable levels.',
    input_schema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: 'Margin percent threshold (default 20). Products below this are returned.' },
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
      },
    },
  },
  {
    name: 'get_top_products',
    description:
      'Get best performing products by revenue, margin, or sales volume. Use for "what\'s selling well", "best sellers", "top products" questions.',
    input_schema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['revenue', 'margin', 'volume'],
          description: 'Rank products by this metric (default: revenue)',
        },
        limit: { type: 'number', description: 'How many products to return (default 10)' },
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
      },
    },
  },
  {
    name: 'get_bottom_products',
    description:
      'Get worst performing products by revenue, margin, or sales volume. Use for "what should I drop", "slowest movers", "underperformers" questions.',
    input_schema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          enum: ['revenue', 'margin', 'volume'],
          description: 'Rank products by this metric (default: revenue)',
        },
        limit: { type: 'number', description: 'How many products to return (default 10)' },
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
      },
    },
  },
  {
    name: 'get_product_trends',
    description:
      'Identify products with growing or declining sales by comparing the first half and second half of a date range. Use for trend analysis, "what\'s improving", "what needs attention" questions.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
      },
    },
  },
  {
    name: 'get_data_quality',
    description:
      'Check cost data coverage — how many products have known cost prices for margin calculation. ALWAYS call this BEFORE any margin or profitability analysis. If coverage is below 50%, lead your response with a data quality warning.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date (ISO format). Default: 30 days ago.' },
        endDate: { type: 'string', description: 'End date (ISO format). Default: today.' },
      },
    },
  },
];

// ── Tool Executors ──

export const salesToolExecutors = {
  async get_revenue_summary(input, prisma) {
    return getRevenueByPeriod(prisma, input);
  },

  async compare_revenue(input, prisma) {
    return getRevenueComparison(prisma, input);
  },

  async get_revenue_by_channel(input, prisma) {
    return getRevenueByChannel(prisma, input);
  },

  async get_margin_analysis(input, prisma) {
    return getMarginByProduct(prisma, input);
  },

  async get_low_margin_products(input, prisma) {
    return getLowMarginProducts(prisma, input);
  },

  async get_top_products(input, prisma) {
    return getTopProducts(prisma, input);
  },

  async get_bottom_products(input, prisma) {
    return getBottomProducts(prisma, input);
  },

  async get_product_trends(input, prisma) {
    return getProductTrends(prisma, input);
  },

  async get_data_quality(input, prisma) {
    return getDataQuality(prisma, input);
  },
};
