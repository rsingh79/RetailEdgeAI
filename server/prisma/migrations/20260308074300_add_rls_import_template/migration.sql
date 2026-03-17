-- Enable RLS on ImportTemplate (same pattern as other tenant-scoped tables)
ALTER TABLE "ImportTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImportTemplate" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ImportTemplate"
  USING (
    current_tenant_id() IS NULL
    OR "tenantId" = current_tenant_id()
  );

-- Grant access to the app role
GRANT ALL ON "ImportTemplate" TO retailedge_app;
