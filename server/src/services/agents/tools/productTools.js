/**
 * Product-related tools for the Business AI Advisor.
 * All queries use tenant-scoped Prisma for automatic isolation.
 */

export const productToolDefs = [
  {
    name: 'search_products',
    description:
      'Search products by name or category. Returns product details including cost, selling price, and margin. Use to answer questions about specific products or product categories.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Product name or partial name to search for',
        },
        category: {
          type: 'string',
          description: 'Filter by product category (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max products to return (default 20, max 50)',
        },
      },
    },
  },
  {
    name: 'get_low_margin_products',
    description:
      'Get products with the lowest profit margins. Shows cost price, selling price, and margin percentage. Use to identify products that need repricing or supplier negotiation.',
    input_schema: {
      type: 'object',
      properties: {
        belowMarginPct: {
          type: 'number',
          description:
            'Only show products below this margin % (default 20)',
        },
        limit: {
          type: 'number',
          description: 'Max products to return (default 20, max 50)',
        },
      },
    },
  },
  {
    name: 'get_category_performance',
    description:
      'Get performance summary by product category: product count, average margin, total cost value, and total retail value. Use to answer questions about which categories are most/least profitable.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_product_cost_history',
    description:
      'Get cost history for a product based on invoice line matches. Shows how the cost from suppliers has changed over time. Use to answer questions about price increases, cost trends for specific products.',
    input_schema: {
      type: 'object',
      properties: {
        productName: {
          type: 'string',
          description: 'Product name to search for',
        },
        days: {
          type: 'number',
          description: 'Number of days to look back (default 180)',
        },
      },
      required: ['productName'],
    },
  },
];

export const productToolExecutors = {
  async search_products(input, prisma) {
    const limit = Math.min(input.limit || 20, 50);
    const where = { archivedAt: null };

    if (input.query) {
      where.name = { contains: input.query, mode: 'insensitive' };
    }
    if (input.category) {
      where.category = { contains: input.category, mode: 'insensitive' };
    }

    const products = await prisma.product.findMany({
      where,
      include: {
        variants: {
          where: { isActive: true },
          select: {
            sku: true,
            name: true,
            size: true,
            currentCost: true,
            salePrice: true,
            store: { select: { name: true, type: true } },
          },
          take: 5,
        },
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    return {
      count: products.length,
      products: products.map((p) => {
        const margin =
          p.costPrice && p.sellingPrice
            ? Math.round(
                ((p.sellingPrice - p.costPrice) / p.sellingPrice) * 1000
              ) / 10
            : null;
        return {
          name: p.name,
          category: p.category || 'Uncategorised',
          costPrice: p.costPrice,
          sellingPrice: p.sellingPrice,
          marginPct: margin,
          barcode: p.barcode,
          variants: p.variants.map((v) => ({
            sku: v.sku,
            name: v.name,
            size: v.size,
            cost: v.currentCost,
            price: v.salePrice,
            store: v.store.name,
            storeType: v.store.type,
            margin:
              v.salePrice > 0
                ? Math.round(
                    ((v.salePrice - v.currentCost) / v.salePrice) * 1000
                  ) / 10
                : null,
          })),
        };
      }),
    };
  },

  async get_low_margin_products(input, prisma) {
    const belowMargin = input.belowMarginPct ?? 20;
    const limit = Math.min(input.limit || 20, 50);

    // Get all products with both cost and selling price
    const products = await prisma.product.findMany({
      where: {
        archivedAt: null,
        costPrice: { not: null, gt: 0 },
        sellingPrice: { not: null, gt: 0 },
      },
      select: {
        name: true,
        category: true,
        costPrice: true,
        sellingPrice: true,
      },
      orderBy: { name: 'asc' },
    });

    // Calculate margins and filter
    const withMargins = products
      .map((p) => ({
        name: p.name,
        category: p.category || 'Uncategorised',
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        marginPct:
          Math.round(
            ((p.sellingPrice - p.costPrice) / p.sellingPrice) * 1000
          ) / 10,
      }))
      .filter((p) => p.marginPct < belowMargin)
      .sort((a, b) => a.marginPct - b.marginPct)
      .slice(0, limit);

    return {
      threshold: `below ${belowMargin}% margin`,
      count: withMargins.length,
      products: withMargins,
    };
  },

  async get_category_performance(input, prisma) {
    const products = await prisma.product.findMany({
      where: {
        archivedAt: null,
        costPrice: { not: null },
        sellingPrice: { not: null },
      },
      select: {
        category: true,
        costPrice: true,
        sellingPrice: true,
      },
    });

    const byCategory = {};
    for (const p of products) {
      const cat = p.category || 'Uncategorised';
      if (!byCategory[cat]) {
        byCategory[cat] = {
          category: cat,
          productCount: 0,
          totalCost: 0,
          totalRetail: 0,
          margins: [],
        };
      }
      byCategory[cat].productCount++;
      byCategory[cat].totalCost += p.costPrice || 0;
      byCategory[cat].totalRetail += p.sellingPrice || 0;
      if (p.costPrice > 0 && p.sellingPrice > 0) {
        byCategory[cat].margins.push(
          ((p.sellingPrice - p.costPrice) / p.sellingPrice) * 100
        );
      }
    }

    const results = Object.values(byCategory)
      .map((c) => ({
        category: c.category,
        productCount: c.productCount,
        totalCostValue: Math.round(c.totalCost * 100) / 100,
        totalRetailValue: Math.round(c.totalRetail * 100) / 100,
        avgMarginPct:
          c.margins.length > 0
            ? Math.round(
                (c.margins.reduce((s, m) => s + m, 0) / c.margins.length) * 10
              ) / 10
            : null,
      }))
      .sort((a, b) => b.totalRetailValue - a.totalRetailValue);

    return { categories: results };
  },

  async get_product_cost_history(input, prisma) {
    const days = Math.min(input.days || 180, 365);
    const since = new Date(Date.now() - days * 86400000);

    // Step A — Find active products by name
    const activeProducts = await prisma.product.findMany({
      where: {
        archivedAt: null,
        name: { contains: input.productName, mode: 'insensitive' },
      },
      select: { id: true, name: true, costPrice: true, sellingPrice: true, source: true },
      take: 5,
    });

    const activeProductIds = activeProducts.map((p) => p.id);

    // Step B — Find archived products that point to active ones via canonicalProductId
    const archivedProducts = activeProductIds.length > 0
      ? await prisma.product.findMany({
          where: {
            canonicalProductId: { in: activeProductIds },
            archivedAt: { not: null },
          },
          select: { id: true, name: true, source: true, archivedAt: true, canonicalProductId: true },
        })
      : [];

    const archivedProductIds = archivedProducts.map((p) => p.id);

    // Step C — Combine all product IDs
    const allProductIds = [...activeProductIds, ...archivedProductIds];

    if (allProductIds.length === 0) {
      return {
        product_name: input.productName,
        cost_history: [],
        message: 'No products found with that name',
      };
    }

    // Step D — Get invoice line matches for all IDs over time
    const matches = await prisma.invoiceLineMatch.findMany({
      where: {
        productId: { in: allProductIds },
        newCost: { not: null },
        createdAt: { gte: since },
      },
      include: {
        invoiceLine: {
          select: {
            description: true,
            unitPrice: true,
            invoice: {
              select: {
                invoiceDate: true,
                supplier: { select: { name: true } },
              },
            },
          },
        },
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      period: `last ${days} days`,
      products: activeProducts.map((p) => ({
        name: p.name,
        currentCost: p.costPrice,
        currentPrice: p.sellingPrice,
      })),
      costHistory: matches.map((m) => ({
        product: m.product?.name,
        date: (
          m.invoiceLine.invoice.invoiceDate || m.createdAt
        )
          .toISOString()
          .split('T')[0],
        supplier: m.invoiceLine.invoice.supplier?.name || 'Unknown',
        unitPrice: m.invoiceLine.unitPrice,
        newCost: m.newCost,
        previousCost: m.previousCost,
        changeAmt:
          m.previousCost && m.newCost
            ? Math.round((m.newCost - m.previousCost) * 100) / 100
            : null,
        changePct:
          m.previousCost && m.newCost && m.previousCost > 0
            ? Math.round(
                ((m.newCost - m.previousCost) / m.previousCost) * 1000
              ) / 10
            : null,
        isArchived: archivedProductIds.includes(m.productId),
      })),
    };
  },
};
