/**
 * AI Service Router
 *
 * Single entry point for all AI calls in the application.
 * Reads the ai_service_registry, loads the right adapter, executes
 * the call, logs the result to ai_service_log, and handles fallback
 * on failure.
 *
 * Public API: generate(), embed(), rerank(), invalidateCache()
 */

import { basePrisma, createTenantClient, adminPrisma } from '../../lib/prisma.js';
import { loadAdapter } from './adapters/index.js';
import { incrementUsage } from '../usageTracker.js';
import { AI_THROTTLE } from '../../config/tierLimits.js';

// ─── Registry Cache ─────────────────────────────────────────
// In-memory cache of registry entries, keyed by taskKey.
// Avoids a database query on every AI call.
const registryCache = new Map();
let registryCacheTimestamp = 0;
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Usage-Cap Model Throttling ─────────────────────────────
// When usage hits 95%+, expensive models are swapped for cheaper ones.
// This is an override layer on top of whatever the registry decided.
const THROTTLE_MODEL_MAP = {
  'claude-sonnet-4-6': 'claude-haiku-4-5',
  'claude-sonnet-4-20250514': 'claude-haiku-4-5-20251001',
  'command-r-plus': 'command-r7b',
  // Already cheap — keep as-is
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'command-r7b': 'command-r7b',
};

function _getThrottledModel(intendedModel) {
  return THROTTLE_MODEL_MAP[intendedModel] || intendedModel;
}

const THROTTLE_MAX_TOKENS = 1000;

// ─── Public API ─────────────────────────────────────────────

/**
 * TEXT_GENERATION intent.
 *
 * @param {string} taskKey - Registry task key, e.g. 'ocr_extraction'
 * @param {string} systemPrompt - System prompt text
 * @param {string|Array} userPrompt - User message (string or content blocks array for vision)
 * @param {object} options - Optional overrides:
 *   - tenantId: string (for logging attribution)
 *   - maxTokens: number (overrides registry config)
 *   - temperature: number
 *   - tools: array (for tool-use)
 *   - messages: array (for multi-turn, overrides systemPrompt+userPrompt)
 *   - stream: boolean (for streaming responses)
 *   - any other provider-specific config
 * @returns {Promise<{response: string|null, inputTokens: number, outputTokens: number,
 *           latencyMs: number, model: string, provider: string, toolUse?: array, rawStream?: object, raw?: object}>}
 */
export async function generate(taskKey, systemPrompt, userPrompt, options = {}) {
  const entry = await _getRegistryEntry(taskKey);

  if (entry.intent !== 'TEXT_GENERATION') {
    throw {
      code: 'INTENT_MISMATCH',
      taskKey,
      expected: 'TEXT_GENERATION',
      actual: entry.intent,
      message: `Task '${taskKey}' is registered as ${entry.intent}, not TEXT_GENERATION.`,
      retryable: false,
    };
  }

  const { tenantId, userId, requestSnippet, ...configOverrides } = options;
  const mergedConfig = { ...entry.config, ...configOverrides };

  // ── AI query usage enforcement (tenant-scoped requests only) ──
  let usageMeta = null;
  if (tenantId) {
    try {
      const usage = await incrementUsage(null, tenantId, 'aiQueries');

      if (!usage.isUnlimited) {
        const pct = usage.percentUsed;

        if (pct >= AI_THROTTLE.hardLimitPercent) {
          // Stage 4: Hard limit — return immediately, no API call
          return {
            response: null,
            limitReached: true,
            message: `You've had a busy month! Your plan includes ${usage.limit} AI interactions per month. Upgrade for more, or your usage resets at the start of next month.`,
            upgradeUrl: '/settings/billing',
            provider: entry.provider,
            model: entry.model,
            inputTokens: 0,
            outputTokens: 0,
            latencyMs: 0,
          };
        }

        if (pct >= AI_THROTTLE.throttlePercent) {
          // Stage 3: Throttle — override model to cheaper variant, cap tokens
          mergedConfig._modelOverride = _getThrottledModel(entry.model);
          mergedConfig.maxTokens = Math.min(mergedConfig.maxTokens || 4096, THROTTLE_MAX_TOKENS);
        }

        if (pct >= AI_THROTTLE.softWarningPercent) {
          // Stage 2 (90-94%): Normal models, but flag for notification header
          // Stage 3 (95-99%): Already throttled above, also flag
          usageMeta = {
            percentUsed: pct,
            limit: usage.limit,
            remaining: usage.remaining,
          };
        }
      }
    } catch (err) {
      // Usage tracking failure must NEVER block AI calls — degrade gracefully
      console.warn('[ASAL] Usage tracking failed, proceeding without enforcement:', err.message);
    }
  }

  const result = await _executeCall(
    taskKey,
    'TEXT_GENERATION',
    async (adapter, model, config) => adapter.generate(systemPrompt, userPrompt, model, config),
    mergedConfig,
    { tenantId, userId, requestSnippet },
  );

  // Attach usage metadata for response middleware to set X-Usage-Approaching-Limit header
  if (usageMeta) {
    result._usageMeta = usageMeta;
  }

  return result;
}

/**
 * EMBEDDING intent.
 *
 * @param {string} taskKey - Registry task key, e.g. 'product_matching_embed'
 * @param {string|string[]} text - Text to embed (single string or batch array)
 * @param {object} options - Optional: tenantId, inputType ('document'|'query')
 * @returns {Promise<{vectors: number[][], model: string, provider: string, tokenCount: number, latencyMs: number}>}
 */
export async function embed(taskKey, text, options = {}) {
  const entry = await _getRegistryEntry(taskKey);

  if (entry.intent !== 'EMBEDDING') {
    throw {
      code: 'INTENT_MISMATCH',
      taskKey,
      expected: 'EMBEDDING',
      actual: entry.intent,
      message: `Task '${taskKey}' is registered as ${entry.intent}, not EMBEDDING.`,
      retryable: false,
    };
  }

  const { tenantId, userId, requestSnippet, ...configOverrides } = options;
  const mergedConfig = { ...entry.config, ...configOverrides };

  return _executeCall(
    taskKey,
    'EMBEDDING',
    async (adapter, model, config) => adapter.embed(text, model, config),
    mergedConfig,
    { tenantId, userId, requestSnippet },
  );
}

/**
 * RERANKING intent.
 *
 * @param {string} taskKey - Registry task key, e.g. 'advisor_context_rerank'
 * @param {string} query - The query to rank against
 * @param {string[]} documents - Candidate documents to rerank
 * @param {object} options - Optional: tenantId, topN
 * @returns {Promise<{results: Array<{index: number, relevanceScore: number, document: string}>,
 *           model: string, provider: string, latencyMs: number}>}
 */
export async function rerank(taskKey, query, documents, options = {}) {
  const entry = await _getRegistryEntry(taskKey);

  if (entry.intent !== 'RERANKING') {
    throw {
      code: 'INTENT_MISMATCH',
      taskKey,
      expected: 'RERANKING',
      actual: entry.intent,
      message: `Task '${taskKey}' is registered as ${entry.intent}, not RERANKING.`,
      retryable: false,
    };
  }

  const { tenantId, userId, requestSnippet, ...configOverrides } = options;
  const mergedConfig = { ...entry.config, ...configOverrides };

  return _executeCall(
    taskKey,
    'RERANKING',
    async (adapter, model, config) => adapter.rerank(query, documents, model, config),
    mergedConfig,
    { tenantId, userId, requestSnippet },
  );
}

/**
 * Clears the registry cache. Next call will reload from database.
 * Use after registry updates (admin UI, seed, migration).
 */
export function invalidateCache() {
  registryCache.clear();
  registryCacheTimestamp = 0;
}

// ─── Internal ───────────────────────────────────────────────

/**
 * Loads all active registry entries from the database into the cache.
 * Called lazily on first access and when cache expires.
 */
async function _loadRegistry() {
  const entries = await basePrisma.aiServiceRegistry.findMany({
    where: { isActive: true },
  });
  registryCache.clear();
  for (const entry of entries) {
    registryCache.set(entry.taskKey, entry);
  }
  registryCacheTimestamp = Date.now();
}

/**
 * Returns the registry entry for a task key.
 * Loads/refreshes cache if stale.
 * Throws if task key not found or not active.
 */
async function _getRegistryEntry(taskKey) {
  if (Date.now() - registryCacheTimestamp > REGISTRY_CACHE_TTL_MS || registryCache.size === 0) {
    await _loadRegistry();
  }
  const entry = registryCache.get(taskKey);
  if (!entry) {
    throw {
      code: 'TASK_KEY_NOT_FOUND',
      taskKey,
      message: `No active registry entry for task '${taskKey}'. Check ai_service_registry table.`,
      retryable: false,
    };
  }
  return entry;
}

/**
 * Core execution function.
 * Loads the adapter, calls it, logs the result, handles fallback on failure.
 */
async function _executeCall(taskKey, intent, callFn, mergedConfig, meta = {}) {
  const entry = await _getRegistryEntry(taskKey);
  // Usage-cap throttling can override the registry's model choice.
  // The override is injected by generate() — _executeCall itself is unaware of why.
  const effectiveModel = mergedConfig._modelOverride || entry.model;
  const startTime = Date.now();

  try {
    const adapter = await loadAdapter(entry.provider);
    const result = await callFn(adapter, effectiveModel, mergedConfig);
    const latencyMs = Date.now() - startTime;

    // Attach provider metadata to result
    result.provider = entry.provider;
    result.model = effectiveModel;
    result.latencyMs = latencyMs;

    // Fire-and-forget logging
    _logCall({ ...entry, model: effectiveModel }, { ...result, latencyMs, status: 'success' }, false, meta.tenantId).catch(
      () => {},
    );
    _logLegacy({ ...entry, model: effectiveModel }, { ...result, status: 'success', estimatedCost: _estimateCost(entry, result) }, meta).catch(() => {});

    return result;
  } catch (primaryError) {
    const latencyMs = Date.now() - startTime;

    // Log primary failure (fire-and-forget)
    _logCall(
      { ...entry, model: effectiveModel },
      { latencyMs, status: 'failure', errorCode: primaryError.code || 'UNKNOWN' },
      false,
      meta.tenantId,
    ).catch(() => {});
    _logLegacy({ ...entry, model: effectiveModel }, { latencyMs, status: 'failure', estimatedCost: null }, meta).catch(() => {});

    // Attempt fallback if configured and error is retryable
    if (entry.fallbackProvider && entry.fallbackModel && primaryError.retryable !== false) {
      try {
        const fallbackAdapter = await loadAdapter(entry.fallbackProvider);
        const fallbackStartTime = Date.now();
        const fallbackResult = await callFn(fallbackAdapter, entry.fallbackModel, mergedConfig);
        const fallbackLatencyMs = Date.now() - fallbackStartTime;

        fallbackResult.provider = entry.fallbackProvider;
        fallbackResult.model = entry.fallbackModel;
        fallbackResult.latencyMs = fallbackLatencyMs;

        // Log fallback success (fire-and-forget)
        _logCall(
          { ...entry, provider: entry.fallbackProvider, model: entry.fallbackModel },
          { ...fallbackResult, latencyMs: fallbackLatencyMs, status: 'fallback_success' },
          true,
          meta.tenantId,
        ).catch(() => {});
        _logLegacy(
          { ...entry, model: entry.fallbackModel },
          { ...fallbackResult, status: 'fallback_success', estimatedCost: _estimateCost(entry, fallbackResult) },
          meta,
        ).catch(() => {});

        return fallbackResult;
      } catch (fallbackError) {
        // Fallback also failed — throw the original error (more informative)
        throw primaryError;
      }
    }

    // No fallback configured or error is not retryable
    throw primaryError;
  }
}

/**
 * Logs an AI service call to the ai_service_log table.
 * Fire-and-forget — NEVER block the caller, NEVER throw.
 */
async function _logCall(entry, result, isFallback, tenantId) {
  try {
    const prismaClient = tenantId ? createTenantClient(tenantId) : adminPrisma;
    // For embed calls, Cohere returns tokenCount (billed input tokens) rather than
    // inputTokens/outputTokens. Map tokenCount → inputTokens for consistent logging.
    const inputTokens = result.inputTokens || result.tokenCount || null;
    const outputTokens = result.outputTokens || null;
    await prismaClient.aiServiceLog.create({
      data: {
        tenantId: tenantId || null,
        intent: entry.intent,
        taskKey: entry.taskKey,
        provider: entry.provider,
        model: entry.model,
        isFallback,
        inputTokens,
        outputTokens,
        latencyMs: result.latencyMs || 0,
        estimatedCost: _estimateCost(entry, result),
        status: result.status || 'success',
        errorCode: result.errorCode || null,
      },
    });
  } catch (err) {
    // Silently swallow — logging must never break the AI call
    console.warn(`[ASAL] Failed to log AI service call for ${entry.taskKey}:`, err.message);
  }
}

/**
 * Legacy logging to ApiUsageLog for backward compatibility.
 * The rate limiter (apiLimiter.js) and admin dashboard read from this table.
 * TEMPORARY — remove once rate limiter and dashboard migrate to ai_service_log.
 */
async function _logLegacy(entry, result, meta = {}) {
  try {
    const prismaClient = meta.tenantId ? createTenantClient(meta.tenantId) : adminPrisma;
    // For embed calls, Cohere returns tokenCount rather than inputTokens/outputTokens.
    const inputTokens = result.inputTokens || result.tokenCount || 0;
    const outputTokens = result.outputTokens || 0;
    await prismaClient.apiUsageLog.create({
      data: {
        tenantId: meta.tenantId || null,
        userId: meta.userId || null,
        endpoint: entry.taskKey,
        model: entry.model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: result.estimatedCost ? parseFloat(result.estimatedCost) : 0,
        durationMs: result.latencyMs || 0,
        status: result.status === 'success' || result.status === 'fallback_success' ? 'success' : 'error',
        requestPayload: meta.requestSnippet ? meta.requestSnippet.substring(0, 2000) : null,
        responsePayload: result.response ? String(result.response).substring(0, 2000) : null,
      },
    });
  } catch (err) {
    // Silently swallow — same fire-and-forget contract as _logCall
  }
}

/**
 * Estimates the cost of a call based on registry pricing config.
 * Returns null if pricing info is unavailable.
 */
function _estimateCost(entry, result) {
  if (!entry.costPerUnit || !entry.costUnit) return null;

  const costPerUnit = parseFloat(entry.costPerUnit);

  switch (entry.costUnit) {
    case 'per_million_input_tokens':
      return result.inputTokens ? (result.inputTokens / 1_000_000) * costPerUnit : null;
    case 'per_million_output_tokens':
      return result.outputTokens ? (result.outputTokens / 1_000_000) * costPerUnit : null;
    case 'per_million_tokens':
      return result.tokenCount ? (result.tokenCount / 1_000_000) * costPerUnit : null;
    case 'per_1000_searches':
      return costPerUnit / 1000; // one search per call
    default:
      return null;
  }
}
