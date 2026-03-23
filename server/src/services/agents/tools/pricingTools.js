/**
 * Pricing-related tools for the Business AI Advisor.
 * All queries use tenant-scoped Prisma for automatic isolation.
 */

export const pricingToolDefs = [
  {
    name: 'get_pricing_rules',
    description:
      'Get the tenant\'s active pricing rules including target margins, rounding strategy, and scope (global, category, supplier, product). Use to answer questions about pricing strategy and current rules.',
    input_schema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['GLOBAL', 'CATEGORY', 'SUPPLIER', 'PRODUCT'],
          description: 'Filter by rule scope (optional)',
        },
      },
    },
  },
  {
    name: 'get_margin_analysis',
    description:
      'Get overall margin analysis: average margin across all products, margin distribution (what % of products fall in each margin band), and products furthest from their target margin. Use for high-level profitability questions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_repricing_candidates',
    description:
      'Get products that are candidates for repricing: products where cost has changed but selling price has not been updated, or products below their target margin based on pricing rules. Use when the user asks about what needs repricing.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max candidates to return (default 20, max 50)',
        },
      },
    },
  },
];

export const pricingToolExecutors = {
  async get_pricing_rules(input, prisma) {
    const where = { isActive: true };
    if (input.scope) where.scope = input.scope;

    const rules = await prisma.pricingRule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { scope: 'asc' }],
    });

    return {
      count: rules.length,
      rules: rules.map((r) => ({
        name: r.name,
        scope: r.scope,
        scopeValue: r.scopeValue,
        targetMargin: r.targetMargin ? `${r.targetMargin}%` : null,
        minMargin: r.minMargin ? `${r.minMargin}%` : null,
        maxPriceJump: r.maxPriceJump ? `${r.maxPriceJump}%` : null,
        roundingStrategy: r.roundingStrategy,
        priority: r.priority,
      })),
    };
  },

  async get_margin_analysis(input, prisma) {
    const products = await prisma.product.findMany({
      where: {
        costPrice: { not: null, gt: 0 },
        sellingPrice: { not: null, gt: 0 },
      },
      select: {
        name: true,
        category: true,
        costPrice: true,
        sellingPrice: true,
      },
    });

    if (products.length === 0) {
      return { message: 'No products with both cost and selling price found' };
    }

    // Calculate margins
    const margins = products.map((p) => ({
      name: p.name,
      category: p.category,
      margin: ((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100,
    }));

    const avgMargin =
      margins.reduce((s, m) => s + m.margin, 0) / margins.length;

    // Margin distribution bands
    const bands = {
      negative: { label: 'Negative (loss)', count: 0, products: [] },
      '0-10': { label: '0-10%', count: 0, products: [] },
      '10-20': { label: '10-20%', count: 0, products: [] },
      '20-30': { label: '20-30%', count: 0, products: [] },
      '30-40': { label: '30-40%', count: 0, products: [] },
      '40+': { label: '40%+', count: 0, products: [] },
    };

    for (const m of margins) {
      let band;
      if (m.margin < 0) band = 'negative';
      else if (m.margin < 10) band = '0-10';
      else if (m.margin < 20) band = '10-20';
      else if (m.margin < 30) band = '20-30';
      else if (m.margin < 40) band = '30-40';
      else band = '40+';
      bands[band].count++;
      bands[band].products.push(m.name);
    }

    // Top/bottom by margin
    const sorted = [...margins].sort((a, b) => a.margin - b.margin);

    return {
      totalProducts: products.length,
      avgMarginPct: Math.round(avgMargin * 10) / 10,
      distribution: Object.values(bands).map((b) => ({
        band: b.label,
        count: b.count,
        pct: Math.round((b.count / products.length) * 1000) / 10,
      })),
      lowestMargin: sorted.slice(0, 5).map((m) => ({
        name: m.name,
        category: m.category,
        marginPct: Math.round(m.margin * 10) / 10,
      })),
      highestMargin: sorted
        .slice(-5)
        .reverse()
        .map((m) => ({
          name: m.name,
          category: m.category,
          marginPct: Math.round(m.margin * 10) / 10,
        })),
    };
  },

  async get_repricing_candidates(input, prisma) {
    const limit = Math.min(input.limit || 20, 50);

    // Get products with recent cost changes from invoice matches
    const recentMatches = await prisma.invoiceLineMatch.findMany({
      where: {
        newCost: { not: null },
        previousCost: { not: null },
        createdAt: { gte: new Date(Date.now() - 90 * 86400000) },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            costPrice: true,
            sellingPrice: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // De-dupe by product and find ones where cost changed significantly
    const seen = new Set();
    const candidates = [];

    for (const m of recentMatches) {
      if (!m.product || seen.has(m.product.id)) continue;
      seen.add(m.product.id);

      const costChange = m.newCost - m.previousCost;
      const costChangePct =
        m.previousCost > 0 ? (costChange / m.previousCost) * 100 : 0;

      // Only flag if cost changed by more than 1%
      if (Math.abs(costChangePct) < 1) continue;

      const currentMargin =
        m.product.sellingPrice && m.product.sellingPrice > 0
          ? ((m.product.sellingPrice - m.newCost) / m.product.sellingPrice) *
            100
          : null;

      candidates.push({
        product: m.product.name,
        category: m.product.category || 'Uncategorised',
        previousCost: m.previousCost,
        newCost: m.newCost,
        costChangePct: Math.round(costChangePct * 10) / 10,
        currentSellingPrice: m.product.sellingPrice,
        currentMarginPct: currentMargin
          ? Math.round(currentMargin * 10) / 10
          : null,
        needsRepricing: costChangePct > 2,
      });
    }

    // Sort by largest cost increase first
    candidates.sort(
      (a, b) => Math.abs(b.costChangePct) - Math.abs(a.costChangePct)
    );

    return {
      count: candidates.length,
      candidates: candidates.slice(0, limit),
    };
  },
};
