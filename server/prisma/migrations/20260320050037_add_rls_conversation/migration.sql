-- RLS for Conversation table (tenant-scoped)
ALTER TABLE "Conversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Conversation" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "Conversation"
  USING (
    current_tenant_id() IS NULL
    OR "tenantId" = current_tenant_id()
  );

GRANT ALL ON "Conversation" TO retailedge_app;

-- Message is a child of Conversation (protected transitively via FK + CASCADE)
-- but we grant table permissions so the app user can query it
GRANT ALL ON "Message" TO retailedge_app;
