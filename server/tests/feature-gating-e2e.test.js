import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenantWithPlan,
  createTestUser,
  createTestSystemAdmin,
  createTestProduct,
} from './helpers/fixtures.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET
  );
}

describe('Feature Gating E2E', () => {
  let tenant, user, token;
  let adminUser, adminToken;
  let product;

  beforeAll(async () => {
    await cleanDatabase();

    // Start with a starter plan tenant
    tenant = await createTestTenantWithPlan('E2E Test Biz', 'starter');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    token = makeToken(user);

    // System admin
    adminUser = await createTestSystemAdmin();
    adminToken = makeToken(adminUser);

    // Create a product (needed for competitor features)
    product = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'E2E Test Product',
        category: 'Grocery',
        baseUnit: 'each',
      },
    });
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  // ── Phase 1: Starter Plan ──

  describe('Phase 1: Starter plan — core features only', () => {
    it('can access invoice routes (core feature)', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('can access product routes (core feature)', async () => {
      const res = await request(app)
        .get('/api/products')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('BLOCKED from Gmail routes', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('gmail_integration');
      expect(res.body.currentPlan).toBe('starter');
    });

    it('BLOCKED from Competitor routes', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('competitor_intelligence');
    });

    it('/me returns starter plan info', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.plan).toBe('starter');
      expect(res.body.tenant.maxStores).toBe(2);
      expect(res.body.tenant.maxApiCallsPerMonth).toBe(100);
    });
  });

  // ── Phase 2: Admin Upgrades to Professional ──

  describe('Phase 2: Admin upgrades to professional', () => {
    it('admin can change plan to professional', async () => {
      const res = await request(app)
        .patch(`/api/admin/tenants/${tenant.id}/subscription`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ plan: 'professional' });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('professional');
      expect(res.body.maxUsers).toBe(15);
      expect(res.body.maxStores).toBe(10);
      expect(res.body.maxApiCallsPerMonth).toBe(500);
    });

    it('plan change is logged', async () => {
      const logs = await testPrisma.tenantAccessLog.findMany({
        where: { tenantId: tenant.id, action: 'PLAN_CHANGED' },
        orderBy: { createdAt: 'desc' },
      });

      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].reason).toContain('professional');
    });

    it('/me now shows professional plan', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.plan).toBe('professional');
      expect(res.body.tenant.maxApiCallsPerMonth).toBe(500);
    });

    it('Gmail routes now ALLOWED', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false); // Not connected yet, but access is allowed
    });

    it('Competitor routes still BLOCKED', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('competitor_intelligence');
      expect(res.body.currentPlan).toBe('professional');
    });

    it('core invoice routes still work', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  // ── Phase 3: Admin Upgrades to Enterprise ──

  describe('Phase 3: Admin upgrades to enterprise', () => {
    it('admin can change plan to enterprise', async () => {
      const res = await request(app)
        .patch(`/api/admin/tenants/${tenant.id}/subscription`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ plan: 'enterprise' });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('enterprise');
      expect(res.body.maxUsers).toBe(999); // Infinity capped at 999
      expect(res.body.maxStores).toBe(999);
      expect(res.body.maxApiCallsPerMonth).toBe(2000);
    });

    it('/me now shows enterprise plan', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.plan).toBe('enterprise');
      expect(res.body.tenant.maxApiCallsPerMonth).toBe(2000);
    });

    it('Gmail routes still ALLOWED', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('Competitor routes now ALLOWED', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('can create a competitor monitor', async () => {
      const res = await request(app)
        .post('/api/competitor/monitors')
        .set('Authorization', `Bearer ${token}`)
        .send({
          productId: product.id,
          competitor: 'woolworths',
          searchTerm: 'E2E Test Product',
        });

      expect(res.status).toBe(201);
      expect(res.body.competitor).toBe('woolworths');
      expect(res.body.productId).toBe(product.id);
    });

    it('can access competitor alerts', async () => {
      const res = await request(app)
        .get('/api/competitor/alerts')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('core invoice routes still work', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  // ── Phase 4: Downgrade Back to Starter ──

  describe('Phase 4: Downgrade back to starter', () => {
    it('admin can downgrade to starter', async () => {
      const res = await request(app)
        .patch(`/api/admin/tenants/${tenant.id}/subscription`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ plan: 'starter' });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('starter');
      expect(res.body.maxUsers).toBe(5);
      expect(res.body.maxStores).toBe(2);
      expect(res.body.maxApiCallsPerMonth).toBe(100);
    });

    it('Gmail routes BLOCKED again after downgrade', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('Competitor routes BLOCKED again after downgrade', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
    });

    it('core features still accessible after downgrade', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('/me shows reverted plan info', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tenant.plan).toBe('starter');
      expect(res.body.tenant.maxApiCallsPerMonth).toBe(100);
    });
  });
});
