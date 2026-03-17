import { PrismaClient } from '../../src/generated/prisma/client.js';

// Test database client — connects to retailedge_test as non-superuser
// (non-superuser is required for RLS policies to be enforced)
const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL_TEST ||
        'postgresql://retailedge_app:retailedge_app_dev@localhost:5433/retailedge_test',
    },
  },
});

/**
 * Delete all data from the test database.
 * Order respects foreign key constraints (children first, then parents).
 */
async function cleanDatabase() {
  await testPrisma.$transaction([
    // Competitor intelligence (children first)
    testPrisma.priceAlert.deleteMany(),
    testPrisma.competitorPrice.deleteMany(),
    testPrisma.competitorMonitor.deleteMany(),
    // Gmail integration
    testPrisma.gmailImportLog.deleteMany(),
    testPrisma.gmailIntegration.deleteMany(),
    // Folder polling
    testPrisma.folderImportLog.deleteMany(),
    testPrisma.folderIntegration.deleteMany(),
    // Existing models
    testPrisma.auditLog.deleteMany(),
    testPrisma.importTemplate.deleteMany(),
    testPrisma.invoiceLineMatch.deleteMany(),
    testPrisma.invoiceLine.deleteMany(),
    testPrisma.supplierProductMapping.deleteMany(),
    testPrisma.productVariant.deleteMany(),
    testPrisma.invoice.deleteMany(),
    testPrisma.pricingRule.deleteMany(),
    testPrisma.product.deleteMany(),
    testPrisma.store.deleteMany(),
    testPrisma.supplier.deleteMany(),
    testPrisma.tenantAccessLog.deleteMany(),
    testPrisma.apiUsageLog.deleteMany(),
    testPrisma.platformSettings.deleteMany(),
    testPrisma.user.deleteMany(),
    testPrisma.tenant.deleteMany(),
  ]);
}

export { testPrisma, cleanDatabase };
