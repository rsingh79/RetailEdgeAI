# RetailEdge Business AI Agent — System Design

## Document Info

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-03-20 |
| Status | Draft |
| Author | RetailEdge Architecture Team |

---

## 1. Executive Summary

The Business AI Agent is a tenant-specific AI consultant embedded within RetailEdge. It provides small retailers with data-driven business advice by combining internal operational data (invoices, products, pricing, suppliers) with external market intelligence (sector trends, competitor analysis, consumer demand).

### Core Capabilities

1. **Chat Interface** — Natural language Q&A about business performance
2. **Internal Data Analysis** — Insights derived from the tenant's own RetailEdge data
3. **Market Intelligence** — External research via Tavily, Perplexity, Google Trends
4. **Strategy Planning** — Goal-setting, action plans, step-by-step execution guidance
5. **Proactive Alerts** — Industry-wide trend detection from collective (anonymised) intelligence
6. **Evolving Context** — Persistent business persona and knowledge base that improve over time

### Design Principles

- **Knowledge-First**: Pre-compute and cache insights; minimise real-time LLM calls
- **Reuse Existing Agents**: Expand OCR, Matching, Pricing, and Competitor services into sub-agents
- **Tenant Isolation**: All data access through tenant-scoped Prisma clients + RLS
- **Cost Control**: Resolution ladder, token budgets, knowledge compounding
- **Collective Intelligence**: Share anonymised patterns across tenants (never raw data)

---

## 2. Architecture Overview

```
                    ┌─────────────────────────────────────┐
                    │         USER CHAT INTERFACE          │
                    │  React component with streaming SSE  │
                    └──────────────┬──────────────────────┘
                                   │ POST /api/chat/messages
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     BUSINESS ADVISOR AGENT (Orchestrator)            │
│                                                                      │
│  ┌───────────────┐  ┌─────────────────┐  ┌────────────────────────┐ │
│  │ QUERY          │  │ CONTEXT          │  │ RESPONSE               │ │
│  │ CLASSIFIER     │→ │ ASSEMBLER        │→ │ GENERATOR              │ │
│  │                │  │                  │  │                        │ │
│  │ Keyword+intent │  │ 3-layer context  │  │ Claude Sonnet call     │ │
│  │ classification │  │ Hot+Warm+Cold    │  │ with tool_use for      │ │
│  │ (no LLM call)  │  │ assembly         │  │ sub-agent routing      │ │
│  └───────────────┘  └─────────────────┘  └────────────────────────┘ │
│         │                                         │                  │
│         ▼                                         ▼                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     SUB-AGENT TOOLS                           │   │
│  │  (Registered as Claude tool_use functions)                   │   │
│  │                                                              │   │
│  │  query_internal_data    — SQL/Prisma queries on tenant data  │   │
│  │  analyse_invoices       — Invoice trends, supplier patterns  │   │
│  │  analyse_products       — Product performance, dead stock    │   │
│  │  analyse_pricing        — Margin gaps, repricing candidates  │   │
│  │  analyse_competitors    — Price positioning, alerts          │   │
│  │  search_knowledge_base  — Cached insights lookup             │   │
│  │  research_market        — Tavily/Perplexity external search  │   │
│  │  get_benchmarks         — Anonymised industry comparisons    │   │
│  │  create_action_plan     — Generate goal-linked plan          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
          │                           │                        │
          ▼                           ▼                        ▼
┌──────────────────┐  ┌──────────────────────┐  ┌────────────────────┐
│ TENANT DATA      │  │ TENANT KNOWLEDGE     │  │ SHARED             │
│ (RLS-isolated)   │  │ BASE                 │  │ INTELLIGENCE       │
│                  │  │ (Per-tenant, cached)  │  │ LAYER              │
│ Invoice          │  │                      │  │ (Cross-tenant,     │
│ InvoiceLine      │  │ BusinessSnapshot     │  │  anonymised)       │
│ InvoiceLineMatch │  │ TenantPersona        │  │                    │
│ Product          │  │ KnowledgeEntry       │  │ Benchmarks         │
│ ProductVariant   │  │ ConversationSummary  │  │ RecommendScores    │
│ Supplier         │  │ ActionPlan           │  │ TrendSignals       │
│ SupplierMapping  │  │ BusinessGoal         │  │ ResponseQuality    │
│ PricingRule      │  │                      │  │ QuestionPatterns   │
│ CompetitorPrice  │  │                      │  │                    │
│ PriceAlert       │  │                      │  │                    │
└──────────────────┘  └──────────────────────┘  └────────────────────┘
```

---

## 3. Sub-Agent Specifications

### 3.1 Invoice Intelligence Agent

**Expands**: `server/src/services/ocr.js`, `server/src/services/matching.js`, `server/src/routes/invoices.js`

**Existing Capabilities Retained**:
- Invoice OCR extraction via Claude Vision API
- 4-tier product matching (supplier mapping → barcode → fuzzy → AI)
- Invoice pipeline status tracking
- AI stats aggregation (monthly counts, match rates, OCR confidence)

**New Analytical Capabilities**:

| Function | Description | Data Source | LLM Required? |
|----------|-------------|-------------|---------------|
| `getSupplierCostTrends` | Cost change % per supplier per category over configurable period | InvoiceLineMatch + Supplier | No (SQL aggregation) |
| `detectCostAnomalies` | Flag invoice lines where cost deviates >15% from rolling average | InvoiceLine + historical matches | No (statistical) |
| `getSpendConcentration` | % of total spend per supplier, risk assessment | InvoiceLineMatch + Supplier | No (SQL aggregation) |
| `getSeasonalPatterns` | Identify recurring cost changes by month/quarter | InvoiceLineMatch (12+ months) | Small LLM call for interpretation |
| `getSupplierReliability` | Match success rate, invoice frequency, OCR confidence per supplier | Invoice + InvoiceLineMatch | No (SQL aggregation) |
| `getInvoiceVolumeAnalysis` | Processing volume trends, peak periods, bottlenecks | Invoice (createdAt grouping) | No (SQL aggregation) |

**Write-Back to Knowledge Base**: After every invoice is processed, automatically compute and cache:
- Updated supplier cost trend for affected categories
- Anomaly flag if detected
- Updated spend concentration score

**Cost Impact**: Near-zero additional cost. All new functions are SQL/Prisma aggregations on existing data. LLM called only when user asks "why" about a pattern.

---

### 3.2 Product & Pricing Intelligence Agent

**Expands**: `server/src/services/pricing.js`, `server/src/routes/products.js`, `server/src/routes/pricing.js`

**Existing Capabilities Retained**:
- Margin-based pricing calculation (target margin, min margin, max jump, rounding)
- Rule precedence (PRODUCT > SUPPLIER > CATEGORY > GLOBAL)
- Product CRUD and bulk import

**New Analytical Capabilities**:

| Function | Description | Data Source | LLM Required? |
|----------|-------------|-------------|---------------|
| `getMarginAnalysis` | Margin breakdown by category, store, supplier | ProductVariant + InvoiceLineMatch | No (arithmetic) |
| `getBelowTargetProducts` | Products where current margin < applicable rule's targetMargin | ProductVariant + PricingRule | No (comparison) |
| `getRepricingCandidates` | Ranked list of products that would benefit most from repricing | ProductVariant + PricingRule + InvoiceLineMatch | No (scoring formula) |
| `getCategoryPerformance` | Rank categories by margin, volume, trend direction | Product + ProductVariant + InvoiceLineMatch | No (SQL aggregation) |
| `getDeadStockCandidates` | Products with no invoice activity in N days | Product + InvoiceLine (absence query) | No (SQL query) |
| `getCrossStoreComparison` | Same product at different prices across stores | ProductVariant (cross-store join) | No (SQL query) |
| `getProductHealthScore` | Composite score: margin vs target + trend + velocity + competitor position | All product-related tables | No (formula) |

**Product Health Score Formula**:
```
healthScore = (
  marginScore     × 0.35 +   // actual margin / target margin (capped at 1.0)
  trendScore      × 0.25 +   // cost trend: stable=1.0, rising=0.5, falling(good)=1.0
  velocityScore   × 0.20 +   // invoice frequency vs category average
  competitorScore × 0.20     // our price vs competitor avg: at/below=1.0, above=0.5
) × 100

Ranges: 0-40 = Critical, 41-60 = Needs Attention, 61-80 = Healthy, 81-100 = Excellent
```

**Nightly Batch Job**: Compute `ProductHealthScore` for every active product. Store in `BusinessSnapshot`. Cost: $0 (pure arithmetic on DB data).

---

### 3.3 Competitor & Market Intelligence Agent

**Expands**: `server/src/routes/competitor.js`

**Existing Capabilities Retained**:
- Competitor monitor CRUD (Woolworths, Coles, Aldi, IGA)
- Manual price entry and history tracking
- Waterfall margin analysis
- Multi-supplier cost comparison
- Automated alerts (undercut, squeeze, opportunity)

**New External Research Capabilities**:

| Function | Description | External API | Cache Duration |
|----------|-------------|-------------|----------------|
| `searchMarketTrends` | Sector-level news and trends for tenant's business type | Tavily | 7 days |
| `deepResearch` | Cited analysis on specific topics (e.g., "dairy wholesale pricing AU") | Perplexity Sonar | 7 days |
| `getConsumerDemand` | Trending search terms in tenant's product categories | Google Trends API | 14 days |
| `detectNewEntrants` | News about new competitors or store openings in tenant's region | Tavily | 30 days |
| `getSectorBenchmarks` | Published industry margin/performance benchmarks | Tavily + Perplexity | 30 days |

**Cache-First Policy**: Every external call follows this flow:
```
1. Check KnowledgeEntry for cached result with matching topic + non-expired
   → Found: return cached result ($0 cost)
   → Not found: continue to step 2

2. Call external API (Tavily/Perplexity/Trends)
   → Store result as KnowledgeEntry with expiresAt
   → Return fresh result

3. On cache miss + external API failure:
   → Return graceful fallback: "I don't have current data on this topic.
      Based on what I know from [date], ..."
```

**Cost Impact**: This is the most expensive agent. Controlled by:
- Aggressive caching (7-30 day expiry)
- Rate limits per tier (Professional: 0 external calls; Enterprise: 50/month)
- Background scheduled refresh (weekly) instead of on-demand

---

### 3.4 Strategy Agent

**New agent** — does NOT query data directly. Synthesises outputs from other agents.

**Capabilities**:

| Function | Description | Inputs | LLM Required? |
|----------|-------------|--------|---------------|
| `generateActionPlan` | Create prioritised action plan linked to business goals | BusinessSnapshot + KnowledgeEntries + Goals | Yes (Claude) |
| `evaluateProgress` | Assess progress against goals using current metrics vs baseline | BusinessGoal + BusinessSnapshot (current vs historical) | Small LLM call |
| `generateWhatIf` | Model impact of a proposed change (e.g., "what if I raise dairy by 5%?") | ProductVariant data + PricingRule + competitor data | Yes (Claude) |
| `prioritiseActions` | Rank possible actions by impact, effort, and risk | Recommendation scores + tenant persona | Small LLM call |

**Key Design Decision**: The Strategy Agent receives PRE-AGGREGATED summaries from other agents, not raw data. A typical strategy call receives ~3-5K tokens of context (business snapshot + relevant KB entries + goals), keeping cost at ~$0.02-0.05 per call.

---

### 3.5 Product Import Agent

**New agent** — AI-powered product catalog import that analyses file structure and maps columns automatically.

**File**: `server/src/services/productImportAgent.js`

**Capabilities**:

| Function | Description | LLM Required? |
|----------|-------------|---------------|
| `analyseFileStructure` | Detect headers, sample rows, system format (Shopify, Lightspeed, WooCommerce, generic) | Yes (Claude) |
| `proposeColumnMapping` | Map detected columns to RetailEdge product fields | Yes (Claude) |
| `groupParentChildRows` | Generic parent/child row grouping engine for variant detection | No (rule engine) |
| `testImport` | Dry run import with preview of products and variants | No (data transform) |
| `confirmImport` | Create products and variants in database, save template | No (DB writes) |
| `exportWithUpdatedPrices` | Reconstruct original file format with current prices | No (template-based) |

**UI**: Split-screen chat interface (`SmartImport.jsx`):
- Left panel: Conversational agent for iterative refinement
- Right panel: Column mapping visualization, grouping patterns, test results

**Template System**: On successful import, saves complete file blueprint (headers, column positions, grouping rules, system name) for future round-trip export.

---

### 3.6 Prompt Management Agent

**File**: `server/src/services/promptChatAgent.js`

Manages prompt configuration through a conversational interface. Allows tenant admins to refine AI agent behavior through natural language.

**Capabilities**:

| Function | Description | LLM Required? |
|----------|-------------|---------------|
| `reviewPromptConfig` | Show current effective prompt for an agent | No |
| `addOverride` | Add custom instruction to tenant config | No (DB write) |
| `removeOverride` | Remove custom instruction | No (DB write) |
| `previewEffectivePrompt` | Show assembled prompt with all overrides applied | No |

---

### 3.7 Suggestion Engine Agent

**File**: `server/src/services/suggestionEngine.js` (631 lines)

Automated per-tenant analysis of interaction signals to generate prompt improvement proposals.

**Capabilities**:

| Function | Description | LLM Required? |
|----------|-------------|---------------|
| `aggregateSignals` | Group signals by topic, compute resolution/override/satisfaction rates | No (SQL) |
| `identifyFailurePatterns` | Detect high override rate (>40%), low satisfaction (<3.0) | No (threshold logic) |
| `clusterHumanOverrides` | Categorize overrides: wrong_product_match, no_match_found, price_override | No (classification) |
| `generateProposals` | Create structured improvement suggestions from patterns | Yes (Claude Haiku) |
| `autoSuggestFewShots` | Curate few-shot examples from high-satisfaction interactions | No (SQL scoring) |

**Schedule**: Runs daily per tenant per agent role. Stores suggestions in `PromptSuggestion` table for admin review.

---

### 3.8 Meta-Optimizer Agent

**File**: `server/src/services/metaOptimizer.js` (760 lines)

Cross-tenant learning system that identifies effective prompt configurations and proposes platform-wide improvements.

**Capabilities**:

| Function | Description | LLM Required? |
|----------|-------------|---------------|
| `computeCrossTenantStats` | Compare resolution/override/satisfaction rates across tenants | No (SQL) |
| `identifyOutperformers` | Find tenants with 15%+ improvement over defaults | No (comparison) |
| `generateDefaultUpgrades` | Propose base prompt improvements from outperformer patterns | Yes (Claude) |
| `createCandidateVersion` | Create new PromptBaseVersion (isActive: false) for review | No (DB write) |
| `activateCandidate` | Canary rollout of new base version | No (DB update) |
| `rollbackVersion` | Revert to previous active version | No (DB update) |
| `generateRecommendations` | Suggest improvements for default tenants based on outperformer configs | Yes (Claude) |

**Schedule**: Runs weekly. Platform admin reviews candidates via Admin > Meta-Optimizer dashboard.

---

## 4. Context Architecture

### 4.1 Three-Layer Context Model

Every chat message assembles context from three layers, stopping at the cheapest layer that provides sufficient information.

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 1: HOT CONTEXT (always loaded, ~2K tokens, cost: $0)        │
│                                                                     │
│ Assembled from: TenantPersona + BusinessSnapshot + recent chat     │
│                                                                     │
│ Contains:                                                          │
│ • Business type, region, store count, product count                │
│ • Owner goals (top 3), risk tolerance, communication preference    │
│ • Current KPIs: avg margin, top categories, active alerts count    │
│ • Last 3 conversation turns (user + assistant messages)            │
│ • Active action plan status (if any)                               │
│                                                                     │
│ Updated: BusinessSnapshot hourly, Persona after each conversation  │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 2: WARM CONTEXT (on-demand, ~3-10K tokens, cost: DB query)  │
│                                                                     │
│ Assembled from: KnowledgeEntry (topic-filtered) + relevant data    │
│                                                                     │
│ Pulled when: Query topic identified (e.g., "dairy", "suppliers")   │
│                                                                     │
│ Contains:                                                          │
│ • KB entries matching the topic (cached insights, market data)     │
│ • Topic-specific aggregates (e.g., dairy margin breakdown)         │
│ • Relevant previous conversation summaries                        │
│ • Recommendation history for this topic (acted on / ignored)       │
│                                                                     │
│ Updated: KB entries written by sub-agents + scheduled refresh      │
├─────────────────────────────────────────────────────────────────────┤
│ LAYER 3: COLD CONTEXT (expensive, variable tokens, cost: API call) │
│                                                                     │
│ Assembled from: Raw DB queries + external API calls                │
│                                                                     │
│ Pulled when: Layer 1+2 insufficient for the question               │
│                                                                     │
│ Contains:                                                          │
│ • Raw product/invoice/supplier data (filtered to relevant subset)  │
│ • Fresh external research (Tavily/Perplexity)                     │
│ • Detailed competitor price comparisons                            │
│                                                                     │
│ Results cached to KB immediately (moves to Layer 2 for next time) │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Tenant Persona Model

Stored as a JSON document in the `TenantPersona` table. Updated incrementally after each conversation.

```json
{
  "businessProfile": {
    "type": "grocery",
    "subType": "independent_grocer",
    "region": "VIC",
    "storeCount": 1,
    "avgMonthlyInvoices": 45,
    "productCount": 2340,
    "supplierCount": 12,
    "primaryCategories": ["dairy", "bakery", "beverages"],
    "estimatedAnnualRevenue": "500k-1m"
  },
  "ownerProfile": {
    "goals": [
      {"goal": "Increase overall margins to 25%", "priority": 1, "setAt": "2026-03-01", "baseline": 22.4},
      {"goal": "Open second store by end of year", "priority": 2, "setAt": "2026-03-15"}
    ],
    "riskTolerance": "moderate",
    "decisionStyle": "data_driven",
    "knowledgeLevel": "intermediate",
    "communicationPref": "concise_with_numbers",
    "topicsOfInterest": ["dairy_margins", "supplier_costs", "pricing_strategy"],
    "topicsNotInterested": []
  },
  "interactionHistory": {
    "totalConversations": 23,
    "totalMessages": 142,
    "avgMessagesPerSession": 6.2,
    "recommendationsGiven": 14,
    "recommendationsActedOn": 8,
    "lastConversation": "2026-03-19",
    "feedbackScore": 4.2
  }
}
```

**Update Mechanism**: After each conversation ends (3+ minutes of inactivity or explicit close), a lightweight Claude call (~500 tokens) extracts persona updates:
```
System: "Extract any persona updates from this conversation.
         Return JSON diff only. Fields: goals, riskTolerance,
         decisionStyle, knowledgeLevel, communicationPref,
         topicsOfInterest. Return {} if no updates."
```
Cost: ~$0.001 per conversation.

### 4.3 Business Snapshot

Pre-computed aggregate of all tenant business metrics. Refreshed by scheduled background job.

```json
{
  "refreshedAt": "2026-03-20T06:00:00Z",

  "financial": {
    "avgMargin": 22.4,
    "marginByCategory": {"dairy": 18.1, "bakery": 31.2, "beverages": 24.8},
    "totalMonthlyCost": 48200,
    "costTrendVsLastMonth": 3.2,
    "costTrendVsLastQuarter": 5.1
  },

  "suppliers": {
    "count": 12,
    "topBySpend": [
      {"name": "Murray's Dairy", "spendPct": 38, "trend": "rising", "rate": 8.2},
      {"name": "WideBay Bakery", "spendPct": 22, "trend": "stable", "rate": 1.1}
    ],
    "concentrationRisk": "high",
    "concentrationDetail": "Top 2 suppliers = 60% of total spend"
  },

  "products": {
    "totalActive": 2340,
    "belowTargetMargin": 47,
    "noRecentInvoice90d": 12,
    "topByMargin": [],
    "bottomByMargin": [],
    "avgHealthScore": 68.4
  },

  "competitors": {
    "monitorsActive": 8,
    "avgPricePosition": -4.2,
    "openOpportunities": 3,
    "activeThreats": 2
  },

  "pipeline": {
    "pendingInvoices": 3,
    "awaitingReview": 7,
    "readyToExport": 12
  },

  "alerts": {
    "critical": 2,
    "warning": 5,
    "info": 8
  }
}
```

**Refresh Schedule**: Hourly via `node-cron`. Cost: $0 (pure SQL aggregation).

### 4.4 Knowledge Base

Persistent cache of insights, research results, and derived intelligence.

**Entry Types**:

| Type | Source | Typical Expiry | Example |
|------|--------|---------------|---------|
| `internal_insight` | Sub-agent analysis | Never (refreshed on data change) | "Murray's dairy costs up 8% in 6 months" |
| `market_research` | Tavily search | 7 days | "Australian dairy wholesale prices up 4% in 2026" |
| `deep_research` | Perplexity Sonar | 7 days | "Three bulk dairy suppliers in VIC offer volume discounts" |
| `consumer_trend` | Google Trends | 14 days | "Oat milk searches up 45% YoY in Victoria" |
| `sector_benchmark` | Tavily/Perplexity | 30 days | "Grocery sector avg margin: 25-28% in AU" |
| `recommendation_outcome` | Outcome tracking | Never | "Supplier negotiation recommended 2026-02-15, acted on, margin +2.3%" |
| `conversation_summary` | Post-conversation | 90 days | "Discussed dairy margins, recommended supplier negotiation" |
| `strategy_plan` | Strategy Agent | Never (manual archive) | "Q1 Action Plan: 5 steps, 3 completed" |

**Retrieval Strategy**: Keyword matching on `topic` + `category` fields. For Phase 1, simple text search. Phase 2+: vector embeddings for semantic search.

---

## 5. Shared Intelligence Layer

Cross-tenant anonymised intelligence that makes every tenant's agent smarter.

### 5.1 Data Flow

```
┌────────────────────────────────────────────────────────────────────┐
│ TENANT LAYER (isolated)                                            │
│                                                                    │
│ Tenant A conversation  →  Anonymise  →  ┐                         │
│ Tenant B conversation  →  Anonymise  →  ├→  SHARED LAYER          │
│ Tenant C recommendation outcome  →  ──  ┘   (no tenant identity)  │
└────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
┌────────────────────────────────────────────────────────────────────┐
│ SHARED INTELLIGENCE TABLES (no tenantId, no RLS)                  │
│                                                                    │
│ SharedQuestionPattern      — question categories + frequency      │
│ SharedRecommendationScore  — which advice types work              │
│ SharedBenchmark            — anonymised industry aggregates       │
│ SharedTrendSignal          — cross-tenant pattern detection       │
│ SharedResponseQuality      — feedback on response styles          │
└────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
                                    Feeds back to ALL tenants
```

### 5.2 Anonymisation Rules

**Before ANY data enters the shared layer**:

| Data Point | Anonymisation |
|-----------|---------------|
| tenantId | STRIPPED (replaced with anonymous hash, not reversible) |
| Actual numbers (margin %, cost $) | BUCKETED ("15-20%", "$40k-60k") |
| Supplier/product names | STRIPPED (replaced with category: "dairy_supplier") |
| Location | STATE LEVEL only ("Melbourne" → "VIC") |
| Dates | MONTH LEVEL only (not exact day) |
| Conversation text | CLASSIFIED to category (never stored raw) |
| User identity | STRIPPED completely |

### 5.3 Privacy Protection

**k-Anonymity**: No aggregate published with fewer than 10 tenants in the group.

**Differential Privacy**: Statistical noise added to all published aggregates (±0.5% for margins, ±2 for counts).

**Consent Tiers** (configurable in tenant Settings):

| Tier | Default | What's Shared |
|------|---------|--------------|
| **Tier 1: Benchmarks** | Opt-in (default on) | Anonymised margins and costs contribute to industry averages |
| **Tier 2: Patterns** | Opt-in (default off) | Question categories + recommendation outcomes improve advice quality |
| **Tier 3: Trends** | Opt-in (default off) | Receive early-warning alerts when many retailers see the same pattern |

**Full opt-out**: Tenant excluded from all shared aggregates. Still benefits from their own KB.

### 5.4 Shared Intelligence Systems

#### System 1: Industry Benchmarks

**Nightly batch job** computes anonymised aggregates grouped by `businessType + region`:

```json
{
  "businessType": "grocery",
  "region": "VIC",
  "tenantCount": 87,
  "period": "2026-03",
  "metrics": {
    "overallMargin": {"median": 24.3, "p25": 21.0, "p75": 28.0},
    "dairyMargin": {"median": 22.1, "p25": 18.0, "p75": 26.0},
    "bakeryMargin": {"median": 29.8, "p25": 25.0, "p75": 34.0},
    "supplierCount": {"median": 8, "p25": 5, "p75": 12},
    "invoiceFrequency": {"median": 12, "p25": 6, "p75": 20},
    "topSupplierConcentration": {"median": 35, "p25": 25, "p75": 48},
    "autoMatchRate": {"median": 91, "p25": 85, "p75": 96}
  }
}
```

**Agent uses it**: "Your dairy margin (18%) sits in the bottom quartile for Victorian grocery stores. The median is 22.1%."

#### System 2: Recommendation Effectiveness Scores

**After each recommendation + outcome tracking**:

```json
{
  "recommendationType": "supplier_negotiation",
  "businessType": "grocery",
  "category": "dairy",
  "sampleSize": 89,
  "actedOnRate": 0.73,
  "positiveOutcomeRate": 0.80,
  "avgImpact": -2.8,
  "impactUnit": "cost_reduction_pct",
  "confidenceScore": 0.91,
  "avgTimeToResult": "2-4 weeks"
}
```

**Agent uses it**: "I recommend negotiating with your dairy supplier. 73% of similar grocery businesses who tried this saw an average cost reduction of 2.8%."

#### System 3: Collective Trend Detection

**Monitors anonymised signals across tenants**:

- If >30% of tenants in same businessType + region show same pattern within 30 days → flag as TREND
- Patterns detected: cost increases by category, question spikes, margin compression

**Agent uses it**: "Heads up — 36% of grocery retailers in Victoria are reporting dairy cost increases this month. Want me to check your dairy supplier invoices?"

#### System 4: Response Quality Learning

**Track thumbs-up/down per response structure**:

```json
{
  "questionCategory": "pricing_strategy",
  "responseStructure": "step_by_step_plan",
  "includesNumbers": true,
  "includesBenchmark": true,
  "satisfactionRate": 0.87,
  "sampleSize": 234
}
```

**Agent uses it**: System prompt includes learned preferences — "For pricing questions, always use step-by-step format with specific numbers."

---

## 6. Cost Control Architecture

### 6.1 Resolution Ladder

Every query escalates through cost tiers, stopping at the cheapest sufficient level:

```
LEVEL 1 — TEMPLATE ($0)
  Trigger: Simple data lookups ("What's my margin?", "How many products?")
  Method:  Read BusinessSnapshot, format with template string
  Example: "Your average margin is {snapshot.financial.avgMargin}%"

LEVEL 2 — KB LOOKUP + SMALL LLM (~$0.01)
  Trigger: Question matches KB topic with non-expired entry
  Method:  Retrieve KB entries, small Claude call to format conversationally
  Example: KB has dairy margin data + supplier trend → Claude formats answer

LEVEL 3 — INTERNAL ANALYSIS + LLM (~$0.02-0.05)
  Trigger: Question requires data not in snapshot or KB
  Method:  Sub-agent runs Prisma aggregation, Claude interprets results
  Example: "Which products should I reprice?" → query + Claude ranking

LEVEL 4 — EXTERNAL RESEARCH + LLM (~$0.08-0.15)
  Trigger: Question requires market/competitor data not cached
  Method:  Tavily/Perplexity call + cache result + Claude synthesis
  Example: "What are organic food trends in my area?"

LEVEL 5 — MULTI-AGENT STRATEGY (~$0.15-0.30)
  Trigger: Complex planning questions requiring multiple data sources
  Method:  Strategy Agent coordinates sub-agents, synthesises plan
  Example: "Build me a plan to improve margins to 25%"
```

### 6.2 Token Budgets Per Tier

| Plan Tier | Simple Q | Analysis Q | Research Q | Strategy Q | Monthly Cap |
|-----------|----------|-----------|-----------|-----------|-------------|
| Professional | 3K tokens | 8K tokens | BLOCKED | 15K tokens | 200 messages |
| Enterprise | 3K tokens | 10K tokens | 15K tokens | 25K tokens | 1000 messages |

If a query would exceed budget: summarise input more aggressively, skip external research, or inform user of tier limitation.

### 6.3 Knowledge Compounding

The system gets cheaper over time as the KB fills:

| Tenant Age | KB Size | Avg Query Cost | External API % |
|-----------|---------|---------------|----------------|
| Month 1 | ~0 entries | ~$0.08 | ~60% |
| Month 3 | ~120 entries | ~$0.04 | ~25% |
| Month 6 | ~300 entries | ~$0.02 | ~10% |

### 6.4 Scheduled Refresh (Background)

Instead of real-time research, pre-compute on a schedule:

| What | Frequency | Cost Per Refresh |
|------|-----------|-----------------|
| Business Snapshot (internal) | Hourly | $0 (SQL) |
| Product Health Scores | Nightly | $0 (arithmetic) |
| Supplier Trend Analysis | Weekly | ~$0.02 (small LLM for interpretation) |
| Market Sector Trends | Weekly | ~$0.05 (Tavily) |
| Competitor Positioning | Weekly | ~$0.05 (Tavily) |
| Deep Industry Research | Monthly | ~$0.15 (Perplexity) |
| Persona Model Update | Per conversation | ~$0.001 |
| **Total Background Cost** | **Monthly** | **~$2-4 per tenant** |

---

## 7. Database Schema Additions

### 7.1 New Models (Tenant-Scoped, RLS-Protected)

```prisma
// ─── CHAT & CONVERSATIONS ────────────────────────────────

model ChatConversation {
  id        String   @id @default(uuid())
  tenantId  String
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  title     String?                     // Auto-generated from first message
  status    ChatStatus @default(ACTIVE) // ACTIVE, ARCHIVED
  messageCount Int   @default(0)
  lastMessageAt DateTime?
  summary   String?                     // Rolling conversation summary
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages  ChatMessage[]

  @@index([tenantId, userId, createdAt])
  @@index([tenantId, status])
}

model ChatMessage {
  id              String   @id @default(uuid())
  conversationId  String
  conversation    ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role            MessageRole      // USER, ASSISTANT, SYSTEM
  content         String           // Message text (markdown)
  metadata        Json?            // Tool calls, sources, confidence
  tokenCount      Int?             // Tokens used for this message
  costUsd         Float?           // Cost of this message
  resolutionLevel Int?             // Which level of resolution ladder was used (1-5)
  feedbackScore   Int?             // User feedback: 1 (thumbs down) or 5 (thumbs up)
  createdAt       DateTime @default(now())

  @@index([conversationId, createdAt])
}

enum ChatStatus {
  ACTIVE
  ARCHIVED
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}


// ─── TENANT PERSONA & KNOWLEDGE BASE ─────────────────────

model TenantPersona {
  id        String   @id @default(uuid())
  tenantId  String   @unique        // One persona per tenant
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  persona   Json                     // Full persona JSON (see Section 4.2)
  version   Int      @default(1)    // Incremented on each update
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model BusinessSnapshot {
  id         String   @id @default(uuid())
  tenantId   String   @unique       // One current snapshot per tenant
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  snapshot   Json                    // Full snapshot JSON (see Section 4.3)
  refreshedAt DateTime @default(now())
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

model KnowledgeEntry {
  id         String   @id @default(uuid())
  tenantId   String
  tenant     Tenant   @relation(fields: [tenantId], references: [id])
  category   KnowledgeCategory        // SUPPLIER, MARKET, PRODUCT, STRATEGY, etc.
  topic      String                    // Searchable topic tag (e.g., "dairy_cost_trends")
  insight    String                    // The actual insight text
  source     KnowledgeSource           // INTERNAL_ANALYSIS, TAVILY, PERPLEXITY, GOOGLE_TRENDS, AGENT_SYNTHESIS
  confidence Float    @default(0.8)   // 0-1 confidence score
  metadata   Json?                     // Source URLs, query used, sub-agent that produced it
  expiresAt  DateTime?                 // null = never expires (internal insights)
  usedCount  Int      @default(0)     // How many times this entry was used in responses
  lastUsedAt DateTime?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([tenantId, category, topic])
  @@index([tenantId, expiresAt])
}

enum KnowledgeCategory {
  SUPPLIER
  MARKET
  PRODUCT
  PRICING
  COMPETITOR
  STRATEGY
  CONSUMER_TREND
  SECTOR_BENCHMARK
  CONVERSATION
}

enum KnowledgeSource {
  INTERNAL_ANALYSIS
  TAVILY
  PERPLEXITY
  GOOGLE_TRENDS
  AGENT_SYNTHESIS
  USER_PROVIDED
}


// ─── BUSINESS GOALS & ACTION PLANS ───────────────────────

model BusinessGoal {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  title       String                    // "Increase margins to 25%"
  description String?                   // Longer context
  targetMetric String?                  // "avg_margin"
  targetValue  Float?                   // 25.0
  baselineValue Float?                  // 22.4 (at time of goal creation)
  currentValue Float?                   // Updated periodically
  deadline    DateTime?
  status      GoalStatus @default(ACTIVE)  // ACTIVE, ACHIEVED, PAUSED, ABANDONED
  priority    Int       @default(1)     // 1 = highest priority
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  actionPlans ActionPlan[]

  @@index([tenantId, status])
}

model ActionPlan {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  goalId      String?
  goal        BusinessGoal? @relation(fields: [goalId], references: [id])
  title       String                    // "Q1 Margin Improvement Plan"
  summary     String                    // AI-generated plan overview
  status      PlanStatus @default(ACTIVE) // ACTIVE, COMPLETED, PAUSED, ARCHIVED
  progressPct Int       @default(0)     // 0-100
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  steps       ActionStep[]

  @@index([tenantId, status])
}

model ActionStep {
  id          String   @id @default(uuid())
  planId      String
  plan        ActionPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  stepNumber  Int
  title       String                    // "Negotiate with Murray's Dairy"
  description String                    // Detailed guidance
  status      StepStatus @default(PENDING)  // PENDING, IN_PROGRESS, COMPLETED, SKIPPED
  dueDate     DateTime?
  outcome     String?                   // What happened when user acted on it
  outcomeMetric Float?                  // Measurable result (e.g., -2.8% cost)
  completedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([planId, stepNumber])
}

enum GoalStatus {
  ACTIVE
  ACHIEVED
  PAUSED
  ABANDONED
}

enum PlanStatus {
  ACTIVE
  COMPLETED
  PAUSED
  ARCHIVED
}

enum StepStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  SKIPPED
}


// ─── CHAT FEEDBACK (for shared intelligence) ────────────

model ChatFeedback {
  id          String   @id @default(uuid())
  tenantId    String
  tenant      Tenant   @relation(fields: [tenantId], references: [id])
  messageId   String
  message     ChatMessage @relation(fields: [messageId], references: [id])
  score       Int                       // 1 (thumbs down) or 5 (thumbs up)
  reason      String?                   // Optional feedback text
  createdAt   DateTime @default(now())

  @@unique([messageId])                 // One feedback per message
  @@index([tenantId, createdAt])
}
```

### 7.2 Shared Intelligence Models (No tenantId, No RLS)

```prisma
// ─── SHARED INTELLIGENCE (cross-tenant, anonymised) ──────

model SharedBenchmark {
  id            String   @id @default(uuid())
  businessType  String                  // "grocery", "pharmacy", etc.
  region        String                  // "VIC", "NSW", "AU" (state level)
  period        String                  // "2026-03" (month level)
  metricName    String                  // "overall_margin", "dairy_margin", etc.
  median        Float
  p25           Float
  p75           Float
  sampleSize    Int                     // Number of tenants (must be >= 10)
  computedAt    DateTime @default(now())

  @@unique([businessType, region, period, metricName])
  @@index([businessType, region, period])
}

model SharedRecommendationScore {
  id                  String   @id @default(uuid())
  recommendationType  String                  // "supplier_negotiation", "product_expansion", etc.
  businessType        String
  category            String?                 // "dairy", "bakery", null (general)
  sampleSize          Int
  actedOnRate         Float                   // 0-1
  positiveOutcomeRate Float                   // 0-1 (of those who acted)
  avgImpact           Float                   // e.g., -2.8 (cost reduction %)
  impactUnit          String                  // "cost_reduction_pct", "margin_lift_pct"
  confidenceScore     Float                   // Computed from sample size + outcome rate
  avgTimeToResult     String?                 // "2-4 weeks"
  computedAt          DateTime @default(now())

  @@unique([recommendationType, businessType, category])
  @@index([businessType, confidenceScore])
}

model SharedQuestionPattern {
  id            String   @id @default(uuid())
  businessType  String
  region        String
  period        String                  // "2026-03"
  category      String                  // "cost_analysis", "pricing_strategy", etc.
  subcategory   String                  // "cost_increase", "margin_improvement", etc.
  productCategory String?               // "dairy", "bakery", null
  count         Int                     // How many tenants asked about this
  totalTenants  Int                     // Total tenants in this group
  percentage    Float                   // count / totalTenants
  computedAt    DateTime @default(now())

  @@unique([businessType, region, period, category, subcategory, productCategory])
  @@index([businessType, region, period])
}

model SharedTrendSignal {
  id            String    @id @default(uuid())
  businessType  String
  region        String
  signalType    String                  // "cost_increase", "margin_compression", etc.
  category      String?                 // "dairy", null
  description   String                  // Human-readable trend description
  affectedPct   Float                   // % of tenants affected
  severity      String                  // "info", "warning", "critical"
  detectedAt    DateTime  @default(now())
  expiresAt     DateTime                // When to stop showing this alert
  isActive      Boolean   @default(true)

  @@index([businessType, region, isActive])
  @@index([detectedAt])
}

model SharedResponseQuality {
  id                String   @id @default(uuid())
  questionCategory  String                  // "pricing_strategy"
  responseStructure String                  // "step_by_step", "narrative", "data_table"
  includesNumbers   Boolean
  includesBenchmark Boolean
  includesComparison Boolean
  sampleSize        Int
  satisfactionRate  Float                   // 0-1
  computedAt        DateTime @default(now())

  @@unique([questionCategory, responseStructure])
}

// ─── CONSENT TRACKING ────────────────────────────────────

model TenantSharingConsent {
  id        String   @id @default(uuid())
  tenantId  String   @unique
  tenant    Tenant   @relation(fields: [tenantId], references: [id])
  benchmarkOptIn Boolean @default(true)    // Tier 1
  patternOptIn   Boolean @default(false)   // Tier 2
  trendOptIn     Boolean @default(false)   // Tier 3
  consentedAt    DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

---

## 8. API Endpoints

### 8.1 Chat Endpoints

```
POST   /api/chat/conversations              Create new conversation
GET    /api/chat/conversations              List conversations (paginated)
GET    /api/chat/conversations/:id          Get conversation with messages
DELETE /api/chat/conversations/:id          Archive conversation
POST   /api/chat/conversations/:id/messages Send message (returns SSE stream)
POST   /api/chat/messages/:id/feedback      Submit thumbs up/down
```

### 8.2 Goals & Plans Endpoints

```
POST   /api/chat/goals                      Create business goal
GET    /api/chat/goals                      List goals
PATCH  /api/chat/goals/:id                  Update goal (status, target)
DELETE /api/chat/goals/:id                  Delete goal

GET    /api/chat/plans                      List action plans
GET    /api/chat/plans/:id                  Get plan with steps
PATCH  /api/chat/plans/:id/steps/:stepId    Update step status/outcome
```

### 8.3 Knowledge Base Endpoints (internal use by agents)

```
GET    /api/chat/knowledge                  Search KB entries (by topic/category)
POST   /api/chat/knowledge                  Create KB entry (sub-agent use)
DELETE /api/chat/knowledge/:id              Delete KB entry
```

### 8.4 Persona & Snapshot Endpoints (internal use by agents)

```
GET    /api/chat/persona                    Get tenant persona
GET    /api/chat/snapshot                   Get business snapshot
```

### 8.5 Shared Intelligence Endpoints

```
GET    /api/chat/benchmarks                 Get industry benchmarks for tenant's type/region
GET    /api/chat/trends                     Get active trend signals
```

### 8.6 Consent Management

```
GET    /api/settings/sharing-consent        Get current consent settings
PATCH  /api/settings/sharing-consent        Update consent tiers
```

### 8.7 Streaming Protocol

Chat message responses use **Server-Sent Events (SSE)**:

```
POST /api/chat/conversations/:id/messages
Content-Type: application/json
Body: { "content": "How can I improve my dairy margins?" }

Response: text/event-stream

event: status
data: {"stage": "classifying"}

event: status
data: {"stage": "assembling_context", "layers": ["hot", "warm"]}

event: status
data: {"stage": "analysing", "tools": ["analyse_pricing", "search_knowledge_base"]}

event: delta
data: {"content": "Your dairy margins are currently at "}

event: delta
data: {"content": "18.1%, which is below the "}

event: delta
data: {"content": "industry median of 22.1% for Victorian grocery stores."}

event: sources
data: {"sources": [{"type": "internal", "label": "Product margin analysis"}, {"type": "benchmark", "label": "VIC grocery benchmark (n=87)"}]}

event: metadata
data: {"messageId": "msg_xxx", "tokenCount": 847, "costUsd": 0.02, "resolutionLevel": 2}

event: done
data: {}
```

---

## 9. Frontend Components

### 9.1 Page Structure

```
client/src/pages/BusinessAdvisor.jsx          Main page (chat + panels)

client/src/components/advisor/
  ├── ChatPanel.jsx                            Chat message thread
  ├── ChatInput.jsx                            Message input with suggestions
  ├── ChatMessage.jsx                          Individual message (user/assistant)
  ├── StreamingMessage.jsx                     Renders SSE stream in real-time
  ├── MessageFeedback.jsx                      Thumbs up/down component
  ├── MessageSources.jsx                       Source citations display
  ├── GoalPanel.jsx                            Business goals sidebar
  ├── GoalCard.jsx                             Individual goal with progress
  ├── ActionPlanCard.jsx                       Action plan with step checklist
  ├── QuickActions.jsx                         Suggested questions/prompts
  ├── BusinessSnapshotCard.jsx                 Mini KPI overview
  ├── BenchmarkComparison.jsx                  "How you compare" widget
  ├── TrendAlert.jsx                           Industry trend notification
  ├── ConversationList.jsx                     Past conversations sidebar
  └── SharingConsentModal.jsx                  Opt-in/out for shared intelligence
```

### 9.2 Chat Interface Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  RetailEdge  │  Business Advisor                    🎯 Goals (2) │
├──────────────┼───────────────────────────────────┬───────────────┤
│              │                                    │               │
│  Sidebar     │  ┌─ Trend Alert ─────────────────┐ │  GOALS        │
│              │  │ ⚡ 36% of VIC grocery stores   │ │               │
│  Dashboard   │  │ seeing dairy cost increases.   │ │  ┌──────────┐│
│  Invoices    │  │ [Ask about this]               │ │  │ Margins  ││
│  Products    │  └────────────────────────────────┘ │  │ to 25%   ││
│  Pricing     │                                    │  │ ██████░░  ││
│  ...         │  ┌─ Business Snapshot ────────────┐ │  │ 22.4/25% ││
│              │  │ Margin: 22.4% │ Alerts: 7      │ │  └──────────┘│
│  ★ Advisor   │  │ Products: 2,340 │ Pipeline: 22 │ │               │
│              │  └────────────────────────────────┘ │  ┌──────────┐│
│              │                                    │  │ 2nd Store││
│              │  ┌─ Chat Thread ──────────────────┐ │  │ by Dec   ││
│              │  │                                 │ │  │ Planning ││
│              │  │  You: How can I improve my      │ │  └──────────┘│
│              │  │  dairy margins?                 │ │               │
│              │  │                                 │ │  ────────────│
│              │  │  Advisor: Your dairy margins    │ │               │
│              │  │  are at 18.1%, below the        │ │  ACTION PLAN │
│              │  │  industry median of 22.1%.      │ │               │
│              │  │                                 │ │  Q1 Margins  │
│              │  │  Three actions to consider:     │ │  ☑ Audit     │
│              │  │  1. Negotiate with primary...   │ │  ☑ Negotiate │
│              │  │  2. Review markup on top...     │ │  ☐ Reprice   │
│              │  │  3. Consider stocking oat...    │ │  ☐ Monitor   │
│              │  │                                 │ │  ☐ Review    │
│              │  │  📊 Internal data  🏢 Benchmark│ │               │
│              │  │  👍 👎                          │ │               │
│              │  │                                 │ │               │
│              │  └─────────────────────────────────┘ │               │
│              │                                    │               │
│              │  ┌─ Quick Actions ─────────────────┐ │               │
│              │  │ [Margin analysis] [Supplier     │ │               │
│              │  │  costs] [Repricing candidates]  │ │               │
│              │  │ [What's trending] [Review plan] │ │               │
│              │  └────────────────────────────────┘ │               │
│              │                                    │               │
│              │  ┌────────────────────────────────┐ │               │
│              │  │ Ask your advisor...         [→] │ │               │
│              │  └────────────────────────────────┘ │               │
└──────────────┴────────────────────────────────────┴───────────────┘
```

---

## 10. Orchestrator Implementation

### 10.1 Tool Definitions for Claude

The Business Advisor uses Claude's `tool_use` feature. The orchestrator defines tools that map to sub-agent functions:

```javascript
const ADVISOR_TOOLS = [
  {
    name: "query_business_snapshot",
    description: "Get pre-computed business metrics (margin, suppliers, products, alerts). Use this FIRST for any data question.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "search_knowledge_base",
    description: "Search cached insights by topic. Returns previously computed analysis, market research, and recommendations.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to search (e.g., 'dairy_margins', 'supplier_costs')" },
        category: { type: "string", enum: ["SUPPLIER","MARKET","PRODUCT","PRICING","COMPETITOR","STRATEGY","CONSUMER_TREND","SECTOR_BENCHMARK"] }
      },
      required: ["topic"]
    }
  },
  {
    name: "analyse_invoices",
    description: "Analyse invoice data: supplier cost trends, spend concentration, anomalies, seasonal patterns.",
    input_schema: {
      type: "object",
      properties: {
        analysisType: { type: "string", enum: ["cost_trends", "spend_concentration", "anomalies", "seasonal_patterns", "supplier_reliability"] },
        supplierId: { type: "string", description: "Optional: filter to specific supplier" },
        category: { type: "string", description: "Optional: filter to product category" },
        periodMonths: { type: "integer", description: "Lookback period in months (default: 6)" }
      },
      required: ["analysisType"]
    }
  },
  {
    name: "analyse_products",
    description: "Analyse product performance: margins, health scores, dead stock, cross-store comparison.",
    input_schema: {
      type: "object",
      properties: {
        analysisType: { type: "string", enum: ["margin_analysis", "below_target", "repricing_candidates", "category_performance", "dead_stock", "cross_store", "health_scores"] },
        category: { type: "string" },
        storeId: { type: "string" }
      },
      required: ["analysisType"]
    }
  },
  {
    name: "analyse_competitors",
    description: "Analyse competitor positioning: price comparison, alerts, waterfall analysis.",
    input_schema: {
      type: "object",
      properties: {
        analysisType: { type: "string", enum: ["price_position", "active_alerts", "opportunities", "threats"] },
        productId: { type: "string" },
        competitor: { type: "string" }
      },
      required: ["analysisType"]
    }
  },
  {
    name: "get_benchmarks",
    description: "Get anonymised industry benchmarks from similar businesses. Use when user asks 'how do I compare'.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", description: "Metric to benchmark (e.g., 'overall_margin', 'dairy_margin')" }
      },
      required: ["metric"]
    }
  },
  {
    name: "research_market",
    description: "Search external sources for market trends, sector news, competitor intelligence. EXPENSIVE - use only when KB has no cached answer.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Research question" },
        source: { type: "string", enum: ["tavily", "perplexity"], description: "Tavily for broad search, Perplexity for deep cited research" }
      },
      required: ["query"]
    }
  },
  {
    name: "create_action_plan",
    description: "Generate a structured action plan with steps, linked to a business goal.",
    input_schema: {
      type: "object",
      properties: {
        goalId: { type: "string", description: "Business goal this plan addresses" },
        title: { type: "string" },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              dueDate: { type: "string" }
            }
          }
        }
      },
      required: ["title", "steps"]
    }
  },
  {
    name: "get_recommendation_scores",
    description: "Get effectiveness scores for a recommendation type from collective intelligence.",
    input_schema: {
      type: "object",
      properties: {
        recommendationType: { type: "string", description: "e.g., 'supplier_negotiation', 'product_expansion'" }
      },
      required: ["recommendationType"]
    }
  }
];
```

### 10.2 System Prompt Template

```javascript
const buildSystemPrompt = (hotContext) => `
You are the RetailEdge Business Advisor for ${hotContext.persona.businessProfile.type} retailer in ${hotContext.persona.businessProfile.region}.

BUSINESS CONTEXT:
${JSON.stringify(hotContext.snapshot, null, 2)}

OWNER PROFILE:
- Goals: ${hotContext.persona.ownerProfile.goals.map(g => g.goal).join('; ')}
- Communication style: ${hotContext.persona.ownerProfile.communicationPref}
- Knowledge level: ${hotContext.persona.ownerProfile.knowledgeLevel}
- Risk tolerance: ${hotContext.persona.ownerProfile.riskTolerance}

ACTIVE PLAN: ${hotContext.activePlan ? hotContext.activePlan.title + ' (' + hotContext.activePlan.progressPct + '% complete)' : 'None'}

INSTRUCTIONS:
1. Always check query_business_snapshot and search_knowledge_base BEFORE calling expensive tools.
2. Only call research_market if knowledge base has no relevant cached entry.
3. When recommending actions, call get_recommendation_scores to include social proof.
4. Use get_benchmarks when comparing the tenant's metrics to industry.
5. Match communication style to owner profile (${hotContext.persona.ownerProfile.communicationPref}).
6. Include specific numbers and percentages — never vague advice.
7. When suggesting actions, offer to create an action plan with create_action_plan.
8. Always cite data sources: [Internal Data], [Industry Benchmark], [Market Research].

RESPONSE FORMAT (learned from collective feedback):
${hotContext.responseGuidelines}
`;
```

### 10.3 Message Processing Flow

```javascript
async function processMessage(tenantId, conversationId, userMessage) {
  // 1. Load hot context
  const hotContext = await assembleHotContext(tenantId, conversationId);

  // 2. Classify query (no LLM — keyword + pattern matching)
  const classification = classifyQuery(userMessage);

  // 3. Pre-load warm context based on classification
  const warmContext = await assembleWarmContext(tenantId, classification);

  // 4. Check if answerable from template (Level 1)
  const templateAnswer = tryTemplateAnswer(classification, hotContext);
  if (templateAnswer) {
    return { content: templateAnswer, resolutionLevel: 1, cost: 0 };
  }

  // 5. Check if answerable from KB only (Level 2)
  const kbAnswer = tryKBAnswer(classification, warmContext);
  if (kbAnswer) {
    // Small Claude call to format KB entries conversationally
    return await formatWithLLM(kbAnswer, hotContext, { maxTokens: 1000 });
  }

  // 6. Full orchestrator call with tool_use (Levels 3-5)
  const messages = [
    ...hotContext.recentMessages,
    ...warmContext.relevantKBEntries.map(e => ({
      role: 'system', content: `[Cached Insight] ${e.insight}`
    })),
    { role: 'user', content: userMessage }
  ];

  const response = await trackedClaudeCall({
    tenantId,
    userId: hotContext.userId,
    endpoint: 'business_advisor',
    model: 'claude-sonnet-4-20250514',
    messages,
    tools: ADVISOR_TOOLS,
    system: buildSystemPrompt(hotContext),
    maxTokens: classification.tokenBudget
  });

  // 7. Execute tool calls and collect results
  // (Claude's tool_use loop — may call multiple tools)
  const finalResponse = await executeToolLoop(response, tenantId);

  // 8. Post-processing
  await Promise.all([
    saveMessage(conversationId, 'ASSISTANT', finalResponse),
    updateKBFromResponse(tenantId, classification, finalResponse),
    queuePersonaUpdate(tenantId, conversationId),
    logToSharedIntelligence(tenantId, classification, finalResponse)
  ]);

  return finalResponse;
}
```

---

## 11. File Structure

### 11.1 New Server Files

```
server/src/
├── services/
│   └── agents/
│       ├── orchestrator.js           // Main Business Advisor orchestrator
│       ├── contextAssembler.js       // 3-layer context assembly
│       ├── queryClassifier.js        // Keyword/intent classification
│       ├── toolExecutor.js           // Execute Claude tool_use calls
│       ├── invoiceIntelligence.js    // Invoice sub-agent analytics
│       ├── productIntelligence.js    // Product sub-agent analytics
│       ├── pricingIntelligence.js    // Pricing sub-agent analytics
│       ├── competitorIntelligence.js // Competitor sub-agent analytics
│       ├── marketResearch.js         // Tavily/Perplexity integration
│       ├── strategyAgent.js          // Action plan generation
│       ├── knowledgeBase.js          // KB CRUD + search
│       ├── personaManager.js         // Persona read/update
│       └── snapshotGenerator.js      // Business snapshot computation
│
├── services/
│   └── shared/
│       ├── benchmarkEngine.js        // Compute anonymised benchmarks
│       ├── trendDetector.js          // Cross-tenant trend detection
│       ├── recommendationScorer.js   // Track recommendation outcomes
│       ├── responseQualityTracker.js // Track feedback patterns
│       └── anonymiser.js             // Strip tenant identity from data
│
├── routes/
│   ├── chat.js                       // Chat API endpoints
│   ├── goals.js                      // Goals & action plans endpoints
│   └── sharing.js                    // Consent management endpoints
│
├── jobs/
│   ├── snapshotRefresh.js            // Hourly: refresh business snapshots
│   ├── healthScoreCompute.js         // Nightly: product health scores
│   ├── benchmarkCompute.js           // Nightly: shared benchmarks
│   ├── trendDetection.js             // Nightly: cross-tenant trends
│   ├── kbCleanup.js                  // Daily: expire old KB entries
│   └── marketRefresh.js              // Weekly: refresh market research cache
│
└── middleware/
    └── chatRateLimit.js              // Per-tier message rate limiting
```

### 11.2 New Client Files

```
client/src/
├── pages/
│   └── BusinessAdvisor.jsx           // Main advisor page
│
├── components/
│   └── advisor/
│       ├── ChatPanel.jsx
│       ├── ChatInput.jsx
│       ├── ChatMessage.jsx
│       ├── StreamingMessage.jsx
│       ├── MessageFeedback.jsx
│       ├── MessageSources.jsx
│       ├── GoalPanel.jsx
│       ├── GoalCard.jsx
│       ├── ActionPlanCard.jsx
│       ├── QuickActions.jsx
│       ├── BusinessSnapshotCard.jsx
│       ├── BenchmarkComparison.jsx
│       ├── TrendAlert.jsx
│       ├── ConversationList.jsx
│       └── SharingConsentModal.jsx
│
├── hooks/
│   ├── useChat.js                    // Chat state + SSE streaming
│   ├── useGoals.js                   // Goals CRUD
│   └── useBenchmarks.js              // Benchmark data fetching
│
└── services/
    └── api.js                        // Add chat/goals/benchmark API methods
```

---

## 12. External API Integration

### 12.1 Tavily (Primary Search)

```javascript
// server/src/services/agents/marketResearch.js

import Tavily from '@tavily/core';

const tavily = new Tavily({ apiKey: process.env.TAVILY_API_KEY });

async function searchMarket(query, tenantContext) {
  // Enrich query with business context
  const enrichedQuery = `${query} ${tenantContext.businessType} ${tenantContext.region} Australia retail`;

  const result = await tavily.search({
    query: enrichedQuery,
    searchDepth: 'basic',       // 'basic' = 1 credit, 'advanced' = 2 credits
    maxResults: 5,
    includeAnswer: true,        // Get synthesised answer
    includeDomains: [],         // No domain restrictions
    excludeDomains: []
  });

  return {
    answer: result.answer,
    sources: result.results.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content?.substring(0, 200)
    }))
  };
}
```

### 12.2 Perplexity Sonar (Deep Research)

```javascript
async function deepResearch(query, tenantContext) {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{
        role: 'user',
        content: `Research for a ${tenantContext.businessType} retailer in ${tenantContext.region}, Australia: ${query}`
      }],
      max_tokens: 1000
    })
  });

  const data = await response.json();
  return {
    answer: data.choices[0].message.content,
    citations: data.citations || []
  };
}
```

### 12.3 Google Trends (Demand Signals)

```javascript
// Using unofficial Google Trends API or SerpAPI for trends data
async function getConsumerTrends(keywords, region) {
  // Implementation depends on chosen API
  // Returns: trending keywords, interest over time, related queries
}
```

---

## 13. Security Considerations

### 13.1 Tenant Isolation

- All chat routes use `tenantScope` middleware → `req.prisma` is tenant-scoped
- KB entries, conversations, goals, plans all have `tenantId` FK with RLS policies
- Sub-agent tool functions receive `req.prisma` — cannot query across tenants
- Shared intelligence tables have NO tenantId — data is anonymised before insertion

### 13.2 Rate Limiting

```javascript
// server/src/middleware/chatRateLimit.js

const LIMITS = {
  starter:      { messagesPerDay: 0, messagesPerMonth: 0 },       // No access
  professional: { messagesPerDay: 20, messagesPerMonth: 200 },
  enterprise:   { messagesPerDay: 100, messagesPerMonth: 1000 }
};
```

### 13.3 API Key Security

- Tavily, Perplexity, Google Trends API keys stored in environment variables
- Never exposed to client
- All external calls made server-side only

### 13.4 Content Safety

- User messages and AI responses logged for audit
- AI responses never include raw SQL queries or internal system details
- External research results sanitised before caching in KB

---

## 14. Monitoring & Observability

### 14.1 Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|----------------|
| Avg response time | ChatMessage timestamps | >10 seconds |
| Resolution level distribution | ChatMessage.resolutionLevel | >30% at Level 4-5 |
| Claude API cost per tenant/day | ApiUsageLog | >$5/day |
| KB cache hit rate | KnowledgeEntry.usedCount | <50% after month 3 |
| User satisfaction rate | ChatFeedback.score | <70% thumbs up |
| External API error rate | ApiUsageLog.status='error' | >5% |
| Recommendation act-on rate | ActionStep.status changes | Tracking only |

### 14.2 Admin Dashboard Additions

New section in Admin portal:
- Chat usage per tenant (messages, costs, resolution levels)
- KB health (entries, cache hit rate, expiry distribution)
- Shared intelligence stats (benchmark coverage, trend signals active)
- External API usage and costs (Tavily, Perplexity, Trends)
