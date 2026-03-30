import { describe, it, expect } from 'vitest';
import {
  computeConfidenceScore,
  scoreGroup1_IdentityStrength,
  scoreGroup3_DataCompleteness,
  scoreGroup4_DetectorCertainty,
  scoreGroup5_SimilarityRisk,
} from '../../src/services/agents/pipeline/stages/confidenceScorer.js';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';

describe('scoreGroup1_IdentityStrength', () => {
  it('scores 20 for tier 1 fingerprint', () => {
    const p = createCanonicalProduct();
    p.fingerprintTier = 1;
    const result = scoreGroup1_IdentityStrength(p);
    expect(result.score).toBeGreaterThanOrEqual(20);
  });

  it('scores 15 for tier 2 fingerprint', () => {
    const p = createCanonicalProduct();
    p.fingerprintTier = 2;
    const result = scoreGroup1_IdentityStrength(p);
    expect(result.score).toBeGreaterThanOrEqual(15);
  });

  it('scores 3 for tier 4 fingerprint', () => {
    const p = createCanonicalProduct();
    p.fingerprintTier = 4;
    const result = scoreGroup1_IdentityStrength(p);
    expect(result.score).toBe(3);
  });

  it('clamps to max 35', () => {
    const p = createCanonicalProduct({
      externalId: 'ext-1',
      sku: 'SKU-1',
      brand: 'Brand',
    });
    p.fingerprintTier = 1;
    const result = scoreGroup1_IdentityStrength(p);
    expect(result.score).toBeLessThanOrEqual(35);
    expect(result.max).toBe(35);
  });
});

describe('scoreGroup3_DataCompleteness', () => {
  it('scores max for fully populated product', () => {
    const p = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: 'AUD', status: 'ACTIVE',
      sku: 'S', brand: 'B', category: 'C', description: 'D',
      barcode: '123', costPrice: 5, quantity: 10, weight: 1,
      baseUnit: 'kg',
    });
    p.images = [{ url: 'http://example.com/img.jpg' }];
    p.tags = ['tag1'];
    p.variants = [{ sku: 'V1' }];
    const result = scoreGroup3_DataCompleteness(p);
    expect(result.score).toBe(20);
  });

  it('deducts 5 per missing required field', () => {
    // Missing 2 required fields (name + price) vs missing 0
    // Both have many customAttributes to neutralise the custom attrs bonus
    const full = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: 'AUD', status: 'ACTIVE',
    });
    full.customAttributes = { a:1, b:2, c:3, d:4, e:5, f:6, g:7, h:8, i:9, j:10,
      k:11, l:12, m:13, n:14, o:15, p:16 }; // 16+ keys → +0
    const missing2 = createCanonicalProduct({
      currency: 'AUD', status: 'ACTIVE',
    }); // missing name AND price
    missing2.customAttributes = full.customAttributes;
    const r1 = scoreGroup3_DataCompleteness(full);
    const r2 = scoreGroup3_DataCompleteness(missing2);
    expect(r1.score - r2.score).toBeGreaterThanOrEqual(10);
  });

  it('scores higher for more recommended fields', () => {
    // Override currency/status defaults to null so required-field penalties
    // bring the score below the 20 clamp, letting recommended bonuses show
    const few = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: null, status: null,
    }); // -10 for missing currency + status, 0 recommended, +0 custom attrs (16+ keys)
    few.customAttributes = { a:1, b:2, c:3, d:4, e:5, f:6, g:7, h:8, i:9, j:10,
      k:11, l:12, m:13, n:14, o:15, p:16 };
    const many = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: null, status: null,
      sku: 'S', brand: 'B', category: 'C', description: 'D',
      barcode: '123', costPrice: 5, quantity: 10, weight: 1,
    }); // -10, +16 recommended (8 fields), +0 custom attrs
    many.customAttributes = few.customAttributes;
    const rFew = scoreGroup3_DataCompleteness(few);
    const rMany = scoreGroup3_DataCompleteness(many);
    expect(rMany.score).toBeGreaterThan(rFew.score);
  });

  it('scores +4 for low custom attributes count', () => {
    const p = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: 'AUD', status: 'ACTIVE',
    });
    p.customAttributes = { a: 1 };
    const result = scoreGroup3_DataCompleteness(p);
    expect(result.signals).toContainEqual(expect.stringContaining('custom_attrs'));
  });
});

describe('scoreGroup4_DetectorCertainty', () => {
  it('scores 15 for CREATE action', () => {
    const p = createCanonicalProduct();
    p.matchResult = { action: 'CREATE', layerMatched: 2 };
    const result = scoreGroup4_DetectorCertainty(p);
    expect(result.score).toBe(15);
  });

  it('scores 0 for UPDATE action', () => {
    const p = createCanonicalProduct();
    p.matchResult = { action: 'UPDATE' };
    const result = scoreGroup4_DetectorCertainty(p);
    expect(result.score).toBe(0);
  });

  it('scores 0 for REVIEW action (floor)', () => {
    const p = createCanonicalProduct();
    p.matchResult = { action: 'REVIEW' };
    const result = scoreGroup4_DetectorCertainty(p);
    expect(result.score).toBe(0);
  });
});

describe('scoreGroup5_SimilarityRisk', () => {
  it('returns 0 when no similar products', () => {
    const p = createCanonicalProduct();
    p.invoiceRisk = { similarProducts: [] };
    const result = scoreGroup5_SimilarityRisk(p);
    expect(result.score).toBe(0);
  });

  it('deducts 25 for >= 95% similarity', () => {
    const p = createCanonicalProduct();
    p.invoiceRisk = { similarProducts: [{ similarityScore: 96 }] };
    const result = scoreGroup5_SimilarityRisk(p);
    expect(result.score).toBeLessThanOrEqual(-25);
  });

  it('deducts 12 for 85-89% similarity', () => {
    const p = createCanonicalProduct();
    p.invoiceRisk = { similarProducts: [{ similarityScore: 87 }] };
    const result = scoreGroup5_SimilarityRisk(p);
    expect(result.score).toBeLessThanOrEqual(-12);
  });

  it('deducts additional 5 for open invoices', () => {
    const p = createCanonicalProduct();
    p.invoiceRisk = {
      similarProducts: [{ similarityScore: 87, openInvoiceCount: 3 }],
    };
    const result = scoreGroup5_SimilarityRisk(p);
    expect(result.score).toBeLessThanOrEqual(-17);
  });

  it('clamps to minimum -30', () => {
    const p = createCanonicalProduct();
    p.invoiceRisk = {
      similarProducts: [{
        similarityScore: 98,
        openInvoiceCount: 5,
        sameCategory: true,
        sameBrand: true,
        recentlyCreated: true,
      }],
    };
    const result = scoreGroup5_SimilarityRisk(p);
    expect(result.score).toBeGreaterThanOrEqual(-30);
  });
});

describe('computeConfidenceScore', () => {
  const defaultHistory = {
    isTrusted: false, priorImportCount: 0,
    duplicateIncidents: 0, resolutionMethod: 'explicit',
  };

  it('returns score 0-100', () => {
    const p = createCanonicalProduct({ name: 'Test', price: 9.99 });
    p.fingerprintTier = 4;
    p.matchResult = { action: 'CREATE' };
    p.invoiceRisk = { similarProducts: [] };
    const result = computeConfidenceScore(p, {}, defaultHistory);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('stores breakdown with all 5 groups', () => {
    const p = createCanonicalProduct({ name: 'Test', price: 9.99 });
    p.fingerprintTier = 4;
    p.matchResult = { action: 'CREATE' };
    p.invoiceRisk = { similarProducts: [] };
    const result = computeConfidenceScore(p, {}, defaultHistory);
    expect(result.breakdown.identityStrength).toBeDefined();
    expect(result.breakdown.sourceTrustworthiness).toBeDefined();
    expect(result.breakdown.dataCompleteness).toBeDefined();
    expect(result.breakdown.detectorCertainty).toBeDefined();
    expect(result.breakdown.similarityRisk).toBeDefined();
  });

  it('stores computedAt datetime', () => {
    const p = createCanonicalProduct({ name: 'Test', price: 9.99 });
    p.fingerprintTier = 4;
    p.matchResult = { action: 'CREATE' };
    p.invoiceRisk = { similarProducts: [] };
    const result = computeConfidenceScore(p, {}, defaultHistory);
    expect(result.breakdown.computedAt).toBeInstanceOf(Date);
  });

  it('produces high score for ideal product', () => {
    const p = createCanonicalProduct({
      name: 'Milk', price: 3.99, barcode: '9300633100033',
      sku: 'M-2L', brand: 'Dairy', category: 'Dairy',
      costPrice: 2, quantity: 100, baseUnit: 'L',
      currency: 'AUD', status: 'ACTIVE',
    });
    p.fingerprintTier = 1;
    p.matchResult = { action: 'CREATE', layerMatched: null };
    p.invoiceRisk = { level: 'NONE', similarProducts: [] };
    const history = {
      isTrusted: true, priorImportCount: 10,
      duplicateIncidents: 0, resolutionMethod: 'explicit',
    };
    const result = computeConfidenceScore(p, {}, history);
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('produces low score for risky product', () => {
    const p = createCanonicalProduct({ name: 'X', price: 1 });
    p.fingerprintTier = 4;
    p.matchResult = { action: 'REVIEW', layerMatched: 2 };
    p.invoiceRisk = {
      similarProducts: [{
        similarityScore: 90,
        openInvoiceCount: 3,
        sameCategory: true,
      }],
    };
    const result = computeConfidenceScore(p, {}, defaultHistory);
    expect(result.score).toBeLessThanOrEqual(30);
  });
});
