import { basePrisma } from '../lib/prisma.js';
import { planHasFeature } from '../config/plans.js';

/**
 * Middleware factory: returns 403 if the tenant's plan lacks the required feature.
 * SYSTEM_ADMIN users bypass the check.
 *
 * Place AFTER authenticate and tenantAccess in the middleware chain.
 *
 * @param {string} feature - Feature key (e.g. 'gmail_integration', 'competitor_intelligence')
 * @returns {Function} Express middleware
 */
export function requirePlan(feature) {
  return async (req, res, next) => {
    // SYSTEM_ADMIN can access everything
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    if (!req.user.tenantId) {
      return res.status(403).json({ message: 'No tenant context' });
    }

    try {
      const tenant = await basePrisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: { plan: true },
      });

      if (!tenant) {
        return res.status(404).json({ message: 'Tenant not found' });
      }

      if (!planHasFeature(tenant.plan, feature)) {
        return res.status(403).json({
          message: 'This feature requires a plan upgrade',
          code: 'PLAN_UPGRADE_REQUIRED',
          requiredFeature: feature,
          currentPlan: tenant.plan,
        });
      }

      // Attach plan to request for downstream use
      req.tenantPlan = tenant.plan;
      next();
    } catch (err) {
      res.status(500).json({ message: 'Plan check failed' });
    }
  };
}
