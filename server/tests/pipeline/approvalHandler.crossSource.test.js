import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock withTenantTransaction
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

const { default: productImportV1Routes } = await import(
  '../../src/routes/productImportV1.js'
);

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';
const TEST_TENANT_ID = 'test-tenant-id';
const TEST_USER_ID = 'test-user-id';

function makeToken() {
  return jwt.sign(
    { userId: TEST_USER_ID, tenantId: TEST_TENANT_ID, role: 'OWNER' },
    JWT_SECRET
  );
}

let mockPrisma;

function createMockPrisma() {
  return {
    approvalQueueEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: 'queue-1' }),
    },
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'new-product-id' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    productVariant: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'variant-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    store: {
      findFirst: vi.fn().mockResolvedValue({ id: 'store-1', name: 'Test Store' }),
      create: vi.fn().mockResolvedValue({ id: 'store-1' }),
    },
    importJob: {
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.tenantId = TEST_TENANT_ID;
    req.user = { id: TEST_USER_ID, role: 'OWNER' };
    req.prisma = mockPrisma;
    next();
  });
  app.use('/api/v1', productImportV1Routes);
  return app;
}

describe('Approval Handler — Cross-Source Predecessor Linking', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = createMockPrisma();
    app = buildApp();
  });

  describe('Single approve (Route 10)', () => {
    it('same-source predecessor: transfers variants, links canonical', async () => {
      // Queue entry with POS source
      const queueEntry = {
        id: 'queue-1',
        status: 'PENDING',
        normalizedData: {
          name: 'Organic Cacao Nibs',
          barcode: '9876543210',
          sourceSystem: 'POS',
          price: 72.00,
        },
        matchResult: { action: 'CREATE' },
        confidenceScore: 95,
      };
      mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(queueEntry);

      // Archived predecessor from same source with variants
      const archivedPredecessor = {
        id: 'old-pos-prod',
        name: 'Organic Cacao Nibs',
        source: 'POS',
        archivedAt: new Date('2025-01-01'),
        variants: [{ id: 'old-variant-1', sku: 'CACAO-500' }],
      };
      mockPrisma.product.findMany.mockResolvedValue([archivedPredecessor]);

      const res = await request(app)
        .post('/api/v1/approval-queue/queue-1/approve')
        .send({ notes: 'Approved - same source re-import' });

      expect(res.status).toBe(200);

      // Predecessor should be linked to the new product
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-pos-prod' },
          data: expect.objectContaining({ canonicalProductId: expect.any(String) }),
        })
      );

      // Variants should be transferred
      expect(mockPrisma.productVariant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'old-pos-prod' },
          data: expect.objectContaining({ productId: expect.any(String) }),
        })
      );
    });

    it('different-source predecessor: links predecessor to new product and transfers variants', async () => {
      const queueEntry = {
        id: 'queue-2',
        status: 'PENDING',
        normalizedData: {
          name: 'Organic Cacao Nibs',
          barcode: '9876543210',
          sourceSystem: 'Shopify',
          price: 74.80,
        },
        matchResult: { action: 'CREATE' },
        confidenceScore: 95,
      };
      mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(queueEntry);

      // Archived predecessor from DIFFERENT source
      const archivedPredecessor = {
        id: 'old-pos-prod',
        name: 'Organic Cacao Nibs',
        source: 'POS',
        archivedAt: new Date('2025-01-01'),
        variants: [{ id: 'old-variant-1', sku: 'CACAO-500' }],
      };
      mockPrisma.product.findMany.mockResolvedValue([archivedPredecessor]);

      const res = await request(app)
        .post('/api/v1/approval-queue/queue-2/approve')
        .send({ notes: 'Approved - cross-source link' });

      expect(res.status).toBe(200);

      // Predecessor should link to new product (source-agnostic)
      const updateCalls = mockPrisma.product.update.mock.calls;
      const predecessorLink = updateCalls.find(
        (call) => call[0].where?.id === 'old-pos-prod' &&
          call[0].data?.canonicalProductId === 'new-product-id'
      );
      expect(predecessorLink).toBeDefined();

      // Variants should be transferred (source-agnostic predecessor linking)
      expect(mockPrisma.productVariant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { productId: 'old-pos-prod' },
          data: { productId: 'new-product-id' },
        })
      );
    });

    it('predecessor search finds products regardless of source', async () => {
      const queueEntry = {
        id: 'queue-3',
        status: 'PENDING',
        normalizedData: {
          name: 'Test Product',
          barcode: '1111111111',
          sourceSystem: 'Shopify',
          price: 10.00,
        },
        matchResult: { action: 'CREATE' },
        confidenceScore: 90,
      };
      mockPrisma.approvalQueueEntry.findFirst.mockResolvedValue(queueEntry);
      mockPrisma.product.findMany.mockResolvedValue([]);

      await request(app)
        .post('/api/v1/approval-queue/queue-3/approve')
        .send({ notes: 'Approved' });

      // Verify the predecessor search query does NOT filter by source
      const findManyCall = mockPrisma.product.findMany.mock.calls[0];
      const whereClause = findManyCall[0].where;
      expect(whereClause).not.toHaveProperty('source');
      expect(whereClause).toHaveProperty('archivedAt');
      expect(whereClause).toHaveProperty('OR');
    });
  });
});
