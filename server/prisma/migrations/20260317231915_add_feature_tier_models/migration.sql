-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "planTierId" TEXT;

-- CreateTable
CREATE TABLE "Feature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "annualPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTierFeature" (
    "planTierId" TEXT NOT NULL,
    "featureId" TEXT NOT NULL,

    CONSTRAINT "PlanTierFeature_pkey" PRIMARY KEY ("planTierId","featureId")
);

-- CreateTable
CREATE TABLE "PlanTierLimit" (
    "id" TEXT NOT NULL,
    "planTierId" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "limitValue" INTEGER NOT NULL,
    "description" TEXT,

    CONSTRAINT "PlanTierLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "Feature"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTier_slug_key" ON "PlanTier"("slug");

-- CreateIndex
CREATE INDEX "PlanTierFeature_featureId_idx" ON "PlanTierFeature"("featureId");

-- CreateIndex
CREATE INDEX "PlanTierLimit_planTierId_idx" ON "PlanTierLimit"("planTierId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTierLimit_planTierId_limitKey_key" ON "PlanTierLimit"("planTierId", "limitKey");

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_planTierId_fkey" FOREIGN KEY ("planTierId") REFERENCES "PlanTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTierFeature" ADD CONSTRAINT "PlanTierFeature_planTierId_fkey" FOREIGN KEY ("planTierId") REFERENCES "PlanTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTierFeature" ADD CONSTRAINT "PlanTierFeature_featureId_fkey" FOREIGN KEY ("featureId") REFERENCES "Feature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTierLimit" ADD CONSTRAINT "PlanTierLimit_planTierId_fkey" FOREIGN KEY ("planTierId") REFERENCES "PlanTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
