import { Router } from 'express';
import { basePrisma } from '../../lib/prisma.js';

const router = Router();

// GET /api/admin/api-usage — Aggregated API usage with filters
router.get('/', async (req, res) => {
  try {
    const { tenantId, dateFrom, dateTo, groupBy, model } = req.query;

    // Build filter
    const where = {};
    if (tenantId) where.tenantId = tenantId;
    if (model) where.model = model;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    // Summary metrics
    const summary = await basePrisma.apiUsageLog.aggregate({
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });

    // Per-tenant breakdown
    const tenantBreakdown = await basePrisma.apiUsageLog.groupBy({
      by: ['tenantId'],
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { costUsd: 'desc' } },
    });

    // Get tenant names for the breakdown
    const tenantIds = tenantBreakdown.map((t) => t.tenantId);
    const tenants = await basePrisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const tenantNameMap = {};
    for (const t of tenants) tenantNameMap[t.id] = t.name;

    // Daily cost data for chart (use raw SQL for date grouping)
    // Simplified: get daily aggregation
    const dailyCosts = await basePrisma.apiUsageLog.groupBy({
      by: ['createdAt'],
      where,
      _sum: { costUsd: true },
      _count: true,
      orderBy: { createdAt: 'asc' },
    });

    // Group daily costs by date (strip time)
    const dailyMap = {};
    for (const entry of dailyCosts) {
      const dateKey = new Date(entry.createdAt).toISOString().split('T')[0];
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = { date: dateKey, cost: 0, calls: 0 };
      }
      dailyMap[dateKey].cost += entry._sum.costUsd || 0;
      dailyMap[dateKey].calls += entry._count;
    }

    // Aggregate by the requested groupBy period
    const chartData = Object.values(dailyMap).map((d) => ({
      ...d,
      cost: Math.round(d.cost * 100) / 100,
    }));

    res.json({
      summary: {
        totalCalls: summary._count,
        totalCost: Math.round((summary._sum.costUsd || 0) * 100) / 100,
        totalInputTokens: summary._sum.inputTokens || 0,
        totalOutputTokens: summary._sum.outputTokens || 0,
      },
      tenantBreakdown: tenantBreakdown.map((t) => ({
        tenantId: t.tenantId,
        tenantName: tenantNameMap[t.tenantId] || 'Unknown',
        calls: t._count,
        cost: Math.round((t._sum.costUsd || 0) * 100) / 100,
        inputTokens: t._sum.inputTokens || 0,
        outputTokens: t._sum.outputTokens || 0,
      })),
      chartData,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/api-usage/calls — Individual API call logs
router.get('/calls', async (req, res) => {
  try {
    const { tenantId, dateFrom, dateTo, page, limit: limitParam } = req.query;
    const limit = Math.min(parseInt(limitParam) || 50, 100);
    const skip = ((parseInt(page) || 1) - 1) * limit;

    const where = {};
    if (tenantId) where.tenantId = tenantId;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [calls, total] = await Promise.all([
      basePrisma.apiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      basePrisma.apiUsageLog.count({ where }),
    ]);

    res.json({
      calls,
      pagination: {
        page: parseInt(page) || 1,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/admin/api-usage/calls/:id — Single call detail
router.get('/calls/:id', async (req, res) => {
  try {
    const call = await basePrisma.apiUsageLog.findUnique({
      where: { id: req.params.id },
      include: { tenant: { select: { id: true, name: true } } },
    });

    if (!call) {
      return res.status(404).json({ message: 'API call not found' });
    }

    res.json(call);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
