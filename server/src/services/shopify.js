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
import basePrisma from '../lib/prisma.js';

const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';
const SHOPIFY_SCOPES = 'read_products,write_products';

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
  await basePrisma.shopifyIntegration.upsert({
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
  const existingStore = await basePrisma.store.findFirst({
    where: { tenantId, type: 'ECOMMERCE', platform: 'Shopify' },
  });
  if (!existingStore) {
    await basePrisma.store.create({
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
    source: 'Shopify',
    handle,
    shopifyProductId: String(shopifyProduct.id),
    variants,
  };
}

/**
 * Full product sync: fetch from Shopify API → upsert into RetailEdge DB.
 * Returns sync stats and creates a ShopifyImportLog.
 */
export async function syncProducts(prisma, tenantId) {
  const startTime = Date.now();
  const stats = {
    productsPulled: 0,
    productsCreated: 0,
    productsUpdated: 0,
    variantsCreated: 0,
    errors: [],
  };

  // 1. Get integration + decrypt token
  const integration = await basePrisma.shopifyIntegration.findUnique({
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
    // Log and return early
    await createImportLog(tenantId, stats, startTime);
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

  // 4. Transform and upsert products + variants
  for (const shopifyProduct of shopifyProducts) {
    try {
      const transformed = transformShopifyProduct(shopifyProduct);

      // Find existing product by name + source (case-insensitive)
      const existing = await prisma.product.findFirst({
        where: {
          name: { equals: transformed.name, mode: 'insensitive' },
          source: 'Shopify',
        },
      });

      let product;
      if (existing) {
        product = await prisma.product.update({
          where: { id: existing.id },
          data: {
            category: transformed.category || existing.category,
            barcode: transformed.barcode || existing.barcode,
          },
        });
        stats.productsUpdated++;
      } else {
        product = await prisma.product.create({
          data: {
            name: transformed.name,
            category: transformed.category,
            barcode: transformed.barcode,
            source: 'Shopify',
          },
        });
        stats.productsCreated++;
      }

      // Upsert variants
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
            isActive: true,
          },
          update: {
            name: v.name,
            size: v.size,
            unitQty: v.unitQty,
            currentCost: v.currentCost,
            salePrice: v.salePrice,
            isActive: true,
          },
        });
        stats.variantsCreated++;
      }
    } catch (err) {
      stats.errors.push({
        product: shopifyProduct.title,
        error: err.message,
      });
    }
  }

  // 5. Update integration metadata
  await basePrisma.shopifyIntegration.update({
    where: { tenantId },
    data: {
      lastSyncAt: new Date(),
      productCount: stats.productsCreated + stats.productsUpdated,
    },
  });

  // 6. Create import log
  await createImportLog(tenantId, stats, startTime);

  return stats;
}

async function createImportLog(tenantId, stats, startTime) {
  const durationMs = Date.now() - startTime;
  const status = stats.errors.length > 0
    ? (stats.productsCreated + stats.productsUpdated > 0 ? 'partial' : 'failed')
    : 'success';

  await basePrisma.shopifyImportLog.create({
    data: {
      tenantId,
      status,
      productsPulled: stats.productsPulled,
      productsCreated: stats.productsCreated,
      productsUpdated: stats.productsUpdated,
      variantsCreated: stats.variantsCreated,
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
