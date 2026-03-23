/**
 * Suggestion Engine
 *
 * Analyzes interaction signals for a tenant over a time window and generates
 * structured improvement proposals for prompt configuration.
 *
 * Trigger: Scheduled (daily) or on-demand via admin dashboard.
 * Idempotent: Running twice for the same window + tenant produces the same batchId,
 *             and skips if that batch already exists.
 */
import { basePrisma } from '../lib/prisma.js';
import { trackedClaudeCall } from './apiUsageTracker.js';
import crypto from 'crypto';

const MAX_SUGGESTIONS_PER_RUN = 5;
const MIN_SIGNALS_FOR_ANALYSIS = 5; // don't analyze tenants with fewer signals
const DEFAULT_WINDOW_DAYS = 14;

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the suggestion engine for a single tenant + agent role.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.agentRoleKey - e.g. "product_matching", "ocr_extraction"
 * @param {number} [opts.windowDays=14] - how many days of signals to analyze
 * @param {boolean} [opts.dryRun=false] - if true, return suggestions without storing
 * @returns {Promise<{suggestions: Array, stats: object, skipped?: string}>}
 */
export async function runSuggestionEngine({
  tenantId,
  agentRoleKey,
  windowDays = DEFAULT_WINDOW_DAYS,
  dryRun = false,
}) {
  // Resolve agent role
  const agentRole = await basePrisma.agentRole.findUnique({
    where: { key: agentRoleKey },
  });
  if (!agentRole) {
    return { suggestions: [], stats: {}, skipped: `Unknown agent role: ${agentRoleKey}` };
  }

  // Idempotency: generate batch ID from tenant + role + window
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const batchId = generateBatchId(tenantId, agentRoleKey, windowStart);

  // Check if this batch was already processed
  if (!dryRun) {
    const existing = await basePrisma.promptSuggestion.findFirst({
      where: { batchId },
    });
    if (existing) {
      return { suggestions: [], stats: {}, skipped: `Batch ${batchId} already processed` };
    }
  }

  // ── STEP 1: Aggregate failure patterns ──
  const signals = await basePrisma.interactionSignal.findMany({
    where: {
      tenantId,
      agentRoleId: agentRole.id,
      timestamp: { gte: windowStart },
    },
    orderBy: { timestamp: 'desc' },
  });

  if (signals.length < MIN_SIGNALS_FOR_ANALYSIS) {
    return {
      suggestions: [],
      stats: { totalSignals: signals.length },
      skipped: `Only ${signals.length} signals (minimum ${MIN_SIGNALS_FOR_ANALYSIS})`,
    };
  }

  const stats = aggregateStats(signals);
  const failurePatterns = identifyFailurePatterns(stats);

  // ── STEP 2: Analyze human overrides ──
  const overrideSignals = signals.filter((s) => s.humanOverride && s.humanOverrideDiff);
  const overrideClusters = clusterOverrides(overrideSignals);

  // If no failure patterns and no overrides, nothing to suggest
  if (failurePatterns.length === 0 && overrideClusters.length === 0) {
    return {
      suggestions: [],
      stats: stats.summary,
      skipped: 'No failure patterns or human overrides detected',
    };
  }

  // ── STEP 3: Load current tenant config ──
  const tenantConfig = await basePrisma.tenantPromptConfig.findFirst({
    where: { tenantId, agentRoleId: agentRole.id, isActive: true },
  });

  // ── STEP 4: Generate suggestions via LLM ──
  const suggestions = await generateSuggestions({
    tenantId,
    agentRoleKey,
    agentRole,
    failurePatterns,
    overrideClusters,
    tenantConfig,
    stats: stats.summary,
    windowDays,
  });

  // ── STEP 5: Store suggestions ──
  if (!dryRun && suggestions.length > 0) {
    for (const suggestion of suggestions) {
      await basePrisma.promptSuggestion.create({
        data: {
          tenantId,
          agentRoleId: agentRole.id,
          suggestionType: suggestion.type,
          suggestionContent: suggestion.content,
          evidence: suggestion.evidence,
          impactEstimate: suggestion.expectedImpact,
          status: 'pending',
          source: 'suggestion_engine',
          batchId,
        },
      });
    }
  }

  return {
    suggestions,
    stats: stats.summary,
    batchId,
  };
}

/**
 * Run the suggestion engine for ALL active tenants (scheduled job).
 * Rate-limited: processes tenants sequentially to avoid LLM overload.
 *
 * @param {object} [opts]
 * @param {number} [opts.windowDays=14]
 * @param {boolean} [opts.dryRun=false]
 * @returns {Promise<Array<{tenantId, agentRoleKey, result}>>}
 */
export async function runForAllTenants({ windowDays = DEFAULT_WINDOW_DAYS, dryRun = false } = {}) {
  const tenants = await basePrisma.tenant.findMany({
    where: { isLocked: false, subscriptionStatus: { in: ['active', 'trial'] } },
    select: { id: true },
  });

  const agentRoles = await basePrisma.agentRole.findMany({
    where: { isActive: true, key: { not: 'prompt_management' } },
    select: { key: true },
  });

  const results = [];

  for (const tenant of tenants) {
    for (const role of agentRoles) {
      try {
        const result = await runSuggestionEngine({
          tenantId: tenant.id,
          agentRoleKey: role.key,
          windowDays,
          dryRun,
        });
        results.push({ tenantId: tenant.id, agentRoleKey: role.key, result });
      } catch (err) {
        console.error(`Suggestion engine failed for ${tenant.id}/${role.key}:`, err.message);
        results.push({ tenantId: tenant.id, agentRoleKey: role.key, error: err.message });
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 1: Aggregation
// ═══════════════════════════════════════════════════════════════════════

function aggregateStats(signals) {
  const total = signals.length;
  const resolved = signals.filter((s) => s.resolutionStatus === 'resolved').length;
  const failed = signals.filter((s) => s.resolutionStatus === 'failed').length;
  const abandoned = signals.filter((s) => s.resolutionStatus === 'abandoned').length;
  const escalated = signals.filter((s) => s.escalationOccurred).length;
  const overrides = signals.filter((s) => s.humanOverride).length;

  const satisfactionScores = signals
    .filter((s) => s.userSatisfactionScore != null)
    .map((s) => s.userSatisfactionScore);
  const avgSatisfaction = satisfactionScores.length > 0
    ? satisfactionScores.reduce((a, b) => a + b, 0) / satisfactionScores.length
    : null;

  const avgLatency = signals.reduce((sum, s) => sum + s.latencyMs, 0) / total;
  const totalCost = signals.reduce((sum, s) => sum + s.costUsd, 0);

  // Group by topic tags
  const topicMap = new Map();
  for (const signal of signals) {
    for (const tag of signal.topicTags || []) {
      if (!topicMap.has(tag)) topicMap.set(tag, []);
      topicMap.get(tag).push(signal);
    }
  }

  const topicStats = [];
  for (const [tag, tagSignals] of topicMap) {
    const tagTotal = tagSignals.length;
    const tagResolved = tagSignals.filter((s) => s.resolutionStatus === 'resolved').length;
    const tagOverrides = tagSignals.filter((s) => s.humanOverride).length;
    const tagSat = tagSignals
      .filter((s) => s.userSatisfactionScore != null)
      .map((s) => s.userSatisfactionScore);
    const tagAvgSat = tagSat.length > 0
      ? tagSat.reduce((a, b) => a + b, 0) / tagSat.length
      : null;

    topicStats.push({
      topic: tag,
      count: tagTotal,
      resolutionRate: tagTotal > 0 ? tagResolved / tagTotal : 0,
      overrideRate: tagTotal > 0 ? tagOverrides / tagTotal : 0,
      avgSatisfaction: tagAvgSat,
      escalationRate: tagSignals.filter((s) => s.escalationOccurred).length / tagTotal,
    });
  }

  return {
    summary: {
      total,
      resolved,
      failed,
      abandoned,
      escalated,
      overrides,
      resolutionRate: total > 0 ? resolved / total : 0,
      overrideRate: total > 0 ? overrides / total : 0,
      escalationRate: total > 0 ? escalated / total : 0,
      avgSatisfaction,
      avgLatencyMs: Math.round(avgLatency),
      totalCostUsd: Math.round(totalCost * 100) / 100,
    },
    topicStats,
    signals,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 1b: Identify failure patterns
// ═══════════════════════════════════════════════════════════════════════

function identifyFailurePatterns(stats) {
  const { summary, topicStats } = stats;
  const patterns = [];

  // Pattern: Overall high failure rate
  if (summary.resolutionRate < 0.7 && summary.total >= 10) {
    patterns.push({
      type: 'high_failure_rate',
      metric: 'resolutionRate',
      value: summary.resolutionRate,
      threshold: 0.7,
      description: `Only ${Math.round(summary.resolutionRate * 100)}% of interactions resolved successfully`,
    });
  }

  // Pattern: High override rate
  if (summary.overrideRate > 0.3 && summary.overrides >= 3) {
    patterns.push({
      type: 'high_override_rate',
      metric: 'overrideRate',
      value: summary.overrideRate,
      threshold: 0.3,
      description: `${Math.round(summary.overrideRate * 100)}% of interactions required human override`,
    });
  }

  // Pattern: Low satisfaction
  if (summary.avgSatisfaction != null && summary.avgSatisfaction < 3) {
    patterns.push({
      type: 'low_satisfaction',
      metric: 'avgSatisfaction',
      value: summary.avgSatisfaction,
      threshold: 3,
      description: `Average satisfaction score is ${summary.avgSatisfaction.toFixed(1)}/5`,
    });
  }

  // Pattern: High escalation rate
  if (summary.escalationRate > 0.2 && summary.escalated >= 2) {
    patterns.push({
      type: 'high_escalation_rate',
      metric: 'escalationRate',
      value: summary.escalationRate,
      threshold: 0.2,
      description: `${Math.round(summary.escalationRate * 100)}% of interactions escalated`,
    });
  }

  // Pattern: Topic-specific failures (significantly worse than average)
  for (const topic of topicStats) {
    if (topic.count < 3) continue; // need minimum data

    if (topic.overrideRate > summary.overrideRate * 1.5 && topic.overrideRate > 0.3) {
      patterns.push({
        type: 'topic_high_override',
        topic: topic.topic,
        metric: 'overrideRate',
        value: topic.overrideRate,
        average: summary.overrideRate,
        description: `Topic "${topic.topic}" has ${Math.round(topic.overrideRate * 100)}% override rate (avg: ${Math.round(summary.overrideRate * 100)}%)`,
      });
    }

    if (topic.resolutionRate < summary.resolutionRate * 0.7 && topic.resolutionRate < 0.6) {
      patterns.push({
        type: 'topic_low_resolution',
        topic: topic.topic,
        metric: 'resolutionRate',
        value: topic.resolutionRate,
        average: summary.resolutionRate,
        description: `Topic "${topic.topic}" has only ${Math.round(topic.resolutionRate * 100)}% resolution (avg: ${Math.round(summary.resolutionRate * 100)}%)`,
      });
    }
  }

  return patterns;
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 2: Cluster human overrides
// ═══════════════════════════════════════════════════════════════════════

function clusterOverrides(overrideSignals) {
  if (overrideSignals.length === 0) return [];

  const clusters = new Map();

  for (const signal of overrideSignals) {
    const diff = signal.humanOverrideDiff;
    if (!diff) continue;

    // Determine cluster key based on override characteristics
    let clusterType;

    if (diff.aiTopWasCorrect === false && diff.aiSuggestions?.length > 0) {
      // AI suggested wrong product
      clusterType = 'wrong_product_match';
    } else if (!diff.aiHadSuggestions) {
      // AI had no suggestions at all
      clusterType = 'no_match_found';
    } else if (diff.priceOverridden) {
      // User overrode the pricing
      clusterType = 'price_override';
    } else {
      clusterType = 'general_override';
    }

    if (!clusters.has(clusterType)) {
      clusters.set(clusterType, {
        type: clusterType,
        count: 0,
        examples: [],
      });
    }

    const cluster = clusters.get(clusterType);
    cluster.count++;

    // Keep up to 5 examples per cluster
    if (cluster.examples.length < 5) {
      cluster.examples.push({
        lineDescription: diff.lineDescription || null,
        aiTopSuggestion: diff.aiSuggestions?.[0]?.productName || null,
        aiConfidence: diff.aiSuggestions?.[0]?.confidence || null,
        userChoice: diff.userSelected?.[0]?.name || null,
        conversationId: signal.conversationId,
        timestamp: signal.timestamp,
      });
    }
  }

  return Array.from(clusters.values())
    .filter((c) => c.count >= 2) // only report clusters with 2+ occurrences
    .sort((a, b) => b.count - a.count);
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 3: Generate suggestions via LLM
// ═══════════════════════════════════════════════════════════════════════

async function generateSuggestions({
  tenantId,
  agentRoleKey,
  agentRole,
  failurePatterns,
  overrideClusters,
  tenantConfig,
  stats,
  windowDays,
}) {
  const systemPrompt = `You are an AI agent performance analyst for RetailEdge, a retail management platform.
Your job is to analyze failure patterns and human corrections, then generate specific, actionable suggestions
to improve the AI agent's prompt configuration.

The agent you're analyzing: "${agentRole.name}" (${agentRoleKey})

IMPORTANT:
- Generate ONLY suggestions that directly address the observed patterns
- Each suggestion must be specific and actionable, not generic advice
- Maximum ${MAX_SUGGESTIONS_PER_RUN} suggestions, prioritized by expected impact
- Return valid JSON only, no markdown fencing`;

  const userPrompt = `Analyze this AI agent's performance over the last ${windowDays} days.

PERFORMANCE SUMMARY:
${JSON.stringify(stats, null, 2)}

FAILURE PATTERNS DETECTED:
${failurePatterns.length > 0 ? failurePatterns.map((p, i) => `${i + 1}. ${p.description}`).join('\n') : 'None detected'}

HUMAN OVERRIDE CLUSTERS (corrections users made to AI output):
${overrideClusters.length > 0 ? JSON.stringify(overrideClusters, null, 2) : 'No override patterns found'}

CURRENT TENANT CONFIGURATION:
${tenantConfig ? JSON.stringify({
    customInstructions: tenantConfig.customInstructions,
    domainTerminology: tenantConfig.domainTerminology,
    toneSettings: tenantConfig.toneSettings,
  }, null, 2) : 'No tenant-specific configuration (using defaults)'}

Generate structured improvement suggestions. Each suggestion must be one of these types:
- ADD_INSTRUCTION: A new plain-English rule to add to the agent's instructions
- MODIFY_INSTRUCTION: A change to an existing instruction (specify which one)
- ADD_TERM: A domain term the agent should understand (term and definition)
- ADD_ESCALATION_RULE: A new condition under which the agent should escalate
- MODIFY_TONE: A tone adjustment with specific guidance
- ADD_EXAMPLE: Recommend that a specific interaction pattern be added as a few-shot example

For each suggestion, provide:
{
  "type": "ADD_INSTRUCTION | MODIFY_INSTRUCTION | ADD_TERM | ADD_ESCALATION_RULE | MODIFY_TONE | ADD_EXAMPLE",
  "content": {  // structured, not narrative
    "instruction": "the specific text",
    "target": "which existing instruction to modify (for MODIFY_INSTRUCTION)",
    "term": "term text (for ADD_TERM)",
    "definition": "definition text (for ADD_TERM)",
    "condition": "escalation condition (for ADD_ESCALATION_RULE)",
    "action": "what to do when condition is met"
  },
  "evidence": "which failure pattern or override cluster supports this",
  "expectedImpact": {
    "metric": "which metric this should improve",
    "estimatedImprovement": "rough percentage improvement",
    "confidence": "high | medium | low"
  },
  "priority": "high | medium | low"
}

Return as a JSON array. Maximum ${MAX_SUGGESTIONS_PER_RUN} suggestions.`;

  try {
    const response = await trackedClaudeCall({
      tenantId,
      userId: null,
      endpoint: 'suggestion_engine',
      model: 'claude-haiku-3-5-20241022',
      maxTokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      requestSummary: {
        type: 'suggestion_generation',
        agentRoleKey,
        failurePatternCount: failurePatterns.length,
        overrideClusterCount: overrideClusters.length,
        signalCount: stats.total,
      },
    });

    const text = response.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Parse JSON — strip markdown fencing if present
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      console.warn('Suggestion engine: LLM returned non-array response');
      return [];
    }

    // Validate and cap at MAX_SUGGESTIONS_PER_RUN
    return parsed
      .filter((s) => s.type && s.content)
      .slice(0, MAX_SUGGESTIONS_PER_RUN)
      .map((s) => ({
        type: s.type,
        content: s.content,
        evidence: s.evidence || 'auto-detected',
        expectedImpact: s.expectedImpact || null,
        priority: s.priority || 'medium',
      }));
  } catch (err) {
    console.error('Suggestion engine LLM call failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 5 (additional): Few-shot example auto-curation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Scan recent successful interactions and auto-curate few-shot examples.
 * Called after suggestion generation or independently.
 *
 * @param {string} tenantId
 * @param {string} agentRoleKey
 * @param {number} [windowDays=14]
 * @param {number} [maxExamples=3]
 */
export async function curateExamples({
  tenantId,
  agentRoleKey,
  windowDays = DEFAULT_WINDOW_DAYS,
  maxExamples = 3,
}) {
  const agentRole = await basePrisma.agentRole.findUnique({
    where: { key: agentRoleKey },
  });
  if (!agentRole) return [];

  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // Find high-quality interactions: resolved, high satisfaction, no escalation, no overrides
  const successfulSignals = await basePrisma.interactionSignal.findMany({
    where: {
      tenantId,
      agentRoleId: agentRole.id,
      timestamp: { gte: windowStart },
      resolutionStatus: 'resolved',
      humanOverride: false,
      escalationOccurred: false,
      userSatisfactionScore: { gte: 4 },
    },
    orderBy: { userSatisfactionScore: 'desc' },
    take: maxExamples * 2, // fetch extra to filter
  });

  if (successfulSignals.length === 0) return [];

  // For chat-based agents, load the conversation to create input/output pairs
  const examples = [];

  for (const signal of successfulSignals) {
    if (examples.length >= maxExamples) break;
    if (!signal.conversationId) continue;

    // Check if we already have an example from this conversation
    const existing = await basePrisma.tenantFewShotExample.findFirst({
      where: { sourceConversationId: signal.conversationId, tenantId },
    });
    if (existing) continue;

    // Load conversation messages
    const messages = await basePrisma.message.findMany({
      where: { conversationId: signal.conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
      take: 4, // first 2 exchanges
    });

    if (messages.length < 2) continue;

    const userMsg = messages.find((m) => m.role === 'user');
    const assistantMsg = messages.find((m) => m.role === 'assistant');
    if (!userMsg || !assistantMsg) continue;

    // Calculate quality score: satisfaction + resolution + no corrections
    const qualityScore = (signal.userSatisfactionScore || 3) / 5 * 0.6
      + (signal.correctionCount === 0 ? 0.3 : 0)
      + (signal.latencyMs < 5000 ? 0.1 : 0);

    const example = await basePrisma.tenantFewShotExample.create({
      data: {
        tenantId,
        agentRoleId: agentRole.id,
        inputText: userMsg.content.substring(0, 2000),
        idealOutputText: assistantMsg.content.substring(0, 2000),
        sourceConversationId: signal.conversationId,
        qualityScore: Math.round(qualityScore * 100) / 100,
        isActive: true,   // auto-activated (can be removed by admin)
        autoCurated: true,
        tags: signal.topicTags || [],
      },
    });

    examples.push(example);
  }

  return examples;
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function generateBatchId(tenantId, agentRoleKey, windowStart) {
  const dateStr = windowStart.toISOString().split('T')[0]; // YYYY-MM-DD
  return crypto
    .createHash('sha256')
    .update(`${tenantId}:${agentRoleKey}:${dateStr}`)
    .digest('hex')
    .substring(0, 16);
}

// Export internals for testing
export {
  aggregateStats as _aggregateStats,
  identifyFailurePatterns as _identifyFailurePatterns,
  clusterOverrides as _clusterOverrides,
  generateBatchId as _generateBatchId,
};
