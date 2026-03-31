/**
 * Repair 2: Fix products whose source was overwritten to "Shopify" by the sync
 *
 * These 238 products were imported via CSV_UPLOAD from "Abacus POS" but the
 * Shopify sync overwrote their source to "Shopify".
 *
 * Safe to restore: 202 products with NO Shopify variants (pure POS products).
 * Skipped: 36 products that gained Shopify variants — these are cross-source
 * and changing their source could break the Shopify sync linkage.
 */
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient();

async function repair() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('REPAIR 2: Fix overwritten product sources');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find all products marked Shopify but imported via CSV_UPLOAD
  const mismatchedProducts = await prisma.$queryRaw`
    SELECT p.id, p.name, p.source, ij."sourceType"::text as "importSourceType",
           ij."sourceName" as "importSourceName",
           (SELECT COUNT(*) FROM "ProductVariant" pv
            WHERE pv."productId" = p.id AND pv."shopifyVariantId" IS NOT NULL) as "shopifyVariantCount"
    FROM "Product" p
    JOIN "ImportJob" ij ON p."importId" = ij.id
    WHERE p.source = 'Shopify'
      AND p."archivedAt" IS NULL
      AND ij."sourceType"::text = 'CSV_UPLOAD'
    ORDER BY p.name
  `;

  console.log(`Found ${mismatchedProducts.length} products marked Shopify from CSV_UPLOAD\n`);

  const safeToRestore = mismatchedProducts.filter(p => Number(p.shopifyVariantCount) === 0);
  const crossSource = mismatchedProducts.filter(p => Number(p.shopifyVariantCount) > 0);

  console.log(`  Safe to restore (no Shopify variants): ${safeToRestore.length}`);
  console.log(`  Cross-source (has Shopify variants, SKIPPING): ${crossSource.length}\n`);

  if (crossSource.length > 0) {
    console.log('Cross-source products (NOT changing, needs manual review):');
    for (const p of crossSource) {
      console.log(`  - "${p.name}" (${p.shopifyVariantCount} Shopify variants)`);
    }
    console.log('');
  }

  if (safeToRestore.length === 0) {
    console.log('No products to restore.');
    await prisma.$disconnect();
    return;
  }

  // Restore source to the import job's sourceName (should be "Abacus POS")
  const idsToRestore = safeToRestore.map(p => p.id);
  const correctSource = safeToRestore[0].importSourceName || 'Abacus POS';

  console.log(`Restoring ${safeToRestore.length} products to source="${correctSource}"...`);

  const result = await prisma.product.updateMany({
    where: { id: { in: idsToRestore } },
    data: { source: correctSource }
  });

  console.log(`Updated ${result.count} products.\n`);

  // Verification
  const verification = await prisma.$queryRaw`
    SELECT source, COUNT(*) as count
    FROM "Product"
    WHERE "archivedAt" IS NULL
    GROUP BY source
    ORDER BY count DESC
  `;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('POST-REPAIR SOURCE DISTRIBUTION:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const row of verification) {
    console.log(`  ${row.source}: ${row.count}`);
  }

  await prisma.$disconnect();
}

repair().catch(err => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
