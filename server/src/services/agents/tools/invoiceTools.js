/**
 * Invoice-related tools for the Business AI Advisor.
 * All queries use tenant-scoped Prisma (req.prisma) for automatic isolation.
 */

export const invoiceToolDefs = [
  {
    name: 'get_recent_invoices',
    description:
      'Get recent invoices with supplier name, total, status, and line count. Use to answer questions about recent purchases, deliveries, or invoice processing status.',
    input_schema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to look back (default 30, max 365)',
        },
        status: {
          type: 'string',
          enum: [
            'PROCESSING',
            'READY',
            'IN_REVIEW',
            'APPROVED',
            'EXPORTED',
            'FAILED',
          ],
          description: 'Filter by invoice status (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max invoices to return (default 20, max 50)',
        },
      },
    },
  },
  {
    name: 'get_invoice_cost_summary',
    description:
      'Get aggregated cost summary grouped by supplier and/or category over a time period. Use to answer questions about spending, cost trends, which suppliers are most expensive, and where the money is going.',
    input_schema: {
      type: 'object',
      properties: {
        groupBy: {
          type: 'string',
          enum: ['supplier', 'category', 'month'],
          description: 'How to group the cost summary',
        },
        days: {
          type: 'number',
          description: 'Number of days to look back (default 90)',
        },
      },
      required: ['groupBy'],
    },
  },
  {
    name: 'get_supplier_spend_analysis',
    description:
      'Get detailed spending analysis for a specific supplier or all suppliers, including invoice count, total spend, average invoice size, and recent cost trends. Use to answer questions about supplier relationships and cost changes.',
    input_schema: {
      type: 'object',
      properties: {
        supplierName: {
          type: 'string',
          description:
            'Supplier name to analyse (optional, leave empty for all suppliers)',
        },
        days: {
          type: 'number',
          description: 'Number of days to look back (default 90)',
        },
      },
    },
  },
];

export const invoiceToolExecutors = {
  async get_recent_invoices(input, prisma) {
    const days = Math.min(input.days || 30, 365);
    const limit = Math.min(input.limit || 20, 50);
    const since = new Date(Date.now() - days * 86400000);

    const where = { createdAt: { gte: since } };
    if (input.status) where.status = input.status;

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      count: invoices.length,
      period: `last ${days} days`,
      invoices: invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        supplier: inv.supplier?.name || inv.supplierName || 'Unknown',
        date: inv.invoiceDate?.toISOString().split('T')[0],
        total: inv.total,
        subtotal: inv.subtotal,
        gst: inv.gst,
        status: inv.status,
        lineCount: inv._count.lines,
      })),
    };
  },

  async get_invoice_cost_summary(input, prisma) {
    const days = Math.min(input.days || 90, 365);
    const since = new Date(Date.now() - days * 86400000);

    if (input.groupBy === 'supplier') {
      const invoices = await prisma.invoice.findMany({
        where: { createdAt: { gte: since }, total: { not: null } },
        include: { supplier: { select: { name: true } } },
      });

      const bySupplier = {};
      for (const inv of invoices) {
        const name = inv.supplier?.name || inv.supplierName || 'Unknown';
        if (!bySupplier[name]) {
          bySupplier[name] = { supplier: name, totalSpend: 0, invoiceCount: 0 };
        }
        bySupplier[name].totalSpend += inv.total || 0;
        bySupplier[name].invoiceCount++;
      }

      const results = Object.values(bySupplier).sort(
        (a, b) => b.totalSpend - a.totalSpend
      );
      const grandTotal = results.reduce((s, r) => s + r.totalSpend, 0);

      return {
        period: `last ${days} days`,
        grandTotal: Math.round(grandTotal * 100) / 100,
        bySupplier: results.map((r) => ({
          ...r,
          totalSpend: Math.round(r.totalSpend * 100) / 100,
          pctOfTotal:
            grandTotal > 0
              ? Math.round((r.totalSpend / grandTotal) * 1000) / 10
              : 0,
        })),
      };
    }

    if (input.groupBy === 'category') {
      // Group by product category through invoice lines → matches → product
      const lines = await prisma.invoiceLine.findMany({
        where: {
          invoice: { createdAt: { gte: since } },
        },
        include: {
          matches: {
            include: { product: { select: { category: true } } },
            take: 1,
          },
        },
      });

      const byCategory = {};
      for (const line of lines) {
        const cat =
          line.matches[0]?.product?.category || 'Uncategorised';
        if (!byCategory[cat]) {
          byCategory[cat] = { category: cat, totalCost: 0, lineCount: 0 };
        }
        byCategory[cat].totalCost += line.lineTotal || 0;
        byCategory[cat].lineCount++;
      }

      const results = Object.values(byCategory).sort(
        (a, b) => b.totalCost - a.totalCost
      );

      return {
        period: `last ${days} days`,
        byCategory: results.map((r) => ({
          ...r,
          totalCost: Math.round(r.totalCost * 100) / 100,
        })),
      };
    }

    if (input.groupBy === 'month') {
      const invoices = await prisma.invoice.findMany({
        where: { createdAt: { gte: since }, total: { not: null } },
        select: { invoiceDate: true, total: true, createdAt: true },
      });

      const byMonth = {};
      for (const inv of invoices) {
        const d = inv.invoiceDate || inv.createdAt;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth[key]) {
          byMonth[key] = { month: key, totalSpend: 0, invoiceCount: 0 };
        }
        byMonth[key].totalSpend += inv.total || 0;
        byMonth[key].invoiceCount++;
      }

      const results = Object.values(byMonth).sort((a, b) =>
        a.month.localeCompare(b.month)
      );

      return {
        period: `last ${days} days`,
        byMonth: results.map((r) => ({
          ...r,
          totalSpend: Math.round(r.totalSpend * 100) / 100,
        })),
      };
    }

    return { error: 'Invalid groupBy value' };
  },

  async get_supplier_spend_analysis(input, prisma) {
    const days = Math.min(input.days || 90, 365);
    const since = new Date(Date.now() - days * 86400000);

    const where = { createdAt: { gte: since }, total: { not: null } };

    // If a supplier name is provided, find matching supplier(s)
    let supplierFilter = null;
    if (input.supplierName) {
      const suppliers = await prisma.supplier.findMany({
        where: {
          name: { contains: input.supplierName, mode: 'insensitive' },
        },
        select: { id: true, name: true },
      });
      if (suppliers.length === 0) {
        return {
          error: `No supplier found matching "${input.supplierName}"`,
        };
      }
      supplierFilter = suppliers.map((s) => s.id);
      where.supplierId = { in: supplierFilter };
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: { supplier: { select: { name: true } } },
      orderBy: { invoiceDate: 'asc' },
    });

    if (invoices.length === 0) {
      return { message: 'No invoices found for this period', period: `last ${days} days` };
    }

    // Group by supplier
    const bySupplier = {};
    for (const inv of invoices) {
      const name = inv.supplier?.name || inv.supplierName || 'Unknown';
      if (!bySupplier[name]) {
        bySupplier[name] = {
          supplier: name,
          invoiceCount: 0,
          totalSpend: 0,
          invoiceTotals: [],
        };
      }
      bySupplier[name].invoiceCount++;
      bySupplier[name].totalSpend += inv.total || 0;
      bySupplier[name].invoiceTotals.push({
        date: (inv.invoiceDate || inv.createdAt).toISOString().split('T')[0],
        total: inv.total,
      });
    }

    return {
      period: `last ${days} days`,
      suppliers: Object.values(bySupplier)
        .sort((a, b) => b.totalSpend - a.totalSpend)
        .slice(0, 20)
        .map((s) => ({
          supplier: s.supplier,
          invoiceCount: s.invoiceCount,
          totalSpend: Math.round(s.totalSpend * 100) / 100,
          avgInvoice:
            Math.round((s.totalSpend / s.invoiceCount) * 100) / 100,
          recentInvoices: s.invoiceTotals.slice(-5),
        })),
    };
  },
};
