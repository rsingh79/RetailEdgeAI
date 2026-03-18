import { basePrisma } from '../lib/prisma.js';

/**
 * Middleware that checks if the tenant has exceeded their monthly API call limit.
 * Reads the limit from PlanTierLimit (DB-driven), with fallback to legacy tenant fields.
 * Returns 429 if the limit is reached.
 *
 * Place AFTER authenticate and tenantAccess. Only needed on routes that consume
 * AI/OCR API calls (invoice upload, competitor AI recommendation, etc.).
 *
 * SYSTEM_ADMIN users bypass the check.
 */
export async function checkApiLimit(req, res, next) {
  if (req.user.role === 'SYSTEM_ADMIN') return next();

  if (!req.user.tenantId) {
    return res.status(403).json({ message: 'No tenant context' });
  }

  try {
    const tenant = await basePrisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: {
        plan: true,
        planTierId: true,
        maxApiCallsPerMonth: true,
      },
    });

    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    // Get the limit from DB tier, fallback to legacy tenant field
    let maxCalls = tenant.maxApiCallsPerMonth || 100;

    if (tenant.planTierId) {
      const tierLimit = await basePrisma.planTierLimit.findUnique({
        where: {
          planTierId_limitKey: {
            planTierId: tenant.planTierId,
            limitKey: 'max_invoice_pages_per_month',
          },
        },
      });
      if (tierLimit) {
        maxCalls = tierLimit.limitValue;
      }
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const callCount = await basePrisma.apiUsageLog.count({
      where: {
        tenantId: req.user.tenantId,
        createdAt: { gte: startOfMonth },
        status: 'success',
      },
    });

    if (callCount >= maxCalls) {
      return res.status(429).json({
        message: 'Monthly API call limit reached',
        code: 'API_LIMIT_REACHED',
        used: callCount,
        limit: maxCalls,
        plan: tenant.plan,
      });
    }

    // Attach usage info for downstream use
    req.apiUsage = { used: callCount, limit: maxCalls };
    next();
  } catch (err) {
    console.error('API limit check error:', err);
    res.status(500).json({ message: 'API limit check failed' });
  }
}
