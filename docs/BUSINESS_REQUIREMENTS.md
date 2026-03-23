# RetailEdge — Business Requirements Document (BRD)

## 1. Executive Summary

RetailEdge is a multi-tenant SaaS platform that helps small-to-medium retailers automate invoice processing, product matching, cost tracking, and pricing optimization. It replaces manual spreadsheet-based workflows with AI-powered OCR, intelligent product matching, margin-based pricing rules, and competitor intelligence — reducing invoice processing time from hours to minutes.

### Target Users
- **Small retailers** managing 1–10 stores (POS or ecommerce)
- **Operational roles**: Owners, Ops Managers, Merchandisers, Store Managers, Accountants
- **Platform administrators** managing the multi-tenant environment

### Key Value Propositions
1. **Automated invoice ingestion** — OCR extracts supplier, line items, and totals from PDFs/images
2. **Intelligent product matching** — Four-strategy engine (learned mappings → barcode → fuzzy name → AI) links invoice lines to catalog products
3. **Margin-based pricing** — Rule engine calculates suggested retail prices with rounding, jump limits, and minimum margin enforcement
4. **Multi-source import** — Manual upload, Gmail polling, and local/network folder polling
5. **Competitor monitoring** — Track competitor prices and receive margin squeeze alerts (Enterprise)
6. **AI Business Advisor** — Claude-powered chat agent for invoice analysis, pricing insights, and strategic recommendations

---

## 2. Subscription Plans & Feature Matrix

| Capability | Starter ($29/mo) | Professional ($79/mo) | Enterprise ($199/mo) |
|---|---|---|---|
| Invoice OCR & Processing | ✓ | ✓ | ✓ |
| Product Catalog & Matching | ✓ | ✓ | ✓ |
| Pricing Rules Engine | ✓ | ✓ | ✓ |
| Reporting | ✓ | ✓ | ✓ |
| Gmail Auto-Import | — | ✓ | ✓ |
| Folder Polling Auto-Import | — | ✓ | ✓ |
| Competitor Intelligence | — | — | ✓ |
| Max Users | 5 | 15 | Unlimited |
| Max Stores | 2 | 10 | Unlimited |
| Max API Calls / Month | 100 | 500 | 2,000 |

---

## 3. Functional Requirements

### 3.1 Authentication & Multi-Tenancy

| ID | Requirement | Priority |
|---|---|---|
| AUTH-01 | Users register with email, password, name, and business name; a Tenant and OWNER user are created | Must |
| AUTH-02 | JWT-based authentication with 7-day token expiry | Must |
| AUTH-03 | Role-based access control (OWNER, OPS_MANAGER, MERCHANDISER, STORE_MANAGER, ACCOUNTANT, SYSTEM_ADMIN) | Must |
| AUTH-04 | Tenant data isolation at application layer (Prisma extension) and database layer (PostgreSQL RLS) | Must |
| AUTH-05 | Tenant locking: admins can lock/unlock tenant access with a reason | Must |
| AUTH-06 | Trial management: configurable trial period (default 14 days), auto-lock on expiry, grace period | Must |

### 3.2 Invoice Processing

| ID | Requirement | Priority |
|---|---|---|
| INV-01 | Upload invoice files (PDF, JPG, PNG, WebP) via drag-and-drop or file picker | Must |
| INV-02 | Claude Vision AI (Sonnet 4) extracts supplier, invoice number, dates, totals, GST, freight, and line items | Must |
| INV-03 | OCR confidence score (0–100) displayed; low-confidence fields flagged for review | Must |
| INV-04 | Invoice status workflow: PROCESSING → READY → IN_REVIEW → APPROVED → EXPORTED | Must |
| INV-05 | Edit invoice header (supplier, number, dates, amounts, freight allocation method) | Must |
| INV-06 | Edit line items (description, quantity, unit price, pack size) | Must |
| INV-07 | Three freight allocation methods: equal split, proportional by value, proportional by quantity | Must |
| INV-08 | GST handling: detect inclusive/exclusive pricing, calculate ex-GST base unit costs | Must |
| INV-09 | Pack size parsing: "12.5kg", "5x1kg", "Tray x30" → total base units for per-unit costing | Should |
| INV-10 | Delete invoices with full cascade (lines, matches, import logs) | Must |
| INV-11 | Re-OCR: re-run OCR extraction on an existing invoice to refresh data | Should |
| INV-12 | Per-line GST detection: detect GST applicability per line item and store gstAmount | Should |
| INV-13 | Statement detection: OCR classifies documentType (invoice, statement, credit_note, purchase_order, receipt, unknown) | Must |
| INV-14 | Non-invoice documents (statements, etc.) auto-discarded with DISCARDED status and audit log entry | Must |
| INV-15 | Statement detection works across all ingestion paths (upload, email, folder, drive) | Must |

### 3.3 Product Matching

| ID | Requirement | Priority |
|---|---|---|
| MAT-01 | Four-strategy matching: (1) Learned supplier-product mappings, (2) Barcode exact match, (3) Fuzzy name match with stemming, (4) AI fallback via Claude | Must |
| MAT-02 | Confidence scoring per match (0–100) with match reason tracking | Must |
| MAT-03 | Fuzzy matching uses Jaccard word overlap with English stemming, stop-word removal, and hyphen normalization | Must |
| MAT-04 | AI fallback triggers when best confidence is below 80% | Should |
| MAT-05 | Learned mappings: when a user confirms a match, store the supplier + description → product mapping for future invoices | Must |
| MAT-06 | Manual match override: user can search and assign any product to a line | Must |
| MAT-07 | Multi-product matching: a single line can match to multiple products (e.g., mixed cases) | Should |
| MAT-08 | Line statuses: PENDING → MATCHED → NEEDS_REVIEW → APPROVED → HELD → FLAGGED | Must |

### 3.4 Pricing Engine

| ID | Requirement | Priority |
|---|---|---|
| PRC-01 | Margin-based pricing rules with priority: PRODUCT > SUPPLIER > CATEGORY > GLOBAL | Must |
| PRC-02 | Each rule defines: target margin, minimum margin, max price jump %, and rounding strategy | Must |
| PRC-03 | Rounding strategies: round to .99, round to .49/.99, round to nearest 5 cents | Must |
| PRC-04 | Price jump limiting: reject price increases exceeding the configured percentage threshold | Must |
| PRC-05 | Suggested price calculated automatically when a match is confirmed | Must |
| PRC-06 | User can override suggested price with an approved price before export | Must |
| PRC-07 | On invoice approval, update product variant cost prices and selling prices across stores | Must |

### 3.5 Product Catalog

| ID | Requirement | Priority |
|---|---|---|
| PRD-01 | CRUD for products (name, category, base unit, barcode, cost price, selling price) | Must |
| PRD-02 | Product variants per store (SKU, size, cost, sale price, shelf location) | Must |
| PRD-03 | Bulk import from Excel/CSV with column mapping wizard | Must |
| PRD-04 | Shopify-aware import: detect Shopify format, group variants by product name | Must |
| PRD-05 | Save and reuse import templates per system (Shopify, Lightspeed, WooCommerce, Generic) | Should |
| PRD-06 | Product search: fuzzy matching by name, exact match by barcode or SKU | Must |
| PRD-07 | Bulk delete products | Should |
| PRD-08 | Smart Product Import: AI-powered file analysis with Claude, generic parent/child row grouping, split-screen chat UI with mapping/patterns/test results | Must |
| PRD-09 | System name captured at upload time for round-trip import/export | Must |
| PRD-10 | Template auto-saved with complete file blueprint for export reconstruction | Must |
| PRD-11 | Export endpoint reconstructs original file format with updated prices | Must |
| PRD-12 | Expandable product rows showing variants grouped by store with SKU, variant name, size, unit qty, cost, price, active status | Should |

### 3.6 Gmail Integration (Professional+)

| ID | Requirement | Priority |
|---|---|---|
| GML-01 | Per-tenant Google Cloud credentials: tenant provides their own Client ID / Secret | Must |
| GML-02 | OAuth 2.0 consent flow to grant read/modify access to tenant's Gmail | Must |
| GML-03 | Configurable sender whitelist (only import from trusted senders) | Must |
| GML-04 | Configurable Gmail label filter (e.g., "Invoices" label) | Should |
| GML-05 | Background scheduler polls Gmail at configurable intervals (default 30 min) | Must |
| GML-06 | Extract PDF and image attachments, run OCR, create invoice records | Must |
| GML-07 | Three-layer deduplication: Gmail message ID, SHA-256 file hash, invoice content tuple (supplier + number + date) | Must |
| GML-08 | Manual "Poll Now" button for on-demand sync | Must |
| GML-09 | Import log with pagination and status filtering | Must |
| GML-10 | Disconnect: revoke integration and delete encrypted tokens | Must |

### 3.7 Folder Polling Integration (Professional+)

| ID | Requirement | Priority |
|---|---|---|
| FLD-01 | Configure a local or UNC network path (e.g., `C:\Invoices` or `\\server\share\invoices`) | Must |
| FLD-02 | Path validation: absolute path check, directory traversal prevention, accessibility check | Must |
| FLD-03 | Configurable file patterns (default: *.pdf, *.jpg, *.jpeg, *.png) | Must |
| FLD-04 | "Test Connection" validates folder access and reports matching file count | Must |
| FLD-05 | Background scheduler polls folder at configurable intervals (default 30 min) | Must |
| FLD-06 | Top-level scan only (no recursive subfolder scanning) | Must |
| FLD-07 | Three-layer deduplication: file path, SHA-256 file hash, invoice content tuple | Must |
| FLD-08 | Post-import: move processed files to a `Processed/` subfolder (configurable) | Must |
| FLD-09 | Name collision handling: append timestamp suffix if file already exists in Processed/ | Must |
| FLD-10 | 20 MB per-file size limit | Must |
| FLD-11 | Manual "Poll Now" button for on-demand import | Must |
| FLD-12 | Import log with pagination and status filtering | Must |
| FLD-13 | Disconnect: remove configuration | Must |

### 3.8 Export Workflow

| ID | Requirement | Priority |
|---|---|---|
| EXP-01 | Cross-invoice export view: select multiple approved invoices and view all confirmed matches | Must |
| EXP-02 | Inline price editing in export view (update approved price before final export) | Must |
| EXP-03 | Group export items by store for POS system import | Must |
| EXP-04 | Mark items as exported with timestamp tracking | Must |
| EXP-05 | Include exported items from other invoices via checkbox (re-export support) | Should |
| EXP-06 | Split invoice table: "Ready to Export" (never exported) and "Previously Exported" (with Last Exported date) | Must |
| EXP-07 | Sortable "Last Exported" column in Previously Exported table (ascending default) | Should |
| EXP-08 | Per-system export checkboxes: POS (.csv), Shopify (.csv), Instore Update (.xlsx) — all selected by default | Must |
| EXP-09 | Only export items where cost or selling price has changed (0.005 tolerance) | Must |
| EXP-10 | Duplicate POS product detection: when same product appears on multiple invoices, show resolution modal | Must |
| EXP-11 | Duplicate resolution: pre-select most recent invoice, user can override via radio buttons per product | Must |
| EXP-12 | Generate INSTORE_UPDATE.xlsx (Product Name + New Price) for POS shelf label updates | Must |

### 3.9 Competitor Intelligence (Enterprise)

| ID | Requirement | Priority |
|---|---|---|
| CMP-01 | Create competitor monitors: link a catalog product to a competitor (Woolworths, Coles, Aldi, IGA) | Must |
| CMP-02 | Record price observations (manual entry in V1, web scraping in V2) | Must |
| CMP-03 | Margin waterfall analysis: visualize cost → margin → retail → competitor price | Must |
| CMP-04 | Cross-supplier cost comparison for the same product | Must |
| CMP-05 | Supplier cost history trending | Must |
| CMP-06 | Automated alert generation: competitor undercut, margin squeeze, cost increase, price opportunity | Must |
| CMP-07 | Alert management: mark read, dismiss, filter unread | Must |
| CMP-08 | AI pricing recommendation (placeholder for V2) | Could |

### 3.10 Admin Portal (SYSTEM_ADMIN)

| ID | Requirement | Priority |
|---|---|---|
| ADM-01 | Platform overview: tenant count, trial count, locked count, total API cost/calls | Must |
| ADM-02 | Recent activity feed: access logs and tenant registrations | Must |
| ADM-03 | Tenant list with search and status filters (active, trial, locked, expired) | Must |
| ADM-04 | Tenant detail: full profile, users, access logs, API usage summary | Must |
| ADM-05 | Create tenant with owner account and temporary password | Must |
| ADM-06 | Lock/unlock tenant access with reason | Must |
| ADM-07 | Change tenant subscription: plan, status, trial end date, API limits | Must |
| ADM-08 | API usage dashboard: aggregated by tenant, date range, and model | Must |
| ADM-09 | Drill-down to individual API call details (request/response payloads) | Must |
| ADM-10 | Platform settings: default trial days, auto-lock on trial expiry, grace period | Must |

### 3.11 Stores

| ID | Requirement | Priority |
|---|---|---|
| STR-01 | Store profiles: name, type (POS or Ecommerce), platform (Lightspeed, Shopify, WooCommerce) | Must |
| STR-02 | Products linked to stores via variants (per-store SKU, pricing, shelf location) | Must |

### 3.12 AI Business Advisor

| ID | Requirement | Priority |
|---|---|---|
| ADV-01 | Chat interface with streaming responses via Server-Sent Events (SSE) | Must |
| ADV-02 | Persistent conversation history: create, list, resume, and delete conversations | Must |
| ADV-03 | AI orchestrator with tool-use: agent calls domain-specific tools to answer questions | Must |
| ADV-04 | Invoice analysis tools: summarize invoices, compare costs, identify trends | Must |
| ADV-05 | Product intelligence tools: catalog search, margin analysis, price history | Must |
| ADV-06 | Pricing analysis tools: rule evaluation, margin impact simulation | Must |
| ADV-07 | Competitor intelligence tools: price comparison, market positioning | Should |
| ADV-08 | Quick action buttons: predefined prompts for common analysis tasks | Should |
| ADV-09 | Message feedback: thumbs up/down on AI responses for quality tracking | Should |
| ADV-10 | Rate limiting: per-tenant chat request throttling to control API costs | Must |

### 3.14 Prompt Evolution System

| ID | Requirement | Priority |
|---|---|---|
| PES-01 | 3-tier prompt architecture: versioned base prompts, per-tenant config overrides, cross-tenant meta-optimization | Must |
| PES-02 | 6-step prompt assembly engine with caching (promptAssemblyEngine.js) | Must |
| PES-03 | Interaction signal capture: 6 signal types (prompt_meta, correction_count, usage, outcome, satisfaction, escalation) with async buffer flush | Must |
| PES-04 | Suggestion engine: per-tenant AI-generated improvement proposals from aggregated signals | Should |
| PES-05 | Meta-optimizer: cross-tenant learning, identify outperformers (15%+ improvement), propose base prompt upgrades | Should |
| PES-06 | Canary rollout for base prompt version upgrades | Should |
| PES-07 | Settings > AI Agents tab: per-agent prompt configuration, override management, effective prompt preview, change log viewer | Must |
| PES-08 | Abandoned conversation detection and cleanup | Should |
| PES-09 | Few-shot example auto-curation from successful interactions | Should |

### 3.15 Admin API Usage Enhancements

| ID | Requirement | Priority |
|---|---|---|
| AUE-01 | Per-agent API cost breakdown: total cost, avg cost/call, % of total | Must |
| AUE-02 | Expandable agent rows showing per-tenant usage within each agent | Should |
| AUE-03 | Expandable tenant rows showing per-agent usage within each tenant | Should |
| AUE-04 | Endpoint: GET /api/admin/api-usage/agents | Must |

### 3.13 Workflow UI

| ID | Requirement | Priority |
|---|---|---|
| WKF-01 | Dashboard with KPI metrics: invoice counts, pending review, action items | Must |
| WKF-02 | Workflow breadcrumb navigation: Dashboard → Invoices → Review → Export | Must |
| WKF-03 | Invoice sidebar badge counts (total, needing review) | Must |
| WKF-04 | Batch review page: review multiple invoices with side panel for invoice detail | Should |

---

## 4. Non-Functional Requirements

| ID | Requirement | Category |
|---|---|---|
| NFR-01 | Tenant data isolation enforced at both application and database layers | Security |
| NFR-02 | All sensitive credentials encrypted at rest (AES-256-GCM) | Security |
| NFR-03 | API rate limiting per tenant based on subscription plan | Performance |
| NFR-04 | OCR processing completes within 30 seconds per invoice | Performance |
| NFR-05 | Audit logging for all pricing changes and invoice approvals | Compliance |
| NFR-06 | Support for Australian tax (10% GST) and currency (AUD) | Localization |
| NFR-07 | Responsive web UI (desktop-first, mobile in V2) | Usability |
| NFR-08 | Background schedulers must not block request handling | Reliability |
| NFR-09 | Graceful degradation when Claude API is unavailable | Reliability |

---

## 5. Future Roadmap (Backlog)

| Feature | Description | Target |
|---|---|---|
| Stripe Billing | Automated subscription management and payment collection | V2 |
| Email Marketing (Omnisend/Klaviyo) | Transactional emails for trial expiry, payment failure, welcome | V2 |
| Competitor Web Scraping | Automated price collection from Woolworths, Coles, Aldi, IGA | V2 |
| AI Pricing Recommendations | Claude-powered pricing suggestions based on market data | V2 |
| Mobile App | Capacitor-based iOS/Android app | V3 |
| POS Integrations | Direct API push to Lightspeed, Shopify, WooCommerce | V3 |
