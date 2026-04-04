/**
 * Seed script for screenshot testing user.
 *
 * Creates a dedicated test user + tenant for headless UI screenshot testing.
 * Safe to re-run — uses upsert for both tenant and user.
 *
 * Run:  node prisma/seed-screenshot-user.js
 */
import { PrismaClient } from '../src/generated/prisma/index.js';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL,
});

const TEST_EMAIL = 'screenshottest@retailedgeai.com';
const TEST_PASSWORD = 'Screenshot_Test_2024!';
const TENANT_NAME = 'Screenshot Test Business';

async function main() {
  console.log('Seeding screenshot test user...');

  // Find the growth plan tier (gives access to most features)
  const growthTier = await prisma.planTier.findFirst({
    where: { slug: 'growth' },
  });

  // Find or create the test tenant (let Prisma generate a valid CUID)
  let tenant = await prisma.tenant.findFirst({
    where: { name: TENANT_NAME },
  });

  if (tenant) {
    tenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        plan: 'growth',
        planTierId: growthTier?.id || null,
      },
    });
  } else {
    tenant = await prisma.tenant.create({
      data: {
        name: TENANT_NAME,
        currency: 'AUD',
        timezone: 'Australia/Sydney',
        plan: 'growth',
        planTierId: growthTier?.id || null,
        subscriptionStatus: 'active',
      },
    });
  }

  console.log(`  Tenant: ${tenant.name} (${tenant.id})`);

  // Hash the password with production rounds
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);

  // Upsert the test user
  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: {
      passwordHash,
      name: 'Screenshot Tester',
      role: 'OWNER',
      tenantId: tenant.id,
    },
    create: {
      email: TEST_EMAIL,
      passwordHash,
      name: 'Screenshot Tester',
      role: 'OWNER',
      tenantId: tenant.id,
    },
  });

  console.log(`  User: ${user.email} (${user.role})`);
  console.log('Screenshot test user seeded successfully.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
