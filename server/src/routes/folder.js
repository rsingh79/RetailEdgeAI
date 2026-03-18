import { Router } from 'express';
import { validateFolderPath, scanFolder, pollFolderForInvoices } from '../services/folder.js';

const router = Router();

// GET /api/folder-polling/status — Check if folder polling is configured for this tenant
router.get('/status', async (req, res) => {
  try {
    const integration = await req.prisma.folderIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
      select: {
        id: true,
        folderPath: true,
        isActive: true,
        lastPollAt: true,
        pollIntervalMin: true,
        filePatterns: true,
        moveToProcessed: true,
        createdAt: true,
      },
    });

    if (!integration) {
      return res.json({ connected: false });
    }

    const connected = !!integration.folderPath;

    if (!connected) {
      return res.json({ connected: false });
    }

    // Get import stats
    const stats = await req.prisma.folderImportLog.groupBy({
      by: ['status'],
      _count: true,
    });

    const statsSummary = {};
    for (const s of stats) {
      statsSummary[s.status] = s._count;
    }

    res.json({
      connected: true,
      integration: {
        ...integration,
        stats: statsSummary,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/folder-polling/configure — Save folder path, file patterns, and poll interval
router.post('/configure', async (req, res) => {
  try {
    const { folderPath, filePatterns, pollIntervalMin, moveToProcessed } = req.body;

    if (!folderPath) {
      return res.status(400).json({ message: 'Folder path is required.' });
    }

    if (pollIntervalMin !== undefined && pollIntervalMin < 15) {
      return res.status(400).json({ message: 'Poll interval must be at least 15 minutes.' });
    }

    // Validate the folder path
    const validation = await validateFolderPath(folderPath);
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }

    const data = {
      folderPath: folderPath.trim(),
      ...(filePatterns !== undefined && { filePatterns }),
      ...(pollIntervalMin !== undefined && { pollIntervalMin }),
      ...(moveToProcessed !== undefined && { moveToProcessed }),
    };

    const integration = await req.prisma.folderIntegration.upsert({
      where: { tenantId: req.user.tenantId },
      create: {
        tenantId: req.user.tenantId,
        ...data,
      },
      update: data,
    });

    res.json({ saved: true, integration });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/folder-polling/test-connection — Test if a folder path is accessible
router.post('/test-connection', async (req, res) => {
  try {
    const { folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).json({ message: 'Folder path is required.' });
    }

    const validation = await validateFolderPath(folderPath);
    if (!validation.valid) {
      return res.json({ success: false, error: validation.error });
    }

    // Try to list files
    try {
      const files = await scanFolder(folderPath, ['*.pdf', '*.jpg', '*.jpeg', '*.png', '*.webp']);
      return res.json({
        success: true,
        fileCount: files.length,
        message: files.length > 0
          ? `Found ${files.length} invoice file(s) ready to import.`
          : 'Folder is accessible but no invoice files found yet.',
      });
    } catch (scanErr) {
      return res.json({ success: false, error: `Cannot read folder: ${scanErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/folder-polling/poll — Manually trigger a folder poll
router.post('/poll', async (req, res) => {
  try {
    const integration = await req.prisma.folderIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Folder polling not configured' });
    }

    if (!integration.isActive) {
      return res.status(400).json({ message: 'Folder polling is paused' });
    }

    if (!integration.folderPath) {
      return res.status(400).json({ message: 'No folder path configured' });
    }

    const result = await pollFolderForInvoices(
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

// GET /api/folder-polling/import-logs — View import history
router.get('/import-logs', async (req, res) => {
  try {
    const { page = 1, limit = 25, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;

    const [logs, total] = await Promise.all([
      req.prisma.folderImportLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      req.prisma.folderImportLog.count({ where }),
    ]);

    res.json({ logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/folder-polling/disconnect — Remove folder polling integration
router.delete('/disconnect', async (req, res) => {
  try {
    const integration = await req.prisma.folderIntegration.findUnique({
      where: { tenantId: req.user.tenantId },
    });

    if (!integration) {
      return res.status(404).json({ message: 'Folder polling not configured' });
    }

    await req.prisma.folderIntegration.delete({
      where: { tenantId: req.user.tenantId },
    });

    res.json({ message: 'Folder polling integration disconnected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
