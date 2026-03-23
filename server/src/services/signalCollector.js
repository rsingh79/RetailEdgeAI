/**
 * Interaction Signal Collector
 *
 * Async, non-blocking signal capture that buffers events in memory
 * and flushes to the InteractionSignal table periodically.
 *
 * Design principles:
 * - NEVER blocks the conversation flow
 * - Writes to an in-memory buffer first
 * - Flushes to DB on interval (5s) or when buffer hits threshold (20 signals)
 * - Fire-and-forget — errors are logged, never propagated
 * - All public methods return immediately (no await needed by callers)
 */
import { basePrisma } from '../lib/prisma.js';

const FLUSH_INTERVAL_MS = 5_000;   // flush every 5 seconds
const FLUSH_THRESHOLD = 20;         // flush when buffer reaches this size
const MAX_BUFFER_SIZE = 200;        // drop signals beyond this to prevent memory leak

// ── In-memory buffer ──

let signalBuffer = [];
let flushTimer = null;

// ── Partial signal accumulator ──
// Signals for a conversation build up over time (prompt assembled → response → feedback)
// We accumulate partials keyed by a session key, then emit a complete signal at the end.
const partials = new Map();

/**
 * Start the background flush timer.
 * Called once at server startup.
 */
export function startSignalCollector() {
  if (flushTimer) return;
  flushTimer = setInterval(() => flushBuffer(), FLUSH_INTERVAL_MS);
  // Don't prevent Node from exiting
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Stop the collector and flush remaining signals.
 */
export async function stopSignalCollector() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();
}

// ═══════════════════════════════════════════════════════════════════════
// PUBLIC API — Signal emission (all fire-and-forget)
// ═══════════════════════════════════════════════════════════════════════

/**
 * SIGNAL 6: Record prompt assembly metadata at conversation/request start.
 * Called from the assembly engine or the orchestrator.
 *
 * @param {string} sessionKey - unique key for this interaction (e.g. conversationId or invoiceId)
 * @param {object} meta - { baseVersionId, baseVersionNumber, tenantConfigId, tenantConfigVersion, agentRoleKey, tenantId, userId }
 */
export function recordPromptMeta(sessionKey, meta) {
  const partial = getPartial(sessionKey);
  partial.agentRoleKey = meta.agentRoleKey;
  partial.tenantId = meta.tenantId;
  partial.userId = meta.userId || null;
  partial.baseVersionUsed = meta.baseVersionId;
  partial.configVersionUsed = meta.tenantConfigId || null;
  partial.promptMeta = meta;
}

/**
 * SIGNAL 1: Record conversation/interaction outcome.
 *
 * @param {string} sessionKey
 * @param {object} outcome - { resolutionStatus, topicTags?, failureReason? }
 */
export function recordOutcome(sessionKey, outcome) {
  const partial = getPartial(sessionKey);
  partial.resolutionStatus = outcome.resolutionStatus || 'unknown';
  partial.topicTags = outcome.topicTags || [];
  partial.failureReason = outcome.failureReason || null;
}

/**
 * SIGNAL 2: Record user satisfaction score.
 *
 * @param {string} sessionKey
 * @param {number} score - satisfaction score (1-5)
 */
export function recordSatisfaction(sessionKey, score) {
  const partial = getPartial(sessionKey);
  partial.userSatisfactionScore = score;
}

/**
 * SIGNAL 3: Record human override (highest value signal).
 *
 * @param {string} sessionKey
 * @param {object} override - { humanOverride: boolean, humanOverrideDiff?: object }
 */
export function recordHumanOverride(sessionKey, override) {
  const partial = getPartial(sessionKey);
  partial.humanOverride = override.humanOverride;
  partial.humanOverrideDiff = override.humanOverrideDiff || null;
}

/**
 * SIGNAL 4: Record correction count (user rephrases / follow-up messages).
 *
 * @param {string} sessionKey
 * @param {number} count
 */
export function recordCorrectionCount(sessionKey, count) {
  const partial = getPartial(sessionKey);
  partial.correctionCount = count;
}

/**
 * SIGNAL 5: Record escalation event.
 *
 * @param {string} sessionKey
 * @param {boolean} escalated
 */
export function recordEscalation(sessionKey, escalated) {
  const partial = getPartial(sessionKey);
  partial.escalationOccurred = escalated;
}

/**
 * Derive and record implicit satisfaction from user actions.
 * Use when there's no explicit rating — infer from how much the user corrected.
 *
 * @param {string} sessionKey
 * @param {number} fieldsChanged - number of fields the user edited
 * @param {number} totalFields - total fields available (for ratio calculation)
 */
export function recordImplicitSatisfaction(sessionKey, fieldsChanged, totalFields) {
  let score;
  const ratio = totalFields > 0 ? fieldsChanged / totalFields : 0;
  if (fieldsChanged === 0) return; // no correction = no signal
  if (ratio >= 0.4 || fieldsChanged >= 3) score = 1;      // heavy corrections
  else if (ratio >= 0.15 || fieldsChanged >= 2) score = 3; // moderate
  else score = 4;                                           // minor touch-up
  recordSatisfaction(sessionKey, score);
}

/**
 * Record token usage and latency for an interaction.
 *
 * @param {string} sessionKey
 * @param {object} usage - { tokenCount, latencyMs, costUsd }
 */
export function recordUsage(sessionKey, usage) {
  const partial = getPartial(sessionKey);
  partial.tokenCount = (partial.tokenCount || 0) + (usage.tokenCount || 0);
  partial.latencyMs = (partial.latencyMs || 0) + (usage.latencyMs || 0);
  partial.costUsd = (partial.costUsd || 0) + (usage.costUsd || 0);
}

/**
 * Finalize and emit a signal — flushes the accumulated partial to the buffer.
 * Call this when the interaction is complete (response sent, invoice processed, etc.)
 *
 * @param {string} sessionKey
 * @param {string} [conversationId] - optional conversation reference
 */
export function emitSignal(sessionKey, conversationId) {
  const partial = partials.get(sessionKey);
  if (!partial) return;

  partials.delete(sessionKey);

  // Validate minimum required fields
  if (!partial.tenantId || !partial.agentRoleKey || !partial.baseVersionUsed) {
    // Missing critical fields — likely prompt assembly failed and used fallback.
    // Still try to emit with what we have, filling in defaults.
    if (!partial.tenantId || !partial.baseVersionUsed) {
      // Can't emit without tenantId or baseVersionUsed (FK constraint)
      return;
    }
  }

  const signal = {
    conversationId: conversationId || partial.conversationId || null,
    tenantId: partial.tenantId,
    agentRoleId: partial.agentRoleKey,  // will be resolved to actual ID during flush
    agentRoleKey: partial.agentRoleKey, // keep for resolution
    baseVersionUsed: partial.baseVersionUsed,
    configVersionUsed: partial.configVersionUsed || null,
    resolutionStatus: partial.resolutionStatus || 'unknown',
    userSatisfactionScore: partial.userSatisfactionScore || null,
    humanOverride: partial.humanOverride || false,
    humanOverrideDiff: partial.humanOverrideDiff || null,
    correctionCount: partial.correctionCount || 0,
    escalationOccurred: partial.escalationOccurred || false,
    failureReason: partial.failureReason || null,
    topicTags: partial.topicTags || [],
    tokenCount: partial.tokenCount || 0,
    latencyMs: partial.latencyMs || 0,
    costUsd: partial.costUsd || 0,
    userId: partial.userId || null,
    timestamp: new Date(),
  };

  if (signalBuffer.length >= MAX_BUFFER_SIZE) {
    console.warn(`Signal buffer full (${MAX_BUFFER_SIZE}), dropping oldest signal`);
    signalBuffer.shift();
  }

  signalBuffer.push(signal);

  // Flush if threshold reached
  if (signalBuffer.length >= FLUSH_THRESHOLD) {
    flushBuffer().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
// INTERNAL — Buffer management
// ═══════════════════════════════════════════════════════════════════════

function getPartial(sessionKey) {
  if (!partials.has(sessionKey)) {
    partials.set(sessionKey, {});
  }
  return partials.get(sessionKey);
}

// AgentRole ID cache (key → id)
const agentRoleIdCache = new Map();

async function resolveAgentRoleId(key) {
  if (agentRoleIdCache.has(key)) return agentRoleIdCache.get(key);
  try {
    const role = await basePrisma.agentRole.findUnique({ where: { key } });
    if (role) {
      agentRoleIdCache.set(key, role.id);
      return role.id;
    }
  } catch {
    // ignore
  }
  return null;
}

async function flushBuffer() {
  if (signalBuffer.length === 0) return;

  const batch = signalBuffer.splice(0); // take all and clear

  const results = await Promise.allSettled(
    batch.map(async (signal) => {
      // Resolve agentRoleId from key
      const agentRoleId = await resolveAgentRoleId(signal.agentRoleKey);
      if (!agentRoleId) {
        console.warn(`Unknown agent role key: ${signal.agentRoleKey}, dropping signal`);
        return;
      }

      await basePrisma.interactionSignal.create({
        data: {
          conversationId: signal.conversationId,
          tenantId: signal.tenantId,
          agentRoleId,
          baseVersionUsed: signal.baseVersionUsed,
          configVersionUsed: signal.configVersionUsed,
          resolutionStatus: signal.resolutionStatus,
          userSatisfactionScore: signal.userSatisfactionScore,
          humanOverride: signal.humanOverride,
          humanOverrideDiff: signal.humanOverrideDiff,
          correctionCount: signal.correctionCount,
          escalationOccurred: signal.escalationOccurred,
          failureReason: signal.failureReason,
          topicTags: signal.topicTags,
          tokenCount: signal.tokenCount,
          latencyMs: signal.latencyMs,
          costUsd: signal.costUsd,
          userId: signal.userId,
          timestamp: signal.timestamp,
        },
      });
    })
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Signal flush: ${failures.length}/${batch.length} failed`, failures[0].reason?.message);
  }
}

// ── Clean up stale partials (older than 30 minutes) ──
setInterval(() => {
  const now = Date.now();
  for (const [key, partial] of partials.entries()) {
    if (partial._createdAt && now - partial._createdAt > 30 * 60 * 1000) {
      partials.delete(key);
    }
  }
}, 60_000).unref?.();

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS for testing
// ═══════════════════════════════════════════════════════════════════════

export function _getBufferSize() { return signalBuffer.length; }
export function _getPartials() { return partials; }
export function _clearAll() { signalBuffer = []; partials.clear(); }
export { flushBuffer as _flushBuffer };
