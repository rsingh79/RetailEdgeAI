-- CreateTable
CREATE TABLE "ProductEmbedding" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embeddingText" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL DEFAULT 1024,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductEmbedding_tenantId_idx" ON "ProductEmbedding"("tenantId");

-- CreateIndex
CREATE INDEX "ProductEmbedding_productId_idx" ON "ProductEmbedding"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEmbedding_productId_model_key" ON "ProductEmbedding"("productId", "model");

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEmbedding" ADD CONSTRAINT "ProductEmbedding_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Add vector column (pgvector type, not supported by Prisma)
ALTER TABLE "ProductEmbedding" ADD COLUMN "embedding" vector(1024);

-- Create HNSW index for approximate nearest neighbor search
-- HNSW is faster than IVFFlat for small-medium datasets (<1M vectors)
-- m=16: connections per layer (default, good for <1M vectors)
-- ef_construction=64: build-time quality (higher = better index, slower build)
-- vector_cosine_ops: cosine similarity (best for normalised embeddings from Cohere)
CREATE INDEX "ProductEmbedding_embedding_hnsw_idx"
  ON "ProductEmbedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
