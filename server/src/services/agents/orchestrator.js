/**
 * Business AI Advisor Orchestrator
 *
 * Implements the agentic tool_use loop:
 *   1. Send messages + tools to Claude
 *   2. If Claude responds with tool_use → execute tools → feed results back → repeat
 *   3. When Claude responds with text → stream it to the client via SSE
 *
 * Max 5 tool rounds to prevent runaway loops.
 * Tool rounds use non-streaming (fast DB queries).
 * Final text response uses streaming for real-time UX.
 */

import { generate } from '../ai/aiServiceRouter.js';
import { rerank as routerRerank } from '../ai/aiServiceRouter.js';
import { calculateCost } from '../apiUsageTracker.js';
import { allToolDefs, executeTool } from './toolExecutor.js';
import { assemblePrompt } from '../promptAssemblyEngine.js';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOOL_ROUNDS = 5;
const MAX_RESPONSE_TOKENS = 2048;

// Hardcoded fallback — used only if assembly engine fails
const FALLBACK_SYSTEM_PROMPT = `You are a Business AI Advisor for a small retail business using RetailEdge, a retail management platform. You help the business owner understand their data and make better decisions.

CAPABILITIES:
- You have tools to query the business's real data: invoices, products, pricing rules, margins, supplier spending, competitor prices, and alerts.
- Always use tools to look up actual data before answering. Never guess or make up numbers.
- You can call multiple tools in sequence to build a complete picture.

COMMUNICATION STYLE:
- Be concise and actionable. Lead with the key insight.
- Use Australian Dollar (AUD) formatting: $X,XXX.XX
- Use percentages for margins and changes.
- Format data in tables when showing comparisons.
- When recommending actions, be specific: name the product, supplier, or category.
- If the data doesn't support a conclusion, say so honestly.

STRUCTURE:
- For simple questions: answer directly with data.
- For analysis questions: summarise findings → key data points → specific recommendation.
- For strategy questions: current state → options with trade-offs → recommended action.

LIMITATIONS:
- You can only access data that exists in RetailEdge. If data is missing, suggest what the user should add.
- You cannot make changes to the system (no creating invoices, changing prices, etc.). You can only read and analyse.
- Be transparent about what you don't know.`;

/**
 * Rerank tool results by relevance to the user's original question.
 * Returns a relevance hint string to inject into the conversation,
 * guiding Claude to focus on the most relevant tool outputs.
 *
 * @param {string} userQuestion - The original user message
 * @param {Array} toolResults - Array of {tool, result} from tool rounds
 * @param {string} tenantId - For logging
 * @returns {Promise<string|null>} Relevance hint or null if reranking skipped/failed
 */
async function rerankToolResults(userQuestion, toolResults, tenantId) {
  try {
    if (toolResults.length < 3) return null;

    const documents = toolResults.map((tr) => {
      const resultStr =
        typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
      return `[${tr.tool}] ${resultStr}`.substring(0, 2000);
    });

    const result = await routerRerank(
      'advisor_context_rerank',
      userQuestion,
      documents,
      {
        tenantId,
        topN: Math.min(toolResults.length, 10),
      },
    );

    if (!result.results || result.results.length === 0) return null;

    const ranked = result.results
      .map((r) => `${toolResults[r.index].tool}: relevance ${r.relevanceScore.toFixed(2)}`)
      .join(', ');

    return (
      `Based on relevance analysis, focus primarily on these tool results ` +
      `(in order of relevance to the user's question): [${ranked}]`
    );
  } catch (err) {
    console.warn('[Advisor] Reranking failed, using original order:', err.message);
    return null;
  }
}

/**
 * Send an SSE event to the client.
 */
function sendSSE(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Run the advisor with streaming response.
 *
 * @param {Object} opts
 * @param {string} opts.tenantId — Tenant ID
 * @param {string} opts.userId — User ID
 * @param {Array}  opts.messages — Conversation history (role/content pairs)
 * @param {Object} opts.prisma — Tenant-scoped Prisma client
 * @param {Object} opts.res — Express response (for SSE)
 * @returns {Promise<Object>} { content, toolCalls, toolResults, inputTokens, outputTokens, costUsd, durationMs }
 */
export async function runAdvisorStreaming({
  tenantId,
  userId,
  messages,
  prisma,
  res,
}) {
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  const allToolCalls = [];
  const allToolResults = [];

  // ── Assemble tenant-specific system prompt ──
  let systemPrompt = FALLBACK_SYSTEM_PROMPT;
  let promptMeta = null;
  try {
    const assembly = await assemblePrompt({
      agentRoleKey: 'business_advisor',
      tenantId,
      runtimeContext: {
        currentDate: new Date().toISOString().split('T')[0],
        availableTools: allToolDefs.map((t) => t.name),
      },
    });
    if (assembly) {
      systemPrompt = assembly.prompt;
      promptMeta = assembly.metadata;
    }
  } catch (err) {
    console.warn('Failed to assemble advisor prompt, using fallback:', err.message);
  }

  // Working copy of messages for the tool loop
  let workingMessages = [...messages];

  // ── Tool-use loop (non-streaming, fast) ──
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await generate('advisor_tool_round', systemPrompt, null, {
      tenantId,
      userId,
      messages: workingMessages,
      tools: allToolDefs,
      maxTokens: MAX_RESPONSE_TOKENS,
    });

    totalInputTokens += result.inputTokens || 0;
    totalOutputTokens += result.outputTokens || 0;
    totalCostUsd += calculateCost(
      MODEL,
      result.inputTokens || 0,
      result.outputTokens || 0
    );

    // Check if Claude wants to use tools
    const toolUseBlocks = result.toolUse || [];

    if (toolUseBlocks.length === 0) {
      // No tools — Claude gave a final text answer in the non-streaming call.
      // Extract text and send it as a single SSE chunk.
      const textContent = result.response || '';

      if (textContent) {
        sendSSE(res, 'text', { text: textContent });
      }

      const durationMs = Date.now() - startTime;
      sendSSE(res, 'done', {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: Math.round(totalCostUsd * 1000000) / 1000000,
        durationMs,
        toolRounds: round,
      });

      return {
        content: textContent,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
        toolResults: allToolResults.length > 0 ? allToolResults : null,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: Math.round(totalCostUsd * 1000000) / 1000000,
        durationMs,
        promptMeta,
      };
    }

    // ── Execute tools ──
    // Add assistant's response (with tool_use blocks) to working messages
    workingMessages.push({ role: 'assistant', content: result.raw.content });

    const toolResultBlocks = [];
    for (const toolBlock of toolUseBlocks) {
      sendSSE(res, 'tool_progress', {
        tool: toolBlock.name,
        input: toolBlock.input,
        status: 'running',
      });

      const result = await executeTool(toolBlock.name, toolBlock.input, prisma);

      allToolCalls.push({
        name: toolBlock.name,
        input: toolBlock.input,
      });
      allToolResults.push({
        tool: toolBlock.name,
        result,
      });

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify(result),
      });

      sendSSE(res, 'tool_progress', {
        tool: toolBlock.name,
        status: 'complete',
      });
    }

    // Add tool results to the conversation
    workingMessages.push({ role: 'user', content: toolResultBlocks });
  }

  // ── If we exhausted tool rounds, do a final streaming response ──

  // Rerank tool results by relevance before the final synthesis
  if (allToolResults.length >= 3) {
    const userQuestion =
      messages.length > 0 ? messages[messages.length - 1].content : '';
    const relevanceHint = await rerankToolResults(
      typeof userQuestion === 'string' ? userQuestion : JSON.stringify(userQuestion),
      allToolResults,
      tenantId,
    );
    if (relevanceHint) {
      workingMessages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[System note: ${relevanceHint}]`,
          },
        ],
      });
    }
  }

  sendSSE(res, 'tool_progress', {
    tool: 'synthesis',
    status: 'running',
  });

  const streamResult = await generate('advisor_stream', systemPrompt, null, {
    tenantId,
    userId,
    messages: workingMessages,
    maxTokens: MAX_RESPONSE_TOKENS,
    stream: true,
    // No tools on the final round — force a text answer
  });
  const stream = streamResult.rawStream;

  let fullText = '';

  // Stream text deltas to client
  stream.on('text', (textDelta) => {
    fullText += textDelta;
    sendSSE(res, 'text', { text: textDelta });
  });

  // Wait for stream to complete and collect usage
  const finalMessage = await stream.finalMessage();
  const streamInputTokens = finalMessage.usage?.input_tokens || 0;
  const streamOutputTokens = finalMessage.usage?.output_tokens || 0;

  totalInputTokens += streamInputTokens;
  totalOutputTokens += streamOutputTokens;
  totalCostUsd += calculateCost(MODEL, streamInputTokens, streamOutputTokens);

  const durationMs = Date.now() - startTime;

  sendSSE(res, 'done', {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costUsd: Math.round(totalCostUsd * 1000000) / 1000000,
    durationMs,
    toolRounds: MAX_TOOL_ROUNDS,
  });

  return {
    content: fullText,
    toolCalls: allToolCalls.length > 0 ? allToolCalls : null,
    toolResults: allToolResults.length > 0 ? allToolResults : null,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costUsd: Math.round(totalCostUsd * 1000000) / 1000000,
    durationMs,
    promptMeta,
  };
}
