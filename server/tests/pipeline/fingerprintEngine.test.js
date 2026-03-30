import { describe, it, expect } from 'vitest';
import { computeFingerprint } from '../../src/services/agents/pipeline/stages/fingerprintEngine.js';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';

describe('computeFingerprint', () => {
  it('returns tier 1 for valid barcode', () => {
    const p = createCanonicalProduct({ barcode: '9300633100033' });
    const result = computeFingerprint(p);
    expect(result.tier).toBe(1);
  });

  it('returns tier 2 for externalId + sourceSystem', () => {
    const p = createCanonicalProduct({
      externalId: 'PROD-123',
      sourceSystem: 'lightspeed',
    });
    const result = computeFingerprint(p);
    expect(result.tier).toBe(2);
  });

  it('returns tier 3 for sku + brand', () => {
    const p = createCanonicalProduct({
      sku: 'CB-500G',
      brand: 'Vittoria',
    });
    const result = computeFingerprint(p);
    expect(result.tier).toBe(3);
  });

  it('returns tier 4 when no identity fields present', () => {
    const p = createCanonicalProduct({ name: 'Generic Product' });
    const result = computeFingerprint(p);
    expect(result.tier).toBe(4);
  });

  it('prefixes fingerprint with tier T1: T2: T3: T4:', () => {
    const p1 = createCanonicalProduct({ barcode: '9300633100033' });
    expect(computeFingerprint(p1).fingerprint).toMatch(/^T1:/);

    const p2 = createCanonicalProduct({ externalId: 'X', sourceSystem: 'Y' });
    expect(computeFingerprint(p2).fingerprint).toMatch(/^T2:/);

    const p3 = createCanonicalProduct({ sku: 'S', brand: 'B' });
    expect(computeFingerprint(p3).fingerprint).toMatch(/^T3:/);

    const p4 = createCanonicalProduct({ name: 'N' });
    expect(computeFingerprint(p4).fingerprint).toMatch(/^T4:/);
  });

  it('produces same hash for same inputs (determinism)', () => {
    const p1 = createCanonicalProduct({ barcode: '12345678' });
    const p2 = createCanonicalProduct({ barcode: '12345678' });
    expect(computeFingerprint(p1).fingerprint).toBe(
      computeFingerprint(p2).fingerprint
    );
  });

  it('produces different hashes for different inputs', () => {
    const p1 = createCanonicalProduct({ barcode: '12345678' });
    const p2 = createCanonicalProduct({ barcode: '87654321' });
    expect(computeFingerprint(p1).fingerprint).not.toBe(
      computeFingerprint(p2).fingerprint
    );
  });

  it('produces same T4 hash for name regardless of token order', () => {
    const p1 = createCanonicalProduct({ name: 'Blue Widget Large' });
    const p2 = createCanonicalProduct({ name: 'Large Blue Widget' });
    const f1 = computeFingerprint(p1);
    const f2 = computeFingerprint(p2);
    expect(f1.tier).toBe(4);
    expect(f2.tier).toBe(4);
    expect(f1.fingerprint).toBe(f2.fingerprint);
  });

  it('validates EAN-13 check digit correctly', () => {
    // 1234567890128: check digit = (10 - 92%10)%10 = 8 ✓
    const valid = createCanonicalProduct({ barcode: '1234567890128' });
    const r1 = computeFingerprint(valid);
    expect(r1.tier).toBe(1);
    expect(r1.components.barcodeValid).toBe(true);

    // 1234567890129: check digit should be 8, not 9 ✗
    const invalid = createCanonicalProduct({ barcode: '1234567890129' });
    const r2 = computeFingerprint(invalid);
    expect(r2.tier).toBe(1);
    expect(r2.components.barcodeValid).toBe(false);
  });

  it('accepts 8+ digit strings as barcodes at tier 1', () => {
    const p = createCanonicalProduct({ barcode: '12345678' });
    const result = computeFingerprint(p);
    // Any non-empty normalised barcode resolves to tier 1
    expect(result.tier).toBe(1);
  });
});
