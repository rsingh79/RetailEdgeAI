// server/src/services/shopifyPipelineAdapter.js
// Adapter that bridges Shopify product sync with the import pipeline.
// 1. shopifyToCanonical() — converts transformed Shopify products to CanonicalProduct format
// 2. processShopifyVariants() — post-creation hook that creates ProductVariant records

import { createCanonicalProduct } from './agents/pipeline/canonicalProduct.js';
import { registerIntegrationHook } from './integrationHooks.js';

// ── Shopify → CanonicalProduct transformer ──

/**
 * Convert a transformed Shopify product to CanonicalProduct format
 * for processing through the import pipeline.
 *
 * @param {object} shopifyProduct - Raw Shopify API product object
 * @param {object} transformed - Output of transformShopifyProduct()
 * @param {string} tenantId
 * @returns {object} CanonicalProduct
 */
export function shopifyToCanonical(shopifyProduct, transformed, tenantId) {
  const firstVariant = shopifyProduct.variants?.[0];

  return createCanonicalProduct({
    // Core product fields
    name: transformed.name,
    brand: shopifyProduct.vendor || null,
    category: transformed.category || shopifyProduct.product_type || null,
    barcode: transformed.barcode || null,

    // Pricing — from the first variant
    price: firstVariant ? (parseFloat(firstVariant.price) || 0) : null,
    currency: 'AUD',

    // Status
    status: 'ACTIVE',

    // Source provenance
    sourceSystem: 'shopify',
    externalId: String(shopifyProduct.id),

    // Integration metadata — Shopify variant data for post-creation hook.
    // The pipeline passes this through untouched.
    integrationMetadata: {
      shopifyProductId: shopifyProduct.id,
      shopifyHandle: shopifyProduct.handle,
      shopifyStoreName: null, // resolved by the hook at creation time
      variants: (shopifyProduct.variants || []).map((v) => ({
        shopifyVariantId: String(v.id),
        shopifyProductId: String(shopifyProduct.id),
        title: v.title === 'Default Title' ? null : v.title,
        sku: v.sku || `SHOPIFY-${v.id}`,
        barcode: v.barcode || null,
        price: parseFloat(v.price) || 0,
        compareAtPrice: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
        weight: v.weight || 0,
        weightUnit: v.weight_unit || 'kg',
      })),
    },
  });
}

// ── Post-creation variant hook ──

/**
 * Post-creation hook for Shopify products.
 * Called by the pipeline (WriteLayer) after a product is created
 * (auto-approved or manually approved).
 * Creates ProductVariant records with Shopify-specific fields.
 *
 * @param {object} product - The created Product record (has id, tenantId)
 * @param {object} metadata - The integrationMetadata from CanonicalProduct
 * @param {object} prisma - Tenant-scoped Prisma client
 */
async function processShopifyVariants(product, metadata, prisma) {
  if (!metadata?.variants || !Array.isArray(metadata.variants)) return;

  // Find or create the Shopify ECOMMERCE store (same pattern as syncProducts)
  let store = await prisma.store.findFirst({
    where: { type: 'ECOMMERCE', platform: 'Shopify' },
  });

  if (!store) {
    store = await prisma.store.create({
      data: {
        name: 'Shopify',
        type: 'ECOMMERCE',
        platform: 'Shopify',
      },
    });
  }

  for (const variant of metadata.variants) {
    // Weight conversion to kg (mirrors transformShopifyProduct logic)
    let unitQty = 1;
    if (variant.weight > 0 && variant.weightUnit) {
      switch (variant.weightUnit.toLowerCase()) {
        case 'g': unitQty = variant.weight / 1000; break;
        case 'lb': unitQty = variant.weight * 0.453592; break;
        case 'oz': unitQty = variant.weight * 0.0283495; break;
        default: unitQty = variant.weight; // kg
      }
      unitQty = Math.round(unitQty * 1000) / 1000;
    }

    const variantName = variant.title
      ? `${product.name} - ${variant.title}`
      : product.name;

    await prisma.productVariant.upsert({
      where: { storeId_sku: { storeId: store.id, sku: variant.sku } },
      create: {
        productId: product.id,
        storeId: store.id,
        sku: variant.sku,
        name: variantName,
        size: variant.title || null,
        unitQty,
        currentCost: variant.price,
        salePrice: variant.price,
        shopifyVariantId: variant.shopifyVariantId,
        shopifyProductId: variant.shopifyProductId,
        isActive: true,
      },
      update: {
        name: variantName,
        size: variant.title || null,
        unitQty,
        salePrice: variant.price,
        shopifyVariantId: variant.shopifyVariantId,
        shopifyProductId: variant.shopifyProductId,
        isActive: true,
      },
    });
  }

  console.log(
    `[Shopify Hook] Created/updated ${metadata.variants.length} variants for product ${product.id}`
  );
}

// Register the hook at module load time
registerIntegrationHook('shopify', processShopifyVariants);
