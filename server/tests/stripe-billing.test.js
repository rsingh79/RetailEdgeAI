import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestTenantWithPlan,
  createTestUser,
  createTestSystemAdmin,
  ensureTiersSeeded,
} from './helpers/fixtures.js';
import { BILLING_DEFAULTS, mapPriceToTier, getPriceRank } from '../src/config/tierLimits.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET
  );
}

// ── Stripe client initialisation ───────────────────────────────

describe('Stripe client initialisation', () => {
  it('Stripe client module exports null when STRIPE_SECRET_KEY is not set', async () => {
    // In test environment, STRIPE_SECRET_KEY is not set
    const { default: stripe } = await import('../src/services/stripe.js');
    // It should be null since we don't have the key
    expect(stripe).toBeNull();
  });
});

// ── Billing config ─────────────────────────────────────────────

describe('Billing config', () => {
  it('BILLING_DEFAULTS has correct structure', () => {
    expect(BILLING_DEFAULTS.trialDays).toBe(14);
    expect(BILLING_DEFAULTS.trialTier).toBe('growth');
    expect(BILLING_DEFAULTS.defaultGracePeriodDays).toBe(14);
    expect(BILLING_DEFAULTS.dataRetentionDaysAfterSuspension).toBe(30);
  });

  it('mapPriceToTier returns starter for unknown priceId', () => {
    expect(mapPriceToTier('price_unknown')).toBe('starter');
    expect(mapPriceToTier(null)).toBe('starter');
    expect(mapPriceToTier(undefined)).toBe('starter');
  });

  it('getPriceRank returns 0 for unknown priceId', () => {
    expect(getPriceRank('price_unknown')).toBe(0);
  });
});

// ── Free trial registration ────────────────────────────────────

describe('Free trial', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  beforeEach(async () => {
    await testPrisma.tenantUsage.deleteMany();
    await testPrisma.auditLog.deleteMany();
    await testPrisma.user.deleteMany();
    await testPrisma.tenant.deleteMany();
  });

  it('new registration creates tenant with status=trialing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: `trial-test-${Date.now()}@test.com`,
        password: 'password123',
        name: 'Trial Tester',
        tenantName: 'Trial Business',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();

    const tenant = await testPrisma.tenant.findFirst({
      where: { name: 'Trial Business' },
    });

    expect(tenant).toBeTruthy();
    expect(tenant.subscriptionStatus).toBe('trialing');
    expect(tenant.trialStartedAt).toBeTruthy();
    expect(tenant.trialEndsAt).toBeTruthy();
    expect(tenant.trialTier).toBe('growth');
    expect(tenant.stripeCustomerId).toBeNull();
  });

  it('trial tenant has Growth-tier limits in TenantUsage', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: `usage-test-${Date.now()}@test.com`,
        password: 'password123',
        name: 'Usage Tester',
        tenantName: 'Usage Test Biz',
      });

    const tenant = await testPrisma.tenant.findFirst({
      where: { name: 'Usage Test Biz' },
    });

    const usage = await testPrisma.tenantUsage.findFirst({
      where: { tenantId: tenant.id },
    });

    expect(usage).toBeTruthy();
    expect(usage.aiQueriesLimit).toBe(200); // Growth tier
    expect(usage.productsLimit).toBe(5000); // Growth tier
    expect(usage.integrationsLimit).toBe(3); // Growth tier
  });

  it('no stripeCustomerId on registration (deferred)', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        email: `defer-${Date.now()}@test.com`,
        password: 'password123',
        name: 'Defer Test',
        tenantName: 'Defer Biz',
      });

    const tenant = await testPrisma.tenant.findFirst({
      where: { name: 'Defer Biz' },
    });

    expect(tenant.stripeCustomerId).toBeNull();
    expect(tenant.stripeSubscriptionId).toBeNull();
  });

  it('trial period is 14 days from registration', async () => {
    const before = new Date();

    await request(app)
      .post('/api/auth/register')
      .send({
        email: `period-${Date.now()}@test.com`,
        password: 'password123',
        name: 'Period Test',
        tenantName: 'Period Biz',
      });

    const after = new Date();
    const tenant = await testPrisma.tenant.findFirst({
      where: { name: 'Period Biz' },
    });

    const trialEnd = new Date(tenant.trialEndsAt);
    const expectedMin = new Date(before.getTime() + 14 * 24 * 60 * 60 * 1000 - 5000);
    const expectedMax = new Date(after.getTime() + 14 * 24 * 60 * 60 * 1000 + 5000);

    expect(trialEnd.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(trialEnd.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
  });
});

// ── Subscription status middleware ─────────────────────────────

describe('Subscription status middleware', () => {
  let activeTenant, activeUser, activeToken;
  let trialTenant, trialUser, trialToken;
  let expiredTrialTenant, expiredTrialUser, expiredTrialToken;
  let pastDueTenant, pastDueUser, pastDueToken;
  let pastDueExpiredTenant, pastDueExpiredUser, pastDueExpiredToken;
  let cancelledInPeriodTenant, cancelledInPeriodUser, cancelledInPeriodToken;
  let cancelledExpiredTenant, cancelledExpiredUser, cancelledExpiredToken;
  let suspendedTenant, suspendedUser, suspendedToken;
  let adminUser, adminToken;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();

    // Active subscription
    activeTenant = await testPrisma.tenant.create({
      data: {
        name: 'Active Biz', subscriptionStatus: 'active', plan: 'growth',
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    activeUser = await createTestUser(activeTenant.id);
    activeToken = makeToken(activeUser);

    // Active trial (within 14 days)
    trialTenant = await testPrisma.tenant.create({
      data: {
        name: 'Trial Biz', subscriptionStatus: 'trialing', plan: 'growth',
        trialStartedAt: new Date(),
        trialEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days remaining
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    trialUser = await createTestUser(trialTenant.id);
    trialToken = makeToken(trialUser);

    // Expired trial
    expiredTrialTenant = await testPrisma.tenant.create({
      data: {
        name: 'Expired Trial Biz', subscriptionStatus: 'trialing', plan: 'growth',
        trialStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        trialEndsAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // expired yesterday
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    expiredTrialUser = await createTestUser(expiredTrialTenant.id);
    expiredTrialToken = makeToken(expiredTrialUser);

    // Past due — within grace period
    pastDueTenant = await testPrisma.tenant.create({
      data: {
        name: 'Past Due Biz', subscriptionStatus: 'past_due', plan: 'growth',
        gracePeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days grace left
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    pastDueUser = await createTestUser(pastDueTenant.id);
    pastDueToken = makeToken(pastDueUser);

    // Past due — grace period expired
    pastDueExpiredTenant = await testPrisma.tenant.create({
      data: {
        name: 'Past Due Expired Biz', subscriptionStatus: 'past_due', plan: 'growth',
        gracePeriodEndsAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // grace expired yesterday
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    pastDueExpiredUser = await createTestUser(pastDueExpiredTenant.id);
    pastDueExpiredToken = makeToken(pastDueExpiredUser);

    // Cancelled — still within billing period
    cancelledInPeriodTenant = await testPrisma.tenant.create({
      data: {
        name: 'Cancelled InPeriod Biz', subscriptionStatus: 'cancelled', plan: 'growth',
        billingPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days remaining
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    cancelledInPeriodUser = await createTestUser(cancelledInPeriodTenant.id);
    cancelledInPeriodToken = makeToken(cancelledInPeriodUser);

    // Cancelled — past billing period
    cancelledExpiredTenant = await testPrisma.tenant.create({
      data: {
        name: 'Cancelled Expired Biz', subscriptionStatus: 'cancelled', plan: 'growth',
        billingPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // expired 5 days ago
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    cancelledExpiredUser = await createTestUser(cancelledExpiredTenant.id);
    cancelledExpiredToken = makeToken(cancelledExpiredUser);

    // Suspended
    suspendedTenant = await testPrisma.tenant.create({
      data: {
        name: 'Suspended Biz', subscriptionStatus: 'suspended', plan: 'growth',
        planTierId: (await testPrisma.planTier.findUnique({ where: { slug: 'growth' } }))?.id,
      },
    });
    suspendedUser = await createTestUser(suspendedTenant.id);
    suspendedToken = makeToken(suspendedUser);

    // System admin
    adminUser = await createTestSystemAdmin();
    adminToken = makeToken(adminUser);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('active subscription: access granted', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${activeToken}`);
    expect(res.status).toBe(200);
  });

  it('trialing: access granted within trial period', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${trialToken}`);
    expect(res.status).toBe(200);
  });

  it('trialing: response includes X-Trial-Info header', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${trialToken}`);
    expect(res.status).toBe(200);

    const trialInfo = res.headers['x-trial-info'];
    expect(trialInfo).toBeTruthy();
    const parsed = JSON.parse(trialInfo);
    expect(parsed.status).toBe('trialing');
    expect(parsed.daysRemaining).toBeGreaterThan(0);
    expect(parsed.trialEndsAt).toBeTruthy();
  });

  it('trial expired: returns 403 with TRIAL_EXPIRED code', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${expiredTrialToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TRIAL_EXPIRED');
    expect(res.body.billingUrl).toBe('/settings/billing');
  });

  it('past due within grace period: access granted with warning header', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${pastDueToken}`);
    expect(res.status).toBe(200);

    const warning = res.headers['x-subscription-warning'];
    expect(warning).toBeTruthy();
    const parsed = JSON.parse(warning);
    expect(parsed.status).toBe('past_due');
    expect(parsed.billingUrl).toBe('/settings/billing');
  });

  it('past due grace period expired: returns 403', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${pastDueExpiredToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GRACE_PERIOD_EXPIRED');
  });

  it('cancelled within billing period: access granted', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${cancelledInPeriodToken}`);
    expect(res.status).toBe(200);
  });

  it('cancelled past billing period: access denied (403)', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${cancelledExpiredToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('suspended: access denied (403)', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${suspendedToken}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('SYSTEM_ADMIN bypasses subscription checks', async () => {
    // Admin routes don't go through subscription check, but let's verify
    const res = await request(app)
      .get('/api/admin/overview/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    // Should not be blocked by subscription status
    expect(res.status).not.toBe(403);
  });
});

// ── Billing API endpoints ──────────────────────────────────────

describe('Billing API endpoints', () => {
  let tenant, user, token;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  beforeEach(async () => {
    await testPrisma.tenantUsage.deleteMany();
    await testPrisma.auditLog.deleteMany();
    await testPrisma.user.deleteMany();
    await testPrisma.tenant.deleteMany();

    const growthTier = await testPrisma.planTier.findUnique({ where: { slug: 'growth' } });
    tenant = await testPrisma.tenant.create({
      data: {
        name: 'Billing Test Biz',
        subscriptionStatus: 'active',
        plan: 'growth',
        planTierId: growthTier?.id,
        stripeCustomerId: 'cus_test_123',
        stripeSubscriptionId: 'sub_test_456',
        stripePriceId: 'price_growth_test',
        billingPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        billingPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
      },
    });
    user = await createTestUser(tenant.id);
    token = makeToken(user);
  });

  describe('GET /api/billing/status', () => {
    it('returns current billing info', async () => {
      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.tier).toBe('growth');
      expect(res.body.tierName).toBe('Growth');
      expect(res.body.status).toBe('active');
      expect(res.body.stripeCustomerId).toBe('cus_test_123');
      expect(res.body.hasStripeSubscription).toBe(true);
      expect(res.body.currentPeriodStart).toBeTruthy();
      expect(res.body.currentPeriodEnd).toBeTruthy();
    });

    it('returns trial info for trialing tenant', async () => {
      await testPrisma.tenant.update({
        where: { id: tenant.id },
        data: {
          subscriptionStatus: 'trialing',
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const res = await request(app)
        .get('/api/billing/status')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.trialDaysRemaining).toBeGreaterThan(0);
      expect(res.body.trialDaysRemaining).toBeLessThanOrEqual(7);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/billing/status');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/billing/create-checkout', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const res = await request(app)
        .post('/api/billing/create-checkout')
        .set('Authorization', `Bearer ${token}`)
        .send({ priceId: 'price_test' });

      // Since we don't have STRIPE_SECRET_KEY in test env, stripe is null
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/billing/create-checkout')
        .send({ priceId: 'price_test' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/billing/change-plan', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const res = await request(app)
        .post('/api/billing/change-plan')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPriceId: 'price_test' });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/billing/change-plan')
        .send({ newPriceId: 'price_test' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/billing/cancel', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const res = await request(app)
        .post('/api/billing/cancel')
        .set('Authorization', `Bearer ${token}`)
        .send({ mode: 'end_of_period', reason: 'too_expensive' });

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/billing/cancel')
        .send({ mode: 'end_of_period' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/billing/portal', () => {
    it('returns 503 when Stripe is not configured', async () => {
      const res = await request(app)
        .post('/api/billing/portal')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(503);
      expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED');
    });

    it('requires authentication', async () => {
      const res = await request(app).post('/api/billing/portal');
      expect(res.status).toBe(401);
    });
  });
});

// ── Webhook endpoint ───────────────────────────────────────────

describe('Webhook endpoint', () => {
  it('returns 503 when Stripe is not configured', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'test' })));

    expect(res.status).toBe(503);
  });

  it('does not require authentication (webhook is Stripe-to-server)', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'test_sig')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ type: 'test' })));

    // Should not be 401 — webhook doesn't need auth
    expect(res.status).not.toBe(401);
  });
});

// ── Admin billing endpoints ────────────────────────────────────

describe('Admin billing endpoints', () => {
  let tenant, adminUser, adminToken, regularUser, regularToken;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  beforeEach(async () => {
    await testPrisma.auditLog.deleteMany();
    await testPrisma.tenantUsage.deleteMany();
    await testPrisma.user.deleteMany();
    await testPrisma.tenant.deleteMany();
    await testPrisma.platformSettings.deleteMany();

    const growthTier = await testPrisma.planTier.findUnique({ where: { slug: 'growth' } });
    tenant = await testPrisma.tenant.create({
      data: {
        name: 'Admin Test Biz',
        subscriptionStatus: 'past_due',
        plan: 'growth',
        planTierId: growthTier?.id,
        stripeCustomerId: 'cus_admin_test',
        gracePeriodDays: null,
        gracePeriodEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    adminUser = await createTestSystemAdmin();
    adminToken = makeToken(adminUser);

    regularUser = await createTestUser(tenant.id);
    regularToken = makeToken(regularUser);
  });

  describe('GET /api/admin/tenants/:tenantId/billing', () => {
    it('returns billing info for admin', async () => {
      const res = await request(app)
        .get(`/api/admin/tenants/${tenant.id}/billing`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.subscriptionStatus).toBe('past_due');
      expect(res.body.stripeCustomerId).toBe('cus_admin_test');
      expect(res.body.gracePeriodDays).toBeNull();
      expect(res.body.effectiveGracePeriodDays).toBe(14); // system default
      expect(res.body.systemDefaultGracePeriodDays).toBe(14);
    });

    it('returns 404 for non-existent tenant', async () => {
      const res = await request(app)
        .get('/api/admin/tenants/nonexistent123/billing')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .get(`/api/admin/tenants/${tenant.id}/billing`)
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/admin/tenants/:tenantId/grace-period', () => {
    it('updates grace period days and recalculates end date', async () => {
      const res = await request(app)
        .put(`/api/admin/tenants/${tenant.id}/grace-period`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ days: 21, reason: 'Loyal customer' });

      expect(res.status).toBe(200);
      expect(res.body.gracePeriodDays).toBe(21);
      expect(res.body.gracePeriodEndsAt).toBeTruthy();

      // Verify the tenant was updated
      const updated = await testPrisma.tenant.findUnique({
        where: { id: tenant.id },
      });
      expect(updated.gracePeriodDays).toBe(21);
    });

    it('grace period change is logged in audit log', async () => {
      await request(app)
        .put(`/api/admin/tenants/${tenant.id}/grace-period`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ days: 21, reason: 'Loyal customer' });

      const log = await testPrisma.auditLog.findFirst({
        where: { tenantId: tenant.id, action: 'GRACE_PERIOD_EXTENDED' },
      });

      expect(log).toBeTruthy();
      const details = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
      expect(details.newDays).toBe(21);
      expect(details.reason).toBe('Loyal customer');
    });

    it('returns 400 for invalid days', async () => {
      const res = await request(app)
        .put(`/api/admin/tenants/${tenant.id}/grace-period`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ days: -1 });

      expect(res.status).toBe(400);
    });

    it('returns 400 for days > 90', async () => {
      const res = await request(app)
        .put(`/api/admin/tenants/${tenant.id}/grace-period`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ days: 91 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/admin/tenants/:tenantId/suspend', () => {
    it('immediately suspends tenant', async () => {
      const res = await request(app)
        .post(`/api/admin/tenants/${tenant.id}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Abuse detected' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const updated = await testPrisma.tenant.findUnique({
        where: { id: tenant.id },
      });
      expect(updated.subscriptionStatus).toBe('suspended');
    });

    it('logs suspension in audit log', async () => {
      await request(app)
        .post(`/api/admin/tenants/${tenant.id}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Abuse detected' });

      const log = await testPrisma.auditLog.findFirst({
        where: { tenantId: tenant.id, action: 'TENANT_SUSPENDED' },
      });
      expect(log).toBeTruthy();
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .post(`/api/admin/tenants/${tenant.id}/suspend`)
        .set('Authorization', `Bearer ${regularToken}`)
        .send({ reason: 'Test' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/analytics/cancellations', () => {
    it('returns aggregated cancellation reasons', async () => {
      // Seed some cancellation logs
      await testPrisma.auditLog.createMany({
        data: [
          {
            tenantId: tenant.id,
            userId: regularUser.id,
            action: 'SUBSCRIPTION_CANCELLED',
            entityType: 'Tenant',
            entityId: tenant.id,
            metadata: { mode: 'end_of_period', reason: 'too_expensive' },
          },
          {
            tenantId: tenant.id,
            userId: regularUser.id,
            action: 'SUBSCRIPTION_CANCELLED',
            entityType: 'Tenant',
            entityId: tenant.id,
            metadata: { mode: 'immediate', reason: 'missing_features' },
          },
          {
            tenantId: tenant.id,
            userId: regularUser.id,
            action: 'SUBSCRIPTION_CANCELLED',
            entityType: 'Tenant',
            entityId: tenant.id,
            metadata: { mode: 'end_of_period', reason: 'too_expensive' },
          },
        ],
      });

      const res = await request(app)
        .get('/api/admin/analytics/cancellations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.byReason.too_expensive).toBe(2);
      expect(res.body.byReason.missing_features).toBe(1);
      expect(res.body.byMode.end_of_period).toBe(2);
      expect(res.body.byMode.immediate).toBe(1);
    });

    it('requires admin role', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/cancellations')
        .set('Authorization', `Bearer ${regularToken}`);

      expect(res.status).toBe(403);
    });
  });
});

// ── Configurable grace period ──────────────────────────────────

describe('Configurable grace period', () => {
  let tenant7, user7, token7;
  let tenant30, user30, token30;
  let tenantDefault, userDefault, tokenDefault;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();

    const growthTier = await testPrisma.planTier.findUnique({ where: { slug: 'growth' } });

    // Tenant with 7-day grace override — within grace
    tenant7 = await testPrisma.tenant.create({
      data: {
        name: '7-Day Grace', subscriptionStatus: 'past_due', plan: 'growth',
        planTierId: growthTier?.id,
        gracePeriodDays: 7,
        gracePeriodEndsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days left
      },
    });
    user7 = await createTestUser(tenant7.id);
    token7 = makeToken(user7);

    // Tenant with 30-day grace override — within grace
    tenant30 = await testPrisma.tenant.create({
      data: {
        name: '30-Day Grace', subscriptionStatus: 'past_due', plan: 'growth',
        planTierId: growthTier?.id,
        gracePeriodDays: 30,
        gracePeriodEndsAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000), // 20 days left
      },
    });
    user30 = await createTestUser(tenant30.id);
    token30 = makeToken(user30);

    // Tenant with default grace (null) — within grace
    tenantDefault = await testPrisma.tenant.create({
      data: {
        name: 'Default Grace', subscriptionStatus: 'past_due', plan: 'growth',
        planTierId: growthTier?.id,
        gracePeriodDays: null,
        gracePeriodEndsAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days left
      },
    });
    userDefault = await createTestUser(tenantDefault.id);
    tokenDefault = makeToken(userDefault);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('per-tenant override: tenant with gracePeriodDays=7 gets access during grace', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${token7}`);
    expect(res.status).toBe(200);
  });

  it('per-tenant override: tenant with gracePeriodDays=30 gets access during grace', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${token30}`);
    expect(res.status).toBe(200);
  });

  it('within grace period: access granted with warning header', async () => {
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${tokenDefault}`);
    expect(res.status).toBe(200);

    const warning = res.headers['x-subscription-warning'];
    expect(warning).toBeTruthy();
    const parsed = JSON.parse(warning);
    expect(parsed.status).toBe('past_due');
  });
});

// ── /me endpoint with trial info ───────────────────────────────

describe('GET /api/auth/me with billing info', () => {
  let tenant, user, token;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();

    const growthTier = await testPrisma.planTier.findUnique({ where: { slug: 'growth' } });
    tenant = await testPrisma.tenant.create({
      data: {
        name: 'Me Test Biz',
        subscriptionStatus: 'trialing',
        plan: 'growth',
        planTierId: growthTier?.id,
        trialStartedAt: new Date(),
        trialEndsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
        stripeCustomerId: null,
      },
    });
    user = await createTestUser(tenant.id);
    token = makeToken(user);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('returns trial days remaining for trialing tenant', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.trialDaysRemaining).toBeGreaterThan(0);
    expect(res.body.trialDaysRemaining).toBeLessThanOrEqual(8);
  });

  it('returns hasStripeCustomer = false when no Stripe customer', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasStripeCustomer).toBe(false);
  });

  it('returns tierSlug for trialing tenant', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tierSlug).toBe('growth');
    expect(res.body.tierName).toBe('Growth');
  });
});

// ── Data retention after cancellation ──────────────────────────

describe('Data retention after cancellation', () => {
  let tenant, user, token;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    await ensureTiersSeeded();

    const growthTier = await testPrisma.planTier.findUnique({ where: { slug: 'growth' } });
    tenant = await testPrisma.tenant.create({
      data: {
        name: 'Retention Biz',
        subscriptionStatus: 'cancelled',
        plan: 'growth',
        planTierId: growthTier?.id,
        billingPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // expired 5 days ago
      },
    });
    user = await createTestUser(tenant.id);
    token = makeToken(user);

    // Create some data
    await testPrisma.store.create({
      data: { tenantId: tenant.id, name: 'Test Store', type: 'POS' },
    });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('cancelled tenant data is not deleted', async () => {
    const stores = await testPrisma.store.findMany({
      where: { tenantId: tenant.id },
    });
    expect(stores).toHaveLength(1);
    expect(stores[0].name).toBe('Test Store');
  });

  it('re-subscribing restores access (simulated by setting status to active)', async () => {
    // Simulate re-subscription
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: 'active',
        billingPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    // Restore for other tests
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: 'cancelled',
        billingPeriodEnd: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
    });
  });
});
