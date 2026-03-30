import { PrismaClient } from '../src/generated/prisma/client.js';
const prisma = new PrismaClient();

async function seed() {
  console.log('[Seed] Upserting product_import feature...');

  await prisma.feature.upsert({
    where: { key: 'product_import' },
    update: {
      name: 'AI Product Import Pipeline',
      description:
        'AI-assisted product import with duplicate detection, ' +
        'approval queue, confidence scoring, and multi-source sync',
      category: 'import',
      icon: 'upload',
      isActive: true,
      isCore: false,
      sortOrder: 10,
    },
    create: {
      key: 'product_import',
      name: 'AI Product Import Pipeline',
      description:
        'AI-assisted product import with duplicate detection, ' +
        'approval queue, confidence scoring, and multi-source sync',
      category: 'import',
      icon: 'upload',
      isActive: true,
      isCore: false,
      sortOrder: 10,
    },
  });

  console.log('[Seed] product_import feature upserted successfully.');

  // Verify it was written
  const feature = await prisma.feature.findUnique({
    where: { key: 'product_import' },
  });
  console.log('[Seed] Verified:', JSON.stringify(feature, null, 2));

  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error('[Seed] Failed:', err.message);
  process.exit(1);
});
