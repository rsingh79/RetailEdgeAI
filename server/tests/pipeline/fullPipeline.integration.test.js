import { describe, it, test, expect, vi } from 'vitest';
import {
  buildPipeline,
  rowsToCanonical,
} from '../../src/services/importJobService.js';
import {
  createPipelineContext,
  createCanonicalProduct,
  addError,
  hasFatalError,
} from '../../src/services/agents/pipeline/index.js';

// Mock withTenantTransaction so WriteLayer can import without a real DB
vi.mock('../../src/lib/prisma.js', () => ({
  withTenantTransaction: vi.fn(async (tenantId, cb) => {
    return cb({
      product: {
        create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
        update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      },
      productVariant: { upsert: vi.fn() },
      productImportRecord: { create: vi.fn() },
      importJob: { update: vi.fn() },
    });
  }),
}));

function buildDryRunContext(overrides = {}) {
  return createPipelineContext({
    tenantId: 'test-tenant-id',
    userId: 'test-user-id',
    importJobId: 'test-job-id',
    prisma: null,
    dryRun: true,
    sourceType: 'CSV_UPLOAD',
    sourceName: 'TestSource',
    stageData: {
      sourceTrusted: true,
      sourcePriorImports: 5,
      sourceDuplicateIncidents: 0,
      sourceResolutionMethod: 'explicit',
      // Max achievable score without DB is ~80 (identity 22 + source 20
      // + data 20 + detector 15 + risk 0). Set threshold to 70 so
      // well-formed products with barcodes can auto-approve in tests.
      autoApproveThreshold: 70,
      protectedCategories: ['services', 'subscriptions'],
      fileName: 'test_import.csv',
      headers: ['name', 'price', 'cost', 'barcode'],
      ...(overrides.stageData || {}),
    },
    ...overrides,
  });
}

// ── SCENARIO 1 ──

test('high confidence product routes to ROUTE_AUTO in dry run', async () => {
  const pipeline = buildPipeline();
  const ctx = buildDryRunContext();

  const products = [
    createCanonicalProduct({
      name: 'Full Cream Milk 2L',
      price: 3.99,
      costPrice: 2.10,
      barcode: '9300633100033',
      category: 'Dairy',
      brand: 'Dairy Farmers',
      sku: 'DCM-2L',
      quantity: 100,
      baseUnit: 'L',
      currency: 'AUD',
      status: 'ACTIVE',
    }),
  ];

  const result = await pipeline.run(products, ctx);
  const p = result.products[0];

  expect(p.sourceSystem).not.toBe(null);
  expect(p.fingerprint).toMatch(/^T1:/);
  expect(p.normalised.name).toBeTruthy();
  expect(p.matchResult.action).toBe('CREATE');
  expect(typeof p.confidenceScore).toBe('number');
  expect(p.confidenceScore).toBeGreaterThan(0);
  expect(p.confidenceScore).toBeLessThanOrEqual(100);
  expect(p.approvalRoute).not.toBe(null);
  expect(ctx.rowsCreated).toBe(1);
  expect(hasFatalError(p)).toBe(false);
});

// ── SCENARIO 2 ──

test('low identity product routes to ROUTE_REVIEW in dry run', async () => {
  const pipeline = buildPipeline();
  const ctx = buildDryRunContext({
    stageData: {
      sourceTrusted: true,
      sourcePriorImports: 0, // first import from this source
      sourceDuplicateIncidents: 0,
      sourceResolutionMethod: 'explicit',
      autoApproveThreshold: 95,
      protectedCategories: ['services', 'subscriptions'],
      fileName: 'test_import.csv',
      headers: ['name', 'price'],
    },
  });

  const products = [
    createCanonicalProduct({
      name: 'Milk',
      price: 3.99,
      currency: 'AUD',
      status: 'ACTIVE',
    }),
  ];

  const result = await pipeline.run(products, ctx);
  const p = result.products[0];

  expect(p.fingerprintTier).toBe(4);
  expect(p.fingerprint).toMatch(/^T4:/);
  expect(p.approvalRoute).toBe('ROUTE_REVIEW');
  expect(ctx.rowsPendingApproval).toBe(1);
});

// ── SCENARIO 3 ──

test('mixed batch processes all products independently', async () => {
  const pipeline = buildPipeline();
  const ctx = buildDryRunContext();

  const products = [
    // 1. Full product with barcode
    createCanonicalProduct({
      name: 'Full Cream Milk 2L', price: 3.99, barcode: '9300633100033',
      category: 'Dairy', brand: 'Dairy Farmers', sku: 'DCM-2L',
      currency: 'AUD', status: 'ACTIVE',
    }),
    // 2. Product with externalId only
    createCanonicalProduct({
      name: 'Coffee Beans', price: 14.99,
      externalId: 'PROD-123', sourceSystem: 'lightspeed',
      currency: 'AUD', status: 'ACTIVE',
    }),
    // 3. Product with only name
    createCanonicalProduct({
      name: 'Generic Product', price: 5.00,
      currency: 'AUD', status: 'ACTIVE',
    }),
    // 4. Product with missing name
    createCanonicalProduct({
      name: '', price: 2.50,
      currency: 'AUD', status: 'ACTIVE',
    }),
    // 5. Full product with all recommended fields
    createCanonicalProduct({
      name: 'Olive Oil Extra Virgin', price: 12.99, costPrice: 7.50,
      barcode: '1234567890128', category: 'Pantry', brand: 'Cobram',
      sku: 'OO-500', description: 'Premium cold-pressed', quantity: 50,
      weight: 0.5, baseUnit: 'L',
      currency: 'AUD', status: 'ACTIVE',
    }),
  ];

  const result = await pipeline.run(products, ctx);

  expect(result.products).toHaveLength(5);

  for (let i = 0; i < 5; i++) {
    const p = result.products[i];
    expect(p.approvalRoute).not.toBe(null);
    expect(typeof p.confidenceScore).toBe('number');
    expect(p.fingerprint).toBeTruthy();
  }

  // Product 4 (empty name) should have a warning about empty name
  const p4 = result.products[3];
  expect(p4.normalised.name).toBe('');

  // All others should have normalised names
  expect(result.products[0].normalised.name).toBeTruthy();
  expect(result.products[1].normalised.name).toBeTruthy();
  expect(result.products[2].normalised.name).toBeTruthy();
  expect(result.products[4].normalised.name).toBeTruthy();

  expect(ctx.processedRows).toBe(5);

  const total = ctx.rowsCreated + ctx.rowsUpdated + ctx.rowsSkipped +
    ctx.rowsFailed + ctx.rowsPendingApproval;
  expect(total).toBe(5);
});

// ── SCENARIO 4 ──

test('fatal error in one product does not block others', async () => {
  const pipeline = buildPipeline();
  const ctx = buildDryRunContext();

  const products = [
    createCanonicalProduct({
      name: 'Product A', price: 9.99, barcode: '12345678',
      currency: 'AUD', status: 'ACTIVE',
    }),
    createCanonicalProduct({
      name: 'Product B', price: 5.99,
      currency: 'AUD', status: 'ACTIVE',
    }),
    createCanonicalProduct({
      name: 'Product C', price: 7.99, barcode: '87654321',
      currency: 'AUD', status: 'ACTIVE',
    }),
  ];

  // Inject fatal error into product[1] before pipeline runs
  addError(products[1], 'test', 'Injected fatal error', true);

  const result = await pipeline.run(products, ctx);

  // Product 0 processed normally
  expect(result.products[0].approvalRoute).not.toBe(null);
  expect(result.products[0].fingerprint).toBeTruthy();

  // Product 1 has fatal error — stages were skipped
  expect(hasFatalError(result.products[1])).toBe(true);

  // Product 2 processed normally
  expect(result.products[2].approvalRoute).not.toBe(null);
  expect(result.products[2].fingerprint).toBeTruthy();
});

// ── SCENARIO 5 ──

test('dry run mode produces zero database writes', async () => {
  const pipeline = buildPipeline();

  const mockPrisma = {
    product: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    productVariant: { upsert: vi.fn(), findFirst: vi.fn() },
    productImportRecord: { create: vi.fn() },
    importJob: { update: vi.fn() },
    approvalQueueEntry: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    interactionSignal: { create: vi.fn() },
    importTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
    invoiceLineMatch: { count: vi.fn().mockResolvedValue(0) },
  };

  const ctx = createPipelineContext({
    tenantId: 'test-tenant-id',
    userId: 'test-user-id',
    importJobId: 'test-job-id',
    prisma: mockPrisma,
    dryRun: true,
    sourceType: 'CSV_UPLOAD',
    sourceName: 'TestSource',
    stageData: {
      sourceTrusted: true,
      sourcePriorImports: 5,
      sourceDuplicateIncidents: 0,
      sourceResolutionMethod: 'explicit',
      autoApproveThreshold: 95,
      protectedCategories: ['services', 'subscriptions'],
    },
  });

  const products = Array.from({ length: 5 }, (_, i) =>
    createCanonicalProduct({
      name: `Product ${i + 1}`,
      price: 9.99 + i,
      barcode: `${12345678 + i}`,
      currency: 'AUD',
      status: 'ACTIVE',
    })
  );

  const result = await pipeline.run(products, ctx);

  // No write methods called
  expect(mockPrisma.product.create).not.toHaveBeenCalled();
  expect(mockPrisma.product.update).not.toHaveBeenCalled();
  expect(mockPrisma.approvalQueueEntry.create).not.toHaveBeenCalled();
  expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();

  // But all products were still analyzed
  for (const p of result.products) {
    expect(p.approvalRoute).not.toBe(null);
  }
});

// ── SCENARIO 6 ──

test('rowsToCanonical correctly converts testRun rows', () => {
  const rows = [
    {
      name: 'Full Cream Milk 2L',
      sellingPrice: 3.99,
      costPrice: 2.10,
      barcode: '9300633100033',
      variants: [],
    },
    {
      name: 'Coffee Beans 500g',
      sellingPrice: 14.99,
      costPrice: 8.00,
      variants: [],
    },
    {
      name: 'Olive Oil 1L',
      sellingPrice: 12.99,
      costPrice: 7.50,
      barcode: '1234567890128',
      variants: [],
    },
  ];
  const session = { gstDetected: false, gstRate: 0.1 };
  const products = rowsToCanonical(rows, session);

  expect(products).toHaveLength(3);

  // Each has rowIndex matching position
  expect(products[0].rowIndex).toBe(0);
  expect(products[1].rowIndex).toBe(1);
  expect(products[2].rowIndex).toBe(2);

  // Each has rawSourceData set to original row
  expect(products[0].rawSourceData).toBe(rows[0]);
  expect(products[1].rawSourceData).toBe(rows[1]);

  // Price mapped from sellingPrice
  expect(products[0].price).toBe(3.99);
  expect(products[1].price).toBe(14.99);
  expect(products[2].price).toBe(12.99);

  // Empty variants
  expect(products[0].variants).toHaveLength(0);

  // All required CanonicalProduct fields exist
  for (const p of products) {
    expect(p).toHaveProperty('name');
    expect(p).toHaveProperty('price');
    expect(p).toHaveProperty('currency');
    expect(p).toHaveProperty('status');
    expect(p).toHaveProperty('matchResult');
    expect(p).toHaveProperty('invoiceRisk');
    expect(p).toHaveProperty('errors');
    expect(p).toHaveProperty('warnings');
    expect(p).toHaveProperty('normalised');
  }
});

// ── SCENARIO 7: rowsToCanonical name fallbacks ──

test('rowsToCanonical picks up name from productName fallback', () => {
  const rows = [
    { productName: 'Organic Cacao Nibs', sellingPrice: 15.99, variants: [] },
  ];
  const session = { gstDetected: false, gstRate: 0.1 };
  const products = rowsToCanonical(rows, session);

  expect(products).toHaveLength(1);
  expect(products[0].name).toBe('Organic Cacao Nibs');
  expect(products[0].rawSourceData.productName).toBe('Organic Cacao Nibs');
});

test('rowsToCanonical picks up name from title fallback', () => {
  const rows = [
    { title: 'Almond Butter 500g', sellingPrice: 12.0, variants: [] },
  ];
  const session = { gstDetected: false, gstRate: 0.1 };
  const products = rowsToCanonical(rows, session);

  expect(products).toHaveLength(1);
  expect(products[0].name).toBe('Almond Butter 500g');
});

test('rowsToCanonical maps brand from row', () => {
  const rows = [
    { name: 'Cacao Nibs', brand: 'Loving Earth', sellingPrice: 15.99, variants: [] },
  ];
  const session = { gstDetected: false, gstRate: 0.1 };
  const products = rowsToCanonical(rows, session);

  expect(products).toHaveLength(1);
  expect(products[0].brand).toBe('Loving Earth');
});

test('rowsToCanonical name from primary field takes precedence over fallbacks', () => {
  const rows = [
    { name: 'Primary Name', productName: 'Fallback Name', title: 'Title Name', sellingPrice: 5.0, variants: [] },
  ];
  const session = { gstDetected: false, gstRate: 0.1 };
  const products = rowsToCanonical(rows, session);

  expect(products[0].name).toBe('Primary Name');
});
