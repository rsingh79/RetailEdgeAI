// server/src/services/agents/pipeline/stages/sourceResolver.js
// Source Resolver — Stage B of the product import pipeline.
// Determines origin of every import, assigns source metadata,
// and loads any saved ImportTemplate for the source.

import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';
import { normalizeSource } from '../../../sourceNormalizer.js';

// ── Source inference from filename ──

const FILENAME_PATTERNS = [
  ['shopify', 'shopify'],
  ['woocommerce', 'woocommerce'],
  ['lightspeed', 'lightspeed'],
  ['myob', 'myob'],
  ['xero', 'xero'],
  ['square', 'square'],
  ['vend', 'vend'],
  ['cin7', 'cin7'],
  ['dear', 'dear'],
  ['netsuite', 'netsuite'],
];

function inferSourceFromFilename(filename) {
  if (!filename) return null;
  const lower = filename.toLowerCase();
  for (const [pattern, source] of FILENAME_PATTERNS) {
    if (lower.includes(pattern)) return source;
  }
  return null;
}

// ── Source inference from headers ──

const HEADER_SIGNATURES = [
  {
    source: 'shopify',
    headers: ['Handle', 'Vendor', 'Variant Grams', 'Variant SKU', 'Image Src'],
    minMatch: 2,
  },
  {
    source: 'woocommerce',
    headers: ['post_name', 'tax:product_type', 'meta:_regular_price'],
    minMatch: 2,
  },
  {
    source: 'lightspeed',
    headers: ['System ID', 'Custom SKU', 'Default Cost', 'Default Price'],
    minMatch: 2,
  },
];

function inferSourceFromHeaders(headers) {
  if (!headers || !Array.isArray(headers)) return null;
  const headerSet = new Set(headers);
  for (const sig of HEADER_SIGNATURES) {
    const matched = sig.headers.filter((h) => headerSet.has(h)).length;
    if (matched >= sig.minMatch) return sig.source;
  }
  return null;
}

// ── SourceResolver stage ──

class SourceResolver extends PipelineStage {
  constructor() {
    super('source_resolver');
    this.resolvedTemplate = null;
  }

  async setup(context) {
    if (!context.prisma || !context.tenantId) return;
    if (!context.sourceName) return;

    try {
      const template = await context.prisma.importTemplate.findFirst({
        where: {
          tenantId: context.tenantId,
          systemName: context.sourceName,
        },
      });

      if (template) {
        this.resolvedTemplate = template;
        this.log(
          `Loaded ImportTemplate for source: ${context.sourceName}`
        );
        context.stageData.importTemplate = template;
        context.stageData.savedMapping = template.mapping;
      } else {
        this.log(
          `No saved ImportTemplate found for source: ${context.sourceName}`
        );
      }
    } catch (err) {
      this.error('Failed to load ImportTemplate', err);
    }
  }

  async process(product, context) {
    try {
      // 1. Set sourceType from context if not already set
      if (!product.sourceType && context.sourceType) {
        product.sourceType = context.sourceType;
        product.productImportedThrough = context.sourceType;
      }

      // 2. Set sourceName from context if not already set
      if (!product.sourceSystem && context.sourceName) {
        product.sourceSystem = context.sourceName;
      }

      // 3. Try to infer source from filename if still unknown
      if (!product.sourceSystem && context.stageData.fileName) {
        const inferred = inferSourceFromFilename(
          context.stageData.fileName
        );
        if (inferred) {
          product.sourceSystem = inferred;
          this.log(`Inferred source from filename: ${inferred}`);
        }
      }

      // 4. Try to infer source from headers if still unknown
      if (!product.sourceSystem && context.stageData.headers) {
        const inferred = inferSourceFromHeaders(
          context.stageData.headers
        );
        if (inferred) {
          product.sourceSystem = inferred;
          this.log(`Inferred source from headers: ${inferred}`);
        }
      }

      // 5. Default to MANUAL if source is still unknown
      if (!product.sourceSystem) {
        product.sourceSystem = 'Manual';
        addWarning(
          product,
          this.name,
          'Could not determine source system — defaulting to Manual'
        );
      }

      // 6. Normalize source name to canonical form
      product.sourceSystem = normalizeSource(product.sourceSystem);

      // 7. Set importJobId from context
      if (!product.importJobId && context.importJobId) {
        product.importJobId = context.importJobId;
        product.importId = context.importJobId;
      }
    } catch (err) {
      this.error('Source resolution failed', err);
      addWarning(
        product,
        this.name,
        `Source resolution error: ${err.message}`
      );
    }

    return product;
  }
}

export { inferSourceFromFilename, inferSourceFromHeaders, SourceResolver };
export default SourceResolver;
