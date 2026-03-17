import { basePrisma } from '../lib/prisma.js';
import { getPlanLimits } from '../config/plans.js';

/**
 * Middleware that checks if the tenant has exceeded their monthly API call limit.
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
      select: { plan: true, maxApiCallsPerMonth: true },
    });

    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    const limits = getPlanLimits(tenant.plan);
    // Use tenant-specific override if set, else plan default
    const maxCalls = tenant.maxApiCallsPerMonth || limits.maxApiCallsPerMonth;

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
    res.status(500).json({ message: 'API limit check failed' });
  }
}
