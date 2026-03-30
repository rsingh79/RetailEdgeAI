/**
 * Shopify integration routes (protected — requires auth + plan gate).
 *
 * Follows the Gmail routes pattern (routes/gmail.js):
 * - GET  /status       — connection status
 * - POST /auth-url     — generate OAuth consent URL
 * - POST /sync         — trigger product sync
 * - GET  /import-logs  — sync history
 * - DELETE /disconnect — remove integration
 *
 * OAuth callback is handled separately in app.js (unprotected GET).
 */

import { Router } from 'express';
import { buildAuthUrl, syncProducts, syncOrders, matchVariants, linkVariant, dismissVariants } from '../services/shopify.js';
import basePrisma from '../lib/prisma.js';

const router = Router();

// ── GET /status — Check Shopify connection status ────────────

router.get('/status', async (req, res) => {
  try {
    const integration = await req.prisma.shopifyIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.json({ connected: false });
    }

    // Get recent import logs
    const recentLogs = await req.prisma.shopifyImportLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    res.json({
      connected: true,
      shop: integration.shop,
      isActive: integration.isActive,
      lastSyncAt: integration.lastSyncAt,
      lastOrderSyncAt: integration.lastOrderSyncAt,
      productCount: integration.productCount,
      orderCount: integration.orderCount,
      pushPricesOnExport: integration.pushPricesOnExport,
      scopes: integration.scopes,
      connectedAt: integration.createdAt,
      recentLogs,
    });
  } catch (err) {
    console.error('Shopify status error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /auth-url — Generate Shopify OAuth URL ─────────────

router.post('/auth-url', async (req, res) => {
  try {
    const { shop } = req.body;
    if (!shop) {
      return res.status(400).json({ message: 'Shop domain is required' });
    }

    const result = buildAuthUrl(shop, req.user.tenantId);
    res.json(result);
  } catch (err) {
    console.error('Shopify auth-url error:', err);
    res.status(400).json({ message: err.message });
  }
});

// ── POST /sync — Trigger product sync from Shopify ──────────

router.post('/sync', async (req, res) => {
  try {
    const stats = await syncProducts(req.prisma, req.user.tenantId);
    res.json({
      message: 'Sync complete',
      ...stats,
    });
  } catch (err) {
    console.error('Shopify sync error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /sync-orders — Trigger order sync from Shopify ──────

router.post('/sync-orders', async (req, res) => {
  try {
    const stats = await syncOrders(req.prisma, req.user.tenantId);
    res.json({
      message: 'Order sync complete',
      ...stats,
    });
  } catch (err) {
    console.error('Shopify order sync error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /orders — List synced Shopify orders ──────────────────

router.get('/orders', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      req.prisma.shopifyOrder.findMany({
        where: { tenantId: req.user.tenantId },
        include: {
          lines: {
            include: {
              productVariant: {
                include: { product: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: { orderedAt: 'desc' },
        skip,
        take: limit,
      }),
      req.prisma.shopifyOrder.count({ where: { tenantId: req.user.tenantId } }),
    ]);

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Shopify orders error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /import-logs — View sync history ─────────────────────

router.get('/import-logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      req.prisma.shopifyImportLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      req.prisma.shopifyImportLog.count(),
    ]);

    res.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Shopify import-logs error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── PATCH /settings — Update integration settings ────────────

router.patch('/settings', async (req, res) => {
  try {
    const { pushPricesOnExport } = req.body;
    const updated = await req.prisma.shopifyIntegration.update({
      where: { tenantId: req.user.tenantId },
      data: {
        ...(pushPricesOnExport !== undefined && { pushPricesOnExport: Boolean(pushPricesOnExport) }),
      },
    });
    res.json({ pushPricesOnExport: updated.pushPricesOnExport });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Shopify not connected' });
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /disconnect — Remove Shopify integration ──────────

router.delete('/disconnect', async (req, res) => {
  try {
    const integration = await req.prisma.shopifyIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Shopify is not connected' });
    }

    // Delete integration record (import logs preserved for audit)
    await basePrisma.shopifyIntegration.delete({
      where: { tenantId: req.user.tenantId },
    });

    res.json({ disconnected: true, shop: integration.shop });
  } catch (err) {
    console.error('Shopify disconnect error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /match-variants — Auto-match Shopify variants to local products ──

router.post('/match-variants', async (req, res) => {
  try {
    const result = await matchVariants(req.prisma, req.user.tenantId);
    res.json(result);
  } catch (err) {
    console.error('Shopify match-variants error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /match-variants/link — Manually link a Shopify variant to a local variant ──

router.post('/match-variants/link', async (req, res) => {
  try {
    const { shopifyVariantId, shopifyProductId, localVariantId } = req.body;
    if (!shopifyVariantId || !localVariantId) {
      return res.status(400).json({ message: 'shopifyVariantId and localVariantId are required' });
    }
    const updated = await linkVariant(req.prisma, localVariantId, shopifyVariantId, shopifyProductId);
    res.json({ linked: true, variant: updated });
  } catch (err) {
    console.error('Shopify link-variant error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /match-variants/dismiss — Dismiss unmatched Shopify variants ──

router.post('/match-variants/dismiss', async (req, res) => {
  try {
    const { shopifyVariantId, shopifyVariantIds } = req.body;
    const ids = shopifyVariantIds || (shopifyVariantId ? [shopifyVariantId] : []);
    if (ids.length === 0) {
      return res.status(400).json({ message: 'shopifyVariantId or shopifyVariantIds required' });
    }
    const result = await dismissVariants(req.user.tenantId, ids);
    res.json(result);
  } catch (err) {
    console.error('Shopify dismiss-variants error:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
