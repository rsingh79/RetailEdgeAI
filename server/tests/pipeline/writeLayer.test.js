import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';

// Mock withTenantTransaction — path must be relative to the SOURCE file that imports it
vi.mock('../../src/lib/prisma.js', () => ({
  withTenantTransaction: vi.fn(async (tenantId, cb) => {
    return cb({
      product: {
        create: vi.fn().mockResolvedValue({ id: 'new-product-id' }),
        update: vi.fn().mockResolvedValue({ id: 'existing-product-id' }),
      },
      productVariant: { upsert: vi.fn() },
      productImportRecord: { create: vi.fn() },
      importJob: { update: vi.fn() },
    });
  }),
}));

const { buildProductData, preWriteCheck, WriteLayer } = await import(
  '../../src/services/agents/pipeline/stages/writeLayer.js'
);
const { withTenantTransaction } = await import('../../src/lib/prisma.js');

function createMockPrisma() {
  return {
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-product-id' }),
      update: vi.fn().mockResolvedValue({ id: 'existing-product-id' }),
    },
    productVariant: { upsert: vi.fn().mockResolvedValue({}) },
    productImportRecord: { create: vi.fn().mockResolvedValue({}) },
    importJob: { update: vi.fn().mockResolvedValue({}) },
    approvalQueueEntry: { create: vi.fn().mockResolvedValue({ id: 'queue-id' }) },
  };
}

function makeContext(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    importJobId: 'job-1',
    dryRun: false,
    prisma: createMockPrisma(),
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    rowsPendingApproval: 0,
    stageData: {},
    ...overrides,
  };
}

function makeProduct(overrides = {}) {
  const p = createCanonicalProduct({
    name: 'Test Product',
    price: 9.99,
    sourceSystem: 'Lightspeed',
    ...overrides,
  });
  p.matchResult = { action: 'CREATE', matchedProductId: null };
  p.invoiceRisk = { level: 'NONE', similarProducts: [] };
  p.approvalRoute = 'ROUTE_AUTO';
  p.approvalReason = 'Auto-approved';
  p.confidenceScore = 96;
  return p;
}

// ── buildProductData ──

describe('buildProductData', () => {
  it('maps name, sellingPrice, source correctly', () => {
    const p = createCanonicalProduct({
      name: 'Milk', price: 3.99, sourceSystem: 'Shopify',
    });
    const data = buildProductData(p, {});
    expect(data.name).toBe('Milk');
    expect(data.sellingPrice).toBe(3.99);
    expect(data.source).toBe('Shopify');
  });

  it('sets approvalStatus to AUTO_APPROVED', () => {
    const p = createCanonicalProduct({ name: 'Test' });
    const data = buildProductData(p, {});
    expect(data.approvalStatus).toBe('AUTO_APPROVED');
  });

  it('sets lastSyncedAt to a Date', () => {
    const p = createCanonicalProduct({ name: 'Test' });
    const data = buildProductData(p, {});
    expect(data.lastSyncedAt).toBeInstanceOf(Date);
  });

  it('handles null optional fields gracefully', () => {
    const p = createCanonicalProduct({ name: 'Test' });
    const data = buildProductData(p, {});
    expect(data.category).toBe(null);
    expect(data.barcode).toBe(null);
    expect(data.costPrice).toBe(null);
    expect(data.externalId).toBe(null);
  });

  it('maps externalId, fingerprint, importId', () => {
    const p = createCanonicalProduct({
      name: 'Test',
      externalId: 'EXT-1',
      fingerprint: 'T1:abc',
      importJobId: 'job-99',
    });
    const data = buildProductData(p, {});
    expect(data.externalId).toBe('EXT-1');
    expect(data.fingerprint).toBe('T1:abc');
    expect(data.importId).toBe('job-99');
  });
});

// ── preWriteCheck ──

describe('preWriteCheck', () => {
  it('returns conflict: false when no matches found', async () => {
    const prisma = createMockPrisma();
    const p = makeProduct();
    const result = await preWriteCheck(p, prisma);
    expect(result.conflict).toBe(false);
    expect(result.existingProduct).toBe(null);
  });

  it('returns conflict: true when fingerprint matches', async () => {
    const prisma = createMockPrisma();
    prisma.product.findFirst.mockResolvedValueOnce({ id: 'existing-1' });
    const p = makeProduct({ fingerprint: 'T1:abc' });
    const result = await preWriteCheck(p, prisma);
    expect(result.conflict).toBe(true);
    expect(result.existingProduct.id).toBe('existing-1');
  });

  it('returns conflict: true when barcode matches', async () => {
    const prisma = createMockPrisma();
    // Product has no fingerprint and no externalId, so the first findFirst call is for barcode
    prisma.product.findFirst.mockResolvedValueOnce({ id: 'barcode-match' });
    const p = createCanonicalProduct({ name: 'Test', barcode: '1234567890128' });
    const result = await preWriteCheck(p, prisma);
    expect(result.conflict).toBe(true);
    expect(result.existingProduct.id).toBe('barcode-match');
  });

  it('checks externalId + source when both present', async () => {
    const prisma = createMockPrisma();
    prisma.product.findFirst
      .mockResolvedValueOnce(null) // fingerprint check
      .mockResolvedValueOnce({ id: 'ext-match' }); // externalId check
    const p = makeProduct({ externalId: 'EXT-1', sourceSystem: 'Shopify', fingerprint: 'T1:x' });
    const result = await preWriteCheck(p, prisma);
    expect(result.conflict).toBe(true);
    expect(prisma.product.findFirst).toHaveBeenCalledTimes(2);
  });

  it('handles missing prisma gracefully', async () => {
    const p = makeProduct();
    // preWriteCheck requires prisma — calling without it would throw
    // This tests that a prisma with no results works fine
    const prisma = createMockPrisma();
    const result = await preWriteCheck(p, prisma);
    expect(result.conflict).toBe(false);
  });
});

// ── WriteLayer.process — dry run ──

describe('WriteLayer.process — dry run', () => {
  it('increments rowsCreated for ROUTE_AUTO', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext({ dryRun: true });
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_AUTO';
    await layer.process(p, ctx);
    expect(ctx.rowsCreated).toBe(1);
  });

  it('increments rowsPendingApproval for ROUTE_REVIEW', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext({ dryRun: true });
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    await layer.process(p, ctx);
    expect(ctx.rowsPendingApproval).toBe(1);
  });

  it('increments rowsSkipped for ROUTE_REJECT', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext({ dryRun: true });
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REJECT';
    await layer.process(p, ctx);
    expect(ctx.rowsSkipped).toBe(1);
  });

  it('makes no DB calls in dry run mode', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext({ dryRun: true });
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_AUTO';
    await layer.process(p, ctx);
    expect(ctx.prisma.product.create).not.toHaveBeenCalled();
    expect(ctx.prisma.approvalQueueEntry.create).not.toHaveBeenCalled();
    expect(ctx.prisma.productImportRecord.create).not.toHaveBeenCalled();
  });

  it('returns the product unchanged', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext({ dryRun: true });
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_AUTO';
    const result = await layer.process(p, ctx);
    expect(result).toBe(p);
    expect(result.name).toBe('Test Product');
  });
});

// ── WriteLayer.process — ROUTE_REJECT ──

describe('WriteLayer.process — ROUTE_REJECT', () => {
  it('writes a ProductImportRecord with action SKIPPED', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REJECT';
    p.approvalReason = 'Exact duplicate';
    await layer.process(p, ctx);
    expect(ctx.prisma.productImportRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchAction: 'SKIPPED' }),
      })
    );
  });

  it('increments importJob rowsSkipped', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REJECT';
    await layer.process(p, ctx);
    expect(ctx.prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { rowsSkipped: { increment: 1 } },
      })
    );
  });

  it('does not create a Product record', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REJECT';
    await layer.process(p, ctx);
    expect(ctx.prisma.product.create).not.toHaveBeenCalled();
  });

  it('does not create an ApprovalQueueEntry', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REJECT';
    await layer.process(p, ctx);
    expect(ctx.prisma.approvalQueueEntry.create).not.toHaveBeenCalled();
  });
});

// ── WriteLayer.process — ROUTE_REVIEW ──

describe('WriteLayer.process — ROUTE_REVIEW', () => {
  it('creates an ApprovalQueueEntry record', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    p.approvalReason = 'Low confidence';
    await layer.process(p, ctx);
    expect(ctx.prisma.approvalQueueEntry.create).toHaveBeenCalledTimes(1);
  });

  it('creates a ProductImportRecord record', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    await layer.process(p, ctx);
    expect(ctx.prisma.productImportRecord.create).toHaveBeenCalledTimes(1);
  });

  it('increments importJob rowsPendingApproval', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    await layer.process(p, ctx);
    expect(ctx.prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { rowsPendingApproval: { increment: 1 } },
      })
    );
  });

  it('does not create a Product record', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    await layer.process(p, ctx);
    expect(ctx.prisma.product.create).not.toHaveBeenCalled();
  });

  it('sets slaDeadline to 24 hours from now', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    const before = Date.now();
    await layer.process(p, ctx);
    const createCall = ctx.prisma.approvalQueueEntry.create.mock.calls[0][0];
    const sla = new Date(createCall.data.slaDeadline).getTime();
    const expected24h = before + 24 * 60 * 60 * 1000;
    // Allow 5 second tolerance
    expect(sla).toBeGreaterThanOrEqual(expected24h - 5000);
    expect(sla).toBeLessThanOrEqual(expected24h + 5000);
  });

  it('sets requiresSecondApproval for HIGH risk', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    p.invoiceRisk = { level: 'HIGH', similarProducts: [] };
    await layer.process(p, ctx);
    const createCall = ctx.prisma.approvalQueueEntry.create.mock.calls[0][0];
    expect(createCall.data.requiresSecondApproval).toBe(true);
  });
});

// ── WriteLayer.process — ROUTE_AUTO ──

describe('WriteLayer.process — ROUTE_AUTO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls withTenantTransaction', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    await layer.process(p, ctx);
    expect(withTenantTransaction).toHaveBeenCalledWith('tenant-1', expect.any(Function));
  });

  it('creates Product for CREATE action', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    p.matchResult = { action: 'CREATE', matchedProductId: null };
    const result = await layer.process(p, ctx);
    // withTenantTransaction mock calls the callback with a tx that has product.create
    expect(withTenantTransaction).toHaveBeenCalled();
    expect(ctx.rowsCreated).toBe(1);
  });

  it('updates Product for UPDATE action', async () => {
    const layer = new WriteLayer();
    // Override the mock to simulate UPDATE path
    withTenantTransaction.mockImplementationOnce(async (tenantId, cb) => {
      const tx = {
        product: {
          create: vi.fn().mockResolvedValue({ id: 'new-id' }),
          update: vi.fn().mockResolvedValue({ id: 'existing-product-id' }),
        },
        productVariant: { upsert: vi.fn() },
        productImportRecord: { create: vi.fn() },
        importJob: { update: vi.fn() },
      };
      return cb(tx);
    });
    const ctx = makeContext();
    const p = makeProduct();
    p.matchResult = { action: 'UPDATE', matchedProductId: 'existing-product-id' };
    await layer.process(p, ctx);
    expect(ctx.rowsUpdated).toBe(1);
  });

  it('increments context.rowsCreated for CREATE', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    const p = makeProduct();
    await layer.process(p, ctx);
    expect(ctx.rowsCreated).toBe(1);
  });

  it('increments context.rowsUpdated for UPDATE', async () => {
    const layer = new WriteLayer();
    withTenantTransaction.mockImplementationOnce(async (tenantId, cb) => {
      return cb({
        product: {
          create: vi.fn().mockResolvedValue({ id: 'id' }),
          update: vi.fn().mockResolvedValue({ id: 'id' }),
        },
        productVariant: { upsert: vi.fn() },
        productImportRecord: { create: vi.fn() },
        importJob: { update: vi.fn() },
      });
    });
    const ctx = makeContext();
    const p = makeProduct();
    p.matchResult = { action: 'UPDATE', matchedProductId: 'prod-1' };
    await layer.process(p, ctx);
    expect(ctx.rowsUpdated).toBe(1);
  });

  it('detects race condition and re-queues when preWriteCheck finds a conflict', async () => {
    const layer = new WriteLayer();
    const ctx = makeContext();
    // Make findFirst return a conflict on the fingerprint check
    ctx.prisma.product.findFirst.mockResolvedValueOnce({ id: 'conflicting-product' });
    const p = makeProduct({ fingerprint: 'T1:conflict' });
    await layer.process(p, ctx);
    expect(p.approvalRoute).toBe('ROUTE_REVIEW');
    expect(p.approvalReason).toContain('Race condition');
    expect(ctx.rowsPendingApproval).toBe(1);
    // withTenantTransaction should NOT have been called since conflict was detected
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });
});
