import { basePrisma } from '../../lib/prisma.js';

/**
 * Store an embedding for a product.
 * Uses raw SQL because Prisma doesn't support the vector type.
 *
 * @param {object} params
 * @param {string} params.id - CUID for the record
 * @param {string} params.tenantId
 * @param {string} params.productId
 * @param {string} params.model - embedding model name
 * @param {string} params.embeddingText - the text that was embedded
 * @param {number[]} params.vector - the embedding vector (array of floats)
 * @param {number} params.dimensions - vector dimensions (default 1024)
 * @param {object} prismaClient - tenant-scoped or base prisma client
 */
export async function storeEmbedding(
  { id, tenantId, productId, model, embeddingText, vector, dimensions = 1024 },
  prismaClient = basePrisma,
) {
  const vectorStr = `[${vector.join(',')}]`;

  await prismaClient.$executeRawUnsafe(
    `
    INSERT INTO "ProductEmbedding" ("id", "tenantId", "productId", "model", "embeddingText", "embedding", "dimensions", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6::vector, $7, NOW(), NOW())
    ON CONFLICT ("productId", "model")
    DO UPDATE SET "embedding" = $6::vector, "embeddingText" = $5, "updatedAt" = NOW()
  `,
    id,
    tenantId,
    productId,
    model,
    embeddingText,
    vectorStr,
    dimensions,
  );
}

/**
 * Find the nearest products to a query vector using cosine similarity.
 * Returns products ordered by similarity (highest first).
 *
 * @param {object} params
 * @param {string} params.tenantId - scope to this tenant's products
 * @param {number[]} params.queryVector - the query embedding vector
 * @param {string} params.model - only compare against embeddings from this model
 * @param {number} params.limit - max results to return (default 10)
 * @param {number} params.minSimilarity - minimum cosine similarity threshold (default 0.5)
 * @param {object} prismaClient - tenant-scoped or base prisma client
 * @returns {Promise<Array<{productId: string, similarity: number, embeddingText: string}>>}
 */
export async function findNearestProducts(
  { tenantId, queryVector, model, limit = 10, minSimilarity = 0.5 },
  prismaClient = basePrisma,
) {
  const vectorStr = `[${queryVector.join(',')}]`;

  const results = await prismaClient.$queryRawUnsafe(
    `
    SELECT
      pe."productId",
      pe."embeddingText",
      1 - (pe."embedding" <=> $1::vector) as similarity
    FROM "ProductEmbedding" pe
    WHERE pe."tenantId" = $2
      AND pe."model" = $3
      AND 1 - (pe."embedding" <=> $1::vector) >= $4
    ORDER BY pe."embedding" <=> $1::vector
    LIMIT $5
  `,
    vectorStr,
    tenantId,
    model,
    minSimilarity,
    limit,
  );

  return results.map((r) => ({
    productId: r.productId,
    similarity: parseFloat(r.similarity),
    embeddingText: r.embeddingText,
  }));
}

/**
 * Check if a product has an embedding for a given model.
 */
export async function hasEmbedding(productId, model, prismaClient = basePrisma) {
  const count = await prismaClient.productEmbedding.count({
    where: { productId, model },
  });
  return count > 0;
}

/**
 * Delete all embeddings for a tenant (useful for re-embedding after model change).
 */
export async function deleteAllEmbeddings(tenantId, model, prismaClient = basePrisma) {
  return await prismaClient.productEmbedding.deleteMany({
    where: { tenantId, model },
  });
}

/**
 * Get embedding stats for a tenant.
 */
export async function getEmbeddingStats(tenantId, prismaClient = basePrisma) {
  const total = await prismaClient.productEmbedding.count({ where: { tenantId } });
  const byModel = await prismaClient.productEmbedding.groupBy({
    by: ['model'],
    where: { tenantId },
    _count: true,
  });
  return { total, byModel: byModel.map((g) => ({ model: g.model, count: g._count })) };
}
