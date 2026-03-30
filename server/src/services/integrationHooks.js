// server/src/services/integrationHooks.js
// Integration Hook Registry — post-creation handlers for source-specific follow-up.
//
// Integrations register a handler that runs after a product is created
// through the import pipeline. The handler receives the created product
// and the integrationMetadata from the CanonicalProduct.
//
// The pipeline calls executeHook() after product creation.
// If no hook is registered for the source, nothing happens.
// Hooks are fire-and-forget — failures never block the pipeline.

const hooks = new Map();

/**
 * Register a post-creation hook for a source system.
 *
 * @param {string} sourceSystem - e.g. 'shopify', 'woocommerce', 'lightspeed'
 * @param {Function} handler - async function(product, integrationMetadata, prisma)
 *   product: the created Product record (with id, tenantId, etc.)
 *   integrationMetadata: the opaque JSON blob from CanonicalProduct
 *   prisma: tenant-scoped Prisma client
 */
export function registerIntegrationHook(sourceSystem, handler) {
  hooks.set(sourceSystem.toLowerCase(), handler);
}

/**
 * Execute the post-creation hook for a product's source system.
 * Fire-and-forget — logs warnings on failure, never throws.
 *
 * @param {string} sourceSystem - the product's source system
 * @param {object} product - the created Product record
 * @param {object} integrationMetadata - from CanonicalProduct or ApprovalQueueEntry.normalizedData
 * @param {object} prisma - tenant-scoped Prisma client
 */
export async function executeHook(sourceSystem, product, integrationMetadata, prisma) {
  if (!sourceSystem || !integrationMetadata) return;

  const handler = hooks.get(sourceSystem.toLowerCase());
  if (!handler) return;

  try {
    await handler(product, integrationMetadata, prisma);
  } catch (err) {
    console.warn(`[IntegrationHook] ${sourceSystem} hook failed for product ${product.id}:`, err.message);
  }
}

/**
 * Check if a hook is registered for a source system.
 */
export function hasHook(sourceSystem) {
  return hooks.has(sourceSystem?.toLowerCase());
}

/**
 * Clear all registered hooks. Used in tests.
 */
export function clearHooks() {
  hooks.clear();
}
