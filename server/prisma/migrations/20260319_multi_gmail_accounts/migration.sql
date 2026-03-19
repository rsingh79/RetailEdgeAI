-- AlterTable: Remove unique constraint on tenantId to allow multiple Gmail accounts per tenant
DROP INDEX IF EXISTS "GmailIntegration_tenantId_key";

-- CreateIndex: Add compound unique on tenantId + imapEmail to prevent duplicate email connections
CREATE UNIQUE INDEX "GmailIntegration_tenantId_imapEmail_key" ON "GmailIntegration"("tenantId", "imapEmail");
