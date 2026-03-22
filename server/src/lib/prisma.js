import { PrismaClient } from '../generated/prisma/client.js';

// ── Base client (no tenant context) ──────────────────────────
// Used for: auth routes (register/login), migrations, seeding,
// system-level queries, and as the foundation for tenant-scoped clients.
//
// Uses DATABASE_URL_APP (non-superuser) so RLS policies are enforced.
// Falls back to DATABASE_URL for compatibility (e.g. in test setup).
const basePrisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL_APP || process.env.DATABASE_URL },
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
  'ShopifyIntegration',
  'ShopifyImportLog',
  'CompetitorMonitor',
  'CompetitorPrice',
  'PriceAlert',
  'DriveIntegration',
  'DriveImportLog',
  'Conversation',
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
 *   1. Application layer: $extends injects tenantId into every query
 *   2. Database layer: RLS policies enforce isolation at PostgreSQL level
 *
 * @param {string} tenantId - The tenant CUID from the authenticated JWT
 * @returns Extended PrismaClient scoped to the given tenant
 */
function createTenantClient(tenantId) {
  if (!tenantId) {
    throw new Error('createTenantClient requires a tenantId');
  }

  return basePrisma.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        // Skip non-model operations (e.g. $executeRaw) and non-tenant models
        if (!model || !TENANT_SCOPED_MODELS.has(model)) {
          return query(args);
        }

        // ── Reads: inject tenantId into where ──
        if (READ_OPS.has(operation)) {
          args.where = { ...args.where, tenantId };
        }

        // ── Create: inject tenantId into data ──
        if (operation === 'create') {
          args.data = { ...args.data, tenantId };
        }

        // ── CreateMany: inject tenantId into each record ──
        if (operation === 'createMany' || operation === 'createManyAndReturn') {
          const data = Array.isArray(args.data) ? args.data : [args.data];
          args.data = data.map((d) => ({ ...d, tenantId }));
        }

        // ── Update/Delete: inject tenantId into where ──
        if (WRITE_OPS.has(operation)) {
          args.where = { ...args.where, tenantId };
        }

        // ── Upsert: inject into both where and create ──
        if (operation === 'upsert') {
          args.where = { ...args.where, tenantId };
          args.create = { ...args.create, tenantId };
        }

        return query(args);
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

export { basePrisma, createTenantClient, withTenantTransaction };
export default basePrisma;
