/**
 * ASAL Step 2 — Evaluation Benchmark
 *
 * Benchmarks Cohere embeddings against real RetailEdgeAI product data.
 * Answers three questions:
 *   1. Does Cohere place similar products near each other in vector space?
 *   2. Can embeddings catch matches that Fuse.js misses?
 *   3. Can embeddings distinguish between pack-size variants?
 *   4. Does Cohere Rerank improve candidate ordering?
 *
 * Run with:
 *   COHERE_API_KEY=your_key node server/scripts/asal-evaluation.js
 */

import { basePrisma } from '../src/lib/prisma.js';
import { embed, rerank } from '../src/services/ai/adapters/cohere.js';
import { storeEmbedding, findNearestProducts } from '../src/services/ai/vectorStore.js';
import Fuse from 'fuse.js';

const EMBEDDING_MODEL = 'embed-english-v3.0';
const BATCH_SIZE = 96; // Cohere's max batch size for embed

// ── Step 1: Load real products ──────────────────────────────────

const products = await basePrisma.product.findMany({
  where: { archivedAt: null },
  select: {
    id: true,
    name: true,
    category: true,
    baseUnit: true,
    barcode: true,
    tenantId: true,
  },
  take: 500,
});

console.log(`Loaded ${products.length} products`);

if (products.length < 20) {
  console.error('Need at least 20 products for meaningful evaluation. Aborting.');
  await basePrisma.$disconnect();
  process.exit(1);
}

// ── Step 2: Build embedding text ────────────────────────────────

function buildEmbeddingText(product) {
  const parts = [product.name];
  if (product.category) parts.push(product.category);
  if (product.baseUnit) parts.push(product.baseUnit);
  return parts.join(' | ');
}

// ── Step 3: Embed all products via Cohere (batch) ───────────────

const embeddingTexts = products.map(buildEmbeddingText);
const allVectors = [];

for (let i = 0; i < embeddingTexts.length; i += BATCH_SIZE) {
  const batch = embeddingTexts.slice(i, i + BATCH_SIZE);
  console.log(
    `Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(embeddingTexts.length / BATCH_SIZE)}...`,
  );
  const result = await embed(batch, EMBEDDING_MODEL, { inputType: 'search_document' });
  allVectors.push(...result.vectors);

  // Small delay to avoid rate limits on trial key
  if (i + BATCH_SIZE < embeddingTexts.length) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

console.log(`Embedded ${allVectors.length} products (${allVectors[0].length} dimensions)`);

// ── Step 4: Store embeddings in the database ────────────────────

for (let i = 0; i < products.length; i++) {
  await storeEmbedding({
    id: products[i].id + '_embed', // deterministic ID for idempotency
    tenantId: products[i].tenantId,
    productId: products[i].id,
    model: EMBEDDING_MODEL,
    embeddingText: embeddingTexts[i],
    vector: allVectors[i],
    dimensions: allVectors[i].length,
  });
}
console.log('All embeddings stored in database');

// ── Step 5: Run evaluation tests ────────────────────────────────

// ═══ TEST A: Self-match accuracy ═══

console.log('\n═══ TEST A: Self-match accuracy ═══');
let selfMatchCount = 0;
const sampleSize = Math.min(50, products.length);
const sampleProducts = products.slice(0, sampleSize);

for (const product of sampleProducts) {
  const queryResult = await embed(buildEmbeddingText(product), EMBEDDING_MODEL, {
    inputType: 'search_query',
  });

  const nearest = await findNearestProducts({
    tenantId: product.tenantId,
    queryVector: queryResult.vectors[0],
    model: EMBEDDING_MODEL,
    limit: 1,
    minSimilarity: 0.0,
  });

  if (nearest.length > 0 && nearest[0].productId === product.id) {
    selfMatchCount++;
  } else {
    console.log(
      `  MISS: "${product.name}" → matched "${nearest[0]?.embeddingText || 'nothing'}" (sim: ${nearest[0]?.similarity?.toFixed(4) || 'N/A'})`,
    );
  }

  // Rate limit protection
  await new Promise((r) => setTimeout(r, 200));
}

const selfMatchRate = ((selfMatchCount / sampleSize) * 100).toFixed(1);
console.log(`Self-match rate: ${selfMatchCount}/${sampleSize} (${selfMatchRate}%)`);
console.log(selfMatchRate >= 95 ? '✅ PASS (>= 95%)' : '❌ FAIL (< 95%)');

// ═══ TEST B: Abbreviation and variant matching ═══

console.log('\n═══ TEST B: Abbreviation and variant matching ═══');

function generateInvoiceVariants(product) {
  const variants = [];
  const name = product.name;

  // Abbreviation: take first 2-3 chars of each word
  const abbrev = name
    .split(/\s+/)
    .map((w) => w.substring(0, 3))
    .join(' ');
  variants.push({ query: abbrev, description: 'abbreviated' });

  // Reordered: reverse word order
  const reordered = name.split(/\s+/).reverse().join(' ');
  variants.push({ query: reordered, description: 'reordered' });

  // With supplier noise: add typical invoice noise
  variants.push({ query: `${name} 1x CTN`, description: 'with pack noise' });

  // Lowercase no spaces
  variants.push({ query: name.toLowerCase().replace(/\s+/g, ''), description: 'compressed' });

  return variants;
}

const testProducts = sampleProducts.slice(0, 20);
let embeddingHits = 0;
let fuseHits = 0;
let totalTests = 0;

// Set up Fuse.js with the same config as CatalogMatcher
const fuseItems = products.map((p) => ({
  id: p.id,
  name: p.name || '',
  category: p.category || '',
  baseUnit: p.baseUnit || '',
}));

const fuse = new Fuse(fuseItems, {
  keys: [
    { name: 'name', weight: 0.5 },
    { name: 'category', weight: 0.25 },
    { name: 'baseUnit', weight: 0.15 },
  ],
  threshold: 0.3,
  includeScore: true,
});

for (const product of testProducts) {
  const variants = generateInvoiceVariants(product);

  for (const variant of variants) {
    totalTests++;

    // Embedding match
    const queryResult = await embed(variant.query, EMBEDDING_MODEL, { inputType: 'search_query' });
    const nearest = await findNearestProducts({
      tenantId: product.tenantId,
      queryVector: queryResult.vectors[0],
      model: EMBEDDING_MODEL,
      limit: 5,
      minSimilarity: 0.5,
    });
    const embeddingMatch = nearest.some((n) => n.productId === product.id);
    if (embeddingMatch) embeddingHits++;

    // Fuse.js match
    const fuseResults = fuse.search(variant.query);
    const fuseMatch = fuseResults.slice(0, 5).some((r) => r.item.id === product.id);
    if (fuseMatch) fuseHits++;

    if (embeddingMatch !== fuseMatch) {
      const winner = embeddingMatch ? 'EMBEDDING' : 'FUSE.JS';
      console.log(
        `  ${winner} wins: "${variant.query}" (${variant.description}) → "${product.name}"`,
      );
    }

    await new Promise((r) => setTimeout(r, 200));
  }
}

console.log(
  `\nEmbedding matches: ${embeddingHits}/${totalTests} (${((embeddingHits / totalTests) * 100).toFixed(1)}%)`,
);
console.log(
  `Fuse.js matches:   ${fuseHits}/${totalTests} (${((fuseHits / totalTests) * 100).toFixed(1)}%)`,
);
console.log(`Embedding advantage: ${embeddingHits - fuseHits} more matches`);

// ═══ TEST C: Pack-size discrimination ═══

console.log('\n═══ TEST C: Pack-size discrimination ═══');

const sizePattern = /(\d+)\s*(g|kg|ml|l|pack|pk)\b/i;
const productsWithSizes = products.filter((p) => sizePattern.test(p.name));

console.log(`Found ${productsWithSizes.length} products with size indicators`);

let sizeAccuracy = 'N/A';

if (productsWithSizes.length >= 2) {
  const sizeTestProducts = productsWithSizes.slice(0, 10);
  let correctSizeMatches = 0;

  for (const product of sizeTestProducts) {
    const queryResult = await embed(buildEmbeddingText(product), EMBEDDING_MODEL, {
      inputType: 'search_query',
    });

    const nearest = await findNearestProducts({
      tenantId: product.tenantId,
      queryVector: queryResult.vectors[0],
      model: EMBEDDING_MODEL,
      limit: 3,
      minSimilarity: 0.5,
    });

    if (nearest[0]?.productId === product.id) {
      correctSizeMatches++;
    } else {
      console.log(
        `  CONFUSION: "${product.name}" → top match: "${nearest[0]?.embeddingText}" (sim: ${nearest[0]?.similarity?.toFixed(4)})`,
      );
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  sizeAccuracy = ((correctSizeMatches / sizeTestProducts.length) * 100).toFixed(1);
  console.log(
    `Size discrimination: ${correctSizeMatches}/${sizeTestProducts.length} (${sizeAccuracy}%)`,
  );
  console.log(
    sizeAccuracy >= 80 ? '✅ PASS (>= 80%)' : '⚠️ CAUTION (< 80% — may confuse size variants)',
  );
} else {
  console.log('⏭️ SKIPPED — not enough products with size variants to test');
}

// ═══ TEST D: Reranking quality ═══

console.log('\n═══ TEST D: Reranking quality ═══');

const rerankTestProducts = sampleProducts.slice(0, 10);
let rerankTop1 = 0;
let rerankTop3 = 0;

for (const product of rerankTestProducts) {
  // Candidates: the correct product + 9 random others
  const distractors = products.filter((p) => p.id !== product.id).slice(0, 9);
  const candidates = [product, ...distractors].sort(() => Math.random() - 0.5); // shuffle
  const candidateTexts = candidates.map(buildEmbeddingText);
  const correctIndex = candidates.findIndex((c) => c.id === product.id);

  // Query with a noisy version of the product name (first 2 words only)
  const noisyQuery = product.name.split(/\s+/).slice(0, 2).join(' ');

  const result = await rerank(noisyQuery, candidateTexts, 'rerank-v3.5', { topN: 3 });

  const top1Match = result.results[0]?.index === correctIndex;
  const top3Match = result.results.some((r) => r.index === correctIndex);

  if (top1Match) rerankTop1++;
  if (top3Match) rerankTop3++;

  if (!top3Match) {
    console.log(
      `  MISS: "${noisyQuery}" → correct was "${buildEmbeddingText(product)}" at position ${correctIndex}`,
    );
    console.log(
      `    Top 3: ${result.results.map((r) => `"${candidateTexts[r.index]}" (${r.relevanceScore.toFixed(3)})`).join(', ')}`,
    );
  }

  await new Promise((r) => setTimeout(r, 300));
}

console.log(`Rerank Top-1 accuracy: ${rerankTop1}/10 (${rerankTop1 * 10}%)`);
console.log(`Rerank Top-3 accuracy: ${rerankTop3}/10 (${rerankTop3 * 10}%)`);
console.log(rerankTop3 >= 8 ? '✅ PASS (>= 80% top-3)' : '⚠️ CAUTION (< 80% top-3)');

// ── Step 6: Print summary ───────────────────────────────────────

console.log('\n══════════════════════════════════════');
console.log('        EVALUATION SUMMARY');
console.log('══════════════════════════════════════');
console.log(`Products evaluated: ${products.length}`);
console.log(`Embedding model: ${EMBEDDING_MODEL}`);
console.log(`Vector dimensions: ${allVectors[0].length}`);
console.log('');
console.log(`Test A (Self-match):     ${selfMatchRate}% ${selfMatchRate >= 95 ? '✅' : '❌'}`);
console.log(`Test B (Embedding):      ${((embeddingHits / totalTests) * 100).toFixed(1)}%`);
console.log(`Test B (Fuse.js):        ${((fuseHits / totalTests) * 100).toFixed(1)}%`);
console.log(`Test B (Embedding edge): +${embeddingHits - fuseHits} matches`);
console.log(
  `Test C (Size disc.):     ${productsWithSizes.length >= 2 ? sizeAccuracy + '%' : 'SKIPPED'}`,
);
console.log(`Test D (Rerank top-3):   ${rerankTop3 * 10}% ${rerankTop3 >= 8 ? '✅' : '⚠️'}`);
console.log('');

const overallPass = selfMatchRate >= 95 && embeddingHits >= fuseHits && rerankTop3 >= 7;
console.log(
  overallPass
    ? '✅ RECOMMENDATION: Proceed with CatalogMatcher integration'
    : '⚠️ RECOMMENDATION: Review results before proceeding — some tests below threshold',
);

console.log('\nEmbeddings stored in ProductEmbedding table — ready for integration.');
console.log('══════════════════════════════════════');

await basePrisma.$disconnect();
