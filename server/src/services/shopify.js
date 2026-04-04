/**
 * Shopify OAuth + Admin API integration service.
 *
 * Follows the Gmail integration pattern (services/gmail.js):
 * - OAuth authorization code grant flow
 * - HMAC validation on callbacks
 * - Encrypted token storage via lib/encryption.js
 * - Product sync via Shopify Admin REST API
 */

import crypto from 'crypto';
import { encrypt, decrypt } from '../lib/encryption.js';
import basePrisma, { createTenantClient } from '../lib/prisma.js';
import { fuzzyNameScore } from './matching.js';
import { getCostAtTimeOfSale, calculateMargin } from './analytics/costLookup.js';
import { embedProduct } from './ai/embeddingMaintenance.js';
import { shopifyToCanonical } from './shopifyPipelineAdapter.js';
import { createImportJob, runImportPipeline } from './importJobService.js';
import { normalizeSource } from './sourceNormalizer.js';

// Side-effect import: registers the 'shopify' integration hook at module load
import './shopifyPipelineAdapter.js';

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const SHOPIFY_SCOPES = 'read_products,write_products,read_orders,read_customers';

// ── Helpers ──────────────────────────────────────────────────

/**
 * Normalize shop input to full myshopify.com domain.
 * Accepts: "mystore", "mystore.myshopify.com", "https://mystore.myshopify.com"
 */
export function normalizeShop(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Shop domain is required');
  }

  let shop = input.trim().toLowerCase();

  // Strip protocol
  shop = shop.replace(/^https?:\/\//, '');
  // Strip trailing slash
  shop = shop.replace(/\/+$/, '');
  // Strip /admin or /admin/... suffix
  shop = shop.replace(/\/admin.*$/, '');

  // If it doesn't end with .myshopify.com, append it
  if (!shop.endsWith('.myshopify.com')) {
    // Validate: shop name must be alphanumeric + hyphens only
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(shop)) {
      throw new Error('Invalid shop name. Use your myshopify.com subdomain (e.g. "mystore")');
    }
    shop = `${shop}.myshopify.com`;
  }

  // Final validation: must match pattern
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error('Invalid shop domain. Expected format: mystore.myshopify.com');
  }

  return shop;
}

/**
 * Sign a state parameter with HMAC-SHA256.
 * State = "tenantId:hmac" — allows us to verify the callback is legitimate.
 */
function signState(tenantId) {
  const hmac = crypto
    .createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(tenantId)
    .digest('hex');
  return `${tenantId}:${hmac}`;
}

/**
 * Verify and extract tenantId from a signed state parameter.
 * Returns tenantId if valid, throws if tampered.
 */
export function validateState(state) {
  if (!state || !state.includes(':')) {
    throw new Error('Invalid state parameter');
  }

  const colonIdx = state.indexOf(':');
  const tenantId = state.substring(0, colonIdx);
  const providedHmac = state.substring(colonIdx + 1);

  const expectedHmac = crypto
    .createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(tenantId)
    .digest('hex');

  const a = Buffer.from(providedHmac, 'hex');
  const b = Buffer.from(expectedHmac, 'hex');

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('State HMAC verification failed — possible CSRF attack');
  }

  return tenantId;
}

/**
 * Validate Shopify's HMAC on callback query parameters.
 * Shopify signs all callback params with the app's client secret.
 */
export function validateHmac(query) {
  const { hmac, ...params } = query;
  if (!hmac) return false;

  // Build message from sorted params (excluding hmac and signature)
  const entries = Object.entries(params)
    .filter(([key]) => key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b));

  const message = entries.map(([k, v]) => `${k}=${v}`).join('&');

  const computed = crypto
    .createHmac('sha256', SHOPIFY_CLIENT_SECRET)
    .update(message)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hmac, 'hex'),
      Buffer.from(computed, 'hex')
    );
  } catch {
    return false;
  }
}

// ── OAuth Flow ───────────────────────────────────────────────

/**
 * Build the Shopify OAuth authorization URL.
 * The tenant clicks this to start the consent flow.
 */
export function buildAuthUrl(shop, tenantId) {
  const normalizedShop = normalizeShop(shop);
  const state = signState(tenantId);

  const params = new URLSearchParams({
    client_id: SHOPIFY_CLIENT_ID,
    scope: SHOPIFY_SCOPES,
    redirect_uri: SHOPIFY_REDIRECT_URI,
    state,
  });

  return {
    url: `https://${normalizedShop}/admin/oauth/authorize?${params.toString()}`,
    shop: normalizedShop,
  };
}

/**
 * Exchange the authorization code for a permanent access token.
 * Shopify offline tokens do not expire — no refresh flow needed.
 */
export async function exchangeCodeForToken(shop, code) {
  const url = `https://${shop}/admin/oauth/access_token`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    scope: data.scope,
  };
}

/**
 * Handle the full OAuth callback.
 * Validates HMAC + state, exchanges code for token, encrypts + stores.
 * Uses basePrisma (no JWT context on callback redirect).
 */
export async function handleOAuthCallback(query) {
  const { code, shop, state } = query;

  // 1. Validate Shopify HMAC
  if (!validateHmac(query)) {
    throw new Error('HMAC validation failed — request may not be from Shopify');
  }

  // 2. Validate + extract tenantId from state
  const tenantId = validateState(state);

  // 3. Exchange code for permanent access token
  const { accessToken, scope } = await exchangeCodeForToken(shop, code);

  // 4. Encrypt the access token
  const accessTokenEnc = encrypt(accessToken);

  // 5. Upsert ShopifyIntegration record
  const tenantPrisma = createTenantClient(tenantId);
  await tenantPrisma.shopifyIntegration.upsert({
    where: { tenantId },
    create: {
      tenantId,
      shop,
      accessTokenEnc,
      scopes: scope || SHOPIFY_SCOPES,
      isActive: true,
    },
    update: {
      shop,
      accessTokenEnc,
      scopes: scope || SHOPIFY_SCOPES,
      isActive: true,
    },
  });

  // 6. Ensure an ECOMMERCE store exists for Shopify (reuse shopifyImport pattern)
  const existingStore = await tenantPrisma.store.findFirst({
    where: { tenantId, type: 'ECOMMERCE', platform: 'Shopify' },
  });
  if (!existingStore) {
    await tenantPrisma.store.create({
      data: {
        tenantId,
        name: `Shopify — ${shop.replace('.myshopify.com', '')}`,
        type: 'ECOMMERCE',
        platform: 'Shopify',
      },
    });
  }

  console.log(`Shopify connected for tenant ${tenantId}: ${shop}`);
  return { tenantId, shop };
}

// ── Shopify Admin API Client ─────────────────────────────────

/**
 * Make an authenticated request to the Shopify Admin REST API.
 * Handles rate limiting with automatic retry.
 */
export async function shopifyFetch(shop, accessToken, endpoint, options = {}) {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/${endpoint}`;
  const { method = 'GET', body, maxRetries = 3 } = options;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Handle rate limiting (leaky bucket)
    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get('Retry-After') || '2');
      console.warn(`Shopify rate limited — retrying in ${retryAfter}s (attempt ${attempt}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify API error ${res.status}: ${text}`);
    }

    return res;
  }

  throw new Error('Shopify API: max retries exceeded due to rate limiting');
}

/**
 * Parse Shopify's Link header for pagination.
 * Returns the URL for the next page, or null if none.
 */
function parseNextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/**
 * Fetch all products from Shopify (paginated, max 10 pages = 2500 products).
 */
export async function fetchProducts(shop, accessToken) {
  const allProducts = [];
  let endpoint = 'products.json?limit=250&status=active';
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const res = await shopifyFetch(shop, accessToken, endpoint);
    const data = await res.json();
    allProducts.push(...(data.products || []));

    // Check for next page via Link header
    const nextUrl = parseNextPageUrl(res.headers.get('Link'));
    if (!nextUrl) break;

    // Extract the path after /admin/api/version/
    const urlObj = new URL(nextUrl);
    endpoint = urlObj.pathname.replace(`/admin/api/${SHOPIFY_API_VERSION}/`, '') + urlObj.search;
  }

  return allProducts;
}

/**
 * Fetch store locations from Shopify.
 */
export async function fetchLocations(shop, accessToken) {
  const res = await shopifyFetch(shop, accessToken, 'locations.json');
  const data = await res.json();
  return data.locations || [];
}

// ── Product Sync ─────────────────────────────────────────────

/**
 * Transform a Shopify product JSON into our internal product format.
 */
function transformShopifyProduct(shopifyProduct) {
  const handle = shopifyProduct.handle || '';
  const name = shopifyProduct.title || handle;
  const category = shopifyProduct.product_type || null;
  const barcode = shopifyProduct.variants?.[0]?.barcode || null;

  const variants = (shopifyProduct.variants || []).map((v) => {
    const sku = v.sku || `SHOPIFY-${v.id}`;
    const size = v.title !== 'Default Title' ? v.title : null;
    const weight = v.weight || 0;
    const weightUnit = v.weight_unit || 'kg';

    // Convert weight to kg for unitQty
    let unitQty = 1;
    if (weight > 0) {
      switch (weightUnit) {
        case 'g': unitQty = weight / 1000; break;
        case 'lb': unitQty = weight * 0.453592; break;
        case 'oz': unitQty = weight * 0.0283495; break;
        default: unitQty = weight; // kg
      }
      unitQty = Math.round(unitQty * 1000) / 1000;
    }

    return {
      sku,
      name: size && size !== 'Default Title' ? `${name} - ${size}` : name,
      size,
      unitQty,
      currentCost: parseFloat(v.price) || 0, // Shopify cost comes from inventory_item, fallback to 0
      salePrice: parseFloat(v.price) || 0,
      shopifyVariantId: String(v.id),
      shopifyProductId: String(shopifyProduct.id),
      barcode: v.barcode || null,
    };
  });

  return {
    name,
    category,
    barcode,
    source: normalizeSource('Shopify'),
    handle,
    shopifyProductId: String(shopifyProduct.id),
    variants,
  };
}

/**
 * Full product sync: fetch from Shopify API → upsert into RetailEdge DB.
 *
 * Phase 1 — Identity matches (safe to auto-apply):
 *   1. shopifyVariantId stored on ProductVariant (exact Shopify ID match)
 *   2. Barcode match on Product (catches manual CSV imports from Shopify)
 *   Products matched by identity are updated immediately with variant processing.
 *
 * Phase 2 — Unmatched products routed through the import pipeline:
 *   CatalogMatcher (source-aware name + Fuse.js + embedding) → ConfidenceScorer
 *   → ApprovalClassifier → auto-approved or queued for human review.
 *   Shopify variant data stored in integrationMetadata, processed by the
 *   post-creation hook after product creation.
 *
 * Returns sync stats and creates a ShopifyImportLog.
 */
export async function syncProducts(prisma, tenantId) {
  const startTime = Date.now();
  const stats = {
    productsPulled: 0,
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    productsPipelined: 0,
    productsAutoApproved: 0,
    productsQueuedForReview: 0,
    errors: [],
  };

  // 1. Get integration + decrypt token (use tenant-scoped prisma for RLS compat)
  const integration = await prisma.shopifyIntegration.findUnique({
    where: { tenantId },
  });
  if (!integration || !integration.accessTokenEnc) {
    throw new Error('Shopify not connected. Please connect your Shopify store first.');
  }
  if (!integration.isActive) {
    throw new Error('Shopify integration is paused.');
  }

  const accessToken = decrypt(integration.accessTokenEnc);

  // 2. Fetch all products from Shopify
  const shopifyProducts = await fetchProducts(integration.shop, accessToken);
  stats.productsPulled = shopifyProducts.length;

  if (shopifyProducts.length === 0) {
    await createShopifyImportLog(tenantId, stats, startTime, 'products');
    return stats;
  }

  // 3. Find or create the Shopify ECOMMERCE store
  let store = await prisma.store.findFirst({
    where: { type: 'ECOMMERCE', platform: 'Shopify' },
  });
  if (!store) {
    store = await prisma.store.create({
      data: {
        name: `Shopify — ${integration.shop.replace('.myshopify.com', '')}`,
        type: 'ECOMMERCE',
        platform: 'Shopify',
      },
    });
  }

  // ── Phase 1: Identity matches (layers 1-2) ──────────────────
  const matched = [];
  const unmatched = [];

  for (const shopifyProduct of shopifyProducts) {
    try {
      const transformed = transformShopifyProduct(shopifyProduct);

      // Layer 1: shopifyVariantId match (exact Shopify ID on ProductVariant)
      let product = null;
      const shopifyVariantIds = transformed.variants.map((v) => v.shopifyVariantId).filter(Boolean);
      if (shopifyVariantIds.length > 0) {
        const existingVariant = await prisma.productVariant.findFirst({
          where: { shopifyVariantId: { in: shopifyVariantIds } },
          include: { product: true },
        });
        if (existingVariant) product = existingVariant.product;
      }

      // Layer 2: barcode match (covers manual Shopify CSV imports)
      if (!product && transformed.barcode) {
        product = await prisma.product.findFirst({
          where: { barcode: transformed.barcode, archivedAt: null },
        });
      }

      if (product) {
        const isSameSource = product.source === 'Shopify' ||
          product.source?.toLowerCase() === 'shopify';

        if (isSameSource) {
          // Same source — update existing product (do NOT overwrite source)
          product = await prisma.product.update({
            where: { id: product.id },
            data: {
              category: transformed.category || product.category,
              barcode: transformed.barcode || product.barcode,
            },
          });
          embedProduct({ id: product.id, name: product.name, category: product.category, tenantId }).catch(() => {});
          stats.productsUpdated++;

          // Upsert variants on the existing product
          for (const v of transformed.variants) {
            await prisma.productVariant.upsert({
              where: { storeId_sku: { storeId: store.id, sku: v.sku } },
              create: {
                productId: product.id,
                storeId: store.id,
                sku: v.sku,
                name: v.name,
                size: v.size,
                unitQty: v.unitQty,
                currentCost: v.currentCost,
                salePrice: v.salePrice,
                shopifyVariantId: v.shopifyVariantId,
                shopifyProductId: v.shopifyProductId,
                isActive: true,
              },
              update: {
                name: v.name,
                size: v.size,
                unitQty: v.unitQty,
                salePrice: v.salePrice,
                shopifyVariantId: v.shopifyVariantId,
                shopifyProductId: v.shopifyProductId,
                isActive: true,
              },
            });
            stats.variantsCreated++;
          }

          matched.push({ shopifyProduct, transformed, localProduct: product });
        } else {
          // Different source — create new Shopify product with canonical link
          const newProduct = await prisma.product.create({
            data: {
              tenantId,
              name: transformed.name,
              category: transformed.category || null,
              barcode: transformed.barcode || null,
              source: normalizeSource('Shopify'),
              externalId: String(shopifyProduct.id),
              canonicalProductId: product.id,
              lastSyncedAt: new Date(),
            },
          });
          embedProduct({ id: newProduct.id, name: newProduct.name, category: newProduct.category, tenantId }).catch(() => {});

          // Process variants on the NEW product
          for (const v of transformed.variants) {
            await prisma.productVariant.upsert({
              where: { storeId_sku: { storeId: store.id, sku: v.sku } },
              create: {
                productId: newProduct.id,
                storeId: store.id,
                sku: v.sku,
                name: v.name,
                size: v.size,
                unitQty: v.unitQty,
                currentCost: v.currentCost,
                salePrice: v.salePrice,
                shopifyVariantId: v.shopifyVariantId,
                shopifyProductId: v.shopifyProductId,
                isActive: true,
              },
              update: {
                name: v.name,
                size: v.size,
                unitQty: v.unitQty,
                salePrice: v.salePrice,
                shopifyVariantId: v.shopifyVariantId,
                shopifyProductId: v.shopifyProductId,
                isActive: true,
              },
            });
            stats.variantsCreated++;
          }

          console.log(`[Shopify Sync] Cross-source barcode match: created Shopify product ${newProduct.id} linked to ${product.source} product ${product.id}`);
          stats.productsCreated++;
          matched.push({ shopifyProduct, transformed, localProduct: newProduct });
        }
      } else {
        // No identity match — route through pipeline in Phase 2
        unmatched.push({ shopifyProduct, transformed });
      }
    } catch (err) {
      stats.errors.push({ product: shopifyProduct.title, error: err.message });
    }
  }

  // ── Phase 2: Route unmatched through import pipeline ─────────
  if (unmatched.length > 0) {
    console.log(
      `[Shopify Sync] ${matched.length} products matched by identity. ` +
      `${unmatched.length} routing through import pipeline.`
    );

    try {
      // Create an ImportJob for this sync run
      const importJob = await createImportJob({
        tenantId,
        sourceType: 'SHOPIFY_SYNC',
        sourceName: integration.shop,
        fileName: `shopify-sync-${new Date().toISOString()}`,
        totalRows: unmatched.length,
      }, prisma);

      // Convert unmatched Shopify products to CanonicalProduct format
      const canonicalProducts = unmatched.map(({ shopifyProduct, transformed }, i) => {
        const cp = shopifyToCanonical(shopifyProduct, transformed, tenantId);
        cp.rowIndex = i;
        cp.importJobId = importJob.id;
        return cp;
      });

      // Run through the import pipeline
      const pipelineResult = await runImportPipeline({
        importJobId: importJob.id,
        products: canonicalProducts,
        tenantId,
        prisma,
        dryRun: false,
        sourceType: 'SHOPIFY_SYNC',
        sourceName: integration.shop,
        syncMode: 'FULL',
      });

      stats.productsPipelined = unmatched.length;
      stats.productsAutoApproved = pipelineResult.rowsCreated || 0;
      stats.productsQueuedForReview = pipelineResult.rowsPendingApproval || 0;
      stats.productsCreated += pipelineResult.rowsCreated || 0;
      stats.productsUpdated += pipelineResult.rowsUpdated || 0;

      console.log(
        `[Shopify Sync] Pipeline result: ${pipelineResult.rowsCreated} auto-approved, ` +
        `${pipelineResult.rowsPendingApproval} queued for review, ` +
        `${pipelineResult.rowsSkipped} skipped`
      );
    } catch (err) {
      console.error('[Shopify Sync] Pipeline failed:', err.message);
      stats.errors.push({ product: 'pipeline', error: err.message });
    }
  }

  // 5. Update integration metadata
  const tenantPrismaSync = createTenantClient(tenantId);
  await tenantPrismaSync.shopifyIntegration.update({
    where: { tenantId },
    data: {
      lastSyncAt: new Date(),
      productCount: stats.productsCreated + stats.productsUpdated,
    },
  });

  // 6. Create import log
  await createShopifyImportLog(tenantId, stats, startTime, 'products');

  return stats;
}

async function createShopifyImportLog(tenantId, stats, startTime, syncType = 'products') {
  const durationMs = Date.now() - startTime;
  const totalCreated = (stats.productsCreated || 0) + (stats.ordersCreated || 0);
  const totalUpdated = (stats.productsUpdated || 0) + (stats.ordersUpdated || 0);
  const status = stats.errors.length > 0
    ? (totalCreated + totalUpdated > 0 ? 'partial' : 'failed')
    : 'success';

  const tenantPrisma = createTenantClient(tenantId);
  await tenantPrisma.shopifyImportLog.create({
    data: {
      tenantId,
      status,
      syncType,
      productsPulled: stats.productsPulled || 0,
      productsCreated: stats.productsCreated || 0,
      productsUpdated: stats.productsUpdated || 0,
      variantsCreated: stats.variantsCreated || 0,
      ordersPulled: stats.ordersPulled || 0,
      ordersCreated: stats.ordersCreated || 0,
      ordersUpdated: stats.ordersUpdated || 0,
      errors: stats.errors.length > 0 ? stats.errors : undefined,
      durationMs,
    },
  });
}

// ── Price Push (stub for future use) ─────────────────────────

/**
 * Push a price update to a Shopify variant.
 * @param {string} shop - Shopify shop domain
 * @param {string} accessToken - Decrypted access token
 * @param {string} variantId - Shopify variant ID
 * @param {number} price - New sale price
 * @param {number} [cost] - New cost (if available)
 */
export async function pushPriceUpdate(shop, accessToken, variantId, price, cost) {
  const body = { variant: { id: variantId, price: String(price) } };
  if (cost !== undefined) {
    body.variant.cost = String(cost);
  }

  const res = await shopifyFetch(shop, accessToken, `variants/${variantId}.json`, {
    method: 'PUT',
    body,
  });

  return res.json();
}

// ── Orders Sync ───────────────────────────────────────────────

/**
 * Map Shopify financial_status to canonical sales transaction status.
 */
function mapFinancialStatus(shopifyStatus) {
  const mapping = {
    paid: 'completed',
    partially_paid: 'completed',
    authorized: 'completed',
    pending: 'completed',
    refunded: 'refunded',
    partially_refunded: 'partially_refunded',
    voided: 'cancelled',
  };
  return mapping[shopifyStatus] || 'completed';
}

/**
 * Fetch all orders from Shopify since a given date (paginated, max 20 pages = 5000 orders).
 * @param {string} shop - Shopify shop domain
 * @param {string} accessToken - Decrypted access token
 * @param {Date|null} sinceDate - Only fetch orders created after this date (null = all time)
 */
export async function fetchOrders(shop, accessToken, sinceDate = null) {
  const allOrders = [];
  const params = new URLSearchParams({ limit: '250', status: 'any' });
  if (sinceDate) {
    params.set('created_at_min', sinceDate.toISOString());
  }
  let endpoint = `orders.json?${params.toString()}`;
  const maxPages = 20;

  for (let page = 0; page < maxPages; page++) {
    const res = await shopifyFetch(shop, accessToken, endpoint);
    const data = await res.json();
    allOrders.push(...(data.orders || []));

    const nextUrl = parseNextPageUrl(res.headers.get('Link'));
    if (!nextUrl) break;

    const urlObj = new URL(nextUrl);
    endpoint = urlObj.pathname.replace(`/admin/api/${SHOPIFY_API_VERSION}/`, '') + urlObj.search;
  }

  return allOrders;
}

/**
 * Sync Shopify orders into RetailEdge DB.
 * - Upserts ShopifyOrder records by shopifyOrderId
 * - Upserts ShopifyOrderLine records, linking to ProductVariant by SKU
 * - Updates lastOrderSyncAt and orderCount on the integration
 * - Creates a ShopifyImportLog with syncType='orders'
 */
export async function syncOrders(prisma, tenantId, { sinceDate: sinceDateOverride } = {}) {
  const startTime = Date.now();
  const stats = {
    productsPulled: 0,
    ordersPulled: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    errors: [],
  };

  // 1. Get integration + decrypt token (use tenant-scoped prisma for RLS compat)
  const integration = await prisma.shopifyIntegration.findUnique({
    where: { tenantId },
  });
  if (!integration || !integration.accessTokenEnc) {
    throw new Error('Shopify not connected. Please connect your Shopify store first.');
  }
  if (!integration.isActive) {
    throw new Error('Shopify integration is paused.');
  }

  const accessToken = decrypt(integration.accessTokenEnc);

  // 2. Fetch orders — use explicit sinceDate if provided, else incremental from last sync
  const sinceDate = sinceDateOverride || integration.lastOrderSyncAt || null;
  const shopifyOrders = await fetchOrders(integration.shop, accessToken, sinceDate);
  stats.ordersPulled = shopifyOrders.length;

  // 3. Build variant lookup maps for line item linking
  // Include productId so we can link canonical SalesLineItems to products
  const allVariants = await prisma.productVariant.findMany({
    where: { isActive: true },
    select: { id: true, sku: true, shopifyVariantId: true, productId: true },
  });
  const skuToVariant = new Map();
  const shopifyIdToVariant = new Map();
  for (const v of allVariants) {
    if (v.sku) skuToVariant.set(v.sku.toLowerCase(), v);
    if (v.shopifyVariantId) shopifyIdToVariant.set(v.shopifyVariantId, v);
  }
  // Legacy maps for ShopifyOrderLine (needs just the variant ID)
  const skuToVariantId = new Map();
  const shopifyIdToVariantId = new Map();
  for (const v of allVariants) {
    if (v.sku) skuToVariantId.set(v.sku.toLowerCase(), v.id);
    if (v.shopifyVariantId) shopifyIdToVariantId.set(v.shopifyVariantId, v.id);
  }

  // 4. Upsert each order
  for (const order of shopifyOrders) {
    try {
      const shopifyOrderId = String(order.id);
      const orderData = {
        shopifyOrderId,
        tenantId,
        integrationId: integration.id,
        shopifyOrderName: String(order.order_number || order.name || shopifyOrderId),
        customerName: order.customer
          ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || null
          : null,
        customerEmail: order.customer?.email || null,
        totalPrice: parseFloat(order.total_price) || 0,
        subtotalPrice: parseFloat(order.subtotal_price) || 0,
        totalDiscount: parseFloat(order.total_discounts) || 0,
        totalTax: parseFloat(order.total_tax) || 0,
        sourceName: order.source_name || null,
        currency: order.currency || 'AUD',
        financialStatus: order.financial_status || null,
        fulfillmentStatus: order.fulfillment_status || null,
        orderDate: order.created_at ? new Date(order.created_at) : new Date(),
      };

      // Upsert the order
      const tenantPrisma = createTenantClient(tenantId);
      const existingOrder = await tenantPrisma.shopifyOrder.findUnique({
        where: {
          integrationId_shopifyOrderId: {
            integrationId: integration.id,
            shopifyOrderId,
          },
        },
      });

      let dbOrder;
      if (existingOrder) {
        dbOrder = await tenantPrisma.shopifyOrder.update({
          where: {
            integrationId_shopifyOrderId: {
              integrationId: integration.id,
              shopifyOrderId,
            },
          },
          data: orderData,
        });
        stats.ordersUpdated++;
      } else {
        dbOrder = await tenantPrisma.shopifyOrder.create({ data: orderData });
        stats.ordersCreated++;
      }

      // Upsert order lines
      for (const line of order.line_items || []) {
        const shopifyLineId = String(line.id);
        const shopifyVariantId = line.variant_id ? String(line.variant_id) : null;
        const sku = line.sku || null;

        // Link to ProductVariant: prefer shopifyVariantId, fallback to SKU
        let productVariantId = null;
        if (shopifyVariantId) productVariantId = shopifyIdToVariantId.get(shopifyVariantId) || null;
        if (!productVariantId && sku) productVariantId = skuToVariantId.get(sku.toLowerCase()) || null;

        const qty = parseInt(line.quantity) || 1;
        const unitPrice = parseFloat(line.price) || 0;
        const lineDiscount = parseFloat(line.total_discount) || 0;
        const lineTotal = (unitPrice * qty) - lineDiscount;

        const lineData = {
          orderId: dbOrder.id,
          shopifyLineId,
          productVariantId,
          sku,
          productTitle: line.title || null,
          variantTitle: line.variant_title && line.variant_title !== 'Default Title' ? line.variant_title : null,
          quantity: qty,
          unitPrice,
          discount: lineDiscount,
          totalPrice: lineTotal,
        };

        await tenantPrisma.shopifyOrderLine.upsert({
          where: { orderId_shopifyLineId: { orderId: dbOrder.id, shopifyLineId } },
          create: lineData,
          update: lineData,
        });
      }

      // ── 4b. Upsert canonical SalesTransaction + SalesLineItems ──
      const transactionDate = order.created_at ? new Date(order.created_at) : new Date();
      const salesTxData = {
        tenantId,
        source: 'shopify',
        sourceId: shopifyOrderId,
        channel: order.source_name || null,
        transactionDate,
        subtotal: parseFloat(order.subtotal_price) || null,
        totalDiscount: parseFloat(order.total_discounts) || null,
        totalTax: parseFloat(order.total_tax) || null,
        totalAmount: parseFloat(order.total_price) || 0,
        currency: order.currency || 'AUD',
        status: mapFinancialStatus(order.financial_status),
        customerName: orderData.customerName,
        orderReference: order.name || `#${order.order_number}` || null,
        metadata: { shopifyOrderId: order.id, fulfillmentStatus: order.fulfillment_status },
      };

      const salesTx = await tenantPrisma.salesTransaction.upsert({
        where: {
          tenantId_source_sourceId: { tenantId, source: 'shopify', sourceId: shopifyOrderId },
        },
        create: salesTxData,
        update: salesTxData,
      });

      // Upsert canonical SalesLineItems with product matching + cost enrichment
      for (const line of order.line_items || []) {
        const shopifyVariantId = line.variant_id ? String(line.variant_id) : null;
        const lineSku = line.sku || null;
        const lineSourceId = String(line.id);

        // Resolve product via variant lookup (same logic as ShopifyOrderLine matching)
        let matchedVariant = null;
        if (shopifyVariantId) matchedVariant = shopifyIdToVariant.get(shopifyVariantId) || null;
        if (!matchedVariant && lineSku) matchedVariant = skuToVariant.get(lineSku.toLowerCase()) || null;

        const productId = matchedVariant?.productId || null;
        const variantId = matchedVariant?.id || null;
        const matchStatus = matchedVariant ? 'matched' : 'unmatched';
        const matchConfidence = matchedVariant ? 1.0 : null;

        const qty = parseInt(line.quantity) || 1;
        const unitPrice = parseFloat(line.price) || 0;
        const lineDisc = parseFloat(line.total_discount) || 0;
        const lineTotal = (unitPrice * qty) - lineDisc;

        // Cost-at-time-of-sale lookup
        let costFields;
        if (productId) {
          const cost = await getCostAtTimeOfSale(tenantPrisma, productId, transactionDate);
          costFields = calculateMargin(unitPrice, cost);
        } else {
          costFields = calculateMargin(unitPrice, null);
        }

        const salesLineData = {
          transactionId: salesTx.id,
          tenantId,
          productId,
          variantId,
          sourceProductId: line.product_id ? String(line.product_id) : null,
          sourceVariantId: lineSourceId,
          productName: line.title || 'Unknown',
          sku: lineSku,
          quantity: qty,
          unitPriceAtSale: unitPrice,
          discount: lineDisc,
          lineTotal,
          matchStatus,
          matchConfidence,
          ...costFields,
        };

        await tenantPrisma.salesLineItem.upsert({
          where: {
            transactionId_sourceVariantId: { transactionId: salesTx.id, sourceVariantId: lineSourceId },
          },
          create: salesLineData,
          update: salesLineData,
        });
      }

    } catch (err) {
      stats.errors.push({ order: order.order_number || order.id, error: err.message });
    }
  }

  // 5. Update integration metadata
  const tenantPrismaOrders = createTenantClient(tenantId);
  await tenantPrismaOrders.shopifyIntegration.update({
    where: { tenantId },
    data: {
      lastOrderSyncAt: new Date(),
      orderCount: { increment: stats.ordersCreated },
    },
  });

  // 6. Create import log
  await createShopifyImportLog(tenantId, stats, startTime, 'orders');

  return stats;
}

// ── Variant Matching ──────────────────────────────────────────

/**
 * Auto-match Shopify variants to local ProductVariants.
 *
 * Strategy (priority order):
 *   1. SKU exact match (case-insensitive) on a Shopify-named store
 *   2. Barcode exact match
 *   3. Fuzzy product title match (threshold 0.8)
 *
 * Only considers local variants in stores with "Shopify" in the name.
 */
export async function matchVariants(prisma, tenantId) {
  const integration = await basePrisma.shopifyIntegration.findUnique({
    where: { tenantId },
  });
  if (!integration || !integration.accessTokenEnc) throw new Error('Shopify not connected');
  if (!integration.isActive) throw new Error('Shopify integration is paused');

  const accessToken = decrypt(integration.accessTokenEnc);
  const dismissedSet = new Set((integration.dismissedVariants || []).map(String));

  // Fetch all products from Shopify
  const shopifyProducts = await fetchProducts(integration.shop, accessToken);

  // Flatten to variant-level
  const shopifyVariants = [];
  for (const sp of shopifyProducts) {
    for (const sv of (sp.variants || [])) {
      shopifyVariants.push({
        shopifyVariantId: String(sv.id),
        shopifyProductId: String(sp.id),
        sku: sv.sku || null,
        barcode: sv.barcode || null,
        title: sp.title,
        variantTitle: sv.title !== 'Default Title' ? sv.title : null,
        price: sv.price,
      });
    }
  }

  // Find local stores with "Shopify" in the name
  const shopifyStores = await prisma.store.findMany({
    where: { name: { contains: 'Shopify', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  const shopifyStoreIds = shopifyStores.map(s => s.id);

  if (shopifyStoreIds.length === 0) {
    return {
      matched: [],
      unmatched: shopifyVariants.filter(sv => !dismissedSet.has(sv.shopifyVariantId)),
      dismissed: dismissedSet.size,
    };
  }

  // Load all local variants in Shopify stores
  const localVariants = await prisma.productVariant.findMany({
    where: {
      storeId: { in: shopifyStoreIds },
      isActive: true,
    },
    include: {
      product: { select: { id: true, name: true, barcode: true, archivedAt: true } },
      store: { select: { id: true, name: true } },
    },
  });

  // Build lookup maps
  const skuMap = new Map();
  const barcodeMap = new Map();
  for (const lv of localVariants) {
    if (lv.product?.archivedAt) continue;
    if (lv.sku) skuMap.set(lv.sku.toLowerCase(), lv);
    if (lv.product?.barcode) barcodeMap.set(lv.product.barcode, lv);
  }

  // Track already-linked variant IDs
  const alreadyLinked = new Set(
    localVariants.filter(lv => lv.shopifyVariantId).map(lv => lv.shopifyVariantId)
  );

  const matched = [];
  const unmatched = [];
  const linkedLocalIds = new Set();

  for (const sv of shopifyVariants) {
    if (alreadyLinked.has(sv.shopifyVariantId)) continue;
    if (dismissedSet.has(sv.shopifyVariantId)) continue;

    let matchedLocal = null;
    let matchMethod = null;

    // Strategy 1: SKU exact match
    if (sv.sku) {
      const bysku = skuMap.get(sv.sku.toLowerCase());
      if (bysku && !bysku.shopifyVariantId && !linkedLocalIds.has(bysku.id)) {
        matchedLocal = bysku;
        matchMethod = 'sku';
      }
    }

    // Strategy 2: Barcode match
    if (!matchedLocal && sv.barcode) {
      const byBarcode = barcodeMap.get(sv.barcode);
      if (byBarcode && !byBarcode.shopifyVariantId && !linkedLocalIds.has(byBarcode.id)) {
        matchedLocal = byBarcode;
        matchMethod = 'barcode';
      }
    }

    // Strategy 3: Fuzzy title match
    if (!matchedLocal) {
      const fullTitle = sv.variantTitle ? `${sv.title} ${sv.variantTitle}` : sv.title;
      let bestScore = 0;
      let bestVariant = null;
      for (const lv of localVariants) {
        if (lv.shopifyVariantId || linkedLocalIds.has(lv.id)) continue;
        if (lv.product?.archivedAt) continue;
        const score = fuzzyNameScore(fullTitle, lv.name);
        if (score > bestScore && score >= 0.8) {
          bestScore = score;
          bestVariant = lv;
        }
      }
      if (bestVariant) {
        matchedLocal = bestVariant;
        matchMethod = 'title';
      }
    }

    if (matchedLocal) {
      await prisma.productVariant.update({
        where: { id: matchedLocal.id },
        data: {
          shopifyVariantId: sv.shopifyVariantId,
          shopifyProductId: sv.shopifyProductId,
        },
      });
      matchedLocal.shopifyVariantId = sv.shopifyVariantId;
      linkedLocalIds.add(matchedLocal.id);

      matched.push({
        shopifyVariantId: sv.shopifyVariantId,
        shopifyProductId: sv.shopifyProductId,
        shopifyTitle: sv.title,
        shopifyVariantTitle: sv.variantTitle,
        shopifySku: sv.sku,
        localVariantId: matchedLocal.id,
        localVariantName: matchedLocal.name,
        localSku: matchedLocal.sku,
        matchMethod,
      });
    } else {
      unmatched.push(sv);
    }
  }

  return { matched, unmatched, dismissed: dismissedSet.size };
}

/**
 * Manually link a Shopify variant to a local ProductVariant.
 */
export async function linkVariant(prisma, localVariantId, shopifyVariantId, shopifyProductId) {
  const updated = await prisma.productVariant.update({
    where: { id: localVariantId },
    data: {
      shopifyVariantId: String(shopifyVariantId),
      shopifyProductId: shopifyProductId ? String(shopifyProductId) : undefined,
    },
  });
  return updated;
}

/**
 * Dismiss Shopify variants from the unmatched list.
 */
export async function dismissVariants(tenantId, variantIds) {
  const ids = Array.isArray(variantIds) ? variantIds : [variantIds];
  const integration = await basePrisma.shopifyIntegration.findUnique({
    where: { tenantId },
  });
  if (!integration) throw new Error('Shopify not connected');

  const existing = new Set((integration.dismissedVariants || []).map(String));
  for (const id of ids) existing.add(String(id));

  const tenantPrisma = createTenantClient(tenantId);
  await tenantPrisma.shopifyIntegration.update({
    where: { tenantId },
    data: { dismissedVariants: [...existing] },
  });
  return { dismissed: existing.size };
}
