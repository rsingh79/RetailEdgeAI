# Evaluation & Testing Framework
## Proving the Self-Evolving AI Architecture Works — Per Agent Type

---

## The Core Principle

Anthropic's engineering team published the definitive framing: evaluations fall into two categories that serve different purposes:

**Capability evals** ask: "Can the agent do this at all?" These are your innovation benchmarks — they measure whether the system is getting smarter.

**Regression evals** ask: "Can the agent still do everything it used to?" These protect against backsliding when prompts evolve. Tasks that pass capability evals consistently graduate into the regression suite.

For your self-evolving architecture, you need BOTH running continuously:
- Capability evals prove evolution is happening
- Regression evals prove evolution isn't breaking things

---

## The Three Layers of Proof

### Layer 1: Per-Agent Automated Tests (runs on every prompt change)
Deterministic, fast, cheap. Proves each agent still works correctly.

### Layer 2: Evolution Metrics Dashboard (runs daily/weekly)
Statistical, trend-based. Proves agents are getting better over time per tenant.

### Layer 3: Business Impact Demonstration (runs monthly)
Connects AI performance to tenant business outcomes. Proves the system creates value.

---

## Per-Agent Evaluation Design

### Agent 1: OCR Agent

**What "working" means:** Correctly extracts text, prices, product names, barcodes, and structured data from images of receipts, invoices, labels, and shelf tags.

**Automated capability evals:**

| Test | Input | Expected output | Metric | How to automate |
|------|-------|-----------------|--------|-----------------|
| Field extraction accuracy | 100 labeled receipt images per tenant | Correctly extracted fields (price, qty, item name) | Field-level F1 score | Compare extracted JSON to ground truth JSON |
| Edge case handling | Blurry, rotated, multi-language images | Graceful degradation, not hallucinated data | Error rate on known-hard inputs | Fixed test suite of 50 difficult images |
| Format adaptation | Tenant-specific document layouts | Correct parsing of tenant's unique formats | Per-template accuracy | Tenant provides 10 sample documents with expected output |
| Speed | Standard document set | Processing time per document | p95 latency | Automated timing harness |

**Regression suite:** 
Golden dataset of 200 documents (mixed easy/hard) with verified ground truth. Run after every prompt change. Alert if F1 drops by >1%.

**Evolution proof:**
Track field-level F1 per tenant over time. If the system is evolving correctly:
- Week 1: 85% accuracy on tenant's specific receipt format
- Week 4: 91% accuracy (after learning tenant's terminology and layout patterns)
- Week 12: 96% accuracy (after accumulating few-shot examples from corrections)

**Dashboard visualization:**
Line chart showing per-tenant OCR accuracy over time, with vertical markers for each prompt evolution event. If the line goes up after evolution events and stays flat between them, the system is working.

---

### Agent 2: Product Matching Agent

**What "working" means:** Correctly matches incoming product data (from suppliers, imports, OCR output) to existing catalog items, handling variations in naming, packaging, and descriptions.

**Automated capability evals:**

| Test | Input | Expected output | Metric | How to automate |
|------|-------|-----------------|--------|-----------------|
| Exact match accuracy | Product names vs catalog | Correct product ID | Precision, Recall, F1 | Match against verified mapping table |
| Fuzzy match quality | Misspelled/abbreviated names | Correct match with confidence score | Recall@k (top 3 suggestions) | Pre-labeled fuzzy match dataset |
| False positive rate | Similar but different products | Correctly identifies as "no match" | False positive rate | Intentionally confusing product pairs |
| Tenant-specific vocabulary | Tenant's internal names vs standard names | Correct translation | Per-tenant mapping accuracy | Tenant-provided synonym list |

**Regression suite:**
500 product matching pairs per tenant tier (easy matches, fuzzy matches, deliberate non-matches). Run after every prompt change.

**Evolution proof:**
The key metric here is **manual correction rate**. Track how often a human overrides the agent's match suggestion:
- Week 1: 15% of matches manually corrected
- Week 8: 7% correction rate (system learned from corrections)
- Week 16: 3% correction rate (tenant-specific vocabulary fully absorbed)

Plot the correction rate as a declining curve per tenant. That IS your proof.

**A/B test design:**
Run 50% of product matches through the evolved prompt and 50% through the previous version. Compare correction rates. If the evolved prompt has a lower correction rate with statistical significance (p < 0.05), promote it.

---

### Agent 3: Product Import Agent

**What "working" means:** Correctly parses, validates, transforms, and imports product data from various supplier formats into the tenant's system, handling field mapping, unit conversion, and data quality issues.

**Automated capability evals:**

| Test | Input | Expected output | Metric | How to automate |
|------|-------|-----------------|--------|-----------------|
| Parse accuracy | CSV/Excel/XML supplier files | Correctly extracted fields | Field mapping accuracy | Compare parsed output to manually verified import |
| Validation quality | Data with known errors (missing prices, invalid SKUs) | Correct error identification | Error detection recall | Seed test files with known errors |
| Transformation correctness | Units, currencies, date formats | Correctly converted values | Transformation accuracy | Mathematical verification of conversions |
| Duplicate detection | Import file with known duplicates | Correct duplicate flagging | Precision/Recall of duplicate detection | Pre-labeled duplicate dataset |

**Regression suite:**
30 representative import files (various formats, sizes, error types) with verified expected output. Run end-to-end import simulation after every prompt change.

**Evolution proof:**
Track two metrics per tenant:
1. **First-pass success rate**: % of imports that go through without manual intervention
2. **Error resolution time**: How long it takes to fix import issues

Both should improve as the agent learns each supplier's format quirks. Plot per-supplier-per-tenant over time.

---

### Agent 4: Strategic Advisor Agent

**What "working" means:** Provides relevant, actionable business insights and execution plans based on tenant's data, market context, and operational constraints. This is the hardest to evaluate because "good advice" is subjective.

**Automated capability evals:**

| Test | Input | Expected output | Metric | How to automate |
|------|-------|-----------------|--------|-----------------|
| Factual grounding | Question about tenant's data | Answer citing real data points | Faithfulness score (LLM-as-judge) | Verify cited numbers against actual data |
| Recommendation relevance | Business scenario | Relevant strategic options | Relevance score (LLM-as-judge) | Judge prompt: "Is this advice relevant to a [tenant type] business?" |
| Execution plan quality | "How should I handle X?" | Actionable, step-by-step plan | Actionability score (LLM-as-judge) | Judge prompt: "Could a store manager execute this plan tomorrow?" |
| Contextual awareness | Question requiring tenant history | Answer incorporating past interactions | Context utilization rate | Check if response references known tenant context |
| Hallucination detection | Question about tenant metrics | Only real data cited | Hallucination rate | Cross-reference all cited numbers with actual database |

**The LLM-as-Judge approach:**
Since strategic advice can't be graded with exact string matching, you use a separate (stronger) LLM to evaluate the quality of the advisor's output. The judge prompt evaluates along dimensions:

```
Rate the following strategic advice on a 1-5 scale for:
1. RELEVANCE: Does this advice address the specific question asked?
2. GROUNDEDNESS: Is the advice based on real data, not assumptions?
3. ACTIONABILITY: Could the tenant execute this within their operational constraints?
4. SPECIFICITY: Is this advice specific to THIS tenant, or generic?
5. COMPLETENESS: Does the execution plan cover all necessary steps?

Provide a score for each dimension and a brief justification.
```

**Evolution proof:**
Track the LLM-judge scores per tenant over time. Also track:
- **Advice adoption rate**: Did the tenant act on the recommendation? (requires feedback loop)
- **Outcome tracking**: For advice that was followed, what was the business result?

**Human calibration:**
Monthly, have a domain expert review a random sample of 20 advisory interactions and grade them. Compare human grades to LLM-judge grades to calibrate the automated evaluation. Anthropic recommends this calibration cycle as essential.

---

## Cross-Agent Evolution Metrics

These metrics prove the meta-learning loop (Tier 3) is working across all agent types:

### Metric 1: Evolution Velocity
**What it measures:** How quickly each agent type improves per tenant.
**How to calculate:** Days from onboarding to reaching 90th percentile performance for that agent type.
**What "working" looks like:** Evolution velocity decreasing over time as the meta-agent gets better at bootstrapping new tenants with proven customizations.

### Metric 2: Cross-Tenant Lift
**What it measures:** Whether improvements discovered in one tenant help others.
**How to calculate:** When a customization is promoted from tenant-specific to default, measure the performance change for all tenants who receive it.
**What "working" looks like:** Positive lift for 70%+ of tenants when a default prompt is upgraded.

### Metric 3: Suggestion Acceptance Rate
**What it measures:** Whether the Suggestion Engine generates useful improvement proposals.
**How to calculate:** (Approved suggestions / Total suggestions generated) over time.
**What "working" looks like:** Acceptance rate above 40% (below that, the engine is generating noise). Should increase over time as the engine learns what admins approve.

### Metric 4: Prompt Stability
**What it measures:** Whether evolved prompts remain stable or thrash back and forth.
**How to calculate:** Number of prompt version changes per tenant per month. Track rollback frequency.
**What "working" looks like:** Decreasing change frequency over time (system converges). Rollback rate below 5%.

### Metric 5: Default Prompt Age
**What it measures:** How often the base default prompt is improved.
**How to calculate:** Days since last default prompt version upgrade.
**What "working" looks like:** Regular upgrades (every 30-60 days initially, stabilizing over time) — not stale, but not thrashing.

---

## The Automated Test Pipeline

### On Every Prompt Change (CI/CD gate):

```
1. REGRESSION SUITE (must pass 100%)
   ├── OCR: 200 golden documents → field-level F1 ≥ baseline
   ├── Product Match: 500 pairs → precision/recall ≥ baseline
   ├── Product Import: 30 files → parse accuracy ≥ baseline
   └── Strategic Advisor: 50 scenarios → LLM-judge scores ≥ baseline

2. CAPABILITY EVAL (informational, not blocking)
   ├── Run against harder test cases
   ├── Record scores for trend tracking
   └── Flag if significant improvement detected

3. A/B READINESS CHECK
   ├── If capability improved significantly → flag for A/B test
   └── If regression detected → block deployment, alert team
```

### Daily (automated, async):

```
1. INTERACTION SIGNAL AGGREGATION
   ├── Per tenant: resolution rate, correction rate, escalation rate
   ├── Per agent type: accuracy trends, latency trends
   └── Anomaly detection: alert if any metric drops >10% from 7-day average

2. SUGGESTION ENGINE RUN
   ├── Analyze previous day's signals per tenant
   ├── Generate improvement proposals if patterns detected
   └── Queue proposals for admin review
```

### Weekly (automated report):

```
1. EVOLUTION DASHBOARD REFRESH
   ├── Per-tenant performance trends (all agent types)
   ├── Cross-tenant comparison (anonymized)
   ├── Suggestion acceptance rate
   └── Prompt version history with performance at each version

2. META-AGENT ANALYSIS
   ├── Cross-tenant performance comparison
   ├── Identify outperforming tenant customizations
   └── Generate default upgrade candidates
```

### Monthly (human + automated):

```
1. HUMAN CALIBRATION
   ├── Domain expert reviews 20 random interactions per agent type
   ├── Compare human grades to automated scores
   ├── Adjust LLM-judge prompts if calibration drifts
   └── Update golden datasets with new edge cases

2. BUSINESS IMPACT REPORT
   ├── Connect AI metrics to tenant business outcomes
   ├── Calculate ROI per tenant
   └── Identify tenants where evolution stalled (intervention needed)
```

---

## How to Demonstrate This Is Working (The Demo)

### Demo 1: The Before/After Split Screen
Show the same query to two versions of the same agent for the same tenant:
- Left side: Default prompt (what a new tenant gets on day 1)
- Right side: Evolved prompt (what this tenant's agent looks like after 90 days)
The difference in quality, specificity, and relevance should be visually obvious.

### Demo 2: The Evolution Timeline
Show a tenant's performance dashboard over time:
- X-axis: time (days since onboarding)
- Y-axis: key metric (accuracy, correction rate, or LLM-judge score)
- Vertical markers: each prompt evolution event
- The line should show step-function improvements after each evolution event

### Demo 3: The Correction Curve
For the Product Matching agent specifically:
- Show the declining manual correction rate per tenant
- Overlay the moments when the system learned a new mapping
- Demonstrate that by month 3, the agent handles 97% of matches without human correction

### Demo 4: The Cross-Tenant Intelligence
Show that when Tenant A's improvement was promoted to the default:
- Tenant B, C, and D (who were still on defaults) immediately benefited
- Show the performance lift across all tenants on a single chart

### Demo 5: The Regression Safety Net
Intentionally introduce a bad prompt change and show:
- The regression suite catches it before deployment
- The A/B test detects it in production
- The system automatically rolls back
- No tenant was impacted

---

## Recommended Testing Tools

| Layer | Tool | Why |
|-------|------|-----|
| Regression testing | **DeepEval** (open source) | CI/CD integration, LLM-as-judge built in, regression tracking |
| Production monitoring | **Langfuse** (open source) | Tracing, prompt versioning, cost tracking, self-hostable |
| A/B testing | **PromptLayer** or custom | Per-tenant version routing, traffic splitting by segment |
| LLM-as-Judge | **DSPy evaluators** or custom | Metric-driven evaluation, calibration support |
| Business dashboards | **Custom** (your admin UI) | Per-tenant evolution visualization, suggestion queue, audit trail |
| Anomaly detection | **Custom** or **Arize** | Per-tenant metric monitoring, drift detection, alerting |

---

## The Testing Hierarchy (What to Build First)

### Phase 1: Before you build evolution (Week 1-2)
Build the regression suite for each agent type with golden datasets. This gives you the safety net BEFORE you turn on evolution.

### Phase 2: When you turn on signal capture (Week 3-4)
Add interaction signal logging. Verify signals are being captured correctly for all agent types. Build the daily metrics dashboard.

### Phase 3: When you turn on the suggestion engine (Week 5-8)
Add A/B testing infrastructure. Verify that suggestions are generated, that approved suggestions improve metrics, and that rejected suggestions are not applied.

### Phase 4: When you turn on the meta-agent (Week 9-12)
Add cross-tenant analysis. Verify that default upgrades help most tenants. Build the monthly human calibration process.

### Phase 5: Continuous (ongoing)
Graduate capability evals to regression suite as agents improve. Expand golden datasets. Refine LLM-judge prompts based on calibration. Add new edge cases as they're discovered in production.

---

## The Single Most Important Metric Per Agent

If you can only track one number per agent, track these:

| Agent | The One Metric | Why |
|-------|---------------|-----|
| OCR | **Human correction rate** | Directly measures "how often does the AI get it wrong enough that a human has to fix it" |
| Product Matching | **Auto-match acceptance rate** | % of matches accepted without manual override |
| Product Import | **First-pass success rate** | % of imports that complete without intervention |
| Strategic Advisor | **Advice action rate** | % of recommendations that the tenant actually acts on |

All four should trend upward per tenant over time. If they do, your system is working. If they don't, your evolution pipeline has a problem.
