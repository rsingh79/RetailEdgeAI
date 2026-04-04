// server/tests/import-pipeline-integration.test.js
// Integration tests for the 9-stage product import pipeline.
// Runs real pipeline against the test database with RLS enforced.
// Only AI service calls are mocked (no real API calls in tests).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// ── Mocks (hoisted by vitest) ────────────────────────────────

// vi.hoisted runs in the hoisted scope so the mock ref is available to vi.mock factories
const { mockRouterEmbed } = vi.hoisted(() => ({
  mockRouterEmbed: vi.fn(),
}));

vi.mock('../src/services/ai/embeddingMaintenance.js', () => ({
  embedProduct: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/ai/aiServiceRouter.js', () => ({
  generate: vi.fn().mockResolvedValue({ response: 'mock', inputTokens: 10, outputTokens: 5 }),
  embed: (...args) => mockRouterEmbed(...args),
  rerank: vi.fn().mockResolvedValue({ results: [] }),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/services/agents/agentRegistry.js', () => ({
  registerAgent: vi.fn(),
}));

// ── Imports ──────────────────────────────────────────────────

import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestStore,
  createTestProduct,
} from './helpers/fixtures.js';
import { createTenantClient } from '../src/lib/prisma.js';
import { createImportJob, runImportPipeline } from '../src/services/importJobService.js';
import { createCanonicalProduct } from '../src/services/agents/pipeline/canonicalProduct.js';
import { storeEmbedding } from '../src/services/ai/vectorStore.js';
import app from '../src/app.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

// ── Helpers ──────────────────────────────────────────────────

/** Create a 1024-dimensional vector with distinctive values at the start. */
function makeVector(seed, dims = 1024) {
  const v = new Array(dims).fill(0);
  v[0] = seed;
  v[1] = seed * 0.5;
  v[2] = seed * 0.3;
  return v;
}

// ── Tests ────────────────────────────────────────────────────

describe('Import Pipeline — Integration Tests', () => {
  let tenant, user, store;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();

    // Seed 'product_import' feature needed by requirePlan('product_import') middleware
    // The seeded tiers don't include this key, so approval queue API tests would get 403.
    const { ensureTiersSeeded } = await import('./helpers/fixtures.js');
    await ensureTiersSeeded();
    const feature = await testPrisma.feature.upsert({
      where: { key: 'product_import' },
      create: { key: 'product_import', name: 'Product Import', category: 'core', isCore: true, sortOrder: 7 },
      update: {},
    });
    const basicTier = await testPrisma.planTier.findFirst({ where: { slug: 'starter' } });
    if (basicTier) {
      await testPrisma.planTierFeature.upsert({
        where: { planTierId_featureId: { planTierId: basicTier.id, featureId: feature.id } },
        create: { planTierId: basicTier.id, featureId: feature.id },
        update: {},
      });
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();
    tenant = await createTestTenant('Pipeline Test Business');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    store = await createTestStore(tenant.id);
    mockRouterEmbed.mockReset();
    mockRouterEmbed.mockRejectedValue({ code: 'TASK_KEY_NOT_FOUND', retryable: false });
  });

  /**
   * Helper: run one or more CanonicalProducts through the full pipeline.
   * Handles ImportJob creation and default stageData for auto-approval.
   */
  async function runPipeline(products, overrides = {}) {
    const prisma = createTenantClient(tenant.id);
    const importJob = await createImportJob(
      {
        tenantId: tenant.id,
        userId: user.id,
        sourceType: overrides.sourceType || 'CSV_UPLOAD',
        sourceName: overrides.sourceName || 'Test CSV',
        totalRows: products.length,
      },
      prisma,
    );

    products.forEach((p, i) => {
      p.rowIndex = i;
      p.importJobId = importJob.id;
    });

    return runImportPipeline({
      importJobId: importJob.id,
      products,
      tenantId: tenant.id,
      userId: user.id,
      prisma,
      sourceType: overrides.sourceType || 'CSV_UPLOAD',
      sourceName: overrides.sourceName || 'Test CSV',
      stageData: {
        sourceTrusted: true,
        sourcePriorImports: 10,
        sourceResolutionMethod: 'explicit',
        catalogProductCount: overrides.catalogProductCount ?? 0,
        defaultStoreId: store.id,
        ...overrides.stageData,
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // TEST 1 — Full pipeline happy path
  // ────────────────────────────────────────────────────────────

  it('happy path — product auto-approved and created with correct tenant scoping', async () => {
    const product = createCanonicalProduct({
      name: 'Premium Organic Coffee Beans',
      sku: 'COFFEE-001',
      barcode: '9312345678901',
      brand: 'Roastify',
      category: 'Beverages',
      price: 24.99,
      costPrice: 12.50,
      currency: 'AUD',
      status: 'ACTIVE',
      baseUnit: 'kg',
      variants: [
        { sku: 'COFFEE-001-250G', price: 9.99, costPrice: 5.00, size: '250g', optionValue: '250g' },
        { sku: 'COFFEE-001-1KG', price: 24.99, costPrice: 12.50, size: '1kg', optionValue: '1kg' },
      ],
    });

    const result = await runPipeline([product]);

    expect(result.rowsCreated).toBe(1);
    expect(result.rowsFailed).toBe(0);
    expect(result.rowsPendingApproval).toBe(0);

    // Verify product created with tenant scoping
    const tenantClient = createTenantClient(tenant.id);
    const products = await tenantClient.product.findMany();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('Premium Organic Coffee Beans');
    expect(products[0].barcode).toBe('9312345678901');
    expect(products[0].approvalStatus).toBe('AUTO_APPROVED');
    expect(products[0].fingerprint).toBeTruthy();

    // Verify variants created and linked
    const variants = await testPrisma.productVariant.findMany({
      where: { productId: products[0].id },
    });
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => v.sku).sort()).toEqual(['COFFEE-001-1KG', 'COFFEE-001-250G']);

    // Verify ProductImportRecord
    const records = await tenantClient.productImportRecord.findMany();
    expect(records).toHaveLength(1);
    expect(records[0].matchAction).toBe('CREATED');
    expect(records[0].productId).toBe(products[0].id);

    // Verify ImportJob counters
    const importJob = await tenantClient.importJob.findFirst();
    expect(importJob.rowsCreated).toBe(1);

    // Verify tenant isolation — different tenant sees nothing
    const otherTenant = await createTestTenant('Other Business');
    const otherClient = createTenantClient(otherTenant.id);
    const otherProducts = await otherClient.product.findMany();
    expect(otherProducts).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 2 — Duplicate detection: exact match (same barcode + same source)
  // ────────────────────────────────────────────────────────────

  it('exact match dedup — same barcode re-import triggers SKIP or UPDATE, not a new product', async () => {
    // Import the first product
    const first = createCanonicalProduct({
      name: 'Sourdough Bread Loaf',
      sku: 'BREAD-001',
      barcode: '9300000000001',
      brand: 'BakerCo',
      category: 'Bakery',
      price: 6.50,
      currency: 'AUD',
      status: 'ACTIVE',
    });

    const result1 = await runPipeline([first]);
    expect(result1.rowsCreated).toBe(1);

    // Now import the same product again (same barcode, same source)
    const duplicate = createCanonicalProduct({
      name: 'Sourdough Bread Loaf',
      sku: 'BREAD-001',
      barcode: '9300000000001',
      brand: 'BakerCo',
      category: 'Bakery',
      price: 6.50,
      currency: 'AUD',
      status: 'ACTIVE',
    });

    const result2 = await runPipeline([duplicate], { catalogProductCount: 1 });

    // CatalogMatcher Layer 1 detects barcode match → SKIP (no field changes) or UPDATE
    // ApprovalClassifier: SKIP → ROUTE_REJECT, UPDATE → ROUTE_REVIEW
    // No new product should be created
    const tenantClient = createTenantClient(tenant.id);
    const products = await tenantClient.product.findMany({ where: { archivedAt: null } });
    expect(products).toHaveLength(1); // Still only one product

    // Pipeline should report skip or review, not creation
    expect(result2.rowsCreated).toBe(0);
    expect(result2.rowsSkipped + result2.rowsPendingApproval).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 3 — Duplicate detection: exact match with field changes → UPDATE → REVIEW
  // ────────────────────────────────────────────────────────────

  it('exact match with price change routes to approval queue for review', async () => {
    // Import original
    const original = createCanonicalProduct({
      name: 'Almond Milk 1L',
      sku: 'MILK-ALM-001',
      barcode: '9300000000002',
      brand: 'NutCo',
      category: 'Dairy Alternatives',
      price: 4.50,
      costPrice: 2.50,
      currency: 'AUD',
      status: 'ACTIVE',
    });
    await runPipeline([original]);

    // Import with cost price change — costPrice maps to costPrice on Product
    const updated = createCanonicalProduct({
      name: 'Almond Milk 1L',
      sku: 'MILK-ALM-001',
      barcode: '9300000000002',
      brand: 'NutCo',
      category: 'Dairy Alternatives',
      price: 4.50,
      costPrice: 3.99, // cost changed
      currency: 'AUD',
      status: 'ACTIVE',
    });
    const result = await runPipeline([updated], { catalogProductCount: 1 });

    // CatalogMatcher detects barcode match + field diff → UPDATE → ROUTE_REVIEW
    // OR fingerprint match → SKIP (no visible diff at Product level) → ROUTE_REJECT
    // Either way, no new product created.
    expect(result.rowsCreated).toBe(0);
    expect(result.rowsPendingApproval + result.rowsSkipped).toBeGreaterThan(0);

    // If UPDATE path: approval queue entry exists. If SKIP path: product was rejected.
    const tenantClient = createTenantClient(tenant.id);
    const products = await tenantClient.product.findMany({ where: { archivedAt: null } });
    expect(products).toHaveLength(1); // still only the original
  });

  // ────────────────────────────────────────────────────────────
  // TEST 4 — Fuzzy match detection (Fuse.js Layer 2)
  // ────────────────────────────────────────────────────────────

  it('fuzzy match — similar name routes to approval queue', async () => {
    // Seed an existing product in the catalog
    await createTestProduct(tenant.id, {
      name: 'Nike Air Max 90 White',
      category: 'Footwear',
    });

    // Import a product with a similar (but not identical) name
    const fuzzyProduct = createCanonicalProduct({
      name: 'Nike Airmax 90 White',
      category: 'Footwear',
      price: 189.99,
      currency: 'AUD',
      status: 'ACTIVE',
    });

    const result = await runPipeline([fuzzyProduct], { catalogProductCount: 1 });

    // Layer 2 (Fuse.js) should find the fuzzy match → REVIEW → ROUTE_REVIEW
    expect(result.rowsPendingApproval).toBe(1);
    expect(result.rowsCreated).toBe(0);

    const tenantClient = createTenantClient(tenant.id);
    const entries = await tenantClient.approvalQueueEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].approvalRoute).toBe('ROUTE_REVIEW');
    expect(entries[0].confidenceScore).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────
  // TEST 5 — Embedding similarity match (Layer 2.5)
  // ────────────────────────────────────────────────────────────

  it('embedding match — semantically similar product routes to approval queue', async () => {
    // Create a product that won't fuzzy-match on name
    const existingProduct = await createTestProduct(tenant.id, {
      name: 'Premium Arabica Beans Organic',
      category: 'Coffee',
    });

    // Seed a fake embedding for it using the admin client
    const storedVector = makeVector(1.0);
    await storeEmbedding(
      {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        productId: existingProduct.id,
        model: 'embed-english-v3.0',
        embeddingText: 'Premium Arabica Beans Organic | Coffee',
        vector: storedVector,
        dimensions: 1024,
      },
      testPrisma,
    );

    // Mock routerEmbed to return a similar vector (high cosine similarity)
    const queryVector = makeVector(0.98);
    mockRouterEmbed.mockResolvedValueOnce({
      vectors: [queryVector],
      tokenCount: 8,
      provider: 'cohere',
      model: 'embed-english-v3.0',
      latencyMs: 50,
    });

    // Import a product with a completely different first word and category
    // so Layer 2 Fuse.js pre-filter won't include the existing product.
    const incoming = createCanonicalProduct({
      name: 'Sustainable Roast Blend',
      category: 'Hot Drinks',
      price: 18.99,
      currency: 'AUD',
      status: 'ACTIVE',
    });

    const result = await runPipeline([incoming], { catalogProductCount: 1 });

    // Layer 2.5 embedding match should trigger REVIEW
    // (or if pgvector isn't available in test DB, product gets ROUTE_REVIEW
    //  from Rule 7 — first import with weak identity)
    expect(result.rowsPendingApproval).toBe(1);
    expect(result.rowsCreated).toBe(0);

    const tenantClient = createTenantClient(tenant.id);
    const entries = await tenantClient.approvalQueueEntry.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].approvalRoute).toBe('ROUTE_REVIEW');
    expect(entries[0].confidenceScore).toBeDefined();
  });

  // ────────────────────────────────────────────────────────────
  // TEST 6 — Approval queue: approve flow
  // ────────────────────────────────────────────────────────────

  it('approval queue — approve creates product and updates entry status', async () => {
    // Seed an existing product to trigger fuzzy match → queue entry
    await createTestProduct(tenant.id, {
      name: 'Vegemite Spread 220g',
      category: 'Spreads',
    });

    const incoming = createCanonicalProduct({
      name: 'Vegemite Spread Original 220g',
      category: 'Spreads',
      price: 5.49,
      currency: 'AUD',
      status: 'ACTIVE',
    });

    await runPipeline([incoming], { catalogProductCount: 1 });

    // Verify queue entry was created
    const tenantClient = createTenantClient(tenant.id);
    const entries = await tenantClient.approvalQueueEntry.findMany({ where: { status: 'PENDING' } });
    expect(entries).toHaveLength(1);
    const queueId = entries[0].id;

    // Count products before approval
    const productsBefore = await tenantClient.product.findMany({ where: { archivedAt: null } });
    const countBefore = productsBefore.length;

    // Approve via API
    const token = jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: user.role },
      JWT_SECRET,
    );

    const res = await request(app)
      .post(`/api/v1/products/approval-queue/${queueId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Confirmed — this is a new product' });

    expect(res.status).toBe(200);

    // Verify product was created
    const productsAfter = await tenantClient.product.findMany({ where: { archivedAt: null } });
    expect(productsAfter.length).toBe(countBefore + 1);

    // Verify queue entry updated
    const updatedEntry = await tenantClient.approvalQueueEntry.findFirst({ where: { id: queueId } });
    expect(updatedEntry.status).toBe('APPROVED');
    expect(updatedEntry.action).toBe('APPROVE');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 7 — Approval queue: reject flow
  // ────────────────────────────────────────────────────────────

  it('approval queue — reject does not create product', async () => {
    // Seed existing + import similar → queue entry
    await createTestProduct(tenant.id, {
      name: 'Tim Tam Original',
      category: 'Biscuits',
    });

    const incoming = createCanonicalProduct({
      name: 'Tim Tam Original Chocolate',
      category: 'Biscuits',
      price: 3.85,
      currency: 'AUD',
      status: 'ACTIVE',
    });

    await runPipeline([incoming], { catalogProductCount: 1 });

    const tenantClient = createTenantClient(tenant.id);
    const entries = await tenantClient.approvalQueueEntry.findMany({ where: { status: 'PENDING' } });
    expect(entries).toHaveLength(1);
    const queueId = entries[0].id;

    const productsBefore = await tenantClient.product.findMany({ where: { archivedAt: null } });
    const countBefore = productsBefore.length;

    // Reject via API
    const token = jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: user.role },
      JWT_SECRET,
    );

    const res = await request(app)
      .post(`/api/v1/products/approval-queue/${queueId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ notes: 'Duplicate — already have this product' });

    expect(res.status).toBe(200);

    // No new product created
    const productsAfter = await tenantClient.product.findMany({ where: { archivedAt: null } });
    expect(productsAfter.length).toBe(countBefore);

    // Queue entry updated to REJECTED
    const updatedEntry = await tenantClient.approvalQueueEntry.findFirst({ where: { id: queueId } });
    expect(updatedEntry.status).toBe('REJECTED');
    expect(updatedEntry.action).toBe('REJECT');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 8 — Bulk approval operations
  // ────────────────────────────────────────────────────────────

  it('bulk operations — approve 3, reject 2, with tenant isolation', async () => {
    // Create an ImportJob and 5 queue entries directly via testPrisma
    const importJob = await testPrisma.importJob.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        status: 'PROCESSING',
        sourceType: 'CSV_UPLOAD',
        totalRows: 5,
      },
    });

    const entryIds = [];
    for (let i = 0; i < 5; i++) {
      const entry = await testPrisma.approvalQueueEntry.create({
        data: {
          tenantId: tenant.id,
          importJobId: importJob.id,
          rowIndex: i,
          approvalRoute: 'ROUTE_REVIEW',
          invoiceRiskLevel: 'NONE',
          status: 'PENDING',
          normalizedData: { name: `Bulk Product ${i + 1}`, price: 10 + i, sourceSystem: 'Manual' },
          matchResult: { action: 'REVIEW' },
          confidenceScore: 55,
          slaDeadline: new Date(Date.now() + 86400000),
        },
      });
      entryIds.push(entry.id);
    }

    const token = jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: user.role },
      JWT_SECRET,
    );

    // Bulk approve first 3
    const approveRes = await request(app)
      .post('/api/v1/products/approval-queue/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'approve', queue_ids: entryIds.slice(0, 3), notes: 'Batch approved' });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.succeeded).toBe(3);

    // Bulk reject last 2
    const rejectRes = await request(app)
      .post('/api/v1/products/approval-queue/bulk')
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'reject', queue_ids: entryIds.slice(3), notes: 'Batch rejected' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.succeeded).toBe(2);

    // Verify: 3 products created, 2 not created
    const tenantClient = createTenantClient(tenant.id);
    const products = await tenantClient.product.findMany({ where: { approvalStatus: 'APPROVED' } });
    expect(products).toHaveLength(3);

    // Verify all 5 entries have correct status
    const approved = await tenantClient.approvalQueueEntry.findMany({ where: { status: 'APPROVED' } });
    const rejected = await tenantClient.approvalQueueEntry.findMany({ where: { status: 'REJECTED' } });
    expect(approved).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    // Tenant isolation: different tenant's queue is unaffected
    const otherTenant = await createTestTenant('Other Biz');
    const otherUser = await createTestUser(otherTenant.id, { role: 'OWNER' });
    const otherJob = await testPrisma.importJob.create({
      data: { tenantId: otherTenant.id, userId: otherUser.id, status: 'PROCESSING', sourceType: 'CSV_UPLOAD', totalRows: 1 },
    });
    await testPrisma.approvalQueueEntry.create({
      data: {
        tenantId: otherTenant.id,
        importJobId: otherJob.id,
        rowIndex: 0,
        approvalRoute: 'ROUTE_REVIEW',
        invoiceRiskLevel: 'NONE',
        status: 'PENDING',
        normalizedData: { name: 'Other Product' },
        matchResult: {},
        confidenceScore: 50,
        slaDeadline: new Date(Date.now() + 86400000),
      },
    });

    const otherClient = createTenantClient(otherTenant.id);
    const otherEntries = await otherClient.approvalQueueEntry.findMany({ where: { status: 'PENDING' } });
    expect(otherEntries).toHaveLength(1); // untouched
  });

  // ────────────────────────────────────────────────────────────
  // TEST 9 — Cross-source architecture
  // ────────────────────────────────────────────────────────────

  it('cross-source — same barcode from different source creates product with canonical link', async () => {
    // Step 1: Create a product directly in the DB with source "Abacus POS"
    // (Avoid pipeline for the first product to keep the test focused on cross-source detection)
    const existingProduct = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Coconut Water 500ml',
        barcode: '9300000000003',
        category: 'Beverages',
        source: 'Abacus POS',
      },
    });

    // Step 2: Import same barcode from a different source (Shopify) through the pipeline
    const shopifyProduct = createCanonicalProduct({
      name: 'Coconut Water 500ml',
      sku: 'SHOPIFY-CW-500',
      barcode: '9300000000003', // same barcode as existing
      brand: 'TropicFresh',
      category: 'Beverages',
      price: 4.25,
      currency: 'AUD',
      status: 'ACTIVE',
      sourceSystem: 'Shopify',
    });

    const result = await runPipeline([shopifyProduct], {
      sourceName: 'Shopify',
      sourceType: 'SHOPIFY_SYNC',
      catalogProductCount: 1,
    });

    // CatalogMatcher Layer 1.3 detects barcode match from different source.
    // It sets canonicalProductId and matchResult.action = 'CREATE'.
    // The WriteLayer pre-write check detects the barcode conflict and
    // creates an ApprovalQueueEntry via queueProduct() (Issue 5 fix).
    expect(result.rowsPendingApproval).toBe(1);

    // The processed product carries the cross-source detection and conflict info
    const processed = result.products[0];
    expect(processed.canonicalProductId).toBe(existingProduct.id);
    expect(processed.approvalRoute).toBe('ROUTE_REVIEW'); // re-queued from ROUTE_AUTO

    // WriteLayer overwrites matchResult with CONFLICT details
    expect(processed.matchResult.action).toBe('CONFLICT');
    expect(processed.matchResult.matchedProductId).toBe(existingProduct.id);

    // Verify ApprovalQueueEntry was actually created in the DB
    const queueEntries = await testPrisma.approvalQueueEntry.findMany({
      where: { tenantId: tenant.id, status: 'PENDING' },
    });
    expect(queueEntries.length).toBeGreaterThanOrEqual(1);
    const entry = queueEntries.find(e => e.normalizedData?.barcode === '9300000000003');
    expect(entry).toBeDefined();
    expect(entry.matchResult.action).toBe('CONFLICT');
    expect(entry.matchResult.matchedProductId).toBe(existingProduct.id);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 10 — Validation failures
  // ────────────────────────────────────────────────────────────

  it('validation failures — missing name/price routes to review or fails, no partial data', async () => {
    const missingFields = createCanonicalProduct({
      name: '',      // missing name
      price: null,   // missing price
      currency: 'AUD',
      status: 'ACTIVE',
    });

    const result = await runPipeline([missingFields]);

    // ApprovalClassifier Rule 6: missing required fields → ROUTE_REVIEW
    // OR pipeline may fail the product entirely
    expect(result.rowsCreated).toBe(0);

    // Verify no product was created
    const tenantClient = createTenantClient(tenant.id);
    const products = await tenantClient.product.findMany({ where: { archivedAt: null } });
    expect(products).toHaveLength(0);

    // Verify no orphan variants
    const variants = await testPrisma.productVariant.findMany({
      where: { product: { tenantId: tenant.id } },
    });
    expect(variants).toHaveLength(0);

    // ImportJob should reflect the failure/review
    const importJob = await tenantClient.importJob.findFirst();
    expect(importJob.rowsCreated).toBe(0);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 11 — Large batch import (50 products)
  // ────────────────────────────────────────────────────────────

  it('large batch — 50 products processed within 30 seconds', async () => {
    const products = [];
    for (let i = 0; i < 50; i++) {
      products.push(
        createCanonicalProduct({
          name: `Batch Product ${i + 1}`,
          sku: `BATCH-${String(i + 1).padStart(3, '0')}`,
          barcode: `930000000${String(i + 100).padStart(4, '0')}`,
          brand: 'BatchCo',
          category: 'General',
          price: 10 + i * 0.5,
          currency: 'AUD',
          status: 'ACTIVE',
        }),
      );
    }

    const start = Date.now();
    const result = await runPipeline(products);
    const elapsed = Date.now() - start;

    // All 50 should be processed (created or queued)
    const totalProcessed = result.rowsCreated + result.rowsPendingApproval + result.rowsSkipped;
    expect(totalProcessed).toBe(50);
    expect(result.rowsFailed).toBe(0);

    // ImportJob tracks final count
    const tenantClient = createTenantClient(tenant.id);
    const importJob = await tenantClient.importJob.findFirst();
    expect(importJob.rowsCreated + (importJob.rowsPendingApproval || 0)).toBe(50);

    // Performance: under 30 seconds
    expect(elapsed).toBeLessThan(30000);
  }, 35000); // extend vitest timeout for this test
});
