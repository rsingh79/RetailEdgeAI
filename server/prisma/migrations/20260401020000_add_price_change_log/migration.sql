-- Price Change Audit Log
-- Tracks every price modification across the platform for trust and analysis.

-- ══════════════════════════════════════════════════════════════
-- Create table
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "PriceChangeLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "priceType" TEXT NOT NULL,
    "oldPrice" DOUBLE PRECISION,
    "newPrice" DOUBLE PRECISION NOT NULL,
    "changeSource" TEXT NOT NULL,
    "changedBy" TEXT,
    "sourceRef" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceChangeLog_pkey" PRIMARY KEY ("id")
);

-- ══════════════════════════════════════════════════════════════
-- Indexes
-- ══════════════════════════════════════════════════════════════

CREATE INDEX "PriceChangeLog_tenantId_productId_idx" ON "PriceChangeLog"("tenantId", "productId");
CREATE INDEX "PriceChangeLog_tenantId_createdAt_idx" ON "PriceChangeLog"("tenantId", "createdAt");

-- ══════════════════════════════════════════════════════════════
-- Foreign keys
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "PriceChangeLog" ADD CONSTRAINT "PriceChangeLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PriceChangeLog" ADD CONSTRAINT "PriceChangeLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════
-- Row-Level Security
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "PriceChangeLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PriceChangeLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PriceChangeLog"
  USING ("tenantId" = current_tenant_id());
GRANT ALL ON "PriceChangeLog" TO retailedge_app;
