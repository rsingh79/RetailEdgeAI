// server/src/services/agents/pipeline/stages/approvalClassifier.js
// Approval Classifier — Stage J of the product import pipeline.
// Assigns every product to exactly one approval route based on
// confidence score, invoice risk, match result, and source trust.

import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';

// ── PART 1 — Classification logic ──

function classifyProduct(product, context) {
  const matchResult = product.matchResult || {};
  const invoiceRisk = product.invoiceRisk || {};
  const stageData = context.stageData || {};

  const priorImports =
    context.stageData.sourcePriorImports || 0;
  const isTrusted =
    context.stageData.sourceTrusted || false;
  const catalogIsEmpty =
    context.stageData.catalogProductCount === 0;
  const autoApproveThreshold =
    context.stageData.autoApproveThreshold || 95;
  const protectedCategories =
    context.stageData.protectedCategories ||
    ['services', 'subscriptions'];

  // Rule 1 — SKIP → ROUTE_REJECT
  if (matchResult.action === 'SKIP') {
    return {
      route: 'ROUTE_REJECT',
      reason: 'Exact duplicate — identical product already exists',
    };
  }

  // Rule 2 — MERGE → ROUTE_REVIEW
  if (matchResult.action === 'MERGE') {
    return {
      route: 'ROUTE_REVIEW',
      reason: 'Cross-source duplicate — human must decide merge strategy',
    };
  }

  // Rule 3 — UPDATE → ROUTE_REVIEW
  if (matchResult.action === 'UPDATE') {
    return {
      route: 'ROUTE_REVIEW',
      reason: 'Existing product fields would change — review diff before update',
    };
  }

  // Rule 4 — REVIEW from matcher → ROUTE_REVIEW
  if (matchResult.action === 'REVIEW') {
    return {
      route: 'ROUTE_REVIEW',
      reason: `Fuzzy match found (${matchResult.matchScore}% similar) — confirm this is a new product`,
    };
  }

  // Rule 5 — HIGH invoice risk → ROUTE_REVIEW
  if (invoiceRisk.level === 'HIGH') {
    return {
      route: 'ROUTE_REVIEW',
      reason: invoiceRisk.explanation ||
        'High invoice matching risk — similar product on open invoices',
    };
  }

  // Rule 6 — Missing required fields → ROUTE_REVIEW
  const hasName = typeof product.name === 'string' && product.name.length > 0;
  const hasPrice = product.price !== null || product.sellingPrice !== null;
  if (!hasName || !hasPrice) {
    return {
      route: 'ROUTE_REVIEW',
      reason: 'Required fields missing — product cannot be created without review',
    };
  }

  // RULE 7 — First import + weak identity
  // Block only when: no barcode AND no externalId AND no strong fingerprint
  // AND catalog already has products.
  // If catalog is empty there is nothing to duplicate
  // against so proceed to the confidence gate.
  // T1/T2 fingerprints carry enough identity to skip this gate.
  if (priorImports === 0) {
    const hasBarcode    = !!(product.barcode);
    const hasExternalId = !!(product.externalId);
    const hasStrongFingerprint =
      product.fingerprintTier != null && product.fingerprintTier <= 2;
    if (!hasBarcode && !hasExternalId && !hasStrongFingerprint && !catalogIsEmpty) {
      return {
        route: 'ROUTE_REVIEW',
        reason:
          'First import — no barcode, no SKU, and catalog ' +
          'already has products. Cannot safely confirm ' +
          'this is not a duplicate.',
      };
    }
  }

  // RULE 8 — AUTO-APPROVE gate
  {
    const hasBarcode    = !!(product.barcode);
    const hasExternalId = !!(product.externalId);

    let effectiveThreshold;
    const hasStrongFingerprint =
      product.fingerprintTier != null && product.fingerprintTier <= 2;
    if (hasBarcode) {
      effectiveThreshold = isTrusted ? 70 : 80;
    } else if (hasExternalId) {
      effectiveThreshold = isTrusted ? 72 : 82;
    } else if (hasStrongFingerprint) {
      effectiveThreshold = isTrusted ? 75 : 85;
    } else if (catalogIsEmpty) {
      effectiveThreshold = isTrusted ? 50 : 60;
    } else {
      effectiveThreshold = 95;
    }

    const isProtected = protectedCategories
      .some(cat => cat.toLowerCase() === (product.category || '').toLowerCase());

    // Embedding matches are probabilistic — always route to review
    const isEmbeddingMatch = product.matchResult?.matchSource === 'embedding';

    if (
      product.confidenceScore >= effectiveThreshold &&
      product.matchResult?.action === 'CREATE' &&
      product.invoiceRisk?.level === 'NONE' &&
      hasName &&
      hasPrice &&
      !isProtected &&
      !isEmbeddingMatch
    ) {
      return {
        route: 'ROUTE_AUTO',
        reason:
          `Auto-approved — confidence ` +
          `${product.confidenceScore}/100, ` +
          (hasBarcode    ? 'barcode identity, ' :
           hasExternalId ? 'SKU identity, '    :
           'empty catalog, ') +
          `no invoice risk`,
      };
    }
  }

  // Rule 9 — Default → ROUTE_REVIEW
  return {
    route: 'ROUTE_REVIEW',
    reason: `Confidence score ${product.confidenceScore}/100 below threshold or conditions not met`,
  };
}

// ── PART 2 — ApprovalClassifier stage class ──

class ApprovalClassifier extends PipelineStage {
  constructor() {
    super('approval_classifier');
  }

  async process(product, context) {
    try {
      const { route, reason } = classifyProduct(product, context);

      product.approvalRoute = route;
      product.approvalReason = reason;

      this.log(`Route: ${route} — ${reason}`);
    } catch (err) {
      this.error('Approval classification failed', err);
      addWarning(
        product,
        this.name,
        `Classification error: ${err.message}`
      );
      product.approvalRoute = 'ROUTE_REVIEW';
      product.approvalReason =
        `Classification error — defaulting to review: ${err.message}`;
    }

    return product;
  }
}

export { classifyProduct, ApprovalClassifier };
export default ApprovalClassifier;
