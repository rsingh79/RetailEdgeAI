import { PrismaClient } from '../generated/prisma/client.js';

// ── Test environment safety check ───────────────────────────
// When vitest sets DATABASE_URL to point at retailedge_test, .env must NOT
// override it back to the production database. If we detect a test
// environment but DATABASE_URL points at defaultdb instead of
// retailedge_test, vitest was likely run without the vitest.config.js
// env overrides (e.g. from the wrong directory).
if (
  (process.env.NODE_ENV === 'test' || typeof globalThis.describe === 'function') &&
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes('retailedge_test')
) {
  throw new Error(
    'TEST SAFETY: DATABASE_URL points to production (not retailedge_test). ' +
    'Run tests with: cd server && npm test'
  );
}

// ── Base client (no tenant context) ──────────────────────────
// Used as the foundation for tenant-scoped clients.
// Connects via DATABASE_URL_APP (non-superuser) so RLS policies are enforced.
// Without a SET LOCAL session variable, strict RLS policies return zero rows
// for tenant-scoped tables — this is the safe default.
const basePrisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL_APP || process.env.DATABASE_URL },
  },
});

// ── Admin client (bypasses RLS) ──────────────────────────────
// Connects via DATABASE_URL as the `retailedge` role with BYPASSRLS.
// ONLY for: auth routes (register/login), migrations, seeding,
// background jobs iterating across tenants, admin/* routes.
// NEVER use for tenant-scoped request handling.
const adminPrisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

// ── Tenant-scoped models ─────────────────────────────────────
// These models have a `tenantId` column and need automatic scoping.
// Child models (ProductVariant, InvoiceLine, InvoiceLineMatch,
// SupplierProductMapping) are protected transitively via parent FK.
const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Store',
  'Product',
  'Supplier',
  'Invoice',
  'PricingRule',
  'AuditLog',
  'ImportTemplate',
  'GmailIntegration',
  'GmailImportLog',
  'FolderIntegration',
  'FolderImportLog',
  'ShopifyIntegration',
  'ShopifyImportLog',
  'ShopifyOrder',
  'CompetitorMonitor',
  'CompetitorPrice',
  'PriceAlert',
  'DriveIntegration',
  'DriveImportLog',
  'Conversation',
  // Observability
  'ApiUsageLog',
  'TenantAccessLog',
  // Prompt system (tenant-scoped)
  'TenantPromptOverride',
  'PromptConflict',
  'PromptChangeLog',
  'TenantPromptConfig',
  'TenantFewShotExample',
  'InteractionSignal',
  'PromptSuggestion',
  'PromptAuditLog',
  // AI service logs (nullable tenantId, but scoped when present)
  'AiServiceLog',
  // Product Import Pipeline models
  'ImportJob',
  'ApprovalQueueEntry',
  'ProductImportRecord',
  'TenantSourceRegistry',
  // Product Embedding Storage (ASAL Step 2)
  'ProductEmbedding',
  // Price Change Audit Log
  'PriceChangeLog',
  // Canonical Sales Data
  'SalesTransaction',
  'SalesLineItem',
  // Usage Tracking
  'TenantUsage',
]);

// Operations that read data (need tenantId in WHERE)
const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

// Operations that modify data (need tenantId in WHERE)
const WRITE_OPS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

/**
 * Create a Prisma client that automatically scopes all queries to a tenant.
 *
 * Two layers of protection:
 *   1. Application layer: injects tenantId into every query's args
 *   2. Database layer: SET LOCAL sets the RLS session variable per query
 *
 * Each tenant-scoped model operation is wrapped in a batch $transaction that
 * runs SET LOCAL before the query. SET LOCAL is transaction-scoped, so it's
 * safe with connection pooling (reset on COMMIT).
 *
 * @param {string} tenantId - The tenant CUID from the authenticated JWT
 * @returns Extended PrismaClient scoped to the given tenant
 */
function createTenantClient(tenantId) {
  if (!tenantId) {
    throw new Error('createTenantClient requires a tenantId');
  }

  if (!/^[a-z0-9]+$/i.test(tenantId)) {
    throw new Error('Invalid tenantId format');
  }

  return basePrisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        // Skip non-model operations (e.g. $executeRaw)
        if (!model) {
          return query(args);
        }

        // ── Application-layer filtering: inject tenantId into args ──
        // Only for models that have a tenantId column.
        if (TENANT_SCOPED_MODELS.has(model)) {
          // Reads: inject tenantId into where
          if (READ_OPS.has(operation)) {
            args.where = { ...args.where, tenantId };
          }

          // Create: inject tenantId into data
          if (operation === 'create') {
            args.data = { ...args.data, tenantId };
          }

          // CreateMany: inject tenantId into each record
          if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const data = Array.isArray(args.data) ? args.data : [args.data];
            args.data = data.map((d) => ({ ...d, tenantId }));
          }

          // Update/Delete: inject tenantId into where
          if (WRITE_OPS.has(operation)) {
            args.where = { ...args.where, tenantId };
          }

          // Upsert: inject into both where and create
          if (operation === 'upsert') {
            args.where = { ...args.where, tenantId };
            args.create = { ...args.create, tenantId };
          }
        }

        // ── RLS enforcement: batch transaction with SET LOCAL ──
        // ALL model operations get SET LOCAL, not just tenant-scoped models.
        // Child tables (InvoiceLine, ProductVariant, etc.) may include relations
        // to RLS-protected parent tables — without SET LOCAL, those includes fail.
        const delegate = model.charAt(0).toLowerCase() + model.slice(1);
        return basePrisma
          .$transaction([
            basePrisma.$executeRawUnsafe(
              `SET LOCAL "app.current_tenant_id" = '${tenantId}'`
            ),
            basePrisma[delegate][operation](args),
          ])
          .then((results) => results[1]);
      },
    },
  });
}

/**
 * Execute a callback within a tenant-scoped PostgreSQL transaction.
 * Sets the RLS session variable so PostgreSQL enforces row-level security.
 *
 * Use this for operations that need the database-level RLS guarantee,
 * in addition to the application-level filtering from createTenantClient.
 *
 * @param {string} tenantId - The tenant CUID
 * @param {function} callback - Receives the transaction client (tx)
 * @returns The callback's return value
 */
async function withTenantTransaction(tenantId, callback) {
  if (!tenantId) {
    throw new Error('withTenantTransaction requires a tenantId');
  }

  // Validate tenantId format (CUID) to prevent SQL injection
  if (!/^[a-z0-9]+$/i.test(tenantId)) {
    throw new Error('Invalid tenantId format');
  }

  return basePrisma.$transaction(async (tx) => {
    // SET LOCAL scopes the variable to this transaction only.
    // PostgreSQL SET doesn't support parameterized values ($1),
    // so we use $executeRawUnsafe with validated input.
    await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantId}'`);
    return callback(tx);
  });
}

export { basePrisma, adminPrisma, createTenantClient, withTenantTransaction };
export default basePrisma;
