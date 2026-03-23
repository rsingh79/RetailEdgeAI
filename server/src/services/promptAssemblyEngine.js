/**
 * Prompt Assembly Engine — the critical hot path for every agent request.
 *
 * Replaces the old promptComposer.js with a 6-step assembly pipeline:
 *   1. Load base prompt (from PromptBaseVersion)
 *   2. Load tenant config (from TenantPromptConfig)
 *   3. Merge tenant config into base (structured, additive)
 *   4. Select and inject few-shot examples
 *   5. Inject runtime context
 *   6. Produce final prompt + version metadata
 *
 * Design constraints:
 *   - FAST: two-layer cache (base versions rarely change, tenant configs infrequently)
 *   - DETERMINISTIC: same inputs always produce same output
 *   - AUDITABLE: returns metadata recording exact versions used
 *   - ADDITIVE: tenant config never removes base content, only adds/modifies emphasis
 *
 * Integration points (replaces current prompt loading in):
 *   - server/src/services/ocr.js:87           → extractInvoiceData()
 *   - server/src/services/matching.js:370      → aiBatchMatch()
 *   - server/src/services/agents/orchestrator.js:95 → runAdvisorStreaming()
 *
 * @module promptAssemblyEngine
 */

import { basePrisma } from '../lib/prisma.js';

// ═══════════════════════════════════════════════════════════════════════════════
// CACHE LAYER
// ═══════════════════════════════════════════════════════════════════════════════
//
// Two-tier cache:
//   L1 — Base versions: keyed by agentRoleKey. Changes rarely (admin publishes
//         new version). Long TTL (15 min). Invalidated on base version publish.
//   L2 — Tenant configs + few-shots: keyed by agentRoleKey:tenantId. Changes
//         when tenant admin modifies config. Medium TTL (5 min). Invalidated
//         on config update.
//
// Both are in-memory Maps. Suitable for single-server. For horizontal scaling,
// swap to Redis with pub/sub invalidation.
// ═══════════════════════════════════════════════════════════════════════════════

const BASE_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const baseCache = new Map();   // agentRoleKey → { value, expiresAt }
const tenantCache = new Map(); // agentRoleKey:tenantId → { value, expiresAt }

function getCached(cache, key) {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  if (entry) cache.delete(key); // expired
  return null;
}

function setCache(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CACHE INVALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Invalidate base prompt cache for an agent role.
 * Call when: admin publishes a new PromptBaseVersion.
 */
export function invalidateBaseCache(agentRoleKey) {
  baseCache.delete(agentRoleKey);
  // Also invalidate all tenant caches for this agent since they depend on base
  for (const key of tenantCache.keys()) {
    if (key.startsWith(`${agentRoleKey}:`)) {
      tenantCache.delete(key);
    }
  }
}

/**
 * Invalidate tenant config cache for a specific tenant + agent.
 * Call when: tenant config is updated, few-shot example is added/removed.
 */
export function invalidateTenantCache(agentRoleKey, tenantId) {
  tenantCache.delete(`${agentRoleKey}:${tenantId}`);
}

/**
 * Clear all caches. Call on server restart or emergency.
 */
export function clearAllCaches() {
  baseCache.clear();
  tenantCache.clear();
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: LOAD BASE PROMPT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load the active base prompt version for an agent role.
 * Returns the PromptBaseVersion record or null.
 * @param {string} agentRoleKey
 * @returns {Promise<Object|null>}
 */
async function loadBasePrompt(agentRoleKey) {
  const cached = getCached(baseCache, agentRoleKey);
  if (cached) return cached;

  const agentRole = await basePrisma.agentRole.findUnique({
    where: { key: agentRoleKey },
  });
  if (!agentRole || !agentRole.isActive) return null;

  const baseVersion = await basePrisma.promptBaseVersion.findFirst({
    where: { agentRoleId: agentRole.id, isActive: true },
  });
  if (!baseVersion) return null;

  const result = {
    id: baseVersion.id,
    agentRoleId: agentRole.id,
    agentRoleKey,
    versionNumber: baseVersion.versionNumber,
    content: baseVersion.content,
    model: agentRole.model,
    maxTokens: agentRole.maxTokens,
  };

  setCache(baseCache, agentRoleKey, result, BASE_CACHE_TTL_MS);
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: LOAD TENANT CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load the active tenant config for a tenant + agent role.
 * Returns null if no tenant-specific config exists (tenant uses pure defaults).
 * @param {string} agentRoleKey
 * @param {string} tenantId
 * @param {string} agentRoleId
 * @returns {Promise<Object|null>}
 */
async function loadTenantConfig(agentRoleKey, tenantId, agentRoleId) {
  const cacheKey = `${agentRoleKey}:${tenantId}`;
  const cached = getCached(tenantCache, cacheKey);
  if (cached !== null) return cached;  // null vs undefined: null = checked, no config

  const config = await basePrisma.tenantPromptConfig.findFirst({
    where: { tenantId, agentRoleId, isActive: true },
  });

  // Also load few-shot examples for this tenant + agent
  const examples = await basePrisma.tenantFewShotExample.findMany({
    where: { tenantId, agentRoleId, isActive: true },
    orderBy: { qualityScore: 'desc' },
    take: 10, // load top 10, we'll select N at assembly time
  });

  const result = {
    config: config || null,
    examples: examples || [],
  };

  setCache(tenantCache, cacheKey, result, TENANT_CACHE_TTL_MS);
  return result;
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: MERGE TENANT CONFIG INTO BASE (ADDITIVE ONLY)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Merge structured tenant configuration into the base prompt text.
 * This is ADDITIVE — tenant config never removes base content.
 *
 * @param {string} baseSystemPrompt — the base prompt text
 * @param {Object|null} tenantConfig — TenantPromptConfig record
 * @returns {string} — merged prompt text
 */
function mergeConfig(baseSystemPrompt, tenantConfig) {
  if (!tenantConfig) return baseSystemPrompt;

  const sections = [];

  // Start with the full base prompt
  sections.push(baseSystemPrompt);

  // ── Tone settings: prepend as a behavioral modifier ──
  const tone = tenantConfig.toneSettings;
  if (tone) {
    const toneLines = [];
    if (tone.formality) toneLines.push(`Formality level: ${tone.formality}`);
    if (tone.verbosity) toneLines.push(`Detail level: ${tone.verbosity}`);
    if (tone.personality) toneLines.push(`Personality: ${tone.personality}`);
    if (tone.language) toneLines.push(`Language preference: ${tone.language}`);
    if (tone.currencyFormat) toneLines.push(`Currency format: ${tone.currencyFormat}`);
    if (toneLines.length > 0) {
      sections.push(`\nCOMMUNICATION PREFERENCES:\n${toneLines.join('\n')}`);
    }
  }

  // ── Custom instructions: insert as additional rules ──
  const instructions = tenantConfig.customInstructions;
  if (Array.isArray(instructions) && instructions.length > 0) {
    // Sort by priority (lower number = higher priority)
    const sorted = [...instructions].sort((a, b) => (a.priority || 50) - (b.priority || 50));
    const lines = sorted.map((inst) => `- ${inst.text}`).join('\n');
    sections.push(`\nADDITIONAL RULES (tenant-specific):\n${lines}`);
  }

  // ── Domain terminology: append as a glossary ──
  const terms = tenantConfig.domainTerminology;
  if (Array.isArray(terms) && terms.length > 0) {
    const termLines = terms.map((t) => {
      let line = `- ${t.term}: ${t.definition}`;
      if (t.context) line += ` (${t.context})`;
      return line;
    }).join('\n');
    sections.push(`\nDOMAIN GLOSSARY:\n${termLines}`);
  }

  // ── Escalation rules: insert as conditional instructions ──
  const escalations = tenantConfig.escalationRules;
  if (Array.isArray(escalations) && escalations.length > 0) {
    const active = escalations.filter((e) => e.isActive !== false);
    if (active.length > 0) {
      const escLines = active.map((e) => {
        let line = `- IF ${e.condition} THEN ${e.action}`;
        if (e.severity === 'critical') line += ' [CRITICAL]';
        if (e.message) line += ` — "${e.message}"`;
        return line;
      }).join('\n');
      sections.push(`\nESCALATION RULES:\n${escLines}`);
    }
  }

  // ── Knowledge source priorities: add as a guidance section ──
  const sources = tenantConfig.knowledgeSourcePriorities;
  if (Array.isArray(sources) && sources.length > 0) {
    const enabled = sources.filter((s) => s.isEnabled !== false);
    if (enabled.length > 0) {
      const sorted = [...enabled].sort((a, b) => (a.priority || 5) - (b.priority || 5));
      const sourceLines = sorted.map((s, i) => {
        let line = `${i + 1}. ${s.sourceType}`;
        if (s.notes) line += ` — ${s.notes}`;
        return line;
      }).join('\n');
      sections.push(`\nDATA SOURCE PRIORITY (check in this order):\n${sourceLines}`);
    }
  }

  return sections.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: SELECT AND INJECT FEW-SHOT EXAMPLES
// ═══════════════════════════════════════════════════════════════════════════════

/** Default number of few-shot examples to include */
const DEFAULT_FEW_SHOT_COUNT = 3;

/**
 * Select and format few-shot examples for injection into the prompt.
 *
 * @param {Array} tenantExamples — from TenantFewShotExample, sorted by qualityScore desc
 * @param {Object} baseContent — PromptBaseVersion.content JSON
 * @param {number} maxExamples — max examples to include
 * @returns {{ text: string, exampleIds: string[] }}
 */
function selectFewShotExamples(tenantExamples, baseContent, maxExamples = DEFAULT_FEW_SHOT_COUNT) {
  const exampleIds = [];

  // Prefer tenant-specific examples
  let examples = tenantExamples.slice(0, maxExamples);

  // If not enough tenant examples, use base prompt's built-in examples (if any)
  if (examples.length < maxExamples && baseContent?.sections) {
    const baseSectionExamples = baseContent.sections
      .filter((s) => s.key === 'examples' || s.key === 'few_shot')
      .map((s) => s.content);

    // Base examples are embedded in the base prompt, not injected separately.
    // Only add them if no tenant examples exist at all.
    if (examples.length === 0 && baseSectionExamples.length > 0) {
      return { text: '', exampleIds: [] }; // base examples are already in the prompt
    }
  }

  if (examples.length === 0) {
    return { text: '', exampleIds: [] };
  }

  // Format as conversation examples
  const formatted = examples.map((ex) => {
    exampleIds.push(ex.id);
    return `Example:\nUser: ${ex.inputText}\nAssistant: ${ex.idealOutputText}`;
  }).join('\n\n');

  return {
    text: `\nEXAMPLES:\n${formatted}`,
    exampleIds,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: INJECT RUNTIME CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a runtime context section from the provided context object.
 *
 * @param {Object} runtimeContext
 * @param {string} [runtimeContext.currentDate] — ISO date string
 * @param {Object} [runtimeContext.userAttributes] — { name, role, etc. }
 * @param {string[]} [runtimeContext.availableTools] — tool names
 * @param {Object} [runtimeContext.sessionMetadata] — arbitrary key-value pairs
 * @returns {string} — context section text (empty string if no context)
 */
function buildRuntimeContext(runtimeContext) {
  if (!runtimeContext) return '';

  const parts = [];

  if (runtimeContext.currentDate) {
    parts.push(`Current date: ${runtimeContext.currentDate}`);
  }

  if (runtimeContext.userAttributes) {
    const attrs = runtimeContext.userAttributes;
    const attrLines = Object.entries(attrs)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (attrLines) parts.push(`User:\n${attrLines}`);
  }

  if (runtimeContext.availableTools?.length > 0) {
    parts.push(`Available tools: ${runtimeContext.availableTools.join(', ')}`);
  }

  if (runtimeContext.sessionMetadata) {
    const meta = runtimeContext.sessionMetadata;
    const metaLines = Object.entries(meta)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n');
    if (metaLines) parts.push(`Session:\n${metaLines}`);
  }

  if (parts.length === 0) return '';
  return '\n\nCONTEXT:\n' + parts.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: ASSEMBLE + RETURN METADATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rough token estimate based on character count.
 * Claude uses ~4 chars per token for English text.
 * This is an estimate — for exact counts use the tokenizer.
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}


// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assemble the final prompt for an agent + tenant.
 *
 * This is the main entry point — called before every LLM request.
 *
 * @param {Object} opts
 * @param {string} opts.agentRoleKey — e.g. "ocr_extraction", "business_advisor"
 * @param {string} opts.tenantId — tenant ID
 * @param {Object} [opts.runtimeContext] — optional runtime context (date, user, tools)
 * @param {number} [opts.maxFewShotExamples] — max few-shot examples (default 3)
 * @returns {Promise<AssemblyResult|null>} — null if agent role not found/inactive
 *
 * @typedef {Object} AssemblyResult
 * @property {string} prompt — the fully assembled prompt text
 * @property {string} model — the Claude model to use
 * @property {number} maxTokens — max response tokens
 * @property {AssemblyMetadata} metadata — version tracking for InteractionSignal
 */

/**
 * @typedef {Object} AssemblyMetadata
 * @property {string} baseVersionId — PromptBaseVersion.id used
 * @property {number} baseVersionNumber — PromptBaseVersion.versionNumber
 * @property {string|null} tenantConfigId — TenantPromptConfig.id used (null if defaults only)
 * @property {number|null} tenantConfigVersion — TenantPromptConfig.versionNumber
 * @property {string[]} exampleIdsUsed — TenantFewShotExample.id[] included in prompt
 * @property {string} assemblyTimestamp — ISO timestamp of assembly
 * @property {number} totalTokenEstimate — rough token count of assembled prompt
 */

export async function assemblePrompt({
  agentRoleKey,
  tenantId,
  runtimeContext = null,
  maxFewShotExamples = DEFAULT_FEW_SHOT_COUNT,
}) {
  // ── STEP 1: Load base prompt ──
  const base = await loadBasePrompt(agentRoleKey);
  if (!base) return null;

  const baseContent = base.content;
  const baseSystemPrompt = baseContent.systemPrompt || '';

  // ── STEP 2: Load tenant config + examples ──
  const tenantData = await loadTenantConfig(agentRoleKey, tenantId, base.agentRoleId);
  const tenantConfig = tenantData?.config || null;
  const tenantExamples = tenantData?.examples || [];

  // ── Handle version pinning / upgrade mismatch ──
  // If tenant config pins to a different base version than what's currently active,
  // log a warning but proceed with the active base version. The config is still
  // structurally compatible because overrides are additive, not positional.
  if (tenantConfig && tenantConfig.baseVersionId !== base.id) {
    // Tenant config was created against a different base version.
    // The structured fields (tone, instructions, terminology) are base-agnostic,
    // so they merge safely. Log for observability.
    console.info(
      `[PromptAssembly] Tenant ${tenantId} config pinned to base ${tenantConfig.baseVersionId} ` +
      `but active base is ${base.id} (v${base.versionNumber}). Merging anyway (additive).`
    );
  }

  // ── STEP 3: Merge tenant config into base ──
  let mergedPrompt = mergeConfig(baseSystemPrompt, tenantConfig);

  // ── Check enabled capabilities ──
  // If the tenant config disables certain capabilities, append a note.
  if (tenantConfig?.enabledCapabilities) {
    const caps = tenantConfig.enabledCapabilities;
    const disabled = Object.entries(caps)
      .filter(([, enabled]) => enabled === false)
      .map(([name]) => name);
    if (disabled.length > 0) {
      mergedPrompt += `\n\nDISABLED CAPABILITIES (do not use these):\n- ${disabled.join('\n- ')}`;
    }
  }

  // ── STEP 4: Select and inject few-shot examples ──
  const { text: examplesText, exampleIds } = selectFewShotExamples(
    tenantExamples,
    baseContent,
    maxFewShotExamples,
  );
  if (examplesText) {
    mergedPrompt += examplesText;
  }

  // ── STEP 5: Inject runtime context ──
  const contextText = buildRuntimeContext(runtimeContext);
  if (contextText) {
    mergedPrompt += contextText;
  }

  // ── STEP 6: Produce final prompt + metadata ──
  const metadata = {
    baseVersionId: base.id,
    baseVersionNumber: base.versionNumber,
    tenantConfigId: tenantConfig?.id || null,
    tenantConfigVersion: tenantConfig?.versionNumber || null,
    exampleIdsUsed: exampleIds,
    assemblyTimestamp: new Date().toISOString(),
    totalTokenEstimate: estimateTokens(mergedPrompt),
  };

  // Update usage counters for examples (fire-and-forget)
  if (exampleIds.length > 0) {
    basePrisma.tenantFewShotExample.updateMany({
      where: { id: { in: exampleIds } },
      data: { timesUsed: { increment: 1 }, lastUsedAt: new Date() },
    }).catch((err) => console.error('[PromptAssembly] Failed to update example usage:', err.message));
  }

  return {
    prompt: mergedPrompt,
    model: base.model,
    maxTokens: base.maxTokens,
    metadata,
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY — bridge from old API
// ═══════════════════════════════════════════════════════════════════════════════
//
// The old promptComposer.js exported getEffectivePrompt(agentTypeKey, tenantId).
// During migration (Phase 3), callers can use this drop-in replacement that
// delegates to the new assembly engine with no runtime context or few-shot.
//
// Integration points that need updating:
//
//   FILE                                    OLD CALL                                    NEW CALL
//   ─────────────────────────────────────   ─────────────────────────────────────────   ────────────────────────────────────────────
//   server/src/services/ocr.js:87          getEffectivePrompt('ocr_extraction', tid)   assemblePrompt({ agentRoleKey: 'ocr_extraction', tenantId })
//   server/src/services/matching.js:370    getEffectivePrompt('product_matching', tid)  assemblePrompt({ agentRoleKey: 'product_matching', tenantId })
//   server/src/services/agents/            SYSTEM_PROMPT (hardcoded constant)           assemblePrompt({ agentRoleKey: 'business_advisor', tenantId, runtimeContext })
//     orchestrator.js:95
//

/**
 * Drop-in replacement for the old getEffectivePrompt().
 * Returns the same shape as the old function for backward compatibility.
 *
 * @param {string} agentTypeKey — agent role key
 * @param {string} tenantId — tenant ID
 * @returns {Promise<{prompt: string, metadata: AssemblyMetadata}|null>}
 */
export async function getEffectivePrompt(agentTypeKey, tenantId) {
  // During migration phase: try new tables first, fall back to old composer
  try {
    const result = await assemblePrompt({ agentRoleKey: agentTypeKey, tenantId });
    if (result) return result;
  } catch {
    // New tables don't exist yet — fall through to legacy
  }

  // Legacy fallback: delegate to old promptComposer
  // This import is dynamic to avoid circular dependency during migration
  try {
    const { getEffectivePrompt: legacyGet } = await import('./promptComposer.js');
    const legacy = await legacyGet(agentTypeKey, tenantId);
    if (legacy) {
      return {
        prompt: legacy.prompt,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        metadata: {
          baseVersionId: 'legacy',
          baseVersionNumber: 0,
          tenantConfigId: null,
          tenantConfigVersion: null,
          exampleIdsUsed: [],
          assemblyTimestamp: new Date().toISOString(),
          totalTokenEstimate: estimateTokens(legacy.prompt),
        },
      };
    }
  } catch {
    // Old tables also missing — return null
  }

  return null;
}


// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE INTEGRATION — how callers should use this module
// ═══════════════════════════════════════════════════════════════════════════════
//
// ── OCR (ocr.js) ──
// Replace lines 84-93 with:
//
//   import { assemblePrompt } from './promptAssemblyEngine.js';
//
//   const assembly = await assemblePrompt({
//     agentRoleKey: 'ocr_extraction',
//     tenantId,
//   });
//   const promptText = assembly?.prompt || FALLBACK_EXTRACTION_PROMPT;
//   const promptMeta = assembly?.metadata || null;
//
//   // After the Claude call, store promptMeta in the InteractionSignal
//
//
// ── Matching (matching.js) ──
// Replace lines 357-381 with:
//
//   import { assemblePrompt } from './promptAssemblyEngine.js';
//
//   const assembly = await assemblePrompt({
//     agentRoleKey: 'product_matching',
//     tenantId,
//   });
//   // Use assembly.prompt for the instruction portion;
//   // catalog + lines data injection stays in matching.js
//   // For matching, the base prompt's systemPrompt IS the preamble,
//   // and the sections contain the matching rules.
//   // The postamble (output format instructions) is in baseContent.outputFormat
//   // or a dedicated section.
//
//
// ── Business Advisor (orchestrator.js) ──
// Replace SYSTEM_PROMPT constant and usage at lines 25-48, 95 with:
//
//   import { assemblePrompt } from '../promptAssemblyEngine.js';
//
//   // Inside runAdvisorStreaming():
//   const assembly = await assemblePrompt({
//     agentRoleKey: 'business_advisor',
//     tenantId,
//     runtimeContext: {
//       currentDate: new Date().toISOString().split('T')[0],
//       userAttributes: { name: req.user.name, role: req.user.role },
//       availableTools: allToolDefs.map(t => t.name),
//     },
//   });
//   const systemPrompt = assembly?.prompt || SYSTEM_PROMPT; // fallback
//
//   // Pass to trackedClaudeCall:
//   system: systemPrompt,
//
//   // After the call, include assembly.metadata in the response for signal logging
