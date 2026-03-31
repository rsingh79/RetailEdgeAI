import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external deps before importing shopify.js
vi.mock('../../src/lib/encryption.js', () => ({
  encrypt: vi.fn((v) => `enc:${v}`),
  decrypt: vi.fn((v) => v.replace('enc:', '')),
}));

vi.mock('../../src/lib/prisma.js', () => ({
  default: {
    shopifyIntegration: {
      findUnique: vi.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        shop: 'teststore.myshopify.com',
        accessTokenEnc: 'enc:test-token',
        isActive: true,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    shopifyImportLog: { create: vi.fn().mockResolvedValue({}) },
  },
  withTenantTransaction: vi.fn(),
}));

vi.mock('../../src/services/matching.js', () => ({
  fuzzyNameScore: vi.fn(() => 0),
}));

vi.mock('../../src/services/ai/embeddingMaintenance.js', () => ({
  embedProduct: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../src/services/shopifyPipelineAdapter.js', () => ({
  shopifyToCanonical: vi.fn(),
}));

vi.mock('../../src/services/importJobService.js', () => ({
  createImportJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
  runImportPipeline: vi.fn().mockResolvedValue({
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsPendingApproval: 0,
    rowsSkipped: 0,
  }),
}));

vi.mock('../../src/services/integrationHooks.js', () => ({
  executeHook: vi.fn().mockResolvedValue({}),
}));

// Mock global fetch for Shopify API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

const { syncProducts, normalizeShop } = await import('../../src/services/shopify.js');

function createMockPrisma() {
  return {
    store: {
      findFirst: vi.fn().mockResolvedValue({ id: 'store-1', name: 'Shopify Store', type: 'ECOMMERCE', platform: 'Shopify' }),
      create: vi.fn().mockResolvedValue({ id: 'store-1' }),
    },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args) => Promise.resolve({
        id: `new-product-${Date.now()}`,
        ...args.data,
      })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({
        id: args.where?.id || 'updated-product-id',
        name: 'Updated Product',
        category: args.data?.category || 'Test',
        ...args.data,
      })),
    },
    productVariant: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
}

function makeShopifyApiResponse(products) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ products }),
    headers: { get: () => null }, // No pagination
  };
}

describe('Shopify Sync — Cross-Source Handling', () => {
  let prisma;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createMockPrisma();

    // Default: Shopify API returns one product
    mockFetch.mockResolvedValue(makeShopifyApiResponse([
      {
        id: 12345,
        title: 'Organic Cacao Nibs',
        handle: 'organic-cacao-nibs',
        product_type: 'Superfoods',
        variants: [
          {
            id: 67890,
            sku: 'CACAO-500',
            barcode: '9876543210',
            price: '74.80',
            title: 'Default Title',
            weight: 0.5,
            weight_unit: 'kg',
          },
        ],
      },
    ]));
  });

  it('barcode match with same source (Shopify) updates existing product', async () => {
    const existingProduct = {
      id: 'prod-1',
      name: 'Organic Cacao Nibs',
      barcode: '9876543210',
      source: 'Shopify',
      category: 'Superfoods',
    };

    // Layer 1 (shopifyVariantId) returns null, Layer 2 (barcode) returns match
    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(existingProduct);

    const stats = await syncProducts(prisma, 'tenant-1');

    expect(stats.productsUpdated).toBe(1);
    expect(stats.productsCreated).toBe(0);

    // Verify update was called WITHOUT source field
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'prod-1' },
        data: expect.not.objectContaining({ source: 'Shopify' }),
      })
    );
  });

  it('barcode match with different source creates new Shopify product', async () => {
    const existingPosProduct = {
      id: 'pos-prod-1',
      name: 'Organic Cacao Nibs',
      barcode: '9876543210',
      source: 'Abacus POS',
      category: 'Superfoods',
    };

    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(existingPosProduct);

    const stats = await syncProducts(prisma, 'tenant-1');

    // Should create a new product, not update
    expect(stats.productsCreated).toBe(1);
    expect(prisma.product.create).toHaveBeenCalled();

    // The existing POS product should NOT have been updated
    expect(prisma.product.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pos-prod-1' } })
    );
  });

  it('cross-source create sets canonicalProductId to existing product', async () => {
    const existingPosProduct = {
      id: 'pos-prod-1',
      name: 'Organic Cacao Nibs',
      barcode: '9876543210',
      source: 'Abacus POS',
    };

    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(existingPosProduct);

    await syncProducts(prisma, 'tenant-1');

    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          canonicalProductId: 'pos-prod-1',
          source: 'Shopify',
        }),
      })
    );
  });

  it('cross-source create processes Shopify variants on new product', async () => {
    const existingPosProduct = {
      id: 'pos-prod-1',
      name: 'Organic Cacao Nibs',
      barcode: '9876543210',
      source: 'Abacus POS',
    };

    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(existingPosProduct);
    prisma.product.create.mockResolvedValue({ id: 'new-shopify-prod-1', name: 'Organic Cacao Nibs' });

    await syncProducts(prisma, 'tenant-1');

    // Variants should be upserted on the NEW product, not the existing one
    expect(prisma.productVariant.upsert).toHaveBeenCalled();
    const upsertCall = prisma.productVariant.upsert.mock.calls[0][0];
    expect(upsertCall.create.productId).toBe('new-shopify-prod-1');
  });

  it('same-source update does not overwrite source field', async () => {
    const existingShopifyProduct = {
      id: 'shopify-prod-1',
      name: 'Organic Cacao Nibs',
      barcode: '9876543210',
      source: 'Shopify',
      category: 'Old Category',
    };

    prisma.productVariant.findFirst.mockResolvedValue(null);
    prisma.product.findFirst.mockResolvedValue(existingShopifyProduct);

    await syncProducts(prisma, 'tenant-1');

    const updateCall = prisma.product.update.mock.calls[0];
    const updateData = updateCall[0].data;

    // source should NOT be in the update payload
    expect(updateData).not.toHaveProperty('source');
  });
});
