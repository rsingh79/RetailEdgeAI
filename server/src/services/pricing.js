/**
 * Pricing calculation service.
 *
 * Finds the most specific applicable PricingRule and calculates a suggested
 * sale price based on the new cost, target margin, rounding strategy, and
 * price-jump / minimum-margin constraints.
 */

// ── Rounding helpers ──────────────────────────────────────────

function roundTo99(price) {
  return Math.ceil(price) - 0.01;
}

function roundTo49or99(price) {
  const floor = Math.floor(price);
  const diff49 = Math.abs(price - (floor + 0.49));
  const diff99 = Math.abs(price - (floor + 0.99));
  return diff49 < diff99 ? floor + 0.49 : floor + 0.99;
}

function roundNearest5(price) {
  return Math.round(price * 20) / 20;
}

function applyRounding(price, strategy) {
  if (!strategy) return Math.round(price * 100) / 100;
  switch (strategy) {
    case '.99':
      return roundTo99(price);
    case '.49/.99':
      return roundTo49or99(price);
    case 'nearest_5':
      return roundNearest5(price);
    default:
      return Math.round(price * 100) / 100;
  }
}

// Exported for unit testing
export { roundTo99, roundTo49or99, roundNearest5, applyRounding };

// ── Main pricing function ─────────────────────────────────────

/**
 * Calculate a suggested sale price for a product variant given a new cost.
 *
 * Rule precedence (most specific wins):
 *   PRODUCT > SUPPLIER > CATEGORY > GLOBAL
 *
 * @param {PrismaClient} prisma — tenant-scoped
 * @param {{ currentCost: number, salePrice: number, productId: string }} variant
 * @param {number} newCost
 * @param {{ category?: string }} product
 * @param {string|null} supplierId
 * @returns {Promise<number>} suggested price
 */
export async function calculateSuggestedPrice(prisma, variant, newCost, product, supplierId) {
  const rules = await prisma.pricingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'desc' },
  });

  // Find most specific rule
  const rule =
    rules.find((r) => r.scope === 'PRODUCT' && r.scopeValue === variant.productId) ||
    (supplierId && rules.find((r) => r.scope === 'SUPPLIER' && r.scopeValue === supplierId)) ||
    (product?.category && rules.find((r) => r.scope === 'CATEGORY' && r.scopeValue === product.category)) ||
    rules.find((r) => r.scope === 'GLOBAL') ||
    null;

  if (!rule || rule.targetMargin == null) {
    // No applicable rule — keep the current sale price
    return variant.salePrice || newCost * 1.5; // fallback 50% markup if no price
  }

  let suggested = newCost / (1 - rule.targetMargin);
  suggested = applyRounding(suggested, rule.roundingStrategy);

  // Enforce maxPriceJump constraint
  if (rule.maxPriceJump != null && variant.salePrice > 0) {
    const maxPrice = variant.salePrice * (1 + rule.maxPriceJump);
    if (suggested > maxPrice) {
      suggested = applyRounding(maxPrice, rule.roundingStrategy);
    }
  }

  // Enforce minMargin floor
  if (rule.minMargin != null) {
    const margin = (suggested - newCost) / suggested;
    if (margin < rule.minMargin) {
      suggested = newCost / (1 - rule.minMargin);
      suggested = applyRounding(suggested, rule.roundingStrategy);
    }
  }

  return suggested;
}
