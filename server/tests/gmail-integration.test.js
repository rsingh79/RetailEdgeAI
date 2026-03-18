import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenantWithPlan,
  createTestUser,
  createTestGmailIntegration,
  createTestGmailImportLog,
} from './helpers/fixtures.js';
import { encrypt, decrypt } from '../src/lib/encryption.js';
import {
  hashFileBuffer,
  isDuplicateByMessageId,
  isDuplicateByHash,
  isDuplicateByContent,
  filterBySenderWhitelist,
} from '../src/services/gmail.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET
  );
}

describe('Gmail Integration', () => {
  let proTenant, starterTenant;
  let proUser, starterUser;
  let proToken, starterToken;
  let gmailIntegration;

  beforeAll(async () => {
    await cleanDatabase();

    // Professional plan — has gmail_integration feature
    proTenant = await createTestTenantWithPlan('Pro Gmail Biz', 'professional');
    proUser = await createTestUser(proTenant.id, { role: 'OWNER' });
    proToken = makeToken(proUser);

    // Starter plan — does NOT have gmail_integration
    starterTenant = await createTestTenantWithPlan('Starter Biz', 'starter');
    starterUser = await createTestUser(starterTenant.id, { role: 'OWNER' });
    starterToken = makeToken(starterUser);
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  // ── Plan Gating ──

  describe('Plan gating', () => {
    it('returns 403 for starter plan accessing Gmail status', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${starterToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('email_integration');
    });

    it('returns 403 for starter plan configuring Gmail', async () => {
      const res = await request(app)
        .post('/api/gmail/configure')
        .set('Authorization', `Bearer ${starterToken}`)
        .send({ senderWhitelist: ['test@example.com'] });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('allows professional plan to access Gmail status', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      // Not connected yet
      expect(res.body.connected).toBe(false);
    });
  });

  // ── Status Endpoint ──

  describe('GET /api/gmail/status', () => {
    it('returns connected=false when no integration exists', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });

    it('returns connected=true with integration details', async () => {
      // Create a Gmail integration for the pro tenant
      gmailIntegration = await createTestGmailIntegration(proTenant.id, {
        email: 'retailpro@gmail.com',
      });

      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.integration.email).toBe('retailpro@gmail.com');
      expect(res.body.integration.isActive).toBe(true);
      expect(res.body.integration.stats).toBeDefined();
    });
  });

  // ── Auth URL ──

  describe('GET /api/gmail/auth-url', () => {
    it('returns an OAuth URL (or placeholder note)', async () => {
      const res = await request(app)
        .get('/api/gmail/auth-url')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.url).toBeDefined();
      expect(res.body.url).toContain('accounts.google.com');
    });
  });

  // ── Configure ──

  describe('POST /api/gmail/configure', () => {
    it('saves sender whitelist and label filter', async () => {
      const res = await request(app)
        .post('/api/gmail/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({
          senderWhitelist: ['supplier1@example.com', 'supplier2@example.com'],
          labelFilter: 'Invoices',
          pollIntervalMin: 60,
        });

      expect(res.status).toBe(200);
      expect(res.body.senderWhitelist).toEqual(['supplier1@example.com', 'supplier2@example.com']);
      expect(res.body.labelFilter).toBe('Invoices');
      expect(res.body.pollIntervalMin).toBe(60);
    });

    it('returns 404 when Gmail not connected', async () => {
      // Starter has no integration, but is also plan-blocked.
      // Use a new pro tenant without integration.
      const newTenant = await createTestTenantWithPlan('Pro No Gmail', 'professional');
      const newUser = await createTestUser(newTenant.id, { role: 'OWNER' });
      const newToken = makeToken(newUser);

      const res = await request(app)
        .post('/api/gmail/configure')
        .set('Authorization', `Bearer ${newToken}`)
        .send({ senderWhitelist: ['test@example.com'] });

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not connected');
    });

    it('updates partial configuration', async () => {
      const res = await request(app)
        .post('/api/gmail/configure')
        .set('Authorization', `Bearer ${proToken}`)
        .send({ pollIntervalMin: 15 });

      expect(res.status).toBe(200);
      expect(res.body.pollIntervalMin).toBe(15);
      // Previous whitelist should still be there
      expect(res.body.senderWhitelist).toEqual(['supplier1@example.com', 'supplier2@example.com']);
    });
  });

  // ── Poll ──

  describe('POST /api/gmail/poll', () => {
    it('attempts poll and returns result (may fail due to no live Gmail API)', async () => {
      const res = await request(app)
        .post('/api/gmail/poll')
        .set('Authorization', `Bearer ${proToken}`);

      // Poll will either return 200 with stats or 500 if Gmail API is unreachable
      // In test environment, the fake access token will fail at the Gmail API
      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.processed).toBeDefined();
      }
    });

    it('returns 404 when Gmail not connected', async () => {
      const newTenant = await createTestTenantWithPlan('Pro No Poll', 'professional');
      const newUser = await createTestUser(newTenant.id, { role: 'OWNER' });
      const newToken = makeToken(newUser);

      const res = await request(app)
        .post('/api/gmail/poll')
        .set('Authorization', `Bearer ${newToken}`);

      expect(res.status).toBe(404);
    });

    it('returns 400 when integration is paused', async () => {
      const pausedTenant = await createTestTenantWithPlan('Pro Paused', 'professional');
      const pausedUser = await createTestUser(pausedTenant.id, { role: 'OWNER' });
      const pausedToken = makeToken(pausedUser);
      await createTestGmailIntegration(pausedTenant.id, { isActive: false });

      const res = await request(app)
        .post('/api/gmail/poll')
        .set('Authorization', `Bearer ${pausedToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('paused');
    });
  });

  // ── Import Logs ──

  describe('GET /api/gmail/import-logs', () => {
    it('returns paginated import logs', async () => {
      // Create some import logs
      await createTestGmailImportLog(proTenant.id, {
        senderEmail: 'vendor@example.com',
        status: 'imported',
        attachmentName: 'invoice-001.pdf',
      });
      await createTestGmailImportLog(proTenant.id, {
        senderEmail: 'vendor@example.com',
        status: 'duplicate',
        duplicateReason: 'file_hash',
        attachmentName: 'invoice-001.pdf',
      });
      await createTestGmailImportLog(proTenant.id, {
        senderEmail: 'other@example.com',
        status: 'failed',
        attachmentName: 'corrupted.pdf',
      });

      const res = await request(app)
        .get('/api/gmail/import-logs')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(res.body.logs.length).toBeGreaterThanOrEqual(3);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('supports filtering by status', async () => {
      const res = await request(app)
        .get('/api/gmail/import-logs?status=duplicate')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs.every((l) => l.status === 'duplicate')).toBe(true);
    });

    it('supports pagination', async () => {
      const res = await request(app)
        .get('/api/gmail/import-logs?page=1&limit=2')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeLessThanOrEqual(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
    });
  });

  // ── Disconnect ──

  describe('DELETE /api/gmail/disconnect', () => {
    it('removes Gmail integration', async () => {
      const disconnectTenant = await createTestTenantWithPlan('Pro Disconnect', 'professional');
      const disconnectUser = await createTestUser(disconnectTenant.id, { role: 'OWNER' });
      const disconnectToken = makeToken(disconnectUser);
      await createTestGmailIntegration(disconnectTenant.id, { email: 'disconnect@gmail.com' });

      // Verify it's connected
      let res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${disconnectToken}`);
      expect(res.body.connected).toBe(true);

      // Disconnect
      res = await request(app)
        .delete('/api/gmail/disconnect')
        .set('Authorization', `Bearer ${disconnectToken}`);
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('disconnected');

      // Verify it's disconnected
      res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${disconnectToken}`);
      expect(res.body.connected).toBe(false);
    });

    it('returns 404 when not connected', async () => {
      const noGmailTenant = await createTestTenantWithPlan('Pro No Gmail Disc', 'professional');
      const noGmailUser = await createTestUser(noGmailTenant.id, { role: 'OWNER' });
      const noGmailToken = makeToken(noGmailUser);

      const res = await request(app)
        .delete('/api/gmail/disconnect')
        .set('Authorization', `Bearer ${noGmailToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ── Encryption ──

  describe('Encryption (AES-256-GCM)', () => {
    it('encrypts and decrypts a string correctly', () => {
      const plaintext = 'my-super-secret-access-token-12345';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
      expect(encrypted).not.toBe(plaintext);
    });

    it('produces different ciphertext for same input (random IV)', () => {
      const text = 'same-input';
      const enc1 = encrypt(text);
      const enc2 = encrypt(text);

      expect(enc1).not.toBe(enc2); // Random IVs
      expect(decrypt(enc1)).toBe(text);
      expect(decrypt(enc2)).toBe(text);
    });

    it('encrypted format is iv:authTag:ciphertext', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(32); // 16 bytes hex = 32 chars
      expect(parts[1].length).toBe(32); // 16 bytes authTag hex
      expect(parts[2].length).toBeGreaterThan(0);
    });
  });

  // ── Dedup Helpers ──

  describe('Dedup helpers', () => {
    it('hashFileBuffer produces consistent SHA-256 hashes', () => {
      const buffer = Buffer.from('test content for hashing');
      const hash1 = hashFileBuffer(buffer);
      const hash2 = hashFileBuffer(buffer);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // SHA-256 = 64 hex chars
    });

    it('hashFileBuffer produces different hashes for different content', () => {
      const hash1 = hashFileBuffer(Buffer.from('file A'));
      const hash2 = hashFileBuffer(Buffer.from('file B'));

      expect(hash1).not.toBe(hash2);
    });

    it('isDuplicateByMessageId detects existing message ID', async () => {
      // We already created import logs in previous tests — create a specific one
      await createTestGmailImportLog(proTenant.id, {
        gmailMessageId: 'unique-msg-id-dedup-test',
      });

      // Use testPrisma directly for dedup check (no tenant scoping needed)
      const dup = await isDuplicateByMessageId(testPrisma, 'unique-msg-id-dedup-test');
      expect(dup).toBe(true);

      const notDup = await isDuplicateByMessageId(testPrisma, 'nonexistent-msg-id');
      expect(notDup).toBe(false);
    });

    it('isDuplicateByHash detects existing file hash', async () => {
      await createTestGmailImportLog(proTenant.id, {
        fileHash: 'abc123hashvalue',
      });

      const dup = await isDuplicateByHash(testPrisma, 'abc123hashvalue');
      expect(dup).toBe(true);

      const notDup = await isDuplicateByHash(testPrisma, 'different-hash');
      expect(notDup).toBe(false);
    });

    it('isDuplicateByContent detects matching supplier+invoiceNumber', async () => {
      await createTestGmailImportLog(proTenant.id, {
        supplierName: 'Acme Supplies',
        invoiceNumber: 'INV-2024-001',
        invoiceDate: new Date('2024-06-15'),
        status: 'imported',
      });

      const dup = await isDuplicateByContent(testPrisma, 'Acme Supplies', 'INV-2024-001', new Date('2024-06-15'));
      expect(dup).toBe(true);

      const notDup = await isDuplicateByContent(testPrisma, 'Acme Supplies', 'INV-2024-999', null);
      expect(notDup).toBe(false);
    });

    it('isDuplicateByContent returns false if supplier or invoiceNumber missing', async () => {
      const result = await isDuplicateByContent(testPrisma, null, 'INV-001', null);
      expect(result).toBe(false);

      const result2 = await isDuplicateByContent(testPrisma, 'Some Supplier', null, null);
      expect(result2).toBe(false);
    });
  });

  // ── Sender Whitelist Filter ──

  describe('filterBySenderWhitelist', () => {
    const messages = [
      { senderEmail: 'supplier1@example.com', subject: 'Invoice 1' },
      { senderEmail: 'supplier2@example.com', subject: 'Invoice 2' },
      { senderEmail: 'random@example.com', subject: 'Spam' },
    ];

    it('returns all messages when whitelist is empty', () => {
      const filtered = filterBySenderWhitelist(messages, []);
      expect(filtered.length).toBe(3);
    });

    it('returns all messages when whitelist is null', () => {
      const filtered = filterBySenderWhitelist(messages, null);
      expect(filtered.length).toBe(3);
    });

    it('filters messages to only whitelisted senders', () => {
      const filtered = filterBySenderWhitelist(messages, ['supplier1@example.com']);
      expect(filtered.length).toBe(1);
      expect(filtered[0].senderEmail).toBe('supplier1@example.com');
    });

    it('handles case-insensitive matching', () => {
      const filtered = filterBySenderWhitelist(messages, ['SUPPLIER1@EXAMPLE.COM']);
      expect(filtered.length).toBe(1);
      expect(filtered[0].senderEmail).toBe('supplier1@example.com');
    });

    it('supports multiple whitelisted senders', () => {
      const filtered = filterBySenderWhitelist(messages, ['supplier1@example.com', 'supplier2@example.com']);
      expect(filtered.length).toBe(2);
    });
  });
});
