import { basePrisma } from '../lib/prisma.js';
import { generate } from './ai/aiServiceRouter.js';
import { getEffectivePrompt, getGenericConditions, invalidatePromptCache } from './promptComposer.js';
import { detectConflicts } from './promptConflictDetector.js';
import { runValidator } from './promptValidators.js';
import { createTenantClient } from '../lib/prisma.js';

const SYSTEM_PROMPT = `You are the RetailEdgeAI Prompt Configuration Assistant. You help tenants customize their AI agent prompts.

You have access to two AI agents that can be customized:
1. **ocr_extraction** — Extracts structured invoice data from PDF/image files
2. **product_matching** — Matches invoice line items to the product catalog

## Your role
- Help users understand their current prompt configuration
- Propose changes when users describe issues or needs
- Explain the impact of changes before applying them
- Never make changes without explicit user confirmation

## How prompt customization works
- Each agent has a set of generic (system default) conditions/rules
- Tenants can: ADD new conditions, REMOVE generic conditions, or REPLACE generic conditions with custom text
- Some conditions are marked as "required" and cannot be removed
- Removing a generic condition may require passing a safety validation test
- If a new condition contradicts a generic one, a conflict is detected and must be resolved

## When proposing a change, always:
1. Identify which agent and condition(s) are affected
2. State the proposed action (add/remove/replace)
3. Show the exact text of the proposed change
4. Explain any potential impacts
5. Ask for explicit confirmation

## Response format
When you want to propose an action, include a JSON block at the end of your response wrapped in <proposed_action> tags:
<proposed_action>
{"action": "add|remove|replace", "agentTypeKey": "ocr_extraction|product_matching", "conditionKey": "key_of_condition_if_replacing_or_removing", "customText": "the new condition text if adding or replacing", "reason": "brief summary of why this change is needed"}
</proposed_action>

Only include the <proposed_action> block when you are ready to propose a specific change and need user confirmation. For informational responses or clarifying questions, do not include it.`;

/**
 * Build context about the tenant's current prompt configuration.
 */
async function buildTenantContext(tenantId) {
  const agents = ['ocr_extraction', 'product_matching'];
  const contextParts = [];

  for (const agentKey of agents) {
    const effective = await getEffectivePrompt(agentKey, tenantId);
    const generic = await getGenericConditions(agentKey);

    if (!effective) continue;

    const overrides = await basePrisma.tenantPromptOverride.findMany({
      where: { tenantId, agentTypeKey: agentKey, isActive: true },
    });

    contextParts.push(`### Agent: ${agentKey}
Generic conditions (${generic.length}):
${generic.map((c) => `- [${c.key}] (${c.category}${c.isRequired ? ', REQUIRED' : ''}): ${c.text}`).join('\n')}

Active tenant overrides (${overrides.length}):
${overrides.length > 0
    ? overrides.map((o) => `- ${o.action} ${o.promptConditionId ? `condition ${o.promptConditionId}` : '(new)'}: ${o.customText || '(removed)'}`).join('\n')
    : '- None (using all generic defaults)'}

Effective prompt preview (first 500 chars):
${effective.prompt.substring(0, 500)}...`);
  }

  return contextParts.join('\n\n');
}

/**
 * Handle a chat message from a tenant user.
 *
 * @param {string} tenantId
 * @param {string} userId
 * @param {string} userMessage - The user's chat message
 * @param {Array} conversationHistory - Previous messages [{role, content}]
 * @returns {Promise<{response: string, proposedAction: object|null}>}
 */
export async function handleChatMessage(tenantId, userId, userMessage, conversationHistory = []) {
  const tenantContext = await buildTenantContext(tenantId);

  const contextMessage = `## Current Tenant Prompt Configuration\n\n${tenantContext}`;

  const messages = [
    { role: 'user', content: contextMessage },
    { role: 'assistant', content: 'I have the current prompt configuration loaded. How can I help you?' },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const result = await generate('prompt_management', null, null, {
    tenantId,
    userId,
    messages,
    maxTokens: 2000,
  });

  const text = result.response || '';

  // Parse proposed action if present
  let proposedAction = null;
  const actionMatch = text.match(/<proposed_action>\s*([\s\S]*?)\s*<\/proposed_action>/);
  if (actionMatch) {
    try {
      proposedAction = JSON.parse(actionMatch[1]);
    } catch (e) {
      console.warn('Failed to parse proposed action:', e.message);
    }
  }

  // Clean the response text (remove the JSON block for display)
  const cleanResponse = text.replace(/<proposed_action>[\s\S]*?<\/proposed_action>/, '').trim();

  return { response: cleanResponse, proposedAction };
}

/**
 * Confirm and execute a proposed action from the chat agent.
 *
 * @param {string} tenantId
 * @param {string} userId
 * @param {object} action - The proposed action object
 * @param {string} conversationExcerpt - Summary of the chat exchange
 * @returns {Promise<{success: boolean, message: string, conflicts: Array}>}
 */
export async function confirmAction(tenantId, userId, action, conversationExcerpt = '') {
  const { agentTypeKey, customText, reason } = action;
  const actionType = action.action;
  const conditionKey = action.conditionKey;

  // For remove/replace, find the generic condition
  let condition = null;
  if (conditionKey && (actionType === 'remove' || actionType === 'replace')) {
    const genericConditions = await getGenericConditions(agentTypeKey);
    condition = genericConditions.find((c) => c.key === conditionKey);

    if (!condition) {
      return { success: false, message: `Condition "${conditionKey}" not found.`, conflicts: [] };
    }

    // Check if required
    if (condition.isRequired && actionType === 'remove') {
      return {
        success: false,
        message: `Cannot remove "${conditionKey}" — it is marked as required and cannot be removed by tenants.`,
        conflicts: [],
      };
    }

    // Run validation test for removals
    if (actionType === 'remove' && condition.validationKey) {
      const tenantPrisma = createTenantClient(tenantId);
      const validation = await runValidator(condition.validationKey, tenantPrisma);
      if (!validation.passed) {
        return {
          success: false,
          message: validation.message,
          conflicts: [],
        };
      }
    }
  }

  // Detect conflicts for adds/replaces
  let conflicts = [];
  if (customText && (actionType === 'add' || actionType === 'replace')) {
    conflicts = await detectConflicts(
      agentTypeKey,
      customText,
      tenantId,
      condition?.id || null,
    );
  }

  // Create the override
  const tenantPrisma = createTenantClient(tenantId);
  const override = await tenantPrisma.tenantPromptOverride.create({
    data: {
      tenantId,
      promptConditionId: condition?.id || null,
      agentTypeKey,
      action: actionType,
      customText: customText || null,
      category: condition?.category || 'rule',
      isActive: true,
      createdBy: userId,
    },
  });

  // Log the change
  await tenantPrisma.promptChangeLog.create({
    data: {
      tenantId,
      userId,
      agentTypeKey,
      changeType: `${actionType}_override`,
      conditionKey: conditionKey || null,
      previousText: condition?.text || null,
      newText: customText || null,
      reason: reason || 'User confirmed change via chat',
      conversationExcerpt: conversationExcerpt || null,
    },
  });

  // Invalidate cache
  invalidatePromptCache(agentTypeKey, tenantId);

  const conflictMsg = conflicts.length > 0
    ? ` However, ${conflicts.length} conflict(s) were detected and need resolution.`
    : '';

  return {
    success: true,
    message: `Change applied successfully.${conflictMsg}`,
    conflicts,
    overrideId: override.id,
  };
}

/**
 * Resolve a prompt conflict.
 *
 * @param {string} conflictId
 * @param {string} resolution - "keep_generic", "keep_tenant", or "merge"
 * @param {string} tenantId
 * @param {string} userId
 * @param {string|null} mergeText - Combined text if resolution is "merge"
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function resolveConflict(conflictId, resolution, tenantId, userId, mergeText = null) {
  const conflict = await basePrisma.promptConflict.findUnique({
    where: { id: conflictId },
    include: { promptCondition: true },
  });

  if (!conflict || conflict.tenantId !== tenantId) {
    return { success: false, message: 'Conflict not found.' };
  }

  if (conflict.resolution) {
    return { success: false, message: 'Conflict already resolved.' };
  }

  const tenantPrisma = createTenantClient(tenantId);

  if (resolution === 'keep_tenant') {
    // Run validation before removing the generic condition
    if (conflict.promptCondition.validationKey) {
      const validation = await runValidator(conflict.promptCondition.validationKey, tenantPrisma);

      await tenantPrisma.promptConflict.update({
        where: { id: conflictId },
        data: {
          validationPassed: validation.passed,
          validationOutput: validation.message,
        },
      });

      if (!validation.passed) {
        return {
          success: false,
          message: `Cannot keep tenant version: ${validation.message}. Please choose "Keep Generic" or "Merge" instead.`,
        };
      }
    }

    // Create a remove override for the generic condition
    await tenantPrisma.tenantPromptOverride.create({
      data: {
        tenantId,
        promptConditionId: conflict.promptConditionId,
        agentTypeKey: conflict.promptCondition.promptTemplateId, // need to look up
        action: 'remove',
        isActive: true,
        createdBy: userId,
      },
    });
  } else if (resolution === 'keep_generic') {
    // Deactivate any tenant overrides that caused this conflict
    await tenantPrisma.tenantPromptOverride.updateMany({
      where: {
        tenantId,
        customText: conflict.tenantOverrideText,
        isActive: true,
      },
      data: { isActive: false },
    });
  } else if (resolution === 'merge' && mergeText) {
    // Replace the generic condition with merged text
    await tenantPrisma.tenantPromptOverride.create({
      data: {
        tenantId,
        promptConditionId: conflict.promptConditionId,
        agentTypeKey: conflict.promptCondition.promptTemplateId,
        action: 'replace',
        customText: mergeText,
        isActive: true,
        createdBy: userId,
      },
    });
  }

  // Mark conflict as resolved
  await tenantPrisma.promptConflict.update({
    where: { id: conflictId },
    data: {
      resolution,
      resolvedBy: userId,
      resolvedAt: new Date(),
    },
  });

  // Log the resolution
  await tenantPrisma.promptChangeLog.create({
    data: {
      tenantId,
      userId,
      agentTypeKey: conflict.promptCondition.key,
      changeType: 'resolve_conflict',
      conditionKey: conflict.promptCondition.key,
      previousText: conflict.promptCondition.text,
      newText: resolution === 'merge' ? mergeText : (resolution === 'keep_tenant' ? conflict.tenantOverrideText : null),
      reason: `Conflict resolved: ${resolution}. Original conflict: ${conflict.detectedReason}`,
    },
  });

  // Invalidate cache for all agents this tenant uses
  invalidatePromptCache('ocr_extraction', tenantId);
  invalidatePromptCache('product_matching', tenantId);

  return { success: true, message: `Conflict resolved with "${resolution}".` };
}
