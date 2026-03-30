# Architecture State — RetailEdgeAI
## Last verified: 2026-03-29

This document reflects what is ACTUALLY built and deployed right now. Not planned, not discussed — only what exists in the code today. It will be regenerated periodically.

---

### System overview

RetailEdgeAI is a Node.js (ES Modules) monorepo with a React 19 SPA frontend and an Express 5 API backend. The database is PostgreSQL 16 running in Docker (Alpine image, external port 5433). The production server is a single DigitalOcean instance running PM2 (`retailedge-api` service on port 3000) behind Nginx (port 80, no HTTPS configured). Nginx proxies `/api/*` to the Node.js backend and serves the React SPA (`client/dist`) with fallback routing for all other paths. Deployment is a manual bash script (`deploy.sh`) that runs `npm install`, `prisma migrate deploy`, builds the client, and restarts PM2. There is no CI/CD pipeline, no staging environment, and no rollback mechanism. All AI API calls currently go directly to Anthropic's Claude API via trackedClaudeCall() in apiUsageTracker.js. An AI Service Abstraction Layer (ASAL) is planned to decouple agent code from provider specifics, enabling multi-provider routing via a central database registry (see ASAL section below).

---

### Database schema summary

The Prisma schema contains 40+ models across ~1440 lines. Below, each model lists whether it has a PostgreSQL Row-Level Security policy (RLS) and whether it is in the Prisma `$extends` tenant-scoped set (App Scope).

#### Tenant management
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| Tenant | Root entity for each business account | Yes | No (is the tenant) |
| User | Authentication, role assignment. tenantId nullable for SYSTEM_ADMIN | Yes | Yes |
| PlatformSettings | Singleton (id="singleton") for global config: trial days, lock policy | No | No (global) |
| TenantAccessLog | Records lock/unlock/register events | No | No |

#### Products and catalog
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| Product | Core product record with soft-delete (archivedAt), fingerprint, import pipeline fields | Yes | Yes |
| ProductVariant | Store-level SKU with Shopify variant IDs, pricing | No (child of Product via FK) | No (child) |
| Store | POS or ecommerce store, typed as POS/ECOMMERCE | Yes | Yes |

#### Suppliers and invoices
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| Supplier | Supplier master with GST preferences | Yes | Yes |
| Invoice | Invoice header with status pipeline, soft-delete | Yes | Yes |
| InvoiceLine | Line items with pack size parsing, GST allocation, freight allocation | No (child of Invoice, cascade delete) | No (child) |
| InvoiceLineMatch | Links invoice lines to products/variants with confidence, pricing, export status | No (child of InvoiceLine, cascade delete) | No (child) |
| SupplierProductMapping | Learned associations between supplier descriptions and products | No (child of Supplier) | No (child) |

#### Pricing
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| PricingRule | Margin targets, rounding, price-jump caps. Scoped: GLOBAL/CATEGORY/SUPPLIER/PRODUCT | Yes | Yes |

#### Import templates
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| ImportTemplate | Saved column mappings per source system per tenant | Yes | Yes |

#### Gmail integration
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| GmailIntegration | OAuth/IMAP credentials (encrypted), polling config, sender whitelist | No | Yes |
| GmailImportLog | Three-layer dedup log (messageId, fileHash, invoice identity) | No | Yes |

#### Folder polling integration
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| FolderIntegration | Local/UNC folder path, polling config. One per tenant (unique tenantId) | No | No |
| FolderImportLog | Three-layer dedup log for folder imports | No | No |

#### Shopify integration
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| ShopifyIntegration | OAuth token (encrypted), shop domain, sync timestamps, dismissed variants JSON | No | Yes |
| ShopifyImportLog | Sync history with product/order counts, duration, errors | No | Yes |
| ShopifyOrder | Synced order headers with financial/fulfillment status | No | No |
| ShopifyOrderLine | Order line items linked to ProductVariant by shopifyVariantId/SKU | No | No |

#### Google Drive integration
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| DriveIntegration | OAuth credentials (encrypted), folder ID, polling config | No | Yes |
| DriveImportLog | Three-layer dedup log for Drive imports | No | Yes |

#### Competitor intelligence
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| CompetitorMonitor | Tracks competitor + product + URL for price scraping | No | Yes |
| CompetitorPrice | Price observations with special/unit price tracking | No | Yes |
| PriceAlert | Alerts: undercut, margin squeeze, cost increase, opportunity | No | No |

#### Business AI chat
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| Conversation | Chat sessions with cost tracking, resolution status, topic tags | Yes | Yes |
| Message | Individual messages with token counts, cost, feedback rating | No (child of Conversation, cascade delete) | No (child) |

#### Plan tiers and features
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| Feature | Feature definitions (key, name, category, isCore) | No | No (global) |
| PlanTier | Subscription plans with pricing | No | No (global) |
| PlanTierFeature | Many-to-many join: which features in which plan | No | No (global) |
| PlanTierLimit | Per-plan numeric limits (max_users, max_invoice_pages) | No | No (global) |

#### API usage tracking
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| ApiUsageLog | Every Claude API call: tokens, cost, duration, status | No | No |
| AuditLog | Business action audit trail with trigger source tracking | Yes | Yes |

#### Legacy prompt system
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| AgentType | Agent definitions (ocr_extraction, product_matching) | No | No (global) |
| PromptTemplate | Versioned prompt templates per agent | No | No (global) |
| PromptCondition | Individual rules within a template, with validation keys | No | No (global) |
| TenantPromptOverride | Tenant add/remove/replace actions on conditions | No | No |
| PromptConflict | Detected contradictions between tenant and generic conditions | No | No |
| PromptChangeLog | Audit trail for prompt modifications | No | No |

#### Prompt evolution system
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| AgentRole | Agent definitions for evolution system (parallel to AgentType) | No | No (global) |
| PromptBaseVersion | Versioned base prompts with parent lineage, performance snapshots | No | No (global) |
| TenantPromptConfig | Structured tenant customization (tone, instructions, terminology, escalation) | No | No |
| TenantFewShotExample | Auto-curated or manual examples with quality scores | No | No |
| InteractionSignal | Interaction metrics: resolution, satisfaction, overrides, cost, latency | No | No |
| PromptSuggestion | AI-generated improvement proposals with approval workflow | No | No |
| PromptAuditLog | Audit trail for evolution system changes | No | No |

#### Product import pipeline
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| GlobalSourceRegistry | System-level import source definitions (Shopify, WooCommerce, etc.) | No | No (global) |
| TenantSourceRegistry | Tenant-customized source configs with webhook secret | No | Yes |
| ImportJob | Tracks a single import run: status, row counts, errors, timing | No | Yes |
| ApprovalQueueEntry | Human review queue with risk levels, confidence, dual approval support | No | Yes |
| ProductImportRecord | Per-row import data: raw, normalized, fingerprint, match result | No | Yes |

#### AI Service Abstraction Layer
| Model | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| AiServiceRegistry | Maps task_key to provider, model, config. Platform-level routing configuration | No (platform-level) | No (platform-level) |
| AiServiceLog | Logs every AI service call with intent, task_key, provider, tokens, latency, cost | No (platform-level) | No |
| ProductEmbedding | Stores product embedding vectors (pgvector) for semantic matching. One embedding per product per model | No | Yes |

**Summary:** 10 tables have RLS policies (Tenant, User, Store, Product, Supplier, Invoice, PricingRule, AuditLog, ImportTemplate, Conversation). 23 tables are in the Prisma $extends scoped set (including ProductEmbedding). 34 tables have a tenantId column (plus AiServiceLog which has a nullable tenantId for cross-tenant platform queries). The gap between "has tenantId" and "has RLS + app scoping" represents models that rely on only one layer of protection or on manual filtering by calling code. AiServiceRegistry and AiServiceLog are intentionally platform-level with no RLS — they are accessed via basePrisma for cross-tenant admin queries.

---

### Agent registry

The agent registry (`agentRegistry.js`) is an in-memory `Map`. Only **one** agent has actually called `registerAgent()`:

| Key | Name | Description | Status |
|-----|------|-------------|--------|
| `product_import_pipeline` | Product Import Pipeline | AI-assisted product import with duplicate detection, confidence scoring, and human approval gate | Registered in `importJobService.js`. Functional — 9 pipeline stages wired and executable via `/api/v1/products/import/confirm`. |

The following agents exist as functional service code but are **not registered** in the agent registry:

| Agent | Service file | Functional? |
|-------|-------------|-------------|
| OCR Extraction | `services/ocr.js` | Yes — extracts invoice data via Claude Vision |
| Product Matching | `services/matching.js` | Yes — four-tier matching with AI fallback |
| Business Advisor | `services/agents/orchestrator.js` | Yes — agentic tool-use loop with 10 read-only tools |
| Prompt Management | `services/promptChatAgent.js` | Yes — chat-driven prompt customization |
| Product Import (smart) | `services/agents/productImportAgent.js` | Yes — conversational AI analysis + deterministic import |

The CLAUDE.md protocol requires every agent to register, but only the pipeline agent follows this protocol. The other four agents predate the registry and were never retrofitted.

### AI Service Abstraction Layer (ASAL)

**Status: Planned — not yet implemented.**

ASAL will decouple all AI API calls from provider-specific code. Currently, every agent calls `trackedClaudeCall()` directly, coupling application code to the Anthropic SDK.

#### Current state (pre-ASAL)

All AI calls flow through a single path:

```
Agent code → trackedClaudeCall() → Anthropic SDK → Claude API
```

The `trackedClaudeCall()` function in `apiUsageTracker.js` is the single gateway. It handles API call execution, token counting, cost estimation (hardcoded Anthropic pricing), and fire-and-forget logging to `ApiUsageLog`. Every agent imports and calls this function directly.

**Files that make direct Anthropic API calls via trackedClaudeCall:**

| File | Endpoint tag | Purpose |
|------|-------------|---------|
| `services/ocr.js` | `ocr` | Invoice OCR extraction |
| `services/matching.js` | `product_matching` | AI fallback for unmatched invoice lines |
| `services/agents/orchestrator.js` | `advisor_tool`, `advisor_stream` | Business Advisor tool rounds + streaming |
| `services/agents/productImportAgent.js` | `product_import` | File analysis and chat |
| `services/promptChatAgent.js` | `prompt_management` | Prompt customisation chat |
| `services/promptConflictDetector.js` | `conflict_detection` | Conflict detection (Haiku) |
| `services/suggestionEngine.js` | `suggestion_generation` | Suggestion generation (Haiku) |
| `services/metaOptimizer.js` | `meta_optimizer` | Cross-tenant analysis (Haiku) |

**Total: 8 files, all coupled to Anthropic.**

#### Target state (post-ASAL)

```
Agent code → aiServiceRouter.js → Registry lookup → Provider adapter → Provider API
                                                  ↘ ai_service_log (logging)
```

ASAL consists of four components:

1. **AI Service Registry** (`ai_service_registry` table) — maps each task_key to an active provider, model, and config. Platform-level, not tenant-level. Not subject to RLS.
2. **Provider Adapters** (`services/ai/adapters/*.js`) — one file per provider, exporting standardised `embed()`, `rerank()`, `generate()` functions.
3. **AI Service Router** (`services/ai/aiServiceRouter.js`) — single entry point. Looks up registry, loads adapter, executes call, handles fallback.
4. **Governance Layer** (`ai_service_log` table) — logs every AI call with intent, task_key, provider, model, tokens, latency, cost estimate, and tenant_id.

**Three service intents:**

| Intent | Contract input | Contract output | Current consumers |
|--------|---------------|----------------|-------------------|
| EMBEDDING | `{ text, options? }` | `{ vectors, tokenCount }` | None (planned for CatalogMatcher) |
| RERANKING | `{ query, documents, options? }` | `{ results: [{ index, relevanceScore, document }] }` | None (planned for advisor context) |
| TEXT_GENERATION | `{ systemPrompt, userPrompt, options? }` | `{ response, inputTokens, outputTokens }` | All 8 files listed above |

**Implementation sequence:**

| Step | What | Status |
|------|------|--------|
| Step 1 | Create registry table, log table, router, Anthropic adapter. Refactor existing calls. | Complete |
| Step 2 | Add Cohere adapter. Evaluate embeddings + reranking on real data. Integrate into invoice matching, product import pipeline, advisor reranking, and Shopify sync. | Complete |
| Step 3 | Route low-complexity TEXT_GENERATION tasks to cheaper models. | Not started |

#### Database tables (planned)

| Table | Purpose | RLS | App Scope |
|-------|---------|-----|-----------|
| ai_service_registry | Maps task_key → provider + model + config | No (platform-level) | No (platform-level) |
| ai_service_log | Logs every AI service call with cost, latency, tokens | No (platform-level, but includes tenantId for per-tenant queries) | No |

#### Active providers and task keys

| Task Key | Intent | Provider | Model | Consumer |
|----------|--------|----------|-------|----------|
| `ocr_extraction` | TEXT_GENERATION | anthropic | claude-sonnet-4-20250514 | `services/ocr.js` |
| `product_matching_ai` | TEXT_GENERATION | anthropic | claude-sonnet-4-20250514 | `services/matching.js` |
| `advisor_tool_round` | TEXT_GENERATION | anthropic | claude-sonnet-4-20250514 | `services/agents/orchestrator.js` |
| `advisor_stream` | TEXT_GENERATION | anthropic | claude-sonnet-4-20250514 | `services/agents/orchestrator.js` |
| `product_import_analysis` | TEXT_GENERATION | anthropic | claude-sonnet-4-20250514 | `services/agents/productImportAgent.js` |
| `prompt_management` | TEXT_GENERATION | anthropic | claude-sonnet-4-20250514 | `services/promptChatAgent.js` |
| `conflict_detection` | TEXT_GENERATION | anthropic | claude-haiku-4-5-20251001 | `services/promptConflictDetector.js` |
| `suggestion_generation` | TEXT_GENERATION | anthropic | claude-haiku-4-5-20251001 | `services/suggestionEngine.js` |
| `meta_optimizer` | TEXT_GENERATION | anthropic | claude-haiku-4-5-20251001 | `services/metaOptimizer.js` |
| `product_matching_embed` | EMBEDDING | cohere | embed-english-v3.0 | `services/matching.js`, `catalogMatcher.js`, `shopify.js` (via pipeline) |
| `advisor_context_rerank` | RERANKING | cohere | rerank-v3.5 | `services/agents/orchestrator.js` |
---

### API routes

Every route file, its path prefix, middleware chain, and purpose:

#### Public routes (no authentication)
| File | Path | Middleware | Purpose |
|------|------|-----------|---------|
| `routes/auth.js` | `/api/auth` | None | Register, login, get current user profile |
| Inline in `app.js` | `/api/gmail/oauth/callback` | None | Gmail OAuth redirect handler |
| Inline in `app.js` | `/api/connect/shopify/callback` | None | Shopify OAuth redirect handler (HMAC validated) |
| Inline in `app.js` | `/api/drive/oauth/callback` | None | Google Drive OAuth redirect handler |
| Inline in `app.js` | `/api/health` | None | Health check (returns `{status: 'ok'}`) |

#### Authenticated + tenant-scoped routes
| File | Path | Middleware | Purpose |
|------|------|-----------|---------|
| `routes/invoices.js` | `/api/invoices` | auth, tenantAccess, tenantScope | Invoice upload, OCR, matching, approval, export, Shopify price push |
| `routes/products.js` | `/api/products` | auth, tenantAccess, tenantScope | Product CRUD, category management |
| `routes/productImport.js` | `/api/product-import` | auth, tenantAccess, tenantScope | Smart import: upload, AI analysis, chat, test run, apply |
| `routes/pricing.js` | `/api/pricing-rules` | auth, tenantAccess, tenantScope | Pricing rule CRUD |
| `routes/stores.js` | `/api/stores` | auth, tenantAccess, tenantScope | Store CRUD |
| `routes/agents.js` | `/api/agents` | auth, tenantAccess, tenantScope | Agent dashboard: status, pending decisions, activity feed, usage |
| `routes/connect.js` | `/api/connect` | auth, tenantAccess, tenantScope | POS/ecommerce connection wizard (mock/placeholder — in-memory only) |
| `routes/prompts.js` | `/api/prompts` | auth, tenantAccess, tenantScope | Tenant prompt configuration viewing |
| `routes/promptChat.js` | `/api/prompt-chat` | auth, tenantAccess, tenantScope | Chat-driven prompt customization |
| `routes/suggestions.js` | `/api/suggestions` | auth, tenantAccess, tenantScope | View/trigger/review prompt suggestions |

#### Plan-gated routes (authenticated + tenant-scoped + feature check)
| File | Path | Feature Key | Purpose |
|------|------|-------------|---------|
| `routes/gmail.js` | `/api/gmail` | `email_integration` | Gmail/IMAP connection, polling, import logs |
| `routes/folder.js` | `/api/folder-polling` | `folder_polling` | Local folder connection, polling, import logs |
| `routes/shopify.js` | `/api/shopify` | `shopify_integration` | Shopify OAuth, product sync, order sync, variant matching, settings |
| `routes/drive.js` | `/api/drive` | `drive_integration` | Google Drive OAuth, folder selection, polling |
| `routes/competitor.js` | `/api/competitor` | `competitor_intelligence` | Competitor monitors, price scraping, alerts |
| `routes/chat.js` | `/api/chat` | `ai_advisor` | Business AI Advisor conversations (SSE streaming) |
| `routes/productImportV1.js` | `/api/v1/products` | `product_import` | Pipeline-based import with approval queue |

#### Admin routes (SYSTEM_ADMIN only, no tenant scope)
| File | Path | Purpose |
|------|------|---------|
| `routes/admin/overview.js` | `/api/admin/overview` | Platform dashboard stats |
| `routes/admin/tenants.js` | `/api/admin/tenants` | Tenant management: list, lock, unlock, details |
| `routes/admin/apiUsage.js` | `/api/admin/api-usage` | Cross-tenant API usage and cost analytics |
| `routes/admin/settings.js` | `/api/admin/settings` | Platform settings (trial days, lock policy) |
| `routes/admin/tiers.js` | `/api/admin/tiers` | Plan tier and feature management CRUD |
| `routes/admin/prompts.js` | `/api/admin/prompts` | Legacy prompt template management, conflict viewer |
| `routes/admin/metaOptimizer.js` | `/api/admin/meta-optimizer` | Cross-tenant optimizer: run, candidates, activate, rollback, audit |

**Total: 24 route files, ~30 path prefixes.**

---

### Integration status

#### Shopify — Functional
- **OAuth flow:** Working (authorization code grant, HMAC validation, CSRF-protected state).
- **Product sync:** Working. Pulls up to 2500 active products via REST API with cursor pagination. Identity matches (shopifyVariantId → barcode) auto-apply with immediate variant processing. All other unmatched products route through the import pipeline for source-aware matching (CatalogMatcher with Fuse.js + embedding), confidence scoring, and human review via the approval queue. Post-approval integration hook processes Shopify variants.
- **Order sync:** Working. Incremental pull using `created_at_min`, links order lines to variants via shopifyVariantId or SKU.
- **Price push:** Working but fire-and-forget. Pushes approved prices to Shopify on invoice export. No retry, no user-visible success/failure feedback.
- **Variant matching:** Working. Auto-matches via SKU → barcode → fuzzy title, with dismiss capability.
- **CSV import:** Working. Separate code path from API sync. Detects Shopify format by headers, groups by Handle.
- **Known limitations:** 2500 product cap with no warning. Price push is sequential (no batching). Order sync misses refunds/updates. CSV imports don't set shopifyVariantId. Cost data not fetched from inventory_items API. First sync for a new tenant routes all products through the pipeline (no shopifyVariantId matches exist yet), which may queue products for review rather than creating them instantly.

#### Gmail — Functional
- **Connection types:** OAuth (Google API) and IMAP (app passwords) both implemented.
- **Polling:** Code exists but background scheduler is disabled. Must be triggered manually via UI ("Poll Now") or API.
- **Invoice import:** Fetches emails matching sender whitelist, extracts PDF/image attachments, runs OCR, creates invoices. Three-layer dedup.
- **Known limitations:** Polling is manual-only. No real-time push (no Gmail watch/push notifications).

#### Folder Polling — Functional
- **Connection:** Configures a local or UNC file path with file pattern filters.
- **Polling:** Code exists but background scheduler is disabled. Manual trigger only.
- **Import:** Scans folder for matching files, processes PDFs/images through OCR, moves to Processed subfolder.
- **Known limitations:** Same manual-polling limitation as Gmail. Requires server-level filesystem access.

#### Google Drive — Functional
- **OAuth flow:** Working with per-tenant credentials.
- **Polling:** Monitors a selected Drive folder for new files.
- **Import:** Downloads files, processes through OCR pipeline.
- **Known limitations:** Background scheduler disabled. Manual trigger only.

#### POS/Ecommerce Connection Wizard — Placeholder
- The `/api/connect` routes use an **in-memory Map** for storage with mock OAuth flows. No actual POS system (Square, Lightspeed, etc.) integration exists. This is a UI prototype only.

---

### Prompt system status

**Both systems are active simultaneously.** The fallback chain is:

```
Agent requests prompt
  → assemblePrompt() tries Evolution system (AgentRole → PromptBaseVersion → TenantPromptConfig)
    → If found: returns assembled prompt + metadata
    → If not found or error: falls back to Legacy system (promptComposer.js → AgentType → PromptTemplate → PromptCondition + TenantPromptOverride)
      → If not found or error: agent uses hardcoded FALLBACK_SYSTEM_PROMPT constant
```

**Which agents use which system:**

| Agent | Calls assemblePrompt()? | Has AgentRole seed? | Has AgentType seed? | Effective system |
|-------|------------------------|--------------------|--------------------|-----------------|
| OCR Extraction | Yes | Yes (`ocr_extraction`) | Yes | Evolution (primary) |
| Product Matching | Yes | Yes (`product_matching`) | Yes | Evolution (primary) |
| Business Advisor | Yes | Yes (`business_advisor`) | No | Evolution (primary) |
| Prompt Management | No — uses old getEffectivePrompt() | Yes (`prompt_management`) | Yes | Legacy (reads), Legacy (writes) |
| Product Import | No — inline prompt | Yes (`product_import`) | No | Hardcoded in analyzeFile() |

**Write paths:**
- The Prompt Management chat agent writes to the **legacy** system (TenantPromptOverride, PromptConflict, PromptChangeLog).
- The Suggestion Engine writes to the **evolution** system (PromptSuggestion).
- The Meta-Optimizer writes to the **evolution** system (PromptBaseVersion candidates, PromptAuditLog).
- There is no code that bridges the two — changes in one are invisible to the other.

---

### Pipeline stages

The product import pipeline (`importJobService.js`) executes 9 stages in order:

| Order | Stage | File | What it does |
|-------|-------|------|-------------|
| 1 | Source Resolver | `sourceResolver.js` | Infers source system from filename/headers, loads saved ImportTemplate |
| 2 | Normalisation Engine | `normalisationEngine.js` | 8-step text normalisation (Unicode, lowercase, punctuation, abbreviations, unit normalisation, token sort), GST stripping, name/size splitting |
| 3 | Fingerprint Engine | `fingerprintEngine.js` | Computes SHA-256 identity hash using 4-tier fallback (barcode → externalId+source → SKU+brand → name+brand+category) |
| 4 | Catalog Matcher | `catalogMatcher.js` | Four-layer matching against existing catalog: exact identity (fingerprint/barcode/SKU) → fuzzy semantic (Fuse.js) → embedding similarity (Cohere + pgvector) → cross-source barcode merge. Embedding matches always route to REVIEW. |
| 5 | Invoice Risk Analyser | `invoiceRiskAnalyser.js` | Assesses risk level (NONE through CRITICAL) for the import row |
| 6 | Confidence Scorer | `confidenceScorer.js` | Computes 0.0–1.0 confidence score with breakdown across 6 signal groups (Identity, Source, Completeness, Detector, Similarity Risk, Embedding Similarity) |
| 7 | Approval Classifier | `approvalClassifier.js` | Routes to ROUTE_AUTO, ROUTE_REVIEW, or ROUTE_REJECT based on confidence and risk |
| 8 | Write Layer | `writeLayer.js` | Persists products/variants to database, creates ProductImportRecord entries |
| 9 | Audit Logger | `auditLogger.js` | Creates AuditLog entries for every import action |

Note: Stages 5–7 (risk analyser, confidence scorer, approval classifier) were not read in detail during this audit. Their existence as files is verified; internal logic is unverified.

---

### Background jobs

| Job | Interval | File | Status |
|-----|----------|------|--------|
| Signal collector flush | 5 seconds | `signalCollector.js` | **Active** — started at boot via dynamic import in `app.js:175-177` |
| Conversation abandonment detector | 30 minutes | `conversationCleanup.js` | **Active** — started at boot via dynamic import in `app.js:179-182`. Marks stale conversations as abandoned/resolved and emits signals |
| Gmail polling scheduler | Configurable per tenant | `gmailScheduler.js` | **Disabled** — imported but commented out in `app.js:190-196` |
| Folder polling scheduler | Configurable per tenant | `folderScheduler.js` | **Disabled** — imported but commented out in `app.js:190-196` |
| Import session cleanup | 5 minutes | `productImportAgent.js:671` | **Active** — clears expired in-memory sessions (30-min TTL) via `setInterval().unref()` |
| Signal partial cleanup | 60 seconds | `signalCollector.js:294` | **Active** — removes stale partial signals older than 30 minutes |
| Chat rate limit cleanup | 5 minutes | `chatRateLimit.js:16` | **Active** — prunes expired sliding window entries from in-memory Map |
| Suggestion engine (daily) | Not scheduled | `suggestionEngine.js` | **Not scheduled** — must be triggered manually via `POST /api/suggestions/analyze` or `POST /api/admin/meta-optimizer/run`. No cron job exists |
| Meta-optimizer (weekly) | Not scheduled | `metaOptimizer.js` | **Not scheduled** — must be triggered manually via admin API. No cron job exists |

---

### Known gaps between BUSINESS_CONTEXT.md and current state

#### Features described as "Built" that have caveats

1. **Product Matching agent — listed as "Phase 3 in progress."** The matching service (`matching.js`) works for invoice lines. The import pipeline's `CatalogMatcher` works for product imports. But these are two separate implementations with different algorithms. There is no unified matching service.

2. **Business Advisor — listed as "Built (embryonic)."** Accurate. It queries raw data via 10 tools. It does not consume specialist agent outputs or synthesize cross-agent insights. It is a data lookup chatbot, not a strategic advisor.

3. **Prompt Management agent — listed as "Built."** Functional, but operates on the legacy prompt system only. It cannot manage evolution system configs (TenantPromptConfig), few-shot examples, or suggestion review.

#### Features required for beta that are not built

4. **"Sales data ingestion from e-commerce platform (order history, sales volumes, revenue by product)."** Shopify order sync exists and stores orders, but there is no sales analysis layer. The Business Advisor has no tool for querying Shopify orders or computing revenue by product. Order data is stored but not surfaced.

5. **"Basic demand forecasting from historical sales data (seasonal trends, product momentum, sales velocity)."** No demand forecasting code exists anywhere in the codebase. No Demand Forecast agent, no sales trend analysis, no velocity calculations.

6. **"Multi-tenant isolation is verified and complete (all tables have RLS)."** Only 10 of 34 tenant-scoped tables have RLS policies. The rest rely on application-level scoping alone (and some lack even that — see schema summary above).

7. **"Admin dashboard shows per-agent and per-tenant usage and cost data."** The admin routes provide raw data endpoints. The frontend admin UI exists as HTML mockups (`mockups/admin-portal.html`) but it is unverified whether a functional React admin dashboard is built in the client.

8. **"Plan tiers and features are configurable through admin UI."** The API endpoints exist (`/api/admin/tiers`). Whether the admin UI exposes full CRUD for tiers, features, and limits is unverified from the backend alone.

9. **"The platform doesn't lose data silently."** Three fire-and-forget paths silently lose data: API usage logging, signal collection (200-signal buffer cap, in-memory only), and Shopify price push failures. See RISK-002 and RISK-003.

#### Features listed as planned that have zero implementation

10. **Labour Cost agent** — No code, no schema, no routes.
11. **Fixed Cost agent** — No code, no schema, no routes.
12. **Utilities Cost agent** — No code, no schema, no routes.
13. **Competitive Intelligence agent** — Schema and routes exist for price monitoring, but no scraping/analysis agent. The competitor tools are read-only lookups, not automated intelligence.
14. **Demand Forecast agent** — No code, no schema, no routes.
15. **Platform owner advisory (AI layer for product owner)** — Not built. Documented as "Not built" in BUSINESS_CONTEXT.md.
16. **Feature and support signal capture from agent conversations** — Not built. No conversation analysis for feature requests or pain points.
17. **Structured onboarding** — No guided onboarding flow exists. Registration creates a tenant and user; no questions about business type, competitors, or goals.
18. **Proactive insights engine** — The advisor is reactive only (answers questions). No scheduled analysis or proactive alert generation beyond competitor price alerts.

#### Architectural gaps relative to stated principles

19. **"Every new feature or agent should be built as a specialist module that plugs into the hierarchy."** Only 1 of 5 functional agents is registered in the agent registry. The OCR, Matching, Advisor, and Prompt Management agents do not participate in the registry, evolution auto-discovery, or cross-tenant learning.

20. **"The platform must be integration-agnostic at its core."** GST handling is hardcoded as Australian 10% throughout (OCR prompt, invoice processor, normalisation engine, product import agent). The stemmer and stop-word list are English/Australian-specific. No locale abstraction exists.

21. **"No core business logic should depend on a specific integration."** The invoice export route directly imports `pushPriceUpdate` from `services/shopify.js`. The matching engine uses `fuzzyNameScore` from a shared module, but variant matching logic in `shopify.js` imports it directly. There is no connector abstraction layer.

22. **"Approved suggestions need to actually change agent behavior."** The suggestion engine generates proposals, admins can approve them, but no code applies approved suggestions to TenantPromptConfig. The evolution feedback loop is open-ended — it generates intelligence but cannot act on it.

23. **"AI model providers should be treated like integrations — provider-agnostic at core."** All 8 files that make AI calls import trackedClaudeCall() directly, coupling to Anthropic's SDK and pricing model. There is no abstraction layer, no fallback provider, and no mechanism to route different tasks to different providers. The planned ASAL addresses this but is not yet implemented. Cost tracking in ApiUsageLog uses hardcoded Anthropic pricing constants — adding a second provider would require modifying the tracking logic. Status: Implemented. ASAL Steps 1 and 2 are complete. All AI calls route through aiServiceRouter.js. Two providers active (Anthropic for text generation, Cohere for embedding and reranking). Cost tracking via ai_service_log table. The ApiUsageLog table receives dual-write entries during the transition period.
