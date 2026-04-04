import { basePrisma, createTenantClient } from '../lib/prisma.js';
import { generate } from './ai/aiServiceRouter.js';
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
    const aiResult = await generate('conflict_detection', null, prompt, {
      tenantId,
      maxTokens: 200,
    });

    const text = (aiResult.response || '').trim();

    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      hasConflict: parsed.contradicts === true,
      reason: parsed.reason || '',
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
      const tenantPrisma = createTenantClient(tenantId);
      await tenantPrisma.promptConflict.create({
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
