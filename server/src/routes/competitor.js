import { Router } from 'express';
import { checkApiLimit } from '../middleware/apiLimiter.js';

const router = Router();

// ── Competitor Monitors ──

// GET /api/competitor/monitors — List all monitors for tenant
router.get('/monitors', async (req, res) => {
  try {
    const monitors = await req.prisma.competitorMonitor.findMany({
      include: {
        product: { select: { id: true, name: true, category: true, barcode: true } },
        prices: {
          orderBy: { scrapedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(monitors);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/competitor/monitors — Create a new monitor
router.post('/monitors', async (req, res) => {
  try {
    const { productId, competitor, externalUrl, externalSku, searchTerm } = req.body;

    if (!productId || !competitor) {
      return res.status(400).json({ message: 'productId and competitor are required' });
    }

    const validCompetitors = ['woolworths', 'coles', 'aldi', 'iga'];
    if (!validCompetitors.includes(competitor.toLowerCase())) {
      return res.status(400).json({
        message: `Invalid competitor. Must be one of: ${validCompetitors.join(', ')}`,
      });
    }

    // Verify product exists for this tenant
    const product = await req.prisma.product.findFirst({
      where: { id: productId },
    });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const monitor = await req.prisma.competitorMonitor.create({
      data: {
        productId,
        competitor: competitor.toLowerCase(),
        externalUrl: externalUrl || null,
        externalSku: externalSku || null,
        searchTerm: searchTerm || null,
      },
      include: {
        product: { select: { id: true, name: true, category: true } },
      },
    });

    res.status(201).json(monitor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/competitor/monitors/:id — Update monitor
router.patch('/monitors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { externalUrl, externalSku, searchTerm, isActive } = req.body;

    const monitor = await req.prisma.competitorMonitor.update({
      where: { id },
      data: {
        ...(externalUrl !== undefined && { externalUrl }),
        ...(externalSku !== undefined && { externalSku }),
        ...(searchTerm !== undefined && { searchTerm }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        product: { select: { id: true, name: true, category: true } },
      },
    });

    res.json(monitor);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/competitor/monitors/:id — Delete monitor (cascades prices)
router.delete('/monitors/:id', async (req, res) => {
  try {
    await req.prisma.competitorMonitor.delete({
      where: { id: req.params.id },
    });
    res.json({ message: 'Monitor deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Competitor Prices (manual entry for V1) ──

// POST /api/competitor/monitors/:id/prices — Record a competitor price
router.post('/monitors/:id/prices', async (req, res) => {
  try {
    const { id } = req.params;
    const { price, unitPrice, unit, isOnSpecial, specialEndDate } = req.body;

    if (price === undefined || price === null) {
      return res.status(400).json({ message: 'price is required' });
    }

    // Verify monitor exists for this tenant
    const monitor = await req.prisma.competitorMonitor.findFirst({
      where: { id },
    });
    if (!monitor) {
      return res.status(404).json({ message: 'Monitor not found' });
    }

    const priceRecord = await req.prisma.competitorPrice.create({
      data: {
        competitorMonitorId: id,
        price: parseFloat(price),
        unitPrice: unitPrice ? parseFloat(unitPrice) : null,
        unit: unit || null,
        isOnSpecial: isOnSpecial || false,
        specialEndDate: specialEndDate ? new Date(specialEndDate) : null,
      },
    });

    // Update lastScrapedAt on monitor
    await req.prisma.competitorMonitor.update({
      where: { id },
      data: { lastScrapedAt: new Date() },
    });

    res.status(201).json(priceRecord);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/competitor/monitors/:id/prices — Get price history for a monitor
router.get('/monitors/:id/prices', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 30 } = req.query;

    const prices = await req.prisma.competitorPrice.findMany({
      where: { competitorMonitorId: id },
      orderBy: { scrapedAt: 'desc' },
      take: parseInt(limit),
    });

    res.json(prices);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Analysis ──

// GET /api/competitor/products/:productId/waterfall — Margin waterfall
router.get('/products/:productId/waterfall', async (req, res) => {
  try {
    const { productId } = req.params;

    const product = await req.prisma.product.findFirst({
      where: { id: productId },
      include: {
        variants: {
          where: { isActive: true },
          include: { store: { select: { id: true, name: true } } },
        },
        competitorMonitors: {
          where: { isActive: true },
          include: {
            prices: {
              orderBy: { scrapedAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Build waterfall for the first active variant (primary store)
    const variant = product.variants[0];
    if (!variant) {
      return res.json({ product, waterfall: null, message: 'No active variants' });
    }

    const supplierCost = variant.currentCost;
    const landedCost = supplierCost; // V1: no per-product freight allocation
    const retailPrice = variant.salePrice;
    const margin = retailPrice > 0 ? ((retailPrice - landedCost) / retailPrice) : 0;

    const competitors = product.competitorMonitors.map((m) => ({
      competitor: m.competitor,
      price: m.prices[0]?.price || null,
      isOnSpecial: m.prices[0]?.isOnSpecial || false,
      diff: m.prices[0] && retailPrice > 0
        ? ((m.prices[0].price - retailPrice) / retailPrice * 100).toFixed(1)
        : null,
    }));

    res.json({
      product: { id: product.id, name: product.name, category: product.category },
      variant: { id: variant.id, sku: variant.sku, store: variant.store.name },
      waterfall: {
        supplierCost,
        landedCost,
        retailPrice,
        margin: (margin * 100).toFixed(1),
        competitors,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/competitor/products/:productId/suppliers — Cross-supplier comparison
router.get('/products/:productId/suppliers', async (req, res) => {
  try {
    const { productId } = req.params;

    // Find all invoice line matches for this product's variants
    const product = await req.prisma.product.findFirst({
      where: { id: productId },
      include: {
        variants: {
          select: { id: true },
        },
      },
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const variantIds = product.variants.map((v) => v.id);

    // Get all matches for these variants with invoice + supplier info
    const matches = await req.prisma.invoiceLineMatch.findMany({
      where: {
        productVariantId: { in: variantIds },
        status: { in: ['CONFIRMED', 'APPROVED', 'EXPORTED'] },
      },
      include: {
        invoiceLine: {
          include: {
            invoice: {
              select: {
                supplierId: true,
                supplierName: true,
                invoiceDate: true,
                invoiceNumber: true,
                supplier: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by supplier
    const supplierMap = new Map();
    for (const match of matches) {
      const inv = match.invoiceLine.invoice;
      const supplierId = inv.supplierId || 'unknown';
      const supplierName = inv.supplier?.name || inv.supplierName || 'Unknown';

      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, {
          supplierId,
          supplierName,
          costs: [],
          invoiceCount: 0,
          lastInvoiceDate: null,
        });
      }

      const entry = supplierMap.get(supplierId);
      if (match.newCost) {
        entry.costs.push(match.newCost);
      }
      entry.invoiceCount++;
      if (!entry.lastInvoiceDate || (inv.invoiceDate && inv.invoiceDate > entry.lastInvoiceDate)) {
        entry.lastInvoiceDate = inv.invoiceDate;
      }
    }

    // Calculate averages and trends
    const suppliers = Array.from(supplierMap.values()).map((s) => {
      const lastCost = s.costs[0] || 0;
      const avgCost = s.costs.length > 0
        ? s.costs.reduce((a, b) => a + b, 0) / s.costs.length
        : 0;
      const trend = s.costs.length >= 2
        ? (s.costs[0] > s.costs[1] ? 'up' : s.costs[0] < s.costs[1] ? 'down' : 'stable')
        : 'stable';

      return {
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        lastCost: parseFloat(lastCost.toFixed(2)),
        avgCost: parseFloat(avgCost.toFixed(2)),
        invoiceCount: s.invoiceCount,
        lastInvoiceDate: s.lastInvoiceDate,
        trend,
      };
    });

    // Sort by last cost ascending (cheapest first)
    suppliers.sort((a, b) => a.lastCost - b.lastCost);

    res.json({
      product: { id: product.id, name: product.name },
      suppliers,
      bestPrice: suppliers[0]?.lastCost || null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/competitor/products/:productId/supplier-history/:supplierId — Cost history
router.get('/products/:productId/supplier-history/:supplierId', async (req, res) => {
  try {
    const { productId, supplierId } = req.params;

    const product = await req.prisma.product.findFirst({
      where: { id: productId },
      include: { variants: { select: { id: true } } },
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const variantIds = product.variants.map((v) => v.id);

    const matches = await req.prisma.invoiceLineMatch.findMany({
      where: {
        productVariantId: { in: variantIds },
        status: { in: ['CONFIRMED', 'APPROVED', 'EXPORTED'] },
        invoiceLine: {
          invoice: { supplierId },
        },
      },
      include: {
        invoiceLine: {
          include: {
            invoice: {
              select: { invoiceDate: true, invoiceNumber: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const history = matches
      .filter((m) => m.newCost)
      .map((m) => ({
        date: m.invoiceLine.invoice.invoiceDate,
        cost: m.newCost,
        invoiceNumber: m.invoiceLine.invoice.invoiceNumber,
      }));

    res.json({ productId, supplierId, history });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/competitor/products/:productId/ai-recommendation — AI pricing (uses API quota)
router.post('/products/:productId/ai-recommendation', checkApiLimit, async (req, res) => {
  try {
    // TODO: Implement AI recommendation via trackedClaudeCall in Phase 6
    res.json({
      message: 'AI pricing recommendation not yet implemented',
      productId: req.params.productId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Alerts ──

// GET /api/competitor/alerts — Get all alerts for tenant
router.get('/alerts', async (req, res) => {
  try {
    const { unreadOnly } = req.query;

    const where = {};
    if (unreadOnly === 'true') {
      where.isRead = false;
      where.isDismissed = false;
    }

    const alerts = await req.prisma.priceAlert.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, category: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    res.json(alerts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/competitor/alerts/generate — Trigger alert generation
router.post('/alerts/generate', async (req, res) => {
  try {
    // Get all active monitors with latest prices
    const monitors = await req.prisma.competitorMonitor.findMany({
      where: { isActive: true },
      include: {
        product: {
          include: {
            variants: {
              where: { isActive: true },
              take: 1,
            },
          },
        },
        prices: {
          orderBy: { scrapedAt: 'desc' },
          take: 1,
        },
      },
    });

    const alerts = [];

    for (const monitor of monitors) {
      const variant = monitor.product.variants[0];
      if (!variant || !monitor.prices[0]) continue;

      const ourPrice = variant.salePrice;
      const competitorPrice = monitor.prices[0].price;
      const ourCost = variant.currentCost;
      const margin = ourPrice > 0 ? (ourPrice - ourCost) / ourPrice : 0;

      // Competitor undercut: they're >5% cheaper
      if (competitorPrice < ourPrice * 0.95) {
        const diff = ((ourPrice - competitorPrice) / ourPrice * 100).toFixed(1);
        alerts.push({
          productId: monitor.productId,
          alertType: 'competitor_undercut',
          severity: competitorPrice < ourPrice * 0.85 ? 'critical' : 'warning',
          title: `${monitor.competitor} is ${diff}% cheaper on ${monitor.product.name}`,
          description: `${monitor.competitor}: $${competitorPrice.toFixed(2)} vs your $${ourPrice.toFixed(2)}`,
          metadata: { competitor: monitor.competitor, competitorPrice, ourPrice, diff },
        });
      }

      // Price opportunity: they're >15% more expensive
      if (competitorPrice > ourPrice * 1.15) {
        const diff = ((competitorPrice - ourPrice) / ourPrice * 100).toFixed(1);
        alerts.push({
          productId: monitor.productId,
          alertType: 'price_opportunity',
          severity: 'info',
          title: `Price opportunity on ${monitor.product.name}`,
          description: `${monitor.competitor}: $${competitorPrice.toFixed(2)} vs your $${ourPrice.toFixed(2)} (+${diff}%)`,
          metadata: { competitor: monitor.competitor, competitorPrice, ourPrice, diff },
        });
      }

      // Margin squeeze: margin below 20%
      if (margin < 0.2 && margin > 0) {
        alerts.push({
          productId: monitor.productId,
          alertType: 'margin_squeeze',
          severity: 'warning',
          title: `Low margin on ${monitor.product.name}`,
          description: `Current margin: ${(margin * 100).toFixed(1)}%. Cost: $${ourCost.toFixed(2)}, Price: $${ourPrice.toFixed(2)}`,
          metadata: { margin, ourCost, ourPrice },
        });
      }
    }

    // Create alerts (skip duplicates based on productId + alertType from today)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let created = 0;
    for (const alert of alerts) {
      const existing = await req.prisma.priceAlert.findFirst({
        where: {
          productId: alert.productId,
          alertType: alert.alertType,
          createdAt: { gte: today },
        },
      });

      if (!existing) {
        await req.prisma.priceAlert.create({ data: alert });
        created++;
      }
    }

    res.json({
      message: `Generated ${created} new alerts from ${monitors.length} monitors`,
      alertsGenerated: created,
      monitorsChecked: monitors.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/competitor/alerts/:id — Mark alert as read/dismissed
router.patch('/alerts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { isRead, isDismissed } = req.body;

    const alert = await req.prisma.priceAlert.update({
      where: { id },
      data: {
        ...(isRead !== undefined && { isRead }),
        ...(isDismissed !== undefined && { isDismissed }),
      },
    });

    res.json(alert);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
