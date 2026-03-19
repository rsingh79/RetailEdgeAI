-- RLS policies for DriveIntegration
ALTER TABLE "DriveIntegration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriveIntegration" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DriveIntegration"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '' OR "tenantId" = current_setting('app.current_tenant_id', true));

-- RLS policies for DriveImportLog
ALTER TABLE "DriveImportLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DriveImportLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DriveImportLog"
  USING (current_setting('app.current_tenant_id', true) IS NULL OR current_setting('app.current_tenant_id', true) = '' OR "tenantId" = current_setting('app.current_tenant_id', true));
