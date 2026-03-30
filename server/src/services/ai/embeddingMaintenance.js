// server/src/services/ai/embeddingMaintenance.js
// Embedding maintenance — keeps product embeddings in sync with the catalog.
// All functions are fire-and-forget — never block the caller.

import { embed as routerEmbed } from './aiServiceRouter.js';
import { storeEmbedding } from './vectorStore.js';

const EMBEDDING_MODEL = 'embed-english-v3.0';

/**
 * Embed a single product and store its vector.
 * Fire-and-forget — never blocks the caller.
 *
 * @param {object} product - { id, name, brand, category, baseUnit, tenantId }
 */
export async function embedProduct(product) {
  try {
    const text = buildEmbeddingText(product);
    if (!text) return;

    const result = await routerEmbed('product_matching_embed', text, {
      tenantId: product.tenantId,
      inputType: 'search_document',
    });

    if (result.vectors && result.vectors.length > 0) {
      await storeEmbedding({
        id: `${product.id}_${EMBEDDING_MODEL}`,
        tenantId: product.tenantId,
        productId: product.id,
        model: EMBEDDING_MODEL,
        embeddingText: text,
        vector: result.vectors[0],
        dimensions: result.vectors[0].length,
      });
    }
  } catch (err) {
    console.warn(`[EmbeddingMaintenance] Failed to embed product ${product.id}:`, err.message);
  }
}

/**
 * Embed multiple products in batch. More efficient than single calls.
 * Fire-and-forget.
 *
 * @param {object[]} products - Array of { id, name, brand, category, baseUnit, tenantId }
 */
export async function embedProductBatch(products) {
  if (!products.length) return;

  try {
    const texts = products.map(buildEmbeddingText);
    const BATCH_SIZE = 96;

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batchTexts = texts.slice(i, i + BATCH_SIZE);
      const batchProducts = products.slice(i, i + BATCH_SIZE);

      const result = await routerEmbed('product_matching_embed', batchTexts, {
        tenantId: batchProducts[0].tenantId,
        inputType: 'search_document',
      });

      if (result.vectors) {
        for (let j = 0; j < batchProducts.length; j++) {
          if (result.vectors[j]) {
            await storeEmbedding({
              id: `${batchProducts[j].id}_${EMBEDDING_MODEL}`,
              tenantId: batchProducts[j].tenantId,
              productId: batchProducts[j].id,
              model: EMBEDDING_MODEL,
              embeddingText: batchTexts[j],
              vector: result.vectors[j],
              dimensions: result.vectors[j].length,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[EmbeddingMaintenance] Batch embed failed:', err.message);
  }
}

function buildEmbeddingText(product) {
  const parts = [];
  if (product.name) parts.push(product.name);
  if (product.brand) parts.push(product.brand);
  if (product.category) parts.push(product.category);
  if (product.baseUnit) parts.push(product.baseUnit);
  return parts.join(' | ') || '';
}
