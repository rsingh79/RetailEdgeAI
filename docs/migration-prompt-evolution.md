# Migration Strategy: Current Schema → Prompt Evolution System

## Overview

The migration replaces 6 existing models with 6 new models + extensions to 1 existing model.
It must be zero-downtime and backward-compatible at each phase.

```
PHASE 1: Add new tables alongside old ones (no behavioral change)
PHASE 2: Dual-write — new code writes to both old and new tables
PHASE 3: Dual-read — read from new tables, fall back to old
PHASE 4: Cut over — read only from new tables, stop writing to old
PHASE 5: Drop old tables (after validation period)
```

## Model Mapping

| Old Model | New Model | Migration Type |
|---|---|---|
| `AgentType` | `AgentRole` | Rename + enrich (add relations) |
| `PromptTemplate` | `PromptBaseVersion` | Restructure (preamble/postamble → content JSON) |
| `PromptCondition` | (folded into `PromptBaseVersion.content.sections`) | Merge up |
| `TenantPromptOverride` | `TenantPromptConfig` | Replace (raw text → structured JSON fields) |
| `PromptConflict` | `PromptSuggestion` (type=conflict_resolution) | Absorb into broader model |
| `PromptChangeLog` | `PromptAuditLog` | Replace (richer, immutable) |
| (none) | `TenantFewShotExample` | New table |
| (none) | `InteractionSignal` | New table |

## Phase 1: Schema Addition (Migration SQL)

Create all 6 new tables. Do NOT drop old tables.

```sql
-- Migration: add_prompt_evolution_system

-- 1. AgentRole (new table — coexists with AgentType during transition)
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
CREATE UNIQUE INDEX "AgentRole_key_key" ON "AgentRole"("key");

-- 2. PromptBaseVersion
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
    CONSTRAINT "PromptBaseVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromptBaseVersion_agentRoleId_fkey"
        FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id"),
    CONSTRAINT "PromptBaseVersion_parentVersionId_fkey"
        FOREIGN KEY ("parentVersionId") REFERENCES "PromptBaseVersion"("id")
);
CREATE UNIQUE INDEX "PromptBaseVersion_agentRoleId_versionNumber_key"
    ON "PromptBaseVersion"("agentRoleId", "versionNumber");
CREATE INDEX "PromptBaseVersion_agentRoleId_isActive_idx"
    ON "PromptBaseVersion"("agentRoleId", "isActive");
CREATE INDEX "PromptBaseVersion_agentRoleId_idx"
    ON "PromptBaseVersion"("agentRoleId");

-- 3. TenantPromptConfig
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
    CONSTRAINT "TenantPromptConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantPromptConfig_agentRoleId_fkey"
        FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id"),
    CONSTRAINT "TenantPromptConfig_baseVersionId_fkey"
        FOREIGN KEY ("baseVersionId") REFERENCES "PromptBaseVersion"("id")
);
CREATE UNIQUE INDEX "TenantPromptConfig_tenantId_agentRoleId_versionNumber_key"
    ON "TenantPromptConfig"("tenantId", "agentRoleId", "versionNumber");
CREATE INDEX "TenantPromptConfig_tenantId_agentRoleId_isActive_idx"
    ON "TenantPromptConfig"("tenantId", "agentRoleId", "isActive");
CREATE INDEX "TenantPromptConfig_tenantId_agentRoleId_idx"
    ON "TenantPromptConfig"("tenantId", "agentRoleId");
CREATE INDEX "TenantPromptConfig_baseVersionId_idx"
    ON "TenantPromptConfig"("baseVersionId");

-- 4. TenantFewShotExample
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
    CONSTRAINT "TenantFewShotExample_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TenantFewShotExample_agentRoleId_fkey"
        FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id")
);
CREATE INDEX "TenantFewShotExample_tenantId_agentRoleId_isActive_idx"
    ON "TenantFewShotExample"("tenantId", "agentRoleId", "isActive");
CREATE INDEX "TenantFewShotExample_tenantId_agentRoleId_idx"
    ON "TenantFewShotExample"("tenantId", "agentRoleId");
CREATE INDEX "TenantFewShotExample_tenantId_qualityScore_idx"
    ON "TenantFewShotExample"("tenantId", "qualityScore");
CREATE INDEX "TenantFewShotExample_sourceConversationId_idx"
    ON "TenantFewShotExample"("sourceConversationId");

-- 5. InteractionSignal
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
    CONSTRAINT "InteractionSignal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InteractionSignal_agentRoleId_fkey"
        FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id"),
    CONSTRAINT "InteractionSignal_baseVersionUsed_fkey"
        FOREIGN KEY ("baseVersionUsed") REFERENCES "PromptBaseVersion"("id"),
    CONSTRAINT "InteractionSignal_configVersionUsed_fkey"
        FOREIGN KEY ("configVersionUsed") REFERENCES "TenantPromptConfig"("id")
);
CREATE INDEX "InteractionSignal_tenantId_agentRoleId_timestamp_idx"
    ON "InteractionSignal"("tenantId", "agentRoleId", "timestamp");
CREATE INDEX "InteractionSignal_tenantId_timestamp_idx"
    ON "InteractionSignal"("tenantId", "timestamp");
CREATE INDEX "InteractionSignal_agentRoleId_baseVersionUsed_timestamp_idx"
    ON "InteractionSignal"("agentRoleId", "baseVersionUsed", "timestamp");
CREATE INDEX "InteractionSignal_baseVersionUsed_idx"
    ON "InteractionSignal"("baseVersionUsed");
CREATE INDEX "InteractionSignal_tenantId_resolutionStatus_idx"
    ON "InteractionSignal"("tenantId", "resolutionStatus");
CREATE INDEX "InteractionSignal_conversationId_idx"
    ON "InteractionSignal"("conversationId");

-- 6. PromptSuggestion
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
    CONSTRAINT "PromptSuggestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromptSuggestion_agentRoleId_fkey"
        FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id")
);
CREATE INDEX "PromptSuggestion_tenantId_status_idx"
    ON "PromptSuggestion"("tenantId", "status");
CREATE INDEX "PromptSuggestion_tenantId_agentRoleId_status_idx"
    ON "PromptSuggestion"("tenantId", "agentRoleId", "status");
CREATE INDEX "PromptSuggestion_status_createdAt_idx"
    ON "PromptSuggestion"("status", "createdAt");
CREATE INDEX "PromptSuggestion_agentRoleId_source_idx"
    ON "PromptSuggestion"("agentRoleId", "source");
CREATE INDEX "PromptSuggestion_batchId_idx"
    ON "PromptSuggestion"("batchId");

-- 7. PromptAuditLog
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
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "baseVersionId" TEXT,
    "tenantConfigId" TEXT,
    CONSTRAINT "PromptAuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PromptAuditLog_agentRoleId_fkey"
        FOREIGN KEY ("agentRoleId") REFERENCES "AgentRole"("id"),
    CONSTRAINT "PromptAuditLog_baseVersionId_fkey"
        FOREIGN KEY ("baseVersionId") REFERENCES "PromptBaseVersion"("id"),
    CONSTRAINT "PromptAuditLog_tenantConfigId_fkey"
        FOREIGN KEY ("tenantConfigId") REFERENCES "TenantPromptConfig"("id")
);
CREATE INDEX "PromptAuditLog_tenantId_agentRoleId_timestamp_idx"
    ON "PromptAuditLog"("tenantId", "agentRoleId", "timestamp");
CREATE INDEX "PromptAuditLog_tenantId_timestamp_idx"
    ON "PromptAuditLog"("tenantId", "timestamp");
CREATE INDEX "PromptAuditLog_agentRoleId_timestamp_idx"
    ON "PromptAuditLog"("agentRoleId", "timestamp");
CREATE INDEX "PromptAuditLog_triggeredBy_timestamp_idx"
    ON "PromptAuditLog"("triggeredBy", "timestamp");
CREATE INDEX "PromptAuditLog_suggestionId_idx"
    ON "PromptAuditLog"("suggestionId");

-- 8. Add fields to existing Conversation model
ALTER TABLE "Conversation" ADD COLUMN "resolutionStatus" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "topicTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Conversation" ADD COLUMN "agentRoleKey" TEXT;
```

## Phase 2: Data Migration Script

Runs once to populate new tables from old data.

```
1. AgentType → AgentRole
   - Copy all rows: id, key, name, description, model, maxTokens, isActive
   - Add new agents not in old table: "business_advisor"

2. PromptTemplate + PromptCondition → PromptBaseVersion
   - For each PromptTemplate:
     - Query its PromptCondition[] ordered by orderIndex
     - Build content JSON:
       {
         systemPrompt: template.preamble + "\n\nRules:\n" + conditions.map(c => "- " + c.text) + template.postamble,
         sections: conditions.map(c => ({
           key: c.key,
           title: c.key,
           content: c.text,
           isRequired: c.isRequired,
           validationKey: c.validationKey
         }))
       }
     - Insert PromptBaseVersion with:
       agentRoleId = (lookup AgentRole by template.agentType.key)
       versionNumber = template.version
       isActive = template.isActive
       changeReason = "Migrated from PromptTemplate v" + template.version
       parentVersionId = (previous version's id if version > 1)

3. TenantPromptOverride → TenantPromptConfig
   - Group overrides by (tenantId, agentTypeKey)
   - For each group, build a TenantPromptConfig:
     - customInstructions: overrides with action="add" → instruction entries
     - For action="remove": note in customInstructions with a "disabled" flag
     - For action="replace": note in customInstructions with original + replacement
     - baseVersionId = active PromptBaseVersion for this agent
     - All other structured fields = null (no previous data)

4. PromptConflict → PromptSuggestion
   - For each unresolved PromptConflict:
     - Create PromptSuggestion with:
       suggestionType = "conflict_resolution"
       status = "pending" (or "applied" if already resolved)
       source = "conflict_detection"
       evidence = { conflictReason: conflict.detectedReason }
   - For resolved conflicts: status = "applied", appliedAt = conflict.resolvedAt

5. PromptChangeLog → PromptAuditLog
   - Map changeType → actionType:
     "add_override" → "tenant_config_updated"
     "remove_override" → "tenant_config_updated"
     "replace_condition" → "tenant_config_updated"
     "resolve_conflict" → "conflict_resolved"
     "revert" → "tenant_config_rolled_back"
   - beforeState/afterState = { text: previousText/newText }
   - triggeredBy = "admin"
   - reason = existing reason field
```

## Phase 3: Code Migration

### promptComposer.js
Update `getEffectivePrompt()` to read from new tables:

```
OLD: PromptTemplate → PromptCondition → TenantPromptOverride
NEW: PromptBaseVersion → TenantPromptConfig → TenantFewShotExample

Dual-read period:
  try new tables first
  if AgentRole not found → fall back to old AgentType path
  log which path was used for monitoring
```

### promptChatAgent.js
Update to modify TenantPromptConfig structured fields instead of raw text overrides.

### promptValidators.js
Validators now check TenantPromptConfig.enabledCapabilities flags
instead of individual PromptCondition removal.

### promptConflictDetector.js
Evolves into part of the suggestion engine. Conflict detection becomes
one input to PromptSuggestion generation.

### Admin + tenant prompt routes
Update to CRUD against new models. Old routes return 301 redirects
during transition.

## Phase 4: Cut Over

1. Verify all reads go through new tables (monitor fallback logs)
2. Stop writing to old tables
3. Mark old models as @deprecated in schema comments

## Phase 5: Cleanup

1. Drop old tables in a new migration:
   - AgentType
   - PromptTemplate
   - PromptCondition
   - TenantPromptOverride
   - PromptConflict
   - PromptChangeLog
2. Remove fallback code paths from promptComposer.js
3. Remove old route handlers

## Risk Mitigation

- **Data loss**: Phase 2 migration script is idempotent (upsert, not insert)
- **Downtime**: All phases are additive — no table drops until Phase 5
- **Rollback**: If issues found in Phase 3-4, revert code to read old tables
  (old tables still have data, no writes were stopped yet)
- **Validation**: Phase 2 script includes a verification step that compares
  `getEffectivePrompt()` output from old vs new paths for every tenant+agent
  combination. Any mismatch blocks the migration.
