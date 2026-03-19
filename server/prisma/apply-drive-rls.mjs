import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://retailedge:retailedge_dev@localhost:5433/retailedge_dev' } },
});

async function main() {
  const statements = [
    `ALTER TABLE "DriveIntegration" ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE "DriveIntegration" FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON "DriveIntegration" USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '' OR "tenantId" = current_setting('app.current_tenant_id', true))`,
    `ALTER TABLE "DriveImportLog" ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE "DriveImportLog" FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON "DriveImportLog" USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '' OR "tenantId" = current_setting('app.current_tenant_id', true))`,
  ];

  for (const sql of statements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log('OK:', sql.slice(0, 60));
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log('SKIP (exists):', sql.slice(0, 60));
      } else {
        console.error('ERR:', e.message);
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
