import { describe, it, expect } from 'vitest';
import { normalizeSource } from '../../../src/services/sourceNormalizer.js';

describe('normalizeSource', () => {
  it("normalizeSource('shopify') returns 'Shopify'", () => {
    expect(normalizeSource('shopify')).toBe('Shopify');
  });

  it("normalizeSource('SHOPIFY') returns 'Shopify' (case-insensitive)", () => {
    expect(normalizeSource('SHOPIFY')).toBe('Shopify');
  });

  it("normalizeSource('abacus pos') returns 'Abacus POS'", () => {
    expect(normalizeSource('abacus pos')).toBe('Abacus POS');
  });

  it("normalizeSource('abacus_pos') returns 'Abacus POS'", () => {
    expect(normalizeSource('abacus_pos')).toBe('Abacus POS');
  });

  it("normalizeSource('pos') returns 'POS'", () => {
    expect(normalizeSource('pos')).toBe('POS');
  });

  it("normalizeSource('csv_upload') returns 'CSV Import'", () => {
    expect(normalizeSource('csv_upload')).toBe('CSV Import');
  });

  it("normalizeSource(null) returns 'Manual'", () => {
    expect(normalizeSource(null)).toBe('Manual');
  });

  it("normalizeSource('') returns 'Manual'", () => {
    expect(normalizeSource('')).toBe('Manual');
  });

  it("normalizeSource('UnknownSystem') returns 'UnknownSystem' (passthrough)", () => {
    expect(normalizeSource('UnknownSystem')).toBe('UnknownSystem');
  });

  it("normalizeSource('  Shopify  ') returns 'Shopify' (trims whitespace)", () => {
    expect(normalizeSource('  Shopify  ')).toBe('Shopify');
  });

  it("normalizeSource('woo') returns 'WooCommerce'", () => {
    expect(normalizeSource('woo')).toBe('WooCommerce');
  });

  it("normalizeSource('myob') returns 'MYOB'", () => {
    expect(normalizeSource('myob')).toBe('MYOB');
  });

  it("normalizeSource(undefined) returns 'Manual'", () => {
    expect(normalizeSource(undefined)).toBe('Manual');
  });
});
