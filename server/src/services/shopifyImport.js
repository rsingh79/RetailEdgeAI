/**
 * Shopify CSV import service.
 *
 * Detects Shopify product export format, groups rows by Handle,
 * and creates Product + ProductVariant records.
 */

import { embedProduct } from './ai/embeddingMaintenance.js';
import { logPriceChange } from './priceChangeLogger.js';

// ── Format detection ──────────────────────────────────────────

const SHOPIFY_REQUIRED_HEADERS = ['Handle', 'Title', 'Variant SKU'];

/**
 * Detect whether parsed headers are from a Shopify product export.
 */
export function isShopifyFormat(headers) {
  const set = new Set(headers.map((h) => h.trim()));
  return SHOPIFY_REQUIRED_HEADERS.every((h) => set.has(h));
}

// ── Row grouping ──────────────────────────────────────────────

/**
 * Group Shopify CSV rows by Handle and build normalised product + variant structures.
 *
 * @param {Object[]} rows  – Parsed CSV rows (objects keyed by column header)
 * @param {Object}   opts  – { skipArchived: boolean (default true) }
 * @returns {{ products: ShopifyProduct[], stats: Object }}
 */
export function groupShopifyRows(rows, opts = {}) {
  const { skipArchived = true } = opts;

  const groups = new Map(); // Handle → row[]
  let skippedArchived = 0;

  for (const row of rows) {
    const handle = str(row.Handle);
    if (!handle) continue;

    const status = str(row.Status).toLowerCase();

    // First row for this handle — check status
    if (!groups.has(handle)) {
      if (skipArchived && status === 'archived') {
        skippedArchived++;
        continue;
      }
      groups.set(handle, []);
    }
    groups.get(handle).push(row);
  }

  const products = [];
  for (const [handle, groupRows] of groups) {
    products.push(buildProduct(handle, groupRows));
  }

  return {
    products,
    stats: {
      totalProducts: products.length,
      totalVariants: products.reduce((s, p) => s + p.variants.length, 0),
      skippedArchived,
    },
  };
}

// ── Build normalised product ──────────────────────────────────

function buildProduct(handle, rows) {
  const first = rows[0];

  // Product-level fields come from the first row
  const title = str(first.Title) || handle;
  const rawCategory = str(first['Product Category']);
  const category = simplifyCategory(rawCategory);
  const weightUnit = str(first['Variant Weight Unit']).toLowerCase() || 'g';
  const baseUnit = weightUnit === 'kg' || weightUnit === 'g' ? weightUnit : weightUnit;

  // First non-empty barcode in the group
  const barcode = rows.map((r) => str(r['Variant Barcode'])).find(Boolean) || null;

  // Build variants
  const variants = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const opt1 = str(row['Option1 Value']);
    const isDefault = opt1 === 'Default Title';

    // SKU: use real or generate synthetic
    let sku = str(row['Variant SKU']);
    if (!sku) sku = `${handle}-v${i + 1}`;

    // Weight → unitQty
    const grams = parseNum(row['Variant Grams']);
    let unitQty = 1;
    if (grams > 0) {
      unitQty = baseUnit === 'kg' ? grams / 1000 : grams;
    }

    variants.push({
      sku,
      name: isDefault ? title : opt1 || title,
      size: isDefault ? null : opt1 || null,
      unitQty,
      currentCost: parseNum(row['Cost per item']),
      salePrice: parseNum(row['Variant Price']),
    });
  }

  return { handle, name: title, category, baseUnit, barcode, source: 'Shopify', variants };
}

// ── Database import ───────────────────────────────────────────

/**
 * Import Shopify products with proper variant grouping.
 *
 * @param {PrismaClient} prisma  – Tenant-scoped Prisma client (auto-injects tenantId)
 * @param {Object[]}     rows    – Parsed CSV rows
 * @param {Object}       opts    – { deleteExisting: boolean }
 */
export async function importShopifyProducts(prisma, rows, opts = {}) {
  const { deleteExisting = false } = opts;

  // 1. Ensure a Shopify store exists
  let store = await prisma.store.findFirst({
    where: { type: 'ECOMMERCE', platform: 'Shopify' },
  });
  if (!store) {
    store = await prisma.store.create({
      data: { name: 'Shopify Online Store', type: 'ECOMMERCE', platform: 'Shopify' },
    });
  }

  // 2. Optionally delete existing Shopify products (cascading child records)
  let deleted = 0;
  if (deleteExisting) {
    deleted = await deleteExistingShopifyProducts(prisma);
  }

  // 3. Group rows
  const { products, stats } = groupShopifyRows(rows, { skipArchived: true });

  // 4. Create / update products with variants
  let imported = 0;
  let updated = 0;
  let variantsCreated = 0;
  let skippedVariants = 0;
  const errors = [];

  for (const sp of products) {
    try {
      // Dedup: look for existing product by name + source (case-insensitive source match)
      let existing = await prisma.product.findFirst({
        where: { name: { equals: sp.name, mode: 'insensitive' }, source: { in: ['Shopify', 'shopify'] } },
      });

      let productId;

      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: { category: sp.category, baseUnit: sp.baseUnit, barcode: sp.barcode },
        });
        productId = existing.id;
        embedProduct({ id: existing.id, name: existing.name, category: sp.category || existing.category, baseUnit: sp.baseUnit, tenantId: existing.tenantId }).catch(() => {});
        updated++;
        // Remove old variants for this store so they can be recreated
        await prisma.productVariant.deleteMany({
          where: { productId: existing.id, storeId: store.id },
        });
      } else {
        const created = await prisma.product.create({
          data: {
            name: sp.name,
            category: sp.category,
            baseUnit: sp.baseUnit,
            barcode: sp.barcode,
            source: 'Shopify',
          },
        });
        productId = created.id;
        embedProduct({ id: created.id, name: created.name, category: created.category, baseUnit: created.baseUnit, tenantId: created.tenantId }).catch(() => {});
        imported++;
      }

      // Create variants
      // Get tenantId from the product record for price logging
      const tenantId = existing?.tenantId || (await prisma.product.findUnique({
        where: { id: productId }, select: { tenantId: true },
      }))?.tenantId;

      for (const v of sp.variants) {
        try {
          const newVariant = await prisma.productVariant.create({
            data: {
              productId,
              storeId: store.id,
              sku: v.sku,
              name: v.name,
              size: v.size,
              unitQty: v.unitQty,
              currentCost: v.currentCost,
              salePrice: v.salePrice,
              isActive: true,
            },
          });
          variantsCreated++;
          // Log variant-level price changes (new variant — oldPrice = null)
          if (tenantId) {
            if (v.currentCost > 0) {
              logPriceChange(prisma, {
                tenantId,
                productId,
                variantId: newVariant.id,
                priceType: 'cost_price',
                oldPrice: null,
                newPrice: v.currentCost,
                changeSource: 'shopify_sync',
              }).catch(() => {});
            }
            if (v.salePrice > 0) {
              logPriceChange(prisma, {
                tenantId,
                productId,
                variantId: newVariant.id,
                priceType: 'sale_price',
                oldPrice: null,
                newPrice: v.salePrice,
                changeSource: 'shopify_sync',
              }).catch(() => {});
            }
          }
        } catch (err) {
          if (err.code === 'P2002') {
            // Unique constraint on [storeId, sku] — skip duplicate
            skippedVariants++;
          } else {
            errors.push({ product: sp.name, variant: v.sku, error: err.message });
          }
        }
      }
    } catch (err) {
      errors.push({ product: sp.name, error: err.message });
    }
  }

  return {
    shopifyMode: true,
    imported,
    updated,
    deleted,
    totalProducts: stats.totalProducts,
    totalVariants: variantsCreated,
    skippedVariants,
    skippedArchived: stats.skippedArchived,
    storeName: store.name,
    storeId: store.id,
    errors,
  };
}

// ── Cascade delete existing Shopify products ──────────────────

async function deleteExistingShopifyProducts(prisma) {
  // Case-insensitive: catch both 'Shopify' (new import) and 'shopify' (old flat import)
  const existing = await prisma.product.findMany({
    where: { source: { in: ['Shopify', 'shopify'] } },
    select: { id: true },
  });

  if (existing.length === 0) return 0;

  const ids = existing.map((p) => p.id);

  // Delete in FK order (children first)
  await prisma.invoiceLineMatch.deleteMany({
    where: { productId: { in: ids } },
  });
  await prisma.productVariant.deleteMany({
    where: { productId: { in: ids } },
  });
  // These may not exist yet if competitor models haven't been migrated
  try {
    await prisma.competitorMonitor.deleteMany({ where: { productId: { in: ids } } });
  } catch { /* model may not exist */ }
  try {
    await prisma.priceAlert.deleteMany({ where: { productId: { in: ids } } });
  } catch { /* model may not exist */ }

  const result = await prisma.product.deleteMany({ where: { source: { in: ['Shopify', 'shopify'] } } });
  return result.count;
}

// ── Helpers ───────────────────────────────────────────────────

function str(val) {
  return val !== undefined && val !== null ? String(val).trim() : '';
}

function parseNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Simplify deep Shopify taxonomy path to the last segment.
 * "Food, Beverages & Tobacco > Food Items > Cooking & Baking Ingredients"
 *  → "Cooking & Baking Ingredients"
 */
function simplifyCategory(cat) {
  if (!cat) return null;
  const parts = cat.split('>').map((s) => s.trim());
  return parts[parts.length - 1] || null;
}
