# RetailEdgeAI — Master Implementation Plan v2
## Self-Evolving Multi-Agent Architecture: Claude Code Execution Guide

---

## How to Use This Document

This is a phased implementation plan for Claude Code. Each phase describes:
- **What to build** — by module name, feature description, and file name (not path)
- **How to test it** — tests to write alongside the codea
- **Cold-start data strategy** — how to bootstrap testing with minimal data
- **Acceptance criteria** — how to know the phase is complete

**Claude Code:** Search the codebase for referenced file names and modules. Do NOT rely on hardcoded paths — locate files by name and context within the repo.

**Rule: No code ships without its test.** Every new function gets a unit test. Every integration point gets an integration test.

**Rule: Tests bootstrap from production data.** We have almost no test data. Every test suite includes a "data capture" mechanism that harvests real interactions (PII-masked) to grow the test dataset automatically over time.

**Rule: Agent-agnostic architecture.** Every system built in this plan MUST work for any number of agents. When a new agent is added to the platform, it should plug into the evolution architecture by following a standard registration pattern — NOT by modifying the evolution infrastructure code.

---

## Core Design: The Agent Registration Contract

Every agent in RetailEdgeAI — existing and future — MUST implement a standard contract to participate in the evolution architecture. This contract is the single most important architectural pattern in this document.

### The Agent Evolution Contract

When a new agent is added to the platform, the developer MUST:

**1. Register the AgentRole in the database**
Add a record to the `AgentRole` table via the seed file (`seed-prompt-evolution.js`) with:
- `key`: unique identifier (e.g., `pricing_optimizer`, `competitor_monitor`)
- `name`: human-readable name
- `description`: what the agent does
- `model`: which LLM model to use
- `maxTokens`: token limit
- `isActive`: true

**2. Create a PromptBaseVersion for the agent**
Seed an initial base prompt version. This becomes version 1 — the default all tenants start with.

**3. Use the Prompt Assembly Engine**
The agent MUST call the assembly engine to get its prompt — never hardcode prompts. Pattern:
```javascript
const assemblyResult = await assemblePrompt({
  agentRoleKey: 'my_new_agent',
  tenantId,
  runtimeContext: { /* agent-specific context */ }
});
const systemPrompt = assemblyResult.prompt || FALLBACK_PROMPT;
```

**4. Emit signals via the Signal Collector**
After every interaction, the agent MUST emit:
- `recordPromptMeta()` — which prompt version was used
- `recordOutcome()` — success/failure status
- Performance data — tokens, latency, cost

**5. Capture corrections for the Golden Dataset**
At every point where a human can correct the agent's output, the agent MUST call the Golden Dataset Builder to capture the before/after as labeled test data.

**6. Store learnings in Mem0** (Phase 3+)
After human corrections, store the learning as a memory so the agent improves for this tenant.

**7. Define quality criteria for Few-Shot Auto-Curation**
Register a quality criteria function that defines what a "high-quality interaction" looks like for this agent type. This is used by the auto-curation pipeline.

**8. Define evaluation scoring for Regression Tests**
Register a scoring function that defines how to compare agent output to ground truth for this agent type. This is used by the evaluation engine.

### Agent Registration Module

**Create new module:** `agentRegistry.js` (in the services layer)

This module centralizes the agent registration contract:

```javascript
// agentRegistry.js — Central registry for all agents in the evolution system
//
// Every agent registers itself here with:
//   - key: unique agent role key (matches AgentRole.key in DB)
//   - correctionPoints: array of { eventName, captureFunction }
//   - qualityCriteria: function(signal) => boolean (is this interaction high-quality?)
//   - evaluationScorer: function(agentOutput, groundTruth) => score (0-1)
//   - memoryFormatter: function(correction) => string (how to format memory from correction)
//   - signalEmitter: function(interactionResult) => signals (what signals to emit)
//
// The evolution infrastructure (suggestion engine, meta-optimizer, few-shot curator,
// evaluation engine, golden dataset builder) queries this registry to handle
// ANY agent generically — no agent-specific code in the infrastructure.

const registry = new Map();

function registerAgent(config) {
  validateConfig(config);  // Throws if contract not met
  registry.set(config.key, config);
}

function getAgent(key) {
  return registry.get(key);
}

function getAllAgents() {
  return Array.from(registry.values());
}

function getAgentKeys() {
  return Array.from(registry.keys());
}
```

**Each existing agent registers itself** at module initialization:

```javascript
// In the OCR service module:
agentRegistry.registerAgent({
  key: 'ocr_extraction',
  correctionPoints: [
    { event: 'invoice_line_edited', capture: captureOcrCorrection }
  ],
  qualityCriteria: (signal) => 
    signal.resolutionStatus === 'resolved' && 
    signal.humanOverride === false && 
    signal.latencyMs < 10000,
  evaluationScorer: (output, truth) => calculateFieldF1(output, truth),
  memoryFormatter: (correction) => 
    `For invoices from "${correction.supplierName}", ${correction.field} is typically "${correction.correctedValue}"`,
  signalEmitter: (result) => ({
    resolutionStatus: result.success ? 'resolved' : 'failed',
    topicTags: ['ocr', result.documentType]
  })
});
```

**When a NEW agent is added**, the developer creates the agent service and adds the registration call. The entire evolution infrastructure (signals, golden dataset, suggestions, meta-optimizer, few-shot curation, evaluation, Mem0) automatically picks it up. No changes to infrastructure code.

---

## Architecture Overview After All Phases

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AGENT LAYER (N agents, extensible)             │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │  OCR    │ │ Product  │ │ Product  │ │ Business │ │ Future  │  │
│  │  Agent  │ │ Matching │ │ Import   │ │ Advisor  │ │ Agent N │  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘  │
│       │           │            │             │            │       │
│       └───────────┴────────────┴─────────────┴────────────┘       │
│                    All implement Agent Contract                    │
│                    All registered in agentRegistry                 │
│                               │                                    │
│  ┌────────────────────────────▼────────────────────────────────┐   │
│  │         PROMPT ASSEMBLY ENGINE (generic, per request)       │   │
│  │  base + tenant_config + few_shot + mem0_memories + runtime  │   │
│  └────┬────────────────────────────────────────────────────────┘   │
│       │                                                            │
│  ┌────▼────────────────────────────────────────────────────────┐   │
│  │         SIGNAL CAPTURE (generic, async, non-blocking)       │   │
│  └────┬────────────────────────────────────────────────────────┘   │
│       │                                                            │
│  ┌────▼────────────────────────────────────────────────────────┐   │
│  │         MEM0 MEMORY LAYER (per tenant, per agent)           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 EVOLUTION ENGINE (agent-agnostic)                   │
│                                                                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐ │
│  │  Suggestion   │ │  Meta         │ │  Few-Shot Auto-Curation   │ │
│  │  Engine       │ │  Optimizer    │ │  Pipeline                 │ │
│  │  (daily/auto) │ │  (weekly/auto)│ │  (daily/auto)             │ │
│  └───────────────┘ └───────────────┘ └───────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  GOLDEN DATASET BUILDER                                       │ │
│  │  Iterates agentRegistry.getAllAgents() — no agent-specific    │ │
│  │  code. Uses each agent's correctionPoints and captureFunction │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  EVALUATION & REGRESSION ENGINE                               │ │
│  │  Iterates agentRegistry.getAllAgents() — uses each agent's    │ │
│  │  evaluationScorer function to grade output against truth      │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  EVOLUTION SCHEDULER                                          │ │
│  │  Iterates agentRegistry.getAgentKeys() — runs suggestion     │ │
│  │  engine, few-shot curation, evaluation for ALL registered     │ │
│  │  agents automatically. New agent = automatic scheduling.      │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Key principle:** The entire bottom half (Evolution Engine) iterates over the Agent Registry. It contains ZERO agent-specific code. Adding a new agent means registering it in the registry — the evolution engine automatically handles it.

---

# PHASE 0: Testing Infrastructure & Golden Dataset Builder
**Timeline: Week 1 | Priority: P0 | Depends on: Nothing**

## 0.1 — Create Test Directory Structure

Create the following structure under the test directory:

```
tests/
├── unit/
│   └── services/           # Unit tests per service module
├── integration/             # Cross-module tests requiring DB
├── regression/              # Golden dataset tests per agent
│   ├── ocr_extraction/
│   │   └── golden-dataset.json       (starts empty: [])
│   ├── product_matching/
│   │   └── golden-dataset.json       (starts empty: [])
│   ├── product_import/
│   │   └── golden-dataset.json       (starts empty: [])
│   └── business_advisor/
│       └── golden-dataset.json       (starts empty: [])
├── evaluation/
│   └── judges/              # LLM-as-judge evaluators
├── helpers/
│   ├── testDataFactory.js   # Generates synthetic test data
│   └── piiMasker.js         # Masks PII in captured data
└── fixtures/                # Shared static test data
```

**Note for future agents:** When a new agent is registered, Claude Code should automatically create a matching `regression/{agent_key}/golden-dataset.json` directory. The evaluation engine dynamically discovers these based on `agentRegistry.getAgentKeys()`.

## 0.2 — Build the Agent Registry Module

**Create new service:** `agentRegistry.js`

This is the central contract that all agents must implement. See the "Agent Registration Contract" section above for the full specification.

**Functions to implement:**
- `registerAgent(config)` — validates contract compliance, stores in registry
- `getAgent(key)` — returns single agent config
- `getAllAgents()` — returns all registered agent configs
- `getAgentKeys()` — returns all registered keys
- `validateConfig(config)` — throws if any required field is missing from the contract
- `getCorrectionPoints(key)` — returns correction capture configs for an agent
- `getQualityCriteria(key)` — returns the quality criteria function
- `getEvaluationScorer(key)` — returns the scoring function for regression tests

**Validation rules:**
- `key` must be a non-empty string matching an existing `AgentRole.key`
- `correctionPoints` must be an array (can be empty for agents with no user corrections)
- `qualityCriteria` must be a function that accepts a signal and returns boolean
- `evaluationScorer` must be a function that accepts (agentOutput, groundTruth) and returns a number 0-1
- `memoryFormatter` must be a function that accepts a correction and returns a string
- `signalEmitter` must be a function that accepts an interaction result and returns signal fields

## 0.3 — Build the Golden Dataset Builder Service

**Create new service:** `goldenDatasetBuilder.js`

**Purpose:** Automatically captures human corrections as labeled test data. This is agent-agnostic — it queries the agent registry for correction points and capture functions.

**Core logic:**

```
WHEN a correction event fires:
  1. Look up the agent in agentRegistry
  2. Call the agent's capture function to get before/after data
  3. Mask PII using piiMasker
  4. Store as a GoldenDatasetEntry record:
     - agentRoleKey (from registry)
     - correctionType (from the correction event)
     - input (the original request/document, masked)
     - agentOutput (what the AI produced)
     - humanCorrected (what the human fixed it to)
     - metadata (tenant tier, timestamp, context — anonymized)
  5. Deduplicate (skip if identical input+correction already exists)
```

**Export function:**
```
exportGoldenDataset(agentRoleKey):
  1. Query all active GoldenDatasetEntry records for this agent
  2. Write to the regression test fixture file for this agent
  3. This runs on a weekly schedule (via evolution scheduler)
  4. Regression tests automatically pick up new entries
```

**Database model to add to the Prisma schema:**

```
GoldenDatasetEntry
  - id: UUID
  - agentRoleKey: String (indexed)
  - correctionType: String (e.g., field_edit, match_override, import_fix, rating_low)
  - input: Json (the original request, PII-masked)
  - agentOutput: Json (what the AI produced)
  - humanCorrected: Json (what the human fixed it to)
  - metadata: Json (anonymized tenant context)
  - isActive: Boolean (default true)
  - createdAt: DateTime
```

## 0.4 — Build PII Masker

**Create new helper:** `piiMasker.js` (in test helpers)

**Functions:**
- `maskTenantData(data, tenantMapping)` — replaces tenant-identifying info
- `maskPersonalData(data)` — replaces emails, phones, ABNs
- `createConsistentMapping(tenantIds)` — creates Tenant_A/B/C mapping (same tenant always gets same alias)
- `maskJsonDeep(obj, rules)` — recursive masking for nested JSON

**Masking rules:**
- Tenant names → "Tenant_A", "Tenant_B" (consistent within dataset)
- ABNs → randomized valid format
- Email addresses → "user@example.com"
- Phone numbers → "0400000000"
- Product names → KEEP (not PII, needed for testing)
- Prices → KEEP (not PII, needed for testing)
- Supplier names → KEEP or anonymize based on sensitivity

## 0.5 — Build Test Data Factory

**Create new helper:** `testDataFactory.js` (in test helpers)

**Functions:**
- `createMockTenant(overrides)` — returns a tenant object
- `createMockInvoice(tenantId, overrides)` — returns invoice with lines
- `createMockProducts(tenantId, count)` — returns product catalog
- `createMockConversation(tenantId, messageCount)` — returns conversation with messages
- `createMockInteractionSignal(tenantId, agentRoleKey, overrides)` — returns signal
- `createMockPromptConfig(tenantId, agentRoleKey, overrides)` — returns tenant config
- `createMockAssemblyResult(agentRoleKey, tenantId)` — returns assembled prompt with metadata
- `createMockGoldenEntry(agentRoleKey, correctionType, overrides)` — returns golden dataset entry

These generate realistic but fake data for unit testing logic. They are NOT the golden dataset.

## 0.6 — Register Existing Agents

**Modify each existing agent service module** to register with the agent registry at module initialization. Find the service files for each agent (OCR, Product Matching, Business Advisor, Prompt Management) and add the registration call.

For **Product Import**: also create the `AgentRole` database record (add to the seed file `seed-prompt-evolution.js`) and the initial `PromptBaseVersion` using the current hardcoded prompt as content.

**Registration configs for existing agents:**

**OCR Extraction:**
- key: `ocr_extraction`
- correctionPoints: `[{ event: 'invoice_line_edited', fields: ['description', 'quantity', 'unitPrice', 'gstAmount', 'total'] }]`
- qualityCriteria: resolved AND no human overrides AND latency < 10s
- evaluationScorer: field-level F1 (precision * recall of extracted fields vs ground truth)
- memoryFormatter: `"For invoices from [supplier], [field] is typically [correctedValue]"`

**Product Matching:**
- key: `product_matching`
- correctionPoints: `[{ event: 'match_overridden' }, { event: 'match_confirmed' }, { event: 'manual_match_created' }]`
- qualityCriteria: all lines matched AND zero manual overrides AND confidence > 0.8
- evaluationScorer: match accuracy (% correct product selections)
- memoryFormatter: `"[invoiceDescription] should match to [productName] (SKU: [sku])"`

**Product Import:**
- key: `product_import`
- correctionPoints: `[{ event: 'field_mapping_corrected' }, { event: 'import_row_edited' }]`
- qualityCriteria: first-pass success AND no mapping corrections
- evaluationScorer: mapping accuracy (% correct field mappings)
- memoryFormatter: `"For files from [supplier], column [col] maps to [field]"`

**Business Advisor:**
- key: `business_advisor`
- correctionPoints: `[{ event: 'feedback_rating_low', threshold: 2 }]`
- qualityCriteria: feedbackRating >= 4 AND resolved AND no corrections
- evaluationScorer: LLM-as-Judge (relevance, groundedness, actionability, specificity → average)
- memoryFormatter: `"User asked about [topic]. Key insight: [summary]. Outcome: [resolution]"`

**Prompt Management:**
- key: `prompt_management`
- correctionPoints: [] (no user corrections — this agent helps configure other agents)
- qualityCriteria: user confirmed the suggested change
- evaluationScorer: confirmation rate (% of suggestions accepted)
- memoryFormatter: null (no memory storage for this agent)

## 0.7 — Tests for Phase 0

```
Unit tests for agentRegistry:
  ✓ registerAgent stores agent config
  ✓ registerAgent validates required fields (throws on missing key, scorer, etc.)
  ✓ getAgent returns correct config by key
  ✓ getAllAgents returns all registered agents
  ✓ getAgentKeys returns all keys
  ✓ duplicate registration throws error
  ✓ getCorrectionPoints returns agent's correction config
  ✓ getQualityCriteria returns callable function
  ✓ getEvaluationScorer returns callable function

Unit tests for goldenDatasetBuilder:
  ✓ captures correction as golden entry with correct fields
  ✓ masks PII in captured entries
  ✓ maintains consistent tenant anonymization
  ✓ exports entries to JSON format for regression tests
  ✓ skips duplicate entries (same input+correction already exists)
  ✓ works for ANY registered agent (not agent-specific code)
  ✓ queries agentRegistry for correction capture config

Unit tests for piiMasker:
  ✓ masks email addresses
  ✓ masks ABNs
  ✓ masks phone numbers
  ✓ preserves product names and prices
  ✓ handles nested JSON
  ✓ maintains consistent tenant mapping across calls

Unit tests for testDataFactory:
  ✓ creates valid mock objects for each function
  ✓ overrides work correctly
  ✓ generated data passes schema validation
```

## 0.8 — Acceptance Criteria for Phase 0

- [ ] Agent Registry module created with all functions
- [ ] All 5 existing agents registered in the registry
- [ ] Golden Dataset Builder service created (agent-agnostic)
- [ ] PII Masker working with unit tests
- [ ] Test Data Factory generating realistic mock data
- [ ] Prisma migration for GoldenDatasetEntry model applied
- [ ] Product Import AgentRole seeded in database
- [ ] Test directory structure exists with empty golden-dataset.json files
- [ ] `npm test` command configured and all Phase 0 tests passing

---

# PHASE 1: Signal Collection Across All Agents
**Timeline: Week 2-3 | Priority: P0 | Depends on: Phase 0**

## 1.1 — Design Principle: Generic Signal Emission

The signal collector (`signalCollector.js`) already exists and works for the Business Advisor. The work here is:
1. Make signal emission generic (driven by agent registry, not hardcoded per agent)
2. Wire signal emission into every agent
3. Wire golden dataset capture at every correction point

**Create a helper function** in or alongside the signal collector:

```javascript
// emitAgentSignals(agentRoleKey, tenantId, userId, interactionResult, assemblyMetadata)
//
// This function:
// 1. Looks up the agent in agentRegistry
// 2. Calls the agent's signalEmitter function to get signal fields
// 3. Calls recordPromptMeta with assembly metadata
// 4. Calls recordOutcome with the emitted signal fields
// 5. Calls recordPerformance with token/latency/cost data
//
// This is called by every agent after every interaction.
// New agents automatically get signal collection by registering in the registry.
```

## 1.2 — Wire Signal Emission into Each Agent

For each agent, add signal emission after the agent completes its work. The pattern is identical for all agents:

```javascript
// After agent interaction completes:
emitAgentSignals(
  agentRoleKey,       // from the agent's registration
  tenantId,           // from request context
  userId,             // from request context
  interactionResult,  // { success, documentType, matchCount, etc. }
  assemblyMetadata    // from assemblePrompt().metadata
);
```

**Agent-specific wiring:**

**OCR Agent** — find the OCR service module. After `extractInvoiceData()` returns, before the response is sent, emit signals. Use a synthetic conversation ID format: `ocr_{invoiceId}`.

**Product Matching Agent** — find the matching service module. After `aiBatchMatch()` returns, emit signals. Synthetic conversation ID: `match_{invoiceId}`.

**Product Import Agent** — find the product import agent module. First, wire it to use the prompt assembly engine instead of its hardcoded prompt. Then emit signals after analysis. Synthetic conversation ID: `import_{uploadId}`.

**Prompt Management Agent** — find the prompt chat agent module. After each chat interaction, emit signals. Synthetic conversation ID: `promptchat_{sessionId}`.

**Business Advisor** — already emits signals. Verify it uses the generic pattern. Refactor if needed.

## 1.3 — Wire Golden Dataset Capture at Correction Points

**Create a helper function** in or alongside the golden dataset builder:

```javascript
// captureCorrection(agentRoleKey, correctionEvent, beforeData, afterData, tenantId)
//
// This function:
// 1. Looks up the agent in agentRegistry
// 2. Finds the matching correctionPoint config for this event
// 3. Calls the agent's capture function
// 4. Masks PII
// 5. Stores as GoldenDatasetEntry
// 6. Also emits a humanOverride signal to the signal collector
//
// Called at every point in the application where a human corrects AI output.
```

**Correction points to wire (find the route modules for these endpoints):**

**Invoice line editing** (invoice routes, the PATCH endpoint for line items):
When a user edits an extracted field after OCR → captureCorrection for `ocr_extraction`

**Manual match creation** (invoice routes, the POST endpoint for manual matches):
When a user manually matches an invoice line → captureCorrection for `product_matching`

**Match update/override** (invoice routes, the PATCH endpoint for matches):
When a user changes a match → captureCorrection for `product_matching`

**Import template save** (product routes, the PUT endpoint for import templates):
When a user saves corrected field mappings → captureCorrection for `product_import`

**Low feedback rating** (chat routes, the feedback endpoint):
When a user gives a rating of 1 or 2 → captureCorrection for `business_advisor`

## 1.4 — Wire Product Import Agent to Assembly Engine

Find the product import agent module. Locate where the hardcoded system prompt is used. Replace with a call to the prompt assembly engine:

```javascript
const assemblyResult = await assemblePrompt({
  agentRoleKey: 'product_import',
  tenantId,
  runtimeContext: {
    currentDate: new Date().toISOString(),
    fileType: file.mimetype,
    fileName: file.originalname
  }
});
const systemPrompt = assemblyResult.prompt || FALLBACK_SYSTEM_PROMPT;
```

Keep the hardcoded prompt as the FALLBACK_SYSTEM_PROMPT (same pattern OCR and Advisor use).

## 1.5 — Tests for Phase 1

```
Unit tests for generic signal emission:
  ✓ emitAgentSignals calls recordPromptMeta with correct metadata
  ✓ emitAgentSignals calls agent's signalEmitter function from registry
  ✓ emitAgentSignals calls recordOutcome with emitted fields
  ✓ emitAgentSignals handles missing assembly metadata gracefully
  ✓ works for any registered agent (not agent-specific code)

Unit tests per agent (signal emission):
  ✓ OCR: emits signals after extraction with correct resolution status
  ✓ OCR: emits failed status on extraction error
  ✓ Matching: emits signals with correct matched/unmatched counts
  ✓ Import: emits signals after file analysis
  ✓ Import: uses assembly engine (not hardcoded prompt)
  ✓ Prompt Mgmt: emits signals with confirmed/abandoned status
  ✓ Advisor: continues to emit signals correctly

Unit tests for golden dataset capture:
  ✓ captureCorrection looks up agent in registry
  ✓ captureCorrection creates GoldenDatasetEntry with masked PII
  ✓ captureCorrection emits humanOverride signal
  ✓ captureCorrection skips duplicate entries
  ✓ captureCorrection works for any registered agent

Integration tests:
  ✓ OCR upload → extraction → signal in InteractionSignal table
  ✓ OCR upload → user edits field → override signal + golden entry created
  ✓ Matching → user overrides match → override signal + golden entry created
  ✓ Import → user corrects mapping → override signal + golden entry created
  ✓ Advisor → user rates 1-2 → golden entry created with bad response
  ✓ All signals include correct prompt version metadata
  ✓ Signals are non-blocking (< 1ms overhead on main flow)
  ✓ Golden entries have PII masked correctly
  ✓ Product Import uses assembled prompt (not hardcoded)
```

## 1.6 — Acceptance Criteria for Phase 1

- [ ] All 5 agents emit signals via the generic signal emission function
- [ ] All correction points capture golden dataset entries
- [ ] Product Import agent uses assembly engine
- [ ] Signal emission is agent-agnostic (uses registry)
- [ ] Golden dataset capture is agent-agnostic (uses registry)
- [ ] All Phase 1 unit and integration tests passing

---

# PHASE 2: Automated Scheduling + Few-Shot Auto-Curation
**Timeline: Week 4-6 | Priority: P1-P2 | Depends on: Phase 1**

## 2.1 — Build Evolution Scheduler

**Create new service:** `evolutionScheduler.js`

**Purpose:** Runs the evolution pipeline on automated schedules.

**Jobs to schedule:**

| Job | Schedule | What it does | Rate limiting |
|-----|----------|-------------|---------------|
| Suggestion Engine | Daily 2am AEST | Runs per tenant, per agent (iterates `agentRegistry.getAgentKeys()`) | Max 3 concurrent |
| Few-Shot Curation | Daily 4am AEST | Runs per tenant, per agent (iterates registry) | Max 3 concurrent |
| Meta-Optimizer | Weekly Sunday 3am AEST | Cross-tenant analysis | Max 1 at a time |
| Golden Dataset Export | Weekly Saturday midnight | Exports corrections to regression test files | Max 1 at a time |

**The scheduler MUST iterate agentRegistry.getAgentKeys()** to determine which agents to process. When a new agent is registered, the scheduler automatically includes it — no scheduler code changes needed.

**Skip rules:**
- Skip tenant+agent combination if fewer than 10 new signals since last run
- Skip meta-optimizer if fewer than 3 active tenants

**Error handling:**
- Retry failed runs up to 3 times with exponential backoff
- Log failures to PromptAuditLog
- After 3 consecutive failures, disable the job and alert admin

**Admin endpoints to add:**
- GET scheduler status — show all job statuses (last run, next run, success/failure)
- POST pause scheduler — pause all jobs
- POST resume scheduler — resume all jobs  
- POST trigger job — manually run a specific job

## 2.2 — Build Few-Shot Auto-Curation Pipeline

**Create new service:** `fewShotCurator.js`

**Purpose:** Identifies high-quality interactions and promotes them to `TenantFewShotExample` records.

**Core logic (agent-agnostic):**

```
FOR each registered agent (from agentRegistry.getAgentKeys()):
  FOR each tenant with recent signals for this agent:
    1. Query InteractionSignal for last 24 hours
    2. Filter using the agent's qualityCriteria function (from registry)
    3. Score each: satisfaction * (1 - correctionRate) * recency
    4. Check diversity (don't add 5 examples of the same pattern)
    5. For top candidates:
       a. Format as input/output pair
       b. Create TenantFewShotExample with autoCurated = true
       c. Link to sourceConversationId
    6. Prune: if > 20 examples per agent per tenant, deactivate lowest-scoring
```

**The curation pipeline queries each agent's `qualityCriteria` from the registry.** When a new agent registers with quality criteria, the curation pipeline automatically handles it.

## 2.3 — Tests for Phase 2

```
Unit tests for evolutionScheduler:
  ✓ schedules all 4 jobs with correct cron patterns
  ✓ iterates agentRegistry.getAgentKeys() for per-agent jobs
  ✓ respects rate limiting (max concurrent)
  ✓ skips tenants with insufficient signals
  ✓ retries failed runs with exponential backoff
  ✓ logs failures to PromptAuditLog
  ✓ pause/resume controls work
  ✓ new agent added to registry appears in next scheduler run

Unit tests for fewShotCurator:
  ✓ uses agent's qualityCriteria function from registry (not hardcoded)
  ✓ identifies high-quality interactions correctly for each agent type
  ✓ scores candidates correctly
  ✓ ensures diversity (no duplicate patterns)
  ✓ creates TenantFewShotExample with autoCurated = true
  ✓ links to sourceConversationId
  ✓ prunes low-scoring examples when limit exceeded
  ✓ skips agents with no high-quality interactions
  ✓ handles new agent type without code changes

Integration tests:
  ✓ High-quality interaction → auto-curated → appears in prompt assembly
  ✓ Quality score affects selection order in assembly
  ✓ Pruning removes lowest-scored, not manually curated
  ✓ Scheduler triggers curation for all registered agents
```

## 2.4 — Acceptance Criteria for Phase 2

- [ ] Scheduler running all 4 jobs on correct schedules
- [ ] All scheduled jobs iterate the agent registry (agent-agnostic)
- [ ] Few-shot curator uses agent quality criteria from registry
- [ ] Auto-curated examples appear in prompt assembly
- [ ] Admin scheduler status endpoint working
- [ ] All Phase 2 tests passing

---

# PHASE 3: Mem0 Integration
**Timeline: Week 7-9 | Priority: P3 | Depends on: Phase 1**

## 3.1 — Install and Configure Mem0

**Infrastructure changes:**
- Add pgvector extension to existing PostgreSQL (`CREATE EXTENSION IF NOT EXISTS vector`)
- Install mem0ai npm package (or Python SDK via sidecar if needed)

**Create new service:** `mem0Client.js`

**Key design decisions:**
- `user_id` = `tenantId` (tenant isolation)
- `agent_id` = `agentRoleKey` (per-agent memory separation)
- Use `claude-haiku` (cheapest model) for memory extraction — NOT the same model agents use
- All Mem0 operations are fire-and-forget — failure NEVER breaks the agent

**Functions:**
- `addMemory(content, tenantId, agentRoleKey, metadata)` — store a memory
- `searchMemories(query, tenantId, agentRoleKey, limit)` — find relevant memories
- `getMemories(tenantId, agentRoleKey)` — list all memories for admin viewing
- `deleteMemory(tenantId, memoryId)` — admin removal of bad memories

## 3.2 — Integrate Mem0 into Prompt Assembly Engine

**Modify:** the prompt assembly engine module (`promptAssemblyEngine.js`)

Add a new step between Step 4 (few-shot examples) and Step 5 (runtime context):

**Step 4.5: Inject Tenant Memories**

```
1. Search Mem0 for memories relevant to the current interaction
   - query: the user's message or document context
   - user_id: tenantId
   - agent_id: agentRoleKey
   - limit: 5 (max 5 memories to keep token cost reasonable)
2. Format memories as a "TENANT KNOWLEDGE" section
3. Append to assembled prompt
4. If Mem0 fails or returns empty → continue without memories (graceful degradation)
5. Cap memory section at 500 tokens to prevent context bloat
```

## 3.3 — Add Memory Storage at Correction Points

**Use the agent registry pattern.** When a correction is captured (via the golden dataset builder), ALSO store a memory using the agent's `memoryFormatter` function from the registry:

```javascript
// In the correction capture flow (goldenDatasetBuilder or a shared hook):
const agent = agentRegistry.getAgent(agentRoleKey);
if (agent.memoryFormatter) {
  const memoryText = agent.memoryFormatter(correctionData);
  await mem0Client.addMemory(memoryText, tenantId, agentRoleKey, { correctionType })
    .catch(err => console.error('Mem0 store failed:', err.message));
}
```

This means: any agent that registers a `memoryFormatter` automatically gets memory storage. Agents that set `memoryFormatter: null` (like Prompt Management) don't store memories. New agents get memory automatically by providing a formatter function.

**Business Advisor special case:** also store general conversation context after every interaction (not just corrections):

```javascript
// After advisor response:
mem0Client.addMemory(
  `User asked about: "${topicSummary}". Outcome: ${resolutionStatus}.`,
  tenantId, 'business_advisor', { conversationId }
).catch(err => console.error('Mem0 store failed:', err.message));
```

## 3.4 — Admin Memory Visibility

**Add admin routes** for memory management:
- GET memories for a tenant — list all memories (admin only)
- GET memories for a tenant + agent — filtered view
- DELETE a specific memory — admin removal
- GET memory stats — count per tenant per agent

## 3.5 — Tests for Phase 3

```
Unit tests for mem0Client:
  ✓ addMemory stores with correct tenant isolation (user_id = tenantId)
  ✓ searchMemories returns only memories for specified tenant + agent
  ✓ tenant A cannot see tenant B's memories
  ✓ uses claude-haiku for extraction (not expensive model)
  ✓ handles connection failure gracefully (returns empty, doesn't throw)

Unit tests for assembly engine integration:
  ✓ Step 4.5 injects memories into assembled prompt
  ✓ assembly succeeds when Mem0 unavailable (graceful degradation)
  ✓ memory section capped at 500 tokens
  ✓ memories formatted as "TENANT KNOWLEDGE" section

Unit tests for memory storage:
  ✓ correction with memoryFormatter → memory stored
  ✓ correction without memoryFormatter (null) → no memory stored
  ✓ memory storage uses agent's memoryFormatter from registry
  ✓ Mem0 store failure doesn't break correction capture flow

Integration tests:
  ✓ OCR correction → memory stored → next OCR retrieves memory in prompt
  ✓ Match override → memory stored → next match retrieves memory
  ✓ Advisor conversation → memory stored → next conversation has context
  ✓ Memory accumulates over multiple interactions
  ✓ Tenant isolation verified (cross-tenant memory leak test)
  ✓ New agent with memoryFormatter automatically gets memory
```

## 3.6 — Acceptance Criteria for Phase 3

- [ ] Mem0 client configured with pgvector on existing PostgreSQL
- [ ] Memory retrieval integrated into prompt assembly (Step 4.5)
- [ ] Memory storage triggered by corrections for all agents with memoryFormatter
- [ ] Business Advisor stores conversation context after each interaction
- [ ] Graceful degradation when Mem0 unavailable
- [ ] Admin memory routes working
- [ ] Tenant isolation verified
- [ ] All Phase 3 tests passing

---

# PHASE 4: Evaluation & Regression Framework
**Timeline: Week 10-12 | Priority: P3 | Depends on: Phase 0 (data accumulation), Phase 1**

## 4.1 — Build Evaluation Engine

**Create new service:** `evaluationEngine.js`

**Purpose:** Runs regression tests and capability evaluations. Agent-agnostic — queries the agent registry for scoring functions.

**Core logic:**

```
runRegression(agentRoleKey):
  1. Load golden-dataset.json for this agent
  2. IF dataset has < 5 entries → SKIP (not enough data, log warning)
  3. Get the agent's evaluationScorer from agentRegistry
  4. FOR each entry in dataset:
     a. Feed input through the agent (with current prompt config)
     b. Score using the agent's evaluationScorer(agentOutput, humanCorrected)
  5. Calculate aggregate score
  6. Compare to baseline (previous EvaluationRun score)
  7. IF score dropped > threshold → FAIL
  8. Store results in EvaluationRun table
  9. Return { passed, score, baselineScore, delta, details }

runAllRegressions():
  1. Iterate agentRegistry.getAgentKeys()
  2. Run regression for each agent
  3. Return aggregate results
  4. If ANY agent fails → overall fail
```

**The evaluation engine uses each agent's `evaluationScorer` from the registry.** No agent-specific scoring code in the engine. New agents automatically get evaluation by registering a scorer.

## 4.2 — Build LLM-as-Judge for Business Advisor

**Create new evaluation judge:** `advisorJudge.js` (in the evaluation judges directory)

This is the evaluationScorer for the Business Advisor agent — registered via the agent registry.

**Judge prompt:**
```
Rate the advisor's response on 4 dimensions (1-5 each):
1. RELEVANCE: Does it address the specific question?
2. GROUNDEDNESS: Is it based on real data, not assumptions?
3. ACTIONABILITY: Could the tenant execute this advice?
4. SPECIFICITY: Is this specific to this tenant, or generic?

Return JSON with scores and reasoning.
```

Use `claude-haiku` for judging (fast + cheap). Overall score = average of 4 dimensions, normalized to 0-1.

## 4.3 — Database Model for Evaluation Tracking

Add to Prisma schema:

```
EvaluationRun
  - id: UUID
  - agentRoleKey: String (indexed)
  - runType: String (regression, capability, pre-deployment)
  - datasetSize: Int
  - score: Float (0-1)
  - baselineScore: Float (nullable — previous run)
  - scoreDelta: Float (nullable)
  - passed: Boolean
  - threshold: Float
  - details: Json (per-test-case results)
  - triggeredBy: String (ci, scheduler, manual)
  - promptVersionId: String (nullable)
  - tenantId: String (nullable — null for default prompt tests)
  - createdAt: DateTime
```

## 4.4 — CI/CD Regression Gate

**Create new script:** `run-regression.js` (in scripts directory)

```javascript
// Iterates agentRegistry.getAgentKeys()
// Runs regression for each agent with data
// Skips agents with < 5 golden entries (logs warning, doesn't fail)
// Returns exit code 0 (all pass) or 1 (any fail)
// Designed to be called in CI pipeline
```

**Add to package.json:**
```json
"test:regression": "node scripts/run-regression.js",
"test:all": "npm test && npm run test:regression"
```

## 4.5 — Tests for Phase 4

```
Unit tests for evaluationEngine:
  ✓ uses agent's evaluationScorer from registry (not hardcoded)
  ✓ runs regression with correct scoring per agent type
  ✓ skips agents with < 5 golden entries
  ✓ detects regression (score drop > threshold) → FAIL
  ✓ passes when score >= baseline
  ✓ stores results in EvaluationRun table
  ✓ calculates correct delta from previous run
  ✓ runAllRegressions iterates all registered agents
  ✓ new agent with evaluationScorer automatically included

Unit tests for advisorJudge:
  ✓ returns valid JSON with all 4 dimensions
  ✓ scores high for relevant, grounded, actionable responses
  ✓ scores low for generic, hallucinated responses
  ✓ uses claude-haiku
  ✓ handles judge failure gracefully

Integration tests:
  ✓ golden dataset export → regression run → results in EvaluationRun
  ✓ prompt change improving score → passes
  ✓ prompt change degrading score → fails with correct error
  ✓ CI script exit code 0 on pass, 1 on fail
  ✓ regression skips agents with no data (doesn't block deploy)
```

## 4.6 — Acceptance Criteria for Phase 4

- [ ] Evaluation engine running regressions per agent using registry scorers
- [ ] LLM-as-Judge working for advisor agent
- [ ] CI script blocking deployment on regression failure
- [ ] Graceful handling of empty golden datasets (skip, don't fail)
- [ ] EvaluationRun table tracking all results
- [ ] All Phase 4 tests passing

---

# PHASE 5: Suggestion Engine Enhancements
**Timeline: Week 13-14 | Priority: P2 | Depends on: Phase 1, Phase 4**

## 5.1 — Add Golden Dataset Validation to Suggestion Engine

**Modify:** the suggestion engine service (`suggestionEngine.js`)

Before a suggestion is finalized, validate it:

```
1. Load golden dataset sample for this agent + tenant
2. If < 3 entries → mark suggestion as "unvalidated" (still present, flag for admin)
3. If enough entries → simulate: what would the prompt look like with this change?
4. Run golden entries through modified prompt
5. Score using agent's evaluationScorer from registry
6. Compare to current score
7. If performance drops → reject suggestion with reason
8. Store validation result with the suggestion record
```

## 5.2 — Acceptance Criteria for Phase 5

- [ ] Suggestion engine validates proposals against golden dataset when available
- [ ] Unvalidated suggestions flagged (not blocked)
- [ ] Validation results stored with suggestion for admin review
- [ ] Validation uses agent's evaluationScorer from registry
- [ ] All Phase 5 tests passing

---

# PHASE 6: Meta-Optimizer Enhancements
**Timeline: Week 15-18 | Priority: P4 | Depends on: Phase 4, sufficient tenant scale**

## 6.1 — Tenant Similarity Matching

**Create new service:** `tenantSimilarity.js`

**Tenant feature vector based on:**
- Number of products, suppliers
- Invoice volume per month
- Agent usage patterns (which agents used, frequency)
- Performance metrics per agent
- Business type/category (if captured)

**Use simple cosine similarity** — not a full ML pipeline. Cluster tenants into similarity groups. When a customization works well for one tenant, recommend it to tenants in the same group.

## 6.2 — Canary Rollout for Default Changes

**Modify:** the meta-optimizer service (`metaOptimizer.js`)

When a default prompt upgrade is activated:
1. Select 10-20% of tenants on pure defaults as canary group
2. Route canary tenants to new default version
3. Monitor for 7 days (using evaluation engine)
4. Compare canary vs control performance
5. If canary equal or better → promote to all
6. If worse → auto-rollback and alert admin

## 6.3 — Acceptance Criteria for Phase 6

- [ ] Tenant similarity service producing meaningful clusters
- [ ] Cross-tenant recommendations targeting similar tenants
- [ ] Canary rollout routing working correctly
- [ ] Auto-rollback triggered on performance degradation
- [ ] All Phase 6 tests passing

---

# Adding a New Agent: The Checklist

When a developer adds a new agent to RetailEdgeAI, they follow this checklist. This is the entire process — no evolution infrastructure code needs to change.

```
□ 1. CREATE the agent service module
     - Implement the agent's core logic
     - Use assemblePrompt() for all prompts (never hardcode)

□ 2. ADD AgentRole record to the seed file
     - key, name, description, model, maxTokens, isActive

□ 3. SEED initial PromptBaseVersion
     - Create version 1 of the base prompt for this agent

□ 4. REGISTER in agentRegistry with:
     □ key — matches AgentRole.key
     □ correctionPoints — array of events where users can correct output
     □ qualityCriteria — function defining "high-quality interaction"
     □ evaluationScorer — function scoring output vs ground truth
     □ memoryFormatter — function formatting corrections as memories (or null)
     □ signalEmitter — function producing signal fields from interaction results

□ 5. ADD signal emission call after agent interaction
     - Call emitAgentSignals() with interaction results

□ 6. ADD golden dataset capture at correction points
     - Call captureCorrection() where users fix output

□ 7. CREATE empty golden dataset file
     - regression/{agent_key}/golden-dataset.json with []

□ 8. WRITE tests
     □ Unit test for signal emission
     □ Unit test for correction capture
     □ Integration test for end-to-end flow

□ 9. VERIFY automatic pickup
     □ Scheduler includes new agent in daily runs
     □ Few-shot curator evaluates new agent's interactions
     □ Evaluation engine runs regression for new agent (when data exists)
     □ Suggestion engine analyzes new agent's signals
     □ Meta-optimizer includes new agent in cross-tenant analysis
     □ Mem0 stores memories (if memoryFormatter provided)
```

**Everything in step 9 happens automatically** because the infrastructure iterates the agent registry. The developer doesn't touch any evolution code.

---

# Cold-Start Data Strategy

## The Data Flywheel

```
Week 1:    Phase 0 complete. Golden dataset builder ready.
           → 0 test data. That's fine.

Week 2-3:  Phase 1 complete. Signals flowing from all agents.
           → Every interaction logged. Every correction captured.
           → Maybe 5-15 golden entries from first real usage.

Week 4-6:  Phase 2 complete. Auto-curation active.
           → Good interactions promoted to few-shot examples.
           → Golden dataset growing from corrections.
           → Maybe 20-50 entries per agent.

Week 7-9:  Phase 3 complete. Mem0 active.
           → Agents start remembering tenant context.
           → Corrections store learnings.

Week 10-12: Phase 4 complete. Evaluation framework active.
            → Regression tests running (if 5+ entries exist).
            → Suite gets harder automatically each week.
            → LLM-as-Judge calibrated for advisor.

Week 13+:  Compounding.
           → 100+ golden entries per agent.
           → Regression catches real regressions.
           → Evolution provably improves metrics.
           → New agents plug in automatically.
```

## Week 1 Bootstrap (Manual)

To avoid waiting for organic data:
1. Process 5 real invoices through OCR manually, verify output → 5 golden entries
2. Run 10 product matches manually, verify selections → 10 golden entries
3. Import one real supplier file, verify mappings → 3-5 golden entries
4. Ask the advisor 5 real business questions, rate responses → 5 golden entries

Total: ~25 entries in 1-2 hours of manual work. Enough to start regression testing.

## Evaluation Thresholds (Start Low, Tighten Over Time)

| Metric | Week 1-4 | Week 5-12 | Week 13+ |
|--------|----------|-----------|----------|
| Regression failure threshold | 20% drop | 10% drop | 5% drop |
| Minimum golden entries to run | 3 | 5 | 10 |
| Few-shot quality score minimum | 0.5 | 0.6 | 0.7 |
| Suggestion validation requirement | None (not enough data) | Optional | Required |

---

# Module Summary: What Gets Created vs Modified

## New Modules to Create

| Module | Phase | Description |
|--------|-------|-------------|
| `agentRegistry.js` | 0 | Central registration contract for all agents |
| `goldenDatasetBuilder.js` | 0 | Captures corrections as test data (agent-agnostic) |
| `testDataFactory.js` | 0 | Synthetic test data generation |
| `piiMasker.js` | 0 | PII masking for captured data |
| `evolutionScheduler.js` | 2 | Cron scheduling for evolution jobs |
| `fewShotCurator.js` | 2 | Auto-curates high-quality examples (agent-agnostic) |
| `mem0Client.js` | 3 | Mem0 memory layer wrapper with tenant isolation |
| `evaluationEngine.js` | 4 | Regression and capability testing (agent-agnostic) |
| `advisorJudge.js` | 4 | LLM-as-Judge evaluator for advisor quality |
| `run-regression.js` | 4 | CI/CD regression gate script |
| `tenantSimilarity.js` | 6 | Tenant clustering for cross-tenant recommendations |

## Existing Modules to Modify

| Module | Phase | Changes |
|--------|-------|---------|
| OCR service | 0, 1 | Register in agentRegistry. Add signal emission. Add golden dataset capture at correction points |
| Matching service | 0, 1 | Register in agentRegistry. Add signal emission. Add golden dataset capture at correction points |
| Product Import agent | 0, 1 | Register in agentRegistry. Wire to assembly engine. Add signal emission. Add golden dataset capture |
| Business Advisor orchestrator | 0, 1, 3 | Register in agentRegistry. Verify signal emission. Add Mem0 conversation memory storage |
| Prompt Chat agent | 0, 1 | Register in agentRegistry. Add signal emission |
| Prompt Assembly Engine | 3 | Add Step 4.5 (Mem0 memory injection) |
| Signal Collector | 1 | Add generic emitAgentSignals() helper |
| Invoice routes | 1 | Add golden dataset capture at line edit and match endpoints |
| Product routes | 1 | Add golden dataset capture at import template save |
| Chat routes | 1 | Add golden dataset capture at low-feedback endpoint |
| Suggestion Engine | 5 | Add golden dataset validation for proposals |
| Meta-Optimizer | 6 | Add canary rollout logic |
| Seed file (seed-prompt-evolution.js) | 0 | Add product_import AgentRole + base prompt version |
| Prisma schema | 0, 4 | Add GoldenDatasetEntry and EvaluationRun models |
| package.json | 0, 3 | Add test scripts, mem0ai dependency |
