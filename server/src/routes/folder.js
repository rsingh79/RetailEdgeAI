import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
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

// POST /api/folder-polling/browse — Browse server directories for folder selection
router.post('/browse', async (req, res) => {
  try {
    const { path: browsePath } = req.body;
    const entries = [];

    if (!browsePath) {
      // Detect quick-access locations (OneDrive, Dropbox, Google Drive, etc.)
      const quickAccess = [];
      const homeDir = os.homedir();
      const candidates = [
        { label: 'Desktop', dir: path.join(homeDir, 'Desktop'), icon: 'desktop' },
        { label: 'Documents', dir: path.join(homeDir, 'Documents'), icon: 'documents' },
        { label: 'Downloads', dir: path.join(homeDir, 'Downloads'), icon: 'downloads' },
      ];

      // Scan for OneDrive folders (can be "OneDrive", "OneDrive - CompanyName", etc.)
      try {
        const homeItems = await fs.readdir(homeDir, { withFileTypes: true });
        for (const item of homeItems) {
          if (!item.isDirectory()) continue;
          const name = item.name;
          if (name.startsWith('OneDrive')) {
            candidates.push({ label: name, dir: path.join(homeDir, name), icon: 'cloud' });
          } else if (name === 'Dropbox') {
            candidates.push({ label: 'Dropbox', dir: path.join(homeDir, name), icon: 'cloud' });
          } else if (name === 'Google Drive' || name === 'My Drive') {
            candidates.push({ label: name, dir: path.join(homeDir, name), icon: 'cloud' });
          } else if (name === 'iCloudDrive') {
            candidates.push({ label: 'iCloud Drive', dir: path.join(homeDir, name), icon: 'cloud' });
          } else if (name === 'Box' || name === 'Box Sync') {
            candidates.push({ label: name, dir: path.join(homeDir, name), icon: 'cloud' });
          }
        }
      } catch { /* can't read home dir */ }

      for (const c of candidates) {
        try {
          await fs.access(c.dir);
          quickAccess.push({ name: c.label, path: c.dir, hasChildren: true, icon: c.icon });
        } catch {
          // Not available, skip
        }
      }

      // List available drive roots (Windows)
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      for (const letter of letters) {
        const root = `${letter}:\\`;
        try {
          await fs.access(root);
          entries.push({ name: root, path: root, hasChildren: true });
        } catch {
          // Drive doesn't exist, skip
        }
      }
      return res.json({ entries, quickAccess, parent: null });
    }

    // Validate: must be absolute, no traversal
    const normalized = path.resolve(browsePath);
    if (normalized !== path.resolve(normalized)) {
      return res.status(400).json({ message: 'Invalid path' });
    }
    if (browsePath.includes('..')) {
      return res.status(400).json({ message: 'Path traversal not allowed' });
    }

    // Read directory contents — directories only
    let items;
    try {
      items = await fs.readdir(normalized, { withFileTypes: true });
    } catch (err) {
      return res.json({ entries: [], parent: path.dirname(normalized), error: `Cannot read: ${err.message}` });
    }

    for (const item of items) {
      if (!item.isDirectory()) continue;
      // Skip hidden/system directories
      if (item.name.startsWith('.') || item.name.startsWith('$')) continue;

      const fullPath = path.join(normalized, item.name);
      // Check if this directory has subdirectories (for expand arrow)
      let hasChildren = false;
      try {
        const children = await fs.readdir(fullPath, { withFileTypes: true });
        hasChildren = children.some((c) => c.isDirectory());
      } catch {
        // Can't read — still show it but no expand
      }

      entries.push({ name: item.name, path: fullPath, hasChildren });
    }

    // Sort alphabetically
    entries.sort((a, b) => a.name.localeCompare(b.name));

    res.json({ entries, parent: path.dirname(normalized) });
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
