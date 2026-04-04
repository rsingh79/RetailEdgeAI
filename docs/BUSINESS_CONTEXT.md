# Business Context — RetailEdgeAI

## How to use this file
This document defines the product vision, business strategy, and intended outcomes for the platform. Every architectural decision and feature should trace back to this document. Claude Code should read this file before making architectural decisions. If a proposed change contradicts something here, flag it before proceeding.

Last updated: 2026-04-04

---

## The product vision

RetailEdgeAI is an AI Strategic Advisor platform for small and medium businesses. It is not an invoice processing tool, a pricing engine, or a chatbot — though it contains all of those things. The product is an AI that becomes deeply knowledgeable about each business it serves, learns continuously from operational data and owner interactions, and delivers strategic value that a small business owner couldn't afford to get from a human consultant.

The platform gets smarter in two ways: per-tenant (each advisor learns its specific business) and cross-tenant (a network of super agents identifies patterns across all businesses and quietly uplifts every advisor). A new tenant benefits from collective intelligence on day one. A long-term tenant has an advisor that knows their business as well as they do.

---

## Agent architecture — the core design principle

The Strategic AI Advisor is not a single agent. It is the top of a hierarchy of specialist agents, each of which owns a domain of business understanding.

### How the hierarchy works

**Specialist agents** (the lower layer) each handle a specific domain. They import data, interact with users on operational tasks, and build domain-specific understanding of the business. Each specialist agent has its own prompt evolution, its own learned context, and its own accumulated knowledge about the tenant's business.

**The Strategic Advisor** (the top layer) draws on the understanding built by every specialist agent below it. When a business owner asks a strategic question, the Advisor doesn't query raw data — it synthesises insights from the specialist agents' accumulated knowledge. The quality of the Advisor's strategic output is directly dependent on the depth of understanding each specialist agent has built.

### Tenant-level specialist agents (current and planned)

| Agent | Domain | Current status |
|-------|--------|----------------|
| OCR Extraction | Invoice scanning and data extraction | Built |
| Product Import | Product catalog ingestion from any source | Built |
| Product Matching | Matching invoice lines to catalog products | Phase 3 in progress |
| Prompt Management | Tenant prompt customisation | Built |
| Business Advisor | Strategic analysis and Q&A | Built (embryonic — currently uses direct database tools, will evolve to consume specialist agent outputs) |
| Labour Cost | Staffing costs, rostering patterns, wage analysis | Planned |
| Fixed Cost | Rent, insurance, equipment, recurring overheads | Planned |
| Utilities Cost | Power, water, gas, telecommunications | Planned |
| Competitive Intelligence | Competitor monitoring, price tracking, market positioning | Planned |
| Demand Forecast | Sales pattern analysis, seasonal trends, demand prediction | Planned — basic version required for beta |

### Why this matters for architecture decisions

Every new feature or agent should be built as a specialist module that plugs into the hierarchy — not as a standalone tool bolted onto the Advisor. The agent registry, prompt evolution system, and signal collector are shared infrastructure that all agents use. New agents register themselves and automatically participate in the evolution and cross-tenant learning systems.

Every specialist agent serves a dual purpose: it handles its operational domain for the tenant, and it is a listening post for the platform. Feature requests, support needs, and pain points expressed in agent conversations are captured and surfaced to the product owner (see Platform administration section). This means every agent interaction is simultaneously serving the tenant and improving the product.

---

## Platform administration — two layers

The platform has an admin side that serves the product owner (Rohan) and future platform operations staff. This has two distinct layers with different purposes.

### Layer A: Operational admin (no AI)
Standard administrative functions for managing the platform. This is dashboards, configuration, and CRUD — no AI agent is needed here.

**What it covers:**
- Usage tracking per agent at platform level (how many OCR calls across all tenants today?)
- Cost tracking per agent at platform level (how much is the matching agent costing us in API tokens?) and per tenant (which tenants are most/least cost-efficient?)
- Tenant management — onboarding, status, plan assignment, locking
- Plan tier and feature management — dynamically creating and updating tiers, assigning features to tiers, setting usage caps per tier. This should be fully configurable through the admin UI without code changes
- Platform health — error rates, response times, background job status

**Current schema support:** The admin routes (`/api/admin/*`), PlanTier/Feature/PlanTierFeature/PlanTierLimit tables, and ApiUsageLog already provide the foundation. The admin dashboard needs to be built out to surface this data clearly.

### Layer B: Product owner advisory (AI — future)
A Strategic Advisor for the RetailEdgeAI business itself. The same agent hierarchy pattern that serves tenants, applied to the platform.

**The insight:** RetailEdgeAI is itself a business. It has costs (API usage, infrastructure, development), customers (tenants), competitors (other SaaS tools), and strategic questions (what features to build next, how to price tiers, where to expand). The product owner deserves the same AI-powered strategic guidance that tenants get.

**What this advisor would consume:**
- Platform usage data — which features have highest adoption, which are underused, which drive upgrades
- Cost data — per-agent API costs, infrastructure costs, cost trends over time
- Tenant health — growth signals, churn indicators, support patterns, onboarding completion rates
- Revenue data — MRR, tier distribution, upgrade/downgrade patterns
- Competitive landscape — what competing products are offering, pricing comparisons, feature gaps
- Feature and support signals from agent conversations — every specialist agent's chat with a business user is a product research channel (see below)
- Feature prioritisation — based on tenant requests, usage patterns, competitive pressure, and development effort

### Feature and support signal capture from agent conversations
Every specialist agent is already in conversation with business users about their operational problems. These conversations naturally surface feature requests ("can you handle multi-currency invoices?"), support issues ("the matching keeps getting this wrong"), unmet needs ("I wish I could see this by store"), and pain points ("this takes too long"). Rather than relying on a separate feedback system, the platform should detect and extract these signals automatically from agent interactions across all tenants.

**How this works:**
- Each agent conversation is analysed for signals that indicate feature requests, limitations hit, recurring frustrations, or unmet needs
- These signals are tagged, categorised, and aggregated at the platform level
- The platform owner advisory (or the operational admin dashboard in the interim) surfaces patterns: "14 tenants this month asked about multi-currency support across OCR and matching agent conversations" or "the product import agent is generating the most support-type signals around variant handling"
- This creates a continuous, zero-effort product feedback loop — users don't need to submit tickets or fill out surveys. Their natural interactions with the agents are the feedback

**Privacy boundary:** Signal extraction captures the nature of the request (feature category, pain point type, frequency) but not the tenant's business data. The platform owner sees "12 tenants requested multi-store reporting" not "Tenant X wants to compare their Chapel Street and Lygon Street stores."

**How it differs from tenant advisory:**
- Operates across all tenants (no tenant isolation — this is the platform owner's view)
- Has access to platform-level metrics that no tenant can see
- Its specialist agents consume internal platform data, not business operational data
- It is only accessible to SYSTEM_ADMIN users

**Current status:** Not built. The admin routes provide raw data access, but there is no AI advisory layer for the platform owner.

**Design principle:** When building this, reuse the same infrastructure (prompt assembly, signal collection, evolution system, agent registry) rather than building a parallel system. The platform owner advisor registers its agents in the same registry and evolves through the same pipeline. The only difference is the data sources and the access control.

---

## Product strategy — three layers

### Layer 1: Operational automation (current phase — retail)
Solves immediate, painful operational problems. For retail, this is the invoice-to-price workflow: scan invoices, match to products, calculate landed costs, push optimised prices to the e-commerce platform. This layer achieves two things — it delivers standalone value that justifies the subscription, and it is the data ingestion engine that feeds Layers 2 and 3. Every invoice processed, every product matched, every price approved teaches the specialist agents about the business.

### Layer 2: Business intelligence and strategic advisory
Once the platform has sufficient data and context across multiple specialist agents, the Strategic Advisor transitions from answering questions to proactively surfacing insights. Not dashboards and charts — actionable intelligence. "Your competitor dropped prices on organic coffee by 15% this week. Your current margin on that category is 32%, so you could match their price and still hold 18%. Here's what that would do to your weekly revenue based on your sales velocity." This layer combines operational data (from Layer 1 agents), cost structure analysis (labour, fixed, utilities agents), competitive intelligence, and demand forecasting.

### Layer 3: Collective intelligence (the moat)
Super agents perform daily reviews across tenants, identifying patterns and similarities. When multiple retailers are asking about the same supplier issue, or when a product category is gaining traction across the platform, that intelligence is folded into every advisor's knowledge — invisibly. The tenant experiences this as an advisor that is unusually well-informed about the market. They don't see "other businesses are doing X" — the advisor simply knows things that a well-connected industry insider would know. This network effect is the moat. A competitor can replicate any individual feature, but they cannot replicate the accumulated intelligence of hundreds of businesses without having those businesses on the platform.

---

## Integration philosophy

The platform must be integration-agnostic at its core. Shopify and Gmail are the first integrations, not the only integrations.

### E-commerce platforms
The platform will integrate with any e-commerce system a small business uses. Current and future targets include Shopify, WooCommerce, Lightspeed, Square, Magento, BigCommerce, and others. The integration layer should follow a connector pattern — each platform has its own connector module that translates platform-specific APIs into the platform's internal data model. Adding a new e-commerce integration should not require changes to the core product, matching, pricing, or advisory systems.

### Email and document sources
Gmail is the first email integration. Future sources include Outlook/Microsoft 365, IMAP-based email, and direct document upload from any source. The import pipeline (folder polling, drive integration) already supports multiple source types. The same connector pattern applies — source-specific ingestion modules feed into a common processing pipeline.

### Cost data sources
Labour, fixed, and utilities costs will initially be entered manually or imported via CSV/spreadsheet. Future integrations may include accounting platforms (Xero, MYOB, QuickBooks), payroll systems (Deputy, Employment Hero), and utility providers. Each cost type has its own specialist agent that understands the domain and helps the business owner structure their cost data.
AI model providers
The platform consumes external AI APIs for core functionality: text generation (reasoning, classification, extraction), embeddings (semantic product matching, cross-tenant similarity), and reranking (context retrieval quality for advisor agents). The AI model landscape evolves rapidly — new providers, models, and pricing tiers emerge monthly.
Rather than coupling to a single AI provider, the platform treats AI models the same way it treats e-commerce platforms or email sources: through a provider-agnostic abstraction layer. Each AI capability (embedding, reranking, text generation) is defined as a service intent. A central registry maps each specific task (product matching, strategic advice, invoice field validation) to the best-fit provider and model. Adding or swapping a provider requires only a new adapter module and a registry configuration change — no changes to agent code, pipeline logic, or advisor reasoning.
This is critical for three reasons: (1) cost optimisation — high-volume, low-complexity tasks can be routed to cheaper models while complex reasoning stays on the strongest model; (2) quality evolution — when a better embedding or reranking model launches, the platform can adopt it without touching application code; (3) resilience — if a provider has an outage, fallback providers can handle requests with graceful degradation rather than total failure.
-**Current providers:** Anthropic (Claude) for text generation across all agents. Cohere for embeddings (product matching in both invoice and import pipeline workflows) and reranking (Business Advisor context retrieval).
-**Future Evaluation candidates:** Voyage AI, OpenAI, Mistral, and Jina AI as alternatives or complements, evaluated via the ASAL evaluation protocol against real RetailEdgeAI data before adoption.

### Design principle
No core business logic should depend on a specific integration. The matching engine, pricing engine, advisor, and evolution system should work with internal data models that are populated by connectors. Swapping or adding a connector should be transparent to everything above the integration layer.

---

## Cost structures — beyond product costs

The current platform focuses on cost of goods sold (COGS) through invoice processing. The full vision includes a complete cost picture of the business:

### Product costs (COGS) — current
Supplier invoices, freight, tax (GST/VAT/sales tax). Handled by the OCR, matching, and pricing agents. This is the most mature cost domain.

### Labour costs — planned
Staffing is typically the largest cost for SMBs. A dedicated Labour Cost agent will help business owners track wages, on-costs (e.g., superannuation and workers comp in Australia, Social Security and benefits in the US, NI contributions in the UK), rostering costs by shift/day, and the relationship between staffing levels and sales performance. This feeds directly into the Demand Forecast agent — understanding when sales peak allows the Advisor to recommend optimal staffing levels.

### Fixed costs — planned
Rent, insurance, equipment leases, loan repayments, and other recurring overheads. These are relatively stable but critical for breakeven analysis, profitability assessment, and growth planning. A Fixed Cost agent helps the owner understand their overhead structure and how it changes with business decisions (opening a second location, extending trading hours).

### Utilities costs — planned
Power, water, gas, telecommunications. Often overlooked but significant for hospitality and retail businesses with refrigeration, cooking, or climate control needs. A Utilities Cost agent can identify trends, flag anomalies, and factor utility costs into product-level profitability analysis (e.g., the true cost of running a gelato cabinet includes electricity, not just product cost).

### Why separate agents per cost type
Each cost domain has different data sources, different update frequencies, different analysis patterns, and different questions the business owner asks about them. A single "costs" agent would be too broad to learn effectively. Specialist agents build deeper understanding of their domain and feed richer context to the Strategic Advisor.

---

## Demand forecasting

Historical sales data (from e-commerce platform sync and POS integration) feeds a Demand Forecast agent that identifies patterns: seasonal trends, day-of-week effects, promotional impacts, weather correlations, and product lifecycle stages (gaining traction vs losing traction in the market).

The forecast agent serves two purposes:

**Operational:** Helps with purchasing decisions ("order 20% more sunscreen stock — last year your sales tripled in the first week of November"), staffing ("your Saturday lunch trade has grown 15% quarter-on-quarter — consider adding a staff member"), and inventory management.

**Strategic:** Identifies which products are gaining or losing momentum in the market. Combined with competitive intelligence, this tells the Advisor whether a trend is market-wide or specific to this business. "Your organic range grew 22% last quarter. Across similar retailers on the platform, organic is growing at 18%. You're outperforming the segment — consider expanding the range."

---

## How the platform learns about a business

The learning system uses three channels that work together:

### Structured onboarding
Guided questions at signup capture the essentials: business type, location, key suppliers, known competitors, margin targets, number of stores, staffing structure, business goals. This gives every specialist agent a foundation before any data flows.

### Data ingestion
Connecting e-commerce platforms, email, file systems, accounting tools, and manual uploads creates a continuous stream of operational data. Invoices reveal supplier relationships and COGS. Products reveal catalog breadth and pricing strategy. Orders reveal sales patterns and customer behaviour. Labour data reveals staffing costs and efficiency. Each data point refines the relevant specialist agent's understanding and, through the hierarchy, the Strategic Advisor's overall picture.

### Conversational learning
Every interaction with any agent is a learning opportunity. When the owner tells the matching agent "that's the wrong product — this supplier uses a different name for it," the matching agent learns. When the owner tells the Advisor "we're thinking about expanding our organic range" or "our biggest challenge is competing with Woolworths on staples," that context shapes future advice. The prompt evolution system captures these signals across all agents.

Over time, these three channels compound. By month two, the specialist agents should have enough data to make the Advisor genuinely useful. By month six, the Advisor should feel like an indispensable business partner that knows the business as well as the owner does.

---

## Primary user

The business owner themselves. This is the person who makes strategic decisions, approves pricing changes, evaluates supplier relationships, and thinks about competitive positioning. They are not technical. They don't have an IT team. They want to interact in plain language and get back actionable answers, not data.

Secondary users include operations managers and store managers who handle day-to-day tasks (invoice processing, product management) and report to the owner. The platform should support both — operational users handle routine workflows with specialist agents, the owner engages with the Strategic Advisor.

The product owner (platform administrator) is a separate user class with access to platform-level data, operational admin tools, and eventually a platform-level Strategic Advisor.

---

## Business model

Tiered subscription with per-feature usage caps per tier, powered by Stripe billing.

**Tiers:** Starter (entry), Growth (default trial tier), Professional (power users), Enterprise (custom/negotiated).

**Billing:** Stripe integration with 14-day free trial requiring no payment method (runs at Growth limits). Stripe customer creation is deferred until first checkout. Two cancellation modes: end-of-period (default) or immediate with pro-rata refund. Configurable grace period (14-day default, admin can override per tenant). Subscription status middleware is fail-open (Stripe outage does not block paying customers).

**Rationale for usage caps:** The platform uses LLM APIs (Claude) for core functionality. Each invoice scan, advisor conversation, matching operation, and competitive analysis consumes API tokens with real cost. Usage caps per tier serve three purposes: (1) control cost exposure per tenant, (2) create natural upgrade triggers as businesses grow, (3) prevent abuse — specifically, users treating the Business Advisor as a general-purpose Claude subscription rather than a business tool.

**AI usage is invisible to the user.** The platform uses a 4-stage invisible throttle: (1) 0-50% normal operation, (2) 50-75% switch to lighter models, (3) 75-90% shorter context windows, (4) 90-100% degraded responses, then hard stop with user notification. Users never see usage meters or warnings until the hard stop. Most users never hit limits.

**Advisor scope control:** The Business Advisor should stay focused on the tenant's business. Not through hard blocks ("I can only answer business questions") but through natural steering — the advisor is a business partner, not a general assistant. Off-topic requests should be redirected to business-relevant insights rather than refused.

**Dynamic tier management:** Plan tiers, features, and usage caps must be fully configurable by the product owner through the admin UI without code changes. Adding a new tier, changing which features are included, adjusting usage limits — all of this should be data-driven through the existing PlanTier/Feature/PlanTierFeature/PlanTierLimit schema.

**Historical sales sync:** Month-based, not row-based. Starter: 12 months, Growth: 24 months, Professional: 60 months, Enterprise: unlimited. Three sync modes: historical (one-time backfill), manual (on-demand), auto (with user consent, periodic). Analysis window equals the tier ceiling — data is never deleted. Downgrading narrows the analysis window; upgrading instantly widens it with no re-sync needed.

---

## Competitive intelligence model

A mix of tenant-identified and platform-discovered competitors.

**Tenant-identified:** During onboarding and ongoing use, tenants name their key competitors. The platform monitors these through web scraping, price tracking, and public data analysis.

**Platform-discovered:** As the platform accumulates data across tenants in the same sector and geography, it identifies competitive relationships that individual tenants may not be aware of. A new store opening nearby, a competitor changing their product mix, a supplier offering better terms to others in the area — these are surfaced as proactive insights.

**Privacy boundary:** Cross-tenant competitive intelligence uses aggregated patterns, never individual tenant data. The platform might know "retailers in this postcode are seeing dairy cost increases" but never "Tenant X's margins on dairy are Y%."

---

## Vertical expansion

**Vertical 1 (current): Retail** — Grocery, health food, wholesale distribution. Starting in Australia, with expansion to other markets (NZ, Canada, USA, UK, and beyond). Shopify as primary e-commerce integration.

**Vertical 2 (next): Hospitality** — Cafes, restaurants, bars. Shares the same supplier-invoice-to-cost pain point but with domain-specific concepts: recipes, portions, wastage, seasonal menus. The core platform (invoice processing, supplier management, advisor, evolution system) should be vertical-agnostic. Vertical-specific logic should live in domain modules that plug into the core, not in the core itself.

**Future verticals:** Not decided. The architecture should not assume retail or hospitality — it should be extensible to any SMB vertical that has supplier relationships, cost management needs, and competitive dynamics.

---

## Geographic expansion

**Starting market:** Australia. The current implementation reflects Australian business conventions (GST, Australian supplier invoice formats, AUD currency).

**Planned markets:** New Zealand, Canada, USA, UK, and beyond.

**What geographic expansion requires:**
- Locale-aware tax handling — GST (Australia, NZ), VAT (UK, EU), sales tax (US, Canada). The current three-tier GST model needs to be abstracted into a locale-configurable tax engine rather than hardcoded Australian GST logic.
- Currency support — multi-currency pricing, supplier invoices in different currencies, exchange rate awareness for cost comparison.
- Locale-specific OCR prompt tuning — invoice formats, tax terminology, and supplier conventions differ by country. The prompt evolution system supports this naturally through per-tenant customisation, but base prompts need locale variants.
- Locale-aware domain terminology — the stemmer, stop-word list, and normalisation engine currently use English with some Australian-specific terms. These need to be extensible per locale.
- Regulatory compliance — data residency requirements may vary by country. The current single-region deployment (DigitalOcean Sydney) may need to expand.

**Design principle:** The core platform should be locale-agnostic. Country-specific logic (tax rules, invoice conventions, regulatory requirements) should live in locale modules, following the same pattern as vertical modules. A new country should not require changes to the matching engine, pricing engine, or agent hierarchy — only the addition of a locale module and appropriate base prompt variants.

---

## Business outcomes each feature must serve

### Outcome 1: Accurate landed cost calculation
Every product's cost must reflect the true cost — supplier price, freight allocation, and tax handling (GST in Australia/NZ, VAT in UK/EU, sales tax in US/Canada). This is the data foundation for everything else.

### Outcome 2: Reliable product matching
Invoice lines must be correctly matched to catalog products. Conservative approach — flag uncertain matches for review rather than auto-confirming wrong ones.

### Outcome 3: Clean product catalog across sources
Products from multiple sources (any e-commerce platform, CSV, invoices, manual) should be deduplicated and merged into a single clean catalog.

### Outcome 4: Automated pricing with safety rails
Cost changes should trigger price recalculations within the business's rules. Never surprise the owner with an unexpected price change.

### Outcome 5: Tenant isolation and data security
Each tenant's data must be completely invisible to other tenants. Third-party credentials encrypted at rest. Cross-tenant intelligence uses aggregated patterns, never raw data.

### Outcome 6: Continuously improving AI agents
All specialist agents get better over time through interaction signals, suggestion generation, few-shot curation, and cross-tenant meta-optimization. The evolution system is core product infrastructure, not an engineering optimization.

### Outcome 7: Accessible to non-technical users
Everything works through plain-language interfaces. No configuration files, no code, no technical knowledge required.

### Outcome 8: Proactive strategic intelligence
The Strategic Advisor doesn't just answer questions — it surfaces insights the owner didn't know to ask about. Competitor moves, market trends, supplier patterns, product momentum, cost anomalies.

### Outcome 9: Invisible collective intelligence
Cross-tenant learning makes every advisor smarter without exposing the mechanism. The advisor simply seems well-informed about the market and industry.

### Outcome 10: Complete business cost picture
The platform understands not just product costs but labour, fixed, and utility costs — enabling true profitability analysis and strategic recommendations that account for the full cost structure of the business.

### Outcome 11: Data-driven demand planning
Historical sales data powers demand forecasting that informs purchasing, staffing, inventory, and strategic growth decisions.

### Outcome 12: Platform self-awareness
The product owner has visibility into platform health, per-agent costs, tenant usage patterns, and (in future) AI-powered strategic guidance for product development and business growth decisions.

---

## Current milestone

**Goal:** Build out enough features for a beta launch with multiple retail tenants.

**What "beta ready" means:**
- Core invoice-to-price loop works end-to-end -- **DONE** (Upload -> Review -> Match -> Approve -> Export with Shopify sync confirmation)
- Shopify integration is stable (product sync, order sync, price push) -- **DONE** (two-part sync flow with per-item results)
- Product import handles common formats -- **DONE**
- Sales data ingestion from e-commerce platform (order history, sales volumes, revenue by product) -- **PARTIAL** (Shopify order sync stores data, analytics routes exist, not fully surfaced in UI)
- Basic demand forecasting from historical sales data (seasonal trends, product momentum, sales velocity) -- **NOT STARTED**
- Multi-tenant isolation is verified and complete (all tables have RLS) -- **DONE** (38 tables, strict policies, 836 tests)
- Basic usage limits and plan gating are functional -- **DONE** (TenantUsage tracking, 4-stage AI throttle, Stripe billing, 14-day free trial)
- Business Advisor provides useful data-backed answers via specialist agent tools, including sales trends and demand insights -- **PARTIAL** (sales tools exist, demand insights not built)
- Admin dashboard shows per-agent and per-tenant usage and cost data -- **PARTIAL** (API endpoints exist, frontend admin UI unverified)
- Plan tiers and features are configurable through admin UI -- **DONE** (API endpoints + admin routes)
- The platform doesn't lose data silently -- **PARTIAL** (Shopify push now reports per-item results; signal collection and API usage logging still fire-and-forget)

**What "beta ready" does not require:**
- Labour, fixed, or utilities cost agents
- Full competitive intelligence automation
- Advanced demand forecasting (weather correlation, promotional impact analysis, cross-product cannibalisation)
- Platform owner advisory (AI layer for product owner)
- Complete prompt evolution automation (manual-apply is acceptable)
- Hospitality vertical support
- Non-Shopify e-commerce integrations
- Non-Gmail email integrations
- Drive integration
- Proactive insights engine (on-demand advisory is sufficient for beta)
- Cross-tenant super agent intelligence (the infrastructure should exist but doesn't need to be actively generating insights)

**Post-beta priorities (in rough order):**
1. Proactive insights engine — scheduled analysis that surfaces actionable intelligence
2. Competitive intelligence — price monitoring, product range comparison
3. Labour cost agent — staffing costs, rostering analysis
4. Advanced demand forecasting — weather correlation, promotional impact, cross-product cannibalisation
5. Cross-tenant super agent activation — begin generating cross-tenant learnings
6. Fixed cost and utilities cost agents
7. Platform owner advisory — AI-powered product and business guidance for the product owner
8. Additional e-commerce integrations (WooCommerce, Lightspeed, Square)
9. Hospitality vertical — domain modules for recipes, portions, wastage
10. Additional email/accounting integrations

---

## Terminology

| Term | Meaning |
|------|---------|
| Strategic Advisor | The top-level AI agent that synthesises insights from all specialist agents to provide strategic business guidance |
| Specialist agent | A domain-specific AI agent that handles operational tasks and builds understanding in one area (invoices, products, costs, competitors, demand) |
| Agent hierarchy | The architecture where specialist agents feed domain knowledge upward to the Strategic Advisor |
| Platform owner advisory | A future Strategic Advisor for the RetailEdgeAI business itself, consuming platform-level data to guide product and business decisions |
| Landed cost | True cost of a product: supplier price + allocated freight + tax adjustments (GST/VAT/sales tax depending on locale) |
| Base unit cost | Landed cost normalised to a standard unit (per kg, per L, per each) |
| Invoice line match | A confirmed association between an invoice line item and a catalog product |
| Supplier-product mapping | A learned association between a supplier's description and an internal product |
| Confidence score | 0–1 value. 1.0 = barcode match. 0.95 = AI max. 0.8 = auto-match threshold |
| Tenant | A single business account. All data isolated per tenant |
| Prompt evolution | System that collects signals, generates suggestions, and upgrades agent prompts over time |
| Super agent / Meta-optimizer | Cross-tenant agent that identifies patterns across all businesses and uplifts base prompts |
| Connector | An integration module for a specific external platform (Shopify connector, Gmail connector, etc.) that translates external APIs into internal data models |
| Canonical product | Pipeline-internal data structure for product import, independent of database schema |
| Fingerprint | SHA-256 hash from a product's most reliable identifier, used for deduplication |
| Collective intelligence | Aggregated cross-tenant patterns that make individual advisors smarter without exposing any tenant's data |
| Vertical | A business category (retail, hospitality) with domain-specific concepts that plug into the core platform |
| Cost structure | The full cost picture of a business: COGS (product), labour, fixed, and utilities |
| AI Service Abstraction Layer (ASAL) | Infrastructure component that decouples application code from AI provider specifics. Agents declare what they need (intent + task); ASAL decides which provider and model fulfils the request |
| Service intent | One of three AI capability categories: EMBEDDING (text to vector), RERANKING (reorder by relevance), TEXT_GENERATION (prompt to response). Every AI API call maps to exactly one intent |
| Provider adapter | A module that translates between ASAL's common input/output contracts and a specific AI provider's API format. One adapter per provider (Anthropic, Cohere, Voyage AI, etc.) |
| Service Intent Registry | A database table mapping each specific task (product_matching, strategic_advice, etc.) to an active provider, model, and configuration. Provider swaps are registry row updates, not code changes |
| Evaluation protocol | The mandatory benchmarking process that must be completed before switching a task to a new AI provider. Includes testing against 200+ real records, cost modelling, and integration testing |
| Integration hook | A post-creation callback registered by an integration (e.g. Shopify, WooCommerce) that processes integration-specific data (e.g. variants) after a product is created through the import pipeline. Hooks are fire-and-forget and registered via integrationHooks.js |
| integrationMetadata | An opaque JSON field on CanonicalProduct that carries integration-specific data (e.g. Shopify variant array) through the pipeline without the pipeline reading or modifying it. Consumed by the integration hook after product creation |