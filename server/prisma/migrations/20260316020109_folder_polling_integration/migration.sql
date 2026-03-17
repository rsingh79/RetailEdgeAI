-- CreateTable
CREATE TABLE "FolderIntegration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "folderPath" TEXT,
    "lastPollAt" TIMESTAMP(3),
    "pollIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "filePatterns" TEXT[] DEFAULT ARRAY['*.pdf', '*.jpg', '*.jpeg', '*.png']::TEXT[],
    "moveToProcessed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FolderIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FolderImportLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT,
    "supplierName" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'imported',
    "duplicateReason" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolderImportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FolderIntegration_tenantId_key" ON "FolderIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "FolderIntegration_tenantId_idx" ON "FolderIntegration"("tenantId");

-- CreateIndex
CREATE INDEX "FolderImportLog_tenantId_idx" ON "FolderImportLog"("tenantId");

-- CreateIndex
CREATE INDEX "FolderImportLog_tenantId_fileHash_idx" ON "FolderImportLog"("tenantId", "fileHash");

-- CreateIndex
CREATE INDEX "FolderImportLog_tenantId_invoiceNumber_invoiceDate_idx" ON "FolderImportLog"("tenantId", "invoiceNumber", "invoiceDate");

-- CreateIndex
CREATE UNIQUE INDEX "FolderImportLog_tenantId_filePath_key" ON "FolderImportLog"("tenantId", "filePath");

-- AddForeignKey
ALTER TABLE "FolderIntegration" ADD CONSTRAINT "FolderIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolderImportLog" ADD CONSTRAINT "FolderImportLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
