/**
 * Cohere Adapter Smoke Test (standalone script — NOT a Vitest file)
 *
 * Run manually: COHERE_API_KEY=xxx node server/tests/integration/cohere-smoke.js
 * Makes real API calls — uses trial key quota.
 */

import { embed, rerank, generate } from '../../src/services/ai/adapters/cohere.js';

const cosineSim = (a, b) => {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

async function smoke() {
  console.log('--- Cohere Embed (documents) ---');
  const products = ['Bulla Cream Cheese 250g', 'Smith Chips Original 175g', 'Organic Rolled Oats 1kg'];
  const embedResult = await embed(products, 'embed-english-v3.0', { inputType: 'search_document' });
  console.log(`Vectors: ${embedResult.vectors.length}, Dimensions: ${embedResult.vectors[0].length}, Tokens: ${embedResult.tokenCount}`);

  console.log('\n--- Cohere Embed (query) ---');
  const queryResult = await embed('CC 250 Bulla', 'embed-english-v3.0', { inputType: 'search_query' });
  console.log(`Query vector dimensions: ${queryResult.vectors[0].length}`);

  for (let i = 0; i < embedResult.vectors.length; i++) {
    const sim = cosineSim(queryResult.vectors[0], embedResult.vectors[i]);
    console.log(`  "${products[i]}": similarity = ${sim.toFixed(4)}`);
  }

  console.log('\n--- Cohere Rerank ---');
  const rerankResult = await rerank(
    'cream cheese 250g',
    ['Bulla Cream Cheese 250g', 'Bulla Cream Cheese 500g', 'Philadelphia Cream Cheese 250g', 'Smith Chips Original 175g'],
    'rerank-v3.5',
    { topN: 3 },
  );
  for (const r of rerankResult.results) {
    console.log(`  #${r.index} (${r.relevanceScore.toFixed(4)}): ${r.document}`);
  }

  console.log('\n--- Cohere Generate ---');
  const genResult = await generate(
    'You are a retail product classifier.',
    'Classify this product: "Bulla Australian Cream Cheese 250g". Return JSON: {category, subcategory}',
    'command-r',
    { maxTokens: 200 },
  );
  console.log(`Response: ${genResult.response}`);
  console.log(`Tokens: ${genResult.inputTokens} in, ${genResult.outputTokens} out`);

  console.log('\nAll smoke tests passed');
}

smoke().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
