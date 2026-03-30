import { PrismaClient } from '../src/generated/prisma/client.js';
const prisma = new PrismaClient();

const feature = await prisma.feature.findUnique({
  where: { key: 'product_import' },
});

if (!feature) {
  console.error('product_import feature not found. Run seed-product-import-feature.js first.');
  process.exit(1);
}

console.log('Found feature:', feature.id);

const tiers = await prisma.planTier.findMany({
  where: { isActive: true },
});

console.log('Active plan tiers found:', tiers.length);

for (const tier of tiers) {
  await prisma.planTierFeature.upsert({
    where: {
      planTierId_featureId: {
        planTierId: tier.id,
        featureId: feature.id,
      },
    },
    update: {},
    create: {
      planTierId: tier.id,
      featureId: feature.id,
    },
  });
  console.log(`Assigned product_import to tier: ${tier.name} (${tier.slug})`);
}

console.log('Done — product_import assigned to all active tiers.');
await prisma.$disconnect();
