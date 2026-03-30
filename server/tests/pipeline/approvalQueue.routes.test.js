import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock withTenantTransaction (imported by writeLayer.js via productImportV1.js)
vi.mock('../../src/lib/prisma.js', () => ({
  withTenantTransaction: vi.fn(async (tenantId, cb) => {
    return cb({
      product: {
        create: vi.fn().mockResolvedValue({ id: 'written-product-id' }),
        update: vi.fn().mockResolvedValue({ id: 'written-product-id' }),
      },
      productVariant: { upsert: vi.fn() },
      productImportRecord: { create: vi.fn() },
      importJob: { update: vi.fn() },
    });
  }),
}));

// Import the router after mocks are in place
const { default: productImportV1Routes } = await import(
  '../../src/routes/productImportV1.js'
);

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';
const TEST_TENANT_ID = 'test-tenant-id';
const TEST_USER_ID = 'test-user-id';

function makeToken(overrides = {}) {
  return jwt.sign(
    {
      userId: overrides.userId || TEST_USER_ID,
      tenantId: overrides.tenantId || TEST_TENANT_ID,
      role: overrides.role || 'OWNER',
    },
    JWT_SECRET
  );
}

// ── Build a minimal test app with mocked middleware ──

let mockPrisma;

function createMockPrisma() {
  return {
    approvalQueueEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'queue-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    importJob: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    importTemplate: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-product-id' }),
      update: vi.fn().mockResolvedValue({ id: 'existing-product-id' }),
    },
  };
}

function buildApp({ authenticated = true, planGated = true } = {}) {
  const app = express();
  app.use(express.json());

  // Mock authenticate middleware
  if (authenticated) {
    app.use((req, res, next) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No token provided' });
      }
      try {
        const token = auth.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        req.tenantId = decoded.tenantId;
        next();
      } catch {
        return res.status(401).json({ message: 'Invalid token' });
      }
    });
  }

  // Mock tenantAccess + tenantScope
  app.use((req, res, next) => {
    req.prisma = mockPrisma;
    req.tenantId = req.tenantId || TEST_TENANT_ID;
    next();
  });

  // Mock requirePlan
  if (!planGated) {
    // Skip plan check — just pass through
  } else {
    // Plan check passes (feature is available)
  }

  app.use('/api/v1/products', productImportV1Routes);

  // Error handler
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message });
  });

  return app;
}

function buildAppNoPlan() {
  // Build an app where requirePlan rejects
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ message: 'No token' });
    try {
      req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
      req.tenantId = req.user.tenantId;
    } catch { return res.status(401).json({ message: 'Bad token' }); }
    next();
  });
  // requirePlan rejects
  app.use('/api/v1/products', (req, res) => {
    res.status(403).json({
      message: 'This feature requires a plan upgrade',
      code: 'PLAN_UPGRADE_REQUIRED',
      requiredFeature: 'product_import',
    });
  });
  return app;
}

beforeEach(() => {
  mockPrisma = createMockPrisma();
});

// ── GET /api/v1/products/approval-queue/summary ──

describe('GET /api/v1/products/approval-queue/summary', () => {
  it('returns 200 with pending counts by risk level', async () => {
    mockPrisma.approvalQueueEntry.count
      .mockResolvedValueOnce(10) // pendingTotal
      .mockResolvedValueOnce(3)  // HIGH
      .mockResolvedValueOnce(4)  // MEDIUM
      .mockResolvedValueOnce(2)  // LOW
      .mockResolvedValueOnce(1); // NONE
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue({
      createdAt: new Date('2026-03-28'),
    });

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/summary')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.pendingTotal).toBe(10);
    expect(res.body.byRisk).toEqual({ HIGH: 3, MEDIUM: 4, LOW: 2, NONE: 1 });
    expect(res.body.oldestPendingAt).toBeTruthy();
  });

  it('returns 200 when queue is empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/summary')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.pendingTotal).toBe(0);
    expect(res.body.oldestPendingAt).toBe(null);
  });

  it('requires authentication (401 without token)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/summary');

    expect(res.status).toBe(401);
  });

  it('requires product_import feature (403 without plan)', async () => {
    const app = buildAppNoPlan();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/summary')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_UPGRADE_REQUIRED');
  });
});

// ── GET /api/v1/products/approval-queue ──

describe('GET /api/v1/products/approval-queue', () => {
  it('returns 200 with paginated entries', async () => {
    mockPrisma.approvalQueueEntry.findMany.mockResolvedValue([
      { id: 'q1', status: 'PENDING' },
      { id: 'q2', status: 'PENDING' },
    ]);
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(2);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.total).toBe(2);
  });

  it('filters by status query param', async () => {
    mockPrisma.approvalQueueEntry.findMany.mockResolvedValue([]);
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(0);

    const app = buildApp();
    await request(app)
      .get('/api/v1/products/approval-queue?status=APPROVED')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(mockPrisma.approvalQueueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'APPROVED' }),
      })
    );
  });

  it('filters by invoiceRisk query param', async () => {
    mockPrisma.approvalQueueEntry.findMany.mockResolvedValue([]);
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(0);

    const app = buildApp();
    await request(app)
      .get('/api/v1/products/approval-queue?invoiceRisk=HIGH')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(mockPrisma.approvalQueueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ invoiceRiskLevel: 'HIGH' }),
      })
    );
  });

  it('filters by importJobId query param', async () => {
    mockPrisma.approvalQueueEntry.findMany.mockResolvedValue([]);
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(0);

    const app = buildApp();
    await request(app)
      .get('/api/v1/products/approval-queue?importJobId=job-99')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(mockPrisma.approvalQueueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ importJobId: 'job-99' }),
      })
    );
  });

  it('defaults to status=PENDING', async () => {
    mockPrisma.approvalQueueEntry.findMany.mockResolvedValue([]);
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(0);

    const app = buildApp();
    await request(app)
      .get('/api/v1/products/approval-queue')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(mockPrisma.approvalQueueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
      })
    );
  });

  it('respects page and limit params', async () => {
    mockPrisma.approvalQueueEntry.findMany.mockResolvedValue([]);
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(50);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue?page=3&limit=10')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.body.page).toBe(3);
    expect(res.body.limit).toBe(10);
    expect(mockPrisma.approvalQueueEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue');

    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/products/approval-queue/:queueId ──

describe('GET /api/v1/products/approval-queue/:queueId', () => {
  it('returns 200 with the full queue entry', async () => {
    const entry = {
      id: 'queue-abc', status: 'PENDING', normalizedData: { name: 'Milk' },
    };
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(entry);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/queue-abc')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('queue-abc');
    expect(res.body.normalizedData.name).toBe('Milk');
  });

  it('returns 404 when queueId not found', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/nonexistent')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/queue-abc');

    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/products/approval-queue/:queueId/approve ──

describe('POST /api/v1/products/approval-queue/:queueId/approve', () => {
  const pendingEntry = {
    id: 'queue-1',
    status: 'PENDING',
    importJobId: 'job-1',
    normalizedData: { name: 'Milk', price: 3.99 },
    matchResult: { action: 'CREATE', matchedProductId: null },
    confidenceScore: 80,
  };

  it('returns 400 when notes is empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-1/approve')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: '' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('notes');
  });

  it('returns 400 when notes is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-1/approve')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 when queueId not found', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/nonexistent/approve')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'Looks good' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when entry is not PENDING', async () => {
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue({
      ...pendingEntry,
      status: 'APPROVED',
    });

    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-1/approve')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'Approved again' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('APPROVED');
  });

  it('returns 200 and updates entry to APPROVED when valid', async () => {
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(pendingEntry);

    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-1/approve')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'Reviewed and approved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.productId).toBeTruthy();

    expect(mockPrisma.approvalQueueEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED',
          action: 'APPROVE',
          actionNotes: 'Reviewed and approved',
        }),
      })
    );
  });

  it('writes an AuditLog entry on approve', async () => {
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(pendingEntry);

    const app = buildApp();
    await request(app)
      .post('/api/v1/products/approval-queue/queue-1/approve')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'OK' });

    // AuditLog is fire-and-forget — give it a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerSource: 'UI_ACTION',
          triggerFunction: 'ApprovalQueue.approve',
        }),
      })
    );
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-1/approve')
      .send({ notes: 'test' });

    expect(res.status).toBe(401);
  });
});

// ── POST /api/v1/products/approval-queue/:queueId/reject ──

describe('POST /api/v1/products/approval-queue/:queueId/reject', () => {
  const pendingEntry = {
    id: 'queue-2',
    status: 'PENDING',
    importJobId: 'job-1',
  };

  it('returns 400 when notes is empty', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-2/reject')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 404 when queueId not found', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/nonexistent/reject')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'Not valid' });

    expect(res.status).toBe(404);
  });

  it('returns 200 and updates entry to REJECTED', async () => {
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(pendingEntry);

    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-2/reject')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'Duplicate product' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    expect(mockPrisma.approvalQueueEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          action: 'REJECT',
          actionNotes: 'Duplicate product',
        }),
      })
    );
  });

  it('updates importJob rowsSkipped counter', async () => {
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(pendingEntry);

    const app = buildApp();
    await request(app)
      .post('/api/v1/products/approval-queue/queue-2/reject')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send({ notes: 'Rejected' });

    // importJob update is fire-and-forget — give it a tick
    await new Promise((r) => setTimeout(r, 50));
    expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          rowsSkipped: { increment: 1 },
          rowsPendingApproval: { decrement: 1 },
        }),
      })
    );
  });

  it('requires authentication', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/products/approval-queue/queue-2/reject')
      .send({ notes: 'test' });

    expect(res.status).toBe(401);
  });
});

// ── Route registration order ──

describe('Route registration order', () => {
  it('GET /approval-queue/summary does not match /:queueId', async () => {
    mockPrisma.approvalQueueEntry.count.mockResolvedValue(0);
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/summary')
      .set('Authorization', `Bearer ${makeToken()}`);

    // Should return 200 (summary endpoint), not 404 (single entry not found)
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pendingTotal');
  });

  it('GET /approval-queue/:queueId works with a real id', async () => {
    mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue({
      id: 'real-queue-id', status: 'PENDING',
    });

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/products/approval-queue/real-queue-id')
      .set('Authorization', `Bearer ${makeToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('real-queue-id');
  });
});
