// server/src/services/agents/pipeline/stages/invoiceRiskAnalyser.js
// Invoice Risk Analyser — Stage H of the product import pipeline.
// Checks whether creating or updating a product could cause confusion
// during invoice matching by finding visually similar catalog products.

import PipelineStage from '../pipelineStage.js';
import { addWarning } from '../canonicalProduct.js';

// ── PART 1 — Token-based name similarity ──

function computeNameSimilarity(nameA, nameB) {
  if (!nameA || !nameB) return 0;
  const tokensA = nameA.toLowerCase().split(/[\s\W]+/).filter(Boolean);
  const tokensB = nameB.toLowerCase().split(/[\s\W]+/).filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setB = new Set(tokensB);
  const matching = tokensA.filter((t) => setB.has(t)).length;
  return Math.round((matching / Math.max(tokensA.length, tokensB.length)) * 100);
}

// ── PART 2 — Risk classification ──

function classifyInvoiceRisk(similarityScore, signals) {
  const { hasOpenInvoices, sameCategory, sameBrand } = signals;

  if (similarityScore >= 85 && hasOpenInvoices) return 'HIGH';
  if (similarityScore >= 85 && (sameCategory || sameBrand)) return 'HIGH';
  if (similarityScore >= 75 && hasOpenInvoices) return 'HIGH';
  if (similarityScore >= 85) return 'MEDIUM';
  if (similarityScore >= 75 && (sameCategory || sameBrand)) return 'MEDIUM';
  if (similarityScore >= 75) return 'LOW';
  return 'NONE';
}

// ── PART 3 — InvoiceRiskAnalyser stage class ──

class InvoiceRiskAnalyser extends PipelineStage {
  constructor() {
    super('invoice_risk_analyser');
  }

  async process(product, context) {
    // Skip if no DB access
    if (!context.prisma || !product.normalised?.name) {
      product.invoiceRisk.level = 'NONE';
      return product;
    }

    // Only run for CREATE and REVIEW actions
    const action = product.matchResult?.action;
    if (action === 'SKIP' || action === 'UPDATE') {
      product.invoiceRisk.level = 'NONE';
      return product;
    }

    try {
      // Step 1 — Find potentially similar existing products
      const nameTokens = product.normalised.name
        .split(' ')
        .filter(Boolean)
        .slice(0, 3);

      if (nameTokens.length === 0) {
        product.invoiceRisk.level = 'NONE';
        return product;
      }

      const candidates = await context.prisma.product.findMany({
        where: {
          archivedAt: null,
          OR: nameTokens.map((token) => ({
            name: { contains: token, mode: 'insensitive' },
          })),
          NOT: product.matchResult?.matchedProductId
            ? { id: product.matchResult.matchedProductId }
            : undefined,
        },
        select: {
          id: true,
          name: true,
          category: true,
          createdAt: true,
        },
        take: 50,
      });

      if (candidates.length === 0) {
        product.invoiceRisk.level = 'NONE';
        return product;
      }

      // Step 2 — Score each candidate
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const scoredCandidates = candidates
        .map((candidate) => {
          const similarity = computeNameSimilarity(
            product.normalised.name,
            candidate.name.toLowerCase()
          );
          return { candidate, similarity };
        })
        .filter(({ similarity }) => similarity >= 75);

      if (scoredCandidates.length === 0) {
        product.invoiceRisk.level = 'NONE';
        return product;
      }

      // Step 3 — For each high-similarity candidate, check open invoice exposure
      const similarProducts = [];
      let highestRisk = 'NONE';

      for (const { candidate, similarity } of scoredCandidates) {
        const openInvoiceCount = await context.prisma.invoiceLineMatch.count({
          where: {
            productId: candidate.id,
            invoice: {
              status: {
                in: ['PROCESSING', 'READY', 'IN_REVIEW'],
              },
            },
          },
        });

        const signals = {
          hasOpenInvoices: openInvoiceCount > 0,
          sameCategory: product.category === candidate.category,
          sameBrand: !!(
            product.sourceSystem &&
            candidate.source &&
            product.sourceSystem.toLowerCase() === candidate.source.toLowerCase()
          ),
          recentlyCreated: candidate.createdAt > thirtyDaysAgo,
        };

        const riskLevel = classifyInvoiceRisk(similarity, signals);

        similarProducts.push({
          productId: candidate.id,
          name: candidate.name,
          similarityScore: similarity,
          openInvoiceCount,
          invoiceRisk: riskLevel,
        });

        const riskOrder = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
        if (riskOrder[riskLevel] > riskOrder[highestRisk]) {
          highestRisk = riskLevel;
        }
      }

      similarProducts.sort((a, b) => b.similarityScore - a.similarityScore);

      product.invoiceRisk.level = highestRisk;
      product.invoiceRisk.similarProducts = similarProducts;

      if (highestRisk !== 'NONE') {
        const topMatch = similarProducts[0];
        product.invoiceRisk.explanation =
          `Product name is ${topMatch.similarityScore}% similar to ` +
          `"${topMatch.name}" which appears on ` +
          `${topMatch.openInvoiceCount} open invoice(s). ` +
          `Risk level: ${highestRisk}.`;

        this.warn(
          `Invoice risk ${highestRisk} — similar to ` +
          `"${topMatch.name}" (${topMatch.similarityScore}%)`
        );
      } else {
        this.log('Invoice risk: NONE');
      }
    } catch (err) {
      this.error('Invoice risk analysis failed', err);
      addWarning(
        product,
        this.name,
        `Invoice risk error: ${err.message}`
      );
      product.invoiceRisk.level = 'NONE';
    }

    return product;
  }
}

export { computeNameSimilarity, classifyInvoiceRisk, InvoiceRiskAnalyser };
export default InvoiceRiskAnalyser;
