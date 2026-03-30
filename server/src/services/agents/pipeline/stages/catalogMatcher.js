// server/src/services/agents/pipeline/stages/catalogMatcher.js
// Catalog Matcher — Stage G of the product import pipeline.
// Three-layer matching against existing catalog for dedup/update/merge.

import Fuse from 'fuse.js';
import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';
import { embed as routerEmbed } from '../../../ai/aiServiceRouter.js';
import { findNearestProducts } from '../../../ai/vectorStore.js';

// ── PART 1 — Field diff ──

const DIFF_FIELDS = [
  'name', 'category', 'barcode', 'baseUnit',
  'costPrice', 'sellingPrice', 'source',
  'description', 'status',
];

function computeFieldDiff(incoming, existing) {
  const diff = {};
  for (const field of DIFF_FIELDS) {
    const incomingVal = incoming[field];
    if (incomingVal === null || incomingVal === undefined) continue;
    if (!(field in existing)) continue;
    const existingVal = existing[field];
    if (incomingVal !== existingVal) {
      diff[field] = { incoming: incomingVal, existing: existingVal };
    }
  }
  return diff;
}

// ── PART 2 — Layer 1: Exact Identity Match ──

async function layer1Match(product, context) {
  const prisma = context.prisma;

  // Check 1.1 — Fingerprint lookup
  if (product.fingerprint) {
    const existing = await prisma.product.findFirst({
      where: {
        fingerprint: product.fingerprint,
        archivedAt: null,
      },
    });
    if (existing && product.fingerprint.charAt(1) === existing.fingerprint?.charAt(1)) {
      const fieldDiff = computeFieldDiff(product, existing);
      return {
        matched: true,
        action: Object.keys(fieldDiff).length === 0 ? 'SKIP' : 'UPDATE',
        matchedProduct: existing,
        matchedOn: ['fingerprint'],
        fieldDiff,
        layer: 1,
      };
    }
  }

  // Check 1.2 — externalId + sourceSystem
  if (product.externalId && product.sourceSystem) {
    const existing = await prisma.product.findFirst({
      where: {
        externalId: product.externalId,
        source: product.sourceSystem,
        archivedAt: null,
      },
    });
    if (existing) {
      const fieldDiff = computeFieldDiff(product, existing);
      return {
        matched: true,
        action: Object.keys(fieldDiff).length === 0 ? 'SKIP' : 'UPDATE',
        matchedProduct: existing,
        matchedOn: ['externalId', 'sourceSystem'],
        fieldDiff,
        layer: 1,
      };
    }
  }

  // Check 1.3 — Barcode exact match
  if (product.barcode) {
    const existing = await prisma.product.findFirst({
      where: {
        barcode: product.barcode,
        archivedAt: null,
      },
    });
    if (existing) {
      const fieldDiff = computeFieldDiff(product, existing);
      const sameSource =
        product.sourceSystem && existing.source === product.sourceSystem;
      return {
        matched: true,
        action: sameSource
          ? (Object.keys(fieldDiff).length === 0 ? 'SKIP' : 'UPDATE')
          : 'MERGE',
        matchedProduct: existing,
        matchedOn: ['barcode'],
        fieldDiff,
        layer: 1,
      };
    }
  }

  // Check 1.4 — SKU match within same source
  if (product.sku && product.sourceSystem) {
    const variant = await prisma.productVariant.findFirst({
      where: {
        sku: product.sku,
        product: { source: product.sourceSystem },
        isActive: true,
      },
      include: { product: true },
    });
    if (variant && variant.product && !variant.product.archivedAt) {
      const fieldDiff = computeFieldDiff(product, variant.product);
      return {
        matched: true,
        action: Object.keys(fieldDiff).length === 0 ? 'SKIP' : 'UPDATE',
        matchedProduct: variant.product,
        matchedOn: ['sku', 'sourceSystem'],
        fieldDiff,
        layer: 1,
      };
    }
  }

  return null;
}

// ── PART 3 — Layer 2: Fuzzy Semantic Match ──

async function layer2Match(product, context) {
  const prisma = context.prisma;

  // Step 1 — Pre-filter catalog products
  const orFilters = [];
  if (product.category) {
    orFilters.push({ category: product.category });
  }
  if (product.name) {
    const firstWord = product.name.split(/\s+/)[0];
    if (firstWord) {
      orFilters.push({ name: { contains: firstWord, mode: 'insensitive' } });
    }
  }
  if (orFilters.length === 0) return [];

  const catalog = await prisma.product.findMany({
    where: {
      archivedAt: null,
      OR: orFilters,
    },
    take: 200,
    select: {
      id: true,
      name: true,
      category: true,
      barcode: true,
      baseUnit: true,
      source: true,
      costPrice: true,
      sellingPrice: true,
    },
  });

  if (catalog.length === 0) return [];

  // Step 2 — Fuse.js fuzzy match
  const fuse = new Fuse(catalog, {
    keys: [
      { name: 'name', weight: 0.5 },
      { name: 'category', weight: 0.25 },
      { name: 'baseUnit', weight: 0.15 },
      { name: 'source', weight: 0.1 },
    ],
    threshold: 0.3,
    includeScore: true,
    useExtendedSearch: false,
  });

  const searchTerm = product.normalised?.name || product.name || '';
  if (!searchTerm) return [];

  const results = fuse.search(searchTerm);

  // Step 3 — Convert scores to similarity percentages
  // Step 4 — Filter >= 75% similarity
  return results
    .map((r) => ({
      product: r.item,
      similarity: Math.round((1 - r.score) * 100),
      matchedOn: ['name_similarity'],
      layer: 2,
      action: 'REVIEW',
    }))
    .filter((r) => r.similarity >= 75)
    .sort((a, b) => b.similarity - a.similarity);
}

// ── PART 3.5 — Layer 2.5: Embedding Similarity Match ──

/**
 * Embed the incoming product name via Cohere, then find nearest
 * neighbors in the tenant's pre-embedded product catalog via pgvector.
 *
 * Only runs if Layers 1 and 2 found no match.
 * Always returns REVIEW — embedding matches are probabilistic,
 * never auto-approved without human confirmation.
 */
async function layer25Match(product, context) {
  try {
    const queryText = buildEmbeddingQueryText(product);
    if (!queryText) return null;

    const embedResult = await routerEmbed('product_matching_embed', queryText, {
      tenantId: context.tenantId,
      inputType: 'search_query',
    });

    if (!embedResult.vectors || embedResult.vectors.length === 0) {
      return null;
    }

    const nearest = await findNearestProducts({
      tenantId: context.tenantId,
      queryVector: embedResult.vectors[0],
      model: 'embed-english-v3.0',
      limit: 5,
      minSimilarity: 0.70,
    });

    if (nearest.length === 0) {
      return null;
    }

    return {
      matchAction: 'REVIEW',
      matchedProductId: nearest[0].productId,
      matchSource: 'embedding',
      embeddingSimilarity: nearest[0].similarity,
      embeddingCandidates: nearest.map((n) => ({
        productId: n.productId,
        similarity: n.similarity,
        embeddingText: n.embeddingText,
      })),
    };
  } catch (err) {
    console.warn(
      `[CatalogMatcher] Embedding match failed for "${product.name}":`,
      err.message,
    );
    return null;
  }
}

function buildEmbeddingQueryText(product) {
  const parts = [];
  if (product.name) parts.push(product.name);
  if (product.brand) parts.push(product.brand);
  if (product.category) parts.push(product.category);
  if (product.baseUnit) parts.push(product.baseUnit);
  return parts.join(' | ') || null;
}

// ── PART 4 — Layer 3: Cross-Source Match ──

async function layer3Match(product, context) {
  const prisma = context.prisma;
  if (!product.barcode) return [];

  const crossMatches = await prisma.product.findMany({
    where: {
      barcode: product.barcode,
      archivedAt: null,
      NOT: { source: product.sourceSystem },
    },
  });

  return crossMatches.map((p) => ({
    product: p,
    layer: 3,
    action: 'MERGE',
    matchedOn: ['barcode', 'cross_source'],
  }));
}

// ── PART 5 — CatalogMatcher stage class ──

class CatalogMatcher extends PipelineStage {
  constructor() {
    super('catalog_matcher');
  }

  async process(product, context) {
    // Skip if no prisma — used in dry run testing
    if (!context.prisma) {
      product.matchResult.action = 'CREATE';
      return product;
    }

    try {
      // Run Layer 1
      const l1 = await layer1Match(product, context);

      if (l1) {
        product.matchResult.action = l1.action;
        product.matchResult.layerMatched = 1;
        product.matchResult.matchedProductId =
          l1.matchedProduct?.id || null;
        product.matchResult.matchedOn = l1.matchedOn;
        product.matchResult.fieldDiff = l1.fieldDiff || {};

        // Run Layer 3 if barcode cross-source detected
        if (l1.action === 'MERGE') {
          const l3 = await layer3Match(product, context);
          product.matchResult.crossSourceMatches = l3;
        }

        this.log(
          `Layer 1 match: ${l1.action} on ${l1.matchedOn.join(', ')}`
        );
        return product;
      }

      // Run Layer 2 if Layer 1 found nothing
      const l2Candidates = await layer2Match(product, context);

      if (l2Candidates.length > 0) {
        const top = l2Candidates[0];
        product.matchResult.action = 'REVIEW';
        product.matchResult.layerMatched = 2;
        product.matchResult.matchedProductId = top.product.id;
        product.matchResult.matchedOn = top.matchedOn;
        product.matchResult.matchScore = top.similarity;
        product.matchResult.fieldDiff =
          computeFieldDiff(product, top.product);
        // Store all candidates for the approval queue
        context.stageData.fuzzyMatches =
          context.stageData.fuzzyMatches || {};
        context.stageData.fuzzyMatches[product.rowIndex] =
          l2Candidates;

        this.log(
          `Layer 2 match: REVIEW — top similarity ${top.similarity}%`
        );
        return product;
      }

      // Layer 2.5 — Embedding similarity (only if Layers 1 and 2 found nothing)
      const embeddingMatch = await layer25Match(product, context);
      if (embeddingMatch) {
        product.matchResult.action = embeddingMatch.matchAction;
        product.matchResult.layerMatched = 2.5;
        product.matchResult.matchedProductId = embeddingMatch.matchedProductId;
        product.matchResult.matchedOn = ['embedding_similarity'];
        product.matchResult.matchSource = embeddingMatch.matchSource;
        product.matchResult.embeddingSimilarity = embeddingMatch.embeddingSimilarity;
        product.matchResult.embeddingCandidates = embeddingMatch.embeddingCandidates;
        context.stageData.embeddingMatches =
          context.stageData.embeddingMatches || {};
        context.stageData.embeddingMatches[product.rowIndex] =
          embeddingMatch.embeddingCandidates;

        this.log(
          `Layer 2.5 match: REVIEW — top embedding similarity ${embeddingMatch.embeddingSimilarity.toFixed(4)}`,
        );
        return product;
      }

      // No match found — safe to create
      product.matchResult.action = 'CREATE';
      product.matchResult.layerMatched = null;
      this.log('No match found — action: CREATE');
    } catch (err) {
      this.error('Catalog matching failed', err);
      addWarning(
        product,
        this.name,
        `Matching error: ${err.message} — defaulting to REVIEW`
      );
      product.matchResult.action = 'REVIEW';
    }

    return product;
  }
}

export { computeFieldDiff, CatalogMatcher };
export default CatalogMatcher;
