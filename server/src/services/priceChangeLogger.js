/**
 * Price Change Audit Logger
 *
 * Utility service that other parts of the codebase call when modifying prices.
 * Accepts a tenant-scoped Prisma client and logs every price modification to
 * the PriceChangeLog table for trust and point-in-time pricing analysis.
 *
 * Design rules:
 *   - Never throws — wraps in try/catch and logs warnings on failure
 *   - Skips logging if oldPrice === newPrice (no actual change)
 *   - Validates inputs before writing
 */

const VALID_CHANGE_SOURCES = new Set([
  'shopify_sync',
  'manual_edit',
  'bulk_import',
  'invoice_processing',
  'invoice_correction',
  'approval_action',
  'ai_recommendation',
  'api',
]);

const VALID_PRICE_TYPES = new Set([
  'selling_price',
  'cost_price',
  'sale_price',
]);

/**
 * Log a price change to the PriceChangeLog table.
 *
 * @param {import('@prisma/client').PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.productId
 * @param {string} [params.variantId]
 * @param {string} params.priceType - 'selling_price' | 'cost_price' | 'sale_price'
 * @param {number|null} params.oldPrice - Price before the change (null if first-time set)
 * @param {number} params.newPrice - Price after the change
 * @param {string} params.changeSource - One of VALID_CHANGE_SOURCES
 * @param {string} [params.changedBy] - userId for manual changes
 * @param {string} [params.sourceRef] - External reference ID
 * @param {string} [params.reason] - Human-readable reason
 * @param {Object} [params.metadata] - Additional context
 */
export async function logPriceChange(prisma, {
  tenantId,
  productId,
  variantId = null,
  priceType,
  oldPrice = null,
  newPrice,
  changeSource,
  changedBy = null,
  sourceRef = null,
  reason = null,
  metadata = null,
}) {
  try {
    // Validate required fields
    if (!tenantId || !productId) {
      console.warn('[PriceChangeLogger] Missing tenantId or productId, skipping');
      return null;
    }

    if (!VALID_PRICE_TYPES.has(priceType)) {
      console.warn(`[PriceChangeLogger] Invalid priceType "${priceType}", skipping`);
      return null;
    }

    if (!VALID_CHANGE_SOURCES.has(changeSource)) {
      console.warn(`[PriceChangeLogger] Invalid changeSource "${changeSource}", skipping`);
      return null;
    }

    if (typeof newPrice !== 'number' || isNaN(newPrice)) {
      console.warn('[PriceChangeLogger] newPrice must be a valid number, skipping');
      return null;
    }

    // Skip if no actual change
    if (oldPrice !== null && oldPrice !== undefined && oldPrice === newPrice) {
      return null;
    }

    const entry = await prisma.priceChangeLog.create({
      data: {
        tenantId,
        productId,
        variantId,
        priceType,
        oldPrice: oldPrice ?? null,
        newPrice,
        changeSource,
        changedBy,
        sourceRef,
        reason,
        metadata: metadata ?? undefined,
      },
    });

    return entry;
  } catch (err) {
    console.warn('[PriceChangeLogger] Failed to log price change:', err.message);
    return null;
  }
}

export { VALID_CHANGE_SOURCES, VALID_PRICE_TYPES };
