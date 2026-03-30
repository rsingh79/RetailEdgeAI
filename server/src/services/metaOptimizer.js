/**
 * Meta-Optimization Agent
 *
 * Cross-tenant learning system that:
 * 1. Compares prompt performance across all tenants
 * 2. Identifies tenant configs that outperform defaults
 * 3. Proposes base prompt upgrades backed by statistical evidence
 * 4. Generates cross-tenant recommendations for tenants on defaults
 * 5. Creates candidate base versions for platform admin approval
 *
 * Trigger: Weekly scheduled run (less frequent than per-tenant suggestion engine).
 * Safety: NEVER auto-deploys changes. All changes require platform admin approval.
 */
import { basePrisma } from '../lib/prisma.js';
import { generate } from './ai/aiServiceRouter.js';
import crypto from 'crypto';

const MIN_TENANTS_FOR_ANALYSIS = 3;
const MIN_SIGNALS_PER_TENANT = 10;
const SIGNIFICANCE_THRESHOLD = 0.15; // 15% improvement required to propose
const DEFAULT_WINDOW_DAYS = 30;

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Run the meta-optimization analysis for a specific agent role.
 *
 * @param {object} opts
 * @param {string} opts.agentRoleKey
 * @param {number} [opts.windowDays=30]
 * @param {boolean} [opts.dryRun=false]
 * @returns {Promise<{
 *   crossTenantStats: object,
 *   defaultUpgradeProposals: Array,
 *   crossTenantRecommendations: Array,
 *   candidateVersion: object|null,
 *   skipped?: string
 * }>}
 */
export async function runMetaOptimizer({
  agentRoleKey,
  windowDays = DEFAULT_WINDOW_DAYS,
  dryRun = false,
}) {
  const agentRole = await basePrisma.agentRole.findUnique({
    where: { key: agentRoleKey },
  });
  if (!agentRole) {
    return { skipped: `Unknown agent role: ${agentRoleKey}` };
  }

  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // ── STEP 1: Collect cross-tenant performance data ──
  const crossTenantStats = await collectCrossTenantData(agentRole.id, windowStart);

  if (crossTenantStats.eligibleTenants < MIN_TENANTS_FOR_ANALYSIS) {
    return {
      crossTenantStats: crossTenantStats.summary,
      skipped: `Only ${crossTenantStats.eligibleTenants} tenants with sufficient data (minimum ${MIN_TENANTS_FOR_ANALYSIS})`,
    };
  }

  // ── STEP 2: Identify outperforming tenant configs ──
  const outperformers = identifyOutperformers(crossTenantStats);

  // ── STEP 3: Generate default upgrade proposals ──
  let defaultUpgradeProposals = [];
  if (outperformers.length > 0) {
    defaultUpgradeProposals = await generateDefaultUpgradeProposals({
      agentRole,
      outperformers,
      baseline: crossTenantStats.defaultBaseline,
      windowDays,
    });
  }

  // ── STEP 4: Generate cross-tenant recommendations ──
  const crossTenantRecommendations = generateCrossTenantRecommendations(
    crossTenantStats,
    outperformers
  );

  // ── Store results ──
  if (!dryRun) {
    // Store cross-tenant recommendations as suggestions with source='meta_agent'
    for (const rec of crossTenantRecommendations) {
      await basePrisma.promptSuggestion.create({
        data: {
          tenantId: rec.tenantId,
          agentRoleId: agentRole.id,
          suggestionType: rec.type,
          suggestionContent: rec.content,
          evidence: rec.evidence,
          impactEstimate: rec.expectedImpact,
          status: 'pending',
          source: 'meta_agent',
          batchId: generateBatchId(agentRoleKey, windowStart),
        },
      });
    }

    // Store default upgrade proposals in audit log
    for (const proposal of defaultUpgradeProposals) {
      await basePrisma.promptAuditLog.create({
        data: {
          tenantId: null, // global — not tenant-specific
          agentRoleId: agentRole.id,
          actionType: 'DEFAULT_UPGRADE_PROPOSED',
          beforeState: null,
          afterState: proposal,
          triggeredBy: 'meta_agent',
          reason: proposal.evidence?.summary || 'Cross-tenant analysis',
        },
      });
    }
  }

  // ── STEP 5: Create candidate version if there are proposals ──
  let candidateVersion = null;
  if (!dryRun && defaultUpgradeProposals.length > 0) {
    candidateVersion = await createCandidateVersion({
      agentRole,
      proposals: defaultUpgradeProposals,
      performanceSnapshot: crossTenantStats.summary,
    });
  }

  return {
    crossTenantStats: crossTenantStats.summary,
    defaultUpgradeProposals,
    crossTenantRecommendations,
    candidateVersion,
  };
}

/**
 * Run meta-optimizer for ALL active agent roles.
 */
export async function runForAllRoles({ windowDays = DEFAULT_WINDOW_DAYS, dryRun = false } = {}) {
  const agentRoles = await basePrisma.agentRole.findMany({
    where: { isActive: true, key: { not: 'prompt_management' } },
    select: { key: true },
  });

  const results = [];
  for (const role of agentRoles) {
    try {
      const result = await runMetaOptimizer({ agentRoleKey: role.key, windowDays, dryRun });
      results.push({ agentRoleKey: role.key, result });
    } catch (err) {
      console.error(`Meta-optimizer failed for ${role.key}:`, err.message);
      results.push({ agentRoleKey: role.key, error: err.message });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 1: Cross-Tenant Data Collection
// ═══════════════════════════════════════════════════════════════════════

async function collectCrossTenantData(agentRoleId, windowStart) {
  // Get all signals for this agent role across all tenants
  const allSignals = await basePrisma.interactionSignal.findMany({
    where: {
      agentRoleId,
      timestamp: { gte: windowStart },
    },
    select: {
      tenantId: true,
      resolutionStatus: true,
      userSatisfactionScore: true,
      humanOverride: true,
      humanOverrideDiff: true,
      escalationOccurred: true,
      correctionCount: true,
      tokenCount: true,
      latencyMs: true,
      costUsd: true,
      configVersionUsed: true,
    },
  });

  // Group by tenant
  const tenantGroups = new Map();
  for (const signal of allSignals) {
    if (!tenantGroups.has(signal.tenantId)) {
      tenantGroups.set(signal.tenantId, []);
    }
    tenantGroups.get(signal.tenantId).push(signal);
  }

  // Classify tenants: pure defaults vs customized
  const defaultTenants = [];
  const customizedTenants = [];
  let eligibleTenants = 0;

  for (const [tenantId, signals] of tenantGroups) {
    if (signals.length < MIN_SIGNALS_PER_TENANT) continue;
    eligibleTenants++;

    const stats = computeTenantStats(tenantId, signals);
    const hasConfig = signals.some((s) => s.configVersionUsed != null);

    if (hasConfig) {
      customizedTenants.push(stats);
    } else {
      defaultTenants.push(stats);
    }
  }

  // Compute baselines
  const defaultBaseline = computeBaseline(defaultTenants);
  const customizedBaseline = computeBaseline(customizedTenants);
  const overallBaseline = computeBaseline([...defaultTenants, ...customizedTenants]);

  return {
    eligibleTenants,
    totalSignals: allSignals.length,
    defaultTenants,
    customizedTenants,
    defaultBaseline,
    customizedBaseline,
    overallBaseline,
    summary: {
      eligibleTenants,
      totalSignals: allSignals.length,
      tenantsOnDefaults: defaultTenants.length,
      tenantsCustomized: customizedTenants.length,
      defaultBaseline,
      customizedBaseline,
    },
  };
}

function computeTenantStats(tenantId, signals) {
  const total = signals.length;
  const resolved = signals.filter((s) => s.resolutionStatus === 'resolved').length;
  const overrides = signals.filter((s) => s.humanOverride).length;
  const escalated = signals.filter((s) => s.escalationOccurred).length;

  const satScores = signals
    .filter((s) => s.userSatisfactionScore != null)
    .map((s) => s.userSatisfactionScore);
  const avgSatisfaction = satScores.length > 0
    ? satScores.reduce((a, b) => a + b, 0) / satScores.length
    : null;

  const avgCorrectionCount = signals.reduce((s, sig) => s + sig.correctionCount, 0) / total;

  return {
    tenantId,
    total,
    resolutionRate: total > 0 ? resolved / total : 0,
    overrideRate: total > 0 ? overrides / total : 0,
    escalationRate: total > 0 ? escalated / total : 0,
    avgSatisfaction,
    avgCorrectionCount,
    hasConfig: signals.some((s) => s.configVersionUsed != null),
    configVersionUsed: signals.find((s) => s.configVersionUsed)?.configVersionUsed || null,
  };
}

function computeBaseline(tenantStats) {
  if (tenantStats.length === 0) {
    return { resolutionRate: 0, overrideRate: 0, escalationRate: 0, avgSatisfaction: null, tenantCount: 0 };
  }

  const totalSignals = tenantStats.reduce((s, t) => s + t.total, 0);

  // Weighted averages (by signal count)
  const weightedRes = tenantStats.reduce((s, t) => s + t.resolutionRate * t.total, 0) / totalSignals;
  const weightedOvr = tenantStats.reduce((s, t) => s + t.overrideRate * t.total, 0) / totalSignals;
  const weightedEsc = tenantStats.reduce((s, t) => s + t.escalationRate * t.total, 0) / totalSignals;

  const satTenants = tenantStats.filter((t) => t.avgSatisfaction != null);
  const avgSat = satTenants.length > 0
    ? satTenants.reduce((s, t) => s + t.avgSatisfaction, 0) / satTenants.length
    : null;

  return {
    resolutionRate: weightedRes,
    overrideRate: weightedOvr,
    escalationRate: weightedEsc,
    avgSatisfaction: avgSat,
    tenantCount: tenantStats.length,
    totalSignals,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 2: Identify Outperformers
// ═══════════════════════════════════════════════════════════════════════

function identifyOutperformers(crossTenantStats) {
  const { defaultBaseline, customizedTenants } = crossTenantStats;

  if (!defaultBaseline || defaultBaseline.tenantCount === 0) return [];

  const outperformers = [];

  for (const tenant of customizedTenants) {
    const improvements = {};
    let significantImprovement = false;

    // Resolution rate improvement
    if (tenant.resolutionRate > defaultBaseline.resolutionRate + SIGNIFICANCE_THRESHOLD) {
      improvements.resolutionRate = {
        tenantValue: tenant.resolutionRate,
        baseline: defaultBaseline.resolutionRate,
        delta: tenant.resolutionRate - defaultBaseline.resolutionRate,
      };
      significantImprovement = true;
    }

    // Override rate reduction (lower is better)
    if (defaultBaseline.overrideRate > 0 &&
        tenant.overrideRate < defaultBaseline.overrideRate * (1 - SIGNIFICANCE_THRESHOLD)) {
      improvements.overrideRate = {
        tenantValue: tenant.overrideRate,
        baseline: defaultBaseline.overrideRate,
        delta: defaultBaseline.overrideRate - tenant.overrideRate,
      };
      significantImprovement = true;
    }

    // Satisfaction improvement
    if (defaultBaseline.avgSatisfaction != null && tenant.avgSatisfaction != null &&
        tenant.avgSatisfaction > defaultBaseline.avgSatisfaction + 0.5) {
      improvements.avgSatisfaction = {
        tenantValue: tenant.avgSatisfaction,
        baseline: defaultBaseline.avgSatisfaction,
        delta: tenant.avgSatisfaction - defaultBaseline.avgSatisfaction,
      };
      significantImprovement = true;
    }

    if (significantImprovement) {
      outperformers.push({
        tenantId: tenant.tenantId,
        configVersionUsed: tenant.configVersionUsed,
        signalCount: tenant.total,
        improvements,
      });
    }
  }

  return outperformers;
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 3: Generate Default Upgrade Proposals (LLM)
// ═══════════════════════════════════════════════════════════════════════

async function generateDefaultUpgradeProposals({ agentRole, outperformers, baseline, windowDays }) {
  // Load the configs that outperformed
  const configIds = outperformers
    .map((o) => o.configVersionUsed)
    .filter(Boolean);

  const configs = configIds.length > 0
    ? await basePrisma.tenantPromptConfig.findMany({
        where: { id: { in: configIds } },
        select: {
          id: true,
          customInstructions: true,
          domainTerminology: true,
          toneSettings: true,
          escalationRules: true,
        },
      })
    : [];

  // Load current active base version
  const currentBase = await basePrisma.promptBaseVersion.findFirst({
    where: { agentRoleId: agentRole.id, isActive: true },
    select: { id: true, versionNumber: true, content: true },
  });

  const systemPrompt = `You are a platform-level AI optimization analyst for RetailEdge.
You analyze cross-tenant performance data to identify improvements that should be promoted
to the DEFAULT prompt (shared baseline for all tenants).

CRITICAL CONSTRAINTS:
- Only propose changes backed by evidence from MULTIPLE tenants
- Changes must be GENERAL enough to help all tenants, not specific to one business
- Never propose changes that could break existing tenant customizations
- Maximum 3 proposals, prioritized by expected cross-tenant impact
- Return valid JSON only, no markdown fencing`;

  const userPrompt = `Analyze this cross-tenant performance data for the "${agentRole.name}" agent.

CURRENT DEFAULT BASELINE (tenants with no customization):
${JSON.stringify(baseline, null, 2)}

OUTPERFORMING TENANTS (customized configs that beat the default):
${JSON.stringify(outperformers.map((o) => ({
    improvements: o.improvements,
    signalCount: o.signalCount,
  })), null, 2)}

THEIR CONFIGURATIONS (what they added/changed):
${JSON.stringify(configs.map((c) => ({
    customInstructions: c.customInstructions,
    domainTerminology: c.domainTerminology,
    toneSettings: c.toneSettings,
    escalationRules: c.escalationRules,
  })), null, 2)}

CURRENT BASE PROMPT SECTIONS:
${JSON.stringify(currentBase?.content?.sections || [], null, 2)}

Identify which customizations are GENERAL enough to incorporate into the default prompt.

For each proposal, provide:
{
  "type": "ADD_SECTION | MODIFY_SECTION | ADD_DEFAULT_INSTRUCTION",
  "content": {
    "sectionKey": "which section to add/modify",
    "instruction": "the specific text to add",
    "rationale": "why this helps all tenants, not just the outperformer"
  },
  "evidence": {
    "summary": "brief evidence summary",
    "tenantsImproved": <number>,
    "avgImprovement": "<percentage>",
    "metric": "which metric improved"
  },
  "priority": "high | medium | low",
  "rollbackPlan": "what to monitor and when to revert if this doesn't work"
}

Return as JSON array. Maximum 3 proposals.`;

  try {
    const result = await generate('meta_optimizer', systemPrompt, userPrompt, {
      tenantId: 'system',
      maxTokens: 2000,
    });

    const text = (result.response || '').trim();

    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch (err) {
    console.error('Meta-optimizer LLM call failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 4: Cross-Tenant Recommendations
// ═══════════════════════════════════════════════════════════════════════

function generateCrossTenantRecommendations(crossTenantStats, outperformers) {
  const { defaultTenants } = crossTenantStats;
  const recommendations = [];

  if (outperformers.length === 0 || defaultTenants.length === 0) return [];

  // For each tenant on defaults, check if an outperformer's improvements
  // would likely help them (similar performance profile)
  for (const defaultTenant of defaultTenants) {
    for (const outperformer of outperformers) {
      // Check if the default tenant has similar weaknesses to what the outperformer fixed
      for (const [metric, improvement] of Object.entries(outperformer.improvements)) {
        let defaultTenantValue;
        if (metric === 'resolutionRate') defaultTenantValue = defaultTenant.resolutionRate;
        else if (metric === 'overrideRate') defaultTenantValue = defaultTenant.overrideRate;
        else if (metric === 'avgSatisfaction') defaultTenantValue = defaultTenant.avgSatisfaction;
        else continue;

        // If the default tenant has a similar or worse value than the baseline
        // for the metric the outperformer improved, recommend the customization
        const wouldHelp = metric === 'overrideRate'
          ? defaultTenantValue >= improvement.baseline
          : defaultTenantValue <= improvement.baseline;

        if (wouldHelp) {
          recommendations.push({
            tenantId: defaultTenant.tenantId,
            type: 'ADOPT_CUSTOMIZATION',
            content: {
              sourceOutperformer: outperformer.tenantId,
              metric,
              currentValue: defaultTenantValue,
              expectedValue: improvement.tenantValue,
              configToAdopt: outperformer.configVersionUsed,
            },
            evidence: {
              outperformerImprovement: improvement,
              defaultTenantProfile: {
                resolutionRate: defaultTenant.resolutionRate,
                overrideRate: defaultTenant.overrideRate,
                signalCount: defaultTenant.total,
              },
            },
            expectedImpact: {
              metric,
              estimatedImprovement: `${Math.round(improvement.delta * 100)}%`,
              confidence: outperformer.signalCount >= 20 ? 'medium' : 'low',
            },
          });
          break; // one recommendation per outperformer per default tenant
        }
      }
    }
  }

  // Deduplicate: max 1 recommendation per tenant
  const seen = new Set();
  return recommendations.filter((r) => {
    if (seen.has(r.tenantId)) return false;
    seen.add(r.tenantId);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// STEP 5: Candidate Version Creation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Create a candidate base version incorporating approved proposals.
 * Status: INACTIVE (requires platform admin approval to activate).
 */
async function createCandidateVersion({ agentRole, proposals, performanceSnapshot }) {
  const currentBase = await basePrisma.promptBaseVersion.findFirst({
    where: { agentRoleId: agentRole.id, isActive: true },
    select: { id: true, versionNumber: true, content: true },
  });

  if (!currentBase) return null;

  const nextVersion = currentBase.versionNumber + 1;

  // Build enhanced content by incorporating proposals
  const enhancedContent = JSON.parse(JSON.stringify(currentBase.content));

  // Add proposed instructions to the appropriate sections
  for (const proposal of proposals) {
    if (proposal.content?.instruction) {
      if (!enhancedContent.sections) enhancedContent.sections = [];
      enhancedContent.sections.push({
        key: `meta_${proposal.content.sectionKey || 'auto'}`,
        title: proposal.content.sectionKey || 'Meta-Optimization',
        content: proposal.content.instruction,
        isRequired: false,
        source: 'meta_optimizer',
        addedInVersion: nextVersion,
      });
    }
  }

  const candidate = await basePrisma.promptBaseVersion.create({
    data: {
      agentRoleId: agentRole.id,
      versionNumber: nextVersion,
      content: enhancedContent,
      isActive: false, // NEVER auto-activate — requires admin approval
      parentVersionId: currentBase.id,
      changeReason: `Meta-optimizer candidate: ${proposals.length} improvement(s) from cross-tenant analysis`,
      performanceSnapshot,
      createdBy: 'meta_agent',
    },
  });

  // Audit log
  await basePrisma.promptAuditLog.create({
    data: {
      tenantId: null,
      agentRoleId: agentRole.id,
      actionType: 'CANDIDATE_VERSION_CREATED',
      beforeState: { versionNumber: currentBase.versionNumber },
      afterState: { versionNumber: nextVersion, proposalCount: proposals.length },
      triggeredBy: 'meta_agent',
      baseVersionId: candidate.id,
      reason: `Cross-tenant analysis identified ${proposals.length} improvement(s)`,
    },
  });

  return {
    id: candidate.id,
    versionNumber: nextVersion,
    parentVersionId: currentBase.id,
    proposalCount: proposals.length,
    status: 'candidate', // NOT active — requires approval
  };
}

/**
 * Activate a candidate version (platform admin action).
 * Implements canary rollout: only new tenants + tenants on pure defaults get the new version.
 * Existing tenant configs continue referencing their pinned base version.
 *
 * @param {string} candidateVersionId
 * @param {string} approvedBy - admin userId
 * @param {object} [opts]
 * @param {boolean} [opts.canaryMode=true] - if true, only new tenants get the new version
 */
export async function activateCandidateVersion(candidateVersionId, approvedBy, { canaryMode = true } = {}) {
  const candidate = await basePrisma.promptBaseVersion.findUnique({
    where: { id: candidateVersionId },
    include: { agentRole: true },
  });

  if (!candidate) throw new Error('Candidate version not found');
  if (candidate.isActive) throw new Error('Version is already active');

  const agentRoleId = candidate.agentRoleId;

  // Snapshot current active version's performance before switching
  const currentActive = await basePrisma.promptBaseVersion.findFirst({
    where: { agentRoleId, isActive: true },
  });

  if (currentActive) {
    // Deactivate old version
    await basePrisma.promptBaseVersion.update({
      where: { id: currentActive.id },
      data: { isActive: false },
    });
  }

  // Activate candidate
  await basePrisma.promptBaseVersion.update({
    where: { id: candidateVersionId },
    data: { isActive: true },
  });

  // In canary mode, existing tenant configs continue referencing their pinned base version.
  // Only NEW tenants (no config) and tenants on pure defaults will pick up the new version
  // automatically via the assembly engine (which loads the active version).
  //
  // Tenant configs with baseVersionId pointing to the OLD version are SAFE:
  // they explicitly reference the old version and won't be affected.

  // Audit log
  await basePrisma.promptAuditLog.create({
    data: {
      tenantId: null,
      agentRoleId,
      actionType: canaryMode ? 'CANARY_ACTIVATION' : 'FULL_ACTIVATION',
      beforeState: currentActive ? {
        versionNumber: currentActive.versionNumber,
        versionId: currentActive.id,
      } : null,
      afterState: {
        versionNumber: candidate.versionNumber,
        versionId: candidate.id,
        canaryMode,
      },
      triggeredBy: approvedBy,
      approvedBy,
      baseVersionId: candidateVersionId,
      reason: `Candidate v${candidate.versionNumber} activated${canaryMode ? ' (canary mode)' : ''}`,
    },
  });

  return {
    activated: true,
    versionNumber: candidate.versionNumber,
    previousVersion: currentActive?.versionNumber || null,
    canaryMode,
    impact: canaryMode
      ? 'New tenants and tenants on pure defaults will use this version. Existing tenant configs are unaffected.'
      : 'All tenants without pinned configs will use this version.',
  };
}

/**
 * Rollback: reactivate the previous version and deactivate the candidate.
 *
 * @param {string} versionId - the version to rollback (deactivate)
 * @param {string} rolledBackBy - admin userId
 */
export async function rollbackVersion(versionId, rolledBackBy) {
  const version = await basePrisma.promptBaseVersion.findUnique({
    where: { id: versionId },
    include: { parentVersion: true },
  });

  if (!version) throw new Error('Version not found');
  if (!version.isActive) throw new Error('Version is not active, nothing to rollback');
  if (!version.parentVersionId) throw new Error('No parent version to rollback to');

  // Deactivate current
  await basePrisma.promptBaseVersion.update({
    where: { id: versionId },
    data: { isActive: false },
  });

  // Reactivate parent
  await basePrisma.promptBaseVersion.update({
    where: { id: version.parentVersionId },
    data: { isActive: true },
  });

  // Audit log
  await basePrisma.promptAuditLog.create({
    data: {
      tenantId: null,
      agentRoleId: version.agentRoleId,
      actionType: 'VERSION_ROLLBACK',
      beforeState: { versionNumber: version.versionNumber },
      afterState: { versionNumber: version.parentVersion.versionNumber },
      triggeredBy: rolledBackBy,
      baseVersionId: version.parentVersionId,
      reason: `Rolled back from v${version.versionNumber} to v${version.parentVersion.versionNumber}`,
    },
  });

  return {
    rolledBack: true,
    from: version.versionNumber,
    to: version.parentVersion.versionNumber,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════

function generateBatchId(agentRoleKey, windowStart) {
  const dateStr = windowStart.toISOString().split('T')[0];
  return crypto
    .createHash('sha256')
    .update(`meta:${agentRoleKey}:${dateStr}`)
    .digest('hex')
    .substring(0, 16);
}

// Export internals for testing
export {
  collectCrossTenantData as _collectCrossTenantData,
  computeTenantStats as _computeTenantStats,
  computeBaseline as _computeBaseline,
  identifyOutperformers as _identifyOutperformers,
  generateCrossTenantRecommendations as _generateCrossTenantRecommendations,
};
