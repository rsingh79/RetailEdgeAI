import { PrismaClient } from '../../src/generated/prisma/client.js';

// Test database client — connects as admin (BYPASSRLS) for test setup/teardown.
// Tests that verify RLS isolation use rlsPrisma or createTenantClient() separately.
const testPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL_TEST_ADMIN ||
        process.env.DATABASE_URL ||
        'postgresql://retailedge:retailedge@localhost:5433/retailedge_test',
    },
  },
});

// RLS-enforced client — connects as retailedge_app (no BYPASSRLS).
// Use this to verify that RLS policies actually work.
const rlsPrisma = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL_TEST ||
        process.env.DATABASE_URL_APP ||
        'postgresql://retailedge_app:retailedge_app@localhost:5433/retailedge_test',
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
    // Canonical sales data (line items → transactions)
    testPrisma.salesLineItem.deleteMany(),
    testPrisma.salesTransaction.deleteMany(),
    // Shopify integration (order lines → orders → integration + logs)
    testPrisma.shopifyOrderLine.deleteMany(),
    testPrisma.shopifyOrder.deleteMany(),
    testPrisma.shopifyImportLog.deleteMany(),
    testPrisma.shopifyIntegration.deleteMany(),
    // Drive integration
    testPrisma.driveImportLog.deleteMany(),
    testPrisma.driveIntegration.deleteMany(),
    // AI/ML + prompt system + import pipeline
    testPrisma.productEmbedding.deleteMany(),
    testPrisma.productImportRecord.deleteMany(),
    testPrisma.approvalQueueEntry.deleteMany(),
    testPrisma.importJob.deleteMany(),
    testPrisma.tenantFewShotExample.deleteMany(),
    testPrisma.tenantPromptOverride.deleteMany(),
    testPrisma.promptConflict.deleteMany(),
    testPrisma.promptChangeLog.deleteMany(),
    testPrisma.interactionSignal.deleteMany(),
    testPrisma.promptSuggestion.deleteMany(),
    testPrisma.promptAuditLog.deleteMany(),
    testPrisma.aiServiceLog.deleteMany(),
    // Usage tracking
    testPrisma.tenantUsage.deleteMany(),
    // Existing models
    testPrisma.auditLog.deleteMany(),
    testPrisma.importTemplate.deleteMany(),
    testPrisma.priceChangeLog.deleteMany(),
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

export { testPrisma, rlsPrisma, cleanDatabase };
