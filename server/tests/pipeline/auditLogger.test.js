import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';
import { AuditLogger, writeAuditLog } from '../../src/services/agents/pipeline/stages/auditLogger.js';

function createMockPrisma() {
  return {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    interactionSignal: { create: vi.fn().mockResolvedValue({}) },
    importJob: { update: vi.fn().mockResolvedValue({}) },
  };
}

function makeProduct(overrides = {}) {
  const p = createCanonicalProduct({
    name: 'Test Product',
    price: 9.99,
    ...overrides,
  });
  p.approvalRoute = 'ROUTE_AUTO';
  p.matchResult = { action: 'CREATE' };
  p.invoiceRisk = { level: 'NONE' };
  p.confidenceScore = 96;
  return p;
}

function makeContext(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    importJobId: 'job-1',
    dryRun: false,
    prisma: createMockPrisma(),
    stageData: {},
    rowsCreated: 1,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    rowsPendingApproval: 0,
    totalRows: 1,
    startedAt: new Date(),
    completedAt: new Date(),
    sourceName: 'Lightspeed',
    sourceType: 'CSV_UPLOAD',
    ...overrides,
  };
}

// ── AuditLogger.process ──

describe('AuditLogger.process', () => {
  it('returns the product unchanged', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    const p = makeProduct();
    const result = await logger.process(p, ctx);
    expect(result).toBe(p);
    expect(result.name).toBe('Test Product');
  });

  it('does not throw when prisma is null', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext({ prisma: null });
    const p = makeProduct();
    const result = await logger.process(p, ctx);
    expect(result).toBe(p);
  });

  it('does not throw when importJobId is null', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext({ importJobId: null });
    const p = makeProduct();
    const result = await logger.process(p, ctx);
    expect(result).toBe(p);
  });

  it('does not throw when dryRun is true', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext({ dryRun: true });
    const p = makeProduct();
    const result = await logger.process(p, ctx);
    expect(result).toBe(p);
  });

  it('determines PRODUCT_IMPORTED for ROUTE_AUTO + CREATE', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_AUTO';
    p.matchResult = { action: 'CREATE' };
    await logger.process(p, ctx);
    // Give fire-and-forget a tick to execute
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRODUCT_IMPORTED' }),
      })
    );
  });

  it('determines PRODUCT_UPDATED for ROUTE_AUTO + UPDATE', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_AUTO';
    p.matchResult = { action: 'UPDATE' };
    await logger.process(p, ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRODUCT_UPDATED' }),
      })
    );
  });

  it('determines PRODUCT_SKIPPED for ROUTE_REJECT', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REJECT';
    await logger.process(p, ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRODUCT_SKIPPED' }),
      })
    );
  });

  it('determines PRODUCT_QUEUED_FOR_REVIEW for ROUTE_REVIEW', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_REVIEW';
    await logger.process(p, ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRODUCT_QUEUED_FOR_REVIEW' }),
      })
    );
  });

  it('determines PRODUCT_IMPORT_FAILED for fatal error', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    const p = makeProduct();
    p.approvalRoute = 'ROUTE_AUTO';
    p.matchResult = { action: 'CREATE' };
    p.errors = [{ stage: 'test', message: 'boom', fatal: true, timestamp: new Date() }];
    await logger.process(p, ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'PRODUCT_IMPORT_FAILED' }),
      })
    );
  });

  it('fires writeAuditLog as fire-and-forget (does not block product return)', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    // Make auditLog.create slow
    ctx.prisma.auditLog.create.mockImplementation(
      () => new Promise((r) => setTimeout(() => r({}), 500))
    );
    const p = makeProduct();
    const start = Date.now();
    const result = await logger.process(p, ctx);
    const elapsed = Date.now() - start;
    // Should return immediately, not wait 500ms
    expect(elapsed).toBeLessThan(100);
    expect(result).toBe(p);
  });

  it('does not emit InteractionSignal when stageData.agentRoleId is not set', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    ctx.stageData = {}; // no agentRoleId
    const p = makeProduct();
    await logger.process(p, ctx);
    await new Promise((r) => setTimeout(r, 10));
    expect(ctx.prisma.interactionSignal.create).not.toHaveBeenCalled();
  });
});

// ── AuditLogger.teardown ──

describe('AuditLogger.teardown', () => {
  it('writes IMPORT_JOB_COMPLETED AuditLog entry', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    await logger.teardown(ctx);
    expect(ctx.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'IMPORT_JOB_COMPLETED' }),
      })
    );
  });

  it('updates ImportJob status to COMPLETE', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext();
    await logger.teardown(ctx);
    expect(ctx.prisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'COMPLETE' }),
      })
    );
  });

  it('does not throw when prisma is null', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext({ prisma: null });
    await expect(logger.teardown(ctx)).resolves.not.toThrow();
  });

  it('skips when dryRun is true', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext({ dryRun: true });
    await logger.teardown(ctx);
    expect(ctx.prisma.auditLog.create).not.toHaveBeenCalled();
    expect(ctx.prisma.importJob.update).not.toHaveBeenCalled();
  });

  it('includes all counter fields in newVal', async () => {
    const logger = new AuditLogger();
    const ctx = makeContext({
      rowsCreated: 5,
      rowsUpdated: 3,
      rowsSkipped: 2,
      rowsFailed: 1,
      rowsPendingApproval: 4,
      totalRows: 15,
    });
    await logger.teardown(ctx);
    const call = ctx.prisma.auditLog.create.mock.calls[0][0];
    expect(call.data.newVal).toMatchObject({
      totalRows: 15,
      rowsCreated: 5,
      rowsUpdated: 3,
      rowsSkipped: 2,
      rowsFailed: 1,
      rowsPendingApproval: 4,
    });
  });
});
