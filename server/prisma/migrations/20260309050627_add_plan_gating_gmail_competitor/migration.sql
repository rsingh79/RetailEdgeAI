-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "gmailMessageId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "maxApiCallsPerMonth" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "maxStores" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "GmailIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "historyId" TEXT,
    "lastPollAt" TIMESTAMP(3),
    "pollIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "senderWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "labelFilter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailImportLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "fileHash" TEXT,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "senderEmail" TEXT NOT NULL,
    "subject" TEXT,
    "attachmentName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "duplicateReason" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GmailImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorMonitor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competitor" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "externalSku" TEXT,
    "searchTerm" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastScrapedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorPrice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "competitorMonitorId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION,
    "unit" TEXT,
    "isOnSpecial" BOOLEAN NOT NULL DEFAULT false,
    "specialEndDate" TIMESTAMP(3),
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailIntegration_tenantId_key" ON "GmailIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "GmailIntegration_tenantId_idx" ON "GmailIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "GmailImportLog_tenantId_idx" ON "GmailImportLog"("tenantId");

-- CreateIndex
CREATE INDEX "GmailImportLog_tenantId_fileHash_idx" ON "GmailImportLog"("tenantId", "fileHash");

-- CreateIndex
CREATE INDEX "GmailImportLog_tenantId_invoiceNumber_invoiceDate_idx" ON "GmailImportLog"("tenantId", "invoiceNumber", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "GmailImportLog_tenantId_gmailMessageId_key" ON "GmailImportLog"("tenantId", "gmailMessageId");

-- CreateIndex
CREATE INDEX "CompetitorMonitor_tenantId_idx" ON "CompetitorMonitor"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorMonitor_productId_idx" ON "CompetitorMonitor"("productId");

-- CreateIndex
CREATE INDEX "CompetitorMonitor_competitor_idx" ON "CompetitorMonitor"("competitor");

-- CreateIndex
CREATE INDEX "CompetitorPrice_tenantId_idx" ON "CompetitorPrice"("tenantId");

-- CreateIndex
CREATE INDEX "CompetitorPrice_competitorMonitorId_idx" ON "CompetitorPrice"("competitorMonitorId");

-- CreateIndex
CREATE INDEX "CompetitorPrice_scrapedAt_idx" ON "CompetitorPrice"("scrapedAt");

-- CreateIndex
CREATE INDEX "PriceAlert_tenantId_idx" ON "PriceAlert"("tenantId");

-- CreateIndex
CREATE INDEX "PriceAlert_tenantId_isRead_idx" ON "PriceAlert"("tenantId", "isRead");

-- CreateIndex
CREATE INDEX "PriceAlert_productId_idx" ON "PriceAlert"("productId");

-- CreateIndex
CREATE INDEX "PriceAlert_createdAt_idx" ON "PriceAlert"("createdAt");

-- AddForeignKey
ALTER TABLE "GmailIntegration" ADD CONSTRAINT "GmailIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailImportLog" ADD CONSTRAINT "GmailImportLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorMonitor" ADD CONSTRAINT "CompetitorMonitor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorMonitor" ADD CONSTRAINT "CompetitorMonitor_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPrice" ADD CONSTRAINT "CompetitorPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorPrice" ADD CONSTRAINT "CompetitorPrice_competitorMonitorId_fkey" FOREIGN KEY ("competitorMonitorId") REFERENCES "CompetitorMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
