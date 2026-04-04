import { Router } from 'express';
import { adminPrisma } from '../../lib/prisma.js';
import { BILLING_DEFAULTS } from '../../config/tierLimits.js';

const router = Router();

// ── GET /api/admin/tenants/:tenantId/billing ───────────────────

router.get('/tenants/:tenantId/billing', async (req, res) => {
  try {
    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: req.params.tenantId },
      select: {
        id: true,
        subscriptionStatus: true,
        gracePeriodDays: true,
        gracePeriodEndsAt: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
        stripePriceId: true,
        trialEndsAt: true,
        trialStartedAt: true,
        trialTier: true,
        hasTrialExpired: true,
        billingPeriodStart: true,
        billingPeriodEnd: true,
        planTier: { select: { slug: true, name: true, monthlyPrice: true } },
      },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Get system default for reference
    let systemGracePeriodDays = BILLING_DEFAULTS.defaultGracePeriodDays;
    try {
      const settings = await adminPrisma.platformSettings.findUnique({
        where: { id: 'singleton' },
        select: { gracePeriodDays: true },
      });
      if (settings) systemGracePeriodDays = settings.gracePeriodDays;
    } catch { /* use default */ }

    res.json({
      ...tenant,
      effectiveGracePeriodDays: tenant.gracePeriodDays ?? systemGracePeriodDays,
      systemDefaultGracePeriodDays: systemGracePeriodDays,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/admin/tenants/:tenantId/grace-period ──────────────

router.put('/tenants/:tenantId/grace-period', async (req, res) => {
  try {
    const { days, reason } = req.body;

    if (days === undefined || days === null) {
      return res.status(400).json({ error: 'days is required' });
    }

    const parsedDays = parseInt(days);
    if (isNaN(parsedDays) || parsedDays < 0 || parsedDays > 90) {
      return res.status(400).json({ error: 'days must be between 0 and 90' });
    }

    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: req.params.tenantId },
      select: { id: true, gracePeriodDays: true, gracePeriodEndsAt: true, subscriptionStatus: true },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    // Recalculate gracePeriodEndsAt if the tenant is currently past_due
    let newGracePeriodEndsAt = tenant.gracePeriodEndsAt;
    if (tenant.subscriptionStatus === 'past_due' && tenant.gracePeriodEndsAt) {
      // Calculate original failure date from existing grace period
      const currentGraceDays = tenant.gracePeriodDays ?? BILLING_DEFAULTS.defaultGracePeriodDays;
      const originalEndsAt = new Date(tenant.gracePeriodEndsAt);
      const failureDate = new Date(originalEndsAt);
      failureDate.setDate(failureDate.getDate() - currentGraceDays);

      // Recalculate with new grace days
      newGracePeriodEndsAt = new Date(failureDate);
      newGracePeriodEndsAt.setDate(newGracePeriodEndsAt.getDate() + parsedDays);
    }

    const previousDays = tenant.gracePeriodDays ?? BILLING_DEFAULTS.defaultGracePeriodDays;

    await adminPrisma.tenant.update({
      where: { id: req.params.tenantId },
      data: {
        gracePeriodDays: parsedDays,
        gracePeriodEndsAt: newGracePeriodEndsAt,
      },
    });

    // Audit log
    await adminPrisma.auditLog.create({
      data: {
        tenantId: req.params.tenantId,
        userId: req.user.userId,
        action: 'GRACE_PERIOD_EXTENDED',
        entityType: 'Tenant',
        entityId: req.params.tenantId,
        metadata: {
          previousDays,
          newDays: parsedDays,
          reason: reason || null,
          newGracePeriodEndsAt,
        },
      },
    });

    res.json({
      gracePeriodDays: parsedDays,
      gracePeriodEndsAt: newGracePeriodEndsAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/admin/tenants/:tenantId/suspend ──────────────────

router.post('/tenants/:tenantId/suspend', async (req, res) => {
  try {
    const tenant = await adminPrisma.tenant.findUnique({
      where: { id: req.params.tenantId },
      select: { id: true },
    });

    if (!tenant) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    await adminPrisma.tenant.update({
      where: { id: req.params.tenantId },
      data: { subscriptionStatus: 'suspended' },
    });

    await adminPrisma.auditLog.create({
      data: {
        tenantId: req.params.tenantId,
        userId: req.user.userId,
        action: 'TENANT_SUSPENDED',
        entityType: 'Tenant',
        entityId: req.params.tenantId,
        metadata: {
          reason: req.body.reason || 'Suspended by admin',
        },
      },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/analytics/cancellations ─────────────────────

router.get('/analytics/cancellations', async (req, res) => {
  try {
    const cancellationLogs = await adminPrisma.auditLog.findMany({
      where: { action: 'SUBSCRIPTION_CANCELLED' },
      select: { metadata: true, createdAt: true, tenantId: true },
      orderBy: { createdAt: 'desc' },
    });

    const byReason = {};
    const byMode = {};
    let total = 0;

    for (const log of cancellationLogs) {
      total++;
      let details;
      try {
        details = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
      } catch {
        continue;
      }

      const reason = details?.reason || 'unknown';
      const mode = details?.mode || 'unknown';

      byReason[reason] = (byReason[reason] || 0) + 1;
      byMode[mode] = (byMode[mode] || 0) + 1;
    }

    res.json({ total, byReason, byMode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
