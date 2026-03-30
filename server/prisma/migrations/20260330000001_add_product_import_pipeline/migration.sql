-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'ANALYZING', 'AWAITING_CONFIRMATION', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('CSV_UPLOAD', 'SHOPIFY_SYNC', 'GMAIL_ATTACHMENT', 'FOLDER_FILE', 'DRIVE_FILE', 'MANUAL', 'API_PUSH');

-- CreateEnum
CREATE TYPE "ApprovalRoute" AS ENUM ('ROUTE_AUTO', 'ROUTE_REVIEW', 'ROUTE_REJECT');

-- CreateEnum
CREATE TYPE "ImportApprovalStatus" AS ENUM ('PENDING', 'AUTO_APPROVED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVE', 'REJECT', 'DEFER', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "InvoiceRiskLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MatchAction" AS ENUM ('CREATED', 'UPDATED', 'SKIPPED', 'MERGED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('FULL', 'INCREMENTAL');

-- CreateEnum
CREATE TYPE "AuditTriggerSource" AS ENUM ('UI_ACTION', 'SYSTEM_PROCESS');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "importJobId" TEXT,
ADD COLUMN     "triggerContext" JSONB,
ADD COLUMN     "triggerFunction" TEXT,
ADD COLUMN     "triggerSource" "AuditTriggerSource" NOT NULL DEFAULT 'SYSTEM_PROCESS';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "approvalStatus" "ImportApprovalStatus",
ADD COLUMN     "canonicalProductId" TEXT,
ADD COLUMN     "confidenceScore" DOUBLE PRECISION,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "importId" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "productImportedThrough" TEXT;

-- CreateTable
CREATE TABLE "GlobalSourceRegistry" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "description" TEXT,
    "expectedHeaders" JSONB,
    "defaultMapping" JSONB,
    "columnSignatures" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalSourceRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSourceRegistry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "globalSourceId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "description" TEXT,
    "expectedHeaders" JSONB,
    "customMapping" JSONB,
    "columnSignatures" JSONB,
    "syncMode" "SyncMode" NOT NULL DEFAULT 'FULL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSourceRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "sourceType" "SourceType" NOT NULL,
    "sourceName" TEXT,
    "tenantSourceId" TEXT,
    "fileName" TEXT,
    "fileHash" TEXT,
    "totalRows" INTEGER,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "columnMapping" JSONB,
    "patterns" JSONB,
    "gstDetected" BOOLEAN NOT NULL DEFAULT false,
    "gstRate" DOUBLE PRECISION,
    "hasVariants" BOOLEAN NOT NULL DEFAULT false,
    "groupByColumn" TEXT,
    "variantColumns" JSONB,
    "syncMode" "SyncMode" NOT NULL DEFAULT 'FULL',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "rowsCreated" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "rowsPendingApproval" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalQueueEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "approvalRoute" "ApprovalRoute" NOT NULL,
    "invoiceRiskLevel" "InvoiceRiskLevel" NOT NULL DEFAULT 'NONE',
    "status" "ImportApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "normalizedData" JSONB NOT NULL,
    "matchResult" JSONB,
    "similarProducts" JSONB,
    "confidenceScore" DOUBLE PRECISION,
    "confidenceBreakdown" JSONB,
    "riskExplanation" TEXT,
    "action" "ApprovalAction",
    "actionedBy" TEXT,
    "actionedAt" TIMESTAMP(3),
    "actionNotes" TEXT,
    "updatedFields" JSONB,
    "linkedProductId" TEXT,
    "productId" TEXT,
    "slaDeadline" TIMESTAMP(3),
    "requiresSecondApproval" BOOLEAN NOT NULL DEFAULT false,
    "secondActionedBy" TEXT,
    "secondActionedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalQueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImportRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rawSourceData" JSONB NOT NULL,
    "normalizedData" JSONB,
    "fingerprintTier" INTEGER,
    "fingerprint" TEXT,
    "fingerprintComponents" JSONB,
    "matchAction" "MatchAction",
    "matchedProductId" TEXT,
    "matchScore" DOUBLE PRECISION,
    "matchedOn" JSONB,
    "productId" TEXT,
    "approvalQueueId" TEXT,
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalSourceRegistry_key_key" ON "GlobalSourceRegistry"("key");

-- CreateIndex
CREATE INDEX "TenantSourceRegistry_tenantId_idx" ON "TenantSourceRegistry"("tenantId");

-- CreateIndex
CREATE INDEX "TenantSourceRegistry_globalSourceId_idx" ON "TenantSourceRegistry"("globalSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSourceRegistry_tenantId_key_key" ON "TenantSourceRegistry"("tenantId", "key");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_status_idx" ON "ImportJob"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_createdAt_idx" ON "ImportJob"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

-- CreateIndex
CREATE INDEX "ApprovalQueueEntry_tenantId_status_idx" ON "ApprovalQueueEntry"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ApprovalQueueEntry_tenantId_invoiceRiskLevel_idx" ON "ApprovalQueueEntry"("tenantId", "invoiceRiskLevel");

-- CreateIndex
CREATE INDEX "ApprovalQueueEntry_importJobId_idx" ON "ApprovalQueueEntry"("importJobId");

-- CreateIndex
CREATE INDEX "ApprovalQueueEntry_productId_idx" ON "ApprovalQueueEntry"("productId");

-- CreateIndex
CREATE INDEX "ApprovalQueueEntry_tenantId_createdAt_idx" ON "ApprovalQueueEntry"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImportRecord_tenantId_idx" ON "ProductImportRecord"("tenantId");

-- CreateIndex
CREATE INDEX "ProductImportRecord_importJobId_idx" ON "ProductImportRecord"("importJobId");

-- CreateIndex
CREATE INDEX "ProductImportRecord_productId_idx" ON "ProductImportRecord"("productId");

-- CreateIndex
CREATE INDEX "ProductImportRecord_fingerprint_idx" ON "ProductImportRecord"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImportRecord_importJobId_rowIndex_key" ON "ProductImportRecord"("importJobId", "rowIndex");

-- CreateIndex
CREATE INDEX "AuditLog_importJobId_idx" ON "AuditLog"("importJobId");

-- CreateIndex
CREATE INDEX "Product_tenantId_externalId_idx" ON "Product"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "Product_fingerprint_idx" ON "Product"("fingerprint");

-- CreateIndex
CREATE INDEX "Product_importId_idx" ON "Product"("importId");

-- CreateIndex
CREATE INDEX "Product_canonicalProductId_idx" ON "Product"("canonicalProductId");

-- CreateIndex
CREATE INDEX "Product_approvalStatus_idx" ON "Product"("approvalStatus");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSourceRegistry" ADD CONSTRAINT "TenantSourceRegistry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSourceRegistry" ADD CONSTRAINT "TenantSourceRegistry_globalSourceId_fkey" FOREIGN KEY ("globalSourceId") REFERENCES "GlobalSourceRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantSourceId_fkey" FOREIGN KEY ("tenantSourceId") REFERENCES "TenantSourceRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalQueueEntry" ADD CONSTRAINT "ApprovalQueueEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalQueueEntry" ADD CONSTRAINT "ApprovalQueueEntry_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalQueueEntry" ADD CONSTRAINT "ApprovalQueueEntry_actionedBy_fkey" FOREIGN KEY ("actionedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportRecord" ADD CONSTRAINT "ProductImportRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportRecord" ADD CONSTRAINT "ProductImportRecord_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportRecord" ADD CONSTRAINT "ProductImportRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportRecord" ADD CONSTRAINT "ProductImportRecord_approvalQueueId_fkey" FOREIGN KEY ("approvalQueueId") REFERENCES "ApprovalQueueEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

