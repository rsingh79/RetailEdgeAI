import { adminPrisma } from '../lib/prisma.js';

/**
 * Middleware that checks the tenant's subscription status before allowing access.
 *
 * Must run AFTER `authenticate` and `tenantScope` (needs req.user.tenantId).
 * SYSTEM_ADMIN users bypass all subscription checks.
 *
 * Status flow:
 *   trialing/trial → active → past_due → cancelled → suspended
 *
 * Access rules:
 *   - active: full access
 *   - trialing/trial: access if within trial period
 *   - past_due: access if within grace period (with warning header)
 *   - cancelled: access if within billing period
 *   - suspended: no access (403)
 */
export function requireActiveSubscription(req, res, next) {
  // SYSTEM_ADMIN has no tenant — always allowed through
  if (req.user.role === 'SYSTEM_ADMIN') {
    return next();
  }

  if (!req.user.tenantId) {
    return res.status(403).json({ error: 'No tenant context', code: 'NO_TENANT' });
  }

  adminPrisma.tenant
    .findUnique({
      where: { id: req.user.tenantId },
      select: {
        subscriptionStatus: true,
        trialEndsAt: true,
        trialStartedAt: true,
        billingPeriodEnd: true,
        gracePeriodEndsAt: true,
      },
    })
    .then((tenant) => {
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const status = tenant.subscriptionStatus;
      const now = new Date();

      // ── Active subscription: full access ──
      if (status === 'active') {
        return next();
      }

      // ── Trialing: check if trial is still valid ──
      if (status === 'trialing' || status === 'trial') {
        if (tenant.trialEndsAt && now > new Date(tenant.trialEndsAt)) {
          return res.status(403).json({
            error: 'Trial expired',
            code: 'TRIAL_EXPIRED',
            message: 'Your 14-day free trial has ended. Choose a plan to continue using RetailEdgeAI.',
            billingUrl: '/settings/billing',
            trialStarted: tenant.trialStartedAt,
            trialEnded: tenant.trialEndsAt,
          });
        }

        // Trial still active — attach info header for frontend banner
        if (tenant.trialEndsAt) {
          const msRemaining = new Date(tenant.trialEndsAt) - now;
          const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
          res.set(
            'X-Trial-Info',
            JSON.stringify({
              status: 'trialing',
              daysRemaining,
              trialEndsAt: tenant.trialEndsAt,
              urgent: daysRemaining <= 3,
            })
          );
        }
        return next();
      }

      // ── Past due: check grace period ──
      if (status === 'past_due') {
        if (tenant.gracePeriodEndsAt && now > new Date(tenant.gracePeriodEndsAt)) {
          return res.status(403).json({
            error: 'Payment overdue',
            code: 'GRACE_PERIOD_EXPIRED',
            message: 'Your payment is overdue and the grace period has expired. Please update your payment method to restore access.',
            billingUrl: '/settings/billing',
          });
        }

        // Still within grace period — allow with warning
        const daysRemaining = tenant.gracePeriodEndsAt
          ? Math.max(0, Math.ceil((new Date(tenant.gracePeriodEndsAt) - now) / (1000 * 60 * 60 * 24)))
          : null;

        res.set(
          'X-Subscription-Warning',
          JSON.stringify({
            status: 'past_due',
            message: `Your payment is overdue. Please update your payment method within ${daysRemaining} days to avoid service interruption.`,
            gracePeriodEndsAt: tenant.gracePeriodEndsAt,
            billingUrl: '/settings/billing',
          })
        );
        return next();
      }

      // ── Cancelled: check if still within billing period ──
      if (status === 'cancelled') {
        if (tenant.billingPeriodEnd && now < new Date(tenant.billingPeriodEnd)) {
          return next();
        }
        // Past billing period end — access denied
        return res.status(403).json({
          error: 'Subscription expired',
          code: 'SUBSCRIPTION_EXPIRED',
          message: 'Your subscription has ended. Re-subscribe to continue using RetailEdgeAI.',
          billingUrl: '/settings/billing',
        });
      }

      // ── Suspended or any other status: no access ──
      return res.status(403).json({
        error: 'Subscription required',
        code: 'SUBSCRIPTION_INACTIVE',
        message: 'Your subscription is not active. Please update your billing to continue using RetailEdgeAI.',
        billingUrl: '/settings/billing',
      });
    })
    .catch((err) => {
      console.error('Subscription check failed:', err);
      // Fail open on DB errors so a transient failure doesn't lock out tenants
      next();
    });
}
