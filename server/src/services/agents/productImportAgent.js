/**
 * Product Import Agent — AI-powered data analysis, pattern detection, and transformation.
 *
 * Flow:
 * 1. analyzeFile()    — Claude reads headers + sample rows, proposes column mapping + patterns
 * 2. chat()           — User clarifies/corrects via natural language
 * 3. testRun()        — Deterministic: apply agreed rules to ALL rows, report results
 * 4. applyImport()    — Deterministic: bulk create/upsert products using agreed rules
 */

import { generate } from '../ai/aiServiceRouter.js';
import { assemblePrompt } from '../promptAssemblyEngine.js';

// ── In-memory session store (uploadId → session) ──
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

export function getSession(uploadId) {
  const s = sessions.get(uploadId);
  if (s && Date.now() - s.lastAccess > SESSION_TTL) {
    sessions.delete(uploadId);
    return null;
  }
  if (s) s.lastAccess = Date.now();
  return s || null;
}

export function createSession(uploadId, data) {
  const session = {
    messages: [],
    patterns: [],
    columnMapping: null,
    transformRules: [],
    hasVariants: false,
    groupByColumn: null,
    variantColumns: null,
    status: 'analyzing',
    ...data,             // data LAST so it overwrites defaults
    lastAccess: Date.now(),
  };
  sessions.set(uploadId, session);
  return session;
}

// ── Step 1: Analyze file with Claude ──

export async function analyzeFile({ headers, sampleRows, totalRows, tenantId, userId }) {
  const sampleData = sampleRows.slice(0, 20).map((row, i) => {
    const obj = {};
    for (const h of headers) {
      obj[h] = row[h] != null ? String(row[h]).substring(0, 100) : '';
    }
    return obj;
  });

  const systemPrompt = `You are a product data import assistant for RetailEdge, a retail management system. You analyze uploaded product files and create transformation plans.

TARGET SCHEMA — the system needs these fields per product:
- name (required): Clean product name without size/weight info
- category (optional): Product category/department
- barcode (optional): UPC, EAN, or other barcode
- baseUnit (optional): "kg", "L", "each", "g", "ml" — the base selling unit
- costPrice (optional): Supplier/wholesale cost (ex-GST in AUD)
- sellingPrice (optional): Retail price (ex-GST in AUD)
- sku (optional): Stock keeping unit code
- size (optional): e.g. "1kg", "500g", "4x2L"
- packSize (optional): Pack descriptor e.g. "4x2L", "12x500ml"
- unitQty (optional): Total base units in pack (e.g. 4x2L = 8 litres, so unitQty=8)

ANALYSIS TASKS:
1. Map each source column to a target field (or "skip")
2. Identify PATTERNS in the data — different row structures that need different transformation rules
3. Detect if product names contain embedded size/weight info that needs splitting
4. Detect price formats: are prices GST-inclusive? What currency? Any pack pricing?
5. Detect unit/weight formats used
6. CRITICAL — Detect parent/child row structure:
   Many POS and ecommerce systems export products where one row is the PARENT product and subsequent rows are VARIANTS (sizes, colors, flavours). Look for:
   - A "grouping key" column where multiple rows share the same value (e.g. Shopify "Handle", Lightspeed "Product ID", WooCommerce "Parent SKU")
   - Parent rows that have the full product name, variant rows where the name is empty or repeated
   - Variant-specific columns (size, option, variant SKU, variant price)
   If you detect this pattern, set hasVariants=true and identify the groupByColumn.

RESPONSE FORMAT — return ONLY valid JSON:
{
  "columnMapping": {
    "<sourceColumn>": { "target": "<targetField>|skip", "confidence": 0.0-1.0, "note": "why" }
  },
  "hasVariants": false,
  "groupByColumn": null,
  "variantColumns": {
    "nameColumn": null,
    "skuColumn": null,
    "priceColumn": null,
    "costColumn": null,
    "barcodeColumn": null,
    "sizeColumn": null,
    "weightColumn": null,
    "optionColumns": []
  },
  "patterns": [
    {
      "id": "A",
      "label": "Short description",
      "description": "What makes this pattern distinct",
      "matchRule": "Regex or condition that identifies rows in this pattern",
      "rowCount": <estimated count>,
      "exampleRows": [<indices of example rows from the sample>],
      "transformations": [
        { "field": "<target>", "rule": "description of transform", "type": "split|parse|convert|direct|calculate" }
      ]
    }
  ],
  "observations": [
    "Key observation about the data (GST, duplicates, missing fields, etc.)"
  ],
  "gstDetected": true|false,
  "gstRate": 0.1
}

IMPORTANT: If hasVariants is true, groupByColumn MUST be set to the exact column header name that groups parent+child rows together.`;

  const userPrompt = `Analyze this product file:

COLUMNS (${headers.length}): ${headers.join(', ')}

SAMPLE DATA (${Math.min(sampleData.length, 20)} of ${totalRows} rows):
${JSON.stringify(sampleData, null, 2)}

Identify column mappings, data patterns, and any transformations needed.`;

  const aiResult = await generate('product_import_analysis', systemPrompt, userPrompt, {
    tenantId,
    userId,
    maxTokens: 4096,
  });

  const text = aiResult.response || '';

  let result = null;
  try {
    const clean = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    result = JSON.parse(clean);
  } catch (err) {
    console.error(
      '[ProductImportAgent] analyzeFile JSON parse failed:',
      err.message
    );
    console.error('Raw response preview:', text.substring(0, 500));
    throw new Error(
      'The AI analysis returned an unexpected format. ' +
      'Please try uploading the file again.'
    );
  }

  if (!result || !result.columnMapping) {
    throw new Error(
      'The AI analysis did not return a column mapping. ' +
      'Please try uploading the file again.'
    );
  }

  return result;
}

// ── Step 2: Chat — user clarifies, agent updates rules ──

export async function chat({ session, userMessage, tenantId, userId }) {
  session.messages.push({ role: 'user', content: userMessage });

  const systemPrompt = `CRITICAL: You must ALWAYS respond with valid JSON. Never respond with plain text or markdown outside of a JSON structure. Every response must be a single JSON object with this exact structure:
{
  "reply": "your message to the user here",
  "updates": { ... } or null,
  "allPatternsConfirmed": true or false
}
If you cannot provide updates, set updates to null. If the import is not yet confirmed set allPatternsConfirmed to false. Never include any text outside the JSON object. Never wrap the JSON in markdown code fences.

You are the Product Import Agent for RetailEdge. You're in the middle of helping a user import products.

CURRENT STATE:
- File: ${session.fileName} (${session.totalRows} rows, ${session.headers.length} columns)
- Column Mapping: ${JSON.stringify(session.columnMapping)}
- Patterns: ${JSON.stringify(session.patterns)}
- Transform Rules: ${JSON.stringify(session.transformRules)}
- Status: ${session.status}

The user is clarifying or correcting your analysis. Update the patterns/rules based on their feedback.

RESPONSE FORMAT — return ONLY valid JSON:
{
  "reply": "Your conversational response to the user",
  "updates": {
    "patterns": null | [<updated patterns array>],
    "columnMapping": null | {<updated mapping>},
    "transformRules": null | [<updated rules>],
    "gstDetected": null | boolean,
    "gstRate": null | number
  },
  "allPatternsConfirmed": false
}

Set allPatternsConfirmed=true ONLY when the user has explicitly confirmed all patterns look correct.
If updates.X is null, it means no change to that field.`;

  const result = await generate('product_import_analysis', systemPrompt, null, {
    tenantId,
    userId,
    messages: session.messages.map((m) => ({ role: m.role, content: m.content })),
    maxTokens: 2048,
  });

  const text = result.response || '';

  // ── Safe JSON parse ──────────────────────────
  let parsed = null;
  let reply = text; // fallback to raw text

  try {
    const clean = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    if (clean.startsWith('{') || clean.startsWith('[')) {
      parsed = JSON.parse(clean);
      reply = parsed.reply || text;
    } else {
      console.warn(
        '[ProductImportAgent] Chat response was not JSON:',
        text.substring(0, 100)
      );
      parsed = { reply: text, updates: null, allPatternsConfirmed: false };
    }
  } catch (err) {
    console.warn(
      '[ProductImportAgent] JSON parse failed:',
      err.message,
      '— raw response:',
      text.substring(0, 200)
    );
    parsed = { reply: text, updates: null, allPatternsConfirmed: false };
    reply = text;
  }
  // ── End safe JSON parse ──────────────────────

  // Apply updates to session only if parse succeeded
  if (parsed?.updates) {
    if (parsed.updates.patterns) session.patterns = parsed.updates.patterns;
    if (parsed.updates.columnMapping) session.columnMapping = parsed.updates.columnMapping;
    if (parsed.updates.transformRules) session.transformRules = parsed.updates.transformRules;
    if (parsed.updates.gstDetected !== undefined) session.gstDetected = parsed.updates.gstDetected;
    if (parsed.updates.gstRate !== undefined) session.gstRate = parsed.updates.gstRate;
  }

  if (parsed?.allPatternsConfirmed) {
    session.status = 'confirmed';
    reply = (parsed.reply || reply) +
      '\n\n**Ready to import!** Click the ' +
      '**Import ' + (session.totalRows || '') + ' Products**' +
      ' button to run the import with ' +
      'duplicate detection and approval review.';
  }

  session.messages.push({
    role: 'assistant',
    content: typeof parsed?.reply === 'string' ? parsed.reply : reply,
  });

  return {
    reply,
    patterns: session.patterns,
    columnMapping: session.columnMapping,
    status: session.status,
  };
}

// ── Step 3: Test run — deterministic transformation of ALL rows ──

export function testRun({ session, allRows }) {
  console.log('[SmartImport] testRun — hasVariants:', session.hasVariants, 'groupByColumn:', session.groupByColumn);
  if (session.hasVariants && session.groupByColumn) {
    console.log('[SmartImport] Using GROUPED path');
    return testRunGrouped(session, allRows);
  }
  console.log('[SmartImport] Using GENERIC path');
  return testRunGeneric(session, allRows);
}

// ── Generic parent/child grouping engine ──
// Works for Shopify, Lightspeed, WooCommerce, or any system that uses
// a key column to group parent product rows with their variant rows.

function testRunGrouped(session, allRows) {
  const groupCol = session.groupByColumn;
  const mapping = session.columnMapping || {};
  const vc = session.variantColumns || {};
  const gstRate = session.gstRate || 0.1;
  const stripGst = session.gstDetected || false;

  // Step 1: Group rows by the key column
  const groups = new Map();
  const groupOrder = [];

  for (const row of allRows) {
    const key = String(row[groupCol] || '').trim();
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(row);
  }

  const results = {
    successful: [],
    warnings: [],
    failed: [],
    duplicates: 0,
    totalRows: allRows.length,
    hasVariants: true,
    productCount: groups.size,
    variantCount: allRows.length - groups.size,
  };

  // Step 2: For each group, first row = parent, rest = variants
  let productIndex = 0;
  for (const key of groupOrder) {
    productIndex++;
    const rows = groups.get(key);
    const parentRow = rows[0];

    // Extract product name from parent row
    const nameCol = findMappedColumn(mapping, 'name') || vc.nameColumn;
    const catCol = findMappedColumn(mapping, 'category');
    const rawName = nameCol ? String(parentRow[nameCol] || '').trim() : '';

    if (!rawName) {
      results.failed.push({
        rowIndex: productIndex,
        reason: 'Missing product name',
        source: { [groupCol]: key },
      });
      continue;
    }

    // Split name from embedded size
    const split = splitNameAndSize(rawName);

    // Extract category — handle hierarchical formats like "Health > Supplements > Vitamins"
    let category = catCol ? String(parentRow[catCol] || '').trim() : null;
    if (category && category.includes('>')) {
      // Take the most specific (last) segment
      const segments = category.split('>').map((s) => s.trim()).filter(Boolean);
      category = segments[segments.length - 1] || category;
    }

    // Build variants from all rows in the group
    const variants = rows.map((row) => {
      const variantSku = vc.skuColumn ? String(row[vc.skuColumn] || '').trim() : null;
      const variantBarcode = vc.barcodeColumn ? String(row[vc.barcodeColumn] || '').trim() : null;

      // Build variant name from option columns
      let variantName = '';
      if (vc.optionColumns?.length > 0) {
        const optionParts = vc.optionColumns
          .map((col) => String(row[col] || '').trim())
          .filter(Boolean);
        variantName = optionParts.join(' / ');
      }

      // Size from variant name or size column
      let variantSize = vc.sizeColumn ? String(row[vc.sizeColumn] || '').trim() : null;
      if (!variantSize && variantName) {
        const sizeSplit = splitNameAndSize(variantName);
        if (sizeSplit.size) variantSize = sizeSplit.size;
      }

      // Prices
      let price = vc.priceColumn ? parseFloat(String(row[vc.priceColumn] || '').replace(/[^0-9.\-]/g, '')) : null;
      let cost = vc.costColumn ? parseFloat(String(row[vc.costColumn] || '').replace(/[^0-9.\-]/g, '')) : null;
      if (stripGst && price && !isNaN(price)) price = Math.round((price / (1 + gstRate)) * 100) / 100;
      if (stripGst && cost && !isNaN(cost)) cost = Math.round((cost / (1 + gstRate)) * 100) / 100;

      // Weight
      let weight = vc.weightColumn ? parseFloat(String(row[vc.weightColumn] || '')) : null;

      return {
        sku: variantSku || null,
        name: variantName || 'Default',
        size: variantSize || null,
        barcode: isNaN(Number(variantBarcode)) ? variantBarcode : variantBarcode,
        price: isNaN(price) ? null : price,
        cost: isNaN(cost) ? null : cost,
        weight: isNaN(weight) ? null : weight,
      };
    });

    const firstVariant = variants[0] || {};
    const transformed = {
      rowIndex: productIndex,
      groupKey: key,
      name: split.name,
      category,
      baseUnit: split.baseUnit || inferBaseUnitFromVariants(variants) || null,
      size: split.size || null,
      barcode: firstVariant.barcode || null,
      costPrice: firstVariant.cost || null,
      sellingPrice: firstVariant.price || null,
      variantCount: variants.length,
      variants: variants.slice(0, 4),
    };

    results.successful.push(transformed);
  }

  return results;
}

function findMappedColumn(mapping, targetField) {
  for (const [col, info] of Object.entries(mapping)) {
    const target = typeof info === 'string' ? info : info?.target;
    if (target === targetField) return col;
  }
  return null;
}

function inferBaseUnitFromVariants(variants) {
  for (const v of variants) {
    if (v.size) {
      const unit = inferBaseUnit(v.size);
      if (unit !== 'each') return unit;
    }
    if (v.weight && v.weight > 0) return 'kg';
  }
  return null;
}

function testRunGeneric(session, allRows) {
  const results = {
    successful: [],
    warnings: [],
    failed: [],
    duplicates: 0,
    totalRows: allRows.length,
    isShopify: false,
  };

  const mapping = session.columnMapping || {};
  const gstRate = session.gstRate || 0.1;
  const stripGst = session.gstDetected || false;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    try {
      const transformed = transformRow(row, mapping, session.patterns, { stripGst, gstRate });

      if (!transformed.name) {
        results.failed.push({ rowIndex: i + 2, reason: 'Missing product name', source: summarizeRow(row, mapping) });
        continue;
      }

      if (transformed.warning) {
        results.warnings.push({ rowIndex: i + 2, warning: transformed.warning, product: transformed });
      }

      results.successful.push({ rowIndex: i + 2, ...transformed });
    } catch (err) {
      results.failed.push({ rowIndex: i + 2, reason: err.message, source: summarizeRow(row, mapping) });
    }
  }

  return results;
}

// ── Step 4: Apply import — create/upsert products ──

export async function applyImport({ session, testResults, prisma, source, allRows }) {
  let created = 0;
  let updated = 0;
  let variantsCreated = 0;
  const errors = [];

  // If grouped import with variants, ensure a store exists for variants
  let store = null;
  if (testResults.hasVariants) {
    const storeName = source || 'Imported Store';
    store = await prisma.store.findFirst({
      where: { name: { equals: storeName, mode: 'insensitive' } },
    });
    if (!store) {
      store = await prisma.store.create({
        data: { name: storeName, type: 'POS', isActive: true },
      });
    }
  }

  for (const item of testResults.successful) {
    const productData = {
      name: item.name,
      category: item.category || null,
      barcode: item.barcode || null,
      baseUnit: item.baseUnit || null,
      costPrice: item.costPrice != null ? item.costPrice : null,
      sellingPrice: item.sellingPrice != null ? item.sellingPrice : null,
      source: source || null,
    };

    try {
      // Deduplicate: barcode first, then name+baseUnit
      let existing = null;

      if (productData.barcode) {
        existing = await prisma.product.findFirst({
          where: { barcode: productData.barcode },
        });
      }

      if (!existing) {
        const nameWhere = { name: { equals: item.name, mode: 'insensitive' } };
        if (productData.baseUnit) {
          nameWhere.baseUnit = { equals: productData.baseUnit, mode: 'insensitive' };
        }
        existing = await prisma.product.findFirst({ where: nameWhere });
      }

      let product;
      if (existing) {
        product = await prisma.product.update({ where: { id: existing.id }, data: productData });
        updated++;
      } else {
        product = await prisma.product.create({ data: productData });
        created++;
      }

      // Create variants if this is a grouped import
      if (testResults.hasVariants && item.variants && store) {
        for (const v of item.variants) {
          if (!v.sku && !v.name) continue;
          const sku = v.sku || `${item.groupKey || item.name}-${v.name || 'default'}`;

          try {
            const existingVariant = await prisma.productVariant.findFirst({
              where: { storeId: store.id, sku },
            });

            const variantData = {
              productId: product.id,
              storeId: store.id,
              sku,
              name: v.name || 'Default',
              size: v.size || null,
              unitQty: v.weight ? v.weight / 1000 : 1,
              currentCost: v.cost || item.costPrice || 0,
              salePrice: v.price || item.sellingPrice || 0,
              isActive: true,
            };

            if (existingVariant) {
              await prisma.productVariant.update({ where: { id: existingVariant.id }, data: variantData });
            } else {
              await prisma.productVariant.create({ data: variantData });
              variantsCreated++;
            }
          } catch (vErr) {
            // Non-fatal — product was created, variant failed
            errors.push({ row: item.rowIndex, name: `${item.name} → variant ${v.sku || v.name}`, error: vErr.message });
          }
        }
      }
    } catch (err) {
      errors.push({ row: item.rowIndex, name: item.name, error: err.message });
    }
  }

  session.status = 'done';
  return { created, updated, variantsCreated, skipped: testResults.failed.length, errors };
}

// ── Helpers ──

function transformRow(row, columnMapping, patterns, opts = {}) {
  const result = { warning: null };

  // Apply column mapping
  for (const [sourceCol, mapInfo] of Object.entries(columnMapping)) {
    const target = typeof mapInfo === 'string' ? mapInfo : mapInfo?.target;
    if (!target || target === 'skip') continue;

    const rawValue = row[sourceCol];
    if (rawValue == null || String(rawValue).trim() === '') continue;

    const value = String(rawValue).trim();

    switch (target) {
      case 'name':
      case 'category':
      case 'barcode':
      case 'sku':
        result[target] = value;
        break;

      case 'baseUnit':
        result.baseUnit = normalizeUnit(value);
        break;

      case 'costPrice':
      case 'sellingPrice': {
        let num = parseFloat(value.replace(/[^0-9.\-]/g, ''));
        if (!isNaN(num)) {
          if (opts.stripGst) num = Math.round((num / (1 + opts.gstRate)) * 100) / 100;
          result[target] = num;
        }
        break;
      }

      case 'name+size': {
        // Split name from embedded size
        const split = splitNameAndSize(value);
        result.name = split.name;
        if (split.size) result.size = split.size;
        if (split.baseUnit) result.baseUnit = split.baseUnit;
        if (split.packSize) result.packSize = split.packSize;
        if (split.unitQty) result.unitQty = split.unitQty;
        break;
      }

      default:
        result[target] = value;
    }
  }

  // If no baseUnit was set and no size extracted, default to "each"
  if (!result.baseUnit && !result.size && !result.packSize) {
    result.baseUnit = 'each';
  }

  // Calculate per-unit cost for pack items
  if (result.unitQty && result.unitQty > 1 && result.costPrice) {
    result.costPerUnit = Math.round((result.costPrice / result.unitQty) * 100) / 100;
  }

  return result;
}

function splitNameAndSize(value) {
  // Pattern: "Product Name 1kg" or "Product Name 500g" or "Product Name 1.5L"
  const weightMatch = value.match(/^(.+?)\s+(\d+\.?\d*\s*(?:kg|g|L|l|ml|litre|liter)s?)$/i);
  if (weightMatch) {
    const size = weightMatch[2].replace(/\s+/g, '');
    return {
      name: weightMatch[1].trim(),
      size,
      baseUnit: inferBaseUnit(size),
    };
  }

  // Pattern: "Product Name 4x2L" or "Product Name 12x500ml"
  const packMatch = value.match(/^(.+?)\s+(\d+)\s*x\s*(\d+\.?\d*)\s*(kg|g|L|l|ml|litre|liter)s?$/i);
  if (packMatch) {
    const count = parseInt(packMatch[2]);
    const qty = parseFloat(packMatch[3]);
    const unit = packMatch[4].toLowerCase();
    const packSize = `${count}x${qty}${unit}`;
    const baseUnit = inferBaseUnit(`${qty}${unit}`);
    const unitQty = calculateUnitQty(count, qty, unit);

    return {
      name: packMatch[1].trim(),
      packSize,
      baseUnit,
      unitQty,
      size: packSize,
    };
  }

  return { name: value.trim() };
}

function inferBaseUnit(sizeStr) {
  const lower = sizeStr.toLowerCase();
  if (/kg/i.test(lower)) return 'kg';
  if (/\d+g/i.test(lower) && !/kg/i.test(lower)) return 'kg'; // grams → kg base
  if (/l|litre|liter/i.test(lower)) return 'L';
  if (/ml/i.test(lower)) return 'L'; // ml → L base
  return 'each';
}

function calculateUnitQty(count, qty, unit) {
  const lower = unit.toLowerCase();
  if (lower === 'kg') return count * qty;
  if (lower === 'g') return count * qty / 1000;
  if (lower === 'l' || lower === 'litre' || lower === 'liter') return count * qty;
  if (lower === 'ml') return count * qty / 1000;
  return count;
}

function normalizeUnit(value) {
  const lower = value.toLowerCase().trim();
  const map = {
    kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
    g: 'g', gram: 'g', grams: 'g',
    l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
    ml: 'ml', millilitre: 'ml', milliliter: 'ml',
    each: 'each', ea: 'each', unit: 'each', pcs: 'each', piece: 'each', pieces: 'each',
  };
  return map[lower] || value;
}

function summarizeRow(row, mapping) {
  const summary = {};
  for (const [col, mapInfo] of Object.entries(mapping)) {
    const target = typeof mapInfo === 'string' ? mapInfo : mapInfo?.target;
    if (target && target !== 'skip') {
      summary[col] = row[col];
    }
  }
  return summary;
}

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// Exported for reuse by the product import pipeline normalisation engine
export { normalizeUnit, splitNameAndSize, inferBaseUnit, calculateUnitQty };
