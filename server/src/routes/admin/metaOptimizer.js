/**
 * Admin routes for the Meta-Optimization Agent.
 * Platform-level endpoints — only accessible by SYSTEM_ADMIN role.
 */
import { Router } from 'express';
import {
  runMetaOptimizer,
  runForAllRoles,
  activateCandidateVersion,
  rollbackVersion,
} from '../../services/metaOptimizer.js';
import { basePrisma } from '../../lib/prisma.js';

const router = Router();

// ── POST /run — Trigger meta-optimizer for a specific agent role ──
router.post('/run', async (req, res) => {
  try {
    const { agentRoleKey, windowDays = 30, dryRun = false } = req.body;

    if (!agentRoleKey) {
      return res.status(400).json({ error: 'agentRoleKey is required' });
    }

    const result = await runMetaOptimizer({ agentRoleKey, windowDays, dryRun });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /run-all — Trigger meta-optimizer for all agent roles ──
router.post('/run-all', async (req, res) => {
  try {
    const { windowDays = 30, dryRun = false } = req.body;
    const results = await runForAllRoles({ windowDays, dryRun });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /candidates — List candidate versions awaiting approval ──
router.get('/candidates', async (req, res) => {
  try {
    const candidates = await basePrisma.promptBaseVersion.findMany({
      where: { isActive: false, createdBy: 'meta_agent' },
      include: {
        agentRole: { select: { key: true, name: true } },
        parentVersion: { select: { versionNumber: true, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    res.json(candidates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /candidates/:id/activate — Activate a candidate version ──
router.post('/candidates/:id/activate', async (req, res) => {
  try {
    const { canaryMode = true } = req.body;
    const result = await activateCandidateVersion(
      req.params.id,
      req.user.id || req.user.userId,
      { canaryMode }
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /versions/:id/rollback — Rollback a version ──
router.post('/versions/:id/rollback', async (req, res) => {
  try {
    const result = await rollbackVersion(
      req.params.id,
      req.user.id || req.user.userId
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /audit — Cross-tenant audit log ──
router.get('/audit', async (req, res) => {
  try {
    const { agentRoleKey, limit = 50 } = req.query;

    const where = { tenantId: null }; // global actions only
    if (agentRoleKey) {
      const role = await basePrisma.agentRole.findUnique({ where: { key: agentRoleKey } });
      if (role) where.agentRoleId = role.id;
    }

    const logs = await basePrisma.promptAuditLog.findMany({
      where,
      include: {
        agentRole: { select: { key: true, name: true } },
        baseVersion: { select: { versionNumber: true } },
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit),
    });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /versions/:agentRoleKey — List all versions for an agent role ──
router.get('/versions/:agentRoleKey', async (req, res) => {
  try {
    const role = await basePrisma.agentRole.findUnique({
      where: { key: req.params.agentRoleKey },
    });
    if (!role) return res.status(404).json({ error: 'Agent role not found' });

    const versions = await basePrisma.promptBaseVersion.findMany({
      where: { agentRoleId: role.id },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        isActive: true,
        parentVersionId: true,
        changeReason: true,
        performanceSnapshot: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
