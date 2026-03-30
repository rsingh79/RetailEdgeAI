-- CreateTable
CREATE TABLE "AiServiceRegistry" (
    "id" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "fallbackProvider" TEXT,
    "fallbackModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "costPerUnit" DECIMAL(65,30),
    "costUnit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "intent" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(65,30),
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiServiceLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceRegistry_taskKey_key" ON "AiServiceRegistry"("taskKey");

-- CreateIndex
CREATE INDEX "AiServiceRegistry_intent_idx" ON "AiServiceRegistry"("intent");

-- CreateIndex
CREATE INDEX "AiServiceRegistry_isActive_idx" ON "AiServiceRegistry"("isActive");

-- CreateIndex
CREATE INDEX "AiServiceLog_tenantId_createdAt_idx" ON "AiServiceLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiServiceLog_taskKey_createdAt_idx" ON "AiServiceLog"("taskKey", "createdAt");

-- CreateIndex
CREATE INDEX "AiServiceLog_provider_createdAt_idx" ON "AiServiceLog"("provider", "createdAt");

-- AddForeignKey
ALTER TABLE "AiServiceLog" ADD CONSTRAINT "AiServiceLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

