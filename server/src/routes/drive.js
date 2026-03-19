import { Router } from 'express';
import {
  getDriveAuthUrl,
  getDriveValidAccessToken,
  listDriveFolders,
  pollDriveForInvoices,
} from '../services/drive.js';
import { encrypt } from '../lib/encryption.js';

const router = Router();

// GET /api/drive/status — List all connected Drive folders for this tenant
router.get('/status', async (req, res) => {
  try {
    const integrations = await req.prisma.driveIntegration.findMany({
      where: { tenantId: req.user.tenantId, driveFolderId: { not: '__pending__' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        googleClientId: true,
        driveFolderId: true,
        driveFolderName: true,
        lastPollAt: true,
        pollIntervalMin: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Get import stats
    const stats = await req.prisma.driveImportLog.groupBy({
      by: ['status'],
      _count: true,
    });
    const statsSummary = {};
    for (const s of stats) {
      statsSummary[s.status] = s._count;
    }

    // Check if there's a pending OAuth (tokens saved but no folder selected yet)
    const pending = await req.prisma.driveIntegration.findFirst({
      where: { tenantId: req.user.tenantId, driveFolderId: '__pending__' },
      select: { id: true, email: true, googleClientId: true },
    });

    res.json({
      connected: integrations.length > 0,
      integrations,
      stats: statsSummary,
      pendingOAuth: pending || null,
      hasCredentials: !!(pending?.googleClientId || integrations.some(i => i.googleClientId)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/drive/save-credentials — Save Google Cloud OAuth credentials (per-tenant)
router.post('/save-credentials', async (req, res) => {
  try {
    const { googleClientId, googleClientSecret } = req.body;

    if (!googleClientId || !googleClientSecret) {
      return res.status(400).json({ message: 'Both Google Client ID and Client Secret are required.' });
    }

    if (!googleClientId.includes('.apps.googleusercontent.com') && !googleClientId.includes('.apps.google')) {
      return res.status(400).json({ message: 'Invalid Google Client ID format. It should end with .apps.googleusercontent.com' });
    }

    const tenantId = req.user.tenantId;

    // Find existing pending integration, or create one
    const existing = await req.prisma.driveIntegration.findFirst({
      where: { tenantId, driveFolderId: '__pending__' },
    });

    let integration;
    if (existing) {
      integration = await req.prisma.driveIntegration.update({
        where: { id: existing.id },
        data: {
          googleClientId,
          googleClientSecretEnc: encrypt(googleClientSecret),
        },
      });
    } else {
      integration = await req.prisma.driveIntegration.create({
        data: {
          tenantId,
          googleClientId,
          googleClientSecretEnc: encrypt(googleClientSecret),
          driveFolderId: '__pending__',
          isActive: false,
        },
      });
    }

    res.json({
      saved: true,
      integrationId: integration.id,
      googleClientId: integration.googleClientId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/drive/auth-url — Generate OAuth consent URL using tenant's stored credentials
router.get('/auth-url', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;

    // Look up tenant's stored credentials — check pending first, then existing integrations
    let googleClientId;
    const pending = await req.prisma.driveIntegration.findFirst({
      where: { tenantId, driveFolderId: '__pending__' },
      select: { googleClientId: true },
    });

    if (pending?.googleClientId) {
      googleClientId = pending.googleClientId;
    } else {
      // Auto-create pending record by copying credentials from an existing integration
      const existingWithCreds = await req.prisma.driveIntegration.findFirst({
        where: { tenantId, driveFolderId: { not: '__pending__' }, googleClientId: { not: null } },
        select: { googleClientId: true, googleClientSecretEnc: true },
      });

      if (existingWithCreds) {
        await req.prisma.driveIntegration.create({
          data: {
            tenantId,
            googleClientId: existingWithCreds.googleClientId,
            googleClientSecretEnc: existingWithCreds.googleClientSecretEnc,
            driveFolderId: '__pending__',
            isActive: false,
          },
        });
        googleClientId = existingWithCreds.googleClientId;
      }
    }

    if (!googleClientId) {
      return res.status(400).json({ message: 'Save your Google Cloud credentials first.' });
    }

    const url = getDriveAuthUrl(tenantId, googleClientId);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/drive/folders — List folders in Google Drive
router.get('/folders', async (req, res) => {
  try {
    const { parentId = 'root', integrationId } = req.query;

    // Find an integration with tokens (either a specific one or the pending one)
    let integration;
    if (integrationId) {
      integration = await req.prisma.driveIntegration.findUnique({
        where: { id: integrationId },
      });
    } else {
      // Use the pending OAuth or the most recent integration
      integration = await req.prisma.driveIntegration.findFirst({
        where: { tenantId: req.user.tenantId, accessTokenEnc: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!integration?.accessTokenEnc) {
      return res.status(400).json({ message: 'Connect Google Drive first.' });
    }

    const accessToken = await getDriveValidAccessToken(req.prisma, integration);
    const folders = await listDriveFolders(accessToken, parentId);

    res.json({ folders, parentId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/drive/add-folder — Save a Drive folder as a new watched integration
router.post('/add-folder', async (req, res) => {
  try {
    const { driveFolderId, driveFolderName, pollIntervalMin } = req.body;

    if (!driveFolderId) {
      return res.status(400).json({ message: 'Drive folder ID is required.' });
    }

    if (pollIntervalMin !== undefined && pollIntervalMin < 15) {
      return res.status(400).json({ message: 'Poll interval must be at least 15 minutes.' });
    }

    // Check for duplicate folder
    const existing = await req.prisma.driveIntegration.findFirst({
      where: { tenantId: req.user.tenantId, driveFolderId, driveFolderId: { not: '__pending__' } },
    });
    if (existing) {
      return res.status(409).json({ message: 'This folder is already being watched.' });
    }

    // Find the pending OAuth record (has tokens but no folder yet)
    const pending = await req.prisma.driveIntegration.findFirst({
      where: { tenantId: req.user.tenantId, driveFolderId: '__pending__' },
    });

    if (!pending?.accessTokenEnc) {
      return res.status(400).json({ message: 'Please connect Google Drive first.' });
    }

    // Update the pending record with the selected folder
    const integration = await req.prisma.driveIntegration.update({
      where: { id: pending.id },
      data: {
        driveFolderId,
        driveFolderName: driveFolderName || driveFolderId,
        isActive: true,
        ...(pollIntervalMin !== undefined && { pollIntervalMin }),
      },
    });

    res.json({ saved: true, integration });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/drive/:integrationId/poll — Manually trigger poll for one folder
router.post('/:integrationId/poll', async (req, res) => {
  try {
    const integration = await req.prisma.driveIntegration.findUnique({
      where: { id: req.params.integrationId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Drive integration not found' });
    }

    if (!integration.isActive) {
      return res.status(400).json({ message: 'This Drive integration is paused' });
    }

    const result = await pollDriveForInvoices(
      req.prisma,
      integration,
      req.user.tenantId,
      req.user.userId
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/drive/poll-all — Poll all active Drive folders
router.post('/poll-all', async (req, res) => {
  try {
    const integrations = await req.prisma.driveIntegration.findMany({
      where: { tenantId: req.user.tenantId, isActive: true, driveFolderId: { not: '__pending__' } },
    });

    if (integrations.length === 0) {
      return res.status(404).json({ message: 'No active Drive folders configured' });
    }

    const results = [];
    for (const integration of integrations) {
      try {
        const result = await pollDriveForInvoices(
          req.prisma,
          integration,
          req.user.tenantId,
          req.user.userId
        );
        results.push({ folderId: integration.driveFolderId, folderName: integration.driveFolderName, ...result });
      } catch (err) {
        results.push({ folderId: integration.driveFolderId, folderName: integration.driveFolderName, error: err.message });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/drive/import-logs — View import history across all Drive folders
router.get('/import-logs', async (req, res) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [logs, total] = await Promise.all([
      req.prisma.driveImportLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      req.prisma.driveImportLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/drive/:integrationId/disconnect — Remove one Drive folder integration
router.delete('/:integrationId/disconnect', async (req, res) => {
  try {
    const integration = await req.prisma.driveIntegration.findUnique({
      where: { id: req.params.integrationId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Drive integration not found' });
    }

    await req.prisma.driveIntegration.delete({
      where: { id: req.params.integrationId },
    });

    res.json({ message: 'Drive folder disconnected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
