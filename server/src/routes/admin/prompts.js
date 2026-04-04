import { Router } from 'express';
import { adminPrisma } from '../../lib/prisma.js';
import { getEffectivePrompt, getGenericConditions, invalidateAllForAgent } from '../../services/promptComposer.js';

const router = Router();

// GET /api/admin/prompts/agents — list all agent types
router.get('/agents', async (req, res) => {
  try {
    const agents = await adminPrisma.agentType.findMany({
      orderBy: { createdAt: 'asc' },
    });
    res.json(agents);
  } catch (err) {
    console.error('Error listing agents:', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// GET /api/admin/prompts/agents/:key — agent + active template + conditions
router.get('/agents/:key', async (req, res) => {
  try {
    const agent = await adminPrisma.agentType.findUnique({
      where: { key: req.params.key },
      include: {
        promptTemplates: {
          where: { isActive: true },
          include: {
            conditions: { orderBy: { orderIndex: 'asc' } },
          },
        },
      },
    });

    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    console.error('Error getting agent:', err);
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

// POST /api/admin/prompts/agents/:key/versions — create new template version
router.post('/agents/:key/versions', async (req, res) => {
  try {
    const agent = await adminPrisma.agentType.findUnique({
      where: { key: req.params.key },
    });
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    // Deactivate current active template
    await adminPrisma.promptTemplate.updateMany({
      where: { agentTypeId: agent.id, isActive: true },
      data: { isActive: false },
    });

    // Get next version number
    const maxVersion = await adminPrisma.promptTemplate.aggregate({
      where: { agentTypeId: agent.id },
      _max: { version: true },
    });
    const nextVersion = (maxVersion._max.version || 0) + 1;

    const { preamble, postamble, conditions } = req.body;

    const template = await adminPrisma.promptTemplate.create({
      data: {
        agentTypeId: agent.id,
        version: nextVersion,
        preamble,
        postamble: postamble || null,
        isActive: true,
        createdBy: req.user?.id || null,
        conditions: {
          create: (conditions || []).map((c, i) => ({
            orderIndex: c.orderIndex ?? i + 1,
            category: c.category || 'rule',
            key: c.key,
            text: c.text,
            isRequired: c.isRequired || false,
            validationKey: c.validationKey || null,
            validationDesc: c.validationDesc || null,
          })),
        },
      },
      include: { conditions: true },
    });

    // Invalidate cache for all tenants using this agent
    invalidateAllForAgent(req.params.key);

    res.status(201).json(template);
  } catch (err) {
    console.error('Error creating template version:', err);
    res.status(500).json({ error: 'Failed to create template version' });
  }
});

// PUT /api/admin/prompts/conditions/:id — update a condition
router.put('/conditions/:id', async (req, res) => {
  try {
    const { text, category, isRequired, validationKey, validationDesc, orderIndex } = req.body;

    const condition = await adminPrisma.promptCondition.update({
      where: { id: req.params.id },
      data: {
        ...(text !== undefined && { text }),
        ...(category !== undefined && { category }),
        ...(isRequired !== undefined && { isRequired }),
        ...(validationKey !== undefined && { validationKey }),
        ...(validationDesc !== undefined && { validationDesc }),
        ...(orderIndex !== undefined && { orderIndex }),
      },
    });

    res.json(condition);
  } catch (err) {
    console.error('Error updating condition:', err);
    res.status(500).json({ error: 'Failed to update condition' });
  }
});

// GET /api/admin/prompts/tenants/:tenantId/:agentKey — preview tenant's effective prompt
router.get('/tenants/:tenantId/:agentKey', async (req, res) => {
  try {
    const effective = await getEffectivePrompt(req.params.agentKey, req.params.tenantId);
    if (!effective) return res.status(404).json({ error: 'No active template found' });

    const overrides = await adminPrisma.tenantPromptOverride.findMany({
      where: {
        tenantId: req.params.tenantId,
        agentTypeKey: req.params.agentKey,
        isActive: true,
      },
    });

    res.json({ ...effective, overrides });
  } catch (err) {
    console.error('Error previewing tenant prompt:', err);
    res.status(500).json({ error: 'Failed to preview tenant prompt' });
  }
});

// GET /api/admin/prompts/tenants/:tenantId/overrides — list all overrides for a tenant
router.get('/tenants/:tenantId/overrides', async (req, res) => {
  try {
    const overrides = await adminPrisma.tenantPromptOverride.findMany({
      where: { tenantId: req.params.tenantId },
      include: { promptCondition: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(overrides);
  } catch (err) {
    console.error('Error listing overrides:', err);
    res.status(500).json({ error: 'Failed to list overrides' });
  }
});

// GET /api/admin/prompts/conflicts — unresolved conflicts (all tenants)
router.get('/conflicts', async (req, res) => {
  try {
    const conflicts = await adminPrisma.promptConflict.findMany({
      where: { resolution: null },
      include: { promptCondition: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(conflicts);
  } catch (err) {
    console.error('Error listing conflicts:', err);
    res.status(500).json({ error: 'Failed to list conflicts' });
  }
});

// GET /api/admin/prompts/change-log/:tenantId — prompt change history for a tenant
router.get('/change-log/:tenantId', async (req, res) => {
  try {
    const logs = await adminPrisma.promptChangeLog.findMany({
      where: { tenantId: req.params.tenantId },
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
