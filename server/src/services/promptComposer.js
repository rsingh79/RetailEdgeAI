import { basePrisma } from '../lib/prisma.js';

// In-memory cache: key = "agentKey:tenantId", value = { prompt, expiresAt }
const promptCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build the effective prompt for a given agent and tenant.
 * Composes: generic template + conditions, with tenant overrides applied.
 *
 * @param {string} agentTypeKey - e.g. "ocr_extraction", "product_matching"
 * @param {string} tenantId - the tenant's ID
 * @returns {Promise<{prompt: string, preamble: string, conditions: Array, postamble: string|null} | null>}
 */
export async function getEffectivePrompt(agentTypeKey, tenantId) {
  const cacheKey = `${agentTypeKey}:${tenantId}`;
  const cached = promptCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Load agent type
  const agentType = await basePrisma.agentType.findUnique({
    where: { key: agentTypeKey },
  });
  if (!agentType || !agentType.isActive) return null;

  // Load active template with conditions
  const template = await basePrisma.promptTemplate.findFirst({
    where: { agentTypeId: agentType.id, isActive: true },
    include: {
      conditions: { orderBy: { orderIndex: 'asc' } },
    },
  });
  if (!template) return null;

  // Load tenant overrides for this agent
  const overrides = await basePrisma.tenantPromptOverride.findMany({
    where: { tenantId, agentTypeKey, isActive: true },
    orderBy: { orderIndex: 'asc' },
  });

  // Build override lookup maps
  const removeSet = new Set();       // conditionIds to remove
  const replaceMap = new Map();      // conditionId -> replacement text
  const additions = [];              // tenant-added conditions

  for (const override of overrides) {
    switch (override.action) {
      case 'remove':
        if (override.promptConditionId) {
          removeSet.add(override.promptConditionId);
        }
        break;
      case 'replace':
        if (override.promptConditionId && override.customText) {
          replaceMap.set(override.promptConditionId, override.customText);
        }
        break;
      case 'add':
        additions.push({
          orderIndex: override.orderIndex,
          category: override.category,
          text: override.customText,
          source: 'tenant',
        });
        break;
    }
  }

  // Compose the conditions list
  const composedConditions = [];

  for (const condition of template.conditions) {
    if (removeSet.has(condition.id)) continue; // tenant removed this condition

    const text = replaceMap.has(condition.id)
      ? replaceMap.get(condition.id)
      : condition.text;

    composedConditions.push({
      key: condition.key,
      category: condition.category,
      text,
      source: replaceMap.has(condition.id) ? 'tenant_replaced' : 'generic',
      isRequired: condition.isRequired,
    });
  }

  // Insert tenant additions at appropriate positions
  for (const addition of additions) {
    composedConditions.push({
      key: null,
      category: addition.category,
      text: addition.text,
      source: 'tenant',
      isRequired: false,
    });
  }

  // Sort by a stable order (generic first by original order, then additions)
  // Additions are already appended at the end

  // Build the final prompt string
  const rulesSection = composedConditions.length > 0
    ? '\n\nRules:\n' + composedConditions.map((c) => `- ${c.text}`).join('\n')
    : '';

  const postambleSection = template.postamble
    ? '\n\n' + template.postamble
    : '';

  const prompt = template.preamble + rulesSection + postambleSection;

  const result = {
    prompt,
    preamble: template.preamble,
    conditions: composedConditions,
    postamble: template.postamble,
  };

  // Cache the result
  promptCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}

/**
 * Invalidate cached prompt for a specific tenant + agent.
 * Call this after any prompt override changes.
 */
export function invalidatePromptCache(agentTypeKey, tenantId) {
  promptCache.delete(`${agentTypeKey}:${tenantId}`);
}

/**
 * Invalidate all cached prompts for an agent (e.g. when generic template changes).
 */
export function invalidateAllForAgent(agentTypeKey) {
  for (const key of promptCache.keys()) {
    if (key.startsWith(`${agentTypeKey}:`)) {
      promptCache.delete(key);
    }
  }
}

/**
 * Get the raw generic conditions for an agent (no tenant overrides).
 * Used by the conflict detector and chat agent for context.
 */
export async function getGenericConditions(agentTypeKey) {
  const agentType = await basePrisma.agentType.findUnique({
    where: { key: agentTypeKey },
  });
  if (!agentType) return [];

  const template = await basePrisma.promptTemplate.findFirst({
    where: { agentTypeId: agentType.id, isActive: true },
    include: {
      conditions: { orderBy: { orderIndex: 'asc' } },
    },
  });

  return template?.conditions || [];
}
