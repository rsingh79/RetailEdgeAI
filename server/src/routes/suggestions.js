/**
 * Suggestion Engine API routes.
 *
 * Tenant routes: view/manage suggestions for their own tenant.
 * Admin routes are in admin/suggestions.js.
 */
import { Router } from 'express';
import { runSuggestionEngine, curateExamples } from '../services/suggestionEngine.js';

const router = Router();

// ── GET /suggestions — List suggestions for this tenant ──
router.get('/', async (req, res) => {
  try {
    const { status, agentRoleKey, limit = 20 } = req.query;

    const where = { tenantId: req.tenantId };
    if (status) where.status = status;

    // If agentRoleKey provided, resolve to ID
    if (agentRoleKey) {
      const role = await req.prisma.agentType.findFirst({ where: { key: agentRoleKey } });
      if (role) where.agentRoleId = role.id;
    }

    const suggestions = await req.prisma.promptSuggestion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });

    // Note: PromptSuggestion uses basePrisma in the engine, but tenant-scoped
    // queries won't work unless we use basePrisma directly
    // Fallback to basePrisma for this read
    const results = suggestions.length > 0 ? suggestions : await (async () => {
      const { basePrisma } = await import('../lib/prisma.js');
      return basePrisma.promptSuggestion.findMany({
        where: { tenantId: req.tenantId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit),
      });
    })();

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /suggestions/analyze — Trigger suggestion engine for this tenant ──
router.post('/analyze', async (req, res) => {
  try {
    const { agentRoleKey, windowDays = 14, dryRun = false } = req.body;

    if (!agentRoleKey) {
      return res.status(400).json({ error: 'agentRoleKey is required' });
    }

    const result = await runSuggestionEngine({
      tenantId: req.tenantId,
      agentRoleKey,
      windowDays,
      dryRun,
    });

    // Also auto-curate few-shot examples
    let examples = [];
    if (!dryRun) {
      try {
        examples = await curateExamples({
          tenantId: req.tenantId,
          agentRoleKey,
          windowDays,
        });
      } catch (err) {
        console.warn('Few-shot curation failed:', err.message);
      }
    }

    res.json({
      ...result,
      examplesCurated: examples.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /suggestions/:id/review — Approve or reject a suggestion ──
router.post('/:id/review', async (req, res) => {
  try {
    const { action, notes } = req.body; // action: "approved" | "rejected"

    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approved" or "rejected"' });
    }

    const { basePrisma } = await import('../lib/prisma.js');

    const suggestion = await basePrisma.promptSuggestion.findFirst({
      where: { id: req.params.id, tenantId: req.tenantId },
    });

    if (!suggestion) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    if (suggestion.status !== 'pending') {
      return res.status(400).json({ error: `Suggestion already ${suggestion.status}` });
    }

    const updated = await basePrisma.promptSuggestion.update({
      where: { id: req.params.id },
      data: {
        status: action,
        reviewedBy: req.user.id,
        reviewedAt: new Date(),
        reviewNotes: notes || null,
        ...(action === 'approved' ? { appliedAt: new Date() } : {}),
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /suggestions/stats — Suggestion summary stats ──
router.get('/stats', async (req, res) => {
  try {
    const { basePrisma } = await import('../lib/prisma.js');

    const [pending, approved, rejected, total] = await Promise.all([
      basePrisma.promptSuggestion.count({ where: { tenantId: req.tenantId, status: 'pending' } }),
      basePrisma.promptSuggestion.count({ where: { tenantId: req.tenantId, status: 'approved' } }),
      basePrisma.promptSuggestion.count({ where: { tenantId: req.tenantId, status: 'rejected' } }),
      basePrisma.promptSuggestion.count({ where: { tenantId: req.tenantId } }),
    ]);

    res.json({ pending, approved, rejected, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
