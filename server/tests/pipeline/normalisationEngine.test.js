import { describe, it, expect } from 'vitest';
import {
  normaliseString,
  normaliseProduct,
} from '../../src/services/agents/pipeline/stages/normalisationEngine.js';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';

describe('normaliseString', () => {
  it('returns empty string for null input', () => {
    expect(normaliseString(null)).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(normaliseString(123)).toBe('');
    expect(normaliseString(undefined)).toBe('');
    expect(normaliseString({})).toBe('');
  });

  it('converts to lowercase', () => {
    expect(normaliseString('HELLO')).toBe('hello');
  });

  it('trims and collapses whitespace', () => {
    const result = normaliseString('  extra   spaces  ');
    expect(result).toBe('extra spaces');
  });

  it('expands colour → color', () => {
    const result = normaliseString('colour');
    expect(result).toBe('color');
  });

  it('expands centre → center', () => {
    const result = normaliseString('centre');
    expect(result).toBe('center');
  });

  it('normalises 500ml → 500milliliter', () => {
    const result = normaliseString('500ml');
    expect(result).toContain('500milliliter');
  });

  it('normalises 2kg → 2kilogram', () => {
    const result = normaliseString('2kg');
    expect(result).toContain('2kilogram');
  });

  it('sorts tokens alphabetically', () => {
    const a = normaliseString('Blue Widget Large');
    const b = normaliseString('Large Blue Widget');
    expect(a).toBe(b);
    expect(a).toBe('blue large widget');
  });

  it('strips punctuation characters', () => {
    const result = normaliseString('price: $9.99!');
    expect(result).not.toContain(':');
    expect(result).not.toContain('!');
  });

  it('handles already-normalised input idempotently', () => {
    const input = 'blue large widget';
    const result = normaliseString(input);
    expect(result).toBe(input);
    expect(normaliseString(result)).toBe(input);
  });
});

describe('normaliseProduct', () => {
  it('populates all normalised fields', () => {
    const p = createCanonicalProduct({
      name: 'Test Product',
      brand: 'Test Brand',
      category: 'Test Category',
      sku: 'SKU-001',
      barcode: '1234567890',
    });
    normaliseProduct(p);
    expect(p.normalised.name).toBeTruthy();
    expect(p.normalised.brand).toBeTruthy();
    expect(p.normalised.category).toBeTruthy();
    expect(p.normalised.sku).toBeTruthy();
    expect(p.normalised.barcode).toBeTruthy();
  });

  it('handles missing optional fields gracefully', () => {
    const p = createCanonicalProduct({ name: 'Just A Name' });
    normaliseProduct(p);
    expect(p.normalised.name).toBeTruthy();
    expect(p.normalised.brand).toBe('');
    expect(p.normalised.category).toBe('');
    expect(p.normalised.sku).toBe('');
    expect(p.normalised.barcode).toBe('');
  });

  it('extracts size from name when size is null', () => {
    const p = createCanonicalProduct({ name: 'Milk 2L' });
    normaliseProduct(p);
    expect(p.size).toBe('2L');
    expect(p.name).toBe('Milk');
  });

  it('does not modify name if size already set', () => {
    const p = createCanonicalProduct({ name: 'Milk 2L', size: '500ml' });
    normaliseProduct(p);
    expect(p.name).toBe('Milk 2L');
    expect(p.size).toBe('500ml');
  });
});
