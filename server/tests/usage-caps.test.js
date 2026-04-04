import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { testPrisma, rlsPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestTenantWithPlan,
  createTestUser,
  createTestProduct,
  createTestSystemAdmin,
  createTestGmailIntegration,
  createTestFolderIntegration,
  ensureTiersSeeded,
} from './helpers/fixtures.js';
import { createTenantClient } from '../src/lib/prisma.js';

// ── Mocks — prevent real AI calls ──
vi.mock('../src/services/ai/aiServiceRouter.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    generate: vi.fn().mockResolvedValue({
      response: 'mock response',
      inputTokens: 100,
      outputTokens: 50,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      latencyMs: 200,
    }),
    embed: vi.fn().mockResolvedValue({ vectors: [[0.1]], tokenCount: 10 }),
    rerank: vi.fn().mockResolvedValue({ results: [] }),
    invalidateCache: vi.fn(),
  };
});

// Direct imports for unit-style testing
import {
  getCurrentUsage,
  incrementUsage,
  checkCapacity,
  getUsageSummary,
  resetUsage,
  updateLimitsForTierChange,
} from '../src/services/usageTracker.js';
import { TIER_LIMITS, AI_THROTTLE } from '../src/config/tierLimits.js';
import { checkProductCapacity } from '../src/middleware/usageEnforcement.js';
import { getAnalysisWindowStart, getDataBeyondWindow } from '../src/services/analytics/salesAnalysis.js';
import app from '../src/app.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';
function makeToken(user) {
  return jwt.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, JWT_SECRET);
}

// ══════════════════════════════════════════════════════════════
// TenantUsage Schema and RLS
// ══════════════════════════════════════════════════════════════

describe('TenantUsage schema and RLS', () => {
  let tenantA, tenantB;

  beforeAll(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenantA = await createTestTenantWithPlan('Tenant A', 'starter');
    tenantB = await createTestTenantWithPlan('Tenant B', 'starter');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('RLS policy active on TenantUsage', async () => {
    // Create usage records for both tenants
    await getCurrentUsage(null, tenantA.id);
    await getCurrentUsage(null, tenantB.id);

    // Query as tenant A via RLS-enforced client
    const tenantAPrisma = createTenantClient(tenantA.id);
    const records = await tenantAPrisma.tenantUsage.findMany();
    expect(records.length).toBe(1);
    expect(records[0].tenantId).toBe(tenantA.id);
  });

  it('Tenant B cannot see Tenant A usage records', async () => {
    // Query as tenant B — should only see its own record
    const tenantBPrisma = createTenantClient(tenantB.id);
    const records = await tenantBPrisma.tenantUsage.findMany();
    expect(records.length).toBe(1);
    expect(records[0].tenantId).toBe(tenantB.id);
  });
});

// ══════════════════════════════════════════════════════════════
// Usage Tracking Service
// ══════════════════════════════════════════════════════════════

describe('Usage tracking service', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Usage Test Biz', 'starter');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('getCurrentUsage creates new record for current period if none exists', async () => {
    const usage = await getCurrentUsage(null, tenant.id);
    expect(usage).toBeDefined();
    expect(usage.tenantId).toBe(tenant.id);
    expect(usage.aiQueriesUsed).toBe(0);
    expect(usage.aiQueriesLimit).toBe(50); // starter tier
  });

  it('getCurrentUsage returns existing record if one exists', async () => {
    const first = await getCurrentUsage(null, tenant.id);
    const second = await getCurrentUsage(null, tenant.id);
    expect(first.id).toBe(second.id);
  });

  it('incrementUsage atomically increments the counter', async () => {
    const result = await incrementUsage(null, tenant.id, 'aiQueries');
    expect(result.currentUsage).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.remaining).toBe(49);
    expect(result.percentUsed).toBe(2);
    expect(result.isUnlimited).toBe(false);
  });

  it('incrementUsage returns correct remaining count and percentUsed', async () => {
    // Increment 25 times
    for (let i = 0; i < 25; i++) {
      await incrementUsage(null, tenant.id, 'aiQueries');
    }
    const result = await incrementUsage(null, tenant.id, 'aiQueries');
    expect(result.currentUsage).toBe(26);
    expect(result.remaining).toBe(24);
    expect(result.percentUsed).toBe(52);
  });

  it('checkCapacity returns allowed=true when under limit', async () => {
    const result = await checkCapacity(null, tenant.id, 'aiQueries');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50);
  });

  it('checkCapacity returns allowed=false when at or over limit', async () => {
    // Set usage to the limit
    const usage = await getCurrentUsage(null, tenant.id);
    await testPrisma.tenantUsage.update({
      where: { id: usage.id },
      data: { aiQueriesUsed: 50 },
    });
    const result = await checkCapacity(null, tenant.id, 'aiQueries');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('Unlimited tier (-1) is never blocked', async () => {
    const entTenant = await createTestTenantWithPlan('Enterprise Biz', 'enterprise');
    const result = await checkCapacity(null, entTenant.id, 'aiQueries');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });
});

// ══════════════════════════════════════════════════════════════
// Concurrent Increment Safety
// ══════════════════════════════════════════════════════════════

describe('Concurrent increment safety', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Concurrency Test', 'growth');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('Fire 10 concurrent incrementUsage calls — final count is exactly 10', async () => {
    // Ensure record exists first
    await getCurrentUsage(null, tenant.id);

    const promises = Array.from({ length: 10 }, () =>
      incrementUsage(null, tenant.id, 'aiQueries'),
    );
    await Promise.all(promises);

    const usage = await getCurrentUsage(null, tenant.id);
    expect(usage.aiQueriesUsed).toBe(10);
  });
});

// ══════════════════════════════════════════════════════════════
// AI Query Enforcement — Three-Stage Behaviour
// ══════════════════════════════════════════════════════════════

describe('AI query enforcement — three-stage behaviour', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('AI Throttle Test', 'starter');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  async function setAiUsage(count) {
    const usage = await getCurrentUsage(null, tenant.id);
    await testPrisma.tenantUsage.update({
      where: { id: usage.id },
      data: { aiQueriesUsed: count },
    });
  }

  it('Stage 1 (normal): at 88% — increment returns low percentUsed, no warning', async () => {
    await setAiUsage(43); // Next increment → 44/50 = 88%
    const result = await incrementUsage(null, tenant.id, 'aiQueries');
    expect(result.percentUsed).toBe(88);
    expect(result.percentUsed).toBeLessThan(AI_THROTTLE.softWarningPercent);
  });

  it('Stage 2 (soft warning): at 90% — percentUsed crosses warning threshold', async () => {
    await setAiUsage(44); // Next increment → 45/50 = 90%
    const result = await incrementUsage(null, tenant.id, 'aiQueries');
    expect(result.percentUsed).toBe(90);
    expect(result.percentUsed).toBeGreaterThanOrEqual(AI_THROTTLE.softWarningPercent);
    expect(result.percentUsed).toBeLessThan(AI_THROTTLE.throttlePercent);
    expect(result.remaining).toBe(5);
  });

  it('Stage 3 (throttle): at 96% — crosses throttle threshold', async () => {
    await setAiUsage(47); // Next increment → 48/50 = 96%
    const result = await incrementUsage(null, tenant.id, 'aiQueries');
    expect(result.percentUsed).toBe(96);
    expect(result.percentUsed).toBeGreaterThanOrEqual(AI_THROTTLE.throttlePercent);
    expect(result.percentUsed).toBeLessThan(AI_THROTTLE.hardLimitPercent);
  });

  it('Stage 4 (hard limit): at 100% — crosses hard limit', async () => {
    await setAiUsage(49); // Next increment → 50/50 = 100%
    const result = await incrementUsage(null, tenant.id, 'aiQueries');
    expect(result.percentUsed).toBe(100);
    expect(result.percentUsed).toBeGreaterThanOrEqual(AI_THROTTLE.hardLimitPercent);
    expect(result.remaining).toBe(0);
  });

  it('Enterprise tier (unlimited): percentUsed stays 0 regardless of count', async () => {
    const entTenant = await createTestTenantWithPlan('Enterprise', 'enterprise');
    const usage = await getCurrentUsage(null, entTenant.id);
    await testPrisma.tenantUsage.update({
      where: { id: usage.id },
      data: { aiQueriesUsed: 999999 },
    });
    const result = await incrementUsage(null, entTenant.id, 'aiQueries');
    expect(result.isUnlimited).toBe(true);
    expect(result.percentUsed).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════
// Product Import Enforcement
// ══════════════════════════════════════════════════════════════

describe('Product import enforcement', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Product Import Test', 'starter');
    // Starter limit = 500 products
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('Import of 50 products succeeds when at 450 (exactly at limit)', async () => {
    const result = await checkProductCapacity(null, tenant.id, 450, 50);
    expect(result.allowed).toBe(true);
  });

  it('Import of 51 products returns allowed=false with remaining capacity', async () => {
    const result = await checkProductCapacity(null, tenant.id, 450, 51);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(50);
    expect(result.importSize).toBe(51);
    expect(result.message).toContain('500');
    expect(result.message).toContain('450');
    expect(result.message).toContain('51');
  });
});

// ══════════════════════════════════════════════════════════════
// Integration Enforcement
// ══════════════════════════════════════════════════════════════

describe('Integration enforcement', () => {
  let starterTenant, starterUser, starterToken;
  let growthTenant, growthUser, growthToken;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();

    starterTenant = await createTestTenantWithPlan('Starter Int Test', 'starter');
    starterUser = await createTestUser(starterTenant.id, { role: 'OWNER' });
    starterToken = makeToken(starterUser);

    growthTenant = await createTestTenantWithPlan('Growth Int Test', 'growth');
    growthUser = await createTestUser(growthTenant.id, { role: 'OWNER' });
    growthToken = makeToken(growthUser);

    // Create usage records
    await getCurrentUsage(null, starterTenant.id);
    await getCurrentUsage(null, growthTenant.id);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('Growth tenant at integration limit (3/3) is blocked from connecting another', async () => {
    // Fill up growth tenant's 3 integration slots
    await testPrisma.shopifyIntegration.create({
      data: { tenantId: growthTenant.id, shop: 'growth.myshopify.com', isActive: true },
    });
    await createTestGmailIntegration(growthTenant.id);
    await createTestFolderIntegration(growthTenant.id);

    // Try to save Drive credentials — should be blocked (3/3 used)
    const res = await request(app)
      .post('/api/drive/save-credentials')
      .set('Authorization', `Bearer ${growthToken}`)
      .send({ googleClientId: 'test.apps.googleusercontent.com', googleClientSecret: 'secret' });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('INTEGRATION_LIMIT_REACHED');
    expect(res.body.activeCount).toBe(3);
    expect(res.body.limit).toBe(3);
  });

  it('Growth tenant with 1/3 integrations can connect another', async () => {
    // Connect only Shopify for growth tenant (1/3)
    await testPrisma.shopifyIntegration.create({
      data: { tenantId: growthTenant.id, shop: 'growth.myshopify.com', isActive: true },
    });

    // Gmail save-credentials — should pass integration limit check (1/3)
    // Will get a different error downstream but NOT 429
    const res = await request(app)
      .post('/api/gmail/save-credentials')
      .set('Authorization', `Bearer ${growthToken}`)
      .send({ googleClientId: 'test.apps.googleusercontent.com', googleClientSecret: 'secret' });

    expect(res.status).not.toBe(429);
  });
});

// ══════════════════════════════════════════════════════════════
// Historical Sync — Tier Enforcement
// ══════════════════════════════════════════════════════════════

describe('Historical sync — tier enforcement', () => {
  let tenant, user, token;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Sync Test', 'growth');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    token = makeToken(user);

    // Create ShopifyIntegration
    await testPrisma.shopifyIntegration.create({
      data: {
        tenantId: tenant.id,
        shop: 'sync-test.myshopify.com',
        accessTokenEnc: 'enc:test_token',
        isActive: true,
      },
    });
    await getCurrentUsage(null, tenant.id);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('GET /sync-options returns maxMonthsAllowed matching tier', async () => {
    const res = await request(app)
      .get('/api/shopify/sync-options')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.maxMonthsAllowed).toBe(24); // growth
    expect(res.body.tierName).toBe('Growth');
  });

  it('Growth options: [1, 3, 6, 12, 24]', async () => {
    const res = await request(app)
      .get('/api/shopify/sync-options')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.options).toEqual([1, 3, 6, 12, 24]);
  });

  it('alreadySynced=false before first sync, true after', async () => {
    const before = await request(app)
      .get('/api/shopify/sync-options')
      .set('Authorization', `Bearer ${token}`);
    expect(before.body.alreadySynced).toBe(false);

    // Mark as synced
    await testPrisma.shopifyIntegration.update({
      where: { tenantId: tenant.id },
      data: { historicalSyncedAt: new Date() },
    });

    const after = await request(app)
      .get('/api/shopify/sync-options')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.alreadySynced).toBe(true);
  });

  it('POST /sync-orders rejects request exceeding tier max with 400', async () => {
    const res = await request(app)
      .post('/api/shopify/sync-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ historicalMonths: 36 }); // Growth max is 24

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HISTORICAL_SYNC_LIMIT');
    expect(res.body.maxAllowed).toBe(24);
  });

  it('PUT /auto-sync toggles the setting', async () => {
    const onRes = await request(app)
      .put('/api/shopify/auto-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true });

    expect(onRes.status).toBe(200);
    expect(onRes.body.autoSyncEnabled).toBe(true);
    expect(onRes.body.consentedAt).toBeDefined();

    const offRes = await request(app)
      .put('/api/shopify/auto-sync')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false });

    expect(offRes.status).toBe(200);
    expect(offRes.body.autoSyncEnabled).toBe(false);
  });

  it('POST /sync-now returns 400 if no previous sync exists', async () => {
    const res = await request(app)
      .post('/api/shopify/sync-now')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No previous sync');
  });
});

// ══════════════════════════════════════════════════════════════
// Billing Period Rollover
// ══════════════════════════════════════════════════════════════

describe('Billing period rollover', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Rollover Test', 'starter');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('getCurrentUsage for new month creates fresh record with zero counters', async () => {
    const usage = await getCurrentUsage(null, tenant.id);
    expect(usage.aiQueriesUsed).toBe(0);
    expect(usage.productsImported).toBe(0);
    expect(usage.integrationsUsed).toBe(0);
  });

  it('Limits set from tenant current tier', async () => {
    const usage = await getCurrentUsage(null, tenant.id);
    expect(usage.aiQueriesLimit).toBe(50); // starter
    expect(usage.productsLimit).toBe(500);
    expect(usage.integrationsLimit).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
// Tier Upgrade
// ══════════════════════════════════════════════════════════════

describe('Tier upgrade', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Upgrade Test', 'starter');
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('updateLimitsForTierChange updates current period limits immediately', async () => {
    await getCurrentUsage(null, tenant.id);

    // Upgrade to growth
    await updateLimitsForTierChange(null, tenant.id, 'growth');

    const updated = await getCurrentUsage(null, tenant.id);
    expect(updated.aiQueriesLimit).toBe(200); // growth
    expect(updated.productsLimit).toBe(5000);
    expect(updated.integrationsLimit).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════
// Usage API Endpoint
// ══════════════════════════════════════════════════════════════

describe('Usage API endpoint', () => {
  let tenant, user, token;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Usage API Test', 'starter');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    token = makeToken(user);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('GET /api/usage/summary returns products and integrations (NOT AI usage)', async () => {
    const res = await request(app)
      .get('/api/usage/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.products).toBeDefined();
    expect(res.body.products.limit).toBe(500);
    expect(res.body.integrations).toBeDefined();
    expect(res.body.tier).toBe('starter');
    // AI usage must NOT be present
    expect(res.body.aiQueries).toBeUndefined();
    expect(res.body._internal).toBeUndefined();
  });

  it('Requires authentication', async () => {
    const res = await request(app).get('/api/usage/summary');
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════
// Analysis Window Enforcement
// ══════════════════════════════════════════════════════════════

describe('Analysis window enforcement', () => {
  let tenant;

  beforeEach(async () => {
    await cleanDatabase();
    await ensureTiersSeeded();
    tenant = await createTestTenantWithPlan('Window Test', 'starter');
    await getCurrentUsage(null, tenant.id);
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it('Starter tenant (12-month window) returns a window start ~12 months ago', async () => {
    const windowStart = await getAnalysisWindowStart(null, tenant.id);
    expect(windowStart).toBeDefined();
    const monthsAgo = (Date.now() - windowStart.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    expect(monthsAgo).toBeCloseTo(12, 0);
  });

  it('Enterprise tenant returns null (unlimited window)', async () => {
    const entTenant = await createTestTenantWithPlan('Enterprise Window', 'enterprise');
    await getCurrentUsage(null, entTenant.id);
    const windowStart = await getAnalysisWindowStart(null, entTenant.id);
    expect(windowStart).toBeNull();
  });

  it('getDataBeyondWindow returns hasDataBeyondWindow=false when no data', async () => {
    const tenantPrisma = createTenantClient(tenant.id);
    const result = await getDataBeyondWindow(tenantPrisma, tenant.id);
    expect(result.hasDataBeyondWindow).toBe(false);
  });
});
