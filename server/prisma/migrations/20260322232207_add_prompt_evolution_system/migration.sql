-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "agentRoleKey" TEXT,
ADD COLUMN     "resolutionStatus" TEXT,
ADD COLUMN     "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AgentRole" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptBaseVersion" (
    "id" TEXT NOT NULL,
    "agentRoleId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "parentVersionId" TEXT,
    "changeReason" TEXT NOT NULL,
    "performanceSnapshot" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptBaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPromptConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentRoleId" TEXT NOT NULL,
    "baseVersionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "toneSettings" JSONB,
    "customInstructions" JSONB,
    "domainTerminology" JSONB,
    "escalationRules" JSONB,
    "knowledgeSourcePriorities" JSONB,
    "enabledCapabilities" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPromptConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantFewShotExample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "agentRoleId" TEXT NOT NULL,
    "inputText" TEXT NOT NULL,
    "idealOutputText" TEXT NOT NULL,
    "sourceConversationId" TEXT,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "autoCurated" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantFewShotExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InteractionSignal" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "tenantId" TEXT NOT NULL,
    "agentRoleId" TEXT NOT NULL,
    "baseVersionUsed" TEXT NOT NULL,
    "configVersionUsed" TEXT,
    "resolutionStatus" TEXT NOT NULL DEFAULT 'unknown',
    "userSatisfactionScore" INTEGER,
    "humanOverride" BOOLEAN NOT NULL DEFAULT false,
    "humanOverrideDiff" JSONB,
    "correctionCount" INTEGER NOT NULL DEFAULT 0,
    "escalationOccurred" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptSuggestion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "agentRoleId" TEXT NOT NULL,
    "suggestionType" TEXT NOT NULL,
    "suggestionContent" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "impactEstimate" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "appliedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'suggestion_engine',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "agentRoleId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "suggestionId" TEXT,
    "reason" TEXT,
    "baseVersionId" TEXT,
    "tenantConfigId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRole_key_key" ON "AgentRole"("key");

-- CreateIndex
CREATE INDEX "PromptBaseVersion_agentRoleId_isActive_idx" ON "PromptBaseVersion"("agentRoleId", "isActive");

-- CreateIndex
CREATE INDEX "PromptBaseVersion_agentRoleId_idx" ON "PromptBaseVersion"("agentRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptBaseVersion_agentRoleId_versionNumber_key" ON "PromptBaseVersion"("agentRoleId", "versionNumber");

-- CreateIndex
CREATE INDEX "TenantPromptConfig_tenantId_agentRoleId_isActive_idx" ON "TenantPromptConfig"("tenantId", "agentRoleId", "isActive");

-- CreateIndex
CREATE INDEX "TenantPromptConfig_tenantId_agentRoleId_idx" ON "TenantPromptConfig"("tenantId", "agentRoleId");

-- CreateIndex
CREATE INDEX "TenantPromptConfig_baseVersionId_idx" ON "TenantPromptConfig"("baseVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPromptConfig_tenantId_agentRoleId_versionNumber_key" ON "TenantPromptConfig"("tenantId", "agentRoleId", "versionNumber");

-- CreateIndex
CREATE INDEX "TenantFewShotExample_tenantId_agentRoleId_isActive_idx" ON "TenantFewShotExample"("tenantId", "agentRoleId", "isActive");

-- CreateIndex
CREATE INDEX "TenantFewShotExample_tenantId_agentRoleId_idx" ON "TenantFewShotExample"("tenantId", "agentRoleId");

-- CreateIndex
CREATE INDEX "TenantFewShotExample_tenantId_qualityScore_idx" ON "TenantFewShotExample"("tenantId", "qualityScore");

-- CreateIndex
CREATE INDEX "TenantFewShotExample_sourceConversationId_idx" ON "TenantFewShotExample"("sourceConversationId");

-- CreateIndex
CREATE INDEX "InteractionSignal_tenantId_agentRoleId_timestamp_idx" ON "InteractionSignal"("tenantId", "agentRoleId", "timestamp");

-- CreateIndex
CREATE INDEX "InteractionSignal_tenantId_timestamp_idx" ON "InteractionSignal"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "InteractionSignal_agentRoleId_baseVersionUsed_timestamp_idx" ON "InteractionSignal"("agentRoleId", "baseVersionUsed", "timestamp");

-- CreateIndex
CREATE INDEX "InteractionSignal_baseVersionUsed_idx" ON "InteractionSignal"("baseVersionUsed");

-- CreateIndex
CREATE INDEX "InteractionSignal_tenantId_resolutionStatus_idx" ON "InteractionSignal"("tenantId", "resolutionStatus");

-- CreateIndex
CREATE INDEX "InteractionSignal_conversationId_idx" ON "InteractionSignal"("conversationId");

-- CreateIndex
CREATE INDEX "PromptSuggestion_tenantId_status_idx" ON "PromptSuggestion"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PromptSuggestion_tenantId_agentRoleId_status_idx" ON "PromptSuggestion"("tenantId", "agentRoleId", "status");

-- CreateIndex
CREATE INDEX "PromptSuggestion_status_createdAt_idx" ON "PromptSuggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PromptSuggestion_agentRoleId_source_idx" ON "PromptSuggestion"("agentRoleId", "source");

-- CreateIndex
CREATE INDEX "PromptSuggestion_batchId_idx" ON "PromptSuggestion"("batchId");

-- CreateIndex
CREATE INDEX "PromptAuditLog_tenantId_agentRoleId_timestamp_idx" ON "PromptAuditLog"("tenantId", "agentRoleId", "timestamp");

-- CreateIndex
CREATE INDEX "PromptAuditLog_tenantId_timestamp_idx" ON "PromptAuditLog"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "PromptAuditLog_agentRoleId_timestamp_idx" ON "PromptAuditLog"("agentRoleId", "timestamp");

-- CreateIndex
CREATE INDEX "PromptAuditLog_triggeredBy_timestamp_idx" ON "PromptAuditLog"("triggeredBy", "timestamp");

-- CreateIndex
CREATE INDEX "PromptAuditLog_suggestionId_idx" ON "PromptAuditLog"("suggestionId");

-- AddForeignKey
ALTER TABLE "PromptBaseVersion" ADD CONSTRAINT "PromptBaseVersion_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptBaseVersion" ADD CONSTRAINT "PromptBaseVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "PromptBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPromptConfig" ADD CONSTRAINT "TenantPromptConfig_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPromptConfig" ADD CONSTRAINT "TenantPromptConfig_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "PromptBaseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantFewShotExample" ADD CONSTRAINT "TenantFewShotExample_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionSignal" ADD CONSTRAINT "InteractionSignal_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionSignal" ADD CONSTRAINT "InteractionSignal_baseVersionUsed_fkey" FOREIGN KEY ("baseVersionUsed") REFERENCES "PromptBaseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionSignal" ADD CONSTRAINT "InteractionSignal_configVersionUsed_fkey" FOREIGN KEY ("configVersionUsed") REFERENCES "TenantPromptConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptSuggestion" ADD CONSTRAINT "PromptSuggestion_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptAuditLog" ADD CONSTRAINT "PromptAuditLog_agentRoleId_fkey" FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptAuditLog" ADD CONSTRAINT "PromptAuditLog_baseVersionId_fkey" FOREIGN KEY ("baseVersionId") REFERENCES "PromptBaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptAuditLog" ADD CONSTRAINT "PromptAuditLog_tenantConfigId_fkey" FOREIGN KEY ("tenantConfigId") REFERENCES "TenantPromptConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
