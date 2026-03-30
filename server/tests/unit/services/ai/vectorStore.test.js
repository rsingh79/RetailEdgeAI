import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Prisma ─────────────────────────────────────────────

const mockExecuteRawUnsafe = vi.fn();
const mockQueryRawUnsafe = vi.fn();
const mockCount = vi.fn();
const mockDeleteMany = vi.fn();
const mockGroupBy = vi.fn();

vi.mock('../../../../src/lib/prisma.js', () => ({
  basePrisma: {
    $executeRawUnsafe: (...args) => mockExecuteRawUnsafe(...args),
    $queryRawUnsafe: (...args) => mockQueryRawUnsafe(...args),
    productEmbedding: {
      count: (...args) => mockCount(...args),
      deleteMany: (...args) => mockDeleteMany(...args),
      groupBy: (...args) => mockGroupBy(...args),
    },
  },
}));

// Import after mocks
const {
  storeEmbedding,
  findNearestProducts,
  hasEmbedding,
  deleteAllEmbeddings,
  getEmbeddingStats,
} = await import('../../../../src/services/ai/vectorStore.js');

// ── Test fixtures ───────────────────────────────────────────

const TENANT_ID = 'tenant_abc123';
const PRODUCT_ID = 'prod_xyz789';
const MODEL_NAME = 'embed-english-v3.0';
const SAMPLE_VECTOR = [0.1, 0.2, 0.3, 0.4, 0.5];

beforeEach(() => {
  vi.clearAllMocks();
});

// ── storeEmbedding ──────────────────────────────────────────

describe('storeEmbedding', () => {
  it('calls $executeRawUnsafe with correct SQL and parameters', async () => {
    await storeEmbedding({
      id: 'emb_001',
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      model: MODEL_NAME,
      embeddingText: 'Test Product 500g',
      vector: SAMPLE_VECTOR,
      dimensions: 1024,
    });

    expect(mockExecuteRawUnsafe).toHaveBeenCalledOnce();
    const [sql, ...params] = mockExecuteRawUnsafe.mock.calls[0];
    expect(sql).toContain('INSERT INTO "ProductEmbedding"');
    expect(sql).toContain('ON CONFLICT ("productId", "model")');
    expect(sql).toContain('DO UPDATE SET');
    expect(params[0]).toBe('emb_001');
    expect(params[1]).toBe(TENANT_ID);
    expect(params[2]).toBe(PRODUCT_ID);
    expect(params[3]).toBe(MODEL_NAME);
    expect(params[4]).toBe('Test Product 500g');
    expect(params[6]).toBe(1024);
  });

  it('formats vector as bracket-delimited comma-separated string', async () => {
    await storeEmbedding({
      id: 'emb_002',
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      model: MODEL_NAME,
      embeddingText: 'Test',
      vector: [0.1, 0.2, 0.3],
    });

    const vectorParam = mockExecuteRawUnsafe.mock.calls[0][6]; // $6 is index 6 (sql at 0, params at 1..7)
    expect(vectorParam).toBe('[0.1,0.2,0.3]');
  });

  it('uses ON CONFLICT for upsert behavior', async () => {
    await storeEmbedding({
      id: 'emb_003',
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      model: MODEL_NAME,
      embeddingText: 'Test',
      vector: SAMPLE_VECTOR,
    });

    const sql = mockExecuteRawUnsafe.mock.calls[0][0];
    expect(sql).toContain('ON CONFLICT ("productId", "model")');
    expect(sql).toContain('DO UPDATE SET "embedding" = $6::vector');
  });

  it('defaults dimensions to 1024', async () => {
    await storeEmbedding({
      id: 'emb_004',
      tenantId: TENANT_ID,
      productId: PRODUCT_ID,
      model: MODEL_NAME,
      embeddingText: 'Test',
      vector: SAMPLE_VECTOR,
    });

    const dimensionsParam = mockExecuteRawUnsafe.mock.calls[0][7]; // $7 is index 7
    expect(dimensionsParam).toBe(1024);
  });

  it('accepts a custom prisma client', async () => {
    const customClient = { $executeRawUnsafe: vi.fn() };

    await storeEmbedding(
      {
        id: 'emb_005',
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        model: MODEL_NAME,
        embeddingText: 'Test',
        vector: SAMPLE_VECTOR,
      },
      customClient,
    );

    expect(customClient.$executeRawUnsafe).toHaveBeenCalledOnce();
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
  });
});

// ── findNearestProducts ─────────────────────────────────────

describe('findNearestProducts', () => {
  it('calls $queryRawUnsafe with tenantId filter', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    await findNearestProducts({
      tenantId: TENANT_ID,
      queryVector: SAMPLE_VECTOR,
      model: MODEL_NAME,
    });

    expect(mockQueryRawUnsafe).toHaveBeenCalledOnce();
    const [sql, , tenantParam, modelParam] = mockQueryRawUnsafe.mock.calls[0];
    expect(sql).toContain('pe."tenantId" = $2');
    expect(tenantParam).toBe(TENANT_ID);
    expect(modelParam).toBe(MODEL_NAME);
  });

  it('returns results with similarity as a number', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([
      { productId: 'prod_1', embeddingText: 'Product One', similarity: '0.95' },
      { productId: 'prod_2', embeddingText: 'Product Two', similarity: '0.82' },
    ]);

    const results = await findNearestProducts({
      tenantId: TENANT_ID,
      queryVector: SAMPLE_VECTOR,
      model: MODEL_NAME,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      productId: 'prod_1',
      similarity: 0.95,
      embeddingText: 'Product One',
    });
    expect(results[1]).toEqual({
      productId: 'prod_2',
      similarity: 0.82,
      embeddingText: 'Product Two',
    });
  });

  it('applies minSimilarity filter', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    await findNearestProducts({
      tenantId: TENANT_ID,
      queryVector: SAMPLE_VECTOR,
      model: MODEL_NAME,
      minSimilarity: 0.7,
    });

    const [sql, , , , minSimParam] = mockQueryRawUnsafe.mock.calls[0];
    expect(sql).toContain('>= $4');
    expect(minSimParam).toBe(0.7);
  });

  it('respects limit parameter', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    await findNearestProducts({
      tenantId: TENANT_ID,
      queryVector: SAMPLE_VECTOR,
      model: MODEL_NAME,
      limit: 5,
    });

    const [sql, , , , , limitParam] = mockQueryRawUnsafe.mock.calls[0];
    expect(sql).toContain('LIMIT $5');
    expect(limitParam).toBe(5);
  });

  it('defaults limit to 10 and minSimilarity to 0.5', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    await findNearestProducts({
      tenantId: TENANT_ID,
      queryVector: SAMPLE_VECTOR,
      model: MODEL_NAME,
    });

    const params = mockQueryRawUnsafe.mock.calls[0];
    expect(params[4]).toBe(0.5); // minSimilarity default
    expect(params[5]).toBe(10); // limit default
  });

  it('formats query vector as bracket-delimited string', async () => {
    mockQueryRawUnsafe.mockResolvedValueOnce([]);

    await findNearestProducts({
      tenantId: TENANT_ID,
      queryVector: [0.1, 0.2, 0.3],
      model: MODEL_NAME,
    });

    const vectorParam = mockQueryRawUnsafe.mock.calls[0][1];
    expect(vectorParam).toBe('[0.1,0.2,0.3]');
  });
});

// ── hasEmbedding ────────────────────────────────────────────

describe('hasEmbedding', () => {
  it('returns true when embedding exists', async () => {
    mockCount.mockResolvedValueOnce(1);

    const result = await hasEmbedding(PRODUCT_ID, MODEL_NAME);

    expect(result).toBe(true);
    expect(mockCount).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID, model: MODEL_NAME },
    });
  });

  it('returns false when no embedding exists', async () => {
    mockCount.mockResolvedValueOnce(0);

    const result = await hasEmbedding(PRODUCT_ID, MODEL_NAME);

    expect(result).toBe(false);
  });
});

// ── deleteAllEmbeddings ─────────────────────────────────────

describe('deleteAllEmbeddings', () => {
  it('calls deleteMany with correct tenantId and model filter', async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 42 });

    const result = await deleteAllEmbeddings(TENANT_ID, MODEL_NAME);

    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, model: MODEL_NAME },
    });
    expect(result).toEqual({ count: 42 });
  });
});

// ── getEmbeddingStats ───────────────────────────────────────

describe('getEmbeddingStats', () => {
  it('returns total count and per-model breakdown', async () => {
    mockCount.mockResolvedValueOnce(150);
    mockGroupBy.mockResolvedValueOnce([
      { model: 'embed-english-v3.0', _count: 100 },
      { model: 'embed-multilingual-v3.0', _count: 50 },
    ]);

    const stats = await getEmbeddingStats(TENANT_ID);

    expect(stats.total).toBe(150);
    expect(stats.byModel).toEqual([
      { model: 'embed-english-v3.0', count: 100 },
      { model: 'embed-multilingual-v3.0', count: 50 },
    ]);
    expect(mockCount).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID } });
    expect(mockGroupBy).toHaveBeenCalledWith({
      by: ['model'],
      where: { tenantId: TENANT_ID },
      _count: true,
    });
  });
});
