/**
 * Repair 1: Create "Abacus POS" store and default variants for POS products
 *
 * All "Abacus POS" products (549 original + any restored by Repair 2) have
 * no variants because no POS store existed. This creates the store and a
 * default variant for each product using the Product-level pricing data.
 */
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient();

function generateSku(name, index) {
  // Generate a deterministic SKU from product name
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `pos-${slug}`;
}

async function repair() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('REPAIR 1: Create POS store + default variants');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Get the tenant that owns POS products
  const posProduct = await prisma.product.findFirst({
    where: { source: 'Abacus POS', archivedAt: null },
    select: { tenantId: true }
  });

  if (!posProduct) {
    console.log('No Abacus POS products found. Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  const tenantId = posProduct.tenantId;
  console.log(`Tenant: ${tenantId}\n`);

  // Find or create the Abacus POS store
  let store = await prisma.store.findFirst({
    where: { tenantId, platform: 'Abacus POS', type: 'POS' }
  });

  if (!store) {
    store = await prisma.store.create({
      data: {
        tenantId,
        name: 'Abacus POS',
        platform: 'Abacus POS',
        type: 'POS',
        isActive: true
      }
    });
    console.log(`Created Abacus POS store: ${store.id}`);
  } else {
    console.log(`Abacus POS store already exists: ${store.id}`);
  }

  // Find all POS products without variants (including the lone "POS" source product)
  const productsWithoutVariants = await prisma.product.findMany({
    where: {
      tenantId,
      source: { in: ['Abacus POS', 'POS'] },
      archivedAt: null,
      variants: { none: {} }
    },
    select: {
      id: true,
      name: true,
      barcode: true,
      baseUnit: true,
      costPrice: true,
      sellingPrice: true
    },
    orderBy: { name: 'asc' }
  });

  console.log(`Found ${productsWithoutVariants.length} POS products without variants\n`);

  if (productsWithoutVariants.length === 0) {
    console.log('All POS products already have variants.');
    await prisma.$disconnect();
    return;
  }

  // Track used SKUs to handle duplicates
  const usedSkus = new Set();
  let created = 0;
  let failed = 0;

  for (const product of productsWithoutVariants) {
    try {
      let sku = generateSku(product.name);

      // Handle duplicate SKUs by appending a suffix
      let attempt = 0;
      let uniqueSku = sku;
      while (usedSkus.has(uniqueSku)) {
        attempt++;
        uniqueSku = `${sku}-${attempt}`;
      }
      usedSkus.add(uniqueSku);

      await prisma.productVariant.create({
        data: {
          productId: product.id,
          storeId: store.id,
          name: product.name,
          sku: uniqueSku,
          salePrice: product.sellingPrice || 0,
          currentCost: product.costPrice || 0,
          unitQty: 1,
          isActive: true
        }
      });
      created++;
    } catch (err) {
      failed++;
      console.warn(`  FAIL [${product.id}] "${product.name}": ${err.message}`);
    }
  }

  console.log(`\nCreated ${created} default variants (${failed} failures)\n`);

  // Verification
  const afterCounts = await prisma.$queryRaw`
    SELECT
      p.source,
      COUNT(*) as "totalProducts",
      SUM(CASE WHEN COALESCE(vc.variant_count, 0) = 0 THEN 1 ELSE 0 END) as "noVariants",
      SUM(CASE WHEN COALESCE(vc.variant_count, 0) > 0 THEN 1 ELSE 0 END) as "hasVariants"
    FROM "Product" p
    LEFT JOIN (
      SELECT "productId", COUNT(*) as variant_count
      FROM "ProductVariant"
      GROUP BY "productId"
    ) vc ON vc."productId" = p.id
    WHERE p."archivedAt" IS NULL
      AND p.source IN ('Abacus POS', 'POS')
    GROUP BY p.source
    ORDER BY p.source
  `;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('POST-REPAIR POS VARIANT STATUS:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const row of afterCounts) {
    console.log(`  ${row.source}: ${row.totalProducts} total, ${row.hasVariants} with variants, ${row.noVariants} without`);
  }

  const storeVariantCount = await prisma.productVariant.count({
    where: { storeId: store.id }
  });
  console.log(`\n  Abacus POS store total variants: ${storeVariantCount}`);

  await prisma.$disconnect();
}

repair().catch(err => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
