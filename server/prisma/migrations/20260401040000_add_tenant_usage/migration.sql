-- TenantUsage — tracks per-tenant resource consumption per billing period.
-- Supports usage cap enforcement for AI queries, products, integrations, etc.

-- ══════════════════════════════════════════════════════════════
-- Create table
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "TenantUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "aiQueriesUsed" INTEGER NOT NULL DEFAULT 0,
    "aiQueriesLimit" INTEGER NOT NULL,
    "productsImported" INTEGER NOT NULL DEFAULT 0,
    "productsLimit" INTEGER NOT NULL,
    "integrationsUsed" INTEGER NOT NULL DEFAULT 0,
    "integrationsLimit" INTEGER NOT NULL,
    "historicalSyncMonths" INTEGER NOT NULL,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantUsage_pkey" PRIMARY KEY ("id")
);

-- ══════════════════════════════════════════════════════════════
-- Indexes
-- ══════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX "TenantUsage_tenantId_billingPeriodStart_key"
    ON "TenantUsage"("tenantId", "billingPeriodStart");

CREATE INDEX "TenantUsage_tenantId_billingPeriodEnd_idx"
    ON "TenantUsage"("tenantId", "billingPeriodEnd");

-- ══════════════════════════════════════════════════════════════
-- Foreign keys
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "TenantUsage" ADD CONSTRAINT "TenantUsage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════
-- Row-Level Security (strict — no NULL fallback)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "TenantUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TenantUsage"
    USING ("tenantId" = current_tenant_id());
GRANT ALL ON "TenantUsage" TO retailedge_app;
