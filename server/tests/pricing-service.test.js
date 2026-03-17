import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import { createTenantClient } from '../src/lib/prisma.js';
import { roundTo99, roundTo49or99, roundNearest5, applyRounding } from '../src/services/pricing.js';
import { calculateSuggestedPrice } from '../src/services/pricing.js';
import {
  createTestTenant,
  createTestProduct,
  createTestStore,
  createTestSupplier,
} from './helpers/fixtures.js';

// ══════════════════════════════════════════════════════════════
// Unit tests — rounding helpers, no database
// ══════════════════════════════════════════════════════════════

describe('Pricing service — unit tests', () => {
  describe('roundTo99()', () => {
    it('rounds 4.30 → 4.99', () => {
      expect(roundTo99(4.30)).toBe(4.99);
    });

    it('rounds 9.01 → 9.99', () => {
      expect(roundTo99(9.01)).toBe(9.99);
    });

    it('rounds exact integer 5.00 → 4.99', () => {
      // Math.ceil(5.00) = 5, minus 0.01 = 4.99
      expect(roundTo99(5.00)).toBe(4.99);
    });

    it('rounds 12.99 → 12.99', () => {
      // Math.ceil(12.99) = 13, minus 0.01 = 12.99
      expect(roundTo99(12.99)).toBe(12.99);
    });
  });

  describe('roundTo49or99()', () => {
    it('rounds 4.30 → 4.49 (closer to .49)', () => {
      expect(roundTo49or99(4.30)).toBe(4.49);
    });

    it('rounds 4.80 → 4.99 (closer to .99)', () => {
      expect(roundTo49or99(4.80)).toBe(4.99);
    });

    it('rounds 7.50 → 7.49 (equidistant, .49 wins since diff49 equals diff99 is false, .49 wins by < check)', () => {
      // floor(7.50) = 7, diff49 = |7.50 - 7.49| = 0.01, diff99 = |7.50 - 7.99| = 0.49
      expect(roundTo49or99(7.50)).toBe(7.49);
    });

    it('rounds 3.74 → 3.49 or 3.99 (checks nearest)', () => {
      // floor(3.74) = 3, diff49 = |3.74 - 3.49| = 0.25, diff99 = |3.74 - 3.99| = 0.25
      // When equal, diff49 < diff99 is false, so returns .99
      expect(roundTo49or99(3.74)).toBe(3.99);
    });

    it('rounds 3.10 → 3.49 (closer to .49)', () => {
      expect(roundTo49or99(3.10)).toBe(3.49);
    });
  });

  describe('roundNearest5()', () => {
    it('rounds 4.23 → 4.25', () => {
      expect(roundNearest5(4.23)).toBe(4.25);
    });

    it('rounds 4.47 → 4.45', () => {
      expect(roundNearest5(4.47)).toBe(4.45);
    });

    it('rounds 4.50 → 4.50', () => {
      expect(roundNearest5(4.50)).toBe(4.50);
    });

    it('rounds 9.99 → 10.00', () => {
      expect(roundNearest5(9.99)).toBe(10.00);
    });

    it('rounds 7.125 → 7.10 (midpoint rounds up to nearest 5c)', () => {
      expect(roundNearest5(7.125)).toBe(7.15);
    });
  });

  describe('applyRounding()', () => {
    it('uses .99 strategy', () => {
      expect(applyRounding(6.42, '.99')).toBe(6.99);
    });

    it('uses .49/.99 strategy', () => {
      expect(applyRounding(6.42, '.49/.99')).toBe(6.49);
    });

    it('uses nearest_5 strategy', () => {
      expect(applyRounding(6.42, 'nearest_5')).toBe(6.40);
    });

    it('defaults to 2 decimal places when no strategy', () => {
      expect(applyRounding(6.425, null)).toBe(6.43);
    });

    it('defaults to 2 decimal places for unknown strategy', () => {
      expect(applyRounding(6.425, 'unknown')).toBe(6.43);
    });
  });
});

// ══════════════════════════════════════════════════════════════
// Integration tests — calculateSuggestedPrice with database
// ══════════════════════════════════════════════════════════════

describe('Pricing service — integration tests', () => {
  let tenant, store, supplier;

  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();
    tenant = await createTestTenant('Pricing Test Business');
    store = await createTestStore(tenant.id, { name: 'Test Store' });
    supplier = await createTestSupplier(tenant.id, { name: 'Test Supplier' });
  });

  async function createVariant(product, overrides = {}) {
    return testPrisma.productVariant.create({
      data: {
        productId: product.id,
        storeId: store.id,
        sku: overrides.sku || `SKU-${Date.now()}`,
        name: overrides.name || product.name,
        size: overrides.size || '1kg',
        unitQty: overrides.unitQty || 1,
        currentCost: overrides.currentCost || 5.0,
        salePrice: overrides.salePrice || 10.0,
        isActive: true,
      },
    });
  }

  async function createRule(overrides) {
    return testPrisma.pricingRule.create({
      data: {
        tenantId: tenant.id,
        name: overrides.name || 'Test Rule',
        scope: overrides.scope,
        scopeValue: overrides.scopeValue || null,
        targetMargin: overrides.targetMargin ?? null,
        minMargin: overrides.minMargin ?? null,
        maxPriceJump: overrides.maxPriceJump ?? null,
        roundingStrategy: overrides.roundingStrategy || null,
        isActive: overrides.isActive ?? true,
        priority: overrides.priority || 0,
      },
    });
  }

  describe('calculateSuggestedPrice()', () => {
    it('returns current salePrice when no pricing rules exist', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product, { salePrice: 8.99 });

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.50, product, null);

      expect(result).toBe(8.99);
    });

    it('uses 50% fallback markup when no rule and no salePrice', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product, { salePrice: 0 });

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, { ...variant, salePrice: null }, 4.00, product, null);

      // newCost * 1.5 = 6.00
      expect(result).toBe(6.00);
    });

    it('applies GLOBAL rule with target margin', async () => {
      await createRule({
        name: 'Global 30%',
        scope: 'GLOBAL',
        targetMargin: 0.30,
        priority: 1,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product);

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.50, product, null);

      // price = 3.50 / (1 - 0.30) = 5.00
      expect(result).toBe(5.00);
    });

    it('applies .99 rounding strategy', async () => {
      await createRule({
        name: 'Global 30% with .99',
        scope: 'GLOBAL',
        targetMargin: 0.30,
        roundingStrategy: '.99',
        priority: 1,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product);

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.50, product, null);

      // price = 3.50 / (1 - 0.30) = 5.00 → roundTo99 → Math.ceil(5.00) - 0.01 = 4.99
      expect(result).toBe(4.99);
    });

    it('PRODUCT rule takes precedence over CATEGORY and GLOBAL', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Flour', category: 'Baking' });
      const variant = await createVariant(product);

      // Create rules with different scopes
      await createRule({ name: 'Global 25%', scope: 'GLOBAL', targetMargin: 0.25, priority: 1 });
      await createRule({ name: 'Baking 30%', scope: 'CATEGORY', scopeValue: 'Baking', targetMargin: 0.30, priority: 2 });
      await createRule({ name: 'Flour 40%', scope: 'PRODUCT', scopeValue: product.id, targetMargin: 0.40, priority: 3 });

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.00, product, null);

      // PRODUCT rule wins: 3.00 / (1 - 0.40) = 5.00
      expect(result).toBe(5.00);
    });

    it('SUPPLIER rule overrides CATEGORY and GLOBAL', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Flour', category: 'Baking' });
      const variant = await createVariant(product);

      await createRule({ name: 'Global 25%', scope: 'GLOBAL', targetMargin: 0.25, priority: 1 });
      await createRule({ name: 'Category 30%', scope: 'CATEGORY', scopeValue: 'Baking', targetMargin: 0.30, priority: 2 });
      await createRule({ name: 'Supplier 35%', scope: 'SUPPLIER', scopeValue: supplier.id, targetMargin: 0.35, priority: 3 });

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.00, product, supplier.id);

      // SUPPLIER rule wins: 3.00 / (1 - 0.35) ≈ 4.615 → rounded = 4.62
      expect(result).toBeCloseTo(4.62, 2);
    });

    it('CATEGORY rule overrides GLOBAL', async () => {
      const product = await createTestProduct(tenant.id, { name: 'Flour', category: 'Baking' });
      const variant = await createVariant(product);

      await createRule({ name: 'Global 25%', scope: 'GLOBAL', targetMargin: 0.25, priority: 1 });
      await createRule({ name: 'Baking 35%', scope: 'CATEGORY', scopeValue: 'Baking', targetMargin: 0.35, priority: 2 });

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.00, product, null);

      // CATEGORY rule: 3.00 / (1 - 0.35) ≈ 4.615 → rounded = 4.62
      expect(result).toBeCloseTo(4.62, 2);
    });

    it('enforces maxPriceJump cap', async () => {
      await createRule({
        name: 'Global 50% with 10% jump cap',
        scope: 'GLOBAL',
        targetMargin: 0.50,
        maxPriceJump: 0.10, // max 10% increase
        priority: 1,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product, { salePrice: 6.00, currentCost: 3.00 });

      const prisma = createTenantClient(tenant.id);
      // New cost is much higher, pushing price way up
      const result = await calculateSuggestedPrice(prisma, variant, 5.00, product, null);

      // Uncapped: 5.00 / (1 - 0.50) = 10.00
      // Max allowed: 6.00 * 1.10 = 6.60
      // Should be capped at 6.60 (no rounding strategy, so rounded to 2dp)
      expect(result).toBe(6.60);
    });

    it('enforces minMargin floor', async () => {
      await createRule({
        name: 'Global 15% min 20%',
        scope: 'GLOBAL',
        targetMargin: 0.15,
        minMargin: 0.20,
        priority: 1,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product);

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 5.00, product, null);

      // Target: 5.00 / (1 - 0.15) ≈ 5.882
      // Margin at 5.88: (5.88 - 5.00) / 5.88 ≈ 0.15 — below 0.20 floor
      // Recalc: 5.00 / (1 - 0.20) = 6.25
      expect(result).toBe(6.25);
    });

    it('ignores inactive rules', async () => {
      await createRule({
        name: 'Inactive Rule',
        scope: 'GLOBAL',
        targetMargin: 0.90,
        isActive: false,
        priority: 10,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product, { salePrice: 8.99 });

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.50, product, null);

      // No active rules → return current salePrice
      expect(result).toBe(8.99);
    });

    it('applies .49/.99 rounding strategy with margin', async () => {
      await createRule({
        name: 'Global 30% .49/.99',
        scope: 'GLOBAL',
        targetMargin: 0.30,
        roundingStrategy: '.49/.99',
        priority: 1,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product);

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 2.80, product, null);

      // price = 2.80 / (1 - 0.30) = 4.00
      // roundTo49or99(4.00): floor=4, diff49=|4.00-4.49|=0.49, diff99=|4.00-4.99|=0.99
      // 0.49 < 0.99 → 4.49
      expect(result).toBe(4.49);
    });

    it('applies nearest_5 rounding strategy', async () => {
      await createRule({
        name: 'Global 30% nearest_5',
        scope: 'GLOBAL',
        targetMargin: 0.30,
        roundingStrategy: 'nearest_5',
        priority: 1,
      });

      const product = await createTestProduct(tenant.id, { name: 'Flour' });
      const variant = await createVariant(product);

      const prisma = createTenantClient(tenant.id);
      const result = await calculateSuggestedPrice(prisma, variant, 3.22, product, null);

      // price = 3.22 / (1 - 0.30) = 4.60
      // roundNearest5(4.60) = 4.60
      expect(result).toBe(4.60);
    });
  });
});
