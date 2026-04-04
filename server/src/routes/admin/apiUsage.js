import { Router } from 'express';
import { adminPrisma } from '../../lib/prisma.js';

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
    const summary = await adminPrisma.apiUsageLog.aggregate({
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    });

    // Per-tenant breakdown
    const tenantBreakdown = await adminPrisma.apiUsageLog.groupBy({
      by: ['tenantId'],
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { costUsd: 'desc' } },
    });

    // Get tenant names for the breakdown
    const tenantIds = tenantBreakdown.map((t) => t.tenantId);
    const tenants = await adminPrisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const tenantNameMap = {};
    for (const t of tenants) tenantNameMap[t.id] = t.name;

    // Daily cost data for chart (use raw SQL for date grouping)
    // Simplified: get daily aggregation
    const dailyCosts = await adminPrisma.apiUsageLog.groupBy({
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

// Agent-to-display-name mapping (endpoint values → friendly labels)
const AGENT_LABELS = {
  ocr: 'Invoice OCR',
  advisor_tool: 'Business Advisor',
  advisor_stream: 'Business Advisor',
  product_matching: 'Product Matching',
  meta_optimizer: 'Meta Optimizer',
  conflict_detection: 'Conflict Detection',
  prompt_management: 'Prompt Config',
  suggestion_engine: 'Suggestion Engine',
};

// Collapse advisor_tool + advisor_stream into one agent key
function normalizeAgent(endpoint) {
  if (endpoint === 'advisor_tool' || endpoint === 'advisor_stream') return 'advisor';
  return endpoint;
}

// GET /api/admin/api-usage/agents — Per-agent cost breakdown (system-wide + per-tenant)
router.get('/agents', async (req, res) => {
  try {
    const { tenantId, dateFrom, dateTo } = req.query;

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

    // Group by endpoint
    const byEndpoint = await adminPrisma.apiUsageLog.groupBy({
      by: ['endpoint'],
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { costUsd: 'desc' } },
    });

    // Group by endpoint + tenantId (for per-tenant drilldown)
    const byEndpointTenant = await adminPrisma.apiUsageLog.groupBy({
      by: ['endpoint', 'tenantId'],
      where,
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
      orderBy: { _sum: { costUsd: 'desc' } },
    });

    // Get tenant names
    const tenantIds = [...new Set(byEndpointTenant.map((r) => r.tenantId))];
    const tenantsList = await adminPrisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const tenantNameMap = {};
    for (const t of tenantsList) tenantNameMap[t.id] = t.name;

    // Collapse advisor endpoints and build agent summary
    const agentMap = {};
    for (const row of byEndpoint) {
      const agentKey = normalizeAgent(row.endpoint);
      if (!agentMap[agentKey]) {
        agentMap[agentKey] = {
          agentKey,
          label: AGENT_LABELS[row.endpoint] || row.endpoint,
          calls: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
          tenants: {},
        };
      }
      agentMap[agentKey].calls += row._count;
      agentMap[agentKey].cost += row._sum.costUsd || 0;
      agentMap[agentKey].inputTokens += row._sum.inputTokens || 0;
      agentMap[agentKey].outputTokens += row._sum.outputTokens || 0;
    }

    // Build per-tenant breakdown for each agent
    for (const row of byEndpointTenant) {
      const agentKey = normalizeAgent(row.endpoint);
      if (!agentMap[agentKey]) continue;
      const tenantKey = row.tenantId;
      if (!agentMap[agentKey].tenants[tenantKey]) {
        agentMap[agentKey].tenants[tenantKey] = {
          tenantId: tenantKey,
          tenantName: tenantNameMap[tenantKey] || 'Unknown',
          calls: 0,
          cost: 0,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      agentMap[agentKey].tenants[tenantKey].calls += row._count;
      agentMap[agentKey].tenants[tenantKey].cost += row._sum.costUsd || 0;
      agentMap[agentKey].tenants[tenantKey].inputTokens += row._sum.inputTokens || 0;
      agentMap[agentKey].tenants[tenantKey].outputTokens += row._sum.outputTokens || 0;
    }

    // Format output
    const totalCost = Object.values(agentMap).reduce((s, a) => s + a.cost, 0);
    const totalCalls = Object.values(agentMap).reduce((s, a) => s + a.calls, 0);

    const agents = Object.values(agentMap)
      .sort((a, b) => b.cost - a.cost)
      .map((a) => ({
        agentKey: a.agentKey,
        label: a.label,
        calls: a.calls,
        cost: Math.round(a.cost * 100) / 100,
        avgCost: a.calls > 0 ? Math.round((a.cost / a.calls) * 10000) / 10000 : 0,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        pctOfTotal: totalCost > 0 ? Math.round((a.cost / totalCost) * 1000) / 10 : 0,
        tenants: Object.values(a.tenants)
          .sort((x, y) => y.cost - x.cost)
          .map((t) => ({
            ...t,
            cost: Math.round(t.cost * 100) / 100,
            avgCost: t.calls > 0 ? Math.round((t.cost / t.calls) * 10000) / 10000 : 0,
          })),
      }));

    res.json({
      summary: {
        totalCalls,
        totalCost: Math.round(totalCost * 100) / 100,
        avgCostPerCall: totalCalls > 0 ? Math.round((totalCost / totalCalls) * 10000) / 10000 : 0,
        agentCount: agents.length,
      },
      agents,
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
      adminPrisma.apiUsageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { tenant: { select: { id: true, name: true } } },
      }),
      adminPrisma.apiUsageLog.count({ where }),
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
    const call = await adminPrisma.apiUsageLog.findUnique({
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
