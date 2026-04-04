# Decisions Log -- RetailEdgeAI

## How to use this file

Every significant architectural decision, design trade-off, or governance change is logged here with date, rationale, and implications. Entries are in reverse chronological order (newest first). Each entry links to risks it introduced or resolved (see RISKS_AND_ISSUES.md).

---

## 2026-04-04: Remove MatchCorrectionModal -- correction handled inline

- **Context:** The MatchResolutionPanel (expanded row) and MatchCorrectionModal (separate modal) both allowed match changes on approved invoices, creating duplicate UX paths.
- **Decision:** Remove the pencil button, the "Change match" button, and the MatchCorrectionModal entirely. Wire the correction API (`POST /correct-match`) directly into the MatchResolutionPanel's "Confirm Match" button for approved invoices.
- **Rationale:** One path to do one thing. The panel already has search, selection, and pricing -- adding correction capability there eliminates the need for a separate modal.
- **Implications:** The `correctionTarget` state and MatchCorrectionModal import are removed from Review.jsx. The panel now handles 409 NEWER_INVOICE_EXISTS via browser confirm dialog.

## 2026-04-04: Orphaned match handling -- frontend graceful degradation

- **Context:** 406 InvoiceLineMatch records had both `productId` and `productVariantId` set to NULL due to: (1) migration `20260311_make_variant_optional_on_match` added `productId` column without backfilling existing rows, (2) Shopify re-sync hard-deletes and recreates variants, cascading `ON DELETE SET NULL` on the old `productVariantId`.
- **Decision:** Frontend treats orphaned matches as valid entries with pricing data and a "(product link lost)" label. Auto-search is triggered on expand so users see candidates immediately. 58 matches were backfilled via name-matching script; 348 remain for manual re-linking.
- **Rationale:** The product still exists in the catalog -- only the FK reference was lost. The pricing data (costs, approved prices) is intact and valuable. Showing it is better than hiding it.
- **Implications:** No data migration needed for the 348 remaining orphans. Users fix them naturally as they review invoices.
- **Linked risks:** RISK-031

## 2026-04-04: Shopify sync two-part flow with per-item results

- **Context:** The old Export page had an ExportPanel placeholder with `alert()` stubs for "Push to Shopify." The actual Shopify push happened silently in `markExported()` with no user confirmation and no per-item feedback.
- **Decision:** Add a two-part flow: (1) Review screen showing every Shopify item with checkboxes before syncing, (2) Results screen showing per-item success/failure after sync. Backend `POST /export/mark` now returns `shopifyResults: { summary, results[] }` with per-item status. Failed items can be exported as a CSV failure report.
- **Rationale:** Pushing prices to a live Shopify store is a high-stakes action. Users need to see exactly what will change, opt out of individual items, and know what succeeded or failed.
- **Implications:** Backend `pushPriceUpdate()` calls are now awaited sequentially (not fire-and-forget) so results can be collected.
- **Linked risks:** Resolves RISK-003 (Shopify push failures go unnoticed)

## 2026-04-04: Export page search, sort, and pagination

- **Context:** Export page showed all invoices in flat lists with no filtering.
- **Decision:** Add per-section search (by supplier/invoice number), sortable column headers (supplier, date, last exported), and client-side pagination (10 per page).
- **Rationale:** Users with many invoices need to find specific ones quickly.

## 2026-04-04: Clickable breadcrumbs for workflow navigation

- **Context:** WorkflowBreadcrumb (Upload -> Review & Price -> Export) and StepProgress (OCR -> Match -> Review) were display-only.
- **Decision:** Completed steps are now clickable. WorkflowBreadcrumb navigates between pages (/invoices, /review/:id, /export). StepProgress navigates between internal steps within Review.jsx.
- **Rationale:** Users frequently need to go back. Browser back button doesn't always work correctly with SPA routing.

## 2026-04-03: MatchResolutionPanel approved-invoice UX

- **Context:** When expanding a matched line on an approved invoice, the panel showed an empty search state -- the existing match wasn't displayed.
- **Decision:** For approved invoices, show all currently matched products at the top with checkboxes ticked. Search results appear below a divider. Single-select (radio) behaviour for changing matches. Correction API is wired into "Confirm Match" button.
- **Rationale:** The existing match should be front and centre. Users shouldn't have to re-find a product that was already matched.
- **Implications:** `currentMatches` (plural) replaces `currentMatch` -- supports multi-product matches (e.g., POS + Shopify variants of the same invoice line).

## 2026-03-31: Invoice corrections with cost reversal

- **Context:** Once an invoice was approved, there was no way to change a match without manually editing database records.
- **Decision:** Add `POST /invoices/:id/lines/:lineId/correct-match` with three actions: rematch, unmatch, match. Rematch reverses cost on the old product and applies cost on the new product. 409 NEWER_INVOICE_EXISTS warns if a newer invoice already updated the product cost.
- **Rationale:** Users make mistakes and need to fix them. Cost data must stay accurate -- a rematch can't leave the old product with an incorrect cost.
- **Linked risks:** RISK-032

## 2026-03-31: Multi-tab stale data protection

- **Context:** Two browser tabs open on the same invoice could overwrite each other's changes.
- **Decision:** `dataVersion` field on invoice mutations (incremented on each write). BroadcastChannel for same-origin tab detection (30s heartbeat). Conditional 60s polling on sensitive screens (Review, Export) when other tabs are detected.
- **Rationale:** Optimistic concurrency control is lightweight and catches the most common case (same user, multiple tabs).

## 2026-03-30: API hardening -- 5 rate limiter tiers

- **Context:** No rate limiting existed. Any authenticated user could flood the API.
- **Decision:** 5 tiers: auth (5/min), AI (20/min), write (30/min), read (60/min), admin (10/min). Global error handler. Security headers. Health check endpoint. Structured request logging.
- **Rationale:** Required for production readiness. The tiers match the cost profile of each endpoint type.
- **Linked risks:** Resolves RISK-008 (no rate limiting)

## 2026-03-29: Stripe billing with 14-day free trial

- **Context:** Plan tiers existed in the database but had no payment mechanism.
- **Decision:** Stripe integration. 14-day free trial requires no payment method (runs at Growth limits). Stripe customer creation is deferred until first checkout. Two cancellation modes: end-of-period (default) or immediate with pro-rata refund. Configurable grace period (14-day default, admin can override per tenant). Subscription status middleware is fail-open (if Stripe is unreachable, allow access).
- **Rationale:** Low-friction onboarding (no credit card for trial). Fail-open prevents Stripe outages from blocking paying customers.
- **Linked risks:** RISK-033

## 2026-03-28: AI usage invisible to user -- 4-stage throttle

- **Context:** AI API calls have real cost. Need to limit per-tenant usage without creating a hostile "you've run out" experience.
- **Decision:** 4-stage invisible throttle: (1) 0-50% normal, (2) 50-75% switch to lighter models, (3) 75-90% shorter context windows, (4) 90-100% degraded responses, (5) 100% hard stop with user notification. Users never see usage meters or warnings until the hard stop.
- **Rationale:** Most users never hit limits. Those approaching limits get gracefully degraded service rather than a wall. Only the hard stop is visible.
- **Implications:** TenantUsage table tracks per-tenant consumption. `usageEnforcement` middleware checks on every AI-consuming request.

## 2026-03-28: Tier rename and Enterprise addition

- **Context:** Original tier names (basic, medium, high) were developer-facing.
- **Decision:** Rename to Starter, Growth, Professional, Enterprise. Enterprise tier added with unlimited AI queries and custom limits.
- **Rationale:** Customer-facing names that suggest progression. Enterprise for high-volume tenants with negotiated terms.

## 2026-03-28: Historical sales sync -- month-based, not row-based

- **Context:** Sales data sync from Shopify could be bounded by row count or time window.
- **Decision:** Month-based: Starter 12 months, Growth 24 months, Professional 60 months, Enterprise unlimited. Three sync modes: historical (one-time backfill), manual (on-demand), auto (with user consent, periodic).
- **Rationale:** Businesses think in months, not rows. "Your plan includes 2 years of sales history" is clearer than "your plan includes 50,000 transactions."

## 2026-03-28: Analysis window = tier ceiling, data never deleted

- **Context:** When a user downgrades, should their historical data be deleted?
- **Decision:** Never delete data. The analysis window is the tier ceiling -- downgrading narrows what the AI can analyze, but the data remains. Upgrading instantly widens the analysis window with no re-sync needed.
- **Rationale:** Data deletion is hostile and creates re-onboarding friction. Storage is cheap; trust is expensive.

## 2026-03-27: OCR max_tokens increase 4096 to 8192

- **Context:** Large invoices (50+ line items) were being truncated by the 4096 token limit.
- **Decision:** Increase to 8192. Monitor for cost impact.
- **Rationale:** Truncated invoices cause missing line items, which is worse than higher per-invoice cost.

## 2026-03-27: Anthropic API system prompt string to array

- **Context:** The Anthropic SDK expects `system` as an array of content blocks, not a plain string. This was causing silent prompt truncation.
- **Decision:** Fix all `trackedClaudeCall` invocations to pass `system` as `[{ type: 'text', text: prompt }]`.
- **Rationale:** Bug fix -- the API was silently ignoring malformed system prompts.

## 2026-03-27: Fail-open fix for missing tier limits

- **Context:** Tenants on the old 'high' tier had no `ai_queries_per_month` limit row. The check `limit?.value ?? 0` treated missing limits as 0, blocking all AI access.
- **Decision:** Change fallback from `?? 0` to `?? -1` where -1 means unlimited. Missing limit = no restriction.
- **Rationale:** Fail-open is the correct default for paying customers. A missing database row should not block service.
