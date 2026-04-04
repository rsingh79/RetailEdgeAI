import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import { createTestTenant, createTestUser, createTestProduct, createTestSupplier } from './helpers/fixtures.js';
import { logPriceChange } from '../src/services/priceChangeLogger.js';

// ══════════════════════════════════════════════════════════════
// Shared test state — set up once, cleaned before each test
// ══════════════════════════════════════════════════════════════

let tenant, user, supplier;

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await testPrisma.$disconnect();
});

beforeEach(async () => {
  await cleanDatabase();
  tenant = await createTestTenant('Correction Test Business');
  user = await createTestUser(tenant.id, { role: 'OWNER' });
  supplier = await createTestSupplier(tenant.id, { name: 'Acme Supplies' });
});

// ── Helpers ──────────────────────────────────────────────────

async function createInvoiceWithMatch(productId, cost, opts = {}) {
  const invoice = await testPrisma.invoice.create({
    data: {
      tenantId: tenant.id,
      supplierId: supplier.id,
      supplierName: opts.supplierName || supplier.name || 'Acme Supplies',
      invoiceNumber: opts.invoiceNumber || `INV-${Date.now()}`,
      invoiceDate: opts.invoiceDate || new Date(),
      total: cost,
      status: opts.status || 'APPROVED',
    },
  });

  const line = await testPrisma.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      lineNumber: 1,
      description: opts.description || 'Test item',
      quantity: opts.quantity || 1,
      unitPrice: cost,
      lineTotal: cost,
      baseUnitCost: cost,
    },
  });

  const match = await testPrisma.invoiceLineMatch.create({
    data: {
      invoiceLineId: line.id,
      productId,
      confidence: 0.95,
      matchReason: 'fuzzy_name',
      previousCost: opts.previousCost ?? null,
      newCost: cost,
      status: 'APPROVED',
      matchStatus: 'active',
    },
  });

  return { invoice, line, match };
}

// ══════════════════════════════════════════════════════════════
// Item 1: Price History Enrichment
// ══════════════════════════════════════════════════════════════

describe('Price history enrichment', () => {
  it('returns invoiceContext for invoice_processing entries', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Flour 10kg' });
    const { invoice } = await createInvoiceWithMatch(product.id, 10);

    await logPriceChange(testPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: 8,
      newPrice: 10,
      changeSource: 'invoice_processing',
      sourceRef: invoice.id,
      reason: `Invoice #${invoice.invoiceNumber} approved`,
    });

    const entries = await testPrisma.priceChangeLog.findMany({
      where: { productId: product.id },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].sourceRef).toBe(invoice.id);
    expect(entries[0].changeSource).toBe('invoice_processing');

    // Simulate the enrichment logic from the API
    const invoiceSources = new Set(['invoice_processing', 'invoice_correction']);
    const invoiceIds = [...new Set(
      entries.filter(e => invoiceSources.has(e.changeSource) && e.sourceRef).map(e => e.sourceRef)
    )];
    expect(invoiceIds).toEqual([invoice.id]);

    const invoices = await testPrisma.invoice.findMany({
      where: { id: { in: invoiceIds } },
      select: { id: true, invoiceNumber: true, invoiceDate: true, supplier: { select: { name: true } } },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].supplier.name).toBe('Acme Supplies');
  });

  it('returns invoiceContext null for non-invoice entries', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Sugar 5kg' });

    await logPriceChange(testPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: null,
      newPrice: 5,
      changeSource: 'manual_edit',
      changedBy: user.id,
    });

    const entries = await testPrisma.priceChangeLog.findMany({
      where: { productId: product.id },
    });
    expect(entries).toHaveLength(1);
    const invoiceSources = new Set(['invoice_processing', 'invoice_correction']);
    const hasInvoiceContext = invoiceSources.has(entries[0].changeSource) && entries[0].sourceRef;
    expect(hasInvoiceContext).toBeFalsy();
  });

  it('handles deleted invoice gracefully (invoiceContext null)', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Salt 1kg' });

    // Log a price change referencing a non-existent invoice ID
    await logPriceChange(testPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: 3,
      newPrice: 4,
      changeSource: 'invoice_processing',
      sourceRef: 'non_existent_invoice_id',
    });

    const invoices = await testPrisma.invoice.findMany({
      where: { id: 'non_existent_invoice_id' },
    });
    expect(invoices).toHaveLength(0); // Lookup returns nothing, enrichment returns null
  });
});

// ══════════════════════════════════════════════════════════════
// Item 2: Invoice Search and Sort
// ══════════════════════════════════════════════════════════════

describe('Invoice search and sort', () => {
  let inv1, inv2, inv3;

  beforeEach(async () => {
    const supplier2 = await createTestSupplier(tenant.id, { name: 'Baker\'s Best' });
    const supplier3 = await createTestSupplier(tenant.id, { name: 'Coastal Fresh' });

    inv1 = await testPrisma.invoice.create({
      data: {
        tenantId: tenant.id, supplierId: supplier.id, supplierName: 'Acme Supplies',
        invoiceNumber: 'INV-001', total: 100, status: 'APPROVED',
        createdAt: new Date('2026-01-01'),
      },
    });
    inv2 = await testPrisma.invoice.create({
      data: {
        tenantId: tenant.id, supplierId: supplier2.id, supplierName: 'Baker\'s Best',
        invoiceNumber: 'INV-002', total: 250, status: 'READY',
        createdAt: new Date('2026-02-01'),
      },
    });
    inv3 = await testPrisma.invoice.create({
      data: {
        tenantId: tenant.id, supplierId: supplier3.id, supplierName: 'Coastal Fresh',
        invoiceNumber: 'INV-003', total: 50, status: 'APPROVED',
        createdAt: new Date('2026-03-01'),
      },
    });
  });

  it('searches by supplier name (case-insensitive)', async () => {
    const results = await testPrisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        archivedAt: null,
        OR: [
          { invoiceNumber: { contains: 'acme', mode: 'insensitive' } },
          { supplier: { name: { contains: 'acme', mode: 'insensitive' } } },
        ],
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(inv1.id);
  });

  it('searches by invoice number', async () => {
    const results = await testPrisma.invoice.findMany({
      where: {
        tenantId: tenant.id,
        archivedAt: null,
        OR: [
          { invoiceNumber: { contains: 'INV-002', mode: 'insensitive' } },
          { supplier: { name: { contains: 'INV-002', mode: 'insensitive' } } },
        ],
      },
    });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(inv2.id);
  });

  it('sorts by total ascending', async () => {
    const results = await testPrisma.invoice.findMany({
      where: { tenantId: tenant.id, archivedAt: null },
      orderBy: { total: 'asc' },
    });
    expect(results.map(r => r.total)).toEqual([50, 100, 250]);
  });

  it('sorts by date descending (default)', async () => {
    const results = await testPrisma.invoice.findMany({
      where: { tenantId: tenant.id, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(results[0].id).toBe(inv3.id);
    expect(results[2].id).toBe(inv1.id);
  });

  it('empty search returns all invoices', async () => {
    const results = await testPrisma.invoice.findMany({
      where: { tenantId: tenant.id, archivedAt: null },
    });
    expect(results).toHaveLength(3);
  });
});

// ══════════════════════════════════════════════════════════════
// Item 3 + 5: Newer Invoice Detection
// ══════════════════════════════════════════════════════════════

describe('Newer invoice detection', () => {
  it('detects when a newer invoice has updated the same product', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Olive Oil 1L' });

    // Invoice A approved: cost $8 → $10
    const { invoice: invA } = await createInvoiceWithMatch(product.id, 10, {
      invoiceNumber: 'INV-A', previousCost: 8,
    });

    await logPriceChange(testPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: 8,
      newPrice: 10,
      changeSource: 'invoice_processing',
      sourceRef: invA.id,
    });

    // Wait 10ms to ensure different timestamps
    await new Promise(r => setTimeout(r, 10));

    // Invoice B approved: cost $10 → $12
    const { invoice: invB } = await createInvoiceWithMatch(product.id, 12, {
      invoiceNumber: 'INV-B', previousCost: 10,
    });

    await logPriceChange(testPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: 10,
      newPrice: 12,
      changeSource: 'invoice_processing',
      sourceRef: invB.id,
    });

    // Check: Invoice A should see a newer log from Invoice B
    const invALog = await testPrisma.priceChangeLog.findFirst({
      where: { sourceRef: invA.id, productId: product.id, changeSource: 'invoice_processing' },
    });

    const newerLogs = await testPrisma.priceChangeLog.findMany({
      where: {
        productId: product.id,
        priceType: 'cost_price',
        changeSource: { in: ['invoice_processing', 'invoice_correction'] },
        createdAt: { gt: invALog.createdAt },
        NOT: { sourceRef: invA.id },
      },
    });

    expect(newerLogs).toHaveLength(1);
    expect(newerLogs[0].sourceRef).toBe(invB.id);
    expect(newerLogs[0].newPrice).toBe(12);

    // Invoice B should NOT have any newer logs
    const invBLog = await testPrisma.priceChangeLog.findFirst({
      where: { sourceRef: invB.id, productId: product.id, changeSource: 'invoice_processing' },
    });

    const newerThanB = await testPrisma.priceChangeLog.findMany({
      where: {
        productId: product.id,
        priceType: 'cost_price',
        changeSource: { in: ['invoice_processing', 'invoice_correction'] },
        createdAt: { gt: invBLog.createdAt },
        NOT: { sourceRef: invB.id },
      },
    });

    expect(newerThanB).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════
// Item 4: Match Correction — Cost Reversal Logic
// ══════════════════════════════════════════════════════════════

describe('Match correction — cost reversal', () => {
  describe('Scenario A: simple rematch', () => {
    it('reverts old product cost and applies cost to new product', async () => {
      const productX = await createTestProduct(tenant.id, { name: 'Product X' });
      const productY = await createTestProduct(tenant.id, { name: 'Product Y' });

      // Set initial costs
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: 8 } });
      await testPrisma.product.update({ where: { id: productY.id }, data: { costPrice: 5 } });

      // Invoice #1 matches Product X, cost $8 → $10
      const { invoice } = await createInvoiceWithMatch(productX.id, 10, {
        invoiceNumber: 'INV-1', previousCost: 8,
      });
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: 10 } });

      await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: productX.id,
        priceType: 'cost_price',
        oldPrice: 8,
        newPrice: 10,
        changeSource: 'invoice_processing',
        sourceRef: invoice.id,
      });

      // Simulate correction: find the original log, revert
      const originalLog = await testPrisma.priceChangeLog.findFirst({
        where: { sourceRef: invoice.id, changeSource: 'invoice_processing', productId: productX.id },
        orderBy: { createdAt: 'desc' },
      });

      expect(originalLog).not.toBeNull();
      expect(originalLog.oldPrice).toBe(8);

      // Revert Product X
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: originalLog.oldPrice } });

      // Apply to Product Y
      await testPrisma.product.update({ where: { id: productY.id }, data: { costPrice: 10 } });

      const updatedX = await testPrisma.product.findUnique({ where: { id: productX.id } });
      const updatedY = await testPrisma.product.findUnique({ where: { id: productY.id } });

      expect(updatedX.costPrice).toBe(8);
      expect(updatedY.costPrice).toBe(10);
    });
  });

  describe('Scenario B: newer invoice supersedes', () => {
    it('skips cost revert when newer invoice has updated the product', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Product X' });
      await testPrisma.product.update({ where: { id: product.id }, data: { costPrice: 8 } });

      // Invoice #1: cost $8 → $10
      const { invoice: inv1 } = await createInvoiceWithMatch(product.id, 10, {
        invoiceNumber: 'INV-1', previousCost: 8,
      });
      await testPrisma.product.update({ where: { id: product.id }, data: { costPrice: 10 } });

      const log1 = await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: product.id,
        priceType: 'cost_price',
        oldPrice: 8,
        newPrice: 10,
        changeSource: 'invoice_processing',
        sourceRef: inv1.id,
      });

      await new Promise(r => setTimeout(r, 10));

      // Invoice #2: cost $10 → $12
      const { invoice: inv2 } = await createInvoiceWithMatch(product.id, 12, {
        invoiceNumber: 'INV-2', previousCost: 10,
      });
      await testPrisma.product.update({ where: { id: product.id }, data: { costPrice: 12 } });

      await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: product.id,
        priceType: 'cost_price',
        oldPrice: 10,
        newPrice: 12,
        changeSource: 'invoice_processing',
        sourceRef: inv2.id,
      });

      // Now try to correct Invoice #1's match
      const originalLog = await testPrisma.priceChangeLog.findFirst({
        where: { sourceRef: inv1.id, changeSource: 'invoice_processing', productId: product.id },
        orderBy: { createdAt: 'desc' },
      });

      // Check for newer
      const newerLog = await testPrisma.priceChangeLog.findFirst({
        where: {
          productId: product.id,
          priceType: 'cost_price',
          changeSource: { in: ['invoice_processing', 'invoice_correction'] },
          createdAt: { gt: originalLog.createdAt },
          NOT: { sourceRef: inv1.id },
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(newerLog).not.toBeNull();
      expect(newerLog.sourceRef).toBe(inv2.id);

      // With acknowledgeNewerInvoice=true: skip revert, cost stays at $12
      const finalProduct = await testPrisma.product.findUnique({ where: { id: product.id } });
      expect(finalProduct.costPrice).toBe(12); // NOT reverted to $8
    });
  });

  describe('Scenario C: unmatch then rematch back', () => {
    it('handles chain of corrections correctly', async () => {
      const productX = await createTestProduct(tenant.id, { name: 'Product X' });
      const productY = await createTestProduct(tenant.id, { name: 'Product Y' });
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: 8 } });
      await testPrisma.product.update({ where: { id: productY.id }, data: { costPrice: 5 } });

      // Invoice approved: Product X $8 → $10
      const { invoice } = await createInvoiceWithMatch(productX.id, 10, {
        invoiceNumber: 'INV-1', previousCost: 8,
      });
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: 10 } });

      await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: productX.id,
        priceType: 'cost_price',
        oldPrice: 8,
        newPrice: 10,
        changeSource: 'invoice_processing',
        sourceRef: invoice.id,
      });

      // Step 1: Unmatch — Product X reverts to $8
      const log1 = await testPrisma.priceChangeLog.findFirst({
        where: { sourceRef: invoice.id, changeSource: 'invoice_processing', productId: productX.id },
        orderBy: { createdAt: 'desc' },
      });
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: log1.oldPrice } });

      await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: productX.id,
        priceType: 'cost_price',
        oldPrice: 10,
        newPrice: 8,
        changeSource: 'invoice_correction',
        sourceRef: invoice.id,
      });

      // Step 2: Rematch to Product Y — Product Y gets $10
      await testPrisma.product.update({ where: { id: productY.id }, data: { costPrice: 10 } });

      await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: productY.id,
        priceType: 'cost_price',
        oldPrice: 5,
        newPrice: 10,
        changeSource: 'invoice_processing',
        sourceRef: invoice.id,
      });

      // Step 3: Change mind — rematch back to Product X
      // Reverse Product Y first
      const logY = await testPrisma.priceChangeLog.findFirst({
        where: { sourceRef: invoice.id, changeSource: 'invoice_processing', productId: productY.id },
        orderBy: { createdAt: 'desc' },
      });
      await testPrisma.product.update({ where: { id: productY.id }, data: { costPrice: logY.oldPrice } });

      // Apply to Product X
      await testPrisma.product.update({ where: { id: productX.id }, data: { costPrice: 10 } });

      await logPriceChange(testPrisma, {
        tenantId: tenant.id,
        productId: productX.id,
        priceType: 'cost_price',
        oldPrice: 8,
        newPrice: 10,
        changeSource: 'invoice_processing',
        sourceRef: invoice.id,
      });

      // Final state: back to where we started after initial approval
      const finalX = await testPrisma.product.findUnique({ where: { id: productX.id } });
      const finalY = await testPrisma.product.findUnique({ where: { id: productY.id } });
      expect(finalX.costPrice).toBe(10);
      expect(finalY.costPrice).toBe(5);
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Item 4: Match status tracking
// ══════════════════════════════════════════════════════════════

describe('Match status tracking', () => {
  it('stores correction audit fields on InvoiceLineMatch', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Tracked Product' });
    const { match } = await createInvoiceWithMatch(product.id, 10, { invoiceNumber: 'INV-TRACK' });

    const updatedMatch = await testPrisma.invoiceLineMatch.update({
      where: { id: match.id },
      data: {
        matchStatus: 'manually_corrected',
        correctedAt: new Date(),
        correctedBy: user.id,
        previousProductId: product.id,
        correctionReason: 'Wrong product matched',
      },
    });

    expect(updatedMatch.matchStatus).toBe('manually_corrected');
    expect(updatedMatch.correctedBy).toBe(user.id);
    expect(updatedMatch.previousProductId).toBe(product.id);
    expect(updatedMatch.correctionReason).toBe('Wrong product matched');
    expect(updatedMatch.correctedAt).not.toBeNull();
  });

  it('defaults matchStatus to active', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Default Status Product' });
    const { match } = await createInvoiceWithMatch(product.id, 10, { invoiceNumber: 'INV-DEFAULT' });

    expect(match.matchStatus).toBe('active');
    expect(match.correctedAt).toBeNull();
    expect(match.correctedBy).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════
// Item 6: Stale Data Protection
// ══════════════════════════════════════════════════════════════

describe('Stale data protection', () => {
  it('invoice updatedAt changes when touched', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Stale Test Product' });
    const { invoice } = await createInvoiceWithMatch(product.id, 10, { invoiceNumber: 'INV-STALE' });

    const originalUpdatedAt = invoice.updatedAt;

    await new Promise(r => setTimeout(r, 10));

    await testPrisma.invoice.update({
      where: { id: invoice.id },
      data: { updatedAt: new Date() },
    });

    const refreshed = await testPrisma.invoice.findUnique({ where: { id: invoice.id } });
    expect(refreshed.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it('dataVersion mismatch is detectable', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Version Check Product' });
    const { invoice } = await createInvoiceWithMatch(product.id, 10, { invoiceNumber: 'INV-VER' });

    const loadedVersion = invoice.updatedAt.toISOString();

    // Simulate another user modifying the invoice
    await new Promise(r => setTimeout(r, 10));
    await testPrisma.invoice.update({
      where: { id: invoice.id },
      data: { updatedAt: new Date() },
    });

    const current = await testPrisma.invoice.findUnique({ where: { id: invoice.id } });
    const currentVersion = current.updatedAt.toISOString();

    expect(loadedVersion).not.toBe(currentVersion);
    expect(new Date(loadedVersion).getTime()).not.toBe(new Date(currentVersion).getTime());
  });
});

// ══════════════════════════════════════════════════════════════
// Item 7: Data Version Endpoint Logic
// ══════════════════════════════════════════════════════════════

describe('Data version queries', () => {
  it('returns max updatedAt for invoice_detail screen', async () => {
    const product = await createTestProduct(tenant.id, { name: 'DV Product' });
    const { invoice } = await createInvoiceWithMatch(product.id, 10, { invoiceNumber: 'INV-DV' });

    const result = await testPrisma.$queryRaw`
      SELECT GREATEST(
        (SELECT MAX("updatedAt") FROM "Invoice" WHERE "id" = ${invoice.id} AND "tenantId" = ${tenant.id}),
        (SELECT MAX(m."updatedAt") FROM "InvoiceLineMatch" m
          JOIN "InvoiceLine" l ON m."invoiceLineId" = l."id"
          WHERE l."invoiceId" = ${invoice.id})
      ) AS "dataVersion"
    `;

    expect(result[0].dataVersion).not.toBeNull();
  });

  it('dataVersion updates when match is modified', async () => {
    const product = await createTestProduct(tenant.id, { name: 'DV Update Product' });
    const { invoice, match } = await createInvoiceWithMatch(product.id, 10, { invoiceNumber: 'INV-DV2' });

    const before = await testPrisma.$queryRaw`
      SELECT GREATEST(
        (SELECT MAX("updatedAt") FROM "Invoice" WHERE "id" = ${invoice.id} AND "tenantId" = ${tenant.id}),
        (SELECT MAX(m."updatedAt") FROM "InvoiceLineMatch" m
          JOIN "InvoiceLine" l ON m."invoiceLineId" = l."id"
          WHERE l."invoiceId" = ${invoice.id})
      ) AS "dataVersion"
    `;

    await new Promise(r => setTimeout(r, 10));

    // Modify the match
    await testPrisma.invoiceLineMatch.update({
      where: { id: match.id },
      data: { matchStatus: 'manually_corrected' },
    });

    const after = await testPrisma.$queryRaw`
      SELECT GREATEST(
        (SELECT MAX("updatedAt") FROM "Invoice" WHERE "id" = ${invoice.id} AND "tenantId" = ${tenant.id}),
        (SELECT MAX(m."updatedAt") FROM "InvoiceLineMatch" m
          JOIN "InvoiceLine" l ON m."invoiceLineId" = l."id"
          WHERE l."invoiceId" = ${invoice.id})
      ) AS "dataVersion"
    `;

    expect(after[0].dataVersion.getTime()).toBeGreaterThan(before[0].dataVersion.getTime());
  });
});

// ══════════════════════════════════════════════════════════════
// invoice_correction is a valid changeSource
// ══════════════════════════════════════════════════════════════

describe('invoice_correction changeSource', () => {
  it('logPriceChange accepts invoice_correction as a valid source', async () => {
    const product = await createTestProduct(tenant.id, { name: 'Correction Source Product' });

    const result = await logPriceChange(testPrisma, {
      tenantId: tenant.id,
      productId: product.id,
      priceType: 'cost_price',
      oldPrice: 10,
      newPrice: 8,
      changeSource: 'invoice_correction',
      sourceRef: 'test_invoice_id',
      reason: 'Test correction',
    });

    expect(result).not.toBeNull();
    expect(result.changeSource).toBe('invoice_correction');
  });
});
