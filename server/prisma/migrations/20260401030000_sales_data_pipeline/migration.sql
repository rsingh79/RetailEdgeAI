-- Sales Data Pipeline
-- Part 1: Fix ShopifyOrder/ShopifyOrderLine missing fields
-- Part 2: Create canonical SalesTransaction + SalesLineItem tables with RLS

-- ══════════════════════════════════════════════════════════════
-- Part 1: ShopifyOrder — add totalDiscount, sourceName
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "ShopifyOrder" ADD COLUMN "totalDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ShopifyOrder" ADD COLUMN "sourceName" TEXT;

-- ══════════════════════════════════════════════════════════════
-- Part 1: ShopifyOrderLine — add discount
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "ShopifyOrderLine" ADD COLUMN "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- ══════════════════════════════════════════════════════════════
-- Part 2: SalesTransaction
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "SalesTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "channel" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DOUBLE PRECISION,
    "totalDiscount" DOUBLE PRECISION,
    "totalTax" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "customerName" TEXT,
    "orderReference" TEXT,
    "metadata" JSONB,
    "importJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTransaction_pkey" PRIMARY KEY ("id")
);

-- ══════════════════════════════════════════════════════════════
-- Part 2: SalesLineItem
-- ══════════════════════════════════════════════════════════════

CREATE TABLE "SalesLineItem" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "sourceProductId" TEXT,
    "sourceVariantId" TEXT,
    "productName" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceAtSale" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costPriceAtSale" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginAmount" DOUBLE PRECISION,
    "marginPercent" DOUBLE PRECISION,
    "costDataAvailable" BOOLEAN NOT NULL DEFAULT false,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchConfidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesLineItem_pkey" PRIMARY KEY ("id")
);

-- ══════════════════════════════════════════════════════════════
-- Indexes
-- ══════════════════════════════════════════════════════════════

-- SalesTransaction
CREATE UNIQUE INDEX "SalesTransaction_tenantId_source_sourceId_key"
    ON "SalesTransaction"("tenantId", "source", "sourceId");
CREATE INDEX "SalesTransaction_tenantId_transactionDate_idx"
    ON "SalesTransaction"("tenantId", "transactionDate");
CREATE INDEX "SalesTransaction_tenantId_source_idx"
    ON "SalesTransaction"("tenantId", "source");

-- SalesLineItem
CREATE UNIQUE INDEX "SalesLineItem_transactionId_sourceVariantId_key"
    ON "SalesLineItem"("transactionId", "sourceVariantId");
CREATE INDEX "SalesLineItem_tenantId_productId_idx"
    ON "SalesLineItem"("tenantId", "productId");
CREATE INDEX "SalesLineItem_tenantId_matchStatus_idx"
    ON "SalesLineItem"("tenantId", "matchStatus");
CREATE INDEX "SalesLineItem_tenantId_costDataAvailable_idx"
    ON "SalesLineItem"("tenantId", "costDataAvailable");

-- ══════════════════════════════════════════════════════════════
-- Foreign keys
-- ══════════════════════════════════════════════════════════════

ALTER TABLE "SalesTransaction" ADD CONSTRAINT "SalesTransaction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesLineItem" ADD CONSTRAINT "SalesLineItem_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "SalesTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesLineItem" ADD CONSTRAINT "SalesLineItem_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesLineItem" ADD CONSTRAINT "SalesLineItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ══════════════════════════════════════════════════════════════
-- Row-Level Security (strict — no NULL fallback)
-- ══════════════════════════════════════════════════════════════

-- SalesTransaction
ALTER TABLE "SalesTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesTransaction"
    USING ("tenantId" = current_tenant_id());
GRANT ALL ON "SalesTransaction" TO retailedge_app;

-- SalesLineItem
ALTER TABLE "SalesLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SalesLineItem" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "SalesLineItem"
    USING ("tenantId" = current_tenant_id());
GRANT ALL ON "SalesLineItem" TO retailedge_app;
