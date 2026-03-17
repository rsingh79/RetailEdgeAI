import { Router } from 'express';
import { basePrisma } from '../../lib/prisma.js';

const router = Router();

// GET /api/admin/overview/stats — Platform-wide statistics
router.get('/stats', async (_req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    const [totalTenants, trialTenants, lockedTenants, monthlyUsage, activeUsers] =
      await Promise.all([
        basePrisma.tenant.count(),
        basePrisma.tenant.count({
          where: { subscriptionStatus: 'trial', trialEndsAt: { gt: now } },
        }),
        basePrisma.tenant.count({
          where: { isLocked: true },
        }),
        basePrisma.apiUsageLog.aggregate({
          where: { createdAt: { gte: startOfMonth } },
          _sum: { costUsd: true },
          _count: true,
        }),
        basePrisma.apiUsageLog
          .groupBy({
            by: ['userId'],
            where: {
              createdAt: { gte: sevenDaysAgo },
              userId: { not: null },
            },
          })
          .then((groups) => groups.length),
      ]);

    res.json({
      totalTenants,
      trialTenants,
      lockedTenants,
      apiCostMtd: Math.round((monthlyUsage._sum.costUsd || 0) * 100) / 100,
      apiCallsMtd: monthlyUsage._count,
      activeUsers,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/overview/activity — Recent platform activity
router.get('/activity', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    // Get recent access logs (locks, unlocks, registrations)
    const accessLogs = await basePrisma.tenantAccessLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { tenant: { select: { id: true, name: true } } },
    });

    // Get recent tenants (new registrations)
    const recentTenants = await basePrisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, name: true, createdAt: true, plan: true },
    });

    // Merge into unified activity feed
    const activities = [
      ...accessLogs.map((log) => ({
        type: 'access',
        action: log.action,
        tenantId: log.tenant.id,
        tenantName: log.tenant.name,
        reason: log.reason,
        performedBy: log.performedBy,
        timestamp: log.createdAt,
      })),
      ...recentTenants.map((t) => ({
        type: 'tenant_created',
        action: 'REGISTERED',
        tenantId: t.id,
        tenantName: t.name,
        plan: t.plan,
        timestamp: t.createdAt,
      })),
    ];

    // Sort by timestamp descending and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json(activities.slice(0, limit));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
