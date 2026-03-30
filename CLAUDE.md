# RetailEdgeAI

AI-powered invoice, pricing, and margin management platform for small retailers.

## Tech Stack

- **Frontend**: React 19, Vite 7, Tailwind CSS 4, React Router 7 (SPA)
- **Backend**: Node.js, Express 5, Prisma 6 ORM
- **Database**: PostgreSQL 16 (Docker, port 5433)
- **AI**: Anthropic Claude API (OCR, chat, product matching), Cohere API (embeddings, reranking — planned)
- **Language**: Pure JavaScript (ES Modules throughout, no TypeScript)
- **Testing**: Vitest + Supertest
- **Deployment**: PM2 + Nginx, Docker for Postgres

## Commands

```bash
# Development
npm run dev              # Run server + client concurrently
npm run dev:server       # Server only (port 3001)
npm run dev:client       # Client only (port 5174)

# Database
npm run db:up            # Start PostgreSQL container
npm run db:down          # Stop PostgreSQL container
npm run db:migrate       # Run Prisma migrations
npm run db:seed          # Seed database
npm run db:studio        # Open Prisma Studio

# Testing
npm run test             # Run Vitest once (backend)
npm run test:watch       # Vitest watch mode

# Build & Deploy
npm run build            # Build client SPA to /client/dist
bash deploy.sh           # Full production deploy
```

## Project Structure

```
client/src/
  pages/                 # Page components (PascalCase)
  components/            # Reusable UI components
  hooks/                 # Custom React hooks
  services/api.js        # HTTP client (fetch-based)

server/src/
  app.js                 # Express app entry point
  routes/                # 24 route files (REST API under /api)
  services/              # 29 service modules (business logic)
    ai/                  # AI Service Abstraction Layer (ASAL)
      aiServiceRouter.js # Single entry point for all AI service calls
      adapters/          # Provider-specific API translators
        anthropic.js     # Anthropic (Claude) adapter
        cohere.js        # Cohere adapter (embeddings, reranking, generation)
  middleware/             # Auth, tenant scoping, plan gating
  lib/                   # Prisma client, encryption utilities
  config/                # App configuration
  tests/                 # Vitest test files

docs/                    # Architecture, BRD, design docs
docker/                  # Docker init scripts
```

## Code Conventions

- ES Modules (`import`/`export`) everywhere — no CommonJS except config files (`.cjs`)
- Prettier: semicolons, single quotes, trailing commas (es5), 100-char width, 2-space indent
- File naming: camelCase for JS files, PascalCase for React components
- Backend pattern: routes call services, services contain business logic
- Multi-tenant: all queries scoped by `tenantId` via middleware

## Architecture

- **Multi-tenant SaaS** with Row-Level Security and tenant-scoped middleware
- **Auth**: JWT bearer tokens, role-based access (OWNER, OPS_MANAGER, MERCHANDISER, STORE_MANAGER, ACCOUNTANT, SYSTEM_ADMIN)
- **Plan gating**: Feature access controlled by subscription tier via `requirePlan` middleware
- **AI Agents**: Orchestrator pattern with tool execution (OCR, matching, pricing, competitor tools)
- **AI Service Layer**: Provider-agnostic routing via `aiServiceRouter.js` — all AI calls declare intent + task, the router resolves provider/model from the `ai_service_registry` database table
- **Integrations**: Gmail (IMAP/OAuth), Google Drive, Shopify, local folder polling
- **Background jobs**: node-cron schedulers for email polling, folder watching, signal collection
- **Encryption**: AES-256-GCM for sensitive fields (API keys, tokens)

## Database

- Prisma schema at `server/prisma/schema.prisma` (~1168 lines, 40+ models)
- Two database users: `retailedge` (admin/migrations), `retailedge_app` (RLS-scoped)
- Test database: `retailedge_test` (separate schema, tests run sequentially)

## Environment

Key env vars (see `.env.example`):
- `DATABASE_URL` / `DATABASE_URL_ADMIN` / `DATABASE_URL_TEST`
- `JWT_SECRET`
- `ANTHROPIC_API_KEY`
- `COHERE_API_KEY` (added when Cohere integration is adopted)
- `PORT` (3001 dev, 3000 prod)
- `NODE_ENV`

## Deployment

- **Nginx**: port 80, proxies `/api/*` to `127.0.0.1:3000`, SPA fallback for all other routes
- **PM2**: `ecosystem.config.cjs` runs `retailedge-api` service
- **Docker**: PostgreSQL 16 Alpine with health checks and init scripts
# CLAUDE.md — Agent Creation Instructions
## Add this section to your existing CLAUDE.md file

---

## New AI Agent Creation Protocol

**MANDATORY:** When creating any new AI agent for RetailEdgeAI, Claude Code MUST follow ALL steps below. No agent should exist without completing this protocol. This applies to every agent — whether it's a simple extraction agent or a complex multi-tool advisor.

### Step 1: Create the Agent Service Module

- Implement the agent's core logic in a new service file
- The agent MUST use the Prompt Assembly Engine for its system prompt — NEVER hardcode prompts
- **All AI API calls MUST go through the AI Service Router** (`services/ai/aiServiceRouter.js`) — NEVER import provider SDKs directly. See "AI Service Abstraction Layer" section below.
- Pattern to follow:
  ```javascript
  const { assemblePrompt } = require('./promptAssemblyEngine');
  const aiService = require('./ai/aiServiceRouter');
  
  // Always attempt assembly, fall back to hardcoded only on failure
  const assemblyResult = await assemblePrompt({
    agentRoleKey: 'my_agent_key',
    tenantId,
    runtimeContext: { /* agent-specific context */ }
  });
  const systemPrompt = assemblyResult.prompt || FALLBACK_SYSTEM_PROMPT;
  
  // Use the router with a task_key — never call a provider SDK directly
  const { response } = await aiService.generate('my_task_key', systemPrompt, userPrompt);
  ```
- Keep a FALLBACK_SYSTEM_PROMPT constant at the top of the file for resilience
- The router internally calls `trackedClaudeCall()` or the equivalent for other providers — agents never call tracking functions directly

### Step 2: Add AgentRole Database Record

- Add the agent role to the seed file `seed-prompt-evolution.js`:
  ```javascript
  {
    key: 'unique_agent_key',        // lowercase, underscored, unique
    name: 'Human Readable Name',
    description: 'What this agent does',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,                // adjust per agent needs
    isActive: true
  }
  ```

### Step 3: Seed Initial PromptBaseVersion

- In the same seed file, create the first base prompt version:
  ```javascript
  {
    agentRoleId: <the role created above>,
    versionNumber: 1,
    content: {
      systemPrompt: '<the full system prompt text>',
      sections: [],
      toolDefinitions: [],
      outputFormat: {}
    },
    isActive: true,
    changeDescription: 'Initial version'
  }
  ```
- The systemPrompt content should match the FALLBACK_SYSTEM_PROMPT in the agent service

### Step 4: Register in Agent Registry

- In the agent service module, register with `agentRegistry.js` at module initialization:
  ```javascript
  const { registerAgent } = require('./agentRegistry');
  
  registerAgent({
    key: 'unique_agent_key',
    
    // Where can users correct this agent's output?
    correctionPoints: [
      { 
        event: 'descriptive_event_name',  // e.g., 'field_edited', 'result_overridden'
        description: 'When the user does X'
      }
    ],
    
    // What does a "good" interaction look like for this agent?
    qualityCriteria: (signal) => 
      signal.resolutionStatus === 'resolved' && 
      signal.humanOverride === false,
    
    // How do we score this agent's output against ground truth?
    evaluationScorer: (agentOutput, groundTruth) => {
      // Return a score between 0 and 1
      // Implement agent-specific comparison logic
    },
    
    // How do we format a correction as a memory for Mem0?
    // Set to null if this agent should not store memories
    memoryFormatter: (correction) => 
      `Learned: ${correction.description}`,
    
    // What signal fields should be emitted after each interaction?
    signalEmitter: (result) => ({
      resolutionStatus: result.success ? 'resolved' : 'failed',
      topicTags: ['agent_type', ...result.tags]
    })
  });
  ```
- ALL fields are required. If the agent has no correction points, use an empty array `[]`
- If the agent should not store memories, set `memoryFormatter: null`

### Step 5: Register AI Service Task Keys

- If the agent introduces new AI tasks, add corresponding entries to the `ai_service_registry` table via a seed or migration:
  ```javascript
  {
    intent: 'TEXT_GENERATION',       // or 'EMBEDDING' or 'RERANKING'
    task_key: 'my_agent_task',       // unique, lowercase, underscored
    description: 'What this task does',
    provider: 'anthropic',           // or 'cohere', etc.
    model: 'claude-sonnet-4-20250514',
    config: {},                      // provider-specific config as JSON
    is_active: true
  }
  ```
- Every distinct AI operation should have its own task_key — this enables per-task provider routing and cost tracking

### Step 6: Emit Signals After Every Interaction

- After the agent completes its work, call the generic signal emission helper:
  ```javascript
  const { emitAgentSignals } = require('./signalCollector');
  
  emitAgentSignals(
    'unique_agent_key',
    tenantId,
    userId,
    interactionResult,      // { success, topicTags, error, etc. }
    assemblyResult.metadata  // from assemblePrompt()
  );
  ```
- Use synthetic conversation IDs for non-chat agents: `agentkey_{recordId}`
- Signal emission MUST be fire-and-forget — never await, never let failures block the main flow

### Step 7: Capture Corrections for Golden Dataset

- At every route/endpoint where a user can correct this agent's output, add:
  ```javascript
  const { captureCorrection } = require('./goldenDatasetBuilder');
  
  captureCorrection({
    agentRoleKey: 'unique_agent_key',
    correctionType: 'descriptive_type',  // e.g., 'field_edit', 'override'
    input: { /* the original input to the agent */ },
    agentOutput: { /* what the agent produced */ },
    humanCorrected: { /* what the human changed it to */ },
    tenantId
  });
  ```
- This is fire-and-forget — never let it block the user's action
- PII masking happens inside the builder — the caller passes raw data

### Step 8: Create Empty Golden Dataset File

- Create a regression test fixture:
  ```
  tests/regression/{agent_key}/golden-dataset.json
  ```
- Contents: `[]` (empty array — will be populated from production corrections)

### Step 9: Write Tests

Every new agent MUST include these tests:

```
Unit tests (in tests/unit/services/):
  ✓ Agent registers in agentRegistry with all required fields
  ✓ Agent uses assemblePrompt() (not hardcoded prompt)
  ✓ Agent falls back to FALLBACK_SYSTEM_PROMPT on assembly failure
  ✓ All AI calls go through aiServiceRouter (not direct SDK imports)
  ✓ Signal emission fires after successful interaction
  ✓ Signal emission fires after failed interaction (with failed status)
  ✓ Signal emission is non-blocking (fire-and-forget)
  ✓ Golden dataset capture fires on user correction
  ✓ Golden dataset capture is non-blocking

Integration tests (in tests/integration/):
  ✓ Full interaction flow: input → assembly → router → provider → output → signals
  ✓ Correction flow: output → user corrects → golden entry + override signal
  ✓ Mem0 flow: correction → memory stored → next interaction retrieves memory
  ✓ Tenant isolation: agent only sees its own tenant's data
  ✓ Router fallback: primary provider failure triggers fallback provider (if configured)
```

### Step 10: Verify Automatic Pickup (No Code Changes Needed)

After completing steps 1-9, verify that the following happen automatically (because the evolution infrastructure iterates `agentRegistry`):

- [ ] Evolution Scheduler includes the new agent in daily suggestion runs
- [ ] Few-Shot Curator evaluates the agent's interactions using its `qualityCriteria`
- [ ] Evaluation Engine runs regression tests using the agent's `evaluationScorer`
- [ ] Suggestion Engine analyzes the agent's signals
- [ ] Meta-Optimizer includes the agent in cross-tenant analysis
- [ ] Mem0 stores memories on corrections (if `memoryFormatter` is provided)
- [ ] AI service calls are logged in `ai_service_log` with correct task_key attribution

**If any of step 10 requires code changes to the evolution infrastructure, the infrastructure has a bug — fix the infrastructure, not the agent.**

---

## AI Service Abstraction Layer (ASAL)

The platform uses multiple AI providers for different capabilities. All AI API calls are routed through a provider-agnostic abstraction layer. This section defines the rules for interacting with AI services.

### Core Principle

**Define by intent, not by provider.** Application code declares what it needs (intent + task_key). The AI Service Router resolves which provider and model fulfils the request, based on a centrally managed database registry.

### Three Service Intents

Every AI API call maps to exactly one intent:

- **EMBEDDING** — Convert text to a vector for similarity matching. Used by CatalogMatcher, cross-tenant intelligence.
- **RERANKING** — Reorder a list of candidates by semantic relevance. Used by advisor agents for context retrieval.
- **TEXT_GENERATION** — Send a prompt, receive a reasoned response. Used by all agents.

### How to Call AI Services

```javascript
const aiService = require('./ai/aiServiceRouter');

// Text generation
const { response } = await aiService.generate('strategic_advice', systemPrompt, userPrompt);

// Embedding
const { vectors } = await aiService.embed('product_matching', productName);

// Reranking
const { results } = await aiService.rerank('advisor_context', query, candidateDocs);
```

### Rules (Apply to ALL Code)

- **NEVER import a provider SDK directly** (no `require('@anthropic-ai/sdk')`, no `require('cohere-ai')` in agent or service code). All AI calls go through `aiServiceRouter.js`.
- **NEVER hardcode a provider name or model string** in agent code. The task_key is the only coupling point. The registry determines the provider.
- **Every distinct AI operation must have its own task_key** in the `ai_service_registry` table. Don't reuse task_keys across different agents or operations.
- **Provider adapters are the only files that import provider SDKs.** Adapters live in `services/ai/adapters/` and export the three standard functions: `embed()`, `rerank()`, `generate()`.
- **New adapters follow the established contract.** See `adapters/anthropic.js` as the reference implementation. All adapters return the same output shape per intent.

### Adding a New Provider

1. Create `services/ai/adapters/{provider}.js` — implement the three intent functions
2. Add the provider's API key to `.env` and `ecosystem.config.cjs`
3. Add registry rows for the tasks that should use the new provider
4. Run the evaluation protocol (see ARCHITECTURE_STATE.md Section 9) before switching production traffic
5. Log the decision in DECISIONS_LOG.md

### Adapter File Convention

```
services/ai/adapters/
  anthropic.js    — TEXT_GENERATION (all agents currently)
  cohere.js       — EMBEDDING, RERANKING, TEXT_GENERATION (planned)
  voyageai.js     — EMBEDDING, RERANKING (future, if evaluation warrants)
```

Each adapter file exports:
```javascript
export async function embed(text, model, config) { /* → { vectors, tokenCount } */ }
export async function rerank(query, documents, model, config) { /* → { results } */ }
export async function generate(systemPrompt, userPrompt, model, config) { /* → { response, inputTokens, outputTokens } */ }
```

If a provider doesn't support an intent, the function throws `{ code: 'PROVIDER_INTENT_NOT_SUPPORTED' }`.

---

## Agent Architecture Constraints (Apply to ALL Code)

These constraints apply to every file in the codebase, not just new agents:

### Prompt Management
- The tenant NEVER sees or edits the assembled prompt. They interact only with structured configuration surfaces (tone, instructions, terminology, escalation rules)
- Tenant data must be strictly isolated — no cross-tenant data leakage
- Prompt changes must be auditable — who changed what, when, why
- The system must be rollback-safe — any prompt change can be reverted
- Default prompt upgrades must not break tenant-specific overrides
- The meta-agent must not auto-deploy changes — all changes require admin approval

### Tenant Isolation
- All database queries for tenant data MUST use the tenant-scoped Prisma client (`req.prisma` from tenantScope middleware)
- Mem0 memories are isolated by `user_id = tenantId` — never query across tenants
- Signal data includes tenantId — analytics can be scoped per tenant
- Golden dataset entries have PII masked — no raw tenant data in test fixtures

### LLM Calls
- **ALL AI API calls go through `aiServiceRouter.js`** — never import provider SDKs directly in agent or service code
- The router internally handles tracking, logging, and cost estimation via the `ai_service_log` table
- For the transition period (before ASAL Step 1 is complete), existing `trackedClaudeCall()` calls remain valid but should be migrated to the router as agents are touched
- Use `claude-sonnet-4-20250514` as the default for agent tasks (configured in the registry, not hardcoded in agent code)
- Use `claude-haiku-4-5-20251001` for evaluation judges, memory extraction, and meta-analysis (configured in the registry)
- Never hardcode API keys — always use environment variables
- **Provider and model selection is a platform governance decision**, configured in the `ai_service_registry` table and logged in DECISIONS_LOG.md. Individual agents do not choose their own provider.

### Error Handling
- Mem0 failures NEVER break the agent — always catch and continue
- Signal emission failures NEVER block the user flow — fire-and-forget
- Golden dataset capture failures NEVER affect the user action — fire-and-forget
- Assembly engine failures fall back to FALLBACK_SYSTEM_PROMPT — never fail silently with no prompt
- Evaluation failures skip the agent (log warning) — never block deployment when there's insufficient test data
- **AI service router failures trigger fallback providers** (if configured in the registry). If no fallback exists, the error propagates to the caller with a standardised error shape.

### Testing
- No code ships without tests
- Every new function gets a unit test
- Every integration point gets an integration test
- Tests use `testDataFactory.js` for synthetic data, never production data directly
- Golden dataset tests use PII-masked production data exported by `goldenDatasetBuilder.js`
- **AI service tests must verify calls go through the router**, not direct SDK imports