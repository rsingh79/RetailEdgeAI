import { Router } from 'express';
import { getAuthUrl, pollGmailForInvoices } from '../services/gmail.js';
import { testImapConnection, pollImapForInvoices } from '../services/imap.js';
import { encrypt } from '../lib/encryption.js';

const router = Router();

// GET /api/gmail/status — List all Gmail integrations for this tenant
router.get('/status', async (req, res) => {
  try {
    const integrations = await req.prisma.gmailIntegration.findMany({
      where: { tenantId: req.user.tenantId },
      select: {
        id: true,
        connectionType: true,
        googleClientId: true,
        email: true,
        isActive: true,
        lastPollAt: true,
        pollIntervalMin: true,
        initialLookbackDays: true,
        senderWhitelist: true,
        labelFilter: true,
        createdAt: true,
        imapEmail: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get import stats for this tenant
    const stats = await req.prisma.gmailImportLog.groupBy({
      by: ['status'],
      _count: true,
    });

    const statsSummary = {};
    for (const s of stats) {
      statsSummary[s.status] = s._count;
    }

    // Backward-compatible: also return first integration as `integration`
    const connected = integrations.length > 0;
    const firstIntegration = integrations[0] || null;

    res.json({
      connected,
      hasCredentials: connected,
      connectionType: firstIntegration?.connectionType || null,
      integration: firstIntegration ? { ...firstIntegration, stats: statsSummary } : null,
      // New: array of all integrations
      integrations: integrations.map((i) => ({
        ...i,
        displayEmail: i.connectionType === 'imap' ? i.imapEmail : i.email,
      })),
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

    if (!googleClientId.includes('.apps.googleusercontent.com') && !googleClientId.includes('.apps.google')) {
      return res.status(400).json({ message: 'Invalid Google Client ID format. It should end with .apps.googleusercontent.com' });
    }

    // For OAuth, create a new integration (or find existing by tenant + null imapEmail)
    const existing = await req.prisma.gmailIntegration.findFirst({
      where: { tenantId: req.user.tenantId, connectionType: 'oauth', imapEmail: null },
    });

    let integration;
    if (existing) {
      integration = await req.prisma.gmailIntegration.update({
        where: { id: existing.id },
        data: { googleClientId, googleClientSecretEnc: encrypt(googleClientSecret) },
      });
    } else {
      integration = await req.prisma.gmailIntegration.create({
        data: {
          tenantId: req.user.tenantId,
          googleClientId,
          googleClientSecretEnc: encrypt(googleClientSecret),
        },
      });
    }

    res.json({ saved: true, integrationId: integration.id, googleClientId: integration.googleClientId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/gmail/auth-url — Generate Google OAuth consent URL using tenant's stored credentials
router.get('/auth-url', async (req, res) => {
  try {
    const integration = await req.prisma.gmailIntegration.findFirst({
      where: { tenantId: req.user.tenantId, connectionType: 'oauth' },
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

// POST /api/gmail/configure — Save filters and settings for a specific integration
router.post('/configure', async (req, res) => {
  try {
    const { integrationId, senderWhitelist, labelFilter, pollIntervalMin, initialLookbackDays } = req.body;

    if (pollIntervalMin !== undefined && pollIntervalMin < 15) {
      return res.status(400).json({ message: 'Poll interval must be at least 15 minutes.' });
    }

    if (initialLookbackDays !== undefined && (initialLookbackDays < 1 || initialLookbackDays > 90)) {
      return res.status(400).json({ message: 'Initial lookback must be between 1 and 90 days.' });
    }

    // Find the integration — by ID if provided, otherwise first for tenant
    let integration;
    if (integrationId) {
      integration = await req.prisma.gmailIntegration.findFirst({
        where: { id: integrationId, tenantId: req.user.tenantId },
      });
    } else {
      integration = await req.prisma.gmailIntegration.findFirst({
        where: { tenantId: req.user.tenantId },
      });
    }

    if (!integration) {
      return res.status(404).json({ message: 'Gmail not connected. Connect Gmail first.' });
    }

    const updated = await req.prisma.gmailIntegration.update({
      where: { id: integration.id },
      data: {
        ...(senderWhitelist !== undefined && { senderWhitelist }),
        ...(labelFilter !== undefined && { labelFilter }),
        ...(pollIntervalMin !== undefined && { pollIntervalMin }),
        ...(initialLookbackDays !== undefined && { initialLookbackDays }),
      },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/gmail/poll — Manually trigger a Gmail poll (specific or all)
router.post('/poll', async (req, res) => {
  try {
    const { integrationId } = req.body || {};

    let integrations;
    if (integrationId) {
      const single = await req.prisma.gmailIntegration.findFirst({
        where: { id: integrationId, tenantId: req.user.tenantId, isActive: true },
      });
      integrations = single ? [single] : [];
    } else {
      integrations = await req.prisma.gmailIntegration.findMany({
        where: { tenantId: req.user.tenantId, isActive: true },
      });
    }

    if (integrations.length === 0) {
      return res.status(404).json({ message: 'No active Gmail integrations found' });
    }

    const results = [];
    for (const integration of integrations) {
      const pollFn = integration.connectionType === 'imap'
        ? pollImapForInvoices
        : pollGmailForInvoices;

      const result = await pollFn(
        req.prisma,
        integration,
        req.user.tenantId,
        req.user.userId
      );
      results.push({ integrationId: integration.id, email: integration.imapEmail || integration.email, ...result });
    }

    // Return single result for backward compatibility, array for multi
    res.json(results.length === 1 ? results[0] : { results });
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

// ── IMAP (App Password) Routes ────────────────────────────────

// POST /api/gmail/imap/test-connection — Test IMAP login with email + App Password
router.post('/imap/test-connection', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and App Password are required.' });
    }

    const cleanPassword = password.replace(/\s/g, '');

    if (cleanPassword.length !== 16) {
      return res.status(400).json({ message: 'App Password should be 16 characters (spaces are ignored).' });
    }

    const result = await testImapConnection(email, cleanPassword);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/gmail/imap/save-credentials — Save IMAP email + encrypted App Password
router.post('/imap/save-credentials', async (req, res) => {
  try {
    const { email, password, senderWhitelist, labelFilter, pollIntervalMin, initialLookbackDays } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and App Password are required.' });
    }

    const cleanPassword = password.replace(/\s/g, '');
    if (cleanPassword.length !== 16) {
      return res.status(400).json({ message: 'App Password should be 16 characters (spaces are ignored).' });
    }

    if (pollIntervalMin !== undefined && pollIntervalMin < 15) {
      return res.status(400).json({ message: 'Poll interval must be at least 15 minutes.' });
    }

    if (initialLookbackDays !== undefined && (initialLookbackDays < 1 || initialLookbackDays > 90)) {
      return res.status(400).json({ message: 'Initial lookback must be between 1 and 90 days.' });
    }

    // Check if this email is already connected for this tenant
    const existing = await req.prisma.gmailIntegration.findFirst({
      where: { tenantId: req.user.tenantId, imapEmail: email },
    });

    let integration;
    if (existing) {
      // Update existing integration
      integration = await req.prisma.gmailIntegration.update({
        where: { id: existing.id },
        data: {
          imapPasswordEnc: encrypt(cleanPassword),
          imapHost: 'imap.gmail.com',
          imapPort: 993,
          imapUseSsl: true,
          isActive: true,
          ...(senderWhitelist !== undefined && { senderWhitelist }),
          ...(labelFilter !== undefined && { labelFilter }),
          ...(pollIntervalMin !== undefined && { pollIntervalMin }),
          ...(initialLookbackDays !== undefined && { initialLookbackDays }),
        },
      });
    } else {
      // Create new integration for this email
      integration = await req.prisma.gmailIntegration.create({
        data: {
          tenantId: req.user.tenantId,
          connectionType: 'imap',
          imapEmail: email,
          imapPasswordEnc: encrypt(cleanPassword),
          imapHost: 'imap.gmail.com',
          imapPort: 993,
          imapUseSsl: true,
          isActive: true,
          ...(senderWhitelist && { senderWhitelist }),
          ...(labelFilter && { labelFilter }),
          ...(pollIntervalMin && { pollIntervalMin }),
          ...(initialLookbackDays && { initialLookbackDays }),
        },
      });
    }

    res.json({
      saved: true,
      integrationId: integration.id,
      connectionType: 'imap',
      imapEmail: integration.imapEmail,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/gmail/:integrationId/disconnect — Remove a specific Gmail integration
router.delete('/:integrationId/disconnect', async (req, res) => {
  try {
    const { integrationId } = req.params;

    const integration = await req.prisma.gmailIntegration.findFirst({
      where: { id: integrationId, tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Gmail integration not found' });
    }

    await req.prisma.gmailIntegration.delete({
      where: { id: integrationId },
    });

    res.json({ message: 'Gmail integration disconnected', integrationId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/gmail/disconnect — Remove all Gmail integrations (backward compat)
router.delete('/disconnect', async (req, res) => {
  try {
    const result = await req.prisma.gmailIntegration.deleteMany({
      where: { tenantId: req.user.tenantId },
    });

    if (result.count === 0) {
      return res.status(404).json({ message: 'Gmail not connected' });
    }

    res.json({ message: `${result.count} Gmail integration(s) disconnected` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
