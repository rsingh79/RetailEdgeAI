import { testPrisma } from './prisma.js';
import bcrypt from 'bcryptjs';
import { encrypt } from '../../src/lib/encryption.js';

let counter = 0;
let tiersSeeded = false;
let tierMap = {}; // slug → id

/**
 * Ensure features and tiers are seeded in the test database.
 * Safe to call multiple times — uses a flag to skip if already done.
 */
async function ensureTiersSeeded() {
  if (tiersSeeded) return;

  // Seed features
  const FEATURES = [
    { key: 'invoices', name: 'Invoices', category: 'core', isCore: true, sortOrder: 1 },
    { key: 'products', name: 'Products', category: 'core', isCore: true, sortOrder: 2 },
    { key: 'review_match', name: 'Review & Match', category: 'core', isCore: true, sortOrder: 3 },
    { key: 'export', name: 'Export', category: 'core', isCore: true, sortOrder: 4 },
    { key: 'ai_command_centre', name: 'AI Command Centre', category: 'core', isCore: true, sortOrder: 5 },
    { key: 'reports', name: 'Reports', category: 'core', isCore: true, sortOrder: 6 },
    { key: 'product_import', name: 'AI Product Import Pipeline', category: 'core', isCore: false, sortOrder: 7 },
    { key: 'email_integration', name: 'Email Integration', category: 'integrations', isCore: false, sortOrder: 10 },
    { key: 'folder_polling', name: 'Folder Polling', category: 'integrations', isCore: false, sortOrder: 11 },
    { key: 'shopify_integration', name: 'Shopify Integration', category: 'integrations', isCore: false, sortOrder: 12 },
    { key: 'drive_integration', name: 'Google Drive Integration', category: 'integrations', isCore: false, sortOrder: 13 },
    { key: 'pricing_rules', name: 'Pricing Rules', category: 'pricing', isCore: false, sortOrder: 20 },
    { key: 'demand_analysis', name: 'Demand Analysis', category: 'intelligence', isCore: false, sortOrder: 30 },
    { key: 'competitor_intelligence', name: 'Competitor Intelligence', category: 'intelligence', isCore: false, sortOrder: 31 },
    { key: 'demand_forecasting', name: 'Demand Forecasting', category: 'intelligence', isCore: false, sortOrder: 32 },
    { key: 'supplier_comparison', name: 'Supplier Comparison', category: 'intelligence', isCore: false, sortOrder: 33 },
    { key: 'ai_advisor', name: 'AI Business Advisor', category: 'intelligence', isCore: false, sortOrder: 34 },
  ];

  const featureMap = {};
  for (const f of FEATURES) {
    const feature = await testPrisma.feature.upsert({
      where: { key: f.key },
      create: f,
      update: f,
    });
    featureMap[f.key] = feature.id;
  }

  // Tier definitions
  const TIERS = [
    {
      slug: 'starter', name: 'Starter', monthlyPrice: 49, annualPrice: 490, sortOrder: 1, isDefault: true,
      featureKeys: ['invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports', 'product_import'],
      limits: { max_users: 5, max_stores: 2, max_invoice_pages_per_month: 100, max_products: 500, max_pricing_rules: 5, max_exports_per_month: 50, max_email_imports_per_month: 0, max_folder_imports_per_month: 0, max_shopify_syncs_per_month: 0, max_competitors_monitored: 0, max_demand_products: 0, ai_queries_per_month: 50, max_integrations: 1, historical_sync_months: 12, analysis_window_months: 12 },
    },
    {
      slug: 'growth', name: 'Growth', monthlyPrice: 129, annualPrice: 1290, sortOrder: 2, isDefault: false,
      featureKeys: ['invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports', 'product_import', 'email_integration', 'folder_polling', 'shopify_integration', 'drive_integration', 'pricing_rules', 'demand_analysis', 'ai_advisor'],
      limits: { max_users: 15, max_stores: 10, max_invoice_pages_per_month: 500, max_products: 5000, max_pricing_rules: 20, max_exports_per_month: 200, max_email_imports_per_month: 100, max_folder_imports_per_month: 100, max_shopify_syncs_per_month: 100, max_competitors_monitored: 0, max_demand_products: 0, ai_queries_per_month: 200, max_integrations: 3, historical_sync_months: 24, analysis_window_months: 24 },
    },
    {
      slug: 'professional', name: 'Professional', monthlyPrice: 299, annualPrice: 2990, sortOrder: 3, isDefault: false,
      featureKeys: ['invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports', 'product_import', 'email_integration', 'folder_polling', 'shopify_integration', 'drive_integration', 'pricing_rules', 'demand_analysis', 'competitor_intelligence', 'demand_forecasting', 'supplier_comparison', 'ai_advisor'],
      limits: { max_users: 999, max_stores: 999, max_invoice_pages_per_month: 2000, max_products: 20000, max_pricing_rules: 999, max_exports_per_month: 999, max_email_imports_per_month: 500, max_folder_imports_per_month: 500, max_shopify_syncs_per_month: 500, max_competitors_monitored: 50, max_demand_products: 100, ai_queries_per_month: 500, max_integrations: 10, historical_sync_months: 60, analysis_window_months: 60 },
    },
    {
      slug: 'enterprise', name: 'Enterprise', monthlyPrice: 0, annualPrice: 0, sortOrder: 4, isDefault: false,
      featureKeys: ['invoices', 'products', 'review_match', 'export', 'ai_command_centre', 'reports', 'product_import', 'email_integration', 'folder_polling', 'shopify_integration', 'drive_integration', 'pricing_rules', 'demand_analysis', 'competitor_intelligence', 'demand_forecasting', 'supplier_comparison', 'ai_advisor'],
      limits: { max_users: -1, max_stores: -1, max_invoice_pages_per_month: -1, max_products: -1, max_pricing_rules: -1, max_exports_per_month: -1, max_email_imports_per_month: -1, max_folder_imports_per_month: -1, max_shopify_syncs_per_month: -1, max_competitors_monitored: -1, max_demand_products: -1, ai_queries_per_month: -1, max_integrations: -1, historical_sync_months: -1, analysis_window_months: -1 },
    },
  ];

  for (const t of TIERS) {
    const tier = await testPrisma.$transaction(async (tx) => {
      const tier = await tx.planTier.upsert({
        where: { slug: t.slug },
        create: { name: t.name, slug: t.slug, monthlyPrice: t.monthlyPrice, annualPrice: t.annualPrice, sortOrder: t.sortOrder, isDefault: t.isDefault },
        update: { name: t.name, monthlyPrice: t.monthlyPrice, annualPrice: t.annualPrice, sortOrder: t.sortOrder, isDefault: t.isDefault },
      });
      await tx.planTierFeature.deleteMany({ where: { planTierId: tier.id } });
      await tx.planTierLimit.deleteMany({ where: { planTierId: tier.id } });
      for (const fKey of t.featureKeys) {
        await tx.planTierFeature.create({ data: { planTierId: tier.id, featureId: featureMap[fKey] } });
      }
      for (const [lk, lv] of Object.entries(t.limits)) {
        await tx.planTierLimit.create({ data: { planTierId: tier.id, limitKey: lk, limitValue: lv } });
      }
      return tier;
    });
    tierMap[t.slug] = tier.id;
  }

  tiersSeeded = true;
}

/** Legacy plan → tier slug mapping */
const LEGACY_PLAN_MAP = { starter: 'starter', growth: 'growth', professional: 'professional', enterprise: 'enterprise' };

/**
 * Create a test tenant with a unique name.
 * Assigns the default (starter) tier.
 */
async function createTestTenant(name) {
  counter++;
  await ensureTiersSeeded();
  return testPrisma.tenant.create({
    data: {
      name: name || `Test Business ${counter}`,
      currency: 'AUD',
      timezone: 'Australia/Sydney',
      plan: 'starter',
      planTierId: tierMap.starter || null,
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
 * Create a test tenant with a specific plan tier slug.
 * Accepts tier slugs directly: 'starter', 'growth', 'professional', 'enterprise'.
 */
async function createTestTenantWithPlan(name, plan = 'starter') {
  counter++;
  await ensureTiersSeeded();
  const planLimits = {
    starter: { maxUsers: 5, maxStores: 2, maxApiCallsPerMonth: 100 },
    growth: { maxUsers: 15, maxStores: 10, maxApiCallsPerMonth: 500 },
    professional: { maxUsers: 999, maxStores: 999, maxApiCallsPerMonth: 2000 },
    enterprise: { maxUsers: -1, maxStores: -1, maxApiCallsPerMonth: -1 },
  };
  const limits = planLimits[plan] || planLimits.starter;
  const tierSlug = LEGACY_PLAN_MAP[plan] || 'starter';
  const planTierId = tierMap[tierSlug] || null;
  return testPrisma.tenant.create({
    data: {
      name: name || `Test ${plan} Business ${counter}`,
      currency: 'AUD',
      timezone: 'Australia/Sydney',
      plan,
      planTierId,
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
  ensureTiersSeeded,
};
