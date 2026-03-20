# RetailEdge Business AI Agent — Implementation Plan

## Document Info

| Field | Value |
|-------|-------|
| Version | 1.0 |
| Date | 2026-03-20 |
| Status | Draft |
| Related | [BUSINESS_AI_AGENT_DESIGN.md](./BUSINESS_AI_AGENT_DESIGN.md) |

---

## Implementation Phases Overview

```
Phase 1 ─── Foundation + Internal Chat ──────── Weeks 1-4
  │         DB schema, orchestrator, internal
  │         data agents, basic chat UI
  │
Phase 2 ─── Knowledge Base + Context ────────── Weeks 5-7
  │         KB system, persona model, business
  │         snapshot, scheduled jobs
  │
Phase 3 ─── Goals, Plans & Strategy ─────────── Weeks 8-9
  │         Goal setting, action plans,
  │         strategy agent, outcome tracking
  │
Phase 4 ─── External Intelligence ───────────── Weeks 10-11
  │         Tavily, Perplexity, Google Trends
  │         integration, caching, rate limits
  │
Phase 5 ─── Shared Intelligence ─────────────── Weeks 12-14
  │         Benchmarks, recommendation scores,
  │         trend detection, consent management
  │
Phase 6 ─── Polish & Production ─────────────── Weeks 15-16
            Performance, monitoring, admin
            dashboard, documentation, launch
```

---

## Phase 1: Foundation + Internal Data Chat (Weeks 1-4)

**Goal**: User can chat with the AI advisor and get answers based on their own RetailEdge data.

### Week 1: Database Schema + Core Infrastructure

#### 1.1 Database Migration

**File**: `server/prisma/schema.prisma`

Add models:
- `ChatConversation` — tenant-scoped conversations
- `ChatMessage` — individual messages with metadata
- `ChatFeedback` — thumbs up/down per message

```bash
npx prisma migrate dev --name add-chat-models
```

**RLS Policies** (new migration):
- Add RLS on `ChatConversation` (tenantId filter)
- `ChatMessage` protected transitively via conversation FK
- `ChatFeedback` protected transitively via message FK

#### 1.2 Chat Route Scaffolding

**File**: `server/src/routes/chat.js`

Implement endpoints:
- `POST /api/chat/conversations` — create conversation
- `GET /api/chat/conversations` — list conversations (paginated, ordered by lastMessageAt)
- `GET /api/chat/conversations/:id` — get conversation with last 50 messages
- `DELETE /api/chat/conversations/:id` — archive conversation (soft delete)
- `POST /api/chat/conversations/:id/messages` — send message (SSE stream response)
- `POST /api/chat/messages/:id/feedback` — submit feedback

Wire into `server/src/app.js`:
```javascript
import chatRoutes from './routes/chat.js';
app.use('/api/chat', authenticate, tenantScope, chatRoutes);
```

#### 1.3 SSE Streaming Infrastructure

**File**: `server/src/services/agents/orchestrator.js`

Implement the core message processing loop:
1. Receive user message
2. Build system prompt with placeholder context
3. Call Claude with `tool_use` enabled
4. Stream response tokens via SSE
5. Handle tool calls (execute and return results to Claude)
6. Save final message to DB

Use Claude SDK streaming:
```javascript
const stream = await anthropic.messages.stream({
  model: 'claude-sonnet-4-20250514',
  system: systemPrompt,
  messages,
  tools: ADVISOR_TOOLS,
  max_tokens: 2000
});
```

#### 1.4 Rate Limit Middleware

**File**: `server/src/middleware/chatRateLimit.js`

- Count messages per tenant per day/month from `ChatMessage` table
- Check against tier limits (Professional: 200/month, Enterprise: 1000/month)
- Return 429 with remaining quota in response headers

### Week 2: Internal Data Sub-Agents

#### 2.1 Invoice Intelligence Agent

**File**: `server/src/services/agents/invoiceIntelligence.js`

Implement tool functions (all pure Prisma queries, no LLM):

```javascript
export async function getSupplierCostTrends(prisma, { supplierId, category, periodMonths = 6 }) {
  // GROUP BY supplier, category, month
  // Calculate avg cost, cost change %, trend direction
  // Return: [{ supplier, category, month, avgCost, changePct, trend }]
}

export async function getSpendConcentration(prisma) {
  // SUM(lineTotal) GROUP BY supplier
  // Calculate % of total spend per supplier
  // Flag risk: top 2 suppliers > 50% = "high_risk"
  // Return: { suppliers: [...], concentrationRisk, detail }
}

export async function detectCostAnomalies(prisma, { category, thresholdPct = 15 }) {
  // Compare latest invoice line costs to rolling 3-month average
  // Flag lines where deviation > thresholdPct
  // Return: [{ product, supplier, latestCost, avgCost, deviationPct }]
}

export async function getSupplierReliability(prisma) {
  // Per supplier: match success rate, avg OCR confidence, invoice frequency
  // Return: [{ supplier, matchRate, avgConfidence, invoicesPerMonth }]
}
```

#### 2.2 Product & Pricing Intelligence Agent

**File**: `server/src/services/agents/productIntelligence.js`

```javascript
export async function getMarginAnalysis(prisma, { category, storeId }) {
  // Aggregate margins by category (or filtered)
  // Return: { avgMargin, byCategory: [...], byStore: [...] }
}

export async function getBelowTargetProducts(prisma, { limit = 20 }) {
  // Join ProductVariant + PricingRule
  // Find where currentMargin < targetMargin
  // Return: [{ product, variant, currentMargin, targetMargin, gap }]
}

export async function getRepricingCandidates(prisma, { limit = 10 }) {
  // Score by: margin gap × volume impact
  // Return: [{ product, currentPrice, suggestedPrice, impactEstimate }]
}

export async function getCategoryPerformance(prisma) {
  // Rank categories by: avg margin, product count, cost trend
  // Return: [{ category, avgMargin, productCount, trend, rank }]
}

export async function getDeadStockCandidates(prisma, { inactiveDays = 90 }) {
  // Products with no InvoiceLine match in N days
  // Return: [{ product, lastInvoiceDate, daysSinceActivity }]
}
```

#### 2.3 Competitor Intelligence Agent

**File**: `server/src/services/agents/competitorIntelligence.js`

```javascript
export async function getPricePosition(prisma, { productId }) {
  // Our price vs all competitor prices for a product
  // Return: { ourPrice, competitors: [{ name, price, diffPct }], avgPosition }
}

export async function getActiveAlerts(prisma) {
  // Unread/undismissed PriceAlerts
  // Return: [{ product, alertType, severity, description }]
}

export async function getOpportunities(prisma) {
  // Products where we're significantly cheaper than competitors (room to raise)
  // Return: [{ product, ourPrice, competitorAvg, potentialIncrease }]
}
```

#### 2.4 Tool Executor

**File**: `server/src/services/agents/toolExecutor.js`

Map Claude tool calls to sub-agent functions:

```javascript
const TOOL_HANDLERS = {
  query_business_snapshot: async (prisma, input) => { /* ... */ },
  search_knowledge_base:   async (prisma, input) => { /* ... */ },
  analyse_invoices:        async (prisma, input) => { /* ... */ },
  analyse_products:        async (prisma, input) => { /* ... */ },
  analyse_competitors:     async (prisma, input) => { /* ... */ },
  get_benchmarks:          async (prisma, input) => { /* ... */ },
  research_market:         async (prisma, input) => { /* ... */ },
  create_action_plan:      async (prisma, input) => { /* ... */ },
  get_recommendation_scores: async (prisma, input) => { /* ... */ },
};

export async function executeTool(toolName, toolInput, prisma, tenantId) {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) throw new Error(`Unknown tool: ${toolName}`);
  return await handler(prisma, toolInput, tenantId);
}
```

### Week 3: Chat Frontend

#### 3.1 Business Advisor Page

**File**: `client/src/pages/BusinessAdvisor.jsx`

Layout: Three-column (sidebar nav | chat panel | goals panel)
- Conversation list on left (within main panel)
- Chat thread in centre
- Goals/plans panel on right (Phase 3 — show placeholder)

#### 3.2 Chat Components

**Files**:
- `client/src/components/advisor/ChatPanel.jsx` — message thread container
- `client/src/components/advisor/ChatInput.jsx` — input with send button
- `client/src/components/advisor/ChatMessage.jsx` — message bubble (user/assistant)
- `client/src/components/advisor/StreamingMessage.jsx` — SSE consumer, renders tokens in real-time
- `client/src/components/advisor/MessageFeedback.jsx` — thumbs up/down buttons
- `client/src/components/advisor/ConversationList.jsx` — conversation history sidebar
- `client/src/components/advisor/QuickActions.jsx` — suggested prompt buttons

#### 3.3 SSE Hook

**File**: `client/src/hooks/useChat.js`

```javascript
export function useChat(conversationId) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  async function sendMessage(content) {
    // 1. Add user message to state
    // 2. Open SSE connection to POST /api/chat/conversations/:id/messages
    // 3. Process events: status, delta, sources, metadata, done
    // 4. Build streaming content from delta events
    // 5. On done: finalise message in state
  }

  return { messages, sendMessage, isStreaming, streamingContent };
}
```

#### 3.4 API Client Methods

**File**: `client/src/services/api.js` (additions)

```javascript
// Chat
createConversation: () => request('/chat/conversations', { method: 'POST' }),
getConversations: () => request('/chat/conversations'),
getConversation: (id) => request(`/chat/conversations/${id}`),
archiveConversation: (id) => request(`/chat/conversations/${id}`, { method: 'DELETE' }),
submitFeedback: (messageId, score) => request(`/chat/messages/${messageId}/feedback`, {
  method: 'POST', body: JSON.stringify({ score })
}),
```

#### 3.5 Route Registration

**File**: `client/src/App.jsx`

Add route:
```jsx
<Route path="/advisor" element={<BusinessAdvisor />} />
```

Add sidebar item with advisor icon.

### Week 4: Integration Testing + Refinement

#### 4.1 End-to-End Testing

- Test conversation creation → message sending → streaming response → feedback
- Test each sub-agent tool function with real tenant data
- Test rate limiting enforcement per tier
- Test tenant isolation (tenant A cannot see tenant B conversations)

#### 4.2 Query Classification Tuning

**File**: `server/src/services/agents/queryClassifier.js`

Build keyword/pattern classifier:
```javascript
const PATTERNS = {
  cost_analysis:    /cost|spend|expense|supplier.*(price|cost)|invoice.*(trend|pattern)/i,
  margin_analysis:  /margin|profit|markup|percentage/i,
  product_analysis: /product|stock|dead.?stock|slow.?mov|performance/i,
  pricing_strategy: /pric(e|ing)|repric|markup|discount|raise|lower/i,
  competitor:       /competitor|coles|woolworths|aldi|compare|position/i,
  market_research:  /market|trend|industry|sector|consumer|demand/i,
  strategy:         /plan|strategy|goal|improve|grow|expand|how.*(can|should)/i,
  benchmark:        /benchmark|compare|average|median|industry.*(avg|average)/i,
};
```

#### 4.3 System Prompt Refinement

Iterate on system prompt with real conversations:
- Test with various question types
- Tune tool selection accuracy
- Ensure response format matches communication preference

### Phase 1 Deliverables

| Deliverable | Status Criteria |
|-------------|----------------|
| Chat DB schema + migrations | Migrations applied, RLS active |
| Chat API endpoints (6) | All returning correct data |
| SSE streaming | Tokens stream in real-time |
| 3 sub-agents (invoice, product, competitor) | Each returns structured data |
| Tool executor | Claude correctly calls tools and uses results |
| Chat UI (full page) | Conversation list, chat, streaming, feedback |
| Rate limiting | Enforced per tier |
| Tenant isolation | Verified via test |

---

## Phase 2: Knowledge Base + Context System (Weeks 5-7)

**Goal**: The agent remembers past conversations, builds a business profile, and pre-computes insights for faster/cheaper responses.

### Week 5: Knowledge Base

#### 5.1 Database Models

Add to schema.prisma:
- `KnowledgeEntry` — cached insights with topic, category, source, expiry
- `TenantPersona` — business owner profile JSON
- `BusinessSnapshot` — pre-computed metrics JSON

Run migration.

#### 5.2 Knowledge Base Service

**File**: `server/src/services/agents/knowledgeBase.js`

```javascript
export async function searchKB(prisma, tenantId, { topic, category }) {
  // Search KnowledgeEntry by topic keyword + category
  // Filter out expired entries
  // Order by confidence DESC, usedCount DESC
  // Increment usedCount + lastUsedAt on returned entries
}

export async function writeKB(prisma, tenantId, entry) {
  // Upsert KnowledgeEntry (dedup by tenantId + category + topic)
  // Set expiresAt based on source type
}

export async function cleanExpiredKB() {
  // Delete entries where expiresAt < now()
  // Called by daily cron job
}
```

#### 5.3 Integrate KB into Orchestrator

Update `orchestrator.js`:
- `search_knowledge_base` tool now queries real KB
- After each response, extract insights and write to KB
- KB lookup happens BEFORE expensive tool calls

### Week 6: Business Snapshot + Scheduled Jobs

#### 6.1 Snapshot Generator

**File**: `server/src/services/agents/snapshotGenerator.js`

```javascript
export async function generateSnapshot(tenantId) {
  const prisma = createTenantClient(tenantId);

  const snapshot = {
    refreshedAt: new Date().toISOString(),
    financial: await computeFinancialMetrics(prisma),
    suppliers: await computeSupplierMetrics(prisma),
    products: await computeProductMetrics(prisma),
    competitors: await computeCompetitorMetrics(prisma),
    pipeline: await computePipelineMetrics(prisma),
    alerts: await computeAlertCounts(prisma)
  };

  await basePrisma.businessSnapshot.upsert({
    where: { tenantId },
    create: { tenantId, snapshot },
    update: { snapshot, refreshedAt: new Date() }
  });
}
```

#### 6.2 Scheduled Jobs

**File**: `server/src/jobs/snapshotRefresh.js`

```javascript
import cron from 'node-cron';

// Hourly: refresh business snapshots for all active tenants
cron.schedule('0 * * * *', async () => {
  const tenants = await basePrisma.tenant.findMany({
    where: { isLocked: false },
    select: { id: true }
  });

  for (const tenant of tenants) {
    await generateSnapshot(tenant.id).catch(err =>
      console.error(`Snapshot failed for tenant ${tenant.id}:`, err)
    );
  }
});
```

**File**: `server/src/jobs/kbCleanup.js`

```javascript
// Daily at 3am: clean expired KB entries
cron.schedule('0 3 * * *', async () => {
  await basePrisma.knowledgeEntry.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });
});
```

#### 6.3 Snapshot Tool Integration

Update `query_business_snapshot` tool to read from `BusinessSnapshot` table instead of computing on-the-fly.

### Week 7: Persona Model + Context Assembly

#### 7.1 Persona Manager

**File**: `server/src/services/agents/personaManager.js`

```javascript
export async function getOrCreatePersona(prisma, tenantId) {
  // Return existing persona or create default from tenant data
}

export async function updatePersona(tenantId, conversationId) {
  // Load conversation messages
  // Small Claude call: "Extract persona updates from this conversation"
  // Merge updates into existing persona JSON
  // Save with version increment
}
```

Auto-initialise persona from existing tenant data:
- `businessProfile.type` → inferred from product categories
- `businessProfile.storeCount` → from Store table
- `businessProfile.productCount` → from Product count
- `businessProfile.supplierCount` → from Supplier count

#### 7.2 Context Assembler

**File**: `server/src/services/agents/contextAssembler.js`

```javascript
export async function assembleHotContext(tenantId, conversationId) {
  const [persona, snapshot, recentMessages] = await Promise.all([
    getOrCreatePersona(prisma, tenantId),
    getSnapshot(tenantId),
    getRecentMessages(conversationId, 6)  // last 3 turns (user+assistant)
  ]);

  return { persona, snapshot, recentMessages, userId: /* from auth */ };
}

export async function assembleWarmContext(tenantId, classification) {
  const kbEntries = await searchKB(prisma, tenantId, {
    topic: classification.topics,
    category: classification.categories
  });

  const conversationSummaries = await getRelatedSummaries(
    prisma, tenantId, classification.topics
  );

  return { kbEntries, conversationSummaries };
}
```

#### 7.3 Resolution Ladder Implementation

Update orchestrator to implement 5-level resolution:
1. Template response (check snapshot for simple data lookups)
2. KB + small format call
3. Internal data analysis + LLM
4. External research (blocked until Phase 4)
5. Multi-agent strategy (blocked until Phase 3)

### Phase 2 Deliverables

| Deliverable | Status Criteria |
|-------------|----------------|
| Knowledge Base (CRUD + search + expiry) | Entries created and retrieved correctly |
| Business Snapshot (auto-refresh) | Hourly job running, snapshot accurate |
| Tenant Persona (auto-create + update) | Persona initialised from data, updated after conversations |
| Context Assembler (3 layers) | Hot context always loaded, warm loaded on-demand |
| Resolution Ladder (Levels 1-3) | Simple questions answered without full LLM call |
| KB cache hit tracking | usedCount incrementing, cache hits reducing costs |
| Scheduled jobs (snapshot, cleanup) | Cron jobs running reliably |

---

## Phase 3: Goals, Plans & Strategy Agent (Weeks 8-9)

**Goal**: Users can set business goals, the AI generates action plans, and progress is tracked.

### Week 8: Goals & Plans Backend

#### 8.1 Database Models

Add to schema.prisma:
- `BusinessGoal` — tenant goals with target metrics
- `ActionPlan` — plans linked to goals
- `ActionStep` — individual steps with status tracking

Run migration.

#### 8.2 Goals Route

**File**: `server/src/routes/goals.js`

Endpoints:
- `POST /api/chat/goals` — create goal
- `GET /api/chat/goals` — list active goals
- `PATCH /api/chat/goals/:id` — update goal (status, currentValue)
- `DELETE /api/chat/goals/:id` — soft delete (mark ABANDONED)
- `GET /api/chat/plans` — list plans (with step counts)
- `GET /api/chat/plans/:id` — get plan with steps
- `PATCH /api/chat/plans/:id/steps/:stepId` — update step status/outcome

#### 8.3 Strategy Agent

**File**: `server/src/services/agents/strategyAgent.js`

```javascript
export async function generateActionPlan(prisma, tenantId, { goalId, title, context }) {
  // 1. Load goal details
  // 2. Load business snapshot + relevant KB entries
  // 3. Load recommendation scores for relevant action types
  // 4. Claude call: "Generate a prioritised action plan..."
  // 5. Save ActionPlan + ActionSteps to DB
  // Return plan with steps
}

export async function evaluateProgress(prisma, tenantId, goalId) {
  // 1. Load goal with baseline and current values
  // 2. Load associated plan with step completion %
  // 3. Small Claude call to assess progress
  // Return: { progressPct, onTrack, summary, nextAction }
}
```

#### 8.4 Outcome Tracking

When a user marks an ActionStep as completed with an outcome:
- Record outcome metric (e.g., cost_reduced: -2.8%)
- Update goal's currentValue
- Write to KB: "Recommendation X was tried, result was Y"
- Queue for shared intelligence (anonymised)

### Week 9: Goals & Plans Frontend

#### 9.1 Goal Panel

**Files**:
- `client/src/components/advisor/GoalPanel.jsx` — right sidebar panel
- `client/src/components/advisor/GoalCard.jsx` — individual goal with progress bar
- `client/src/components/advisor/ActionPlanCard.jsx` — plan with step checklist

#### 9.2 Goal Setting Flow

In chat, when user mentions a goal:
- Agent detects goal intent ("I want to increase margins to 25%")
- Offers to create a formal goal: "Would you like me to track this as a goal?"
- On confirmation: creates BusinessGoal + offers to generate ActionPlan

#### 9.3 Plan Interaction

- Steps displayed as interactive checklist
- User can mark steps as completed, add outcomes
- Agent can reference plan in conversations: "Step 3 of your margin plan is to..."
- Progress bar shows % complete

### Phase 3 Deliverables

| Deliverable | Status Criteria |
|-------------|----------------|
| Goals CRUD (API + UI) | Goals created, displayed, updated |
| Action Plans (API + UI) | Plans generated by AI, steps interactive |
| Strategy Agent | Generates contextual plans using snapshot + KB |
| Outcome tracking | Step completion + metrics recorded |
| Chat-Goal integration | Agent references goals in conversation |
| Progress tracking | Goal currentValue updated from data |

---

## Phase 4: External Intelligence (Weeks 10-11)

**Goal**: The agent can research market trends, competitor activity, and consumer demand using external APIs.

### Week 10: External API Integration

#### 10.1 Tavily Integration

**File**: `server/src/services/agents/marketResearch.js`

```bash
npm install @tavily/core --save
```

Add to `server/.env`:
```
TAVILY_API_KEY=tvly-xxxxx
```

Implement:
- `searchMarketTrends(query, tenantContext)` — sector news and trends
- `detectNewEntrants(region, businessType)` — competitor/entrant news
- `getSectorBenchmarks(businessType, region)` — published benchmarks

All results cached to KnowledgeEntry with 7-day expiry.

#### 10.2 Perplexity Integration

Add to `server/.env`:
```
PERPLEXITY_API_KEY=pplx-xxxxx
```

Implement:
- `deepResearch(query, tenantContext)` — cited deep research
- Returns answer + citation URLs
- Cached to KnowledgeEntry with 7-day expiry

#### 10.3 Google Trends Integration

Implement (using SerpAPI or unofficial API):
- `getConsumerTrends(keywords, region)` — search interest data
- Cached to KnowledgeEntry with 14-day expiry

#### 10.4 Cache-First Wrapper

**File**: `server/src/services/agents/marketResearch.js`

```javascript
async function cachedResearch(prisma, tenantId, { topic, category, fetcher }) {
  // 1. Check KB for non-expired entry matching topic + category
  const cached = await searchKB(prisma, tenantId, { topic, category });
  if (cached.length > 0) return { data: cached[0], fromCache: true };

  // 2. Call external API
  const fresh = await fetcher();

  // 3. Cache result
  await writeKB(prisma, tenantId, {
    category, topic,
    insight: fresh.answer,
    source: fresh.source,
    metadata: { urls: fresh.citations },
    expiresAt: new Date(Date.now() + fresh.cacheDays * 86400000)
  });

  return { data: fresh, fromCache: false };
}
```

### Week 11: Rate Limits + Tier Gating

#### 11.1 External Research Rate Limits

```javascript
const EXTERNAL_LIMITS = {
  professional: { tavilyPerMonth: 0, perplexityPerMonth: 0 },  // No external
  enterprise:   { tavilyPerMonth: 50, perplexityPerMonth: 20 }
};
```

Track external API calls in `ApiUsageLog` with endpoint names:
- `market_research_tavily`
- `market_research_perplexity`
- `market_research_trends`

#### 11.2 Plan-Gated Tool Access

Update `research_market` tool to check tenant plan:
- Professional: return "Market research is available on Enterprise plan"
- Enterprise: execute external search

#### 11.3 Weekly Market Refresh Job

**File**: `server/src/jobs/marketRefresh.js`

```javascript
// Weekly (Monday 6am): refresh market cache for Enterprise tenants
cron.schedule('0 6 * * 1', async () => {
  const tenants = await basePrisma.tenant.findMany({
    where: { plan: 'enterprise', isLocked: false },
    include: { tenantPersona: true }
  });

  for (const tenant of tenants) {
    const persona = tenant.tenantPersona?.persona;
    if (!persona) continue;

    // Refresh sector trends for tenant's business type + region
    await refreshSectorTrends(tenant.id, persona.businessProfile);
  }
});
```

### Phase 4 Deliverables

| Deliverable | Status Criteria |
|-------------|----------------|
| Tavily integration | Market searches return results, cached to KB |
| Perplexity integration | Deep research returns cited answers |
| Google Trends integration | Consumer demand data available |
| Cache-first pattern | Second search on same topic returns cached |
| Tier gating | Professional blocked from external, Enterprise allowed |
| Rate limiting | External API call counts tracked and enforced |
| Weekly refresh job | Market cache auto-refreshed for Enterprise tenants |
| Source citations in chat | External research shows source URLs |

---

## Phase 5: Shared Intelligence Layer (Weeks 12-14)

**Goal**: Anonymised cross-tenant intelligence improves advice quality for everyone.

### Week 12: Benchmarks + Consent

#### 12.1 Database Models

Add to schema.prisma:
- `SharedBenchmark` — anonymised industry aggregates
- `SharedRecommendationScore` — recommendation effectiveness
- `SharedQuestionPattern` — question category frequency
- `SharedTrendSignal` — cross-tenant trend alerts
- `SharedResponseQuality` — response format feedback
- `TenantSharingConsent` — opt-in/out per tier

Run migration. Note: shared tables have NO tenantId, NO RLS policies.

#### 12.2 Consent Management

**File**: `server/src/routes/sharing.js`

Endpoints:
- `GET /api/settings/sharing-consent` — get current consent
- `PATCH /api/settings/sharing-consent` — update consent tiers

**File**: `client/src/components/advisor/SharingConsentModal.jsx`

Show on first advisor use. Explain three tiers clearly. Default: Tier 1 on, Tier 2-3 off.

#### 12.3 Anonymiser Service

**File**: `server/src/services/shared/anonymiser.js`

```javascript
export function anonymiseForSharing(tenantId, data) {
  return {
    // STRIP tenant identity
    anonymousHash: hash(tenantId + salt),  // Non-reversible
    // BUCKET actual values
    marginBucket: bucketize(data.margin, 5),  // "15-20%", "20-25%"
    costBucket: bucketize(data.cost, 10000),  // "$40k-50k"
    // GENERALISE location
    region: data.state || 'AU',  // State level only
    // GENERALISE time
    period: data.date.substring(0, 7),  // "2026-03" (month only)
    // STRIP all identifiers
    supplierName: undefined,
    productName: undefined,
    tenantName: undefined
  };
}
```

#### 12.4 Benchmark Engine

**File**: `server/src/services/shared/benchmarkEngine.js`

**Nightly job**: Compute benchmarks for each businessType + region:

```javascript
export async function computeBenchmarks() {
  const groups = await basePrisma.$queryRaw`
    SELECT
      tp.persona->>'businessProfile'->>'type' as business_type,
      tp.persona->>'businessProfile'->>'region' as region,
      PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY bs.snapshot->>'financial'->>'avgMargin') as p25,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY bs.snapshot->>'financial'->>'avgMargin') as median,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY bs.snapshot->>'financial'->>'avgMargin') as p75,
      COUNT(*) as sample_size
    FROM "TenantPersona" tp
    JOIN "BusinessSnapshot" bs ON tp."tenantId" = bs."tenantId"
    JOIN "TenantSharingConsent" tsc ON tp."tenantId" = tsc."tenantId"
    WHERE tsc."benchmarkOptIn" = true
    GROUP BY business_type, region
    HAVING COUNT(*) >= 10
  `;

  // Upsert SharedBenchmark records
  // Add differential privacy noise (±0.5%)
}
```

### Week 13: Recommendation Scoring + Question Patterns

#### 13.1 Recommendation Scorer

**File**: `server/src/services/shared/recommendationScorer.js`

Track when:
1. Agent gives a recommendation → log recommendation type
2. User acts on it (ActionStep completed) → log action
3. Outcome measured (metric change) → log outcome

Aggregate nightly:
```javascript
export async function computeRecommendationScores() {
  // GROUP BY recommendationType, businessType, category
  // Calculate: actedOnRate, positiveOutcomeRate, avgImpact
  // Only publish with sampleSize >= 10
  // Upsert SharedRecommendationScore records
}
```

#### 13.2 Question Pattern Tracker

**File**: `server/src/services/shared/questionPatternTracker.js`

After each chat message classification:
```javascript
export async function logQuestionPattern(classification, tenantContext) {
  // Check consent: patternOptIn required
  // Log anonymised: { businessType, region, period, category, subcategory }
}
```

Nightly aggregation into `SharedQuestionPattern`.

#### 13.3 Response Quality Tracker

**File**: `server/src/services/shared/responseQualityTracker.js`

After each feedback submission:
```javascript
export async function logResponseQuality(message, feedback) {
  // Classify response structure (step_by_step, narrative, data_table)
  // Log: { questionCategory, responseStructure, includesNumbers, score }
}
```

Nightly aggregation into `SharedResponseQuality`.

### Week 14: Trend Detection + Integration

#### 14.1 Trend Detection Engine

**File**: `server/src/services/shared/trendDetector.js`

```javascript
export async function detectTrends() {
  // For each businessType + region:
  //   Count tenants seeing cost increases by category (from snapshots)
  //   Count tenants asking about same topic (from question patterns)
  //   If > 30% of group shows pattern → create SharedTrendSignal

  // Set expiry: 30 days for cost trends, 14 days for question trends
}
```

#### 14.2 Trend Alerts in Chat

Update orchestrator system prompt to include active trend signals:
```javascript
const trendSignals = await basePrisma.sharedTrendSignal.findMany({
  where: {
    businessType: persona.businessProfile.type,
    region: persona.businessProfile.region,
    isActive: true,
    expiresAt: { gt: new Date() }
  }
});
```

Display trend alerts in chat UI (TrendAlert component at top of chat).

#### 14.3 Benchmark Tool Integration

Update `get_benchmarks` tool to query `SharedBenchmark`:
```javascript
async function getBenchmarks(prisma, { metric }, tenantId) {
  const persona = await getPersona(tenantId);
  const benchmark = await basePrisma.sharedBenchmark.findFirst({
    where: {
      businessType: persona.businessProfile.type,
      region: persona.businessProfile.region,
      metricName: metric,
      sampleSize: { gte: 10 }
    },
    orderBy: { computedAt: 'desc' }
  });

  return benchmark || { message: "Not enough data for benchmarks yet" };
}
```

### Phase 5 Deliverables

| Deliverable | Status Criteria |
|-------------|----------------|
| Consent management (API + UI) | 3-tier opt-in/out working |
| Anonymiser | All shared data stripped of identity |
| Benchmark engine | Nightly computation, k≥10 enforced |
| Recommendation scores | Outcome tracking + aggregation |
| Question patterns | Classification + aggregation |
| Response quality | Feedback tracking + aggregation |
| Trend detection | Cross-tenant patterns detected |
| Trend alerts in chat | Users see relevant industry alerts |
| Benchmarks in chat | "How do I compare" works with real data |

---

## Phase 6: Polish & Production (Weeks 15-16)

### Week 15: Performance + Monitoring

#### 15.1 Response Time Optimisation

- Parallel context assembly (Promise.all for snapshot + persona + KB)
- Connection pooling for external APIs
- Index optimisation for KB search queries
- Message pagination (load last 50, infinite scroll for more)

#### 15.2 Admin Dashboard Additions

**File**: `server/src/routes/admin/chatUsage.js`

New admin endpoints:
- `GET /admin/chat/usage` — messages, costs, resolution levels per tenant
- `GET /admin/chat/kb-health` — KB sizes, hit rates, expiry distribution
- `GET /admin/chat/shared-stats` — benchmark coverage, trend signals, scores

**File**: `client/src/pages/Admin/ChatUsage.jsx`

Admin UI showing:
- Total messages, costs, avg resolution level
- Per-tenant breakdown
- KB cache hit rate trend
- Shared intelligence health

#### 15.3 Error Handling + Graceful Degradation

- External API failure → fallback to KB-only answers
- Claude API failure → queue message for retry, show "processing" status
- Rate limit exceeded → clear message with remaining quota
- Empty KB for new tenant → use published benchmarks + explicit data-building prompts

### Week 16: Documentation + Launch

#### 16.1 Environment Variables

Add to `server/.env.example`:
```
# Business AI Agent
TAVILY_API_KEY=tvly-xxxxx
PERPLEXITY_API_KEY=pplx-xxxxx

# Optional
GOOGLE_TRENDS_API_KEY=
```

#### 16.2 Documentation Updates

- Update `docs/ARCHITECTURE.md` with AI Agent section
- Update `docs/BUSINESS_REQUIREMENTS.md` with advisor feature
- Create `docs/AI_AGENT_ADMIN_GUIDE.md` for operators

#### 16.3 Feature Flag

Gate the entire Business Advisor behind plan tier:
- Starter: No access (hidden in sidebar)
- Professional: Internal data only (no external research)
- Enterprise: Full access (internal + external + shared intelligence)

#### 16.4 Launch Checklist

| Item | Check |
|------|-------|
| All migrations applied | ☐ |
| RLS policies on new tables | ☐ |
| Scheduled jobs configured and running | ☐ |
| External API keys set | ☐ |
| Rate limits configured per tier | ☐ |
| Admin dashboard showing metrics | ☐ |
| Error handling for all failure modes | ☐ |
| Consent modal appears on first use | ☐ |
| Quick actions seeded with useful prompts | ☐ |
| Persona auto-initialises from tenant data | ☐ |
| SSE streaming works reliably | ☐ |
| Mobile responsive chat UI | ☐ |
| Load testing: 10 concurrent chats | ☐ |

---

## Cost Summary

### Development Cost (Time)

| Phase | Weeks | Description |
|-------|-------|-------------|
| Phase 1 | 4 | Foundation + Internal Chat |
| Phase 2 | 3 | Knowledge Base + Context |
| Phase 3 | 2 | Goals, Plans & Strategy |
| Phase 4 | 2 | External Intelligence |
| Phase 5 | 3 | Shared Intelligence |
| Phase 6 | 2 | Polish & Production |
| **Total** | **16 weeks** | |

### Runtime Cost Per Tenant (Monthly)

| Phase Active | Cost/Tenant/Month | Notes |
|-------------|-------------------|-------|
| Phase 1 only | ~$5-15 | Claude API for chat |
| Phase 1+2 | ~$3-10 | KB caching reduces Claude calls |
| Phase 1-3 | ~$4-12 | Strategy calls add small cost |
| Phase 1-4 | ~$8-20 (Enterprise) | External APIs add cost |
| Phase 1-5 | ~$8-20 (Enterprise) | Shared intelligence adds minimal cost |
| Mature (6+ months) | ~$3-8 | KB compounding reduces costs significantly |

### External API Costs (Platform-Wide)

| Service | Monthly Cost (50 tenants) | Monthly Cost (200 tenants) |
|---------|--------------------------|----------------------------|
| Claude API | ~$250-750 | ~$600-2,000 |
| Tavily | ~$20-80 | ~$50-200 |
| Perplexity | ~$10-50 | ~$25-100 |
| **Total** | **~$280-880** | **~$675-2,300** |

---

## Dependencies

### New NPM Packages (Server)

```json
{
  "@tavily/core": "^1.x",        // Tavily search API
  "eventsource-parser": "^1.x"   // SSE parsing (if needed)
}
```

Perplexity and Google Trends use raw `fetch` — no extra packages needed.

### Environment Variables

```
# Required for Phase 1
# (none — uses existing ANTHROPIC_API_KEY)

# Required for Phase 4
TAVILY_API_KEY=tvly-xxxxx
PERPLEXITY_API_KEY=pplx-xxxxx

# Optional for Phase 4
GOOGLE_TRENDS_API_KEY=
SERPAPI_KEY=                     # Alternative for Google Trends
```

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| Claude API cost overrun | High | Medium | Token budgets per tier, resolution ladder, aggressive caching |
| Hallucinated business advice | High | Medium | Always cite data sources, show confidence, never auto-execute |
| Slow response times (>10s) | Medium | Medium | Pre-computed snapshots, parallel context assembly, streaming |
| Low KB cache hit rate | Medium | Low | Scheduled refresh jobs, write-back after every response |
| Insufficient tenants for benchmarks | Medium | High (early) | Use published industry data as fallback until n≥10 per group |
| Tenant data leak via shared intelligence | Critical | Low | Anonymisation at source, k-anonymity, differential privacy |
| External API downtime | Medium | Low | Graceful degradation to KB-only, retry queues |
| Scope creep on strategy features | Medium | High | Strict phase boundaries, MVP per phase |

---

## Success Metrics

| Metric | Phase 1 Target | Phase 5 Target |
|--------|---------------|---------------|
| Daily active chat users | 20% of tenants | 50% of tenants |
| Avg messages per session | 4+ | 6+ |
| User satisfaction (thumbs up %) | 70% | 85% |
| KB cache hit rate | N/A | 60%+ |
| Avg response time | <8 seconds | <5 seconds |
| Avg cost per message | <$0.10 | <$0.03 |
| Recommendations acted on | 30% | 50% |
| Recommendation positive outcomes | 60% | 75% |
