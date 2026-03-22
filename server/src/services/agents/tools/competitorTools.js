/**
 * Competitor intelligence tools for the Business AI Advisor.
 * All queries use tenant-scoped Prisma for automatic isolation.
 */

export const competitorToolDefs = [
  {
    name: 'get_competitor_price_position',
    description:
      'Get competitor pricing comparison for monitored products. Shows your price vs competitor prices and whether you are above/below/at parity. Use to answer questions about competitive positioning, price gaps, and market opportunities.',
    input_schema: {
      type: 'object',
      properties: {
        competitor: {
          type: 'string',
          description:
            'Filter by specific competitor name, e.g. "woolworths", "coles" (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max comparisons to return (default 20, max 50)',
        },
      },
    },
  },
  {
    name: 'get_active_alerts',
    description:
      'Get active price alerts: competitor undercuts, margin squeezes, cost increases, and pricing opportunities. Use to answer questions about threats, opportunities, and what needs attention.',
    input_schema: {
      type: 'object',
      properties: {
        severity: {
          type: 'string',
          enum: ['info', 'warning', 'critical'],
          description: 'Filter by alert severity (optional)',
        },
        alertType: {
          type: 'string',
          enum: [
            'competitor_undercut',
            'margin_squeeze',
            'cost_increase',
            'price_opportunity',
          ],
          description: 'Filter by alert type (optional)',
        },
        includeRead: {
          type: 'boolean',
          description: 'Include already-read alerts (default false)',
        },
      },
    },
  },
];

export const competitorToolExecutors = {
  async get_competitor_price_position(input, prisma) {
    const limit = Math.min(input.limit || 20, 50);

    const monitorWhere = { isActive: true };
    if (input.competitor) {
      monitorWhere.competitor = {
        contains: input.competitor,
        mode: 'insensitive',
      };
    }

    const monitors = await prisma.competitorMonitor.findMany({
      where: monitorWhere,
      include: {
        product: {
          select: {
            name: true,
            category: true,
            sellingPrice: true,
            costPrice: true,
          },
        },
        prices: {
          orderBy: { scrapedAt: 'desc' },
          take: 1,
        },
      },
      take: limit,
    });

    const comparisons = monitors
      .filter((m) => m.prices.length > 0 && m.product.sellingPrice)
      .map((m) => {
        const latestPrice = m.prices[0];
        const ourPrice = m.product.sellingPrice;
        const theirPrice = latestPrice.price;
        const diff = ourPrice - theirPrice;
        const diffPct = (diff / theirPrice) * 100;

        let position;
        if (Math.abs(diffPct) < 2) position = 'at_parity';
        else if (diffPct > 0) position = 'above';
        else position = 'below';

        return {
          product: m.product.name,
          category: m.product.category,
          competitor: m.competitor,
          ourPrice,
          theirPrice,
          priceDiff: Math.round(diff * 100) / 100,
          priceDiffPct: Math.round(diffPct * 10) / 10,
          position,
          isOnSpecial: latestPrice.isOnSpecial,
          scrapedAt: latestPrice.scrapedAt.toISOString().split('T')[0],
        };
      });

    // Summary stats
    const above = comparisons.filter((c) => c.position === 'above').length;
    const below = comparisons.filter((c) => c.position === 'below').length;
    const parity = comparisons.filter((c) => c.position === 'at_parity').length;

    return {
      totalComparisons: comparisons.length,
      summary: {
        aboveCompetitor: above,
        belowCompetitor: below,
        atParity: parity,
      },
      comparisons,
    };
  },

  async get_active_alerts(input, prisma) {
    const where = { isDismissed: false };

    if (!input.includeRead) {
      where.isRead = false;
    }
    if (input.severity) {
      where.severity = input.severity;
    }
    if (input.alertType) {
      where.alertType = input.alertType;
    }

    const alerts = await prisma.priceAlert.findMany({
      where,
      include: {
        product: {
          select: { name: true, category: true, sellingPrice: true },
        },
      },
      orderBy: [
        { severity: 'desc' }, // critical first
        { createdAt: 'desc' },
      ],
      take: 30,
    });

    const bySeverity = {
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      info: alerts.filter((a) => a.severity === 'info').length,
    };

    return {
      totalAlerts: alerts.length,
      bySeverity,
      alerts: alerts.map((a) => ({
        type: a.alertType,
        severity: a.severity,
        title: a.title,
        description: a.description,
        product: a.product.name,
        category: a.product.category,
        createdAt: a.createdAt.toISOString().split('T')[0],
        metadata: a.metadata,
      })),
    };
  },
};
