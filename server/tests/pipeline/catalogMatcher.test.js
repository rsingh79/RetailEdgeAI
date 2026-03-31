import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCanonicalProduct, addWarning } from '../../src/services/agents/pipeline/canonicalProduct.js';

// Mock external deps that catalogMatcher imports
vi.mock('../../src/services/ai/aiServiceRouter.js', () => ({
  embed: vi.fn().mockResolvedValue({ vectors: [] }),
}));

vi.mock('../../src/services/ai/vectorStore.js', () => ({
  findNearestProducts: vi.fn().mockResolvedValue([]),
}));

vi.mock('fuse.js', () => ({
  default: class Fuse {
    constructor() {}
    search() { return []; }
  },
}));

const { CatalogMatcher, computeFieldDiff } = await import(
  '../../src/services/agents/pipeline/stages/catalogMatcher.js'
);

function createMockPrisma(overrides = {}) {
  return {
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    productVariant: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  };
}

function makeProduct(overrides = {}) {
  const p = createCanonicalProduct({
    name: 'Test Product',
    price: 9.99,
    barcode: '1234567890',
    sourceSystem: 'POS',
    ...overrides,
  });
  return p;
}

function makeContext(prisma) {
  return {
    prisma,
    tenantId: 'tenant-1',
    stageData: {},
  };
}

describe('CatalogMatcher — Cross-Source Handling', () => {
  let matcher;

  beforeEach(() => {
    matcher = new CatalogMatcher();
  });

  // ── Barcode match tests ──

  describe('Layer 1 — Barcode match', () => {
    it('same source barcode match returns UPDATE when fields differ', async () => {
      const existingProduct = {
        id: 'existing-1',
        name: 'Test Product',
        barcode: '1234567890',
        source: 'POS',
        category: 'Old Category',
      };

      const prisma = createMockPrisma();
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        barcode: '1234567890',
        sourceSystem: 'POS',
        category: 'New Category',
      });

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.matchResult.action).toBe('UPDATE');
      expect(result.matchResult.matchedProductId).toBe('existing-1');
      expect(result.matchResult.layerMatched).toBe(1);
    });

    it('same source barcode match returns SKIP when no fields differ', async () => {
      const existingProduct = {
        id: 'existing-1',
        name: 'Test Product',
        barcode: '1234567890',
        source: 'POS',
        category: null,
      };

      const prisma = createMockPrisma();
      // No fingerprint/externalId on product, so only barcode findFirst fires
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        barcode: '1234567890',
        sourceSystem: 'POS',
      });

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.matchResult.action).toBe('SKIP');
      expect(result.matchResult.matchedProductId).toBe('existing-1');
    });

    it('different source barcode match returns CREATE with canonicalProductId', async () => {
      const existingProduct = {
        id: 'existing-pos-1',
        name: 'Test Product',
        barcode: '1234567890',
        source: 'POS',
        category: 'Snacks',
      };

      const prisma = createMockPrisma();
      // No fingerprint/externalId on product, so only barcode findFirst fires
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        barcode: '1234567890',
        sourceSystem: 'Shopify',
      });

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.matchResult.action).toBe('CREATE');
      expect(result.matchResult.matchedProductId).toBeNull();
      expect(result.canonicalProductId).toBe('existing-pos-1');
      expect(result.matchResult.matchedOn).toContain('cross_source_barcode');
    });

    it('cross-source CREATE skips Layers 2, 2.5, 3', async () => {
      const existingProduct = {
        id: 'existing-pos-1',
        name: 'Test Product',
        barcode: '1234567890',
        source: 'POS',
      };

      const prisma = createMockPrisma();
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        barcode: '1234567890',
        sourceSystem: 'Shopify',
      });

      const result = await matcher.process(product, makeContext(prisma));

      // Should have returned after Layer 1 — no fuzzy/embedding calls
      expect(result.matchResult.action).toBe('CREATE');
      expect(result.matchResult.layerMatched).toBe(1);
      // Layer 2 would set layerMatched to 2, Layer 2.5 to 2.5
      expect(result.matchResult.layerMatched).not.toBe(2);
      expect(result.matchResult.layerMatched).not.toBe(2.5);
    });
  });

  // ── Fingerprint match tests ──

  describe('Layer 1 — Fingerprint match', () => {
    it('fingerprint match with different source returns CREATE with canonicalProductId', async () => {
      const existingProduct = {
        id: 'existing-csv-1',
        name: 'Test Product',
        fingerprint: 'ab123456',
        source: 'CSV',
      };

      const prisma = createMockPrisma();
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        fingerprint: 'ab123456',
        sourceSystem: 'Shopify',
      });

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.matchResult.action).toBe('CREATE');
      expect(result.canonicalProductId).toBe('existing-csv-1');
      expect(result.matchResult.matchedOn).toContain('cross_source_fingerprint');
    });

    it('fingerprint match with same source returns UPDATE', async () => {
      const existingProduct = {
        id: 'existing-1',
        name: 'Test Product',
        fingerprint: 'ab123456',
        source: 'POS',
        category: 'Old',
      };

      const prisma = createMockPrisma();
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        fingerprint: 'ab123456',
        sourceSystem: 'POS',
        category: 'New',
      });

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.matchResult.action).toBe('UPDATE');
      expect(result.matchResult.matchedProductId).toBe('existing-1');
    });
  });

  // ── externalId+source match tests ──

  describe('Layer 1 — externalId+source match', () => {
    it('externalId+source match (already source-qualified) returns UPDATE as before', async () => {
      const existingProduct = {
        id: 'existing-1',
        name: 'Test Product',
        externalId: 'ext-123',
        source: 'Shopify',
        category: 'Old',
      };

      const prisma = createMockPrisma();
      // No fingerprint on product, so externalId+source is the first findFirst call
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        externalId: 'ext-123',
        sourceSystem: 'Shopify',
        category: 'New',
      });
      // Clear barcode to avoid barcode match path
      product.barcode = null;

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.matchResult.action).toBe('UPDATE');
      expect(result.matchResult.matchedProductId).toBe('existing-1');
      expect(result.matchResult.matchedOn).toEqual(['externalId', 'sourceSystem']);
    });
  });

  // ── Cross-source warning ──

  describe('Cross-source warnings', () => {
    it('adds a warning for cross-source barcode match', async () => {
      const existingProduct = {
        id: 'existing-pos-1',
        name: 'Test Product',
        barcode: '1234567890',
        source: 'POS',
      };

      const prisma = createMockPrisma();
      prisma.product.findFirst.mockResolvedValue(existingProduct);

      const product = makeProduct({
        barcode: '1234567890',
        sourceSystem: 'Shopify',
      });

      const result = await matcher.process(product, makeContext(prisma));

      expect(result.warnings.length).toBeGreaterThan(0);
      const crossSourceWarning = result.warnings.find(w =>
        w.message.includes('Same physical product found')
      );
      expect(crossSourceWarning).toBeDefined();
      expect(crossSourceWarning.message).toContain('POS');
      expect(crossSourceWarning.message).toContain('canonical link');
    });
  });
});
