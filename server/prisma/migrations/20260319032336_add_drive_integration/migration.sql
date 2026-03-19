-- AlterTable
ALTER TABLE "FolderIntegration" ALTER COLUMN "filePatterns" SET DEFAULT ARRAY['*.pdf', '*.jpg', '*.jpeg', '*.png', '*.webp']::TEXT[];

-- CreateTable
CREATE TABLE "DriveIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "driveFolderId" TEXT NOT NULL,
    "driveFolderName" TEXT,
    "lastPollAt" TIMESTAMP(3),
    "pollIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriveIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveImportLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driveFileId" TEXT NOT NULL,
    "fileHash" TEXT,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "duplicateReason" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriveIntegration_tenantId_idx" ON "DriveIntegration"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveIntegration_tenantId_driveFolderId_key" ON "DriveIntegration"("tenantId", "driveFolderId");

-- CreateIndex
CREATE INDEX "DriveImportLog_tenantId_idx" ON "DriveImportLog"("tenantId");

-- CreateIndex
CREATE INDEX "DriveImportLog_tenantId_fileHash_idx" ON "DriveImportLog"("tenantId", "fileHash");

-- CreateIndex
CREATE INDEX "DriveImportLog_tenantId_invoiceNumber_invoiceDate_idx" ON "DriveImportLog"("tenantId", "invoiceNumber", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "DriveImportLog_tenantId_driveFileId_key" ON "DriveImportLog"("tenantId", "driveFileId");

-- AddForeignKey
ALTER TABLE "DriveIntegration" ADD CONSTRAINT "DriveIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveImportLog" ADD CONSTRAINT "DriveImportLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
