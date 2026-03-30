import { describe, it, expect, vi } from 'vitest';
import {
  inferSourceFromFilename,
  inferSourceFromHeaders,
  SourceResolver,
} from '../../src/services/agents/pipeline/stages/sourceResolver.js';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';

// ── inferSourceFromFilename ──

describe('inferSourceFromFilename', () => {
  it('detects shopify from filename', () => {
    expect(inferSourceFromFilename('shopify_export.csv')).toBe('shopify');
  });

  it('detects lightspeed from filename', () => {
    expect(inferSourceFromFilename('lightspeed_products.xlsx')).toBe('lightspeed');
  });

  it('detects myob from filename', () => {
    expect(inferSourceFromFilename('myob_items_2026.csv')).toBe('myob');
  });

  it('returns null for unknown filename', () => {
    expect(inferSourceFromFilename('random_file.csv')).toBe(null);
  });

  it('is case insensitive', () => {
    expect(inferSourceFromFilename('SHOPIFY_Export.csv')).toBe('shopify');
  });
});

// ── inferSourceFromHeaders ──

describe('inferSourceFromHeaders', () => {
  it('detects Shopify from Handle + Vendor + Variant Grams', () => {
    const headers = ['Handle', 'Title', 'Vendor', 'Variant Grams', 'Price'];
    expect(inferSourceFromHeaders(headers)).toBe('shopify');
  });

  it('detects WooCommerce from post_name + tax:product_type', () => {
    const headers = ['ID', 'post_name', 'tax:product_type', 'regular_price'];
    expect(inferSourceFromHeaders(headers)).toBe('woocommerce');
  });

  it('requires at least 2 matching headers', () => {
    // Only 1 Shopify header
    const headers = ['Handle', 'Name', 'Price'];
    expect(inferSourceFromHeaders(headers)).toBe(null);
  });

  it('returns null when only 1 signature header matches', () => {
    const headers = ['Vendor', 'Name', 'Price', 'Qty'];
    expect(inferSourceFromHeaders(headers)).toBe(null);
  });

  it('returns null for completely unknown headers', () => {
    const headers = ['product_name', 'qty', 'price'];
    expect(inferSourceFromHeaders(headers)).toBe(null);
  });
});

// ── SourceResolver stage ──

describe('SourceResolver stage', () => {
  it('sets sourceSystem from context.sourceName', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = { sourceName: 'Lightspeed', stageData: {}, prisma: null };
    const result = await stage.process(p, ctx);
    expect(result.sourceSystem).toBe('Lightspeed');
  });

  it('sets sourceType from context.sourceType', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = { sourceType: 'CSV_UPLOAD', sourceName: 'X', stageData: {}, prisma: null };
    const result = await stage.process(p, ctx);
    expect(result.sourceType).toBe('CSV_UPLOAD');
    expect(result.productImportedThrough).toBe('CSV_UPLOAD');
  });

  it('sets importJobId from context.importJobId', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = { importJobId: 'job-42', sourceName: 'X', stageData: {}, prisma: null };
    const result = await stage.process(p, ctx);
    expect(result.importJobId).toBe('job-42');
    expect(result.importId).toBe('job-42');
  });

  it('infers source from filename when sourceName null', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = {
      stageData: { fileName: 'shopify_products_march.csv' },
      prisma: null,
    };
    const result = await stage.process(p, ctx);
    expect(result.sourceSystem).toBe('shopify');
  });

  it('infers source from headers when filename null', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = {
      stageData: { headers: ['Handle', 'Vendor', 'Variant SKU', 'Image Src'] },
      prisma: null,
    };
    const result = await stage.process(p, ctx);
    expect(result.sourceSystem).toBe('shopify');
  });

  it('defaults to Manual when nothing matches', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = { stageData: {}, prisma: null };
    const result = await stage.process(p, ctx);
    expect(result.sourceSystem).toBe('Manual');
  });

  it('adds a warning when defaulting to Manual', async () => {
    const stage = new SourceResolver();
    const p = createCanonicalProduct({ name: 'Test' });
    const ctx = { stageData: {}, prisma: null };
    const result = await stage.process(p, ctx);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain('Manual');
  });

  it('loads ImportTemplate via prisma in setup()', async () => {
    const stage = new SourceResolver();
    const mockTemplate = { id: 'tmpl-1', systemName: 'TestSource', mapping: { col: 'name' } };
    const mockPrisma = {
      importTemplate: {
        findFirst: vi.fn().mockResolvedValue(mockTemplate),
      },
    };
    const ctx = {
      tenantId: 'tenant-1',
      sourceName: 'TestSource',
      prisma: mockPrisma,
      stageData: {},
    };
    await stage.setup(ctx);
    expect(mockPrisma.importTemplate.findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', systemName: 'TestSource' },
    });
    expect(ctx.stageData.importTemplate).toBe(mockTemplate);
    expect(ctx.stageData.savedMapping).toBe(mockTemplate.mapping);
  });

  it('handles prisma null in setup() gracefully', async () => {
    const stage = new SourceResolver();
    const ctx = { tenantId: 'tenant-1', sourceName: 'X', prisma: null, stageData: {} };
    await expect(stage.setup(ctx)).resolves.not.toThrow();
    expect(ctx.stageData.importTemplate).toBeUndefined();
  });

  it('handles prisma error in setup() gracefully', async () => {
    const stage = new SourceResolver();
    const mockPrisma = {
      importTemplate: {
        findFirst: vi.fn().mockRejectedValue(new Error('DB down')),
      },
    };
    const ctx = {
      tenantId: 'tenant-1',
      sourceName: 'TestSource',
      prisma: mockPrisma,
      stageData: {},
    };
    await expect(stage.setup(ctx)).resolves.not.toThrow();
    expect(ctx.stageData.importTemplate).toBeUndefined();
  });
});
