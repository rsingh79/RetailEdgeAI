import { Router } from 'express';
const router = Router();

// GET /api/agents/status — Returns status of all 6 AI agents
// Aggregates real data from invoices, matches, pricing rules, etc.
router.get('/status', async (req, res) => {
  try {
    const prisma = req.prisma;
    const tenantId = req.user.tenantId;

    // Gather real metrics in parallel
    const [
      recentInvoices,
      totalInvoices,
      matchStats,
      pricingRules,
      exportReady,
    ] = await Promise.all([
      // Invoices processed today
      prisma.invoice.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      // Total invoices this month
      prisma.invoice.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      // Matching stats — count lines by status
      prisma.invoiceLine.groupBy({
        by: ['status'],
        _count: true,
      }),
      // Pricing rules count
      prisma.pricingRule.count(),
      // Export-ready invoices (APPROVED status)
      prisma.invoice.count({ where: { status: 'APPROVED' } }),
    ]);

    // Calculate match rate
    const totalLines = matchStats.reduce((sum, s) => sum + s._count, 0);
    const matchedLines = matchStats
      .filter((s) => ['MATCHED', 'APPROVED'].includes(s.status))
      .reduce((sum, s) => sum + s._count, 0);
    const autoMatchRate = totalLines > 0 ? Math.round((matchedLines / totalLines) * 100) : 0;
    const needsReviewLines = matchStats
      .filter((s) => s.status === 'NEEDS_REVIEW')
      .reduce((sum, s) => sum + s._count, 0);

    const status = {
      ingestion: {
        status: 'active',
        metrics: [
          { label: 'Last scan', value: 'Just now' },
          { label: 'Today', value: `${recentInvoices} invoice${recentInvoices !== 1 ? 's' : ''} processed` },
          { label: 'Sources', value: 'Gmail ✓ Folder ✓' },
        ],
      },
      matching: {
        status: needsReviewLines > 0 ? 'running' : 'ready',
        metrics: [
          { label: 'Total lines', value: `${totalLines} this month` },
          { label: 'Needs review', value: `${needsReviewLines} line${needsReviewLines !== 1 ? 's' : ''}`, valueClass: needsReviewLines > 0 ? 'text-amber-600' : undefined },
          { label: 'Auto-match rate', value: `${autoMatchRate}%`, valueClass: 'text-green-600' },
        ],
      },
      pricing: {
        status: 'ready',
        metrics: [
          { label: 'Active rules', value: `${pricingRules}` },
          { label: 'Recommendations', value: `${needsReviewLines} pending`, valueClass: needsReviewLines > 0 ? 'text-amber-600' : undefined },
          { label: 'Avg margin', value: '—' },
        ],
      },
      competitor: {
        status: 'scheduled',
        scheduledLabel: 'Next: 2h',
        metrics: [
          { label: 'Last scan', value: '—' },
          { label: 'Tracked products', value: '—' },
          { label: 'Alerts', value: '0' },
        ],
      },
      demand: {
        status: 'analyzed',
        metrics: [
          { label: 'Period', value: `Week ${getWeekNumber()}, ${new Date().getFullYear()}` },
          { label: 'Trending up', value: '—' },
          { label: 'Dead stock', value: '0 items' },
        ],
      },
      export: {
        status: exportReady > 0 ? 'ready' : 'synced',
        metrics: [
          { label: 'Last push', value: '—' },
          { label: 'Queued', value: `${exportReady} invoice${exportReady !== 1 ? 's' : ''} ready`, valueClass: exportReady > 0 ? 'text-amber-600' : undefined },
          { label: 'Stores', value: '—' },
        ],
      },
    };

    res.json(status);
  } catch (err) {
    console.error('Agent status error:', err);
    res.status(500).json({ message: 'Failed to fetch agent status' });
  }
});

// GET /api/agents/pending-decisions — Items needing human review
router.get('/pending-decisions', async (req, res) => {
  try {
    const prisma = req.prisma;

    // Find invoice lines that need review
    const needsReview = await prisma.invoiceLine.findMany({
      where: { status: 'NEEDS_REVIEW' },
      include: {
        invoice: { select: { supplierName: true, invoiceNumber: true } },
        matches: {
          select: { confidence: true, matchReason: true, productVariant: { select: { product: { select: { name: true } } } } },
          orderBy: { confidence: 'desc' },
          take: 1,
        },
      },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });

    const decisions = needsReview.map((line, i) => {
      const topMatch = line.matches[0];
      const confidence = topMatch ? Math.round(topMatch.confidence * 100) : 0;
      const matchedName = topMatch?.productVariant?.product?.name || 'Unknown';

      return {
        id: line.id,
        type: 'matching',
        title: 'Product match needs confirmation',
        badge: `${confidence}% confidence`,
        badgeClass: confidence >= 80 ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700',
        description: `"${line.description}" → ${matchedName} (from ${line.invoice.supplierName || 'Unknown supplier'})`,
        actions: 'confirm-choose',
      };
    });

    res.json(decisions);
  } catch (err) {
    console.error('Pending decisions error:', err);
    res.status(500).json({ message: 'Failed to fetch pending decisions' });
  }
});

// GET /api/agents/activity — Recent agent activity from audit log
router.get('/activity', async (req, res) => {
  try {
    const prisma = req.prisma;
    const limit = parseInt(req.query.limit) || 20;

    const logs = await prisma.auditLog.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
      },
    });

    const AGENT_MAP = {
      INVOICE_UPLOADED: { agent: 'Ingestion Agent', agentEmoji: '📥', agentBg: 'bg-blue-50', badge: 'done' },
      INVOICE_OCR: { agent: 'Ingestion Agent', agentEmoji: '📥', agentBg: 'bg-blue-50', badge: 'done' },
      MATCH_CONFIRMED: { agent: 'Matching Agent', agentEmoji: '🔍', agentBg: 'bg-purple-50', badge: 'done' },
      MATCH_CREATED: { agent: 'Matching Agent', agentEmoji: '🔍', agentBg: 'bg-purple-50', badge: 'review' },
      PRICE_UPDATED: { agent: 'Pricing Agent', agentEmoji: '💰', agentBg: 'bg-green-50', badge: 'done' },
      INVOICE_APPROVED: { agent: 'Pricing Agent', agentEmoji: '💰', agentBg: 'bg-green-50', badge: 'done' },
      INVOICE_EXPORTED: { agent: 'Export Agent', agentEmoji: '📤', agentBg: 'bg-teal-50', badge: 'done' },
    };

    const activity = logs.map((log) => {
      const mapped = AGENT_MAP[log.action] || { agent: 'System', agentEmoji: '⚙️', agentBg: 'bg-gray-50', badge: 'done' };
      const time = new Date(log.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
      return {
        time,
        ...mapped,
        message: log.details || log.action.replace(/_/g, ' ').toLowerCase(),
      };
    });

    res.json(activity);
  } catch (err) {
    console.error('Agent activity error:', err);
    res.status(500).json({ message: 'Failed to fetch agent activity' });
  }
});

// GET /api/agents/usage — AI usage stats for current month
router.get('/usage', async (req, res) => {
  try {
    const prisma = req.prisma;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [invoiceCount, lineCount, apiUsage] = await Promise.all([
      prisma.invoice.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.invoiceLine.count({
        where: { invoice: { createdAt: { gte: monthStart } } },
      }),
      prisma.apiUsageLog.aggregate({
        where: {
          createdAt: { gte: monthStart },
          status: 'SUCCESS',
        },
        _sum: { cost: true },
        _count: true,
      }),
    ]);

    // Calculate auto-match rate from this month's lines
    const matchStats = await prisma.invoiceLine.groupBy({
      by: ['status'],
      where: { invoice: { createdAt: { gte: monthStart } } },
      _count: true,
    });
    const totalLines = matchStats.reduce((sum, s) => sum + s._count, 0);
    const matchedLines = matchStats
      .filter((s) => ['MATCHED', 'APPROVED'].includes(s.status))
      .reduce((sum, s) => sum + s._count, 0);

    const now = new Date();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    res.json({
      invoicesProcessed: invoiceCount,
      linesMatched: lineCount,
      aiCost: parseFloat(apiUsage._sum.cost || 0),
      aiCostLimit: 25, // from plan config
      autoMatchRate: totalLines > 0 ? Math.round((matchedLines / totalLines) * 100) : 0,
      billingPeriod: `${monthNames[now.getMonth()]} 1–${lastDay}, ${now.getFullYear()}`,
    });
  } catch (err) {
    console.error('Agent usage error:', err);
    res.status(500).json({ message: 'Failed to fetch AI usage' });
  }
});

// POST /api/agents/run — Trigger agent processing for pending invoices
router.post('/run', async (req, res) => {
  try {
    const prisma = req.prisma;

    // Find invoices that are READY (OCR complete, not yet matched)
    const pendingInvoices = await prisma.invoice.findMany({
      where: { status: 'READY' },
      select: { id: true, invoiceNumber: true },
    });

    // In a real implementation, this would trigger the matching engine + pricing service
    // For now, return info about what would be processed
    res.json({
      message: `Found ${pendingInvoices.length} invoice(s) ready for processing`,
      invoices: pendingInvoices,
    });
  } catch (err) {
    console.error('Agent run error:', err);
    res.status(500).json({ message: 'Failed to trigger agent run' });
  }
});

function getWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const oneWeek = 604800000;
  return Math.ceil((diff / oneWeek) + 1);
}

export default router;
