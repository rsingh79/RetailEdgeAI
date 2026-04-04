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
import { buildAuthUrl, syncProducts, syncOrders, fetchOrders, matchVariants, linkVariant, dismissVariants } from '../services/shopify.js';
import { getCurrentUsage } from '../services/usageTracker.js';
import { TIER_LIMITS } from '../config/tierLimits.js';
import { adminPrisma } from '../lib/prisma.js';
import { decrypt } from '../lib/encryption.js';

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
import { enforceIntegrationLimit } from '../middleware/usageEnforcement.js';

router.post('/auth-url', enforceIntegrationLimit('shopify'), async (req, res) => {
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

// ── GET /sync-options — Pre-sync configuration for the UI ────

const ALL_MONTH_OPTIONS = [1, 3, 6, 12, 24, 36, 48, 60];

function _getNextTier(currentSlug) {
  const order = ['starter', 'growth', 'professional', 'enterprise'];
  const idx = order.indexOf(currentSlug);
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
}

router.get('/sync-options', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const usage = await getCurrentUsage(req.prisma, tenantId);
    const maxMonths = usage.historicalSyncMonths;
    const unlimited = maxMonths === -1;

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: { select: { slug: true, name: true } } },
    });
    const tierSlug = tenant?.planTier?.slug || 'starter';
    const tierName = tenant?.planTier?.name || 'Starter';

    const options = unlimited
      ? [...ALL_MONTH_OPTIONS, 'unlimited']
      : ALL_MONTH_OPTIONS.filter((m) => m <= maxMonths);

    const integration = await req.prisma.shopifyIntegration.findUnique({
      where: { tenantId },
    });

    // Estimate order count if integration exists
    let estimatedOrders = null;
    if (integration?.accessTokenEnc) {
      try {
        const token = decrypt(integration.accessTokenEnc);
        const countRes = await fetch(
          `https://${integration.shop}/admin/api/2024-01/orders/count.json?status=any`,
          { headers: { 'X-Shopify-Access-Token': token } },
        );
        if (countRes.ok) {
          const data = await countRes.json();
          estimatedOrders = data.count || null;
        }
      } catch { /* best-effort estimate */ }
    }

    const nextTier = _getNextTier(tierSlug);
    const nextTierLimits = nextTier ? TIER_LIMITS[nextTier] : null;

    res.json({
      maxMonthsAllowed: unlimited ? -1 : maxMonths,
      tierName,
      suggestedMonths: unlimited ? null : maxMonths,
      options,
      estimatedOrders,
      alreadySynced: !!integration?.historicalSyncedAt,
      previousSyncMonths: integration?.historicalSyncMonths || null,
      lastSyncAt: integration?.lastSyncAt || integration?.lastOrderSyncAt || null,
      autoSyncEnabled: integration?.autoSyncEnabled || false,
      upgradeMessage: nextTierLimits
        ? `Upgrade to ${nextTier.charAt(0).toUpperCase() + nextTier.slice(1)} for up to ${nextTierLimits.historicalSyncMonths === -1 ? 'unlimited' : nextTierLimits.historicalSyncMonths + ' months of'} history.`
        : null,
    });
  } catch (err) {
    console.error('Shopify sync-options error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /sync-orders — Mode A: Historical import ────────────

router.post('/sync-orders', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { historicalMonths, enableAutoSync } = req.body;

    if (!historicalMonths || historicalMonths < 1) {
      return res.status(400).json({ message: 'historicalMonths is required (minimum 1).' });
    }

    // Tier enforcement — only applies to historical import
    const usage = await getCurrentUsage(req.prisma, tenantId);
    const maxMonths = usage.historicalSyncMonths;
    if (maxMonths !== -1 && historicalMonths > maxMonths) {
      const tenant = await adminPrisma.tenant.findUnique({
        where: { id: tenantId },
        select: { planTier: { select: { name: true, slug: true } } },
      });
      const tierName = tenant?.planTier?.name || 'current';
      const nextTier = _getNextTier(tenant?.planTier?.slug || 'starter');
      const nextLimits = nextTier ? TIER_LIMITS[nextTier] : null;
      return res.status(400).json({
        error: 'Exceeds plan limit',
        code: 'HISTORICAL_SYNC_LIMIT',
        message: `Your ${tierName} plan allows up to ${maxMonths} months of historical data.`,
        maxAllowed: maxMonths,
        requested: historicalMonths,
        upgradeMessage: nextLimits
          ? `Upgrade to ${nextTier.charAt(0).toUpperCase() + nextTier.slice(1)} for up to ${nextLimits.historicalSyncMonths === -1 ? 'unlimited' : nextLimits.historicalSyncMonths + ' months'}.`
          : null,
      });
    }

    // Mark sync in progress
    await req.prisma.shopifyIntegration.update({
      where: { tenantId },
      data: { syncStatus: 'in_progress' },
    });

    // Compute date boundary and run sync
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - historicalMonths);

    const stats = await syncOrders(req.prisma, tenantId, { sinceDate: fromDate });
    const now = new Date();

    // Update integration with sync metadata
    await req.prisma.shopifyIntegration.update({
      where: { tenantId },
      data: {
        historicalSyncMonths: historicalMonths,
        historicalSyncedAt: now,
        lastSyncAt: now,
        syncStatus: 'completed',
        autoSyncEnabled: !!enableAutoSync,
        autoSyncConsentedAt: enableAutoSync ? now : undefined,
      },
    });

    res.json({
      message: 'Historical import complete',
      historicalMonths,
      autoSyncEnabled: !!enableAutoSync,
      ...stats,
    });
  } catch (err) {
    console.error('Shopify sync-orders error:', err);
    // Mark as failed
    try {
      await req.prisma.shopifyIntegration.update({
        where: { tenantId: req.user.tenantId },
        data: { syncStatus: 'failed' },
      });
    } catch { /* best-effort */ }
    res.status(500).json({ message: err.message });
  }
});

// ── POST /sync-now — Mode B: Manual catch-up sync ────────────

router.post('/sync-now', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const integration = await req.prisma.shopifyIntegration.findUnique({
      where: { tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Shopify not connected.' });
    }

    const lastSync = integration.lastSyncAt || integration.lastOrderSyncAt;
    if (!lastSync) {
      return res.status(400).json({
        error: 'No previous sync',
        message: 'Please run a historical import first before using Sync Now.',
      });
    }

    await req.prisma.shopifyIntegration.update({
      where: { tenantId },
      data: { syncStatus: 'in_progress' },
    });

    const stats = await syncOrders(req.prisma, tenantId, { sinceDate: lastSync });
    const now = new Date();

    await req.prisma.shopifyIntegration.update({
      where: { tenantId },
      data: { lastSyncAt: now, syncStatus: 'completed' },
    });

    res.json({
      message: 'Catch-up sync complete',
      syncedFrom: lastSync,
      syncedTo: now,
      ...stats,
    });
  } catch (err) {
    console.error('Shopify sync-now error:', err);
    try {
      await req.prisma.shopifyIntegration.update({
        where: { tenantId: req.user.tenantId },
        data: { syncStatus: 'failed' },
      });
    } catch { /* best-effort */ }
    res.status(500).json({ message: err.message });
  }
});

// ── PUT /auto-sync — Mode C: Toggle automatic daily sync ─────

router.put('/auto-sync', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled (boolean) is required.' });
    }

    const data = { autoSyncEnabled: enabled };
    if (enabled) {
      data.autoSyncConsentedAt = new Date();
    }

    const updated = await req.prisma.shopifyIntegration.update({
      where: { tenantId },
      data,
    });

    res.json({
      autoSyncEnabled: updated.autoSyncEnabled,
      consentedAt: updated.autoSyncConsentedAt,
    });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Shopify not connected.' });
    console.error('Shopify auto-sync toggle error:', err);
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
        orderBy: { orderDate: 'desc' },
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
    await req.prisma.shopifyIntegration.delete({
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
