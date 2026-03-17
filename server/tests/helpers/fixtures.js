import { testPrisma } from './prisma.js';
import bcrypt from 'bcryptjs';
import { encrypt } from '../../src/lib/encryption.js';

let counter = 0;

/**
 * Create a test tenant with a unique name.
 */
async function createTestTenant(name) {
  counter++;
  return testPrisma.tenant.create({
    data: {
      name: name || `Test Business ${counter}`,
      currency: 'AUD',
      timezone: 'Australia/Sydney',
    },
  });
}

/**
 * Create a test user belonging to a tenant.
 */
async function createTestUser(tenantId, overrides = {}) {
  counter++;
  return testPrisma.user.create({
    data: {
      tenantId,
      email: overrides.email || `user-${counter}-${Date.now()}@test.com`,
      name: overrides.name || 'Test User',
      passwordHash: await bcrypt.hash('password123', 4), // low rounds for speed
      role: overrides.role || 'OWNER',
    },
  });
}

/**
 * Create a test product belonging to a tenant.
 */
async function createTestProduct(tenantId, overrides = {}) {
  counter++;
  return testPrisma.product.create({
    data: {
      tenantId,
      name: overrides.name || `Test Product ${counter}`,
      category: overrides.category || 'General',
      baseUnit: overrides.baseUnit || 'each',
      barcode: overrides.barcode || null,
    },
  });
}

/**
 * Create a test store belonging to a tenant.
 */
async function createTestStore(tenantId, overrides = {}) {
  counter++;
  return testPrisma.store.create({
    data: {
      tenantId,
      name: overrides.name || `Test Store ${counter}`,
      type: overrides.type || 'POS',
    },
  });
}

/**
 * Create a test supplier belonging to a tenant.
 */
async function createTestSupplier(tenantId, overrides = {}) {
  counter++;
  return testPrisma.supplier.create({
    data: {
      tenantId,
      name: overrides.name || `Test Supplier ${counter}`,
    },
  });
}

/**
 * Create a SYSTEM_ADMIN user (no tenant).
 */
async function createTestSystemAdmin(overrides = {}) {
  counter++;
  return testPrisma.user.create({
    data: {
      tenantId: null,
      email: overrides.email || `admin-${counter}-${Date.now()}@retailedge.com`,
      name: overrides.name || 'System Admin',
      passwordHash: await bcrypt.hash('admin123', 4),
      role: 'SYSTEM_ADMIN',
    },
  });
}

/**
 * Create an API usage log entry for testing.
 */
async function createTestApiUsageLog(tenantId, overrides = {}) {
  counter++;
  return testPrisma.apiUsageLog.create({
    data: {
      tenantId,
      userId: overrides.userId || null,
      endpoint: overrides.endpoint || 'ocr',
      model: overrides.model || 'claude-sonnet-4-5-20250514',
      inputTokens: overrides.inputTokens || 1000,
      outputTokens: overrides.outputTokens || 500,
      totalTokens: overrides.totalTokens || 1500,
      costUsd: overrides.costUsd || 0.0105,
      requestPayload: overrides.requestPayload || { type: 'invoice_ocr' },
      responsePayload: overrides.responsePayload || { text: 'Test response' },
      durationMs: overrides.durationMs || 2500,
      status: overrides.status || 'success',
      createdAt: overrides.createdAt || new Date(),
    },
  });
}

/**
 * Create a tenant access log entry for testing.
 */
async function createTestAccessLog(tenantId, overrides = {}) {
  counter++;
  return testPrisma.tenantAccessLog.create({
    data: {
      tenantId,
      action: overrides.action || 'REGISTERED',
      reason: overrides.reason || null,
      performedBy: overrides.performedBy || null,
      createdAt: overrides.createdAt || new Date(),
    },
  });
}

/**
 * Create a test tenant with a specific plan.
 */
async function createTestTenantWithPlan(name, plan = 'starter') {
  counter++;
  const planLimits = {
    starter: { maxUsers: 5, maxStores: 2, maxApiCallsPerMonth: 100 },
    professional: { maxUsers: 15, maxStores: 10, maxApiCallsPerMonth: 500 },
    enterprise: { maxUsers: 999, maxStores: 999, maxApiCallsPerMonth: 2000 },
  };
  const limits = planLimits[plan] || planLimits.starter;
  return testPrisma.tenant.create({
    data: {
      name: name || `Test ${plan} Business ${counter}`,
      currency: 'AUD',
      timezone: 'Australia/Sydney',
      plan,
      ...limits,
    },
  });
}

/**
 * Create a test Gmail integration for a tenant.
 */
async function createTestGmailIntegration(tenantId, overrides = {}) {
  counter++;
  return testPrisma.gmailIntegration.create({
    data: {
      tenantId,
      googleClientId: overrides.googleClientId || `test-${counter}.apps.googleusercontent.com`,
      googleClientSecretEnc: overrides.googleClientSecretEnc || encrypt('test-client-secret'),
      email: overrides.email || `gmail-${counter}@gmail.com`,
      accessTokenEnc: overrides.accessTokenEnc || encrypt('test-access-token'),
      refreshTokenEnc: overrides.refreshTokenEnc || encrypt('test-refresh-token'),
      tokenExpiresAt: overrides.tokenExpiresAt || new Date(Date.now() + 3600000),
      isActive: overrides.isActive !== undefined ? overrides.isActive : true,
      senderWhitelist: overrides.senderWhitelist || [],
      labelFilter: overrides.labelFilter || null,
      pollIntervalMin: overrides.pollIntervalMin || 30,
    },
  });
}

/**
 * Create a test Gmail import log entry.
 */
async function createTestGmailImportLog(tenantId, overrides = {}) {
  counter++;
  return testPrisma.gmailImportLog.create({
    data: {
      tenantId,
      gmailMessageId: overrides.gmailMessageId || `msg-${counter}-${Date.now()}`,
      fileHash: overrides.fileHash || null,
      supplierName: overrides.supplierName || null,
      invoiceNumber: overrides.invoiceNumber || null,
      invoiceDate: overrides.invoiceDate || null,
      senderEmail: overrides.senderEmail || `supplier-${counter}@example.com`,
      subject: overrides.subject || `Invoice ${counter}`,
      attachmentName: overrides.attachmentName || `invoice-${counter}.pdf`,
      status: overrides.status || 'imported',
      duplicateReason: overrides.duplicateReason || null,
      invoiceId: overrides.invoiceId || null,
    },
  });
}

/**
 * Create a test competitor monitor.
 */
async function createTestCompetitorMonitor(tenantId, productId, overrides = {}) {
  counter++;
  return testPrisma.competitorMonitor.create({
    data: {
      tenantId,
      productId,
      competitor: overrides.competitor || 'woolworths',
      externalUrl: overrides.externalUrl || null,
      externalSku: overrides.externalSku || null,
      searchTerm: overrides.searchTerm || null,
      isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    },
  });
}

/**
 * Create a test competitor price entry.
 */
async function createTestCompetitorPrice(tenantId, competitorMonitorId, overrides = {}) {
  counter++;
  return testPrisma.competitorPrice.create({
    data: {
      tenantId,
      competitorMonitorId,
      price: overrides.price || 4.99,
      unitPrice: overrides.unitPrice || null,
      unit: overrides.unit || null,
      isOnSpecial: overrides.isOnSpecial || false,
      specialEndDate: overrides.specialEndDate || null,
      scrapedAt: overrides.scrapedAt || new Date(),
    },
  });
}

/**
 * Create a test price alert.
 */
async function createTestPriceAlert(tenantId, productId, overrides = {}) {
  counter++;
  return testPrisma.priceAlert.create({
    data: {
      tenantId,
      productId,
      alertType: overrides.alertType || 'competitor_undercut',
      severity: overrides.severity || 'warning',
      title: overrides.title || `Price Alert ${counter}`,
      description: overrides.description || 'Competitor is cheaper than your price',
      metadata: overrides.metadata || null,
      isRead: overrides.isRead || false,
      isDismissed: overrides.isDismissed || false,
    },
  });
}

/**
 * Create a test folder integration for a tenant.
 */
async function createTestFolderIntegration(tenantId, overrides = {}) {
  counter++;
  return testPrisma.folderIntegration.create({
    data: {
      tenantId,
      folderPath: overrides.folderPath || `C:\\TestInvoices\\Tenant${counter}`,
      isActive: overrides.isActive !== undefined ? overrides.isActive : true,
      filePatterns: overrides.filePatterns || ['*.pdf', '*.jpg', '*.jpeg', '*.png'],
      moveToProcessed: overrides.moveToProcessed !== undefined ? overrides.moveToProcessed : true,
      pollIntervalMin: overrides.pollIntervalMin || 30,
      lastPollAt: overrides.lastPollAt || null,
    },
  });
}

/**
 * Create a test folder import log entry.
 */
async function createTestFolderImportLog(tenantId, overrides = {}) {
  counter++;
  return testPrisma.folderImportLog.create({
    data: {
      tenantId,
      filePath: overrides.filePath || `C:\\TestInvoices\\invoice-${counter}-${Date.now()}.pdf`,
      fileHash: overrides.fileHash || null,
      supplierName: overrides.supplierName || null,
      invoiceNumber: overrides.invoiceNumber || null,
      invoiceDate: overrides.invoiceDate || null,
      fileName: overrides.fileName || `invoice-${counter}.pdf`,
      fileSize: overrides.fileSize || 102400,
      status: overrides.status || 'imported',
      duplicateReason: overrides.duplicateReason || null,
      invoiceId: overrides.invoiceId || null,
    },
  });
}

export {
  createTestTenant,
  createTestTenantWithPlan,
  createTestUser,
  createTestProduct,
  createTestStore,
  createTestSupplier,
  createTestSystemAdmin,
  createTestApiUsageLog,
  createTestAccessLog,
  createTestGmailIntegration,
  createTestGmailImportLog,
  createTestFolderIntegration,
  createTestFolderImportLog,
  createTestCompetitorMonitor,
  createTestCompetitorPrice,
  createTestPriceAlert,
};
