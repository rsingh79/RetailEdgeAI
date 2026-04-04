-- Strict RLS policies: remove the NULL fallback that made RLS a no-op.
--
-- Previously, all policies had:
--   USING (current_tenant_id() IS NULL OR "tenantId" = current_tenant_id())
-- When app.current_tenant_id was not set, current_tenant_id() returned NULL,
-- and the IS NULL branch made ALL rows visible. This defeated the purpose of RLS.
--
-- Now every query sets the session variable via SET LOCAL in a batch transaction,
-- so the NULL fallback is no longer needed. Strict policies ensure that:
--   - With a session variable set: only that tenant's rows are visible
--   - Without a session variable: zero rows are visible (safe default)
--
-- Admin/migration operations use the `retailedge` role with BYPASSRLS,
-- which skips RLS entirely — no need for a NULL fallback.

-- ══════════════════════════════════════════════════════════════
-- BYPASSRLS grants are NOT in this migration.
-- They must be applied manually by a DBA with SUPERUSER privileges:
--   ALTER ROLE retailedge BYPASSRLS;
--   ALTER ROLE doadmin BYPASSRLS;  -- if using DigitalOcean managed PG
-- ══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- Drop and recreate all existing policies as strict
-- ══════════════════════════════════════════════════════════════

-- Tenant (policy checks id, not tenantId)
DROP POLICY IF EXISTS tenant_isolation ON "Tenant";
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = current_tenant_id());

-- User
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = current_tenant_id());

-- Store
DROP POLICY IF EXISTS tenant_isolation ON "Store";
CREATE POLICY tenant_isolation ON "Store"
  USING ("tenantId" = current_tenant_id());

-- Product
DROP POLICY IF EXISTS tenant_isolation ON "Product";
CREATE POLICY tenant_isolation ON "Product"
  USING ("tenantId" = current_tenant_id());

-- Supplier
DROP POLICY IF EXISTS tenant_isolation ON "Supplier";
CREATE POLICY tenant_isolation ON "Supplier"
  USING ("tenantId" = current_tenant_id());

-- Invoice
DROP POLICY IF EXISTS tenant_isolation ON "Invoice";
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("tenantId" = current_tenant_id());

-- PricingRule
DROP POLICY IF EXISTS tenant_isolation ON "PricingRule";
CREATE POLICY tenant_isolation ON "PricingRule"
  USING ("tenantId" = current_tenant_id());

-- AuditLog
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = current_tenant_id());

-- ImportTemplate
DROP POLICY IF EXISTS tenant_isolation ON "ImportTemplate";
CREATE POLICY tenant_isolation ON "ImportTemplate"
  USING ("tenantId" = current_tenant_id());

-- Conversation
DROP POLICY IF EXISTS tenant_isolation ON "Conversation";
CREATE POLICY tenant_isolation ON "Conversation"
  USING ("tenantId" = current_tenant_id());
