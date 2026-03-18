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
  ensureTiersSeeded,
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
  let tiers; // { basic, medium, high } tier IDs

  beforeAll(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();

    // Get tier IDs for plan changes
    const allTiers = await testPrisma.planTier.findMany();
    tiers = {};
    for (const t of allTiers) tiers[t.slug] = t.id;

    // Start with a starter (basic) plan tenant
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

  // ── Phase 1: Basic Tier (starter) ──

  describe('Phase 1: Basic tier — core features only', () => {
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

    it('BLOCKED from Gmail routes (email_integration not in basic)', async () => {
      const res = await request(app)
        .get('/api/gmail/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('email_integration');
      expect(res.body.currentPlan).toBe('basic');
    });

    it('BLOCKED from Competitor routes', async () => {
      const res = await request(app)
        .get('/api/competitor/monitors')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
      expect(res.body.requiredFeature).toBe('competitor_intelligence');
    });

    it('/me returns basic tier info with enabledFeatures', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tierSlug).toBe('basic');
      expect(res.body.enabledFeatures).toContain('invoices');
      expect(res.body.enabledFeatures).toContain('products');
      expect(res.body.enabledFeatures).not.toContain('email_integration');
      expect(res.body.enabledFeatures).not.toContain('competitor_intelligence');
      expect(res.body.limits.max_stores).toBe(2);
      expect(res.body.limits.max_invoice_pages_per_month).toBe(100);
    });
  });

  // ── Phase 2: Admin Upgrades to Medium ──

  describe('Phase 2: Admin upgrades to medium tier', () => {
    it('admin can change plan to medium via planTierId', async () => {
      const res = await request(app)
        .patch(`/api/admin/tenants/${tenant.id}/subscription`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planTierId: tiers.medium });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('medium');
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
      expect(logs[0].reason).toContain('medium');
    });

    it('/me now shows medium tier with email_integration', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tierSlug).toBe('medium');
      expect(res.body.enabledFeatures).toContain('email_integration');
      expect(res.body.enabledFeatures).toContain('folder_polling');
      expect(res.body.enabledFeatures).not.toContain('competitor_intelligence');
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
      expect(res.body.currentPlan).toBe('medium');
    });

    it('core invoice routes still work', async () => {
      const res = await request(app)
        .get('/api/invoices')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  // ── Phase 3: Admin Upgrades to High ──

  describe('Phase 3: Admin upgrades to high tier', () => {
    it('admin can change plan to high via planTierId', async () => {
      const res = await request(app)
        .patch(`/api/admin/tenants/${tenant.id}/subscription`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planTierId: tiers.high });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('high');
      expect(res.body.maxUsers).toBe(999);
      expect(res.body.maxStores).toBe(999);
      expect(res.body.maxApiCallsPerMonth).toBe(2000);
    });

    it('/me now shows high tier with all features', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tierSlug).toBe('high');
      expect(res.body.enabledFeatures).toContain('email_integration');
      expect(res.body.enabledFeatures).toContain('competitor_intelligence');
      expect(res.body.enabledFeatures).toContain('demand_forecasting');
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

  // ── Phase 4: Downgrade Back to Basic ──

  describe('Phase 4: Downgrade back to basic', () => {
    it('admin can downgrade to basic via planTierId', async () => {
      const res = await request(app)
        .patch(`/api/admin/tenants/${tenant.id}/subscription`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ planTierId: tiers.basic });

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('basic');
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

    it('/me shows reverted tier info', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tierSlug).toBe('basic');
      expect(res.body.enabledFeatures).not.toContain('email_integration');
      expect(res.body.limits.max_invoice_pages_per_month).toBe(100);
    });
  });
});
