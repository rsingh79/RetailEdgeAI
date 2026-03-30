import { describe, it, expect } from 'vitest';
import {
  createCanonicalProduct,
  createCanonicalVariant,
  addError,
  addWarning,
  hasFatalError,
  isReadyToWrite,
} from '../../src/services/agents/pipeline/canonicalProduct.js';

describe('createCanonicalProduct', () => {
  it('creates a product with all default fields', () => {
    const p = createCanonicalProduct();
    expect(p.name).toBe(null);
    expect(p.price).toBe(null);
    expect(p.currency).toBe('AUD');
    expect(p.status).toBe('ACTIVE');
    expect(p.trackInventory).toBe(true);
    expect(p.allowBackorder).toBe(false);
    expect(p.unitQty).toBe(1);
    expect(p.processingComplete).toBe(false);
    expect(p.sourceSystem).toBe(null);
    expect(p.fingerprint).toBe(null);
    expect(p.confidenceScore).toBe(null);
    expect(p.approvalRoute).toBe(null);
  });

  it('merges overrides with defaults', () => {
    const p = createCanonicalProduct({ name: 'Test', price: 9.99, currency: 'USD' });
    expect(p.name).toBe('Test');
    expect(p.price).toBe(9.99);
    expect(p.currency).toBe('USD');
    expect(p.status).toBe('ACTIVE');
  });

  it('initialises empty arrays for tags, variants, images, errors, warnings', () => {
    const p = createCanonicalProduct();
    expect(Array.isArray(p.tags)).toBe(true);
    expect(p.tags).toHaveLength(0);
    expect(Array.isArray(p.variants)).toBe(true);
    expect(p.variants).toHaveLength(0);
    expect(Array.isArray(p.images)).toBe(true);
    expect(p.images).toHaveLength(0);
    expect(Array.isArray(p.errors)).toBe(true);
    expect(p.errors).toHaveLength(0);
    expect(Array.isArray(p.warnings)).toBe(true);
    expect(p.warnings).toHaveLength(0);
  });

  it('initialises matchResult object with null fields', () => {
    const p = createCanonicalProduct();
    expect(p.matchResult).toBeDefined();
    expect(p.matchResult.action).toBe(null);
    expect(p.matchResult.layerMatched).toBe(null);
    expect(p.matchResult.matchedProductId).toBe(null);
    expect(Array.isArray(p.matchResult.matchedOn)).toBe(true);
    expect(p.matchResult.matchScore).toBe(null);
  });

  it('initialises invoiceRisk object with NONE level', () => {
    const p = createCanonicalProduct();
    expect(p.invoiceRisk).toBeDefined();
    expect(p.invoiceRisk.level).toBe('NONE');
    expect(p.invoiceRisk.explanation).toBe(null);
    expect(Array.isArray(p.invoiceRisk.similarProducts)).toBe(true);
  });
});

describe('addError and addWarning', () => {
  it('adds an error with stage, message, fatal, timestamp', () => {
    const p = createCanonicalProduct();
    addError(p, 'test_stage', 'something broke', true);
    expect(p.errors).toHaveLength(1);
    expect(p.errors[0].stage).toBe('test_stage');
    expect(p.errors[0].message).toBe('something broke');
    expect(p.errors[0].fatal).toBe(true);
    expect(p.errors[0].timestamp).toBeInstanceOf(Date);
  });

  it('adds a warning with stage, message, timestamp', () => {
    const p = createCanonicalProduct();
    addWarning(p, 'test_stage', 'heads up');
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0].stage).toBe('test_stage');
    expect(p.warnings[0].message).toBe('heads up');
    expect(p.warnings[0].timestamp).toBeInstanceOf(Date);
  });

  it('returns the product after adding', () => {
    const p = createCanonicalProduct();
    const result = addError(p, 's', 'm', false);
    expect(result).toBe(p);
    const result2 = addWarning(p, 's', 'm');
    expect(result2).toBe(p);
  });

  it('can add multiple errors', () => {
    const p = createCanonicalProduct();
    addError(p, 'a', 'err1', false);
    addError(p, 'b', 'err2', true);
    addError(p, 'c', 'err3', false);
    expect(p.errors).toHaveLength(3);
  });
});

describe('hasFatalError', () => {
  it('returns false when no errors', () => {
    const p = createCanonicalProduct();
    expect(hasFatalError(p)).toBe(false);
  });

  it('returns false when errors all have fatal: false', () => {
    const p = createCanonicalProduct();
    addError(p, 'a', 'non-fatal', false);
    addError(p, 'b', 'also non-fatal', false);
    expect(hasFatalError(p)).toBe(false);
  });

  it('returns true when any error has fatal: true', () => {
    const p = createCanonicalProduct();
    addError(p, 'a', 'non-fatal', false);
    addError(p, 'b', 'fatal one', true);
    expect(hasFatalError(p)).toBe(true);
  });
});

describe('isReadyToWrite', () => {
  it('returns true for valid ROUTE_AUTO product', () => {
    const p = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: 'AUD', status: 'ACTIVE',
      approvalRoute: 'ROUTE_AUTO',
    });
    expect(isReadyToWrite(p)).toBe(true);
  });

  it('returns false when name is missing', () => {
    const p = createCanonicalProduct({
      price: 9.99, currency: 'AUD', status: 'ACTIVE',
      approvalRoute: 'ROUTE_AUTO',
    });
    expect(isReadyToWrite(p)).toBe(false);
  });

  it('returns false when price is null', () => {
    const p = createCanonicalProduct({
      name: 'Test', currency: 'AUD', status: 'ACTIVE',
      approvalRoute: 'ROUTE_AUTO',
    });
    expect(isReadyToWrite(p)).toBe(false);
  });

  it('returns false when hasFatalError is true', () => {
    const p = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: 'AUD', status: 'ACTIVE',
      approvalRoute: 'ROUTE_AUTO',
    });
    addError(p, 'stage', 'fatal', true);
    expect(isReadyToWrite(p)).toBe(false);
  });

  it('returns false when approvalRoute is ROUTE_REVIEW', () => {
    const p = createCanonicalProduct({
      name: 'Test', price: 9.99, currency: 'AUD', status: 'ACTIVE',
      approvalRoute: 'ROUTE_REVIEW',
    });
    expect(isReadyToWrite(p)).toBe(false);
  });
});
