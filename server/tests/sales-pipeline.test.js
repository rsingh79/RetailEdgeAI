import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestProduct,
  createTestStore,
} from './helpers/fixtures.js';
import {
  getCostAtTimeOfSale,
  batchGetCostAtTimeOfSale,
  calculateMargin,
} from '../src/services/analytics/costLookup.js';

// Use testPrisma (admin, bypasses RLS) for all test operations.
// RLS isolation on SalesTransaction/SalesLineItem is verified by the
// dedicated tenant-isolation.test.js suite.

describe('Sales Data Pipeline', () => {
  let tenant, store, productA, productB, productC;

  beforeAll(async () => {
    // Clean up any stale data
    await testPrisma.salesLineItem.deleteMany();
    await testPrisma.salesTransaction.deleteMany();
    await testPrisma.priceChangeLog.deleteMany();
    await testPrisma.productVariant.deleteMany();
    await testPrisma.product.deleteMany();
    await testPrisma.store.deleteMany();

    tenant = await createTestTenant('Sales Pipeline Test');

    store = await createTestStore(tenant.id, { name: 'Test POS', type: 'POS', platform: 'TestPOS' });

    productA = await createTestProduct(tenant.id, { name: 'Widget Alpha', barcode: '111', source: 'Shopify' });
    productB = await createTestProduct(tenant.id, { name: 'Widget Beta', barcode: '222', source: 'Shopify' });
    productC = await createTestProduct(tenant.id, { name: 'Widget Gamma', barcode: '333', source: 'Manual' });

    // Create variants for products A and B with shopifyVariantId
    await testPrisma.productVariant.create({
      data: {
        productId: productA.id,
        storeId: store.id,
        sku: 'WA-001',
        name: 'Widget Alpha',
        unitQty: 1,
        currentCost: 5.0,
        salePrice: 10.0,
        shopifyVariantId: 'shpfy_var_100',
        isActive: true,
      },
    });

    await testPrisma.productVariant.create({
      data: {
        productId: productB.id,
        storeId: store.id,
        sku: 'WB-001',
        name: 'Widget Beta',
        unitQty: 1,
        currentCost: 8.0,
        salePrice: 15.0,
        shopifyVariantId: 'shpfy_var_200',
        isActive: true,
      },
    });

    // Seed PriceChangeLog entries for cost-at-time-of-sale testing.
    // Product A: cost $4.00 from 1 March, updated to $4.50 on 15 March
    await testPrisma.priceChangeLog.create({
      data: {
        tenantId: tenant.id,
        productId: productA.id,
        priceType: 'cost_price',
        oldPrice: null,
        newPrice: 4.0,
        changeSource: 'bulk_import',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      },
    });

    await testPrisma.priceChangeLog.create({
      data: {
        tenantId: tenant.id,
        productId: productA.id,
        priceType: 'cost_price',
        oldPrice: 4.0,
        newPrice: 4.5,
        changeSource: 'invoice_processing',
        createdAt: new Date('2026-03-15T00:00:00Z'),
      },
    });

    // Product B: cost $8.00 from 10 March
    await testPrisma.priceChangeLog.create({
      data: {
        tenantId: tenant.id,
        productId: productB.id,
        priceType: 'cost_price',
        oldPrice: null,
        newPrice: 8.0,
        changeSource: 'bulk_import',
        createdAt: new Date('2026-03-10T00:00:00Z'),
      },
    });

    // Product C: NO cost data at all
  });

  afterAll(async () => {
    await testPrisma.salesLineItem.deleteMany();
    await testPrisma.salesTransaction.deleteMany();
    await testPrisma.priceChangeLog.deleteMany();
    await testPrisma.productVariant.deleteMany();
    await testPrisma.product.deleteMany();
    await testPrisma.store.deleteMany();
    await testPrisma.$disconnect();
  });

  // ── Cost Lookup Tests ──

  describe('getCostAtTimeOfSale', () => {
    it('returns $4.00 for Product A on 10 March (before invoice update)', async () => {
      const cost = await getCostAtTimeOfSale(testPrisma, productA.id, new Date('2026-03-10T12:00:00Z'));
      expect(cost).toBe(4.0);
    });

    it('returns $4.50 for Product A on 20 March (after invoice update)', async () => {
      const cost = await getCostAtTimeOfSale(testPrisma, productA.id, new Date('2026-03-20T12:00:00Z'));
      expect(cost).toBe(4.5);
    });

    it('returns null for Product A on 20 February (before any cost data)', async () => {
      const cost = await getCostAtTimeOfSale(testPrisma, productA.id, new Date('2026-02-20T12:00:00Z'));
      expect(cost).toBeNull();
    });

    it('returns $8.00 for Product B on 15 March', async () => {
      const cost = await getCostAtTimeOfSale(testPrisma, productB.id, new Date('2026-03-15T12:00:00Z'));
      expect(cost).toBe(8.0);
    });

    it('returns null for Product C (no cost data ever)', async () => {
      const cost = await getCostAtTimeOfSale(testPrisma, productC.id, new Date('2026-03-20T12:00:00Z'));
      expect(cost).toBeNull();
    });

    it('returns null for unknown product', async () => {
      const cost = await getCostAtTimeOfSale(testPrisma, 'nonexistent_id', new Date('2026-03-20T12:00:00Z'));
      expect(cost).toBeNull();
    });

    it('returns null for null inputs', async () => {
      expect(await getCostAtTimeOfSale(testPrisma, null, new Date())).toBeNull();
      expect(await getCostAtTimeOfSale(testPrisma, productA.id, null)).toBeNull();
    });
  });

  describe('batchGetCostAtTimeOfSale', () => {
    it('returns costs for multiple products in one call', async () => {
      const results = await batchGetCostAtTimeOfSale(testPrisma, [
        { productId: productA.id, saleDate: new Date('2026-03-20T12:00:00Z') },
        { productId: productB.id, saleDate: new Date('2026-03-15T12:00:00Z') },
        { productId: productC.id, saleDate: new Date('2026-03-20T12:00:00Z') },
      ]);
      expect(results.get(productA.id)).toBe(4.5);
      expect(results.get(productB.id)).toBe(8.0);
      expect(results.get(productC.id)).toBeNull();
    });

    it('handles empty input', async () => {
      const results = await batchGetCostAtTimeOfSale(testPrisma, []);
      expect(results.size).toBe(0);
    });
  });

  describe('calculateMargin', () => {
    it('calculates margin when cost is known', () => {
      const result = calculateMargin(10.0, 4.0);
      expect(result.costPriceAtSale).toBe(4.0);
      expect(result.marginAmount).toBe(6.0);
      expect(result.marginPercent).toBe(60.0);
      expect(result.costDataAvailable).toBe(true);
    });

    it('returns null fields when cost is null', () => {
      const result = calculateMargin(10.0, null);
      expect(result.costPriceAtSale).toBeNull();
      expect(result.marginAmount).toBeNull();
      expect(result.marginPercent).toBeNull();
      expect(result.costDataAvailable).toBe(false);
    });

    it('handles zero selling price', () => {
      const result = calculateMargin(0, 5.0);
      expect(result.marginAmount).toBe(-5.0);
      expect(result.marginPercent).toBeNull(); // division by zero
      expect(result.costDataAvailable).toBe(true);
    });

    it('handles negative margin (selling below cost)', () => {
      const result = calculateMargin(8.0, 10.0);
      expect(result.marginAmount).toBe(-2.0);
      expect(result.marginPercent).toBe(-25.0);
      expect(result.costDataAvailable).toBe(true);
    });
  });

  // ── Canonical SalesTransaction/SalesLineItem Tests ──

  describe('SalesTransaction canonical records', () => {
    beforeEach(async () => {
      await testPrisma.salesLineItem.deleteMany();
      await testPrisma.salesTransaction.deleteMany();
    });

    it('creates a SalesTransaction with correct fields', async () => {
      const tx = await testPrisma.salesTransaction.create({
        data: {
          tenantId: tenant.id,
          source: 'shopify',
          sourceId: 'order_123',
          channel: 'web',
          transactionDate: new Date('2026-03-20T10:00:00Z'),
          subtotal: 45.0,
          totalDiscount: 5.0,
          totalTax: 4.0,
          totalAmount: 44.0,
          currency: 'AUD',
          status: 'completed',
          customerName: 'Jane Smith',
          orderReference: '#1001',
        },
      });

      expect(tx.id).toBeTruthy();
      expect(tx.source).toBe('shopify');
      expect(tx.channel).toBe('web');
      expect(tx.totalAmount).toBe(44.0);
      expect(tx.status).toBe('completed');
    });

    it('enforces unique constraint on [tenantId, source, sourceId]', async () => {
      await testPrisma.salesTransaction.create({
        data: {
          tenantId: tenant.id,
          source: 'shopify',
          sourceId: 'order_dup',
          transactionDate: new Date(),
          totalAmount: 10.0,
        },
      });

      await expect(
        testPrisma.salesTransaction.create({
          data: {
            tenantId: tenant.id,
            source: 'shopify',
            sourceId: 'order_dup',
            transactionDate: new Date(),
            totalAmount: 20.0,
          },
        })
      ).rejects.toThrow();
    });

    it('allows same sourceId from different sources', async () => {
      await testPrisma.salesTransaction.create({
        data: {
          tenantId: tenant.id,
          source: 'shopify',
          sourceId: 'id_100',
          transactionDate: new Date(),
          totalAmount: 10.0,
        },
      });

      const tx2 = await testPrisma.salesTransaction.create({
        data: {
          tenantId: tenant.id,
          source: 'pos_csv',
          sourceId: 'id_100',
          transactionDate: new Date(),
          totalAmount: 20.0,
        },
      });

      expect(tx2.id).toBeTruthy();
    });

    it('creates SalesLineItems with cost data and margin', async () => {
      const tx = await testPrisma.salesTransaction.create({
        data: {
          tenantId: tenant.id,
          source: 'test',
          sourceId: 'test_order_1',
          transactionDate: new Date('2026-03-20T10:00:00Z'),
          totalAmount: 25.0,
        },
      });

      // Line item with cost data
      const lineWithCost = await testPrisma.salesLineItem.create({
        data: {
          transactionId: tx.id,
          tenantId: tenant.id,
          productId: productA.id,
          sourceVariantId: 'line_1',
          productName: 'Widget Alpha',
          quantity: 2,
          unitPriceAtSale: 10.0,
          costPriceAtSale: 4.5,
          lineTotal: 20.0,
          marginAmount: 5.5,
          marginPercent: 55.0,
          costDataAvailable: true,
          matchStatus: 'matched',
          matchConfidence: 1.0,
        },
      });

      // Line item without cost data
      const lineNoCost = await testPrisma.salesLineItem.create({
        data: {
          transactionId: tx.id,
          tenantId: tenant.id,
          sourceVariantId: 'line_2',
          productName: 'Unknown Item',
          quantity: 1,
          unitPriceAtSale: 5.0,
          lineTotal: 5.0,
          matchStatus: 'unmatched',
        },
      });

      expect(lineWithCost.costDataAvailable).toBe(true);
      expect(lineWithCost.marginPercent).toBe(55.0);

      expect(lineNoCost.costDataAvailable).toBe(false);
      expect(lineNoCost.costPriceAtSale).toBeNull();
      expect(lineNoCost.marginAmount).toBeNull();
    });

    it('cascades delete from SalesTransaction to SalesLineItems', async () => {
      const tx = await testPrisma.salesTransaction.create({
        data: {
          tenantId: tenant.id,
          source: 'test',
          sourceId: 'cascade_test',
          transactionDate: new Date(),
          totalAmount: 10.0,
        },
      });

      await testPrisma.salesLineItem.create({
        data: {
          transactionId: tx.id,
          tenantId: tenant.id,
          sourceVariantId: 'cascade_line_1',
          productName: 'Test',
          quantity: 1,
          unitPriceAtSale: 10.0,
          lineTotal: 10.0,
        },
      });

      await testPrisma.salesTransaction.delete({ where: { id: tx.id } });

      const orphanedLines = await testPrisma.salesLineItem.findMany({
        where: { transactionId: tx.id },
      });
      expect(orphanedLines).toHaveLength(0);
    });

    it('upserts idempotently using unique constraint', async () => {
      const data = {
        tenantId: tenant.id,
        source: 'shopify',
        sourceId: 'upsert_test',
        transactionDate: new Date('2026-03-20T10:00:00Z'),
        totalAmount: 100.0,
        status: 'completed',
      };

      const tx1 = await testPrisma.salesTransaction.upsert({
        where: {
          tenantId_source_sourceId: { tenantId: tenant.id, source: 'shopify', sourceId: 'upsert_test' },
        },
        create: data,
        update: data,
      });

      // Update the amount
      const tx2 = await testPrisma.salesTransaction.upsert({
        where: {
          tenantId_source_sourceId: { tenantId: tenant.id, source: 'shopify', sourceId: 'upsert_test' },
        },
        create: { ...data, totalAmount: 150.0 },
        update: { totalAmount: 150.0 },
      });

      expect(tx2.id).toBe(tx1.id);
      expect(tx2.totalAmount).toBe(150.0);
    });
  });
});
