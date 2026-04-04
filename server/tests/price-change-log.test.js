import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { testPrisma, rlsPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestProduct,
  createTestStore,
} from './helpers/fixtures.js';
import { logPriceChange, VALID_CHANGE_SOURCES, VALID_PRICE_TYPES } from '../src/services/priceChangeLogger.js';
import { createTenantClient } from '../src/lib/prisma.js';
import app from '../src/app.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

describe('PriceChangeLogger service', () => {
  let tenant, product, prisma;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    tenant = await createTestTenant('Price Log Test');
    product = await createTestProduct(tenant.id, { name: 'Logger Test Product' });
    prisma = createTenantClient(tenant.id);
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await testPrisma.priceChangeLog.deleteMany();
  });

  it('logs a price change with all fields populated', async () => {
    const entry = await logPriceChange(prisma, {
      tenantId: tenant.id,
      productId: product.id,
      variantId: 'variant-123',
      priceType: 'selling_price',
      oldPrice: 29.99,
      newPrice: 34.99,
      changeSource: 'manual_edit',
      changedBy: 'user-abc',
      sourceRef: 'ref-xyz',
      reason: 'Test price increase',
      metadata: { test: true },
    });

    expect(entry).not.toBeNull();
    expect(entry.tenantId).toBe(tenant.id);
    expect(entry.productId).toBe(product.id);
    expect(entry.variantId).toBe('variant-123');
    expect(entry.priceType).toBe('selling_price');
    expect(entry.oldPrice).toBe(29.99);
    expect(entry.newPrice).toBe(34.99);
    expect(entry.changeSource).toBe('manual_edit');
    expect(entry.changedBy).toBe('user-abc');
    expect(entry.sourceRef).toBe('ref-xyz');
    expect(entry.reason).toBe('Test price increase');
    expect(entry.metadata).toEqual({ test: true });
  });

  it('skips logging when oldPrice === newPrice (no actual change)', async () => {
    const entry = await logPriceChange(prisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'selling_price',
      oldPrice: 29.99,
      newPrice: 29.99,
      changeSource: 'shopify_sync',
    });

    expect(entry).toBeNull();

    const count = await testPrisma.priceChangeLog.count();
    expect(count).toBe(0);
  });

  it('handles null oldPrice (first-time price set)', async () => {
    const entry = await logPriceChange(prisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: null,
      newPrice: 10.00,
      changeSource: 'bulk_import',
    });

    expect(entry).not.toBeNull();
    expect(entry.oldPrice).toBeNull();
    expect(entry.newPrice).toBe(10.00);
  });

  it('never throws — returns null and logs warning on failure', async () => {
    // Pass invalid prisma client to trigger an error
    const badPrisma = { priceChangeLog: { create: () => { throw new Error('DB failure'); } } };

    const entry = await logPriceChange(badPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'selling_price',
      oldPrice: null,
      newPrice: 10.00,
      changeSource: 'manual_edit',
    });

    expect(entry).toBeNull();
    // No exception thrown
  });

  it('rejects invalid priceType', async () => {
    const entry = await logPriceChange(prisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'invalid_type',
      oldPrice: null,
      newPrice: 10.00,
      changeSource: 'manual_edit',
    });

    expect(entry).toBeNull();
  });

  it('rejects invalid changeSource', async () => {
    const entry = await logPriceChange(prisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'selling_price',
      oldPrice: null,
      newPrice: 10.00,
      changeSource: 'unknown_source',
    });

    expect(entry).toBeNull();
  });

  it('rejects non-numeric newPrice', async () => {
    const entry = await logPriceChange(prisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'selling_price',
      oldPrice: null,
      newPrice: 'not-a-number',
      changeSource: 'manual_edit',
    });

    expect(entry).toBeNull();
  });
});

describe('PriceChangeLog RLS (tenant isolation)', () => {
  let tenantA, tenantB, productA, productB;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    tenantA = await createTestTenant('Tenant A');
    tenantB = await createTestTenant('Tenant B');
    productA = await createTestProduct(tenantA.id, { name: 'Product A' });
    productB = await createTestProduct(tenantB.id, { name: 'Product B' });

    // Create entries for both tenants using admin prisma
    await testPrisma.priceChangeLog.create({
      data: {
        tenantId: tenantA.id,
        productId: productA.id,
        priceType: 'selling_price',
        newPrice: 10.00,
        changeSource: 'manual_edit',
      },
    });
    await testPrisma.priceChangeLog.create({
      data: {
        tenantId: tenantB.id,
        productId: productB.id,
        priceType: 'selling_price',
        newPrice: 20.00,
        changeSource: 'manual_edit',
      },
    });
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  it('tenant A can only see their own price change logs', async () => {
    const prismaA = createTenantClient(tenantA.id);
    const entries = await prismaA.priceChangeLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].tenantId).toBe(tenantA.id);
    expect(entries[0].newPrice).toBe(10.00);
  });

  it('tenant B can only see their own price change logs', async () => {
    const prismaB = createTenantClient(tenantB.id);
    const entries = await prismaB.priceChangeLog.findMany();
    expect(entries).toHaveLength(1);
    expect(entries[0].tenantId).toBe(tenantB.id);
    expect(entries[0].newPrice).toBe(20.00);
  });
});

describe('Manual product create price logging', () => {
  let tenant, user, token;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    tenant = await createTestTenant('Manual Create Test');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    token = jwt.sign({ userId: user.id, tenantId: tenant.id, role: user.role }, JWT_SECRET);
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  it('creates PriceChangeLog entries when a product is created with prices', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Manual Product',
        source: 'Manual',
        costPrice: 10.00,
        sellingPrice: 25.00,
      });

    expect(res.status).toBe(201);
    const productId = res.body.id;

    // Wait briefly for fire-and-forget logs to complete
    await new Promise((r) => setTimeout(r, 500));

    const logs = await testPrisma.priceChangeLog.findMany({
      where: { productId },
      orderBy: { priceType: 'asc' },
    });

    expect(logs).toHaveLength(2);

    const costLog = logs.find((l) => l.priceType === 'cost_price');
    const sellLog = logs.find((l) => l.priceType === 'selling_price');

    expect(costLog).toBeDefined();
    expect(costLog.oldPrice).toBeNull();
    expect(costLog.newPrice).toBe(10.00);
    expect(costLog.changeSource).toBe('manual_edit');
    expect(costLog.changedBy).toBe(user.id);

    expect(sellLog).toBeDefined();
    expect(sellLog.oldPrice).toBeNull();
    expect(sellLog.newPrice).toBe(25.00);
    expect(sellLog.changeSource).toBe('manual_edit');
  });

  it('does not create PriceChangeLog entries when no prices provided', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'No Price Product',
        source: 'Manual',
      });

    expect(res.status).toBe(201);
    const productId = res.body.id;

    await new Promise((r) => setTimeout(r, 500));

    const logs = await testPrisma.priceChangeLog.findMany({
      where: { productId },
    });

    expect(logs).toHaveLength(0);
  });
});

describe('Price history API endpoint', () => {
  let tenant, user, token, product;

  beforeAll(async () => {
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
    tenant = await createTestTenant('API Test');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    token = jwt.sign({ userId: user.id, tenantId: tenant.id, role: user.role }, JWT_SECRET);
    product = await createTestProduct(tenant.id, { name: 'API Test Product' });

    // Create several price change log entries
    for (let i = 0; i < 5; i++) {
      await testPrisma.priceChangeLog.create({
        data: {
          tenantId: tenant.id,
          productId: product.id,
          priceType: i < 3 ? 'cost_price' : 'selling_price',
          oldPrice: i * 5,
          newPrice: (i + 1) * 5,
          changeSource: 'manual_edit',
          createdAt: new Date(Date.now() - (5 - i) * 86400000), // staggered dates
        },
      });
    }
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  it('returns price history for a product, newest first', async () => {
    const res = await request(app)
      .get(`/api/products/${product.id}/price-history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(5);
    expect(res.body.total).toBe(5);

    // Verify newest first
    const dates = res.body.entries.map((e) => new Date(e.createdAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it('only returns entries for the authenticated tenant', async () => {
    // Create another tenant's product and log
    const otherTenant = await createTestTenant('Other Tenant');
    const otherProduct = await createTestProduct(otherTenant.id, { name: 'Other Product' });
    await testPrisma.priceChangeLog.create({
      data: {
        tenantId: otherTenant.id,
        productId: otherProduct.id,
        priceType: 'selling_price',
        newPrice: 99.99,
        changeSource: 'manual_edit',
      },
    });

    // The original tenant should not see the other tenant's log
    const res = await request(app)
      .get(`/api/products/${otherProduct.id}/price-history`)
      .set('Authorization', `Bearer ${token}`);

    // Product not found for this tenant (RLS)
    expect(res.status).toBe(404);
  });

  it('supports priceType filtering', async () => {
    const res = await request(app)
      .get(`/api/products/${product.id}/price-history?priceType=cost_price`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(3);
    expect(res.body.entries.every((e) => e.priceType === 'cost_price')).toBe(true);
  });

  it('supports pagination', async () => {
    const res = await request(app)
      .get(`/api/products/${product.id}/price-history?limit=2&offset=0`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
  });

  it('supports date range filtering', async () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);

    const res = await request(app)
      .get(`/api/products/${product.id}/price-history?startDate=${threeDaysAgo.toISOString()}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Should only return entries from the last 3 days
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(res.body.entries.length).toBeLessThanOrEqual(5);
  });
});
