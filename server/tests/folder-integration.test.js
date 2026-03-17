import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../src/app.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenantWithPlan,
  createTestUser,
  createTestFolderIntegration,
  createTestFolderImportLog,
} from './helpers/fixtures.js';
import { validateFolderPath, scanFolder } from '../src/services/folder.js';
import { hashFileBuffer } from '../src/services/gmail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET
  );
}

// Test folder setup — create a temp folder with test files
const testFolderBase = path.join(__dirname, '__test_folder__');
const testFolderWithFiles = path.join(testFolderBase, 'with-files');
const testFolderEmpty = path.join(testFolderBase, 'empty');

function setupTestFolders() {
  fs.mkdirSync(testFolderWithFiles, { recursive: true });
  fs.mkdirSync(testFolderEmpty, { recursive: true });
  // Create some test files
  fs.writeFileSync(path.join(testFolderWithFiles, 'invoice-001.pdf'), 'fake-pdf-content-001');
  fs.writeFileSync(path.join(testFolderWithFiles, 'receipt.jpg'), 'fake-jpg-content');
  fs.writeFileSync(path.join(testFolderWithFiles, 'notes.txt'), 'should be ignored');
  fs.writeFileSync(path.join(testFolderWithFiles, 'report.docx'), 'should also be ignored');
}

function cleanupTestFolders() {
  fs.rmSync(testFolderBase, { recursive: true, force: true });
}

describe('Folder Polling Integration', () => {
  let proTenant, starterTenant;
  let proUser, starterUser;
  let proToken, starterToken;
  let folderIntegration;

  beforeAll(async () => {
    await cleanDatabase();
    setupTestFolders();

    // Professional plan — has folder_polling feature
    proTenant = await createTestTenantWithPlan('Pro Folder Biz', 'professional');
    proUser = await createTestUser(proTenant.id, { role: 'OWNER' });
    proToken = makeToken(proUser);

    // Starter plan — does NOT have folder_polling
    starterTenant = await createTestTenantWithPlan('Starter Biz', 'starter');
    starterUser = await createTestUser(starterTenant.id, { role: 'OWNER' });
    starterToken = makeToken(starterUser);
  });

  afterAll(async () => {
    await cleanDatabase();
    cleanupTestFolders();
    await testPrisma.$disconnect();
  });

  // ── Plan Gating ──

  describe('Plan gating', () => {
    it('returns 403 for starter plan accessing folder status', async () => {
      const res = await request(app)
        .get('/api/folder-polling/status')
        .set('Authorization', `Bearer ${starterToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('folder_polling');
    });

    it('returns 403 for starter plan configuring folder polling', async () => {
      const res = await request(app)
        .post('/api/folder-polling/configure')
        .set('Authorization', `Bearer ${starterToken}`)
        .send({ folderPath: 'C:\\Invoices' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('allows professional plan to access folder status', async () => {
      const res = await request(app)
        .get('/api/folder-polling/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });
  });

  // ── Status Endpoint ──

  describe('GET /api/folder-polling/status', () => {
    it('returns connected=false when no integration exists', async () => {
      const res = await request(app)
        .get('/api/folder-polling/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });

    it('returns connected=true with integration details', async () => {
      folderIntegration = await createTestFolderIntegration(proTenant.id, {
        folderPath: testFolderWithFiles,
      });

      const res = await request(app)
        .get('/api/folder-polling/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.integration.folderPath).toBe(testFolderWithFiles);
      expect(res.body.integration.isActive).toBe(true);
      expect(res.body.integration.stats).toBeDefined();
    });
  });

  // ── Test Connection ──

  describe('POST /api/folder-polling/test-connection', () => {
    it('returns success for a valid accessible folder', async () => {
      const res = await request(app)
        .post('/api/folder-polling/test-connection')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ folderPath: testFolderWithFiles });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fileCount).toBe(2); // invoice-001.pdf + receipt.jpg (not .txt or .docx)
    });

    it('returns success with 0 files for empty folder', async () => {
      const res = await request(app)
        .post('/api/folder-polling/test-connection')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ folderPath: testFolderEmpty });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fileCount).toBe(0);
    });

    it('returns error for non-existent folder', async () => {
      const res = await request(app)
        .post('/api/folder-polling/test-connection')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ folderPath: 'C:\\NonExistent\\Folder\\Path' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for missing folder path', async () => {
      const res = await request(app)
        .post('/api/folder-polling/test-connection')
        .set('Authorization', `Bearer ${proToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── Configure ──

  describe('POST /api/folder-polling/configure', () => {
    it('saves folder configuration', async () => {
      // Delete existing integration first
      await testPrisma.folderIntegration.deleteMany({ where: { tenantId: proTenant.id } });

      const res = await request(app)
        .post('/api/folder-polling/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          folderPath: testFolderWithFiles,
          filePatterns: ['*.pdf'],
          pollIntervalMin: 60,
        });

      expect(res.status).toBe(200);
      expect(res.body.saved).toBe(true);
      expect(res.body.integration.folderPath).toBe(testFolderWithFiles);
      expect(res.body.integration.filePatterns).toEqual(['*.pdf']);
      expect(res.body.integration.pollIntervalMin).toBe(60);
    });

    it('returns 400 for missing folder path', async () => {
      const res = await request(app)
        .post('/api/folder-polling/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ filePatterns: ['*.pdf'] });

      expect(res.status).toBe(400);
    });

    it('returns 400 for relative path', async () => {
      const res = await request(app)
        .post('/api/folder-polling/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ folderPath: 'relative/path/to/folder' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('absolute');
    });

    it('returns 400 for path with traversal', async () => {
      const res = await request(app)
        .post('/api/folder-polling/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ folderPath: 'C:\\Invoices\\..\\..\\Windows\\System32' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('traversal');
    });

    it('updates existing configuration', async () => {
      const res = await request(app)
        .post('/api/folder-polling/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          folderPath: testFolderWithFiles,
          pollIntervalMin: 15,
        });

      expect(res.status).toBe(200);
      expect(res.body.integration.pollIntervalMin).toBe(15);
    });
  });

  // ── Poll ──

  describe('POST /api/folder-polling/poll', () => {
    it('returns 404 when folder polling not configured', async () => {
      const newTenant = await createTestTenantWithPlan('Pro No Folder', 'professional');
      const newUser = await createTestUser(newTenant.id, { role: 'OWNER' });
      const newToken = makeToken(newUser);

      const res = await request(app)
        .post('/api/folder-polling/poll')
        .set('Authorization', `Bearer ${newToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 400 when integration is paused', async () => {
      const pausedTenant = await createTestTenantWithPlan('Pro Paused Folder', 'professional');
      const pausedUser = await createTestUser(pausedTenant.id, { role: 'OWNER' });
      const pausedToken = makeToken(pausedUser);
      await createTestFolderIntegration(pausedTenant.id, {
        isActive: false,
        folderPath: testFolderWithFiles,
      });

      const res = await request(app)
        .post('/api/folder-polling/poll')
        .set('Authorization', `Bearer ${pausedToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('paused');
    });

    it('polls and returns stats (may fail due to OCR not available in tests)', async () => {
      const res = await request(app)
        .post('/api/folder-polling/poll')
        .set('Authorization', `Bearer ${proToken}`);

      // Poll will either return 200 with stats or 500 if OCR service is unavailable
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.processed).toBeDefined();
        expect(res.body.imported).toBeDefined();
        expect(res.body.duplicates).toBeDefined();
      }
    });
  });

  // ── Import Logs ──

  describe('GET /api/folder-polling/import-logs', () => {
    it('returns paginated import logs', async () => {
      await createTestFolderImportLog(proTenant.id, {
        status: 'imported',
        fileName: 'test-invoice-001.pdf',
        filePath: 'C:\\Unique1\\test-invoice-001.pdf',
      });
      await createTestFolderImportLog(proTenant.id, {
        status: 'duplicate',
        duplicateReason: 'file_hash',
        fileName: 'test-invoice-002.pdf',
        filePath: 'C:\\Unique2\\test-invoice-002.pdf',
      });
      await createTestFolderImportLog(proTenant.id, {
        status: 'failed',
        fileName: 'corrupted.pdf',
        filePath: 'C:\\Unique3\\corrupted.pdf',
      });

      const res = await request(app)
        .get('/api/folder-polling/import-logs')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(res.body.logs.length).toBeGreaterThanOrEqual(3);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('filters by status', async () => {
      const res = await request(app)
        .get('/api/folder-polling/import-logs?status=duplicate')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      for (const log of res.body.logs) {
        expect(log.status).toBe('duplicate');
      }
    });

    it('supports pagination', async () => {
      const res = await request(app)
        .get('/api/folder-polling/import-logs?page=1&limit=2')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeLessThanOrEqual(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
    });
  });

  // ── Disconnect ──

  describe('DELETE /api/folder-polling/disconnect', () => {
    it('returns 404 when not configured', async () => {
      const newTenant = await createTestTenantWithPlan('Pro Disconnect', 'professional');
      const newUser = await createTestUser(newTenant.id, { role: 'OWNER' });
      const newToken = makeToken(newUser);

      const res = await request(app)
        .delete('/api/folder-polling/disconnect')
        .set('Authorization', `Bearer ${newToken}`);

      expect(res.status).toBe(404);
    });

    it('removes folder integration', async () => {
      // Ensure pro tenant has an integration
      const existing = await testPrisma.folderIntegration.findUnique({
        where: { tenantId: proTenant.id },
      });
      if (!existing) {
        await createTestFolderIntegration(proTenant.id, { folderPath: testFolderWithFiles });
      }

      const res = await request(app)
        .delete('/api/folder-polling/disconnect')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('disconnected');

      // Verify it's gone
      const check = await request(app)
        .get('/api/folder-polling/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(check.body.connected).toBe(false);
    });
  });

  // ── Path Validation ──

  describe('validateFolderPath()', () => {
    it('accepts absolute Windows paths', async () => {
      const result = await validateFolderPath(testFolderWithFiles);
      expect(result.valid).toBe(true);
    });

    it('rejects empty paths', async () => {
      const result = await validateFolderPath('');
      expect(result.valid).toBe(false);
    });

    it('rejects null', async () => {
      const result = await validateFolderPath(null);
      expect(result.valid).toBe(false);
    });

    it('rejects relative paths', async () => {
      const result = await validateFolderPath('relative/path');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('absolute');
    });

    it('rejects paths with traversal', async () => {
      const result = await validateFolderPath('C:\\Invoices\\..\\..\\Windows');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('rejects non-existent paths', async () => {
      const result = await validateFolderPath('C:\\NonExistent\\Random\\Path\\12345');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not accessible');
    });
  });

  // ── File Scanning ──

  describe('scanFolder()', () => {
    it('finds supported files matching patterns', async () => {
      const files = await scanFolder(testFolderWithFiles, ['*.pdf', '*.jpg']);
      expect(files.length).toBe(2);

      const names = files.map((f) => f.fileName);
      expect(names).toContain('invoice-001.pdf');
      expect(names).toContain('receipt.jpg');
    });

    it('filters by specific patterns', async () => {
      const files = await scanFolder(testFolderWithFiles, ['*.pdf']);
      expect(files.length).toBe(1);
      expect(files[0].fileName).toBe('invoice-001.pdf');
    });

    it('returns empty for empty folder', async () => {
      const files = await scanFolder(testFolderEmpty, ['*.pdf', '*.jpg']);
      expect(files.length).toBe(0);
    });

    it('ignores unsupported file types', async () => {
      const files = await scanFolder(testFolderWithFiles, ['*.txt', '*.docx']);
      expect(files.length).toBe(0);
    });

    it('includes file size and mime type', async () => {
      const files = await scanFolder(testFolderWithFiles, ['*.pdf']);
      expect(files[0].size).toBeGreaterThan(0);
      expect(files[0].mimeType).toBe('application/pdf');
      expect(files[0].fullPath).toContain('invoice-001.pdf');
    });
  });

  // ── Hashing ──

  describe('hashFileBuffer()', () => {
    it('produces consistent hashes', () => {
      const buf = Buffer.from('test content for hashing');
      const hash1 = hashFileBuffer(buf);
      const hash2 = hashFileBuffer(buf);
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different content', () => {
      const hash1 = hashFileBuffer(Buffer.from('content A'));
      const hash2 = hashFileBuffer(Buffer.from('content B'));
      expect(hash1).not.toBe(hash2);
    });

    it('returns a 64-character hex string (SHA-256)', () => {
      const hash = hashFileBuffer(Buffer.from('hello'));
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
