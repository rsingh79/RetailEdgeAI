import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenantWithPlan,
  createTestUser,
  createTestSystemAdmin,
  createTestApiUsageLog,
} from './helpers/fixtures.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET
  );
}

describe('Plan Gating', () => {
  let starterTenant, proTenant, enterpriseTenant;
  let starterUser, proUser, enterpriseUser, adminUser;
  let starterToken, proToken, enterpriseToken, adminToken;

  beforeAll(async () => {
    await cleanDatabase();

    // Create tenants for each plan
    starterTenant = await createTestTenantWithPlan('Starter Biz', 'starter');
    proTenant = await createTestTenantWithPlan('Pro Biz', 'professional');
    enterpriseTenant = await createTestTenantWithPlan('Enterprise Biz', 'enterprise');

    // Create users
    starterUser = await createTestUser(starterTenant.id, { role: 'OWNER' });
    proUser = await createTestUser(proTenant.id, { role: 'OWNER' });
    enterpriseUser = await createTestUser(enterpriseTenant.id, { role: 'OWNER' });
    adminUser = await createTestSystemAdmin();

    // Generate tokens
    starterToken = makeToken(starterUser);
    proToken = makeToken(proUser);
    enterpriseToken = makeToken(enterpriseUser);
    adminToken = makeToken(adminUser);
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  // ── requirePlan middleware ──

  describe('requirePlan middleware', () => {
    it('returns 403 for starter user accessing Gmail routes', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${starterToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('email_integration');
      expect(res.body.currentPlan).toBe('basic');
    });

    it('returns 403 for starter user accessing competitor routes', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${starterToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('competitor_intelligence');
    });

    it('returns 403 for professional user accessing competitor routes', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${proToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('competitor_intelligence');
      expect(res.body.currentPlan).toBe('medium');
    });

    it('allows professional user to access Gmail routes', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${proToken}`);

      // Should get through plan check (may return 200 or other status from route handler)
      expect(res.status).not.toBe(403);
    });

    it('allows enterprise user to access Gmail routes', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${enterpriseToken}`);

      expect(res.status).not.toBe(403);
    });

    it('allows enterprise user to access competitor routes', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${enterpriseToken}`);

      expect(res.status).not.toBe(403);
    });

    it('allows SYSTEM_ADMIN to bypass plan checks on Gmail routes', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${adminToken}`);

      // SYSTEM_ADMIN bypasses requirePlan but may fail at tenantScope — that's ok
      expect(res.body.code).not.toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('allows SYSTEM_ADMIN to bypass plan checks on competitor routes', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.body.code).not.toBe('PLAN_UPGRADE_REQUIRED');
    });
  });

  // ── API Limit ──

  describe('checkApiLimit middleware', () => {
    it('returns 429 when monthly API limit is exceeded', async () => {
      // Starter plan has maxApiCallsPerMonth=100. Seed 100 usage logs.
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(createTestApiUsageLog(starterTenant.id, {
          userId: starterUser.id,
          status: 'success',
        }));
      }
      await Promise.all(promises);

      // Try to upload an invoice (which triggers OCR with API limit check)
      const res = await request(app)
        .post('/api/invoices/upload')
        .set('Authorization', `Bearer ${starterToken}`)
        .attach('file', Buffer.from('fake-pdf'), { filename: 'test.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(429);
      expect(res.body.code).toBe('API_LIMIT_REACHED');
      expect(res.body.used).toBe(100);
      expect(res.body.limit).toBe(100);
      expect(res.body.plan).toBe('starter');
    });
  });

  // ── /me endpoint plan info ──

  describe('GET /api/auth/me with plan info', () => {
    it('returns tenant plan info for starter user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${starterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant).toBeDefined();
      expect(res.body.tenant.plan).toBe('starter');
      expect(res.body.tenant.maxUsers).toBe(5);
      expect(res.body.tenant.maxStores).toBe(2);
      expect(res.body.tenant.maxApiCallsPerMonth).toBe(100);
    });

    it('returns tenant plan info for enterprise user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${enterpriseToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.plan).toBe('enterprise');
      expect(res.body.tenant.maxApiCallsPerMonth).toBe(2000);
    });

    it('returns null tenant for SYSTEM_ADMIN', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant).toBeNull();
      expect(res.body.role).toBe('SYSTEM_ADMIN');
    });
  });

  // ── Plan config ──

  describe('Plan configuration', () => {
    it('starter plan does not include gmail_integration', async () => {
      const { planHasFeature } = await import('../src/config/plans.js');
      expect(planHasFeature('starter', 'gmail_integration')).toBe(false);
      expect(planHasFeature('starter', 'competitor_intelligence')).toBe(false);
      expect(planHasFeature('starter', 'invoices')).toBe(true);
    });

    it('professional plan includes gmail but not competitor', async () => {
      const { planHasFeature } = await import('../src/config/plans.js');
      expect(planHasFeature('professional', 'gmail_integration')).toBe(true);
      expect(planHasFeature('professional', 'competitor_intelligence')).toBe(false);
    });

    it('enterprise plan includes all features', async () => {
      const { planHasFeature } = await import('../src/config/plans.js');
      expect(planHasFeature('enterprise', 'gmail_integration')).toBe(true);
      expect(planHasFeature('enterprise', 'competitor_intelligence')).toBe(true);
      expect(planHasFeature('enterprise', 'invoices')).toBe(true);
    });

    it('unknown plan returns false', async () => {
      const { planHasFeature } = await import('../src/config/plans.js');
      expect(planHasFeature('platinum', 'invoices')).toBe(false);
    });

    it('getPlanLimits returns correct limits', async () => {
      const { getPlanLimits } = await import('../src/config/plans.js');
      const starter = getPlanLimits('starter');
      expect(starter.maxUsers).toBe(5);
      expect(starter.maxStores).toBe(2);
      expect(starter.maxApiCallsPerMonth).toBe(100);

      const pro = getPlanLimits('professional');
      expect(pro.maxUsers).toBe(15);
      expect(pro.maxStores).toBe(10);
      expect(pro.maxApiCallsPerMonth).toBe(500);

      const ent = getPlanLimits('enterprise');
      expect(ent.maxUsers).toBe(Infinity);
      expect(ent.maxApiCallsPerMonth).toBe(2000);
    });

    it('getPlanLimits falls back to starter for unknown plan', async () => {
      const { getPlanLimits } = await import('../src/config/plans.js');
      const unknown = getPlanLimits('platinum');
      expect(unknown.maxUsers).toBe(5);
    });
  });
});
