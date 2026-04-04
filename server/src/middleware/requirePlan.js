import { adminPrisma } from '../lib/prisma.js';

/**
 * Middleware factory: returns 403 if the tenant's plan tier lacks the required feature.
 * Queries the database for the tenant's tier → features (DB-driven, not hardcoded).
 *
 * SYSTEM_ADMIN users bypass the check.
 *
 * Place AFTER authenticate and tenantAccess in the middleware chain.
 *
 * @param {string} featureKey - Feature key (e.g. 'email_integration', 'competitor_intelligence')
 * @returns {Function} Express middleware
 */
export function requirePlan(featureKey) {
  return async (req, res, next) => {
    // SYSTEM_ADMIN can access everything
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    if (!req.user.tenantId) {
      return res.status(403).json({ message: 'No tenant context' });
    }

    try {
      const tenant = await adminPrisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: {
          plan: true,
          planTierId: true,
          planTier: {
            select: {
              name: true,
              slug: true,
              features: {
                select: {
                  feature: {
                    select: { key: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!tenant) {
        return res.status(404).json({ message: 'Tenant not found' });
      }

      // Check if the feature exists in the tenant's tier
      const enabledKeys = tenant.planTier?.features.map((f) => f.feature.key) || [];
      const hasFeature = enabledKeys.includes(featureKey);

      if (!hasFeature) {
        return res.status(403).json({
          message: 'This feature requires a plan upgrade',
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredFeature: featureKey,
          currentPlan: tenant.planTier?.slug || tenant.plan,
          currentTier: tenant.planTier?.name || null,
        });
      }

      // Attach tier info to request for downstream use
      req.tenantPlan = tenant.planTier?.slug || tenant.plan;
      req.tenantTier = tenant.planTier;
      next();
    } catch (err) {
      console.error('Plan check error:', err);
      res.status(500).json({ message: 'Plan check failed' });
    }
  };
}
