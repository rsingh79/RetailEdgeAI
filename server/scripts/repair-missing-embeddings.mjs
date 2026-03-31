/**
 * Repair 4: Embed products that are missing embeddings
 *
 * Uses the existing embedProductBatch() from embeddingMaintenance.js
 * which processes in batches of 96 via the AI Service Router.
 */
import { PrismaClient } from '../src/generated/prisma/client.js';
import { embedProductBatch } from '../src/services/ai/embeddingMaintenance.js';

const prisma = new PrismaClient();

async function repair() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('REPAIR 4: Embed products missing embeddings');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find active products with no embedding
  const unembedded = await prisma.$queryRaw`
    SELECT p.id, p.name, p.category, p."baseUnit", p."tenantId"
    FROM "Product" p
    LEFT JOIN "ProductEmbedding" pe ON pe."productId" = p.id
    WHERE p."archivedAt" IS NULL
      AND pe.id IS NULL
    ORDER BY p."createdAt"
  `;

  console.log(`Found ${unembedded.length} products without embeddings\n`);

  if (unembedded.length === 0) {
    console.log('All products already have embeddings.');
    await prisma.$disconnect();
    return;
  }

  // Group by tenant
  const byTenant = new Map();
  for (const product of unembedded) {
    if (!byTenant.has(product.tenantId)) {
      byTenant.set(product.tenantId, []);
    }
    byTenant.get(product.tenantId).push(product);
  }

  let totalEmbedded = 0;
  for (const [tenantId, products] of byTenant) {
    console.log(`Embedding ${products.length} products for tenant ${tenantId}...`);

    // Process in chunks to show progress
    const CHUNK_SIZE = 96;
    for (let i = 0; i < products.length; i += CHUNK_SIZE) {
      const chunk = products.slice(i, i + CHUNK_SIZE);
      try {
        await embedProductBatch(chunk);
        totalEmbedded += chunk.length;
        console.log(`  Embedded ${Math.min(i + CHUNK_SIZE, products.length)}/${products.length}`);
      } catch (err) {
        console.error(`  Error at batch ${Math.floor(i / CHUNK_SIZE) + 1}: ${err.message}`);
        // Continue with next batch
      }
    }
  }

  console.log(`\nEmbedded ${totalEmbedded} products total.\n`);

  // Verification
  const stats = await prisma.$queryRaw`
    SELECT
      COUNT(DISTINCT p.id) as "totalActive",
      COUNT(DISTINCT pe."productId") as "withEmbeddings",
      COUNT(DISTINCT p.id) - COUNT(DISTINCT pe."productId") as "withoutEmbeddings"
    FROM "Product" p
    LEFT JOIN "ProductEmbedding" pe ON pe."productId" = p.id
    WHERE p."archivedAt" IS NULL
  `;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('POST-REPAIR EMBEDDING STATUS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const row of stats) {
    console.log(`  Total active products: ${row.totalActive}`);
    console.log(`  With embeddings: ${row.withEmbeddings}`);
    console.log(`  Without embeddings: ${row.withoutEmbeddings}`);
  }

  await prisma.$disconnect();
}

repair().catch(err => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
