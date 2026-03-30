// server/src/services/agents/pipeline/stages/confidenceScorer.js
// Confidence Scorer — Stage I of the product import pipeline.
// Computes a single score 0–100 from five weighted signal groups.

import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';

// ── PART 1 — Group 1: Identity Strength (max 35) ──

function scoreGroup1_IdentityStrength(product) {
  let score = 0;
  const signals = [];
  const tier = product.fingerprintTier;

  if (tier === 1) {
    score += 20;
    signals.push('tier1_barcode +20');
  } else if (tier === 2) {
    score += 15;
    signals.push('tier2_externalId +15');
  } else if (tier === 3) {
    if (product.sku && product.brand) {
      score += 8;
      signals.push('tier3_sku_brand_validated +8');
    } else {
      score += 5;
      signals.push('tier3_unvalidated +5');
    }
  } else if (tier === 4) {
    score += 3;
    signals.push('tier4_semantic +3');
  }

  // Stackable: externalId bonus (only if not tier 2 which already counted it)
  if (tier !== 2 && product.externalId) {
    score += 3;
    signals.push('externalId_present +3');
  }

  // Stackable: sku+brand bonus (only if tier 1 or 2)
  if ((tier === 1 || tier === 2) && product.sku && product.brand) {
    score += 2;
    signals.push('sku_brand_bonus +2');
  }

  score = Math.min(score, 35);
  return { score, max: 35, signals };
}

// ── PART 2 — Group 2: Source Trustworthiness (max 25) ──

function scoreGroup2_SourceTrustworthiness(product, context, sourceHistory) {
  let score = 0;
  const signals = [];
  const h = sourceHistory || {};

  if (h.isTrusted) {
    score += 10;
    signals.push('trusted_source +10');
  }

  const prior = h.priorImportCount || 0;
  const dupes = h.duplicateIncidents || 0;

  if (prior >= 10 && dupes === 0) {
    score += 8;
    signals.push('prior>=10_no_dupes +8');
  } else if (prior >= 5 && dupes === 0) {
    score += 5;
    signals.push('prior5-9_no_dupes +5');
  } else if (prior >= 2 && dupes === 0) {
    score += 3;
    signals.push('prior2-4_no_dupes +3');
  } else if (prior === 1) {
    score += 1;
    signals.push('prior1 +1');
  }

  // Resolution method bonus
  const method = h.resolutionMethod;
  if (method === 'explicit') {
    score += 5;
    signals.push('resolution_explicit +5');
  } else if (method === 'protocol') {
    score += 4;
    signals.push('resolution_protocol +4');
  } else if (method === 'payload') {
    score += 2;
    signals.push('resolution_payload +2');
  } else if (method === 'file') {
    score += 1;
    signals.push('resolution_file +1');
  }

  // Duplicate incident penalty
  if (dupes >= 5) {
    score -= 10;
    signals.push('dupes>=5 -10');
  } else if (dupes >= 2) {
    score -= 6;
    signals.push('dupes2-4 -6');
  } else if (dupes === 1) {
    score -= 3;
    signals.push('dupes1 -3');
  }

  score = Math.max(0, Math.min(score, 25));
  return { score, max: 25, signals };
}

// ── PART 3 — Group 3: Data Completeness (max 20) ──

function scoreGroup3_DataCompleteness(product) {
  let score = 20;
  const signals = [];

  // Required fields penalty
  const requiredFields = [
    ['name', product.name],
    ['price', product.price ?? product.sellingPrice],
    ['currency', product.currency],
    ['status', product.status],
  ];
  for (const [field, val] of requiredFields) {
    if (val === null || val === undefined || val === '') {
      score -= 5;
      signals.push(`missing_required_${field} -5`);
    }
  }

  // Recommended fields count
  const recommended = [
    product.sku,
    product.brand,
    product.category,
    product.description,
    product.barcode,
    product.costPrice,
    product.quantity,
    product.weight,
    product.images?.length > 0 ? true : null,
    product.tags?.length > 0 ? true : null,
    product.baseUnit,
    product.variants?.length > 0 ? true : null,
  ];
  const presentCount = recommended.filter(
    (v) => v !== null && v !== undefined && v !== ''
  ).length;

  let recBonus = 0;
  if (presentCount >= 8) {
    recBonus = 16;
  } else if (presentCount >= 6) {
    recBonus = 12;
  } else if (presentCount >= 4) {
    recBonus = 8;
  } else if (presentCount >= 2) {
    recBonus = 4;
  }
  if (recBonus > 0) signals.push(`recommended_${presentCount}_present +${recBonus}`);
  score += recBonus;

  // Custom attributes overflow
  const customCount = product.customAttributes
    ? Object.keys(product.customAttributes).length
    : 0;
  if (customCount <= 5) {
    score += 4;
    signals.push('custom_attrs_clean +4');
  } else if (customCount <= 15) {
    score += 2;
    signals.push('custom_attrs_moderate +2');
  }

  // Score started at 20 (base), added bonuses, subtracted penalties
  // But the max is 20 total — recalculate: start from 0, sum components
  // Actually, let me rethink: required penalty subtracts from base,
  // then recommended and custom add back. Clamp to 0–20.
  score = Math.max(0, Math.min(score, 20));
  return { score, max: 20, signals };
}

// ── PART 4 — Group 4: Detector Certainty (max 15) ──

function scoreGroup4_DetectorCertainty(product) {
  let score = 0;
  const signals = [];
  const action = product.matchResult?.action;

  if (action === 'CREATE') {
    score += 15;
    signals.push('action_CREATE +15');
    if (product.matchResult?.layerMatched === null) {
      score += 5;
      signals.push('exhaustive_no_match +5');
    }
  } else if (action === 'REVIEW' || action === 'MERGE') {
    score = 0;
    signals.push(`action_${action} → floor 0`);
  }
  // UPDATE and SKIP score 0

  score = Math.max(0, Math.min(score, 15));
  return { score, max: 15, signals };
}

// ── PART 5 — Group 5: Similarity Risk (max 0, min -30) ──

function scoreGroup5_SimilarityRisk(product) {
  let score = 0;
  const signals = [];
  const similar = product.invoiceRisk?.similarProducts || [];

  if (similar.length === 0) {
    return { score: 0, max: 0, min: -30, signals: ['no_similar_products'] };
  }

  // Find highest similarity score
  const highest = Math.max(...similar.map((s) => s.similarityScore || 0));

  if (highest >= 95) {
    score -= 25;
    signals.push('similarity>=95 -25');
  } else if (highest >= 90) {
    score -= 18;
    signals.push('similarity90-94 -18');
  } else if (highest >= 85) {
    score -= 12;
    signals.push('similarity85-89 -12');
  } else if (highest >= 80) {
    score -= 7;
    signals.push('similarity80-84 -7');
  } else if (highest >= 75) {
    score -= 3;
    signals.push('similarity75-79 -3');
  }

  // Additional stackable deductions
  if (similar.some((s) => s.openInvoiceCount > 0)) {
    score -= 5;
    signals.push('open_invoices -5');
  }
  if (similar.some((s) => s.sameCategory)) {
    score -= 3;
    signals.push('same_category -3');
  }
  if (similar.some((s) => s.sameBrand)) {
    score -= 2;
    signals.push('same_brand -2');
  }
  if (similar.some((s) => s.recentlyCreated)) {
    score -= 2;
    signals.push('recently_created -2');
  }

  score = Math.max(score, -30);
  return { score, max: 0, min: -30, signals };
}

// ── PART 5.5 — Group 6: Embedding Similarity (max 15) ──

/**
 * Only scores if the match came from the embedding layer.
 * This adds confidence signal but does NOT enable auto-approval
 * (the ApprovalClassifier blocks auto-approve for embedding matches).
 */
function scoreGroup6_EmbeddingSimilarity(product) {
  const signals = [];

  if (product.matchResult?.matchSource !== 'embedding' || !product.matchResult?.embeddingSimilarity) {
    return {
      score: 0,
      max: 15,
      signals: [{ factor: 'no_embedding_match', impact: 0, detail: 'Match did not come from embedding layer' }],
    };
  }

  const similarity = product.matchResult.embeddingSimilarity;
  let score = 0;

  if (similarity >= 0.95) {
    score = 15;
    signals.push({ factor: 'embedding_very_high', impact: 15, detail: `Cosine similarity ${similarity.toFixed(4)} (>= 0.95)` });
  } else if (similarity >= 0.90) {
    score = 12;
    signals.push({ factor: 'embedding_high', impact: 12, detail: `Cosine similarity ${similarity.toFixed(4)} (>= 0.90)` });
  } else if (similarity >= 0.85) {
    score = 9;
    signals.push({ factor: 'embedding_medium', impact: 9, detail: `Cosine similarity ${similarity.toFixed(4)} (>= 0.85)` });
  } else if (similarity >= 0.75) {
    score = 5;
    signals.push({ factor: 'embedding_low', impact: 5, detail: `Cosine similarity ${similarity.toFixed(4)} (>= 0.75)` });
  } else {
    score = 2;
    signals.push({ factor: 'embedding_weak', impact: 2, detail: `Cosine similarity ${similarity.toFixed(4)} (< 0.75)` });
  }

  // Note if multiple high-similarity candidates form a cluster
  const candidates = product.matchResult?.embeddingCandidates;
  if (candidates && candidates.length >= 3) {
    const avgTopSimilarity =
      candidates.slice(0, 3).reduce((sum, c) => sum + c.similarity, 0) / 3;
    if (avgTopSimilarity >= 0.85) {
      signals.push({
        factor: 'embedding_cluster',
        impact: 0,
        detail: `Top 3 candidates avg similarity ${avgTopSimilarity.toFixed(4)} — product is in a well-defined cluster`,
      });
    }
  }

  return { score, max: 15, signals };
}

// ── PART 6 — Composite score ──

function computeConfidenceScore(product, context, sourceHistory) {
  const g1 = scoreGroup1_IdentityStrength(product);
  const g2 = scoreGroup2_SourceTrustworthiness(product, context, sourceHistory);
  const g3 = scoreGroup3_DataCompleteness(product);
  const g4 = scoreGroup4_DetectorCertainty(product);
  const g5 = scoreGroup5_SimilarityRisk(product);
  const g6 = scoreGroup6_EmbeddingSimilarity(product);

  const rawScore = g1.score + g2.score + g3.score + g4.score + g5.score + g6.score;
  const finalScore = Math.max(0, Math.min(100, rawScore));

  return {
    score: finalScore,
    breakdown: {
      identityStrength: g1,
      sourceTrustworthiness: g2,
      dataCompleteness: g3,
      detectorCertainty: g4,
      similarityRisk: g5,
      embeddingSimilarity: g6,
      rawTotal: rawScore,
      finalScore,
      computedAt: new Date(),
    },
  };
}

// ── PART 7 — ConfidenceScorer stage class ──

class ConfidenceScorer extends PipelineStage {
  constructor() {
    super('confidence_scorer');
  }

  async process(product, context) {
    try {
      const sourceHistory = {
        isTrusted: context.stageData?.sourceTrusted || false,
        priorImportCount: context.stageData?.sourcePriorImports || 0,
        duplicateIncidents: context.stageData?.sourceDuplicateIncidents || 0,
        resolutionMethod: context.stageData?.sourceResolutionMethod || 'explicit',
      };

      const result = computeConfidenceScore(product, context, sourceHistory);

      product.confidenceScore = result.score;
      product.confidenceBreakdown = result.breakdown;

      this.log(
        `Confidence score: ${result.score}/100 ` +
        `(identity:${result.breakdown.identityStrength.score} ` +
        `source:${result.breakdown.sourceTrustworthiness.score} ` +
        `data:${result.breakdown.dataCompleteness.score} ` +
        `detector:${result.breakdown.detectorCertainty.score} ` +
        `risk:${result.breakdown.similarityRisk.score} ` +
        `embedding:${result.breakdown.embeddingSimilarity.score})`
      );
    } catch (err) {
      this.error('Confidence scoring failed', err);
      addWarning(
        product,
        this.name,
        `Confidence score error: ${err.message}`
      );
      product.confidenceScore = 0;
    }

    return product;
  }
}

export {
  computeConfidenceScore,
  scoreGroup1_IdentityStrength,
  scoreGroup2_SourceTrustworthiness,
  scoreGroup3_DataCompleteness,
  scoreGroup4_DetectorCertainty,
  scoreGroup5_SimilarityRisk,
  scoreGroup6_EmbeddingSimilarity,
  ConfidenceScorer,
};
export default ConfidenceScorer;
