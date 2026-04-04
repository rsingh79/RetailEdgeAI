import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestSystemAdmin,
  createTestApiUsageLog,
  createTestAccessLog,
  createTestStore,
} from './helpers/fixtures.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

function adminToken(admin) {
  return jwt.sign(
    { userId: admin.id, tenantId: null, role: 'SYSTEM_ADMIN' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function tenantToken(user) {
  return jwt.sign(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// ─── Auth & Access Control ──────────────────────────────────────

describe('Admin Auth & Access Control', () => {
  let admin, tenant, ownerUser, ownerJwt;

  beforeAll(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    tenant = await createTestTenant('Auth Test Tenant');
    ownerUser = await createTestUser(tenant.id, { role: 'OWNER' });
    ownerJwt = tenantToken(ownerUser);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('SYSTEM_ADMIN can access admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/overview/stats')
      .set('Authorization', `Bearer ${adminToken(admin)}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalTenants');
  });

  it('OWNER cannot access admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/overview/stats')
      .set('Authorization', `Bearer ${ownerJwt}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request gets 401', async () => {
    const res = await request(app).get('/api/admin/overview/stats');
    expect(res.status).toBe(401);
  });
});

// ─── Overview ───────────────────────────────────────────────────

describe('Admin Overview', () => {
  let admin, token, tenant1, tenant2;

  beforeAll(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    token = adminToken(admin);

    tenant1 = await createTestTenant('Tenant A');
    tenant2 = await createTestTenant('Tenant B');

    // Set tenant2 as trial
    await testPrisma.tenant.update({
      where: { id: tenant2.id },
      data: {
        subscriptionStatus: 'trial',
        trialEndsAt: new Date(Date.now() + 7 * 86400000),
      },
    });

    // Create some API usage logs
    await createTestApiUsageLog(tenant1.id, { costUsd: 0.05 });
    await createTestApiUsageLog(tenant1.id, { costUsd: 0.03 });
    await createTestApiUsageLog(tenant2.id, { costUsd: 0.01 });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('GET /stats returns correct platform metrics', async () => {
    const res = await request(app)
      .get('/api/admin/overview/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTenants).toBe(2);
    expect(res.body.trialTenants).toBe(1);
    expect(res.body.apiCallsMtd).toBe(3);
    expect(res.body.apiCostMtd).toBeGreaterThan(0);
  });

  it('GET /activity returns recent activity', async () => {
    // Create an access log
    await createTestAccessLog(tenant1.id, { action: 'REGISTERED' });

    const res = await request(app)
      .get('/api/admin/overview/activity')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

// ─── Tenant CRUD ────────────────────────────────────────────────

describe('Admin Tenant Management', () => {
  let admin, token;

  beforeEach(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    token = adminToken(admin);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('GET / lists all tenants with stats', async () => {
    const tenant = await createTestTenant('List Test');
    await createTestUser(tenant.id);
    await createTestStore(tenant.id);

    const res = await request(app)
      .get('/api/admin/tenants')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('List Test');
    expect(res.body[0]._count.users).toBe(1);
    expect(res.body[0]._count.stores).toBe(1);
  });

  it('GET / supports search filter', async () => {
    await createTestTenant('Alpha Shop');
    await createTestTenant('Beta Store');

    const res = await request(app)
      .get('/api/admin/tenants?search=alpha')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Alpha Shop');
  });

  it('POST / creates tenant with owner', async () => {
    const res = await request(app)
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Biz',
        ownerEmail: 'owner@newbiz.com',
        ownerName: 'John Owner',
        trialDays: 30,
      });

    expect(res.status).toBe(201);
    expect(res.body.tenant.name).toBe('New Biz');
    expect(res.body.tenant.subscriptionStatus).toBe('trial');
    expect(res.body.owner.email).toBe('owner@newbiz.com');
    expect(res.body.tempPassword).toBeTruthy();

    // Verify tenant was actually created
    const tenant = await testPrisma.tenant.findUnique({
      where: { id: res.body.tenant.id },
    });
    expect(tenant).toBeTruthy();
    expect(tenant.trialEndsAt).toBeTruthy();
  });

  it('POST / rejects duplicate email', async () => {
    const tenant = await createTestTenant('Existing');
    await createTestUser(tenant.id, { email: 'taken@test.com' });

    const res = await request(app)
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Biz',
        ownerEmail: 'taken@test.com',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already registered');
  });

  it('GET /:id returns full tenant detail', async () => {
    const tenant = await createTestTenant('Detail Test');
    const user = await createTestUser(tenant.id);
    await createTestStore(tenant.id);
    await createTestApiUsageLog(tenant.id, { userId: user.id });

    const res = await request(app)
      .get(`/api/admin/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Detail Test');
    expect(res.body.users.length).toBe(1);
    expect(res.body._count.stores).toBe(1);
    expect(res.body.usageSummary.apiCallsMtd).toBe(1);
  });

  it('PATCH /:id updates tenant details', async () => {
    const tenant = await createTestTenant('Old Name');

    const res = await request(app)
      .patch(`/api/admin/tenants/${tenant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Name', contactEmail: 'contact@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.contactEmail).toBe('contact@test.com');
  });
});

// ─── Lock / Unlock ──────────────────────────────────────────────

describe('Admin Tenant Lock/Unlock', () => {
  let admin, token, tenant, ownerUser;

  beforeEach(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    token = adminToken(admin);
    tenant = await createTestTenant('Lock Test');
    ownerUser = await createTestUser(tenant.id, { role: 'OWNER' });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('POST /:id/lock locks tenant and creates access log', async () => {
    const res = await request(app)
      .post(`/api/admin/tenants/${tenant.id}/lock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Non-payment' });

    expect(res.status).toBe(200);
    expect(res.body.isLocked).toBe(true);
    expect(res.body.lockReason).toBe('Non-payment');

    // Verify access log was created
    const logs = await testPrisma.tenantAccessLog.findMany({
      where: { tenantId: tenant.id, action: 'LOCKED' },
    });
    expect(logs.length).toBe(1);
    expect(logs[0].reason).toBe('Non-payment');
  });

  it('locked tenant users get 403 on tenant routes', async () => {
    // Lock the tenant
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { isLocked: true, lockReason: 'Suspended' },
    });

    const userJwt = tenantToken(ownerUser);
    const res = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${userJwt}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_LOCKED');
  });

  it('POST /:id/unlock restores access', async () => {
    // Lock first
    await testPrisma.tenant.update({
      where: { id: tenant.id },
      data: { isLocked: true, lockReason: 'Suspended' },
    });

    // Verify locked state blocks access
    const userJwt = tenantToken(ownerUser);
    const lockedRes = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${userJwt}`);
    expect(lockedRes.status).toBe(403);

    // Unlock via admin API
    const res = await request(app)
      .post(`/api/admin/tenants/${tenant.id}/unlock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Reinstated' });

    expect(res.status).toBe(200);
    expect(res.body.isLocked).toBe(false);
    expect(res.body.lockReason).toBeNull();

    // Verify access is restored — tenantAccess middleware lets request through
    // (the stores endpoint may return empty array but should not be 403)
    const unlockedRes = await request(app)
      .get('/api/stores')
      .set('Authorization', `Bearer ${userJwt}`);
    expect(unlockedRes.status).not.toBe(403);

    // Verify unlock was recorded in access logs
    const logs = await testPrisma.tenantAccessLog.findMany({
      where: { tenantId: tenant.id, action: 'UNLOCKED' },
    });
    expect(logs.length).toBe(1);
  });
});

// ─── API Usage ──────────────────────────────────────────────────

describe('Admin API Usage', () => {
  let admin, token, tenant1, tenant2;

  beforeAll(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    token = adminToken(admin);

    tenant1 = await createTestTenant('Usage Tenant A');
    tenant2 = await createTestTenant('Usage Tenant B');

    // Create usage logs
    for (let i = 0; i < 5; i++) {
      await createTestApiUsageLog(tenant1.id, {
        costUsd: 0.01 * (i + 1),
        inputTokens: 1000 * (i + 1),
        outputTokens: 500 * (i + 1),
      });
    }
    await createTestApiUsageLog(tenant2.id, { costUsd: 0.1 });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('GET / returns aggregated usage with tenant breakdown', async () => {
    const res = await request(app)
      .get('/api/admin/api-usage')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalCalls).toBe(6);
    expect(res.body.summary.totalCost).toBeGreaterThan(0);
    expect(res.body.tenantBreakdown.length).toBe(2);
    expect(res.body.tenantBreakdown[0].tenantName).toBeTruthy();
  });

  it('GET / filters by tenantId', async () => {
    const res = await request(app)
      .get(`/api/admin/api-usage?tenantId=${tenant1.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalCalls).toBe(5);
    expect(res.body.tenantBreakdown.length).toBe(1);
  });

  it('GET /calls returns paginated call logs', async () => {
    const res = await request(app)
      .get('/api/admin/api-usage/calls?limit=3&page=1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.calls.length).toBe(3);
    expect(res.body.pagination.total).toBe(6);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('GET /calls/:id returns single call detail', async () => {
    const logs = await testPrisma.apiUsageLog.findMany({ take: 1 });
    const res = await request(app)
      .get(`/api/admin/api-usage/calls/${logs[0].id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(logs[0].id);
    expect(res.body.tenant).toBeTruthy();
    expect(res.body.requestPayload).toBeTruthy();
  });
});

// ─── Platform Settings ──────────────────────────────────────────

describe('Admin Platform Settings', () => {
  let admin, token;

  beforeEach(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    token = adminToken(admin);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('GET / creates singleton if missing and returns defaults', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.defaultTrialDays).toBe(14);
    expect(res.body.autoLockOnTrialExpiry).toBe(true);
    expect(res.body.gracePeriodDays).toBe(14);
  });

  it('PATCH / updates settings', async () => {
    // First create the singleton
    await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);

    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultTrialDays: 30, autoLockOnTrialExpiry: false });

    expect(res.status).toBe(200);
    expect(res.body.defaultTrialDays).toBe(30);
    expect(res.body.autoLockOnTrialExpiry).toBe(false);

    // Verify persistence
    const verify = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`);
    expect(verify.body.defaultTrialDays).toBe(30);
  });

  it('PATCH / validates trial days range', async () => {
    const res = await request(app)
      .patch('/api/admin/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ defaultTrialDays: 100 });

    expect(res.status).toBe(400);
  });
});

// ─── Subscription Management ────────────────────────────────────

describe('Admin Subscription Management', () => {
  let admin, token, tenant;

  beforeEach(async () => {
    await cleanDatabase();
    admin = await createTestSystemAdmin();
    token = adminToken(admin);
    tenant = await createTestTenant('Sub Test');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('PATCH /:id/subscription updates plan and trial', async () => {
    const futureDate = new Date(Date.now() + 30 * 86400000).toISOString();
    const res = await request(app)
      .patch(`/api/admin/tenants/${tenant.id}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        plan: 'professional',
        subscriptionStatus: 'active',
        trialEndsAt: futureDate,
        paymentMethodOnFile: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('professional');
    expect(res.body.subscriptionStatus).toBe('active');
    expect(res.body.paymentMethodOnFile).toBe(true);
  });

  it('PATCH /:id/subscription extends trial', async () => {
    const newEnd = new Date(Date.now() + 60 * 86400000).toISOString();
    const res = await request(app)
      .patch(`/api/admin/tenants/${tenant.id}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ trialEndsAt: newEnd });

    expect(res.status).toBe(200);
    expect(new Date(res.body.trialEndsAt).getTime()).toBeGreaterThan(
      Date.now()
    );
  });
});
