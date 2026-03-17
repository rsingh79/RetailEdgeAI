import { Router } from 'express';
import { getAuthUrl, pollGmailForInvoices } from '../services/gmail.js';
import { encrypt } from '../lib/encryption.js';

const router = Router();

// GET /api/gmail/status — Check if Gmail is connected for this tenant
router.get('/status', async (req, res) => {
  try {
    const integration = await req.prisma.gmailIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
      select: {
        id: true,
        googleClientId: true,
        email: true,
        isActive: true,
        lastPollAt: true,
        pollIntervalMin: true,
        senderWhitelist: true,
        labelFilter: true,
        createdAt: true,
      },
    });

    if (!integration) {
      return res.json({ connected: false, hasCredentials: false });
    }

    // Has credentials but not yet connected via OAuth?
    const hasCredentials = !!integration.googleClientId;
    const connected = hasCredentials && !!integration.email;

    if (!connected) {
      return res.json({
        connected: false,
        hasCredentials,
        googleClientId: integration.googleClientId || null,
      });
    }

    // Get import stats
    const stats = await req.prisma.gmailImportLog.groupBy({
      by: ['status'],
      _count: true,
    });

    const statsSummary = {};
    for (const s of stats) {
      statsSummary[s.status] = s._count;
    }

    res.json({
      connected: true,
      hasCredentials: true,
      integration: {
        ...integration,
        stats: statsSummary,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/gmail/save-credentials — Save Google Cloud OAuth credentials
router.post('/save-credentials', async (req, res) => {
  try {
    const { googleClientId, googleClientSecret } = req.body;

    if (!googleClientId || !googleClientSecret) {
      return res.status(400).json({ message: 'Both Google Client ID and Client Secret are required.' });
    }

    // Basic format validation
    if (!googleClientId.includes('.apps.googleusercontent.com') && !googleClientId.includes('.apps.google')) {
      return res.status(400).json({ message: 'Invalid Google Client ID format. It should end with .apps.googleusercontent.com' });
    }

    const integration = await req.prisma.gmailIntegration.upsert({
      where: { tenantId: req.user.tenantId },
      create: {
        tenantId: req.user.tenantId,
        googleClientId,
        googleClientSecretEnc: encrypt(googleClientSecret),
      },
      update: {
        googleClientId,
        googleClientSecretEnc: encrypt(googleClientSecret),
      },
    });

    res.json({ saved: true, googleClientId: integration.googleClientId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/gmail/auth-url — Generate Google OAuth consent URL using tenant's stored credentials
router.get('/auth-url', async (req, res) => {
  try {
    const integration = await req.prisma.gmailIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
      select: { googleClientId: true },
    });

    if (!integration?.googleClientId) {
      return res.status(400).json({ message: 'Save your Google Cloud credentials first.' });
    }

    const url = getAuthUrl(req.user.tenantId, integration.googleClientId);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/gmail/configure — Save filters and settings
router.post('/configure', async (req, res) => {
  try {
    const { senderWhitelist, labelFilter, pollIntervalMin } = req.body;

    const integration = await req.prisma.gmailIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Gmail not connected. Connect Gmail first.' });
    }

    const updated = await req.prisma.gmailIntegration.update({
      where: { tenantId: req.user.tenantId },
      data: {
        ...(senderWhitelist !== undefined && { senderWhitelist }),
        ...(labelFilter !== undefined && { labelFilter }),
        ...(pollIntervalMin !== undefined && { pollIntervalMin }),
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/gmail/poll — Manually trigger a Gmail poll
router.post('/poll', async (req, res) => {
  try {
    const integration = await req.prisma.gmailIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Gmail not connected' });
    }

    if (!integration.isActive) {
      return res.status(400).json({ message: 'Gmail integration is paused' });
    }

    const result = await pollGmailForInvoices(
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

// GET /api/gmail/import-logs — View import history
router.get('/import-logs', async (req, res) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [logs, total] = await Promise.all([
      req.prisma.gmailImportLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      req.prisma.gmailImportLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/gmail/disconnect — Remove Gmail integration
router.delete('/disconnect', async (req, res) => {
  try {
    const integration = await req.prisma.gmailIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Gmail not connected' });
    }

    await req.prisma.gmailIntegration.delete({
      where: { tenantId: req.user.tenantId },
    });

    res.json({ message: 'Gmail integration disconnected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
