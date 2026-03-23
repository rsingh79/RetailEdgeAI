# Prompt Evolution System — Complete Architecture

## 1. End-to-End Flow

### A single user message traced through the entire system:

```
USER sends message "What's my top supplier by spend?"
  │
  ▼
[chat.js] POST /conversations/:id/messages
  │  Validates content, saves user message, loads context (last 20 messages)
  │
  ▼
[orchestrator.js] runAdvisorStreaming()
  │  ┌─────────────────────────────────────────────────┐
  │  │ STEP 1: assemblePrompt()                        │
  │  │   → Load base prompt v1 (AgentRole: business_advisor) │
  │  │   → Load tenant config (if exists)              │
  │  │   → Merge: tone + custom instructions + terms   │
  │  │   → Select few-shot examples (top 3 by quality) │
  │  │   → Inject runtime context (date, tools)        │
  │  │   → Return: { prompt, model, maxTokens, metadata } │
  │  │   → metadata: { baseVersionId, tenantConfigId,  │
  │  │     exampleIdsUsed, totalTokenEstimate }         │
  │  └─────────────────────────────────────────────────┘
  │
  ▼
[apiUsageTracker.js] trackedClaudeCall()
  │  Sends assembled prompt + conversation to Claude API
  │  Logs: tokens, cost, duration, endpoint to ApiUsageLog
  │
  ▼
[orchestrator.js] Tool use loop (up to 5 rounds)
  │  Executes tools (get_supplier_spend_analysis, etc.)
  │  Streams response to client via SSE
  │  Returns: { content, toolCalls, toolResults, costUsd, durationMs, promptMeta }
  │
  ▼
[chat.js] Signal Capture (fire-and-forget, non-blocking)
  │  ┌─────────────────────────────────────────────────┐
  │  │ recordPromptMeta() — which prompt version used  │
  │  │ recordCorrectionCount() — consecutive user msgs  │
  │  │ recordUsage() — tokens, latency, cost           │
  │  │ recordOutcome() — resolved/failed               │
  │  │ emitSignal() — moves to flush buffer            │
  │  └─────────────────────────────────────────────────┘
  │
  ▼
[chat.js] Save assistant message + update conversation stats (fire-and-forget)
  │
  ▼
[signalCollector.js] Background flush (every 5s)
  │  Resolves agentRoleId, writes InteractionSignal to DB
  │
  ▼
[User gives thumbs up/down on message]
  │  PATCH /messages/:id/feedback → recordSatisfaction() → emitSignal()
  │
  ═══ DAILY: Suggestion Engine runs ═══
  │
  ▼
[suggestionEngine.js] runSuggestionEngine()
  │  1. Aggregate signals: group by topic, compute resolution/override/satisfaction rates
  │  2. Identify failure patterns: high override rate, low satisfaction, topic-specific issues
  │  3. Cluster human overrides: wrong_product_match, no_match_found, price_override
  │  4. LLM call (Claude Haiku): generate structured improvement proposals
  │  5. Store in PromptSuggestion table (status: pending)
  │  6. Auto-curate few-shot examples from successful interactions
  │
  ▼
[Tenant admin reviews suggestions in Settings > AI Agents]
  │  POST /suggestions/:id/review → approved/rejected
  │  If approved: config update applied to TenantPromptConfig
  │  Cache invalidated: invalidateTenantCache(agentRoleKey, tenantId)
  │
  ▼
[Next user message uses IMPROVED prompt]
  │  assemblePrompt() loads updated TenantPromptConfig
  │  New custom instructions, terminology, tone settings merged
  │  Improved few-shot examples selected
  │
  ═══ WEEKLY: Meta-Optimizer runs ═══
  │
  ▼
[metaOptimizer.js] runMetaOptimizer()
  │  1. Cross-tenant comparison: defaults vs customized tenants
  │  2. Identify outperformers: 15%+ improvement in resolution/override/satisfaction
  │  3. Generate default upgrade proposals via LLM
  │  4. Create candidate PromptBaseVersion (isActive: false)
  │  5. Generate cross-tenant recommendations for default tenants
  │
  ▼
[Platform admin reviews candidate in Admin > Meta-Optimizer]
  │  POST /admin/meta-optimizer/candidates/:id/activate → canary rollout
  │  New tenants + pure-default tenants get improved prompt
  │  Existing tenant configs continue referencing their pinned baseVersionId
```

---

## 2. Integration Points

### Every modified file (existing code):

| File | What Was Modified | Lines Added |
|------|-------------------|-------------|
| `server/src/app.js` | 4 route mounts + 2 service startups | ~15 |
| `server/src/routes/chat.js` | Signal imports + 7 signal calls + feedback signal | ~50 |
| `server/src/routes/invoices.js` | Signal imports + OCR/match/override/satisfaction/escalation signals | ~100 |
| `server/src/services/ocr.js` | `assemblePrompt()` call + `_promptMeta` attachment | ~15 |
| `server/src/services/matching.js` | `assemblePrompt()` call + prompt splitting | ~20 |
| `server/src/services/agents/orchestrator.js` | `assemblePrompt()` call + `promptMeta` return | ~25 |
| `server/prisma/schema.prisma` | 7 new models + 3 fields on Conversation | ~200 |
| `client/src/components/layout/AppLayout.jsx` | Removed PromptChatWidget | -2 |
| `client/src/pages/Settings.jsx` | Added AI Agents tab | ~5 |

### Every new file:

| File | Lines | Purpose |
|------|-------|---------|
| `server/src/services/promptAssemblyEngine.js` | 623 | 6-step prompt assembly with caching |
| `server/src/services/signalCollector.js` | 310 | Async signal buffer + flush |
| `server/src/services/suggestionEngine.js` | 631 | Per-tenant improvement analysis |
| `server/src/services/metaOptimizer.js` | 760 | Cross-tenant learning |
| `server/src/services/conversationCleanup.js` | 118 | Abandoned conversation detection |
| `server/src/routes/suggestions.js` | 147 | Tenant suggestion API |
| `server/src/routes/admin/metaOptimizer.js` | 146 | Admin optimization API |
| `server/prisma/seed-prompt-evolution.js` | 180 | Seed AgentRoles + base versions |
| `client/src/components/settings/AIAgentsTab.jsx` | 300+ | AI agent config UI |
| `server/tests/signal-collector.test.js` | 250 | Signal capture tests |
| `server/tests/suggestion-engine.test.js` | 320 | Suggestion engine tests |
| `server/tests/meta-optimizer.test.js` | 340 | Meta-optimizer tests |

### Breaking changes: **NONE**

All changes are additive:
- Old prompt loading (hardcoded) still works as fallback
- Old `getEffectivePrompt()` API preserved as backward-compat wrapper
- Old `PromptTemplate` / `PromptCondition` tables coexist with new `PromptBaseVersion` / `TenantPromptConfig`
- Conversation model's new fields (`resolutionStatus`, `topicTags`, `agentRoleKey`) are nullable

---

## 3. Test Scenarios

### Tests to write (integration-level):

**Scenario 1: New tenant onboarding (cold start)**
```
Given: A new tenant with no TenantPromptConfig, no TenantFewShotExample
When:  assemblePrompt('business_advisor', newTenantId)
Then:  Returns the active PromptBaseVersion's systemPrompt verbatim
       metadata.tenantConfigId = null
       metadata.exampleIdsUsed = []
       Prompt is identical to the hardcoded fallback
```

**Scenario 2: Tenant with custom config**
```
Given: Tenant has TenantPromptConfig with:
         customInstructions: ["Always mention GST is 10% in Australia"]
         domainTerminology: {"RRP": "Recommended Retail Price"}
         toneSettings: { formality: "casual" }
When:  assemblePrompt('business_advisor', tenantId)
Then:  Prompt contains base prompt + "Always mention GST..." + glossary + tone modifier
       metadata.tenantConfigId = config.id
```

**Scenario 3: Config rollback**
```
Given: Tenant had config v2, admin reverts to v1
When:  assemblePrompt() called after rollback
Then:  Returns prompt with v1 config (or pure default if v1 was empty)
       PromptAuditLog has entry with actionType='ROLLBACK'
```

**Scenario 4: Suggestion from failure patterns**
```
Given: 20 InteractionSignals for tenant, 8 with humanOverride=true on "supplier:FreshFarms"
When:  runSuggestionEngine({ tenantId, agentRoleKey: 'product_matching' })
Then:  Returns suggestions including ADD_INSTRUCTION type
       Evidence references FreshFarms topic
       Stored in PromptSuggestion with status='pending'
```

**Scenario 5: Suggestion approval flow**
```
Given: PromptSuggestion with status='pending', type='ADD_INSTRUCTION'
When:  POST /suggestions/:id/review { action: 'approved' }
Then:  Suggestion status → 'approved', appliedAt set
       TenantPromptConfig updated with new instruction
       Cache invalidated for this tenant+agent
       Next assemblePrompt() includes the new instruction
```

**Scenario 6: Default upgrade with existing tenants**
```
Given: Base version v1 active, Tenant A has config pinned to v1
When:  activateCandidateVersion(v2Id, adminId, { canaryMode: true })
Then:  v2 becomes isActive=true, v1 becomes isActive=false
       Tenant A's config still references v1 (baseVersionId unchanged)
       New tenant B with no config gets v2 from assemblePrompt()
       PromptAuditLog has CANARY_ACTIVATION entry
```

**Scenario 7: Cache invalidation**
```
Given: assemblePrompt() cached result for tenant+agent
When:  Tenant config changes (addOverride, updateConfig)
Then:  invalidateTenantCache() called
       Next assemblePrompt() rebuilds from DB (not cache)
       New prompt reflects the change
```

---

## 4. Migration Plan

### Phase 1: Database + Seed (DONE)
- [x] 7 new models added to schema.prisma
- [x] Migration applied: `add_prompt_evolution_system`
- [x] Seed script: 4 AgentRoles + 3 PromptBaseVersions (OCR, Matching, Advisor)
- [x] Existing old prompt tables (AgentType, PromptTemplate, PromptCondition) preserved

### Phase 2: Assembly Engine (DONE)
- [x] promptAssemblyEngine.js created with 6-step pipeline
- [x] All 3 agents (OCR, Matching, Advisor) wired through assemblePrompt()
- [x] Hardcoded fallback preserved in every agent service
- [x] Backward-compat getEffectivePrompt() wrapper available

### Phase 3: Signal Capture (DONE)
- [x] signalCollector.js with async buffer
- [x] chat.js instrumented (6 signal types)
- [x] invoices.js instrumented (OCR, matching, override, satisfaction, escalation)
- [x] conversationCleanup.js for abandoned conversation detection
- [x] 15 tests passing

### Phase 4: Suggestion Engine (DONE)
- [x] suggestionEngine.js with 5-step pipeline
- [x] Few-shot auto-curation
- [x] Tenant API routes (/api/suggestions)
- [x] 16 tests passing

### Phase 5: Meta-Optimizer (DONE)
- [x] metaOptimizer.js with cross-tenant analysis
- [x] Candidate version creation + approval workflow
- [x] Canary rollout + rollback
- [x] Admin API routes (/api/admin/meta-optimizer)
- [x] 11 tests passing

### Phase 6: UI (PARTIALLY DONE)
- [x] Settings > AI Agents tab for per-agent config
- [ ] Suggestion review queue in Settings
- [ ] Admin meta-optimizer dashboard
- [ ] Prompt version comparison/diff view

### Phase 7: Cleanup (FUTURE)
- [ ] Remove old prompt tables (AgentType, PromptTemplate, PromptCondition, TenantPromptOverride, PromptConflict, PromptChangeLog)
- [ ] Remove old promptComposer.js, promptConflictDetector.js, promptValidators.js, promptChatAgent.js
- [ ] Remove old prompt routes (/api/prompts old endpoints)
- [ ] Remove PromptChatWidget component (already hidden, can delete file)

### Transition Period Handling
During migration, the system supports dual operation:
- **Old path**: `getEffectivePrompt()` → reads from PromptTemplate + PromptCondition + TenantPromptOverride
- **New path**: `assemblePrompt()` → reads from PromptBaseVersion + TenantPromptConfig
- Both paths produce valid prompts. The new path is the default for all 3 agents.
- If the new path fails (DB not seeded, assembly error), every agent falls back to its hardcoded prompt constant.

---

## 5. Monitoring

### Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| Assembly success rate | Count `assemblePrompt()` successes vs fallbacks | < 95% = alert |
| Signal flush success rate | signalCollector flush failures/total | Any flush failure = warn |
| Signal buffer size | `_getBufferSize()` | > 100 = warn, > 180 = alert |
| Suggestion engine failures | `runSuggestionEngine()` errors | Any failure = log |
| Avg satisfaction trend | InteractionSignal.userSatisfactionScore over time | 2-week declining trend = alert |
| Override rate trend | InteractionSignal.humanOverride rate per agent | Sustained > 40% = investigate |
| Prompt assembly latency | assemblePrompt() duration | p99 > 500ms = investigate |
| Cache hit rate | Assembly cache hits vs misses | < 80% = investigate cache TTL |
| Config change impact | Satisfaction delta before/after config change | > 20% degradation = rollback alert |

### Dashboard Requirements (Platform Admin)

**Page 1: Prompt Health**
- Per-agent: current base version, active tenant config count, assembly success rate
- Signal volume: signals/day by agent role
- Satisfaction trend: 7-day rolling average per agent

**Page 2: Suggestion Pipeline**
- Pending suggestions by tenant + agent (actionable queue)
- Suggestion approval/rejection rates
- Time from suggestion → approval → impact

**Page 3: Cross-Tenant Intelligence**
- Tenant performance comparison matrix (resolution rate, override rate, satisfaction)
- Outperformer identification (which configs are winning)
- Candidate version status (pending, canary, full rollout, rolled back)

**Page 4: Audit Trail**
- Global prompt audit log (filtered by agent, action type, date)
- Version lineage graph (v1 → v2 → v3 with parent/child)
- Config change timeline per tenant

### Alerting Implementation

```javascript
// Add to signalCollector.js flushBuffer():
if (failures.length > batch.length * 0.1) {
  console.error(`ALERT: Signal flush failure rate ${failures.length}/${batch.length}`);
  // Future: webhook/email notification
}

// Add to promptAssemblyEngine.js assemblePrompt():
if (!result) {
  console.warn(`ALERT: Assembly fallback for ${agentRoleKey}:${tenantId}`);
  // Future: increment counter, alert on sustained fallbacks
}

// Add to conversationCleanup.js:
if (abandonedCount > threshold) {
  console.warn(`ALERT: ${abandonedCount} conversations abandoned in last 30 min`);
}
```

---

## File Count Summary

| Category | Files | Total Lines |
|----------|-------|-------------|
| New services | 5 | ~2,442 |
| New routes | 2 | ~293 |
| New UI components | 1 | ~300 |
| New tests | 3 | ~910 |
| Seed script | 1 | ~180 |
| Modified files | 9 | ~230 lines added |
| Documentation | 1 | this file |
| **Total** | **22 files** | **~4,355 lines** |

### Test Coverage

| Suite | Tests | What's Covered |
|-------|-------|----------------|
| signal-collector.test.js | 15 | All 6 signal types, partial accumulation, buffer limits, full conversation sim |
| suggestion-engine.test.js | 16 | Aggregation, failure patterns, override clustering, batch IDs, full pipeline |
| meta-optimizer.test.js | 11 | Cross-tenant stats, outperformer detection, recommendations, multi-tenant sim |
| **Total** | **42** | All deterministic logic (LLM calls excluded) |
