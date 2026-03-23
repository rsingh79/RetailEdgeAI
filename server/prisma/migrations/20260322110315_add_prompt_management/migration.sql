-- CreateTable
CREATE TABLE "AgentType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "agentTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "preamble" TEXT NOT NULL,
    "postamble" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptCondition" (
    "id" TEXT NOT NULL,
    "promptTemplateId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'rule',
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "validationKey" TEXT,
    "validationDesc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPromptOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promptConditionId" TEXT,
    "agentTypeKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "customText" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 999,
    "category" TEXT NOT NULL DEFAULT 'rule',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPromptOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptConflict" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "promptConditionId" TEXT NOT NULL,
    "tenantOverrideText" TEXT NOT NULL,
    "detectedReason" TEXT,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "validationPassed" BOOLEAN,
    "validationOutput" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptChangeLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "agentTypeKey" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "conditionKey" TEXT,
    "previousText" TEXT,
    "newText" TEXT,
    "reason" TEXT NOT NULL,
    "conversationExcerpt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentType_key_key" ON "AgentType"("key");

-- CreateIndex
CREATE INDEX "PromptTemplate_agentTypeId_idx" ON "PromptTemplate"("agentTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_agentTypeId_version_key" ON "PromptTemplate"("agentTypeId", "version");

-- CreateIndex
CREATE INDEX "PromptCondition_promptTemplateId_idx" ON "PromptCondition"("promptTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptCondition_promptTemplateId_key_key" ON "PromptCondition"("promptTemplateId", "key");

-- CreateIndex
CREATE INDEX "TenantPromptOverride_tenantId_idx" ON "TenantPromptOverride"("tenantId");

-- CreateIndex
CREATE INDEX "TenantPromptOverride_tenantId_agentTypeKey_idx" ON "TenantPromptOverride"("tenantId", "agentTypeKey");

-- CreateIndex
CREATE INDEX "TenantPromptOverride_promptConditionId_idx" ON "TenantPromptOverride"("promptConditionId");

-- CreateIndex
CREATE INDEX "PromptConflict_tenantId_idx" ON "PromptConflict"("tenantId");

-- CreateIndex
CREATE INDEX "PromptConflict_tenantId_promptConditionId_idx" ON "PromptConflict"("tenantId", "promptConditionId");

-- CreateIndex
CREATE INDEX "PromptChangeLog_tenantId_idx" ON "PromptChangeLog"("tenantId");

-- CreateIndex
CREATE INDEX "PromptChangeLog_tenantId_agentTypeKey_idx" ON "PromptChangeLog"("tenantId", "agentTypeKey");

-- CreateIndex
CREATE INDEX "PromptChangeLog_createdAt_idx" ON "PromptChangeLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_agentTypeId_fkey" FOREIGN KEY ("agentTypeId") REFERENCES "AgentType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptCondition" ADD CONSTRAINT "PromptCondition_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "PromptTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPromptOverride" ADD CONSTRAINT "TenantPromptOverride_promptConditionId_fkey" FOREIGN KEY ("promptConditionId") REFERENCES "PromptCondition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptConflict" ADD CONSTRAINT "PromptConflict_promptConditionId_fkey" FOREIGN KEY ("promptConditionId") REFERENCES "PromptCondition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
