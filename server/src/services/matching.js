/**
 * Product matching engine.
 *
 * Matches invoice line items to the product catalog using four strategies:
 *   1. SupplierProductMapping lookup (learned from previous invoices)
 *   2. Barcode exact match
 *   3. Fuzzy name match (Jaccard word overlap)
 *   4. AI (Claude) fallback when confidence < 80%
 */

import { calculateSuggestedPrice } from './pricing.js';
import { trackedClaudeCall } from './apiUsageTracker.js';

const CONFIDENCE_THRESHOLD = 0.8;
const CANDIDATE_MIN_SCORE = 0.8;

// ── Fuzzy matching ────────────────────────────────────────────

/**
 * Lightweight plural stemmer for retail/grocery product names.
 * Handles common English plurals without a full NLP library.
 * Intentionally conservative to avoid over-stemming short grocery words.
 */
function stem(word) {
  if (word.length <= 3) return word;

  // Words that end in 's'/'es' but are NOT plurals
  const exceptions = new Set([
    'grass', 'glass', 'chess', 'dress', 'press', 'stress',
    'cheese', 'grease', 'lease', 'crease', 'moose', 'goose',
    'rice', 'dice', 'mice', 'spice', 'juice', 'sauce',
    'lettuce', 'produce', 'spruce',
    'less', 'process', 'access', 'express', 'address',
    'hummus', 'couscous', 'asparagus', 'citrus', 'hibiscus',
    'molasses', 'pancreas',
  ]);
  if (exceptions.has(word)) return word;

  // -ies → -y  (berries→berry, cherries→cherry)
  if (word.length > 4 && word.endsWith('ies')) {
    return word.slice(0, -3) + 'y';
  }

  // -oes → -o  (tomatoes→tomato, potatoes→potato, mangoes→mango)
  if (word.endsWith('oes')) {
    return word.slice(0, -2);
  }

  // -ses → -se  (cases→case, pulses→pulse)
  if (word.endsWith('ses')) {
    return word.slice(0, -1);
  }

  // -ves → irregular lookup (halves→half, loaves→loaf)
  const vesMap = {
    halves: 'half', loaves: 'loaf', knives: 'knife',
    leaves: 'leaf', shelves: 'shelf',
  };
  if (word.endsWith('ves') && vesMap[word]) {
    return vesMap[word];
  }

  // -es after sibilants (boxes→box, dishes→dish, bunches→bunch, peaches→peach)
  if (word.endsWith('es')) {
    const base = word.slice(0, -2);
    if (base.endsWith('sh') || base.endsWith('ch') || base.endsWith('x') ||
        base.endsWith('z') || base.endsWith('ss')) {
      return base;
    }
  }

  // plain -s (kernels→kernel, seeds→seed, almonds→almond, nuts→nut)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    return word.slice(0, -1);
  }

  return word;
}

/** Stop words: noise tokens that don't help identify a product. */
const STOP_WORDS = new Set([
  // Units & pack sizes
  'kg', 'g', 'mg', 'ml', 'l', 'oz', 'lb',
  // Pack descriptors
  'pack', 'box', 'bag', 'tray', 'carton', 'case', 'ctn', 'pkt', 'tin', 'jar', 'bottle',
  // Countries / origins
  'australian', 'imported', 'local',
  // Qualifiers that never identify a product
  'brand', 'premium', 'bulk', 'wholesale', 'approx',
]);

function tokenize(str) {
  return str
    .toLowerCase()
    .replace(/-/g, ' ')                 // normalize hyphens to spaces (Shopify handles, etc.)
    .replace(/[^a-z0-9\s]/g, '')        // strip remaining punctuation
    .split(/\s+/)
    .filter(Boolean)
    .map(stem)
    .filter(w => !STOP_WORDS.has(w) && !/^\d+\w*$/.test(w));
}

/**
 * Combined similarity between an invoice description and a product name.
 * Uses the HIGHER of two scores:
 *   - Jaccard: intersection / union (penalises extra words on both sides)
 *   - Containment: what fraction of the product name words appear in the
 *     invoice description. Invoice lines often have extra pack-size info
 *     (e.g. "Organic Cacao Powder 2 x 3kg") so containment handles this well.
 * Returns a value between 0 and 1.
 */
function fuzzyNameScore(description, productName) {
  const descWords = new Set(tokenize(description));
  const prodWords = new Set(tokenize(productName));
  if (descWords.size === 0 || prodWords.size === 0) return 0;

  let intersection = 0;
  for (const w of prodWords) {
    if (descWords.has(w)) intersection++;
  }

  const jaccard = intersection / new Set([...descWords, ...prodWords]).size;
  const containment = intersection / prodWords.size; // how much of the product name is in the description
  return Math.max(jaccard, containment);
}

// ── Single-line matching ──────────────────────────────────────

/**
 * Match a single invoice line to the product catalog.
 * Returns an array of candidate matches sorted by confidence (desc).
 */
async function matchSingleLine(prisma, line, supplierId) {
  const candidates = [];

  // Strategy 1: SupplierProductMapping lookup
  if (supplierId) {
    const mappings = await prisma.supplierProductMapping.findMany({
      where: { supplierId },
    });
    for (const mapping of mappings) {
      const score = fuzzyNameScore(line.description, mapping.supplierDescription);
      if (score >= 0.6) {
        candidates.push({
          productId: mapping.productId,
          confidence: Math.min(mapping.confidence, score + 0.2), // boost from saved mapping
          matchReason: 'supplier_mapping',
          matchingTokens: 0,
        });
      }
    }
  }

  // Strategy 2: Barcode match
  if (line.description) {
    // Try to find products by barcode (if we have barcode-like data)
    const products = await prisma.product.findMany({
      where: { barcode: { not: null } },
      select: { id: true, barcode: true },
    });
    for (const product of products) {
      if (product.barcode && line.description.includes(product.barcode)) {
        // Only add if not already a candidate
        if (!candidates.some((c) => c.productId === product.id)) {
          candidates.push({
            productId: product.id,
            confidence: 1.0,
            matchReason: 'barcode',
            matchingTokens: 0,
          });
        }
      }
    }
  }

  // Strategy 3: Fuzzy name match (with token counting for tie-breaking)
  const descTokens = new Set(tokenize(line.description));
  const allProducts = await prisma.product.findMany({
    select: { id: true, name: true },
  });
  for (const product of allProducts) {
    if (candidates.some((c) => c.productId === product.id)) continue; // already matched
    const prodTokens = new Set(tokenize(product.name));
    if (prodTokens.size === 0) continue;

    let intersection = 0;
    for (const w of prodTokens) {
      if (descTokens.has(w)) intersection++;
    }

    const union = new Set([...descTokens, ...prodTokens]).size;
    const jaccard = union > 0 ? intersection / union : 0;
    const containment = intersection / prodTokens.size;
    const score = Math.max(jaccard, containment);

    if (score >= CANDIDATE_MIN_SCORE) {
      candidates.push({
        productId: product.id,
        confidence: score,
        matchReason: 'fuzzy_name',
        matchingTokens: intersection,
      });
    }
  }

  // Sort by confidence descending; break ties by number of matching tokens
  // No hard cap — return all candidates that passed the 0.6 score threshold
  candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (b.matchingTokens || 0) - (a.matchingTokens || 0);
  });
  return candidates;
}

// ── Match record creation ─────────────────────────────────────

/**
 * Create InvoiceLineMatch records for all active variants of a product.
 * Calculates newCost from the invoice line and suggestedPrice from pricing rules.
 */
// Exported for unit testing
export { fuzzyNameScore, tokenize, stem };

export async function createMatchRecords(prisma, lineId, productId, line, confidence, matchReason, isManual, userId) {
  // ── Dedup guard: skip if matches already exist for this line + product ──
  const existingCount = await prisma.invoiceLineMatch.count({
    where: { invoiceLineId: lineId, productId },
  });
  if (existingCount > 0) return [];

  const product = await prisma.product.findFirst({
    where: { id: productId },
    include: {
      variants: {
        where: { isActive: true },
        include: { store: true },
      },
    },
  });

  if (!product) return [];

  // Get the invoice for supplierId (needed by pricing service)
  const invoiceLine = await prisma.invoiceLine.findFirst({
    where: { id: lineId },
    include: { invoice: true },
  });
  const supplierId = invoiceLine?.invoice?.supplierId || null;

  const baseUnitCost = line.baseUnitCost || line.unitPrice;
  const matchData = [];

  if (product.variants.length > 0) {
    // Create match records per variant (store-level pricing)
    for (const variant of product.variants) {
      const newCost = Math.round(baseUnitCost * variant.unitQty * 100) / 100;
      const suggestedPrice = await calculateSuggestedPrice(prisma, variant, newCost, product, supplierId);

      const suggestedRounded = Math.round(suggestedPrice * 100) / 100;
      // Flag for export when the new sell price differs from the current sell price
      const exportFlagged = variant.salePrice != null && suggestedRounded !== variant.salePrice;

      matchData.push({
        invoiceLineId: lineId,
        productVariantId: variant.id,
        productId: product.id,
        confidence,
        matchReason,
        isManual: isManual || false,
        matchedByUserId: userId || null,
        previousCost: variant.currentCost,
        newCost,
        currentPrice: variant.salePrice,
        suggestedPrice: suggestedRounded,
        approvedPrice: suggestedRounded,
        exportFlagged,
        status: 'PENDING',
      });
    }
  } else {
    // No variants — create a product-level match record
    const newCost = Math.round(baseUnitCost * 100) / 100;
    const previousCost = product.costPrice || 0;
    const currentPrice = product.sellingPrice || 0;

    // Simple margin-based suggestion if no pricing rules apply
    const suggestedPrice = currentPrice > 0 ? currentPrice : Math.round(newCost * 1.3 * 100) / 100;

    // Flag for export when the new sell price differs from the current sell price
    const exportFlagged = currentPrice > 0 && suggestedPrice !== currentPrice;

    matchData.push({
      invoiceLineId: lineId,
      productVariantId: null,
      productId: product.id,
      confidence,
      matchReason,
      isManual: isManual || false,
      matchedByUserId: userId || null,
      previousCost,
      newCost,
      currentPrice,
      suggestedPrice,
      approvedPrice: suggestedPrice,
      exportFlagged,
      status: 'PENDING',
    });
  }

  if (matchData.length > 0) {
    await prisma.invoiceLineMatch.createMany({ data: matchData });
  }

  // Update line status based on confidence
  const lineStatus = confidence >= CONFIDENCE_THRESHOLD ? 'MATCHED' : 'NEEDS_REVIEW';
  await prisma.invoiceLine.update({
    where: { id: lineId },
    data: { status: lineStatus },
  });

  return matchData;
}

// ── AI batch matching ────────────────────────────────────────

/**
 * Batch AI matching: sends ALL unmatched invoice lines + the FULL product catalog
 * to Claude in a single API call. Returns up to 3 candidate matches per line
 * with varying confidence levels so the user can choose in the Review screen.
 *
 * Returns a Map<lineId, Array<{ productId, confidence, matchReason }>>
 */
async function aiBatchMatch(prisma, unmatchedLines, tenantId) {
  if (!process.env.ANTHROPIC_API_KEY || unmatchedLines.length === 0) return new Map();

  try {
    // Fetch full product catalog
    const allProducts = await prisma.product.findMany({
      select: { id: true, name: true, category: true, barcode: true, source: true },
    });

    if (allProducts.length === 0) return new Map();

    // Build product catalog list
    const catalogList = allProducts.map((p, i) =>
      `${i + 1}. "${p.name}" (category: ${p.category || 'N/A'}, source: ${p.source || 'N/A'}${p.barcode ? `, barcode: ${p.barcode}` : ''})`
    ).join('\n');

    // Build unmatched lines list
    const linesList = unmatchedLines.map((item, i) => {
      const l = item.line;
      const bestScore = item.bestFuzzyScore ? `${(item.bestFuzzyScore * 100).toFixed(0)}%` : '0%';
      return `${i + 1}. "${l.description}" (pack: ${l.packSize || 'N/A'}, qty: ${l.quantity || 'N/A'}, unit price: $${l.unitPrice || 'N/A'}, best fuzzy score: ${bestScore})`;
    }).join('\n');

    const prompt = `You are a product matching assistant for a retail/grocery store. Match each invoice line to products in the catalog.

PRODUCT CATALOG (${allProducts.length} products):
${catalogList}

INVOICE LINES TO MATCH (${unmatchedLines.length} lines):
${linesList}

For each invoice line, find ALL reasonable candidate matches from the catalog, ranked by confidence. Consider:
- Product name similarity (ignore pack sizes, weights, and country of origin in the invoice description)
- Category relevance
- A "Sunflower Kernels" invoice line should match "Sunflower Kernel" not "Pistachio Kernels"
- Only include candidates with confidence >= 0.6 (skip weak/irrelevant matches)

Reply with ONLY a JSON array, one entry per invoice line (in order):
[{"line": 1, "matches": [{"product": <catalog number>, "confidence": <0.0-1.0>, "reason": "<brief>"}]}]
Each "matches" array should be sorted by confidence (highest first).
Use an empty matches array [] if no catalog item is a reasonable match.`;

    const response = await trackedClaudeCall({
      tenantId,
      userId: null,
      endpoint: 'product_matching',
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      requestSummary: {
        invoiceLineCount: unmatchedLines.length,
        productCount: allProducts.length,
      },
    });

    const text = response.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    if (!text) return new Map();

    // Parse the JSON array response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return new Map();

    const aiResults = JSON.parse(jsonMatch[0]);
    const resultMap = new Map();

    for (const r of aiResults) {
      const lineIdx = r.line - 1;
      if (lineIdx < 0 || lineIdx >= unmatchedLines.length) continue;
      if (!Array.isArray(r.matches) || r.matches.length === 0) continue;

      const candidates = [];
      for (const m of r.matches) {
        if (m.product == null || m.product < 1 || m.product > allProducts.length) continue;
        const chosenProduct = allProducts[m.product - 1];
        const aiConfidence = Math.min(parseFloat(m.confidence) || 0.85, 0.95);
        if (aiConfidence < CANDIDATE_MIN_SCORE) continue; // same threshold as fuzzy — skip weak matches
        candidates.push({
          productId: chosenProduct.id,
          confidence: aiConfidence,
          matchReason: 'ai_match',
        });
      }

      if (candidates.length > 0) {
        resultMap.set(unmatchedLines[lineIdx].line.id, candidates);
      }
    }

    return resultMap;
  } catch (err) {
    console.error('AI batch match failed:', err.message);
    return new Map();
  }
}

// ── Main orchestrator ─────────────────────────────────────────

/**
 * Run auto-matching on all lines of an invoice.
 *
 * Phase 1: Deterministic matching (supplier mapping, barcode, fuzzy name) for all lines.
 * Phase 2: Batch AI matching — collects ALL low-confidence lines and sends them with the
 *          FULL product catalog to Claude in a single API call for smarter matching.
 */
export async function matchInvoiceLines(prisma, invoice) {
  const results = [];
  const tenantId = invoice.tenantId || null;

  // Phase 1: Deterministic matching for all lines
  const lineResults = []; // { line, candidates, best }
  for (const line of invoice.lines) {
    const candidates = await matchSingleLine(prisma, line, invoice.supplierId);
    const best = candidates.length > 0 ? candidates[0] : null;
    lineResults.push({ line, candidates, best });
  }

  // Phase 2: Batch AI matching for low-confidence lines
  const unmatchedLines = lineResults
    .filter((r) => r.best && r.best.confidence < CONFIDENCE_THRESHOLD)
    .map((r) => ({
      line: r.line,
      bestFuzzyScore: r.best.confidence,
    }));

  // Also include lines with zero candidates — AI might find matches fuzzy missed entirely
  const noMatchLines = lineResults
    .filter((r) => !r.best)
    .map((r) => ({
      line: r.line,
      bestFuzzyScore: 0,
    }));

  const allUnmatched = [...unmatchedLines, ...noMatchLines];
  const aiResults = await aiBatchMatch(prisma, allUnmatched, tenantId);

  // Phase 3: Merge fuzzy + AI candidates and create match records for all
  for (const { line, candidates, best } of lineResults) {
    const aiCandidates = aiResults.get(line.id) || [];

    // Merge: start with fuzzy candidates, add AI candidates (skip duplicates)
    const seenProductIds = new Set(candidates.map((c) => c.productId));
    const merged = [...candidates];
    for (const aiC of aiCandidates) {
      if (!seenProductIds.has(aiC.productId)) {
        merged.push(aiC);
        seenProductIds.add(aiC.productId);
      } else {
        // AI found same product — use higher confidence
        const existing = merged.find((c) => c.productId === aiC.productId);
        if (existing && aiC.confidence > existing.confidence) {
          existing.confidence = aiC.confidence;
          existing.matchReason = 'ai_match';
        }
      }
    }

    // Sort by confidence descending
    merged.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return (b.matchingTokens || 0) - (a.matchingTokens || 0);
    });

    // Filter to only candidates with confidence >= 60%
    const qualified = merged.filter((c) => c.confidence >= CANDIDATE_MIN_SCORE);

    if (qualified.length > 0) {
      // Create match records for qualified candidates (user picks in Review screen)
      for (const candidate of qualified) {
        await createMatchRecords(prisma, line.id, candidate.productId, line, candidate.confidence, candidate.matchReason, false, null);
      }
      results.push({ lineId: line.id, matched: true, confidence: qualified[0].confidence, candidates: qualified });
    } else {
      // No match found — mark as NEEDS_REVIEW
      await prisma.invoiceLine.update({
        where: { id: line.id },
        data: { status: 'NEEDS_REVIEW' },
      });
      results.push({ lineId: line.id, matched: false, candidates: [] });
    }
  }

  return results;
}
