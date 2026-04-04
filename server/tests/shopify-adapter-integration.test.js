// server/tests/shopify-adapter-integration.test.js
// Integration tests for the Shopify pipeline adapter.
// Mocks: global.fetch (Shopify API), encryption, AI services.
// Real: database operations, import pipeline, RLS enforcement.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── Mocks (hoisted by vitest) ────────────────────────────────

vi.mock('../src/services/ai/embeddingMaintenance.js', () => ({
  embedProduct: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/ai/aiServiceRouter.js', () => ({
  generate: vi.fn().mockResolvedValue({ response: 'mock', inputTokens: 10, outputTokens: 5 }),
  embed: vi.fn().mockRejectedValue({ code: 'TASK_KEY_NOT_FOUND', retryable: false }),
  rerank: vi.fn().mockResolvedValue({ results: [] }),
  invalidateCache: vi.fn(),
}));

vi.mock('../src/services/agents/agentRegistry.js', () => ({
  registerAgent: vi.fn(),
}));

vi.mock('../src/lib/encryption.js', () => ({
  encrypt: vi.fn((val) => `enc:${val}`),
  decrypt: vi.fn((val) => (typeof val === 'string' ? val.replace('enc:', '') : val)),
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
import { syncProducts } from '../src/services/shopify.js';

// ── Shopify API mock helpers ─────────────────────────────────

function makeShopifyProduct(overrides = {}) {
  const id = overrides.id || Math.floor(Math.random() * 1e9);
  return {
    id,
    title: overrides.title || `Shopify Product ${id}`,
    handle: overrides.handle || `shopify-product-${id}`,
    vendor: overrides.vendor || 'TestVendor',
    product_type: overrides.product_type || 'General',
    variants: overrides.variants || [
      {
        id: id * 10 + 1,
        sku: overrides.sku || `SHOP-${id}`,
        price: String(overrides.price || '29.99'),
        barcode: overrides.barcode || null,
        weight: overrides.weight || 500,
        weight_unit: overrides.weight_unit || 'g',
        title: 'Default Title',
      },
    ],
  };
}

function makeShopifyApiResponse(products, hasNextPage = false) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ products }),
    text: () => Promise.resolve(JSON.stringify({ products })),
    headers: {
      get: (name) => {
        if (name === 'Link' && hasNextPage) {
          return '<https://test.myshopify.com/admin/api/2026-01/products.json?page=2>; rel="next"';
        }
        return null;
      },
    },
  };
}

function makeErrorResponse(status, body = 'Server Error') {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve({ error: body }),
    headers: { get: () => null },
  };
}

function makeRateLimitResponse() {
  return {
    ok: false,
    status: 429,
    text: () => Promise.resolve('Rate limited'),
    headers: { get: (name) => (name === 'Retry-After' ? '0.01' : null) },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('Shopify Adapter — Integration Tests', () => {
  let tenant, user, originalFetch;

  beforeAll(async () => {
    await cleanDatabase();
    originalFetch = global.fetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();
    tenant = await createTestTenant('Shopify Test Business');
    user = await createTestUser(tenant.id, { role: 'OWNER' });

    // Create ShopifyIntegration for the tenant (required by syncProducts)
    await testPrisma.shopifyIntegration.create({
      data: {
        tenantId: tenant.id,
        shop: 'test-store.myshopify.com',
        accessTokenEnc: 'enc:shpat_test_token_12345',
        isActive: true,
      },
    });
  });

  // ────────────────────────────────────────────────────────────
  // TEST 1 — New products sync (Phase 2: unmatched → pipeline)
  // ────────────────────────────────────────────────────────────

  it('new products — synced through shared import pipeline, source = shopify', async () => {
    const shopifyProducts = [
      makeShopifyProduct({ id: 1001, title: 'Artisan Soap Bar', sku: 'SOAP-001', price: '12.99', barcode: '9310000001001' }),
      makeShopifyProduct({ id: 1002, title: 'Shea Butter Lotion', sku: 'LOTION-001', price: '18.50' }),
      makeShopifyProduct({ id: 1003, title: 'Lavender Essential Oil', sku: 'OIL-001', price: '24.00' }),
    ];

    // Mock Shopify API: return products, then empty (no pagination)
    const mockFetch = vi.fn().mockResolvedValue(makeShopifyApiResponse(shopifyProducts));
    global.fetch = mockFetch;

    const prisma = createTenantClient(tenant.id);
    const stats = await syncProducts(prisma, tenant.id);

    expect(stats.productsPulled).toBe(3);
    // Phase 2 processes all 3 (no identity match → pipeline)
    expect(stats.productsPipelined).toBe(3);

    // Verify products in DB
    const tenantClient = createTenantClient(tenant.id);
    const products = await tenantClient.product.findMany({ where: { archivedAt: null } });
    // Some may be auto-approved, some queued — total created + queued = 3
    const totalProcessed = stats.productsCreated + stats.productsQueuedForReview;
    expect(totalProcessed).toBe(3);

    // Verify ShopifyImportLog created
    const logs = await tenantClient.shopifyImportLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].syncType).toBe('products');
    expect(logs[0].productsPulled).toBe(3);

    // Verify all data is tenant-scoped
    const otherTenant = await createTestTenant('Other Store');
    const otherClient = createTenantClient(otherTenant.id);
    const otherProducts = await otherClient.product.findMany();
    expect(otherProducts).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 2 — Existing products update (Phase 1: identity match)
  // ────────────────────────────────────────────────────────────

  it('existing products — Phase 1 identity match updates via shopifyVariantId', async () => {
    const prisma = createTenantClient(tenant.id);

    // Pre-create a Shopify ECOMMERCE store
    const shopifyStore = await testPrisma.store.create({
      data: { tenantId: tenant.id, name: 'Shopify — test-store', type: 'ECOMMERCE', platform: 'Shopify' },
    });

    // Pre-create a product that already has Shopify variant IDs
    const existingProduct = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Existing Widget',
        category: 'Widgets',
        source: 'Shopify',
        barcode: '9310000002001',
      },
    });
    await testPrisma.productVariant.create({
      data: {
        productId: existingProduct.id,
        storeId: shopifyStore.id,
        sku: 'WIDGET-001',
        name: 'Existing Widget',
        shopifyVariantId: '20010', // matches Shopify variant ID below
        shopifyProductId: '2001',
        salePrice: 15.00,
        currentCost: 0,
        isActive: true,
      },
    });

    // Shopify returns the same product with updated price
    const shopifyProducts = [
      {
        id: 2001,
        title: 'Existing Widget',
        handle: 'existing-widget',
        vendor: 'WidgetCo',
        product_type: 'Widgets',
        variants: [
          {
            id: 20010, // matches shopifyVariantId above
            sku: 'WIDGET-001',
            price: '19.99', // price changed from 15.00 to 19.99
            barcode: '9310000002001',
            weight: 200,
            weight_unit: 'g',
            title: 'Default Title',
          },
        ],
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue(makeShopifyApiResponse(shopifyProducts));
    global.fetch = mockFetch;

    const stats = await syncProducts(prisma, tenant.id);

    expect(stats.productsPulled).toBe(1);
    expect(stats.productsUpdated).toBe(1);
    expect(stats.productsPipelined).toBe(0); // Phase 1 handled it, no pipeline

    // Product was updated (not duplicated)
    const products = await prisma.product.findMany({ where: { archivedAt: null } });
    expect(products).toHaveLength(1);
    expect(products[0].id).toBe(existingProduct.id);

    // Variant price updated
    const variants = await testPrisma.productVariant.findMany({
      where: { productId: existingProduct.id },
    });
    expect(variants).toHaveLength(1);
    expect(variants[0].salePrice).toBe(19.99);
    expect(variants[0].shopifyVariantId).toBe('20010');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 3 — Cross-source: Shopify product matches POS product by barcode
  // ────────────────────────────────────────────────────────────

  it('cross-source — Shopify barcode match on POS product creates separate product with canonical link', async () => {
    const prisma = createTenantClient(tenant.id);

    // Pre-create a POS product with a barcode
    const posProduct = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Blue Widget',
        category: 'Widgets',
        barcode: '9310000003001',
        source: 'Abacus POS',
      },
    });

    const shopifyProducts = [
      makeShopifyProduct({
        id: 3001,
        title: 'Blue Widget',
        sku: 'SHOPIFY-BW-001',
        price: '22.00',
        barcode: '9310000003001', // same barcode as POS product
      }),
    ];

    const mockFetch = vi.fn().mockResolvedValue(makeShopifyApiResponse(shopifyProducts));
    global.fetch = mockFetch;

    const stats = await syncProducts(prisma, tenant.id);

    expect(stats.productsCreated).toBe(1);

    // Two products now exist (one POS, one Shopify)
    const products = await prisma.product.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(products).toHaveLength(2);

    const shopifyProd = products.find((p) => p.source === 'Shopify');
    expect(shopifyProd).toBeTruthy();
    expect(shopifyProd.canonicalProductId).toBe(posProduct.id);
    expect(shopifyProd.externalId).toBe('3001');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 4 — Error handling: Shopify API timeout / rate limit
  // ────────────────────────────────────────────────────────────

  it('error handling — rate limit retries, then succeeds', async () => {
    const shopifyProducts = [
      makeShopifyProduct({ id: 4001, title: 'Rate Limited Product', sku: 'RL-001', price: '5.99' }),
    ];

    // First call: rate limit. Second call: success.
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(makeRateLimitResponse())
      .mockResolvedValueOnce(makeShopifyApiResponse(shopifyProducts));
    global.fetch = mockFetch;

    const prisma = createTenantClient(tenant.id);
    const stats = await syncProducts(prisma, tenant.id);

    expect(stats.productsPulled).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(2); // retried once
  });

  it('error handling — API failure logs error, no partial data', async () => {
    // All calls fail with 500
    const mockFetch = vi.fn().mockResolvedValue(makeErrorResponse(500, 'Internal Server Error'));
    global.fetch = mockFetch;

    const prisma = createTenantClient(tenant.id);

    // syncProducts calls fetchProducts which calls shopifyFetch which throws on non-ok
    await expect(syncProducts(prisma, tenant.id)).rejects.toThrow('Shopify API error 500');

    // No partial data in database
    const products = await prisma.product.findMany();
    expect(products).toHaveLength(0);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 5 — Source-aware dedup: manual import vs Shopify sync
  // ────────────────────────────────────────────────────────────

  it('source-aware dedup — manual CSV import + Shopify sync share canonical link', async () => {
    const prisma = createTenantClient(tenant.id);

    // Step 1: "Manually" imported product (CSV source) with barcode
    const csvProduct = await testPrisma.product.create({
      data: {
        tenantId: tenant.id,
        name: 'Eco Cleaning Spray 750ml',
        category: 'Cleaning',
        barcode: '9310000005001',
        source: 'CSV Import',
        productImportedThrough: 'CSV_UPLOAD',
      },
    });

    // Step 2: Shopify sync finds the same barcode
    const shopifyProducts = [
      makeShopifyProduct({
        id: 5001,
        title: 'Eco Cleaning Spray 750ml',
        sku: 'ECO-SPRAY-750',
        price: '8.99',
        barcode: '9310000005001', // same barcode
      }),
    ];

    const mockFetch = vi.fn().mockResolvedValue(makeShopifyApiResponse(shopifyProducts));
    global.fetch = mockFetch;

    const stats = await syncProducts(prisma, tenant.id);

    // Cross-source match: creates new Shopify product with canonical link
    expect(stats.productsCreated).toBe(1);

    const products = await prisma.product.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    expect(products).toHaveLength(2);

    const csvProd = products.find((p) => p.source === 'CSV Import');
    const shopifyProd = products.find((p) => p.source === 'Shopify');
    expect(csvProd).toBeTruthy();
    expect(shopifyProd).toBeTruthy();
    expect(shopifyProd.canonicalProductId).toBe(csvProd.id);

    // ShopifyImportLog records the sync
    const logs = await prisma.shopifyImportLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].productsCreated).toBe(1);
  });

  // ────────────────────────────────────────────────────────────
  // NOTE: Shopify Order Sync — Known Schema Bugs
  // ────────────────────────────────────────────────────────────
  // The syncOrders() function has field-name mismatches with the
  // Prisma schema that prevent it from working correctly:
  //
  //   Code uses              Schema expects
  //   ─────────              ──────────────
  //   orderNumber            shopifyOrderName
  //   orderedAt              orderDate
  //   title (line)           productTitle
  //   price (line)           unitPrice
  //
  // Additionally:
  //   - findUnique({ where: { shopifyOrderId } }) requires the compound
  //     key integrationId_shopifyOrderId
  //   - ShopifyOrderLine.upsert uses non-existent compound unique
  //   - integrationId is missing from the order create data
  //
  // Order sync tests are omitted until these bugs are fixed.
  // See: syncOrders() in server/src/services/shopify.js lines 741-867
  // ────────────────────────────────────────────────────────────
});
