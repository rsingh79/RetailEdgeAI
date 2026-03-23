import { Router } from 'express';
import { basePrisma } from '../lib/prisma.js';
import { getEffectivePrompt, getGenericConditions, invalidatePromptCache } from '../services/promptComposer.js';
import { detectConflicts, getUnresolvedConflicts } from '../services/promptConflictDetector.js';
import { runValidator } from '../services/promptValidators.js';
import { resolveConflict } from '../services/promptChatAgent.js';

const router = Router();

// GET /api/prompts/agents — list agents available to this tenant
router.get('/agents', async (req, res) => {
  try {
    const agents = await basePrisma.agentType.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(agents);
  } catch (err) {
    console.error('Error listing agents:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// GET /api/prompts/agents/:key/conditions — generic conditions + tenant overrides
router.get('/agents/:key/conditions', async (req, res) => {
  try {
    const effective = await getEffectivePrompt(req.params.key, req.tenantId);
    if (!effective) return res.status(404).json({ error: 'No active template found' });

    const genericConditions = await getGenericConditions(req.params.key);

    const overrides = await basePrisma.tenantPromptOverride.findMany({
      where: {
        tenantId: req.tenantId,
        agentTypeKey: req.params.key,
        isActive: true,
      },
      orderBy: { orderIndex: 'asc' },
    });

    res.json({
      genericConditions,
      tenantOverrides: overrides,
      effectiveConditions: effective.conditions,
      effectivePrompt: effective.prompt,
    });
  } catch (err) {
    console.error('Error getting conditions:', err);
    res.status(500).json({ error: 'Failed to get conditions' });
  }
});

// POST /api/prompts/agents/:key/overrides — add a tenant override
router.post('/agents/:key/overrides', async (req, res) => {
  try {
    const { action, conditionKey, customText, category } = req.body;

    if (!action || !['add', 'remove', 'replace'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be add, remove, or replace.' });
    }

    let condition = null;
    if (conditionKey && (action === 'remove' || action === 'replace')) {
      const genericConditions = await getGenericConditions(req.params.key);
      condition = genericConditions.find((c) => c.key === conditionKey);
      if (!condition) {
        return res.status(404).json({ error: `Condition "${conditionKey}" not found.` });
      }

      // Check required flag
      if (condition.isRequired && action === 'remove') {
        return res.status(403).json({
          error: `Cannot remove "${conditionKey}" — it is a required condition.`,
        });
      }

      // Run validator for removals
      if (action === 'remove' && condition.validationKey) {
        const validation = await runValidator(condition.validationKey, req.prisma);
        if (!validation.passed) {
          return res.status(409).json({
            error: validation.message,
            validationFailed: true,
          });
        }
      }
    }

    // Detect conflicts for adds/replaces
    let conflicts = [];
    if (customText && (action === 'add' || action === 'replace')) {
      conflicts = await detectConflicts(
        req.params.key,
        customText,
        req.tenantId,
        condition?.id || null,
      );
    }

    const override = await basePrisma.tenantPromptOverride.create({
      data: {
        tenantId: req.tenantId,
        promptConditionId: condition?.id || null,
        agentTypeKey: req.params.key,
        action,
        customText: customText || null,
        category: category || condition?.category || 'rule',
        isActive: true,
        createdBy: req.user?.id || null,
      },
    });

    // Log the change
    await basePrisma.promptChangeLog.create({
      data: {
        tenantId: req.tenantId,
        userId: req.user?.id || null,
        agentTypeKey: req.params.key,
        changeType: `${action}_override`,
        conditionKey: conditionKey || null,
        previousText: condition?.text || null,
        newText: customText || null,
        reason: req.body.reason || `User ${action}ed a condition via API`,
      },
    });

    invalidatePromptCache(req.params.key, req.tenantId);

    res.status(201).json({
      override,
      conflicts,
      hasConflicts: conflicts.length > 0,
    });
  } catch (err) {
    console.error('Error creating override:', err);
    res.status(500).json({ error: 'Failed to create override' });
  }
});

// PUT /api/prompts/overrides/:id — update an override
router.put('/overrides/:id', async (req, res) => {
  try {
    const existing = await basePrisma.tenantPromptOverride.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Override not found' });
    }

    const { customText, isActive } = req.body;

    const updated = await basePrisma.tenantPromptOverride.update({
      where: { id: req.params.id },
      data: {
        ...(customText !== undefined && { customText }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    invalidatePromptCache(existing.agentTypeKey, req.tenantId);
    res.json(updated);
  } catch (err) {
    console.error('Error updating override:', err);
    res.status(500).json({ error: 'Failed to update override' });
  }
});

// DELETE /api/prompts/overrides/:id — revert to generic
router.delete('/overrides/:id', async (req, res) => {
  try {
    const existing = await basePrisma.tenantPromptOverride.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.tenantId !== req.tenantId) {
      return res.status(404).json({ error: 'Override not found' });
    }

    await basePrisma.tenantPromptOverride.delete({
      where: { id: req.params.id },
    });

    // Log the revert
    await basePrisma.promptChangeLog.create({
      data: {
        tenantId: req.tenantId,
        userId: req.user?.id || null,
        agentTypeKey: existing.agentTypeKey,
        changeType: 'revert',
        conditionKey: null,
        previousText: existing.customText,
        newText: null,
        reason: 'User reverted override to generic default',
      },
    });

    invalidatePromptCache(existing.agentTypeKey, req.tenantId);
    res.json({ message: 'Override removed, reverted to generic.' });
  } catch (err) {
    console.error('Error deleting override:', err);
    res.status(500).json({ error: 'Failed to delete override' });
  }
});

// GET /api/prompts/conflicts — tenant's unresolved conflicts
router.get('/conflicts', async (req, res) => {
  try {
    const conflicts = await getUnresolvedConflicts(req.tenantId);
    res.json(conflicts);
  } catch (err) {
    console.error('Error listing conflicts:', err);
    res.status(500).json({ error: 'Failed to list conflicts' });
  }
});

// POST /api/prompts/conflicts/:id/resolve — resolve a conflict
router.post('/conflicts/:id/resolve', async (req, res) => {
  try {
    const { resolution, mergeText } = req.body;

    if (!resolution || !['keep_generic', 'keep_tenant', 'merge'].includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution. Must be keep_generic, keep_tenant, or merge.' });
    }

    if (resolution === 'merge' && !mergeText) {
      return res.status(400).json({ error: 'mergeText is required for merge resolution.' });
    }

    const result = await resolveConflict(
      req.params.id,
      resolution,
      req.tenantId,
      req.user?.id,
      mergeText,
    );

    if (!result.success) {
      return res.status(409).json({ error: result.message });
    }

    res.json(result);
  } catch (err) {
    console.error('Error resolving conflict:', err);
    res.status(500).json({ error: 'Failed to resolve conflict' });
  }
});

// GET /api/prompts/change-log — tenant's prompt change audit trail
router.get('/change-log', async (req, res) => {
  try {
    const logs = await basePrisma.promptChangeLog.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
      take: parseInt(req.query.limit) || 50,
    });
    res.json(logs);
  } catch (err) {
    console.error('Error listing change log:', err);
    res.status(500).json({ error: 'Failed to list change log' });
  }
});

export default router;
