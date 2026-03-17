import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import { createTenantClient } from '../src/lib/prisma.js';
import {
  createTestTenant,
  createTestUser,
  createTestProduct,
  createTestStore,
  createTestSupplier,
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

      // Set session variable to tenant A and query via raw SQL
      // Note: SET LOCAL doesn't support parameterized values, so use $executeRawUnsafe
      const results = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$queryRaw`SELECT * FROM "Product"`;
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('A Only');
    });

    it('RLS blocks cross-tenant writes when session variable is set', async () => {
      const productB = await createTestProduct(tenantB.id, { name: 'B Product' });

      // Try to update tenant B's product while session says tenant A
      const result = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$executeRaw`UPDATE "Product" SET "name" = 'Hijacked' WHERE "id" = ${productB.id}`;
      });

      // Should affect 0 rows (RLS hides the row)
      expect(result).toBe(0);

      // Verify unchanged
      const unchanged = await testPrisma.product.findUnique({
        where: { id: productB.id },
      });
      expect(unchanged.name).toBe('B Product');
    });

    it('RLS allows reads when no session variable is set (migration/seed mode)', async () => {
      await createTestProduct(tenantA.id, { name: 'A' });
      await createTestProduct(tenantB.id, { name: 'B' });

      // Without setting session variable, all rows should be visible
      const results = await testPrisma.$queryRaw`SELECT * FROM "Product"`;
      expect(results).toHaveLength(2);
    });

    it('RLS isolates tenant table itself', async () => {
      // Tenant A can only see its own tenant record
      const results = await testPrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL "app.current_tenant_id" = '${tenantA.id}'`);
        return tx.$queryRaw`SELECT * FROM "Tenant"`;
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Business A');
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
});
