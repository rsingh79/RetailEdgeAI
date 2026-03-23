import { basePrisma } from '../lib/prisma.js';
import { trackedClaudeCall } from './apiUsageTracker.js';
import { getGenericConditions } from './promptComposer.js';

/**
 * Detect whether a tenant's custom condition text contradicts a generic condition.
 * Uses Claude Haiku for cost-effective comparison.
 *
 * @param {string} genericText - The generic condition text
 * @param {string} tenantText - The tenant's custom condition text
 * @param {string} tenantId - For API usage tracking
 * @returns {Promise<{hasConflict: boolean, reason: string}>}
 */
async function compareConditions(genericText, tenantText, tenantId) {
  const prompt = `Compare these two AI prompt instructions and determine if they contradict each other.

Instruction A (system default): "${genericText}"

Instruction B (tenant customization): "${tenantText}"

Do they contradict each other? A contradiction means following both instructions simultaneously would produce inconsistent or impossible results. Adding specificity or narrowing scope is NOT a contradiction.

Reply with ONLY valid JSON (no markdown):
{"contradicts": true/false, "reason": "brief explanation"}`;

  try {
    const response = await trackedClaudeCall({
      tenantId,
      userId: null,
      endpoint: 'conflict_detection',
      model: 'claude-haiku-3-5-20241022',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      requestSummary: {
        type: 'conflict_detection',
        genericTextLength: genericText.length,
        tenantTextLength: tenantText.length,
      },
    });

    const text = response.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(cleaned);

    return {
      hasConflict: result.contradicts === true,
      reason: result.reason || '',
    };
  } catch (err) {
    console.error('Conflict detection failed:', err.message);
    // On failure, don't block — allow the override but flag it
    return {
      hasConflict: false,
      reason: `Conflict detection unavailable: ${err.message}`,
    };
  }
}

/**
 * Check a tenant's override text against ALL generic conditions for an agent.
 * Creates PromptConflict records for any detected contradictions.
 *
 * @param {string} agentTypeKey - e.g. "ocr_extraction"
 * @param {string} tenantText - The tenant's custom condition text
 * @param {string} tenantId - Tenant ID
 * @param {string|null} excludeConditionId - Skip this condition (if replacing it)
 * @returns {Promise<Array<{conditionId: string, conditionKey: string, reason: string}>>}
 */
export async function detectConflicts(agentTypeKey, tenantText, tenantId, excludeConditionId = null) {
  const genericConditions = await getGenericConditions(agentTypeKey);
  const conflicts = [];

  for (const condition of genericConditions) {
    // Skip the condition being replaced (can't conflict with itself)
    if (excludeConditionId && condition.id === excludeConditionId) continue;

    const result = await compareConditions(condition.text, tenantText, tenantId);

    if (result.hasConflict) {
      // Create a PromptConflict record
      await basePrisma.promptConflict.create({
        data: {
          tenantId,
          promptConditionId: condition.id,
          tenantOverrideText: tenantText,
          detectedReason: result.reason,
          resolution: null,
          validationPassed: null,
        },
      });

      conflicts.push({
        conditionId: condition.id,
        conditionKey: condition.key,
        conditionText: condition.text,
        reason: result.reason,
      });
    }
  }

  return conflicts;
}

/**
 * Get unresolved conflicts for a tenant.
 */
export async function getUnresolvedConflicts(tenantId, agentTypeKey = null) {
  const where = {
    tenantId,
    resolution: null,
  };

  if (agentTypeKey) {
    // Filter by agent — need to join through promptCondition -> promptTemplate -> agentType
    const conditions = await getGenericConditions(agentTypeKey);
    const conditionIds = conditions.map((c) => c.id);
    where.promptConditionId = { in: conditionIds };
  }

  return basePrisma.promptConflict.findMany({
    where,
    include: {
      promptCondition: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}
