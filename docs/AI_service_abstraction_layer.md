# AI Service Abstraction Layer (ASAL)

**Component Owner:** Rohan (Product Owner / Business Analyst)
**Status:** Proposed — Pre-Implementation
**Created:** 2026-03-30
**Target Document:** ARCHITECTURE_STATE.md (Section: Core Infrastructure Components)

---

## 1. Purpose

RetailEdgeAI consumes external AI APIs across multiple agents and pipeline stages. The AI model and API landscape is evolving rapidly — new providers, models, and pricing tiers emerge monthly. Without an abstraction layer, every model upgrade or provider swap requires hunting through agent code, matcher code, and advisor code to find and update API calls.

The AI Service Abstraction Layer (ASAL) decouples application logic from AI provider specifics. Application code declares what it needs done (intent + task). ASAL decides which provider and model fulfils that request, based on a centrally managed registry.

**Design Principle:** Define by intent, not by provider. No agent, matcher, or advisor in the codebase should import a provider SDK directly or contain provider-specific API logic.

---

## 2. Problem Statement

Without ASAL, RetailEdgeAI faces the following risks as the AI landscape evolves:

- **Vendor lock-in:** Switching from Anthropic to Cohere (or vice versa) for a specific task requires code changes across multiple files, with regression risk.
- **Cost rigidity:** Unable to route low-complexity tasks to cheaper models without refactoring agent code.
- **Quality stagnation:** When a better embedding or reranking model launches, adoption requires development effort proportional to the number of call sites, creating inertia against improvement.
- **No performance visibility:** Without centralised logging of AI service calls, there is no data to inform provider/model decisions.
- **Fragile resilience:** If a single provider has an outage, all dependent functionality fails with no fallback path.

---

## 3. Architecture Overview

ASAL consists of four components:

```
┌─────────────────────────────────────────────────────┐
│                  Application Code                    │
│  (Agents, CatalogMatcher, Advisors, Pipeline stages) │
│                                                       │
│  Calls: aiService.embed('product_matching', text)     │
│  Calls: aiService.rerank('advisor_context', query, docs)│
│  Calls: aiService.generate('strategic_advice', prompt)│
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │     AI Service Router    │
          │   (aiServiceRouter.js)   │
          │                          │
          │  1. Lookup intent+task   │
          │  2. Load adapter         │
          │  3. Execute + normalise  │
          │  4. Log + return         │
          └─────┬──────────┬────────┘
                │          │
    ┌───────────▼──┐  ┌───▼───────────┐
    │   Registry   │  │  Governance   │
    │  (DB Table)  │  │   (Logger +   │
    │              │  │   Fallbacks)  │
    └──────────────┘  └───────────────┘
                │
    ┌───────────▼──────────────────────┐
    │        Provider Adapters          │
    │                                   │
    │  adapters/anthropic.js            │
    │  adapters/cohere.js               │
    │  adapters/voyageai.js             │
    │  adapters/openai.js               │
    │  adapters/mistral.js              │
    │  (future adapters as needed)      │
    └───────────────────────────────────┘
```

---

## 4. Service Intents

Every AI API call in RetailEdgeAI falls into one of three service intents. These are fixed categories — new intents should only be added through a governance decision logged in DECISIONS_LOG.md.

### 4.1 EMBEDDING

Converts text (or text + metadata) into a numerical vector for similarity comparison.

- **Input contract:** `{ text: string | string[], options?: { inputType?: 'document' | 'query' } }`
- **Output contract:** `{ vectors: number[][], model: string, tokenCount: number, latencyMs: number }`
- **Current consumers:** CatalogMatcher (product matching), cross-tenant intelligence engine
- **Future consumers:** RAG retrieval for all advisor agents, product categorisation

### 4.2 RERANKING

Takes a query and a list of candidate documents/texts, returns them reordered by semantic relevance with scores.

- **Input contract:** `{ query: string, documents: string[], options?: { topN?: number } }`
- **Output contract:** `{ results: Array<{ index: number, relevanceScore: number, document: string }>, model: string, latencyMs: number }`
- **Current consumers:** None (not yet implemented)
- **Future consumers:** Business Advisor context retrieval, Strategic Advisor context retrieval, any agent performing RAG

### 4.3 TEXT_GENERATION

Sends a prompt (system + user) to a language model and receives a generated text response.

- **Input contract:** `{ systemPrompt: string, userPrompt: string, options?: { maxTokens?: number, temperature?: number, responseFormat?: 'text' | 'json' } }`
- **Output contract:** `{ response: string, model: string, inputTokens: number, outputTokens: number, latencyMs: number }`
- **Current consumers:** All five agents (OCR Extraction, Product Import, Product Matching, Business Advisor, Prompt Management), Strategic Advisor
- **Future consumers:** Any new agent created via the agent creation protocol in CLAUDE.md

---

## 5. Service Intent Registry

### 5.1 Schema

The registry is a PostgreSQL table that maps each specific task to an active provider and model, with configuration and fallback.

```
Table: ai_service_registry

  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid()
  intent          TEXT        NOT NULL    CHECK (intent IN ('EMBEDDING', 'RERANKING', 'TEXT_GENERATION'))
  task_key        TEXT        NOT NULL    UNIQUE
  description     TEXT        NOT NULL
  provider        TEXT        NOT NULL
  model           TEXT        NOT NULL
  config          JSONB       NOT NULL DEFAULT '{}'
  fallback_provider TEXT      NULL
  fallback_model  TEXT        NULL
  is_active       BOOLEAN     NOT NULL DEFAULT true
  cost_per_unit   DECIMAL     NULL
  cost_unit       TEXT        NULL
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Note: This table is platform-level, not tenant-level. It is NOT subject to RLS. All tenants use the same AI service configuration. Model selection is a platform governance decision, not a tenant decision.

### 5.2 Initial Registry Configuration (Target State)

| intent | task_key | provider | model | rationale |
|---|---|---|---|---|
| TEXT_GENERATION | ocr_extraction | anthropic | claude-sonnet-4-20250514 | Complex document understanding requires strong reasoning |
| TEXT_GENERATION | product_classification | anthropic | claude-sonnet-4-20250514 | Classification accuracy critical for pipeline integrity |
| TEXT_GENERATION | product_match_decision | anthropic | claude-sonnet-4-20250514 | Human-approval-gate decisions require high accuracy |
| TEXT_GENERATION | business_advisor | anthropic | claude-sonnet-4-20250514 | Business reasoning requires strong model |
| TEXT_GENERATION | strategic_advisor | anthropic | claude-sonnet-4-20250514 | Highest reasoning quality for strategic insights |
| TEXT_GENERATION | invoice_field_validation | TBD | TBD | Candidate for cost optimisation with cheaper model |
| TEXT_GENERATION | prompt_management | anthropic | claude-sonnet-4-20250514 | Prompt evolution requires strong meta-reasoning |
| EMBEDDING | product_matching | TBD | TBD | Pending provider evaluation — Cohere, Voyage AI, or OpenAI |
| EMBEDDING | cross_tenant_similarity | TBD | TBD | Same provider as product_matching for vector space consistency |
| RERANKING | advisor_context | TBD | TBD | Pending provider evaluation — Cohere or Voyage AI |

Tasks marked TBD require benchmarking against RetailEdgeAI's real data before provider selection. See Section 9 (Evaluation Protocol).

---

## 6. Provider Adapters

### 6.1 Adapter Contract

Each provider adapter is a single file in `src/services/ai/adapters/` that exports three functions (one per intent). If a provider does not support an intent, the function throws a clear error.

```
Module: adapters/{provider}.js

  async embed(text, model, config)     → { vectors, tokenCount }
  async rerank(query, documents, model, config) → { results }
  async generate(systemPrompt, userPrompt, model, config) → { response, inputTokens, outputTokens }
```

Each adapter is responsible for:
- Authenticating with the provider (API key from environment variables)
- Translating the common contract input into the provider's API format
- Calling the provider's API
- Translating the provider's response back into the common contract output
- Throwing standardised errors on failure (see Section 6.3)

### 6.2 Adapter Inventory

| Adapter file | Provider | Supported intents | Status |
|---|---|---|---|
| `anthropic.js` | Anthropic (Claude) | TEXT_GENERATION | To be built (Step 1 — refactor existing calls) |
| `cohere.js` | Cohere | EMBEDDING, RERANKING, TEXT_GENERATION | To be built (Step 2 — first new provider) |
| `voyageai.js` | Voyage AI | EMBEDDING, RERANKING | Future — pending evaluation |
| `openai.js` | OpenAI | EMBEDDING, TEXT_GENERATION | Future — pending evaluation |
| `mistral.js` | Mistral AI | EMBEDDING, TEXT_GENERATION | Future — pending evaluation |
| `jina.js` | Jina AI | EMBEDDING, RERANKING | Future — if self-hosting becomes viable |

### 6.3 Error Handling Standard

All adapters must throw errors using a common structure:

```
{
  code: 'PROVIDER_TIMEOUT' | 'PROVIDER_RATE_LIMIT' | 'PROVIDER_AUTH_FAILURE' |
        'PROVIDER_MODEL_NOT_FOUND' | 'PROVIDER_INVALID_INPUT' | 'PROVIDER_UNAVAILABLE',
  provider: string,
  model: string,
  message: string,
  retryable: boolean
}
```

The Service Router uses the `retryable` flag and `code` to decide whether to attempt the fallback provider or surface the error.

---

## 7. AI Service Router

### 7.1 Responsibilities

The router (`src/services/ai/aiServiceRouter.js`) is the single entry point for all AI service consumption in the application. It:

1. Accepts an intent + task_key + input payload
2. Queries the registry for the active provider, model, and config
3. Loads the corresponding adapter
4. Executes the call through the adapter
5. Logs the call via the Governance Layer (Section 8)
6. On failure, checks for a fallback provider and retries if available
7. Returns the normalised response to the caller

### 7.2 Public API

The router exposes three convenience methods that map to the three intents:

```
const aiService = require('./aiServiceRouter');

// Embedding
const { vectors } = await aiService.embed('product_matching', productName);

// Reranking
const { results } = await aiService.rerank('advisor_context', query, candidateDocs);

// Text Generation
const { response } = await aiService.generate('strategic_advice', systemPrompt, userPrompt);
```

Application code calls these methods. Application code never references a provider or model name. The task_key is the only coupling point, and task_keys are stable identifiers defined in this document.

### 7.3 Registry Caching

The router caches the registry in memory with a configurable TTL (default: 5 minutes). This means registry changes take effect within 5 minutes without requiring a restart. For immediate effect (e.g., emergency provider swap during an outage), a cache-clear endpoint or PM2 restart can be used.

### 7.4 Fallback Behaviour

When the primary provider fails with a retryable error:

1. Router logs the primary failure
2. Router checks the registry for fallback_provider and fallback_model
3. If a fallback exists, router loads the fallback adapter and retries
4. If the fallback also fails, router throws the error to the caller
5. Both the primary failure and fallback attempt are logged

Fallbacks are optional per task. Some tasks (e.g., strategic_advisor) may have no acceptable fallback — if Claude is down, it's better to tell the user the advisor is temporarily unavailable than to serve lower-quality advice from a weaker model.

---

## 8. Governance Layer

### 8.1 Call Logging

Every AI service call is logged to a PostgreSQL table for cost tracking, performance monitoring, and provider comparison.

```
Table: ai_service_log

  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid()
  tenant_id       UUID        NULL (NULL for platform-level calls)
  intent          TEXT        NOT NULL
  task_key        TEXT        NOT NULL
  provider        TEXT        NOT NULL
  model           TEXT        NOT NULL
  is_fallback     BOOLEAN     NOT NULL DEFAULT false
  input_tokens    INTEGER     NULL
  output_tokens   INTEGER     NULL
  latency_ms      INTEGER     NOT NULL
  estimated_cost  DECIMAL     NULL
  status          TEXT        NOT NULL CHECK (status IN ('success', 'failure', 'fallback_success'))
  error_code      TEXT        NULL
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

This table IS subject to RLS for tenant_id-based queries (tenant can see their own usage), but platform-level aggregation queries bypass RLS for governance reporting.

### 8.2 Cost Estimation

Each registry entry includes `cost_per_unit` and `cost_unit` (e.g., cost_per_unit: 0.10, cost_unit: 'per_million_tokens'). The governance layer uses these plus actual token counts to estimate cost per call. This feeds into:

- Per-tenant usage tracking (for tiered subscription enforcement)
- Platform-level cost monitoring (for margin management)
- Provider comparison reports (for swap decisions)

### 8.3 Provider Comparison Dashboard (Future)

Using the ai_service_log data, build a dashboard showing per-task_key:
- Average latency by provider
- Error rate by provider
- Estimated cost by provider
- Token efficiency (output quality per token spent — requires manual sampling)

This data informs registry update decisions and is logged in DECISIONS_LOG.md when changes are made.

---

## 9. Evaluation Protocol for New Providers/Models

Before updating the registry to point a task at a new provider or model, the following evaluation must be completed:

### 9.1 Benchmark Against Real Data

- Extract a sample of 200+ real records from the relevant pipeline stage (e.g., 200 invoice line items for product_matching embedding evaluation)
- Run the sample through both the current provider and the candidate provider
- Compare results on task-specific metrics:
  - EMBEDDING: Match accuracy (does the nearest vector correspond to the correct product?), pack-size/variant discrimination, latency
  - RERANKING: Top-5 relevance (are the right documents in the top 5?), latency
  - TEXT_GENERATION: Output quality (manual review of 50 sample outputs), token efficiency, latency

### 9.2 Cost Modelling

- Calculate monthly cost at current volume using the candidate's pricing
- Calculate projected cost at 10x volume (growth planning)
- Compare against current provider

### 9.3 Integration Testing

- Build the adapter
- Run the full pipeline test suite with the registry pointed at the new provider
- Verify all existing smoke tests pass

### 9.4 Decision Logging

Log the evaluation outcome in DECISIONS_LOG.md with:
- Decision: Which provider/model was selected for which task_key
- Rationale: Benchmark results, cost comparison, quality assessment
- Risk: Any trade-offs accepted (e.g., "Voyage AI embeddings are 8% more accurate but 3x more expensive — accepted because product matching accuracy directly impacts human review queue size")
- Rollback: "Revert registry row to previous provider" (always one-row change)

---

## 10. Implementation Sequence

### Step 1: Foundation (Before Adding Any New Provider)

- Create the `ai_service_registry` table (migration via `prisma migrate diff`)
- Create the `ai_service_log` table
- Build the Service Router (`aiServiceRouter.js`)
- Build the Anthropic adapter (`adapters/anthropic.js`)
- Refactor all existing Claude API calls across agents to go through the router
- Populate registry with current Anthropic configuration for all existing tasks
- Verify: All existing functionality works identically through the new routing layer

**Outcome:** Zero behaviour change, but the abstraction is in place.

### Step 2: First New Provider (Cohere)

- Build the Cohere adapter (`adapters/cohere.js`)
- Run evaluation protocol (Section 9) for EMBEDDING on product_matching
- Run evaluation protocol for RERANKING on advisor_context
- Add pgvector extension to PostgreSQL, create embedding storage tables
- Add registry rows for Cohere tasks
- Integrate embedding layer into CatalogMatcher as 6th confidence signal
- Integrate reranking into advisor agent context retrieval

**Outcome:** Product matching improves, advisor quality improves, costs are tracked.

### Step 3: Optimisation

- Evaluate cheaper TEXT_GENERATION models for high-volume/low-complexity tasks
- Run evaluation protocol for invoice_field_validation with Cohere Command R or Mistral
- If benchmarks pass, update registry to route low-complexity tasks to cheaper models

**Outcome:** Claude token costs reduce without quality degradation on simple tasks.

### Step 4: Ongoing Evolution

- Monitor ai_service_log for performance trends
- When new models launch (e.g., Cohere Embed v5, Voyage 4, new Claude model), run evaluation protocol
- Update registry rows as improvements are validated
- Log every change in DECISIONS_LOG.md

---

## 11. Relationship to Existing Architecture Components

| Existing Component | Relationship to ASAL |
|---|---|
| **agentRegistry.js** | Agents are registered in agentRegistry. Each agent consumes AI services through ASAL. The agent knows its task_keys; ASAL knows which provider fulfils them. |
| **Prompt Assembly Engine** | Assembles the prompts that are passed to ASAL's TEXT_GENERATION intent. ASAL routes the assembled prompt to the right model. |
| **Signal Collector / Suggestion Engine** | Monitors agent performance. ASAL's call logs feed additional signal data (latency, cost, error rate) into the Signal Collector. |
| **ConfidenceScorer** | Currently has 5 signal groups. Embedding similarity (via ASAL EMBEDDING intent) becomes the 6th signal group. |
| **AuditLogger** | Existing audit trail for pipeline decisions. ASAL's governance layer logs at the AI-call level; AuditLogger logs at the business-decision level. They complement each other. |
| **RLS Policies** | ai_service_registry is platform-level (no RLS). ai_service_log includes tenant_id and is subject to RLS for tenant-facing queries. |
| **CLAUDE.md Agent Creation Protocol** | Updated to require: "All new agents must consume AI services exclusively through aiServiceRouter. Direct provider SDK imports are prohibited." |

---

## 12. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Abstraction adds latency overhead | Low | Low | Router logic is in-memory registry lookup + function dispatch — adds <1ms per call |
| Registry misconfiguration routes task to wrong model | Medium | High | Registry changes require DECISIONS_LOG.md entry. Smoke tests validate all task_keys on deployment. |
| New provider adapter has subtle output differences | Medium | Medium | Evaluation protocol (Section 9) catches this before registry update. Fallback to previous provider is one-row revert. |
| Over-abstraction — building adapters for providers never used | Low | Low | Only build adapters when evaluation protocol confirms a provider will be adopted. No speculative adapters. |
| Provider API breaking changes | Medium | Medium | Adapters isolate the impact. Only the affected adapter file needs updating, not application code. |

---

## 13. Environment Variables

ASAL requires provider API keys to be available as environment variables. The router does not store or manage keys — adapters read them from the environment.

```
# Existing
ANTHROPIC_API_KEY=sk-ant-...

# Added when Cohere is adopted
COHERE_API_KEY=...

# Added when future providers are adopted
VOYAGE_API_KEY=...
OPENAI_API_KEY=...
MISTRAL_API_KEY=...
JINA_API_KEY=...
```

Keys are managed via the DigitalOcean droplet's environment configuration and PM2 ecosystem file. They are never stored in the database, in code, or in version control.

---

## 14. Success Criteria

ASAL is considered successfully implemented when:

1. Zero direct provider SDK imports exist in agent or pipeline code — all AI calls route through `aiServiceRouter.js`
2. Swapping a provider for any task_key requires only a registry row update and (if new provider) an adapter file
3. ai_service_log provides per-task cost, latency, and error rate data sufficient to inform provider decisions
4. Fallback routing is tested and functional for all critical task_keys
5. The evaluation protocol has been exercised at least once for a real provider comparison

---

*This document is a living component of ARCHITECTURE_STATE.md. Updates to this section must be accompanied by a corresponding entry in DECISIONS_LOG.md.*