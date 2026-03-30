-- ProductVariant: add Shopify IDs
ALTER TABLE "ProductVariant" ADD COLUMN "shopifyVariantId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "shopifyProductId" TEXT;
CREATE INDEX "ProductVariant_shopifyVariantId_idx" ON "ProductVariant"("shopifyVariantId");

-- ShopifyIntegration: add new fields
ALTER TABLE "ShopifyIntegration" ADD COLUMN "pushPricesOnExport" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ShopifyIntegration" ADD COLUMN "lastOrderSyncAt" TIMESTAMP(3);
ALTER TABLE "ShopifyIntegration" ADD COLUMN "orderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopifyIntegration" ALTER COLUMN "scopes" SET DEFAULT 'read_products,write_products,read_orders,read_customers';

-- ShopifyImportLog: add order sync fields
ALTER TABLE "ShopifyImportLog" ADD COLUMN "ordersPulled" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopifyImportLog" ADD COLUMN "ordersCreated" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopifyImportLog" ADD COLUMN "ordersUpdated" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ShopifyImportLog" ADD COLUMN "syncType" TEXT NOT NULL DEFAULT 'products';

-- ShopifyOrder
CREATE TABLE "ShopifyOrder" (
  "id"                TEXT NOT NULL,
  "tenantId"          TEXT NOT NULL,
  "shopifyOrderId"    TEXT NOT NULL,
  "shopifyOrderName"  TEXT,
  "integrationId"     TEXT NOT NULL,
  "orderDate"         TIMESTAMP(3) NOT NULL,
  "customerName"      TEXT,
  "customerEmail"     TEXT,
  "financialStatus"   TEXT,
  "fulfillmentStatus" TEXT,
  "totalPrice"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "subtotalPrice"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalTax"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"          TEXT NOT NULL DEFAULT 'AUD',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopifyOrder_integrationId_shopifyOrderId_key" UNIQUE ("integrationId","shopifyOrderId")
);
CREATE INDEX "ShopifyOrder_tenantId_idx" ON "ShopifyOrder"("tenantId");
CREATE INDEX "ShopifyOrder_orderDate_idx" ON "ShopifyOrder"("orderDate");
ALTER TABLE "ShopifyOrder" ADD CONSTRAINT "ShopifyOrder_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "ShopifyIntegration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ShopifyOrderLine
CREATE TABLE "ShopifyOrderLine" (
  "id"               TEXT NOT NULL,
  "orderId"          TEXT NOT NULL,
  "shopifyLineId"    TEXT NOT NULL,
  "productVariantId" TEXT,
  "sku"              TEXT,
  "productTitle"     TEXT,
  "variantTitle"     TEXT,
  "quantity"         INTEGER NOT NULL DEFAULT 1,
  "unitPrice"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalPrice"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopifyOrderLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShopifyOrderLine_orderId_idx" ON "ShopifyOrderLine"("orderId");
CREATE INDEX "ShopifyOrderLine_productVariantId_idx" ON "ShopifyOrderLine"("productVariantId");
ALTER TABLE "ShopifyOrderLine" ADD CONSTRAINT "ShopifyOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopifyOrderLine" ADD CONSTRAINT "ShopifyOrderLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
