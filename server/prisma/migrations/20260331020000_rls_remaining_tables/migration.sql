-- RLS policies for all remaining tenant-scoped tables.
-- Completes full RLS coverage across the entire schema.
--
-- Section B: 25 tables with non-nullable tenantId (standard strict policies)
-- Section C: 3 tables with nullable tenantId (special policies)
--
-- After this migration, 38 tables have RLS enforced (10 existing + 28 new).

-- ══════════════════════════════════════════════════════════════
-- SECTION B: Standard tenant isolation (25 tables)
-- ══════════════════════════════════════════════════════════════

-- ── Integration tables (9) ──────────────────────────────────

ALTER TABLE "GmailIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GmailIntegration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GmailIntegration"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "GmailIntegration" TO retailedge_app;

ALTER TABLE "GmailImportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GmailImportLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "GmailImportLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "GmailImportLog" TO retailedge_app;

ALTER TABLE "FolderIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FolderIntegration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FolderIntegration"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "FolderIntegration" TO retailedge_app;

ALTER TABLE "FolderImportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FolderImportLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FolderImportLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "FolderImportLog" TO retailedge_app;

ALTER TABLE "ShopifyIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopifyIntegration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopifyIntegration"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ShopifyIntegration" TO retailedge_app;

ALTER TABLE "ShopifyImportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopifyImportLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopifyImportLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ShopifyImportLog" TO retailedge_app;

ALTER TABLE "ShopifyOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopifyOrder" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ShopifyOrder"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ShopifyOrder" TO retailedge_app;

ALTER TABLE "DriveIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriveIntegration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DriveIntegration"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "DriveIntegration" TO retailedge_app;

ALTER TABLE "DriveImportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriveImportLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DriveImportLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "DriveImportLog" TO retailedge_app;

-- ── Intelligence tables (3) ─────────────────────────────────

ALTER TABLE "CompetitorMonitor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetitorMonitor" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompetitorMonitor"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "CompetitorMonitor" TO retailedge_app;

ALTER TABLE "CompetitorPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompetitorPrice" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CompetitorPrice"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "CompetitorPrice" TO retailedge_app;

ALTER TABLE "PriceAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceAlert" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PriceAlert"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "PriceAlert" TO retailedge_app;

-- ── Observability tables (2) ────────────────────────────────

ALTER TABLE "ApiUsageLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiUsageLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApiUsageLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ApiUsageLog" TO retailedge_app;

ALTER TABLE "TenantAccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantAccessLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantAccessLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "TenantAccessLog" TO retailedge_app;

-- ── Prompt System tables (6) ────────────────────────────────

ALTER TABLE "TenantPromptOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPromptOverride" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantPromptOverride"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "TenantPromptOverride" TO retailedge_app;

ALTER TABLE "PromptConflict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptConflict" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PromptConflict"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "PromptConflict" TO retailedge_app;

ALTER TABLE "PromptChangeLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptChangeLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PromptChangeLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "PromptChangeLog" TO retailedge_app;

ALTER TABLE "TenantPromptConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantPromptConfig" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantPromptConfig"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "TenantPromptConfig" TO retailedge_app;

ALTER TABLE "TenantFewShotExample" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantFewShotExample" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantFewShotExample"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "TenantFewShotExample" TO retailedge_app;

ALTER TABLE "InteractionSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InteractionSignal" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "InteractionSignal"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "InteractionSignal" TO retailedge_app;

-- ── Import Pipeline tables (4) ──────────────────────────────

ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ImportJob"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ImportJob" TO retailedge_app;

ALTER TABLE "ApprovalQueueEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApprovalQueueEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ApprovalQueueEntry"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ApprovalQueueEntry" TO retailedge_app;

ALTER TABLE "ProductImportRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImportRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductImportRecord"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ProductImportRecord" TO retailedge_app;

ALTER TABLE "TenantSourceRegistry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantSourceRegistry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantSourceRegistry"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "TenantSourceRegistry" TO retailedge_app;

-- ── AI/ML tables (1) ────────────────────────────────────────

ALTER TABLE "ProductEmbedding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductEmbedding" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProductEmbedding"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "ProductEmbedding" TO retailedge_app;

-- ══════════════════════════════════════════════════════════════
-- SECTION C: Nullable tenantId tables (3 tables)
--
-- Two policies each:
--   1. tenant_isolation: tenant queries see only their own rows
--      (null-tenantId system rows are hidden from tenants)
--   2. system_insert: allows basePrisma (no session var) to
--      INSERT null-tenantId rows for system operations
-- ══════════════════════════════════════════════════════════════

-- PromptSuggestion (tenantId String? — some system-generated)
ALTER TABLE "PromptSuggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptSuggestion" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PromptSuggestion"
  USING ("tenantId" IS NOT NULL AND "tenantId" = current_tenant_id());
CREATE POLICY system_insert ON "PromptSuggestion"
  FOR INSERT WITH CHECK (
    "tenantId" = current_tenant_id()
    OR ("tenantId" IS NULL AND current_tenant_id() IS NULL)
  );
GRANT ALL ON "PromptSuggestion" TO retailedge_app;

-- PromptAuditLog (tenantId String? — system-level audit entries)
ALTER TABLE "PromptAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PromptAuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PromptAuditLog"
  USING ("tenantId" IS NOT NULL AND "tenantId" = current_tenant_id());
CREATE POLICY system_insert ON "PromptAuditLog"
  FOR INSERT WITH CHECK (
    "tenantId" = current_tenant_id()
    OR ("tenantId" IS NULL AND current_tenant_id() IS NULL)
  );
GRANT ALL ON "PromptAuditLog" TO retailedge_app;

-- AiServiceLog (tenantId String? — null for platform-level AI calls)
ALTER TABLE "AiServiceLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiServiceLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiServiceLog"
  USING ("tenantId" IS NOT NULL AND "tenantId" = current_tenant_id());
CREATE POLICY system_insert ON "AiServiceLog"
  FOR INSERT WITH CHECK (
    "tenantId" = current_tenant_id()
    OR ("tenantId" IS NULL AND current_tenant_id() IS NULL)
  );
GRANT ALL ON "AiServiceLog" TO retailedge_app;
