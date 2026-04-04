import { adminPrisma } from '../lib/prisma.js';

/**
 * Middleware factory: returns 403 if the tenant has exceeded a usage limit.
 * Queries the tenant's PlanTierLimit for the given limitKey, then calls
 * countFn to get the current usage count.
 *
 * SYSTEM_ADMIN users bypass the check.
 *
 * @param {string} limitKey - Limit key (e.g. 'max_users', 'max_invoice_pages_per_month')
 * @param {Function} countFn - Async function(req, prisma) => number — returns current usage count
 * @returns {Function} Express middleware
 */
export function checkLimit(limitKey, countFn) {
  return async (req, res, next) => {
    // SYSTEM_ADMIN can bypass limits
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    if (!req.user.tenantId) {
      return res.status(403).json({ message: 'No tenant context' });
    }

    try {
      const tenant = await adminPrisma.tenant.findUnique({
        where: { id: req.user.tenantId },
        select: {
          planTierId: true,
          // Fallback legacy fields
          maxUsers: true,
          maxStores: true,
          maxApiCallsPerMonth: true,
        },
      });

      if (!tenant) {
        return res.status(404).json({ message: 'Tenant not found' });
      }

      // Look up the limit from the tier
      let limitValue = null;

      if (tenant.planTierId) {
        const tierLimit = await adminPrisma.planTierLimit.findUnique({
          where: {
            planTierId_limitKey: {
              planTierId: tenant.planTierId,
              limitKey,
            },
          },
        });
        if (tierLimit) {
          limitValue = tierLimit.limitValue;
        }
      }

      // Fallback to legacy tenant fields if no tier limit found
      if (limitValue === null) {
        const legacyMap = {
          max_users: tenant.maxUsers,
          max_stores: tenant.maxStores,
          max_invoice_pages_per_month: tenant.maxApiCallsPerMonth,
        };
        limitValue = legacyMap[limitKey];
      }

      // If no limit found at all, allow through (uncapped)
      if (limitValue === null || limitValue === undefined) {
        return next();
      }

      // Count current usage
      const used = await countFn(req, adminPrisma);

      if (used >= limitValue) {
        return res.status(403).json({
          message: `Usage limit reached for ${limitKey.replace(/_/g, ' ')}`,
          code: 'LIMIT_REACHED',
          limitKey,
          used,
          limit: limitValue,
        });
      }

      // Attach usage info for downstream use
      req.limitUsage = { ...req.limitUsage, [limitKey]: { used, limit: limitValue } };
      next();
    } catch (err) {
      console.error('Limit check error:', err);
      res.status(500).json({ message: 'Limit check failed' });
    }
  };
}
