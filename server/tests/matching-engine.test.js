import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import { createTenantClient } from '../src/lib/prisma.js';
import { fuzzyNameScore, tokenize, stem, matchInvoiceLines, createMatchRecords } from '../src/services/matching.js';
import {
  createTestTenant,
  createTestProduct,
  createTestStore,
  createTestSupplier,
} from './helpers/fixtures.js';

// ══════════════════════════════════════════════════════════════
// Unit tests — pure functions, no database
// ══════════════════════════════════════════════════════════════

describe('Matching engine — unit tests', () => {
  describe('tokenize()', () => {
    it('lowercases, splits, stems, and filters stop words', () => {
      expect(tokenize('Plain Flour 10kg')).toEqual(['plain', 'flour']);
    });

    it('removes punctuation and stems', () => {
      expect(tokenize("White's Plain Flour")).toEqual(['white', 'plain', 'flour']);
    });

    it('handles empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('handles multiple spaces', () => {
      expect(tokenize('  cheddar   cheese  ')).toEqual(['cheddar', 'cheese']);
    });
  });

  describe('stem()', () => {
    it('handles plain -s plurals', () => {
      expect(stem('kernels')).toBe('kernel');
      expect(stem('seeds')).toBe('seed');
      expect(stem('almonds')).toBe('almond');
      expect(stem('nuts')).toBe('nut');
      expect(stem('carrots')).toBe('carrot');
      expect(stem('onions')).toBe('onion');
    });

    it('handles -ies → -y', () => {
      expect(stem('berries')).toBe('berry');
      expect(stem('cherries')).toBe('cherry');
      expect(stem('strawberries')).toBe('strawberry');
      expect(stem('blueberries')).toBe('blueberry');
    });

    it('handles -oes → -o', () => {
      expect(stem('tomatoes')).toBe('tomato');
      expect(stem('potatoes')).toBe('potato');
      expect(stem('mangoes')).toBe('mango');
    });

    it('handles sibilant -es plurals', () => {
      expect(stem('boxes')).toBe('box');
      expect(stem('dishes')).toBe('dish');
      expect(stem('bunches')).toBe('bunch');
      expect(stem('peaches')).toBe('peach');
    });

    it('handles -ses → -se', () => {
      expect(stem('cases')).toBe('case');
      expect(stem('pulses')).toBe('pulse');
    });

    it('handles -ves irregulars', () => {
      expect(stem('halves')).toBe('half');
      expect(stem('loaves')).toBe('loaf');
      expect(stem('knives')).toBe('knife');
      expect(stem('leaves')).toBe('leaf');
    });

    it('preserves exception words that look like plurals', () => {
      expect(stem('grass')).toBe('grass');
      expect(stem('cheese')).toBe('cheese');
      expect(stem('rice')).toBe('rice');
      expect(stem('less')).toBe('less');
      expect(stem('juice')).toBe('juice');
      expect(stem('sauce')).toBe('sauce');
      expect(stem('lettuce')).toBe('lettuce');
      expect(stem('hummus')).toBe('hummus');
      expect(stem('couscous')).toBe('couscous');
      expect(stem('asparagus')).toBe('asparagus');
    });

    it('does not stem short words (≤3 chars)', () => {
      expect(stem('gas')).toBe('gas');
      expect(stem('bus')).toBe('bus');
    });

    it('does not stem words without plural endings', () => {
      expect(stem('flour')).toBe('flour');
      expect(stem('sugar')).toBe('sugar');
      expect(stem('cheddar')).toBe('cheddar');
      expect(stem('organic')).toBe('organic');
    });
  });

  describe('tokenize() stop-word filtering', () => {
    it('removes numeric tokens and pack sizes', () => {
      expect(tokenize('Sunflower Kernels Australian 12.5kg')).toEqual(['sunflower', 'kernel']);
    });

    it('removes unit stop words', () => {
      expect(tokenize('Almonds Raw 500g bag')).toEqual(['almond', 'raw']);
    });

    it('keeps meaningful product words', () => {
      expect(tokenize('Organic Free Range Eggs')).toEqual(['organic', 'free', 'range', 'egg']);
    });
  });

  describe('fuzzyNameScore()', () => {
    it('returns 1.0 for identical strings', () => {
      expect(fuzzyNameScore('Plain Flour', 'Plain Flour')).toBe(1);
    });

    it('returns 1.0 for case-insensitive identical strings', () => {
      expect(fuzzyNameScore('plain flour', 'PLAIN FLOUR')).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      expect(fuzzyNameScore('Cheddar Cheese', 'Motor Oil')).toBe(0);
    });

    it('returns 0 for empty input', () => {
      expect(fuzzyNameScore('', 'Product')).toBe(0);
      expect(fuzzyNameScore('Product', '')).toBe(0);
    });

    it('scores partial overlap correctly (containment)', () => {
      // "plain flour 10kg" → {plain, flour} (10kg filtered as numeric)
      // "plain flour" → {plain, flour}
      // Jaccard = 2/2 = 1.0, Containment = 2/2 = 1.0
      const score = fuzzyNameScore('Plain Flour 10kg', 'Plain Flour');
      expect(score).toBe(1.0);
    });

    it('gives low score for single-word overlap', () => {
      // "cheddar cheese block 5kg" → {cheddar, cheese, block} (5kg filtered)
      // "mild cheddar sliced" → {mild, cheddar, sliced}
      // Jaccard = 1/5, Containment = 1/3 (only "cheddar" from product in description)
      // max(jaccard, containment) = 1/3
      const score = fuzzyNameScore('Cheddar Cheese Block 5kg', 'Mild Cheddar Sliced');
      expect(score).toBeCloseTo(1 / 3, 2);
    });

    it('gives higher score for more word overlap', () => {
      const highScore = fuzzyNameScore('Free Range Eggs Tray', 'Free Range Eggs');
      const lowScore = fuzzyNameScore('Free Range Eggs Tray', 'Organic Eggs');
      expect(highScore).toBeGreaterThan(lowScore);
    });

    it('handles punctuation in product names', () => {
      // "White's Plain Flour" → {white, plain, flour} (whites→white stemmed)
      // "Plain Flour" → {plain, flour}
      // Containment = 2/2 = 1.0 (all product words in description)
      const score = fuzzyNameScore("White's Plain Flour", 'Plain Flour');
      expect(score).toBe(1.0);
    });

    it('matches singular and plural forms via stemming (regression: kernels/kernel)', () => {
      const sunflowerScore = fuzzyNameScore('Sunflower Kernels Australian 12.5kg', 'Sunflower Kernel');
      const pistachioScore = fuzzyNameScore('Sunflower Kernels Australian 12.5kg', 'Pistachio Kernels');
      // Sunflower Kernel: 2 matching tokens (sunflower, kernel) → containment 2/2 = 1.0
      // Pistachio Kernels: 1 matching token (kernel) → containment 1/2 = 0.5
      expect(sunflowerScore).toBe(1.0);
      expect(pistachioScore).toBe(0.5);
      expect(sunflowerScore).toBeGreaterThan(pistachioScore);
    });

    it('stems plurals consistently in both description and product name', () => {
      // "Organic Almonds 500g" → {organic, almond} (almonds→almond, 500g filtered)
      // "Almond" → {almond}
      // Containment: 1/1 = 1.0
      const score = fuzzyNameScore('Organic Almonds 500g', 'Almond');
      expect(score).toBe(1.0);
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Integration tests — matching against the database
// ══════════════════════════════════════════════════════════════

describe('Matching engine — integration tests', () => {
  let tenant, supplier, store;

  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();
    tenant = await createTestTenant('Match Test Business');
    supplier = await createTestSupplier(tenant.id, { name: 'Smith & Sons Wholesale' });
    store = await createTestStore(tenant.id, { name: 'Main Street Store' });
  });

  // Helpers
  async function createProductWithVariant(productData, variantData = {}) {
    const product = await createTestProduct(tenant.id, productData);
    const variant = await testPrisma.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        sku: variantData.sku || `SKU-${Date.now()}`,
        name: variantData.name || product.name,
        size: variantData.size || '1kg',
        unitQty: variantData.unitQty || 1,
        currentCost: variantData.currentCost || 5.0,
        salePrice: variantData.salePrice || 10.0,
        isActive: true,
      },
    });
    return { product, variant };
  }

  async function createInvoiceWithLine(lineData) {
    const invoice = await testPrisma.invoice.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        invoiceNumber: 'INV-TEST-001',
        status: 'IN_REVIEW',
      },
    });
    const line = await testPrisma.invoiceLine.create({
      data: {
        invoiceId: invoice.id,
        lineNumber: 1,
        description: lineData.description,
        quantity: lineData.quantity || 5,
        unitPrice: lineData.unitPrice || 18.50,
        lineTotal: lineData.lineTotal || 92.50,
        packSize: lineData.packSize || null,
        baseUnit: lineData.baseUnit || null,
        baseUnitCost: lineData.baseUnitCost || lineData.unitPrice || 18.50,
        status: 'PENDING',
      },
    });
    return { invoice, line };
  }

  describe('matchInvoiceLines()', () => {
    it('matches by fuzzy name and creates InvoiceLineMatch records', async () => {
      const { product, variant } = await createProductWithVariant(
        { name: 'Plain Flour', category: 'Baking' },
        { sku: 'FL-001', currentCost: 1.80, salePrice: 4.49, unitQty: 1 },
      );

      const { invoice, line } = await createInvoiceWithLine({
        description: 'Plain Flour 10kg',
        unitPrice: 18.50,
        baseUnitCost: 1.85,
        baseUnit: 'kg',
        packSize: '10kg bag',
      });

      const prisma = createTenantClient(tenant.id);
      const fullInvoice = await testPrisma.invoice.findFirst({
        where: { id: invoice.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });

      const results = await matchInvoiceLines(prisma, fullInvoice);

      expect(results).toHaveLength(1);
      expect(results[0].matched).toBe(true);
      expect(results[0].confidence).toBeGreaterThan(0);

      // Check InvoiceLineMatch was created
      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: line.id },
      });
      expect(matches).toHaveLength(1);
      expect(matches[0].productVariantId).toBe(variant.id);
      expect(matches[0].previousCost).toBe(1.80);
      expect(matches[0].matchReason).toBe('fuzzy_name');
    });

    it('matches by barcode with confidence 1.0', async () => {
      const { product, variant } = await createProductWithVariant(
        { name: 'Organic Oats', barcode: '9310000001' },
        { sku: 'OAT-001', currentCost: 3.20, salePrice: 7.99, unitQty: 1 },
      );

      const { invoice, line } = await createInvoiceWithLine({
        description: 'Rolled Oats 25kg 9310000001',
        unitPrice: 45.00,
        baseUnitCost: 1.80,
      });

      const prisma = createTenantClient(tenant.id);
      const fullInvoice = await testPrisma.invoice.findFirst({
        where: { id: invoice.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });

      const results = await matchInvoiceLines(prisma, fullInvoice);

      expect(results[0].matched).toBe(true);
      expect(results[0].confidence).toBe(1.0);

      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: line.id },
      });
      expect(matches[0].matchReason).toBe('barcode');
    });

    it('uses SupplierProductMapping when available', async () => {
      const { product, variant } = await createProductWithVariant(
        { name: 'Tasty Cheddar Block' },
        { sku: 'CHZ-001', currentCost: 9.00, salePrice: 18.99, unitQty: 1 },
      );

      // Create a saved mapping from a previous invoice
      await testPrisma.supplierProductMapping.create({
        data: {
          supplierId: supplier.id,
          supplierDescription: 'Cheddar Cheese Block 5kg',
          productId: product.id,
          confidence: 0.95,
          timesUsed: 3,
        },
      });

      const { invoice, line } = await createInvoiceWithLine({
        description: 'Cheddar Cheese Block 5kg',
        unitPrice: 48.00,
        baseUnitCost: 9.60,
      });

      const prisma = createTenantClient(tenant.id);
      const fullInvoice = await testPrisma.invoice.findFirst({
        where: { id: invoice.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });

      const results = await matchInvoiceLines(prisma, fullInvoice);

      expect(results[0].matched).toBe(true);
      expect(results[0].candidates[0].matchReason).toBe('supplier_mapping');
    });

    it('marks unmatched lines as NEEDS_REVIEW', async () => {
      // No products in catalog at all
      const { invoice, line } = await createInvoiceWithLine({
        description: 'Completely Unknown Product XYZ',
        unitPrice: 99.99,
      });

      const prisma = createTenantClient(tenant.id);
      const fullInvoice = await testPrisma.invoice.findFirst({
        where: { id: invoice.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });

      const results = await matchInvoiceLines(prisma, fullInvoice);

      expect(results[0].matched).toBe(false);
      expect(results[0].candidates).toHaveLength(0);

      // Line status should be NEEDS_REVIEW
      const updatedLine = await testPrisma.invoiceLine.findFirst({
        where: { id: line.id },
      });
      expect(updatedLine.status).toBe('NEEDS_REVIEW');
    });

    it('creates matches for multiple variants across stores', async () => {
      const store2 = await createTestStore(tenant.id, { name: 'Harbour Town Store' });
      const product = await createTestProduct(tenant.id, { name: 'Plain Flour' });

      // Create variants in two stores
      await testPrisma.productVariant.create({
        data: {
          productId: product.id, storeId: store.id,
          sku: 'FL-001', name: 'Plain Flour', size: '1kg', unitQty: 1,
          currentCost: 1.80, salePrice: 4.49, isActive: true,
        },
      });
      await testPrisma.productVariant.create({
        data: {
          productId: product.id, storeId: store2.id,
          sku: 'FL-001-H', name: 'Plain Flour', size: '1kg', unitQty: 1,
          currentCost: 1.80, salePrice: 4.29, isActive: true,
        },
      });

      const { invoice, line } = await createInvoiceWithLine({
        description: 'Plain Flour 10kg',
        unitPrice: 18.50,
        baseUnitCost: 1.85,
        baseUnit: 'kg',
      });

      const prisma = createTenantClient(tenant.id);
      const fullInvoice = await testPrisma.invoice.findFirst({
        where: { id: invoice.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await matchInvoiceLines(prisma, fullInvoice);

      const matches = await testPrisma.invoiceLineMatch.findMany({
        where: { invoiceLineId: line.id },
        include: { productVariant: { include: { store: true } } },
      });

      expect(matches).toHaveLength(2);
      const storeNames = matches.map((m) => m.productVariant.store.name).sort();
      expect(storeNames).toEqual(['Harbour Town Store', 'Main Street Store']);
    });

    it('calculates newCost correctly from baseUnitCost × unitQty', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Plain Flour' });
      // 250g variant → unitQty = 0.25
      await testPrisma.productVariant.create({
        data: {
          productId: product.id, storeId: store.id,
          sku: 'FL-250', name: 'Plain Flour 250g', size: '250g', unitQty: 0.25,
          currentCost: 0.45, salePrice: 1.99, isActive: true,
        },
      });

      const { invoice, line } = await createInvoiceWithLine({
        description: 'Plain Flour 10kg',
        unitPrice: 18.50,
        baseUnitCost: 1.85, // $1.85/kg
        baseUnit: 'kg',
      });

      const prisma = createTenantClient(tenant.id);
      const fullInvoice = await testPrisma.invoice.findFirst({
        where: { id: invoice.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });

      await matchInvoiceLines(prisma, fullInvoice);

      const match = await testPrisma.invoiceLineMatch.findFirst({
        where: { invoiceLineId: line.id },
      });

      // newCost = 1.85 × 0.25 = 0.4625 → rounded to 0.46
      expect(match.newCost).toBeCloseTo(0.46, 2);
    });
  });
});
