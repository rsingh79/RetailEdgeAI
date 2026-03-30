// server/src/services/agents/pipeline/stages/fingerprintEngine.js
// Fingerprint Engine — Stage F of the product import pipeline.
// Computes a stable deterministic identity hash for every product
// using normalised fields. Used by Catalog Matcher for duplicate detection.

import crypto from 'crypto';
import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';
import { normaliseString } from './normalisationEngine.js';

// ── Barcode validation ──

function validateBarcode(barcode) {
  const digits = barcode.replace(/\D/g, '');

  // EAN-13, UPC-A, GTIN-14
  if (digits.length === 13 || digits.length === 12 || digits.length === 14) {
    const chars = digits.split('').map(Number);
    const checkDigit = chars.pop();
    let sum = 0;
    for (let i = 0; i < chars.length; i++) {
      sum += chars[i] * (i % 2 === 0 ? 1 : 3);
    }
    const calculated = (10 - (sum % 10)) % 10;
    return calculated === checkDigit;
  }

  // Fallback: any string of 8+ digits accepted with lower confidence
  return digits.length >= 8;
}

// ── Fingerprint computation ──

/**
 * Compute a tiered fingerprint for a CanonicalProduct.
 * @returns {{ fingerprint: string, tier: number, components: object }}
 */
function computeFingerprint(product) {
  // Tier 1 — Barcode
  if (product.barcode) {
    const normBarcode = normaliseString(product.barcode);
    if (normBarcode) {
      const barcodeValid = validateBarcode(product.barcode);
      const hash = crypto
        .createHash('sha256')
        .update(normBarcode)
        .digest('hex');
      return {
        fingerprint: `T1:${hash}`,
        tier: 1,
        components: { barcode: normBarcode, barcodeValid },
      };
    }
  }

  // Tier 2 — External ID + Source System
  if (product.externalId && product.sourceSystem) {
    const normExternalId = normaliseString(product.externalId);
    const normSourceSystem = normaliseString(product.sourceSystem);
    if (normExternalId && normSourceSystem) {
      const hashInput = normSourceSystem + '|' + normExternalId;
      const hash = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');
      return {
        fingerprint: `T2:${hash}`,
        tier: 2,
        components: { sourceSystem: normSourceSystem, externalId: normExternalId },
      };
    }
  }

  // Tier 3 — SKU + Brand
  if (product.sku && product.brand) {
    const normSku = normaliseString(product.sku);
    const normBrand = normaliseString(product.brand);
    if (normSku && normBrand) {
      const hashInput = normSku + '|' + normBrand;
      const hash = crypto
        .createHash('sha256')
        .update(hashInput)
        .digest('hex');
      return {
        fingerprint: `T3:${hash}`,
        tier: 3,
        components: { sku: normSku, brand: normBrand },
      };
    }
  }

  // Tier 4 — Semantic fallback (name + brand + category)
  const normName = normaliseString(product.name);
  const normBrand = normaliseString(product.brand || '');
  const normCategory = normaliseString(product.category || '');
  const hashInput = normName + '|' + normBrand + '|' + normCategory;
  const hash = crypto
    .createHash('sha256')
    .update(hashInput)
    .digest('hex');
  return {
    fingerprint: `T4:${hash}`,
    tier: 4,
    components: { name: normName, brand: normBrand, category: normCategory },
  };
}

// ── FingerprintEngine stage ──

class FingerprintEngine extends PipelineStage {
  constructor() {
    super('fingerprint_engine');
  }

  async process(product, context) {
    try {
      const result = computeFingerprint(product);

      product.fingerprint = result.fingerprint;
      product.fingerprintTier = result.tier;
      product.fingerprintComponents = result.components;

      this.log(
        `Fingerprint computed — tier ${result.tier}: ` +
        result.fingerprint.substring(0, 20) + '...'
      );
    } catch (err) {
      this.error('Fingerprint computation failed', err);
      addWarning(
        product,
        this.name,
        `Fingerprint error: ${err.message}`
      );
    }

    return product;
  }
}

export { computeFingerprint, FingerprintEngine };
export default FingerprintEngine;
