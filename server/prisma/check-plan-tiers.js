import { PrismaClient } from '../src/generated/prisma/client.js';
const prisma = new PrismaClient();

const tiers = await prisma.planTier.findMany({
  include: {
    features: { include: { feature: true } },
  },
});

console.log('Plan tiers found:', tiers.length);
for (const tier of tiers) {
  console.log(`\nTier: ${tier.name} (${tier.slug})`);
  console.log('Features:', tier.features.map(
    f => f.feature.key).join(', ') || 'none');
}

const feature = await prisma.feature.findUnique({
  where: { key: 'product_import' },
});
console.log('\nproduct_import feature:', feature
  ? `found (id: ${feature.id})` : 'NOT FOUND');

await prisma.$disconnect();
