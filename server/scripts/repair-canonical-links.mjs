/**
 * Repair 3: Identify and create canonical links for cross-source products
 *
 * Checks for barcode matches first (safe to auto-link), then reports
 * name matches for manual review. Per instructions: do NOT auto-link by name only.
 */
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient();

async function repair() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('REPAIR 3: Cross-source canonical links');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Step 1: Check for barcode-based matches (safe to auto-link)
  const barcodeMatches = await prisma.$queryRaw`
    SELECT DISTINCT ON (LEAST(p1.id, p2.id), GREATEST(p1.id, p2.id))
      p1.id as "id1", p1.name as "name1", p1.source as "source1",
      p2.id as "id2", p2.name as "name2", p2.source as "source2",
      p1.barcode
    FROM "Product" p1
    JOIN "Product" p2 ON p1.barcode = p2.barcode
      AND p1.id != p2.id
      AND p1.source != p2.source
    WHERE p1."archivedAt" IS NULL
      AND p2."archivedAt" IS NULL
      AND p1.barcode IS NOT NULL
      AND p1.barcode != ''
      AND p1."canonicalProductId" IS NULL
      AND p2."canonicalProductId" IS NULL
    ORDER BY LEAST(p1.id, p2.id), GREATEST(p1.id, p2.id)
  `;

  console.log(`Barcode-based cross-source matches: ${barcodeMatches.length}`);

  if (barcodeMatches.length > 0) {
    // Group by barcode
    const byBarcode = new Map();
    for (const match of barcodeMatches) {
      if (!byBarcode.has(match.barcode)) byBarcode.set(match.barcode, new Set());
      byBarcode.get(match.barcode).add(match.id1);
      byBarcode.get(match.barcode).add(match.id2);
    }

    let linked = 0;
    for (const [barcode, productIds] of byBarcode) {
      const ids = Array.from(productIds);
      const products = await prisma.product.findMany({
        where: { id: { in: ids } },
        orderBy: { createdAt: 'asc' }
      });

      if (products.length < 2) continue;

      const canonical = products[0]; // oldest is canonical
      for (let i = 1; i < products.length; i++) {
        await prisma.product.update({
          where: { id: products[i].id },
          data: { canonicalProductId: canonical.id }
        });
        console.log(`  Linked ${products[i].source} "${products[i].name}" -> ${canonical.source} "${canonical.name}" (barcode: ${barcode})`);
        linked++;
      }
    }
    console.log(`\nCreated ${linked} canonical links via barcode.\n`);
  } else {
    console.log('  (No barcode matches — POS products have no barcodes)\n');
  }

  // Step 2: Report name-based cross-source matches (NOT auto-linked)
  const nameMatches = await prisma.$queryRaw`
    SELECT DISTINCT ON (LOWER(p1.name))
      p1.id as "id1", p1.source as "source1",
      p2.id as "id2", p2.source as "source2",
      p1.name
    FROM "Product" p1
    JOIN "Product" p2 ON LOWER(TRIM(p1.name)) = LOWER(TRIM(p2.name))
      AND p1.id != p2.id
      AND p1.source != p2.source
    WHERE p1."archivedAt" IS NULL
      AND p2."archivedAt" IS NULL
      AND p1."canonicalProductId" IS NULL
      AND p2."canonicalProductId" IS NULL
    ORDER BY LOWER(p1.name)
  `;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('NAME-BASED MATCHES (for manual review, NOT auto-linked):');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Found ${nameMatches.length} cross-source name matches\n`);

  for (const match of nameMatches.slice(0, 30)) {
    console.log(`  "${match.name}" — ${match.source1} vs ${match.source2}`);
  }
  if (nameMatches.length > 30) {
    console.log(`  ... and ${nameMatches.length - 30} more`);
  }

  // Check existing canonical links
  const existingLinks = await prisma.$queryRaw`
    SELECT p.id, p.name, p.source,
           cp.name as "canonicalName", cp.source as "canonicalSource"
    FROM "Product" p
    JOIN "Product" cp ON p."canonicalProductId" = cp.id
    WHERE p."archivedAt" IS NULL
    ORDER BY p.name
  `;

  console.log(`\n\nExisting canonical links: ${existingLinks.length}`);
  for (const link of existingLinks) {
    console.log(`  "${link.name}" (${link.source}) -> "${link.canonicalName}" (${link.canonicalSource})`);
  }

  await prisma.$disconnect();
}

repair().catch(err => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
