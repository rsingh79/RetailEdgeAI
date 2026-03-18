-- CreateTable
CREATE TABLE "ShopifyIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "scopes" TEXT NOT NULL DEFAULT 'read_products,write_products',
    "lastSyncAt" TIMESTAMP(3),
    "syncIntervalMin" INTEGER NOT NULL DEFAULT 60,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "productCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyImportLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "productsPulled" INTEGER NOT NULL DEFAULT 0,
    "productsCreated" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "variantsCreated" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyIntegration_tenantId_key" ON "ShopifyIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "ShopifyIntegration_tenantId_idx" ON "ShopifyIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "ShopifyImportLog_tenantId_idx" ON "ShopifyImportLog"("tenantId");

-- CreateIndex
CREATE INDEX "ShopifyImportLog_createdAt_idx" ON "ShopifyImportLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ShopifyIntegration" ADD CONSTRAINT "ShopifyIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyImportLog" ADD CONSTRAINT "ShopifyImportLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
