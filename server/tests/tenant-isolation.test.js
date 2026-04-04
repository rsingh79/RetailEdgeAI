import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma, rlsPrisma, cleanDatabase } from './helpers/prisma.js';
import { createTenantClient } from '../src/lib/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestProduct,
  createTestStore,
  createTestSupplier,
  createTestGmailIntegration,
  createTestCompetitorMonitor,
  createTestApiUsageLog,
} from './helpers/fixtures.js';

describe('Multi-tenant isolation', () => {
  let tenantA, tenantB;

  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDatabase();
    tenantA = await createTestTenant('Business A');
    tenantB = await createTestTenant('Business B');
  });

  // ══════════════════════════════════════════════════════════════
  // Application-level isolation (Prisma $extends middleware)
  // ══════════════════════════════════════════════════════════════

  describe('Application-level isolation (Prisma middleware)', () => {
    it('tenant A cannot see tenant B products', async () => {
      await createTestProduct(tenantA.id, { name: 'Product A' });
      await createTestProduct(tenantB.id, { name: 'Product B' });

      const clientA = createTenantClient(tenantA.id);
      const products = await clientA.product.findMany();

      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('Product A');
      expect(products[0].tenantId).toBe(tenantA.id);
    });

    it('tenant B cannot see tenant A products', async () => {
      await createTestProduct(tenantA.id, { name: 'Product A' });
      await createTestProduct(tenantB.id, { name: 'Product B' });

      const clientB = createTenantClient(tenantB.id);
      const products = await clientB.product.findMany();

      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('Product B');
      expect(products[0].tenantId).toBe(tenantB.id);
    });

    it('tenant-scoped create auto-injects tenantId', async () => {
      const clientA = createTenantClient(tenantA.id);
      const product = await clientA.product.create({
        data: { name: 'Auto-scoped Product', category: 'Test' },
      });

      expect(product.tenantId).toBe(tenantA.id);
    });

    it('tenant-scoped count only counts own records', async () => {
      await createTestProduct(tenantA.id, { name: 'A1' });
      await createTestProduct(tenantA.id, { name: 'A2' });
      await createTestProduct(tenantB.id, { name: 'B1' });

      const clientA = createTenantClient(tenantA.id);
      const count = await clientA.product.count();

      expect(count).toBe(2);
    });

    it('tenant cannot update another tenant\'s records', async () => {
      const productB = await createTestProduct(tenantB.id, { name: 'B Product' });

      const clientA = createTenantClient(tenantA.id);
      const result = await clientA.product.updateMany({
        where: { id: productB.id },
        data: { name: 'Hijacked' },
      });

      expect(result.count).toBe(0);

      // Verify product B is unchanged
      const unchanged = await testPrisma.product.findUnique({
        where: { id: productB.id },
      });
      expect(unchanged.name).toBe('B Product');
    });

    it('tenant cannot delete another tenant\'s records', async () => {
      const productB = await createTestProduct(tenantB.id, { name: 'B Product' });

      const clientA = createTenantClient(tenantA.id);
      const result = await clientA.product.deleteMany({
        where: { id: productB.id },
      });

      expect(result.count).toBe(0);

      // Verify product B still exists
      const stillExists = await testPrisma.product.findUnique({
        where: { id: productB.id },
      });
      expect(stillExists).not.toBeNull();
    });

    it('isolation works across multiple models', async () => {
      // Create data for both tenants across different models
      await createTestUser(tenantA.id, { email: 'a@test.com' });
      await createTestUser(tenantB.id, { email: 'b@test.com' });
      await createTestStore(tenantA.id, { name: 'Store A' });
      await createTestStore(tenantB.id, { name: 'Store B' });
      await createTestSupplier(tenantA.id, { name: 'Supplier A' });
      await createTestSupplier(tenantB.id, { name: 'Supplier B' });

      const clientA = createTenantClient(tenantA.id);

      const users = await clientA.user.findMany();
      const stores = await clientA.store.findMany();
      const suppliers = await clientA.supplier.findMany();

      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('a@test.com');

      expect(stores).toHaveLength(1);
      expect(stores[0].name).toBe('Store A');

      expect(suppliers).toHaveLength(1);
      expect(suppliers[0].name).toBe('Supplier A');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Database-level isolation (PostgreSQL RLS)
  // ══════════════════════════════════════════════════════════════

  describe('RLS-level isolation (PostgreSQL policies)', () => {
    it('RLS blocks cross-tenant reads when session variable is set', async () => {
      await createTestProduct(tenantA.id, { name: 'A Only' });
      await createTestProduct(tenantB.id, { name: 'B Only' });

      // Use rlsPrisma (retailedge_app, RLS enforced) to verify isolation
      const results = await rlsPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$queryRaw`SELECT * FROM "Product"`;
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('A Only');
    });

    it('RLS blocks cross-tenant writes when session variable is set', async () => {
      const productB = await createTestProduct(tenantB.id, { name: 'B Product' });

      // Use rlsPrisma to verify RLS blocks the write
      const result = await rlsPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$executeRaw`UPDATE "Product" SET "name" = 'Hijacked' WHERE "id" = ${productB.id}`;
      });

      // Should affect 0 rows (RLS hides the row)
      expect(result).toBe(0);

      // Verify unchanged (admin client can see all rows)
      const unchanged = await testPrisma.product.findUnique({
        where: { id: productB.id },
      });
      expect(unchanged.name).toBe('B Product');
    });

    it('RLS returns zero rows when no session variable is set (strict policy)', async () => {
      await createTestProduct(tenantA.id, { name: 'A' });
      await createTestProduct(tenantB.id, { name: 'B' });

      // Without setting session variable, strict RLS returns zero rows
      // (safe default — no data leaks when tenant context is missing)
      const results = await rlsPrisma.$queryRaw`SELECT * FROM "Product"`;
      expect(results).toHaveLength(0);
    });

    it('admin client bypasses RLS (BYPASSRLS role)', async () => {
      await createTestProduct(tenantA.id, { name: 'A' });
      await createTestProduct(tenantB.id, { name: 'B' });

      // Admin client (BYPASSRLS) sees all rows regardless of session variable
      const results = await testPrisma.$queryRaw`SELECT * FROM "Product"`;
      expect(results).toHaveLength(2);
    });

    it('RLS isolates tenant table itself', async () => {
      // Use rlsPrisma — tenant A can only see its own tenant record
      const results = await rlsPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$queryRaw`SELECT * FROM "Tenant"`;
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Business A');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Connection pool safety — concurrent tenant isolation
  // ══════════════════════════════════════════════════════════════

  describe('Concurrent tenant isolation', () => {
    it('concurrent requests with different tenants never leak data', async () => {
      // Create distinct products for each tenant
      await createTestProduct(tenantA.id, { name: 'A-Product' });
      await createTestProduct(tenantB.id, { name: 'B-Product' });

      const clientA = createTenantClient(tenantA.id);
      const clientB = createTenantClient(tenantB.id);

      // Fire 10 concurrent queries: 5 as tenantA, 5 as tenantB
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          clientA.product.findMany().then((rows) => ({ tenant: 'A', rows })),
          clientB.product.findMany().then((rows) => ({ tenant: 'B', rows })),
        );
      }

      const results = await Promise.all(promises);

      // Every tenantA query must return only A's product
      const aResults = results.filter((r) => r.tenant === 'A');
      for (const r of aResults) {
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].name).toBe('A-Product');
        expect(r.rows[0].tenantId).toBe(tenantA.id);
      }

      // Every tenantB query must return only B's product
      const bResults = results.filter((r) => r.tenant === 'B');
      for (const r of bResults) {
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].name).toBe('B-Product');
        expect(r.rows[0].tenantId).toBe(tenantB.id);
      }
    });

    it('INSERT for tenantA cannot write to tenantB context', async () => {
      const clientA = createTenantClient(tenantA.id);

      // Even if we try to sneak in tenantB's id, the app layer overwrites it
      const product = await clientA.product.create({
        data: { name: 'Sneaky', tenantId: tenantB.id },
      });

      // Application layer should force tenantA's id
      expect(product.tenantId).toBe(tenantA.id);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Edge cases
  // ══════════════════════════════════════════════════════════════

  describe('Edge cases', () => {
    it('createTenantClient throws without tenantId', () => {
      expect(() => createTenantClient(null)).toThrow('requires a tenantId');
      expect(() => createTenantClient(undefined)).toThrow('requires a tenantId');
      expect(() => createTenantClient('')).toThrow('requires a tenantId');
    });

    it('findFirst with tenant scope returns null for cross-tenant query', async () => {
      const productB = await createTestProduct(tenantB.id, { name: 'B Only' });

      const clientA = createTenantClient(tenantA.id);
      const result = await clientA.product.findFirst({
        where: { id: productB.id },
      });

      expect(result).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Section B: New RLS policies — representative samples
  // ══════════════════════════════════════════════════════════════

  describe('Section B — New RLS policies (sample from each category)', () => {
    it('Integration: GmailIntegration isolated per tenant', async () => {
      await createTestGmailIntegration(tenantA.id, { email: 'a@gmail.com' });
      await createTestGmailIntegration(tenantB.id, { email: 'b@gmail.com' });

      const clientA = createTenantClient(tenantA.id);
      const integrations = await clientA.gmailIntegration.findMany();

      expect(integrations).toHaveLength(1);
      expect(integrations[0].email).toBe('a@gmail.com');
    });

    it('Intelligence: CompetitorMonitor isolated per tenant', async () => {
      const productA = await createTestProduct(tenantA.id, { name: 'Product A' });
      const productB = await createTestProduct(tenantB.id, { name: 'Product B' });
      await createTestCompetitorMonitor(tenantA.id, productA.id, { competitor: 'woolworths' });
      await createTestCompetitorMonitor(tenantB.id, productB.id, { competitor: 'coles' });

      const clientA = createTenantClient(tenantA.id);
      const monitors = await clientA.competitorMonitor.findMany();

      expect(monitors).toHaveLength(1);
      expect(monitors[0].competitor).toBe('woolworths');
    });

    it('Observability: ApiUsageLog isolated per tenant', async () => {
      await createTestApiUsageLog(tenantA.id, { endpoint: 'ocr' });
      await createTestApiUsageLog(tenantB.id, { endpoint: 'match' });

      const clientA = createTenantClient(tenantA.id);
      const logs = await clientA.apiUsageLog.findMany();

      expect(logs).toHaveLength(1);
      expect(logs[0].endpoint).toBe('ocr');
    });

    it('Prompt System: TenantPromptOverride isolated per tenant', async () => {
      const clientA = createTenantClient(tenantA.id);
      const clientB = createTenantClient(tenantB.id);

      await clientA.tenantPromptOverride.create({
        data: {
          agentTypeKey: 'test_agent',
          action: 'add',
          customText: 'Override A',
          category: 'rule',
          isActive: true,
        },
      });
      await clientB.tenantPromptOverride.create({
        data: {
          agentTypeKey: 'test_agent',
          action: 'add',
          customText: 'Override B',
          category: 'rule',
          isActive: true,
        },
      });

      const overridesA = await clientA.tenantPromptOverride.findMany();
      expect(overridesA).toHaveLength(1);
      expect(overridesA[0].customText).toBe('Override A');
    });

    it('Import Pipeline: ImportJob isolated per tenant', async () => {
      const userA = await createTestUser(tenantA.id, { email: 'imp-a@test.com' });
      const userB = await createTestUser(tenantB.id, { email: 'imp-b@test.com' });
      const clientA = createTenantClient(tenantA.id);
      const clientB = createTenantClient(tenantB.id);

      await clientA.importJob.create({
        data: { userId: userA.id, status: 'PENDING', sourceType: 'CSV_UPLOAD' },
      });
      await clientB.importJob.create({
        data: { userId: userB.id, status: 'PENDING', sourceType: 'CSV_UPLOAD' },
      });

      const jobsA = await clientA.importJob.findMany();
      expect(jobsA).toHaveLength(1);
      expect(jobsA[0].tenantId).toBe(tenantA.id);
    });

    it('AI/ML: ProductEmbedding isolated per tenant', async () => {
      const productA = await createTestProduct(tenantA.id, { name: 'Embed A' });
      const productB = await createTestProduct(tenantB.id, { name: 'Embed B' });
      const clientA = createTenantClient(tenantA.id);
      const clientB = createTenantClient(tenantB.id);

      await clientA.productEmbedding.create({
        data: { productId: productA.id, model: 'test-model', embeddingText: 'flour', dimensions: 1024 },
      });
      await clientB.productEmbedding.create({
        data: { productId: productB.id, model: 'test-model', embeddingText: 'sugar', dimensions: 1024 },
      });

      const embeddingsA = await clientA.productEmbedding.findMany();
      expect(embeddingsA).toHaveLength(1);
      expect(embeddingsA[0].embeddingText).toBe('flour');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Section C: Nullable tenantId — special policies
  // ══════════════════════════════════════════════════════════════

  describe('Section C — Nullable tenantId tables', () => {
    it('PromptSuggestion: tenant query does NOT see null-tenantId rows', async () => {
      // Create an AgentRole for the FK requirement
      const role = await testPrisma.agentRole.upsert({
        where: { key: 'test_rls_agent' },
        create: { key: 'test_rls_agent', name: 'Test RLS Agent', model: 'test', maxTokens: 100 },
        update: {},
      });

      // Insert a system-generated row (null tenantId) via admin client
      await testPrisma.promptSuggestion.create({
        data: {
          tenantId: null,
          agentRoleId: role.id,
          suggestionType: 'system',
          suggestionContent: { text: 'system suggestion' },
          evidence: {},
          status: 'pending',
          source: 'meta_agent',
        },
      });
      // Insert a tenant-specific row
      await testPrisma.promptSuggestion.create({
        data: {
          tenantId: tenantA.id,
          agentRoleId: role.id,
          suggestionType: 'tenant',
          suggestionContent: { text: 'tenant A suggestion' },
          evidence: {},
          status: 'pending',
          source: 'suggestion_engine',
        },
      });

      // Tenant A should only see their own suggestion, not the system one
      const results = await rlsPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$queryRaw`SELECT * FROM "PromptSuggestion"`;
      });

      expect(results).toHaveLength(1);
      expect(results[0].tenantId).toBe(tenantA.id);
    });

    it('AiServiceLog: tenant query does NOT see null-tenantId platform logs', async () => {
      // Insert a platform-level log (null tenantId) via admin client
      await testPrisma.aiServiceLog.create({
        data: {
          tenantId: null,
          intent: 'TEXT_GENERATION',
          taskKey: 'system_task',
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          latencyMs: 500,
          status: 'success',
        },
      });
      // Insert a tenant-specific log
      await testPrisma.aiServiceLog.create({
        data: {
          tenantId: tenantA.id,
          intent: 'TEXT_GENERATION',
          taskKey: 'tenant_task',
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          latencyMs: 300,
          status: 'success',
        },
      });

      // Tenant A should only see their log
      const results = await rlsPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$queryRaw`SELECT * FROM "AiServiceLog"`;
      });

      expect(results).toHaveLength(1);
      expect(results[0].tenantId).toBe(tenantA.id);

      // Admin sees everything
      const allLogs = await testPrisma.aiServiceLog.findMany();
      expect(allLogs.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // Section D: Child table transitive protection
  // ══════════════════════════════════════════════════════════════

  describe('Section D — Child table transitive protection via includes', () => {
    it('ProductVariants via Product include — only returns own tenant', async () => {
      const productA = await createTestProduct(tenantA.id, { name: 'Flour' });
      const productB = await createTestProduct(tenantB.id, { name: 'Sugar' });
      const storeA = await createTestStore(tenantA.id, { name: 'Store A' });
      const storeB = await createTestStore(tenantB.id, { name: 'Store B' });

      await testPrisma.productVariant.create({
        data: { productId: productA.id, storeId: storeA.id, sku: 'FL-001', name: 'Flour 10kg' },
      });
      await testPrisma.productVariant.create({
        data: { productId: productB.id, storeId: storeB.id, sku: 'SU-001', name: 'Sugar 5kg' },
      });

      const clientA = createTenantClient(tenantA.id);
      const products = await clientA.product.findMany({
        include: { variants: true },
      });

      expect(products).toHaveLength(1);
      expect(products[0].name).toBe('Flour');
      expect(products[0].variants).toHaveLength(1);
      expect(products[0].variants[0].sku).toBe('FL-001');
    });
  });
});
