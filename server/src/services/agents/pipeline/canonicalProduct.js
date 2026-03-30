// server/src/services/agents/pipeline/canonicalProduct.js
// CanonicalProduct — the single internal data structure every pipeline stage
// works with after the ingestion layer. Pure JavaScript, no Prisma, no DB.

/**
 * Create a new CanonicalProduct with all fields set to safe defaults.
 * @param {object} overrides — fields to set on the new product
 * @returns {object} CanonicalProduct
 */
export function createCanonicalProduct(overrides = {}) {
  return {
    // Source Provenance (set by Source Resolver — never overwritten)
    sourceSystem: null,
    sourceIdentifier: null,
    sourceType: null,
    externalId: null,
    productImportedThrough: null,
    rawSourceData: null,

    // Import Job Context (set by Ingestion Layer)
    importJobId: null,
    importId: null,
    rowIndex: null,
    importedAt: null,

    // Fingerprinting (set by Fingerprint Engine)
    fingerprint: null,
    fingerprintTier: null,
    fingerprintComponents: null,

    // Core Product Fields
    name: null,
    sku: null,
    barcode: null,
    brand: null,
    description: null,
    shortDescription: null,
    category: null,
    productType: null,
    tags: [],
    status: 'ACTIVE',

    // Pricing
    price: null,
    compareAtPrice: null,
    costPrice: null,
    currency: 'AUD',

    // Inventory
    quantity: null,
    trackInventory: true,
    allowBackorder: false,

    // Physical
    weight: null,
    weightUnit: null,
    baseUnit: null,
    size: null,
    packSize: null,
    unitQty: 1,

    // Variants
    variants: [],

    // Media
    images: [],

    // Custom overflow — unmapped source fields land here
    customAttributes: {},

    // Integration-specific metadata — opaque JSON blob passed through untouched.
    // The pipeline never reads this. Stored in ApprovalQueueEntry.normalizedData
    // for queued products. Consumed by post-creation hooks after approval.
    integrationMetadata: null,

    // Match Results (set by Catalog Matcher)
    matchResult: {
      action: null,
      layerMatched: null,
      matchedProductId: null,
      matchedOn: [],
      matchScore: null,
      fieldDiff: {},
      crossSourceMatches: [],
    },

    // Confidence (set by Confidence Scorer)
    confidenceScore: null,
    confidenceBreakdown: null,

    // Invoice Risk (set by Invoice Risk Analyser)
    invoiceRisk: {
      level: 'NONE',
      explanation: null,
      similarProducts: [],
    },

    // Approval (set by Approval Classifier)
    approvalRoute: null,
    approvalReason: null,

    // Normalisation (set by Normalisation Engine)
    normalised: {
      name: null,
      brand: null,
      category: null,
      sku: null,
      barcode: null,
    },

    // Processing State
    errors: [],
    warnings: [],
    processingComplete: false,

    ...overrides,
  };
}

/**
 * Create a new CanonicalVariant with all fields set to safe defaults.
 * @param {object} overrides — fields to set on the new variant
 * @returns {object} CanonicalVariant
 */
export function createCanonicalVariant(overrides = {}) {
  return {
    externalId: null,
    sku: null,
    barcode: null,
    optionName: null,
    optionValue: null,
    price: null,
    costPrice: null,
    quantity: null,
    weight: null,
    size: null,
    isActive: true,
    ...overrides,
  };
}

/**
 * Push an error onto a product's errors array.
 * @returns {object} The product (for chaining)
 */
export function addError(product, stage, message, fatal = false) {
  product.errors.push({ stage, message, fatal, timestamp: new Date() });
  return product;
}

/**
 * Push a warning onto a product's warnings array.
 * @returns {object} The product (for chaining)
 */
export function addWarning(product, stage, message) {
  product.warnings.push({ stage, message, timestamp: new Date() });
  return product;
}

/**
 * Returns true if any error in product.errors has fatal: true.
 */
export function hasFatalError(product) {
  return product.errors.some((e) => e.fatal === true);
}

/**
 * Returns true if the product is ready to be written to the database.
 */
export function isReadyToWrite(product) {
  if (typeof product.name !== 'string' || product.name.length === 0) return false;
  if (product.price === null || typeof product.price !== 'number') return false;
  if (typeof product.currency !== 'string' || product.currency.length === 0) return false;
  if (typeof product.status !== 'string' || product.status.length === 0) return false;
  if (hasFatalError(product)) return false;
  if (product.approvalRoute === 'ROUTE_AUTO') return true;
  if (product.approvalRoute && product.approvalStatus === 'APPROVED') return true;
  return false;
}
