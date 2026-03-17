-- Row-Level Security (RLS) for multi-tenant isolation
-- Defense-in-depth: even if application-level filtering fails, PostgreSQL
-- blocks cross-tenant data access via session variable check.
--
-- How it works:
--   1. Application sets: SET LOCAL "app.current_tenant_id" = '<tenantId>'
--   2. RLS policies filter rows where tenantId = current_tenant_id()
--   3. When session var is NOT set (migrations, seeding), all rows are visible

-- Helper function: returns the current tenant ID from session variable
-- Returns NULL if the variable is not set (allowing unrestricted access for admin/migration ops)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS TEXT AS $$
  SELECT nullif(current_setting('app.current_tenant_id', true), '');
$$ LANGUAGE SQL STABLE;

-- ══════════════════════════════════════════════════════════════
-- Tenant table: a tenant can only see its own record
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Tenant"
  USING (current_tenant_id() IS NULL OR "id" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- User
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "User"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- Store
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Store" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Store"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- Product
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Product"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- Supplier
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Supplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Supplier"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- Invoice
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Invoice"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- PricingRule
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "PricingRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PricingRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PricingRule"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- AuditLog
-- ══════════════════════════════════════════════════════════════
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AuditLog"
  USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id());

-- ══════════════════════════════════════════════════════════════
-- Child tables: ProductVariant, InvoiceLine, InvoiceLineMatch,
-- SupplierProductMapping do NOT have a tenantId column.
-- They are protected transitively through their parent's FK:
--   ProductVariant → Product (tenantId) + Store (tenantId)
--   InvoiceLine → Invoice (tenantId)
--   InvoiceLineMatch → InvoiceLine → Invoice (tenantId)
--   SupplierProductMapping → Supplier (tenantId)
-- ══════════════════════════════════════════════════════════════
