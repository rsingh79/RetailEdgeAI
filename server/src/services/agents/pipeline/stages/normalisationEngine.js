// server/src/services/agents/pipeline/stages/normalisationEngine.js
// Normalisation Engine — Stage E of the product import pipeline.
// 8-step normalisation algorithm for reliable duplicate detection.

import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';
import { normalizeUnit, splitNameAndSize } from '../../productImportAgent.js';

// ── Abbreviation map (British → American spelling) ──
const ABBREVIATIONS = [
  [/\bcolour\b/g, 'color'],
  [/\bcentre\b/g, 'center'],
  [/\blitre\b/g, 'liter'],
  [/\blitres\b/g, 'liters'],
  [/\bmetre\b/g, 'meter'],
  [/\bmetres\b/g, 'meters'],
  [/\bgrey\b/g, 'gray'],
];

// ── Unit normalisation patterns ──
const UNIT_PATTERNS = [
  [/(\d+\.?\d*)\s*ml\b/g, '$1milliliter'],
  [/(\d+\.?\d*)\s*cm\b/g, '$1centimeter'],
  [/(\d+\.?\d*)\s*mm\b/g, '$1millimeter'],
  [/(\d+\.?\d*)\s*kg\b/g, '$1kilogram'],
  [/(\d+\.?\d*)\s*g\b/g, '$1gram'],
  [/(\d+\.?\d*)\s*l\b/g, '$1liter'],
  [/(\d+\.?\d*)\s*m\b/g, '$1meter'],
];

/**
 * 8-step normalisation algorithm for any string value.
 * Returns a normalised, token-sorted string suitable for comparison and hashing.
 */
function normaliseString(value) {
  // Step 1 — Null guard
  if (value === null || value === undefined || typeof value !== 'string') {
    return '';
  }

  // Step 2 — Unicode normalisation
  let v = value.normalize('NFC');
  v = v.replace(/[\u2018\u2019]/g, "'");
  v = v.replace(/[\u201C\u201D]/g, '"');
  v = v.replace(/[\u2014\u2013]/g, '-');

  // Step 3 — Lowercase
  v = v.toLowerCase();

  // Step 4 — Whitespace normalisation
  v = v.replace(/[\s\t\n\r]+/g, ' ').trim();

  // Step 5 — Punctuation handling
  // Remove these characters
  v = v.replace(/[.,;:!?()\[\]{}"']/g, '');
  // Replace these with space
  v = v.replace(/[/\\|&@#%*^~`+=]/g, ' ');
  // Collapse multiple spaces and trim
  v = v.replace(/\s+/g, ' ').trim();

  // Step 6 — Abbreviation expansion
  for (const [pattern, replacement] of ABBREVIATIONS) {
    v = v.replace(pattern, replacement);
  }

  // Step 7 — Unit normalisation
  for (const [pattern, replacement] of UNIT_PATTERNS) {
    v = v.replace(pattern, replacement);
  }

  // Step 8 — Token sort
  v = v.split(' ').filter(Boolean).sort().join(' ');

  return v;
}

/**
 * Populate product.normalised fields using normaliseString.
 * Also applies splitNameAndSize and normalizeUnit from the existing agent.
 */
function normaliseProduct(product) {
  // Apply splitNameAndSize if size/baseUnit not already set
  if (
    product.name &&
    product.size === null &&
    product.baseUnit === null &&
    /\d+\.?\d*\s*(?:kg|g|L|l|ml|litre|liter|mm|cm|m)\b/i.test(product.name)
  ) {
    const result = splitNameAndSize(product.name);
    if (result.name !== product.name.trim()) {
      product.name = result.name;
      product.size = result.size || null;
      product.baseUnit = result.baseUnit || product.baseUnit;
      product.packSize = result.packSize || null;
      product.unitQty = result.unitQty || product.unitQty;
    }
  }

  // Normalise baseUnit if set
  if (product.baseUnit) {
    product.baseUnit = normalizeUnit(product.baseUnit);
  }

  // Populate normalised fields
  product.normalised.name = normaliseString(product.name);
  product.normalised.brand = normaliseString(product.brand);
  product.normalised.category = normaliseString(product.category);
  product.normalised.sku = normaliseString(product.sku);
  product.normalised.barcode = normaliseString(product.barcode);

  return product;
}

class NormalisationEngine extends PipelineStage {
  constructor() {
    super('normalisation_engine');
  }

  async process(product, context) {
    try {
      normaliseProduct(product);

      if (!product.normalised.name) {
        addWarning(
          product,
          this.name,
          'Product name is empty after normalisation'
        );
      }

      // Apply GST stripping if context says to strip
      if (context.stageData.gstDetected && context.stageData.gstRate) {
        const rate = context.stageData.gstRate;
        if (product.price) {
          product.price = Math.round(
            (product.price / (1 + rate)) * 100
          ) / 100;
        }
        if (product.costPrice) {
          product.costPrice = Math.round(
            (product.costPrice / (1 + rate)) * 100
          ) / 100;
        }
      }
    } catch (err) {
      this.error('Normalisation failed', err);
      addWarning(product, this.name, `Normalisation error: ${err.message}`);
    }

    return product;
  }
}

export { normaliseString, normaliseProduct, NormalisationEngine };
export default NormalisationEngine;
