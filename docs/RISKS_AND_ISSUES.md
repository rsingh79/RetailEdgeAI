# Risks and Issues Register — RetailEdgeAI

## How to use this file
This register tracks known risks, unresolved issues, and technical debt. Each entry links to the business outcome it threatens (from BUSINESS_CONTEXT.md) and the decision that introduced it (from DECISIONS_LOG.md). Review this file before each development phase. After each session, append new risks discovered during development.

Severity levels: **CRITICAL** (must fix before beta), **HIGH** (should fix before beta), **MEDIUM** (acceptable for beta with monitoring), **LOW** (future improvement).

Last updated: 2026-03-29 (post-Phase 5 review)

---

## CRITICAL — Must fix before beta launch

### RISK-001: Missing RLS policies on 24 of 34 tenant-scoped tables
- **Threatens:** Tenant isolation and data security (Outcome 5)
- **Source decision:** PostgreSQL Row-Level Security as defense-in-depth
- **Detail:** Architecture state audit confirms only 10 of 34 tenant-scoped tables have RLS policies (Tenant, User, Store, Product, Supplier, Invoice, PricingRule, AuditLog, ImportTemplate, Conversation). The remaining 24 tables — including ShopifyOrder, ShopifyOrderLine, ImportJob, ProductImportRecord, ApprovalQueueEntry, all four integration tables, all four import log tables, CompetitorMonitor, CompetitorPrice, PriceAlert, and all prompt evolution tables — have no RLS. Of these, 22 are in the Prisma $extends scoped set (application-layer protection), but FolderIntegration, FolderImportLog, ShopifyOrder, ShopifyOrderLine, ApiUsageLog, TenantAccessLog, and all prompt evolution models lack even application-level scoping.
- **Impact:** If application-level scoping has a bug or a query is written without tenant filtering, data from one tenant could be returned to another. This is the single highest-risk item for a multi-tenant SaaS handling financial data.
- **Recommended action:** Audit every table with a tenantId column. Confirm each has both an RLS policy and either Prisma extension scoping or guaranteed parent-FK isolation. Generate missing RLS migrations.
- **Status:** Open

### RISK-002: Fire-and-forget patterns silently losing data
- **Threatens:** Accurate landed cost (Outcome 1), Self-improving AI (Outcome 6)
- **Source decisions:** Signal collector uses buffered fire-and-forget; All agents share trackedClaudeCall; Price push is fire-and-forget
- **Detail:** Three critical data paths use fire-and-forget: (1) API usage logging — if the database write fails, usage is uncounted and tenants may exceed limits undetected. (2) Signal collection — in-memory buffer with 200-signal cap means burst events (batch imports) drop signals, and server crashes lose all buffered signals. (3) Shopify price push — failures are logged with console.warn but the user sees no indication that prices weren't pushed.
- **Impact:** Usage billing can be wrong. The prompt evolution system operates on incomplete signal data. Retailers may believe prices are live in Shopify when they aren't.
- **Recommended action:** For beta: add a simple "price push status" indicator to the export response so the frontend can show success/failure per variant. Add a failed-push retry mechanism or at minimum a "re-push" button. For signals: increase buffer cap or add a disk-based fallback. For usage logging: consider synchronous logging for the count check (can remain async for the full log record).
- **Status:** Open

### RISK-003: Shopify price push failures go unnoticed by users
- **Threatens:** Automated pricing with safety rails (Outcome 4)
- **Source decision:** Price push is fire-and-forget from the invoice export flow
- **Detail:** When invoice matches are exported, price pushes to Shopify are wrapped in .catch() — errors produce console.warn but no user-visible feedback. There is no retry mechanism, no queue, and no "re-push" UI. Sequential pushes (one API call per variant) compound rate limiting risk for large exports.
- **Impact:** A retailer approves new pricing, believes it's live in their store, but some or all prices failed to push. Customers see stale prices. The retailer has no way to know without manually checking Shopify.
- **Recommended action:** Return push results (success/fail per variant) in the export API response. Add a "push status" column to the match export view. Implement a batch retry endpoint. Consider batching variant updates via Shopify's GraphQL bulk mutation API.
- **Status:** Open

---

## HIGH — Should fix before beta launch

### RISK-004: Dual prompt system creates confusion and potential contradictions
- **Threatens:** Self-improving AI (Outcome 6), Reliable product matching (Outcome 2)
- **Source decisions:** Dual prompt management systems; Two prompt systems coexist with fallback chain; Prompt management agent operates on legacy system
- **Detail:** Two complete prompt systems coexist: Legacy (AgentType/PromptTemplate/PromptCondition, modified by the chat agent) and Evolution (AgentRole/PromptBaseVersion/TenantPromptConfig, modified by the suggestion engine). The Prompt Management chat agent writes to the legacy system while the Suggestion Engine writes to the evolution system. Changes in one are invisible to the other. The assembly engine tries the evolution system first, falls back to legacy — so silent fallback means the evolution system could be broken for weeks without anyone noticing.
- **Impact:** A tenant could make a customisation via the chat agent (legacy system) that contradicts a suggestion applied via the evolution system. The assembly engine's fallback chain determines precedence, but this is not transparent to the user or admin.
- **Recommended action:** For beta, pick one system as the source of truth and disable the other's write path. The evolution system is more capable but the legacy system has the working UI (chat agent). Recommended approach: keep the evolution system for assembly/reading but have the chat agent write to TenantPromptConfig (evolution) instead of TenantPromptOverride (legacy). This is a targeted migration, not a full rewrite.
- **Status:** Open

### RISK-005: Two disconnected dedup strategies for product imports
- **Threatens:** Clean product catalog (Outcome 3)
- **Source decisions:** Import dedup uses barcode-first then name+baseUnit fallback; Four-tier product fingerprinting
- **Detail:** The smart import agent (productImportAgent.js) uses a simple barcode → name+baseUnit dedup check in applyImport(). The pipeline (CatalogMatcher) uses four-tier fingerprinting with Fuse.js fuzzy matching. These are independent code paths that can produce different dedup decisions for the same product.
- **Impact:** A product imported via the smart import agent might be created as a new record, while the same product coming through the pipeline would be detected as a duplicate. Or vice versa. This leads to catalog inconsistency depending on which import path was used.
- **Recommended action:** Route the smart import agent's applyImport() through the pipeline's CatalogMatcher for dedup, or extract the pipeline's fingerprint-and-match logic into a shared service that both paths use. Don't maintain two independent dedup implementations.
- **Status:** Resolved (2026-03-30). Shopify sync now routes unmatched products through the shared import pipeline (CatalogMatcher with source-aware matching, Fuse.js, embedding, confidence scoring, and human review). The smart import agent's applyImport() path is retired via HTTP 410. Product-to-product dedup now uses a single shared process for all sources. Invoice line matching (matching.js) remains a separate flow by design — it matches invoice lines to products, not products to products.

### RISK-006: Approved suggestions are never actually applied
- **Threatens:** Self-improving AI (Outcome 6)
- **Source decision:** Prompt management agent remains silent during evolution
- **Detail:** The suggestion engine generates PromptSuggestion records. The admin can approve them (sets status: 'approved' and appliedAt). But no code path transforms an approved suggestion into an actual TenantPromptConfig change. The evolution feedback loop is incomplete — signals are collected, patterns detected, suggestions generated, but improvements are never applied.
- **Impact:** The evolution system appears functional but has no effect on actual AI behaviour. Admin time spent reviewing suggestions is wasted. The system accumulates approved-but-not-applied records with no indication that nothing changed.
- **Recommended action:** For beta: this is acceptable as long as it's clearly documented as "Phase 1 — manual implementation required." Add a note in the admin UI that approved suggestions need manual implementation. For post-beta: build an auto-applicator that maps suggestion types (ADD_INSTRUCTION, ADD_TERM, etc.) to TenantPromptConfig field updates.
- **Status:** Open — acceptable for beta with documentation

### RISK-007: In-memory session storage for product imports lost on restart
- **Threatens:** Accessible to non-technical users (Outcome 7)
- **Source decision:** Product Import Agent uses conversational AI analysis with deterministic execution
- **Detail:** The product import agent stores session state (analysis rules, conversation history, file data) in an in-memory Map with 30-minute TTL. A server restart or crash during an import session means the user must restart the entire import from scratch with no recovery option.
- **Impact:** On a single-server deployment, any server restart (deployment, crash, OS update) during an active import kills the session. Users lose their analysis and chat corrections.
- **Recommended action:** For beta: add a warning in the UI that imports should be completed in one session. For post-beta: persist session state to the database (the analysis rules and conversation history are JSON-serialisable).
- **Status:** Open — acceptable for beta with UI warning

### RISK-008: 2500-product cap on Shopify sync with no user warning

### RISK-021: No sales analysis tools in Business Advisor — blocks beta requirement
- **Threatens:** Data-driven demand planning (Outcome 11), Proactive strategic intelligence (Outcome 8)
- **Source:** Architecture state gap analysis (gap #4 and #5)
- **Detail:** Shopify order sync ingests and stores orders, but the Business Advisor has no tools to query this data. There is no revenue-by-product tool, no sales velocity calculation, no sales trend analysis, and no seasonal comparison. The advisor's 10 existing tools cover invoices, products, pricing, and competitors — but not sales. The beta definition requires "sales data ingestion from e-commerce platform" and "basic demand forecasting from historical sales data." The ingestion exists; the analysis layer does not.
- **Impact:** The Business Advisor cannot answer questions like "what are my top sellers this month?" or "how does this quarter compare to last?" — questions any business owner would expect an advisor to handle. This is a stated beta requirement.
- **Recommended action:** Build as the final beta deliverable. At minimum, add 3-4 new tools to the Business Advisor: sales by product/category over time, revenue trends, sales velocity (units per week/month), and basic period comparison (this month vs last month, this quarter vs same quarter last year). These follow the same pattern as existing advisor tools — tenant-scoped Prisma queries over ShopifyOrder/ShopifyOrderLine joined to Product. No new agent needed for beta; the tools live in the existing advisor's tool suite.
- **Status:** Open — deprioritised to final beta deliverable

### RISK-022: Only 1 of 5 agents registered in agent registry
- **Threatens:** Continuously improving AI (Outcome 6)
- **Source:** Architecture state — agent registry section
- **Detail:** Only the product import pipeline has called registerAgent(). OCR, Matching, Advisor, and Prompt Management agents predate the registry and were never retrofitted. Unregistered agents don't participate in the evolution system's auto-discovery, meaning the suggestion engine and meta-optimizer cannot iterate them.
- **Impact:** The evolution infrastructure exists but only covers one agent. The four most-used agents (OCR, matching, advisor, prompt management) don't benefit from automated prompt improvement.
- **Recommended action:** For beta: acceptable — the evolution system isn't actively applying suggestions anyway (RISK-006). For post-beta: add registerAgent() calls to all four agent files. This is a small code change per agent.
- **Status:** Open — acceptable for beta


- **Threatens:** Clean product catalog (Outcome 3)
- **Source decision:** Cursor-based pagination for Shopify product and order fetching
- **Detail:** Product sync fetches 250 per page, max 10 pages = 2500 products. If a store has more than 2500 active products, the sync silently stops. No warning is shown to the user. They may not know their catalog is incomplete.
- **Impact:** Retailers with larger catalogs get partial product data. Cost calculations and margin analysis are incomplete. The user has no way to know this is happening.
- **Recommended action:** Log a warning when the page limit is reached. Return a sync summary to the UI showing "synced X of Y products" (Shopify's response headers include total count). Increase the page limit or remove it — cursor pagination handles large result sets efficiently.
- **Status:** Open

---

## MEDIUM — Acceptable for beta with monitoring

### RISK-009: SYSTEM_ADMIN bypasses all access controls
- **Threatens:** Tenant isolation and data security (Outcome 5)
- **Source decision:** SYSTEM_ADMIN role bypasses all access controls
- **Detail:** A compromised SYSTEM_ADMIN JWT has unrestricted access to all tenant data with no audit trail at the middleware level. Admin tokens have the same 7-day expiry as regular tokens with no revocation mechanism.
- **Impact:** Low probability (limited admin accounts) but extremely high impact if exploited.
- **Recommended action:** For beta: limit admin accounts, use strong passwords, consider shorter JWT expiry for admin tokens. For post-beta: add admin action audit logging, implement token revocation, consider IP allowlisting for admin routes.
- **Status:** Open — acceptable for beta with limited admin accounts

### RISK-010: No token revocation mechanism
- **Threatens:** Tenant isolation and data security (Outcome 5)
- **Source decision:** JWT bearer tokens with 7-day expiry
- **Detail:** There is no way to invalidate a JWT before its 7-day expiry. Changing a user's role, locking a tenant, or detecting a compromised token cannot immediately block access. The tenantAccess middleware compensates by checking tenant lock status on every request, but role changes and user deactivation are not caught until the token expires.
- **Impact:** A fired employee or compromised account retains access for up to 7 days.
- **Recommended action:** For beta: reduce JWT expiry to 24 hours and add a token blacklist check (simple in-memory Set cleared on restart). For post-beta: implement refresh token flow with short-lived access tokens.
- **Status:** Open — acceptable for beta with shorter expiry

### RISK-011: Monthly API limiter has race condition
- **Threatens:** Accurate landed cost (Outcome 1) — indirectly, via uncontrolled costs
- **Source decision:** Two rate limiting systems
- **Detail:** The monthly API limit counts by querying ApiUsageLog records, but logging is fire-and-forget. Concurrent requests can pass the limit check before previous requests' usage is logged. The check also does a full count query on every gated request without caching.
- **Impact:** Tenants can slightly exceed their monthly limits. At beta scale (few tenants, low concurrency), this is unlikely to matter. At scale, it could allow significant overuse.
- **Recommended action:** For beta: acceptable as-is. For post-beta: use an atomic counter (Redis INCR or PostgreSQL advisory lock) instead of count-then-log.
- **Status:** Open — acceptable for beta

### RISK-012: Chat rate limit is in-memory and resets on restart
- **Threatens:** Tenant isolation and data security (Outcome 5) — via abuse prevention
- **Source decision:** Two rate limiting systems
- **Detail:** Per-minute chat rate limiting uses an in-memory Map. Server restart clears all rate limit state. Does not work across multiple servers.
- **Impact:** At beta scale (single server, few tenants), this is minor. Becomes a real issue at scale or if abuse occurs.
- **Recommended action:** Acceptable for beta. Move to Redis-backed rate limiting when scaling to multiple servers.
- **Status:** Open — acceptable for beta

### RISK-013: Shopify CSV import doesn't set shopifyVariantId
- **Threatens:** Clean product catalog (Outcome 3)
- **Source decision:** Separate Shopify CSV import path alongside API sync
- **Detail:** Products imported via Shopify CSV don't have shopifyVariantId set on their variants. If the tenant later connects Shopify OAuth for API sync, the sync can't deduplicate by variant ID and falls through to barcode/name matching, which is less reliable.
- **Impact:** Tenants who start with CSV and later connect OAuth may get duplicate products.
- **Recommended action:** During variant matching (matchVariants), if a match is found between a CSV-imported variant and a Shopify API variant, backfill the shopifyVariantId. This is a small code change with high dedup impact.
- **Status:** Open

### RISK-014: Order sync misses updates (refunds, fulfillment changes)
- **Threatens:** Accurate landed cost (Outcome 1) — indirectly, via incomplete sales data
- **Source decision:** Cursor-based pagination for Shopify product and order fetching
- **Detail:** Incremental order sync uses created_at_min from lastOrderSyncAt. Orders modified after creation (refunds, fulfillment status changes, line item edits) are not re-fetched in subsequent syncs.
- **Impact:** Margin analysis based on order data may not reflect refunded orders. Revenue figures could be overstated.
- **Recommended action:** For beta: document this limitation. For post-beta: add a secondary sync using updated_at_min to catch modified orders, or implement Shopify webhooks for order updates.
- **Status:** Open — acceptable for beta with documentation

### RISK-015: OCR fallback prompt can drift from database version
- **Threatens:** Reliable product matching (Outcome 2), Accurate landed cost (Outcome 1)
- **Source decision:** All agents use fallback prompts for resilience
- **Detail:** Each agent has a hardcoded FALLBACK_SYSTEM_PROMPT (OCR agent's is 77 lines). If the assembly engine silently fails and the fallback is used, the tenant gets the generic experience with no customisation and no indication that anything is wrong. The fallback prompts can drift from the database versions over time.
- **Impact:** If the evolution system is misconfigured, agents silently degrade to generic behaviour. Tenant-specific customisations (GST handling, domain terminology) stop working.
- **Recommended action:** Add a metric/alert when the fallback prompt is used. Log it as a warning that's visible in the admin dashboard, not just console.warn. Consider generating the fallback from the database on startup rather than hardcoding it.
- **Status:** Open — acceptable for beta

### RISK-016: Full product catalog sent to Claude in every AI batch match call
- **Threatens:** Accurate landed cost (Outcome 1) — via token limits causing match failures
- **Source decision:** Four-tier invoice line matching strategy with AI fallback
- **Detail:** The AI matching step sends the full product catalog to Claude in a single API call. This won't scale past a few thousand products due to context window token limits. Large catalogs could cause truncation or API failures.
- **Impact:** Tenants with large catalogs may get incomplete AI matching. No error is surfaced — unmatched lines simply get no AI suggestion.
- **Recommended action:** For beta: acceptable if beta tenants have small catalogs (under 1000 products). For post-beta: implement catalog chunking or pre-filtering (send only products in relevant categories to the AI call).
- **Status:** Open — acceptable for beta with small catalogs

### RISK-023: requiresSecondApproval flag stored but not enforced
- **Threatens:** Reliable product matching (Outcome 2), Clean product catalog (Outcome 3)
- **Source:** Architecture state — approval queue analysis; Decision: Approval queue with manual approve/reject
- **Detail:** HIGH-risk approval queue entries are created with `requiresSecondApproval: true`, but the approve route does not check this flag. Any single user can approve a HIGH-risk import entry. The dual-approval intent exists in the schema but is not enforced in code.
- **Impact:** Products that were flagged as requiring extra scrutiny (high invoice risk, low confidence) can be approved by a single user without the intended second review.
- **Recommended action:** For beta: acceptable if the team is small (likely just Rohan). For post-beta: enforce the flag — require a different user for second approval, or at minimum log a warning when a single user approves a dual-approval item.
- **Status:** Open — acceptable for beta

### RISK-024: POS connection wizard is a non-functional placeholder
- **Threatens:** Accessible to non-technical users (Outcome 7)
- **Source:** Architecture state — integration status section
- **Detail:** The `/api/connect` routes use an in-memory Map with mock OAuth flows. No actual POS system integration exists. The UI may present this as a functional connection wizard when it is purely a prototype.
- **Impact:** Low — Shopify is the real integration for beta. But if the UI exposes the wizard, users may attempt to connect non-Shopify systems and see confusing behaviour.
- **Recommended action:** Either hide the connection wizard from the UI for beta, or add a clear "coming soon" indicator for non-Shopify platforms.
- **Status:** Open — acceptable for beta with UI adjustment

### RISK-025: Single AI provider dependency (Anthropic) for all agent functionality

- **Threatens:** Accurate landed cost (Outcome 1), Reliable product matching (Outcome 2), Proactive strategic intelligence (Outcome 8) — all outcomes that depend on AI
- **Source:**  decision: Evaluate Cohere as first additional AI provider; AI Service Abstraction Layer
- **Detail:** All five functional agents, the product import pipeline's AI fallback, and the Business Advisor depend exclusively on Anthropic's Claude API. If Anthropic has an extended outage, rate limiting event, or pricing change, all AI-dependent functionality stops simultaneously. There is no fallback to an alternative provider for any AI task.
- **Impact:** At beta scale with few tenants, a temporary Anthropic outage is manageable — invoice processing pauses, advisor is unavailable. At scale, it could affect hundreds of tenants simultaneously with no degradation path. A pricing change could make the platform uneconomical overnight.
- **Recommended action:** ASAL Step 1 (refactoring existing Claude calls through the router) provides the infrastructure for fallback. ASAL Step 2 (adding Cohere) provides the first alternative for embeddings and reranking. For text generation fallback, evaluate Cohere Command R or Mistral as a degraded-quality alternative for non-critical tasks. For critical tasks (OCR extraction, strategic advice), accept single-provider dependency for beta but monitor Anthropic status proactively.
- **Status:** Partially resolved (2026-03-30). Cohere now handles EMBEDDING (product matching) and RERANKING (advisor context) tasks. TEXT_GENERATION remains Anthropic-only — all 9 text generation tasks use Claude. If Anthropic is unavailable, embedding and reranking still work (Cohere), but all agent reasoning stops. The ASAL router supports fallback providers per task — a future TEXT_GENERATION fallback (Cohere Command R or Mistral) could be configured via registry without code changes.

### RISK-026: ASAL registry misconfiguration could route tasks to wrong provider/model

- **Threatens:** Reliable product matching (Outcome 2), Accurate landed cost (Outcome 1)
- **Source:**  decision: AI Service Abstraction Layer
- **Detail:** The ai_service_registry table is a platform-level config that determines which AI provider handles every task. A misconfigured row — wrong model name, inactive provider, incompatible config JSON — could silently degrade quality or cause errors for all tenants simultaneously. Unlike per-tenant config (where one tenant is affected), registry errors are platform-wide.
- **Impact:** Medium probability (registry changes require deliberate action), high impact (affects all tenants). Example: pointing product_classification at a cheap model that lacks the reasoning quality for accurate classification, or pointing an embedding task at a text generation provider that doesn't support embeddings.
- **Recommended action:** Registry changes MUST be logged in DECISIONS_LOG.md with evaluation protocol results. Add a startup validation that verifies every active registry row has a loadable adapter and a valid model name. Add smoke tests that exercise every task_key on deployment. For beta: the registry will have few entries (only Anthropic and Cohere), limiting misconfiguration surface.
- **Status:** Open — mitigated by evaluation protocol and DECISIONS_LOG requirements

### RISK-027: Multi-provider cost tracking complexity

- **Threatens:** Platform self-awareness (Outcome 12)
- **Source:**  decision: AI Service Abstraction Layer; Evaluate Cohere as first additional AI provider
- **Detail:** The current ApiUsageLog and cost tracking system is built around Anthropic's pricing model (per-token input/output). Adding Cohere introduces different pricing units: per-token for embeddings, per-search for reranking. The ai_service_log table in ASAL handles this via flexible cost_per_unit and cost_unit fields, but the existing admin dashboard, usage limits, and per-tenant billing logic assume a single provider's pricing model. The two logging systems (ApiUsageLog for legacy, ai_service_log for ASAL) create dual sources of cost truth during the transition period.
- **Impact:**Low for beta (few tenants, costs are manageable). Becomes important at scale when per-tenant usage caps and billing need to account for costs across multiple providers with different pricing models.
- **Recommended action:** For beta: acceptable with manual cost monitoring. During ASAL Step 1, ensure the router logs to ai_service_log alongside the existing ApiUsageLog (don't remove the old logging until all consumers are migrated). For post-beta: build a unified cost dashboard that aggregates across providers using the ai_service_log's normalised cost estimates.
- **Status:** Open — acceptable for beta



### RISK-029: Shopify first sync routes all products through review pipeline

- **Threatens:** Accessible to non-technical users (Outcome 7)
- **Source:**decision: Shopify sync restructured to route unmatched products through import pipeline
- **Detail:**  On a tenant's first Shopify sync, no products have shopifyVariantId set in the local database, so layer 1 (identity match) finds nothing. If Shopify products lack barcodes, layer 2 also finds nothing. All products route through the import pipeline and may be queued for human review rather than created immediately. This changes the UX from "connect Shopify and products appear instantly" to "connect Shopify and products appear after review."
- **Impact:** New tenants connecting Shopify for the first time may be confused by products appearing in the approval queue rather than their product catalog. For tenants with barcoded products that were previously imported from another source, layer 2 will still auto-match.
- **Recommended action:**  For beta: add a clear UI message during first Shopify sync explaining that products are being verified and will appear after review. Consider auto-approving all products on first sync if the tenant has an empty catalog (no existing products to conflict with). For post-beta: implement a "trust first sync" option that auto-approves all products from the first sync run, then applies full review on subsequent syncs.
- **Status:** Open — acceptable for beta with UI messaging

---

## LOW — Future improvement

### RISK-017: deleteExisting cascade on Shopify CSV import destroys pricing history
- **Threatens:** Accurate landed cost (Outcome 1)
- **Source decision:** Separate Shopify CSV import path alongside API sync
- **Detail:** The CSV import deleteExisting option cascade-deletes all Shopify-sourced products, which removes invoice line matches and destroys pricing history.
- **Recommended action:** Add a confirmation dialog warning about data loss. Consider soft-delete (archive) instead of hard delete for the clean-start scenario.
- **Status:** Open

### RISK-018: PlatformSettings singleton limits future flexibility
- **Threatens:** N/A — operational concern
- **Source decision:** PlatformSettings as a singleton model
- **Detail:** Single-row design can't support region-specific or segment-specific settings if the platform expands beyond Australia.
- **Recommended action:** No action needed for beta. Revisit if expanding to other markets.
- **Status:** Open

### RISK-019: Background jobs use setInterval with no catch-up mechanism
- **Threatens:** Self-improving AI (Outcome 6)
- **Source decision:** Background jobs use setInterval with .unref()
- **Detail:** Signal flush (5s), conversation cleanup (30min) run via setInterval. Missed runs on restart have no catch-up. Gmail/folder polling is fully disabled (manual trigger only).
- **Recommended action:** Acceptable for beta. For post-beta: implement a lightweight job scheduler (node-cron or BullMQ) with at-least-once semantics.
- **Status:** Open

### RISK-020: Legacy plan fields coexist with new PlanTier system
- **Threatens:** N/A — technical debt
- **Source decision:** Feature gating via database-driven plan tiers
- **Detail:** Tenant model has legacy fields (plan, maxUsers, maxStores, maxApiCallsPerMonth) alongside the new planTierId FK. Dual sources of truth during migration.
- **Recommended action:** Remove legacy fields after confirming all code paths use the new PlanTier system.
- **Status:** Open

### RISK-028: pgvector extension availability on DigitalOcean managed PostgreSQL

- **Threatens:** Reliable product matching (Outcome 2) — specifically the embedding-based matching layer
- **Source decision:** Layered product matching pipeline; Evaluate Cohere as first additional AI provider
- **Detail:** The embedding-based matching layer requires pgvector for storing and querying product embedding vectors. DigitalOcean's managed PostgreSQL may or may not support the pgvector extension. If not, the platform would need to either self-manage PostgreSQL (losing managed DB benefits) or use an external vector database (adding infrastructure complexity).
- **Impact:** If pgvector is unavailable, the embedding matching layer cannot be implemented as designed. Alternative approaches (in-memory vector search, external vector DB like Pinecone/Weaviate) add complexity and cost.
- **Recommended action:** Verify pgvector support on DigitalOcean managed PostgreSQL before beginning ASAL Step 2. If unsupported, evaluate alternatives: (a) self-hosted PostgreSQL with pgvector on the existing droplet, (b) in-memory vector search using a lightweight library for small catalogues, (c) Cohere's own similarity endpoint as a fallback (no local vector storage needed).
- **Status:** Resolved (2026-03-30). pgvector 0.8.1 confirmed available and enabled on DigitalOcean managed PostgreSQL. ProductEmbedding table created with HNSW index (m=16, ef_construction=64, vector_cosine_ops). 500 products embedded and stored during evaluation. Ongoing embedding maintenance via embeddingMaintenance.js hooks on product create/update. 

### RISK-029: Shopify first sync routes all products through review pipeline

-**Threatens:** Accessible to non-technical users (Outcome 7)
- **Source decision:** Shopify sync restructured to route unmatched products through import pipeline
- **Detail:** On a tenant's first Shopify sync, no products have shopifyVariantId set in the local database, so layer 1 (identity match) finds nothing. If Shopify products lack barcodes, layer 2 also finds nothing. All products route through the import pipeline and may be queued for human review rather than created immediately. This changes the UX from "connect Shopify and products appear instantly" to "connect Shopify and products appear after review."
- **Impact:** New tenants connecting Shopify for the first time may be confused by products appearing in the approval queue rather than their product catalog. For tenants with barcoded products that were previously imported from another source, layer 2 will still auto-match.
- **Recommended action:** For beta: add a clear UI message during first Shopify sync explaining that products are being verified and will appear after review. Consider auto-approving all products on first sync if the tenant has an empty catalog (no existing products to conflict with). For post-beta: implement a "trust first sync" option that auto-approves all products from the first sync run, then applies full review on subsequent syncs.
- **Status:** Open — acceptable for beta with UI messaging

RISK-030: Dual AI logging (ApiUsageLog + ai_service_log) during ASAL transition

-**Threatens:** Platform self-awareness (Outcome 12)
- **Source decision:** AI Service Abstraction Layer; All agents share trackedClaudeCall
- **Detail:** The ASAL router writes to both ai_service_log (new, per-task logging) and ApiUsageLog (legacy, for rate limiter and admin dashboard compatibility). Both tables receive entries for every AI call. The rate limiter (middleware/apiLimiter.js) and admin dashboard (routes/admin/apiUsage.js) still read from ApiUsageLog. The deprecated apiUsageTracker.js file is kept for its calculateCost utility used by the orchestrator's SSE cost display.
- **Recommended action:**: Migrate the rate limiter to read from ai_service_log instead of ApiUsageLog. Migrate the admin dashboard to query ai_service_log (which has richer data: intent, task_key, provider). Extract calculateCost to a standalone utility. Then remove the legacy _logLegacy() function from the router and delete apiUsageTracker.js.
- **Status:** Open — technical debt, no functional impact