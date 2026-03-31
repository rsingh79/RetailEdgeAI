import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestProduct,
  createTestStore,
  createTestSupplier,
} from './helpers/fixtures.js';

// ── App import ────────────────────────────────────────────────
// Import the Express app for supertest (doesn't listen on a port)
import app from '../src/app.js';

// ══════════════════════════════════════════════════════════════
// API integration tests — matching, confirm, approve, export
// ══════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-vitest';

describe('Invoice matching API — integration tests', () => {
  let tenant, user, store, store2, supplier, token;
  let product1, product2;
  let variant1, variant1b, variant2;

  beforeAll(async () => {
    // Set JWT_SECRET for the auth middleware
    process.env.JWT_SECRET = JWT_SECRET;
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();

    // Create tenant, user, stores, supplier
    tenant = await createTestTenant('API Test Business');
    user = await createTestUser(tenant.id, { role: 'OWNER' });
    store = await createTestStore(tenant.id, { name: 'Main Store' });
    store2 = await createTestStore(tenant.id, { name: 'Harbour Store' });
    supplier = await createTestSupplier(tenant.id, { name: 'Wholesale Foods' });

    // Generate JWT token
    token = jwt.sign(
      { userId: user.id, tenantId: tenant.id, role: user.role },
      JWT_SECRET,
    );

    // Create products with variants across stores
    product1 = await createTestProduct(tenant.id, { name: 'Plain Flour', category: 'Baking' });
    variant1 = await testPrisma.productVariant.create({
      data: {
        productId: product1.id, storeId: store.id,
        sku: 'FL-001', name: 'Plain Flour', size: '1kg', unitQty: 1,
        currentCost: 1.80, salePrice: 4.49, isActive: true,
      },
    });
    variant1b = await testPrisma.productVariant.create({
      data: {
        productId: product1.id, storeId: store2.id,
        sku: 'FL-001-H', name: 'Plain Flour', size: '1kg', unitQty: 1,
        currentCost: 1.80, salePrice: 4.29, isActive: true,
      },
    });

    product2 = await createTestProduct(tenant.id, { name: 'Cheddar Cheese', category: 'Dairy' });
    variant2 = await testPrisma.productVariant.create({
      data: {
        productId: product2.id, storeId: store.id,
        sku: 'CHZ-001', name: 'Cheddar Cheese', size: '500g', unitQty: 0.5,
        currentCost: 4.50, salePrice: 9.99, isActive: true,
      },
    });
  });

  // Helpers
  async function createInvoice(lines) {
    const invoice = await testPrisma.invoice.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        invoiceNumber: `INV-${Date.now()}`,
        status: 'IN_REVIEW',
      },
    });

    for (let i = 0; i < lines.length; i++) {
      await testPrisma.invoiceLine.create({
        data: {
          invoiceId: invoice.id,
          lineNumber: i + 1,
          description: lines[i].description,
          quantity: lines[i].quantity || 5,
          unitPrice: lines[i].unitPrice || 18.50,
          lineTotal: lines[i].lineTotal || 92.50,
          packSize: lines[i].packSize || null,
          baseUnit: lines[i].baseUnit || null,
          baseUnitCost: lines[i].baseUnitCost || lines[i].unitPrice || 18.50,
          status: 'PENDING',
        },
      });
    }

    return testPrisma.invoice.findFirst({
      where: { id: invoice.id },
      include: {
        supplier: true,
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    });
  }

  // ── GET /api/stores ───────────────────────────────────────────

  describe('GET /api/stores', () => {
    it('returns active stores for the tenant', async () => {
      const res = await request(app)
        .get('/api/stores')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const names = res.body.map((s) => s.name).sort();
      expect(names).toEqual(['Harbour Store', 'Main Store']);
    });

    it('returns 401 without auth token', async () => {
      const res = await request(app).get('/api/stores');
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/products/search ──────────────────────────────────

  describe('GET /api/products/search', () => {
    it('searches products by name', async () => {
      const res = await request(app)
        .get('/api/products/search?q=flour')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Plain Flour');
      expect(res.body[0].variants.length).toBeGreaterThan(0);
    });

    it('includes variants with store info', async () => {
      const res = await request(app)
        .get('/api/products/search?q=flour')
        .set('Authorization', `Bearer ${token}`);

      const product = res.body[0];
      expect(product.variants).toHaveLength(2);
      const storeNames = product.variants.map((v) => v.store.name).sort();
      expect(storeNames).toEqual(['Harbour Store', 'Main Store']);
    });

    it('returns empty array for short query', async () => {
      const res = await request(app)
        .get('/api/products/search?q=f')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('filters by storeId when provided', async () => {
      const res = await request(app)
        .get(`/api/products/search?q=flour&storeId=${store.id}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const product = res.body[0];
      expect(product.variants).toHaveLength(1);
      expect(product.variants[0].store.name).toBe('Main Store');
    });
  });

  // ── POST /api/invoices/:id/match ──────────────────────────────

  describe('POST /api/invoices/:id/match', () => {
    it('auto-matches invoice lines and returns populated invoice', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg' },
      ]);

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0].matches.length).toBeGreaterThan(0);

      // Each match should have product/store data populated
      const match = res.body.lines[0].matches[0];
      expect(match.productVariant).toBeDefined();
      expect(match.productVariant.product).toBeDefined();
      expect(match.productVariant.store).toBeDefined();
      expect(match.matchReason).toBe('fuzzy_name');
    });

    it('creates matches for multiple stores', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg' },
      ]);

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Should have 2 matches (one per store)
      expect(res.body.lines[0].matches).toHaveLength(2);
      const storeNames = res.body.lines[0].matches.map((m) => m.productVariant.store.name).sort();
      expect(storeNames).toEqual(['Harbour Store', 'Main Store']);
    });

    it('re-running match deletes old matches first', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85 },
      ]);

      // First run
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      const countBefore = await testPrisma.invoiceLineMatch.count({
        where: { invoiceLineId: invoice.lines[0].id },
      });

      // Second run — should not accumulate matches
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      const countAfter = await testPrisma.invoiceLineMatch.count({
        where: { invoiceLineId: invoice.lines[0].id },
      });

      expect(countAfter).toBe(countBefore);
    });

    it('returns 404 for non-existent invoice', async () => {
      const res = await request(app)
        .post('/api/invoices/nonexistent-id/match')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  // ── POST /api/invoices/:id/lines/:lineId/matches ──────────────

  describe('POST /api/invoices/:id/lines/:lineId/matches (manual match)', () => {
    it('creates manual match for a specific product', async () => {
      const invoice = await createInvoice([
        { description: 'Unknown Product Description', unitPrice: 25.00, baseUnitCost: 5.00 },
      ]);
      const lineId = invoice.lines[0].id;

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${lineId}/matches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product2.id });

      expect(res.status).toBe(200);
      expect(res.body.matches).toHaveLength(1);
      expect(res.body.matches[0].matchReason).toBe('manual');
      expect(res.body.matches[0].confidence).toBe(1.0);
      expect(res.body.matches[0].productVariant.product.name).toBe('Cheddar Cheese');
    });

    it('saves SupplierProductMapping when saveMapping is true', async () => {
      const invoice = await createInvoice([
        { description: 'Farmhouse Cheddar Block 5kg', unitPrice: 48.00, baseUnitCost: 9.60 },
      ]);
      const lineId = invoice.lines[0].id;

      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${lineId}/matches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product2.id, saveMapping: true });

      // Check SupplierProductMapping was created
      const mapping = await testPrisma.supplierProductMapping.findFirst({
        where: {
          supplierId: supplier.id,
          supplierDescription: 'Farmhouse Cheddar Block 5kg',
        },
      });
      expect(mapping).not.toBeNull();
      expect(mapping.productId).toBe(product2.id);
      expect(mapping.confidence).toBe(1.0);
    });

    it('replaces existing matches on manual re-match', async () => {
      const invoice = await createInvoice([
        { description: 'Unknown Item', unitPrice: 10.00, baseUnitCost: 2.00 },
      ]);
      const lineId = invoice.lines[0].id;

      // First manual match → product1
      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${lineId}/matches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product1.id });

      // Second manual match → product2 (should replace)
      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${lineId}/matches`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: product2.id });

      expect(res.body.matches).toHaveLength(1);
      expect(res.body.matches[0].productVariant.product.name).toBe('Cheddar Cheese');
    });

    it('returns 400 without productId', async () => {
      const invoice = await createInvoice([
        { description: 'Test', unitPrice: 5.00 },
      ]);

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/matches`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ── PATCH /api/invoices/:id/lines/:lineId/matches/:matchId ────

  describe('PATCH /api/invoices/:id/lines/:lineId/matches/:matchId', () => {
    it('updates approved price on a match', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85 },
      ]);

      // Auto-match first
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Get the match ID
      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: invoice.lines[0].id },
      });
      const matchId = matches[0].id;

      const res = await request(app)
        .patch(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/matches/${matchId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvedPrice: 5.49 });

      expect(res.status).toBe(200);
      expect(res.body.approvedPrice).toBe(5.49);
    });
  });

  // ── POST /api/invoices/:id/lines/:lineId/confirm ──────────────

  describe('POST /api/invoices/:id/lines/:lineId/confirm', () => {
    it('confirms a line and sets matches to CONFIRMED', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85 },
      ]);

      // Auto-match
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Confirm the line
      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');

      // All matches should be CONFIRMED
      const dbMatches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: invoice.lines[0].id },
      });
      for (const m of dbMatches) {
        expect(m.status).toBe('CONFIRMED');
      }
    });

    it('defaults to APPROVED status when no status provided', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85 },
      ]);

      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.body.status).toBe('APPROVED');
    });

    it('supports HELD status', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85 },
      ]);

      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'HELD' });

      expect(res.body.status).toBe('HELD');
    });
  });

  // ── POST /api/invoices/:id/approve ─────────────────────────────

  describe('POST /api/invoices/:id/approve', () => {
    it('approves invoice and applies cost/price updates to variants', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg' },
      ]);

      // Match → Confirm → Approve
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Set a custom approved price on the matches
      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: invoice.lines[0].id },
      });
      for (const match of matches) {
        await testPrisma.invoiceLineMatch.update({
          where: { id: match.id },
          data: { approvedPrice: 5.49 },
        });
      }

      // Confirm the line
      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      // Approve the invoice
      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');

      // Verify variant costs and prices were updated
      const updatedVariant1 = await testPrisma.productVariant.findFirst({
        where: { id: variant1.id },
      });
      expect(updatedVariant1.currentCost).toBe(1.85); // baseUnitCost × unitQty(1)
      expect(updatedVariant1.salePrice).toBe(5.49);

      const updatedVariant1b = await testPrisma.productVariant.findFirst({
        where: { id: variant1b.id },
      });
      expect(updatedVariant1b.currentCost).toBe(1.85);
      expect(updatedVariant1b.salePrice).toBe(5.49);
    });

    it('creates audit log entries for each updated variant', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg' },
      ]);

      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      // Check audit logs
      const auditLogs = await testPrisma.auditLog.findMany({
        where: { action: 'PRICE_UPDATED' },
      });
      // Should have 2 logs (one per store variant)
      expect(auditLogs).toHaveLength(2);
      expect(auditLogs[0].entityType).toBe('ProductVariant');
    });

    it('only updates CONFIRMED matches (not PENDING ones)', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85 },
        { description: 'Cheddar Cheese Block 5kg', unitPrice: 48.00, baseUnitCost: 9.60 },
      ]);

      // Auto-match both lines
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Only confirm the first line — leave the second as PENDING
      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      // Approve
      await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      // Variant1 should be updated (confirmed)
      const updatedV1 = await testPrisma.productVariant.findFirst({ where: { id: variant1.id } });
      expect(updatedV1.currentCost).toBe(1.85);

      // Variant2 should NOT be updated (not confirmed)
      const updatedV2 = await testPrisma.productVariant.findFirst({ where: { id: variant2.id } });
      expect(updatedV2.currentCost).toBe(4.50); // original cost unchanged
    });

    it('syncs pricing to parent product for single-variant products', async () => {
      // product2 has only one variant (variant2) — single variant case
      const invoice = await createInvoice([
        { description: 'Cheddar Cheese Block 5kg', unitPrice: 48.00, baseUnitCost: 9.60, baseUnit: 'kg' },
      ]);

      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Set approved price
      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: invoice.lines[0].id },
      });
      for (const match of matches) {
        await testPrisma.invoiceLineMatch.update({
          where: { id: match.id },
          data: { approvedPrice: 12.99 },
        });
      }

      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Verify product-level pricing was synced from the single variant
      // variant2 has unitQty=0.5, so cost = baseUnitCost × unitQty = 9.60 × 0.5 = 4.80
      const updatedProduct = await testPrisma.product.findFirst({ where: { id: product2.id } });
      expect(updatedProduct.costPrice).toBe(4.80);
      expect(updatedProduct.sellingPrice).toBe(12.99);
    });

    it('syncs base variant pricing to parent product for multi-variant products', async () => {
      // product1 has variant1 (unitQty=1) and variant1b (unitQty=1)
      // Add a third variant with higher unitQty to test base-variant selection
      const variant1c = await testPrisma.productVariant.create({
        data: {
          productId: product1.id, storeId: store.id,
          sku: 'FL-001-BULK', name: 'Plain Flour 5kg', size: '5kg', unitQty: 5,
          currentCost: 8.00, salePrice: 19.99, isActive: true,
        },
      });

      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg' },
      ]);

      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      // Set approved price
      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: invoice.lines[0].id },
      });
      for (const match of matches) {
        await testPrisma.invoiceLineMatch.update({
          where: { id: match.id },
          data: { approvedPrice: 5.49 },
        });
      }

      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Product should have pricing from the base variant (lowest unitQty=1)
      const updatedProduct = await testPrisma.product.findFirst({ where: { id: product1.id } });
      // Base variant (unitQty=1) was updated with cost=1.85, price=5.49
      expect(updatedProduct.costPrice).toBe(1.85);
      expect(updatedProduct.sellingPrice).toBe(5.49);
    });

    it('product-level match writes directly to product without variant sync', async () => {
      // Create a product with no variants (product-level match scenario)
      const productNoVariant = await testPrisma.product.create({
        data: {
          tenantId: tenant.id,
          name: 'Bulk Rice',
          category: 'Grains',
          baseUnit: 'kg',
          costPrice: 2.00,
          sellingPrice: 5.00,
        },
      });

      const invoice = await createInvoice([
        { description: 'Bulk Rice 25kg', unitPrice: 50.00, baseUnitCost: 2.50, baseUnit: 'kg' },
      ]);

      // Manually create a product-level match (no variant)
      await testPrisma.invoiceLineMatch.create({
        data: {
          invoiceLineId: invoice.lines[0].id,
          productId: productNoVariant.id,
          productVariantId: null,
          confidence: 0.95,
          matchReason: 'manual',
          isManual: true,
          previousCost: 2.00,
          newCost: 2.50,
          currentPrice: 5.00,
          suggestedPrice: 6.00,
          approvedPrice: 6.00,
          status: 'CONFIRMED',
        },
      });

      const res = await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Product should be updated directly (product-level path)
      const updatedProduct = await testPrisma.product.findFirst({ where: { id: productNoVariant.id } });
      expect(updatedProduct.costPrice).toBe(2.50);
      expect(updatedProduct.sellingPrice).toBe(6.00);
    });
  });

  // ── GET /api/invoices/:id/export ──────────────────────────────

  describe('GET /api/invoices/:id/export', () => {
    it('returns approved matches grouped by store', async () => {
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg' },
      ]);

      // Match → Confirm → Approve
      await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${invoice.lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });

      const res = await request(app)
        .get(`/api/invoices/${invoice.id}/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.invoice).toBeDefined();
      expect(res.body.stores).toBeDefined();
      expect(res.body.stores).toHaveLength(2);

      // Each store should have items
      for (const storeData of res.body.stores) {
        expect(storeData.store).toBeDefined();
        expect(storeData.items).toHaveLength(1);
        expect(storeData.items[0].sku).toBeDefined();
        expect(storeData.items[0].productName).toBeDefined();
        expect(storeData.items[0].newCost).toBeDefined();
      }
    });

    it('returns empty stores array when no confirmed matches', async () => {
      const invoice = await createInvoice([
        { description: 'Unknown Product', unitPrice: 99.99 },
      ]);

      const res = await request(app)
        .get(`/api/invoices/${invoice.id}/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.stores).toHaveLength(0);
    });
  });

  // ── Full workflow (end-to-end) ────────────────────────────────

  describe('Full workflow: match → set price → confirm → approve → export', () => {
    it('completes the entire invoice review lifecycle', async () => {
      // 1. Create an invoice with two lines
      const invoice = await createInvoice([
        { description: 'Plain Flour 10kg', unitPrice: 18.50, baseUnitCost: 1.85, baseUnit: 'kg', packSize: '10kg bag' },
        { description: 'Cheddar Cheese Block 5kg', unitPrice: 48.00, baseUnitCost: 9.60, baseUnit: 'kg' },
      ]);

      // 2. Auto-match
      const matchRes = await request(app)
        .post(`/api/invoices/${invoice.id}/match`)
        .set('Authorization', `Bearer ${token}`);

      expect(matchRes.status).toBe(200);
      const lines = matchRes.body.lines;
      expect(lines).toHaveLength(2);

      // Line 1 (Plain Flour) should match product1 with 2 store variants
      expect(lines[0].matches.length).toBeGreaterThan(0);
      // Line 2 (Cheddar Cheese) should match product2 with 1 store variant
      expect(lines[1].matches.length).toBeGreaterThan(0);

      // 3. Update approved price on first line's first match
      const match1Id = lines[0].matches[0].id;
      const priceRes = await request(app)
        .patch(`/api/invoices/${invoice.id}/lines/${lines[0].id}/matches/${match1Id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ approvedPrice: 4.99 });

      expect(priceRes.status).toBe(200);
      expect(priceRes.body.approvedPrice).toBe(4.99);

      // 4. Confirm both lines
      const confirm1 = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${lines[0].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });
      expect(confirm1.status).toBe(200);

      const confirm2 = await request(app)
        .post(`/api/invoices/${invoice.id}/lines/${lines[1].id}/confirm`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED' });
      expect(confirm2.status).toBe(200);

      // 5. Approve invoice
      const approveRes = await request(app)
        .post(`/api/invoices/${invoice.id}/approve`)
        .set('Authorization', `Bearer ${token}`);

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.status).toBe('APPROVED');

      // 6. Export data
      const exportRes = await request(app)
        .get(`/api/invoices/${invoice.id}/export`)
        .set('Authorization', `Bearer ${token}`);

      expect(exportRes.status).toBe(200);
      expect(exportRes.body.stores.length).toBeGreaterThan(0);

      // Verify final state: variant costs/prices updated
      const finalV1 = await testPrisma.productVariant.findFirst({ where: { id: variant1.id } });
      expect(finalV1.currentCost).toBe(1.85); // baseUnitCost × unitQty(1)

      // Audit logs should exist
      const logs = await testPrisma.auditLog.findMany({ where: { action: 'PRICE_UPDATED' } });
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
