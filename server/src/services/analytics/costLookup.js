/**
 * Cost-at-Time-of-Sale Lookup Service
 *
 * Queries PriceChangeLog to find the cost price that was active at the
 * time a sale occurred. Uses the "Latest Invoice Cost Applies Forward"
 * methodology: the most recent cost_price entry before the sale date wins.
 *
 * Cost data priority is handled naturally by timestamps:
 *   - Invoice-matched costs (changeSource = 'invoice_processing')
 *   - Catalog import costs (changeSource = 'bulk_import' | 'shopify_sync')
 * Whichever was logged most recently before the sale date is used.
 */

/**
 * Look up the cost price for a product at a specific point in time.
 *
 * @param {import('@prisma/client').PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {string} productId - The product to look up
 * @param {Date} saleDate - The date of the sale
 * @returns {Promise<number|null>} Cost price at that time, or null if no cost data
 */
export async function getCostAtTimeOfSale(prisma, productId, saleDate) {
  if (!productId || !saleDate) return null;

  const entry = await prisma.priceChangeLog.findFirst({
    where: {
      productId,
      priceType: 'cost_price',
      createdAt: { lte: saleDate },
    },
    orderBy: { createdAt: 'desc' },
    select: { newPrice: true },
  });

  return entry ? entry.newPrice : null;
}

/**
 * Batch lookup: get cost prices for multiple products at a given date.
 * More efficient than calling getCostAtTimeOfSale() in a loop for bulk imports.
 *
 * @param {import('@prisma/client').PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {Array<{productId: string, saleDate: Date}>} lookups - Products and dates to look up
 * @returns {Promise<Map<string, number|null>>} Map of productId → costPrice
 */
export async function batchGetCostAtTimeOfSale(prisma, lookups) {
  const results = new Map();
  if (!lookups || lookups.length === 0) return results;

  // Group by productId to avoid redundant queries
  const uniqueProducts = new Map();
  for (const { productId, saleDate } of lookups) {
    if (!productId) continue;
    // Keep the latest saleDate per product (for orders on the same date, cost is the same)
    const existing = uniqueProducts.get(productId);
    if (!existing || saleDate > existing) {
      uniqueProducts.set(productId, saleDate);
    }
  }

  // Query each product's cost (parallelized)
  const queries = [];
  for (const [productId, saleDate] of uniqueProducts) {
    queries.push(
      getCostAtTimeOfSale(prisma, productId, saleDate)
        .then((cost) => results.set(productId, cost))
    );
  }
  await Promise.all(queries);

  return results;
}

/**
 * Calculate margin fields for a sales line item.
 *
 * @param {number} unitPrice - Selling price per unit
 * @param {number|null} costPrice - Cost price per unit (null if unknown)
 * @returns {{ costPriceAtSale: number|null, marginAmount: number|null, marginPercent: number|null, costDataAvailable: boolean }}
 */
export function calculateMargin(unitPrice, costPrice) {
  if (costPrice === null || costPrice === undefined) {
    return {
      costPriceAtSale: null,
      marginAmount: null,
      marginPercent: null,
      costDataAvailable: false,
    };
  }

  const marginAmount = unitPrice - costPrice;
  const marginPercent = unitPrice > 0
    ? Math.round((marginAmount / unitPrice) * 10000) / 100 // 2 decimal places
    : null;

  return {
    costPriceAtSale: costPrice,
    marginAmount,
    marginPercent,
    costDataAvailable: true,
  };
}
