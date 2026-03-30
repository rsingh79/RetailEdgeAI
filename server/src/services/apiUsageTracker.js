// DEPRECATED: AI calls now route through services/ai/aiServiceRouter.js
// This file is kept for reference. The router handles logging to both
// ai_service_log (new) and ApiUsageLog (legacy, for rate limiter compatibility).
// Remove this file once rate limiting and admin dashboard migrate to ai_service_log.

import Anthropic from '@anthropic-ai/sdk';
import { basePrisma } from '../lib/prisma.js';

let _anthropic;
function getAnthropicClient() {
  if (!_anthropic) {
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _anthropic;
}

// Claude pricing per million tokens (USD)
const PRICING = {
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-haiku-3-5-20241022': { input: 0.8, output: 4.0 },
  default: { input: 3.0, output: 15.0 },
};

/**
 * Calculate the USD cost for a given model + token usage.
 */
function calculateCost(model, inputTokens, outputTokens) {
  const rates = PRICING[model] || PRICING.default;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

/**
 * Wrapper around the Anthropic SDK that logs every API call to ApiUsageLog.
 *
 * @param {Object} opts
 * @param {string} opts.tenantId     — Tenant making the call
 * @param {string} [opts.userId]     — User who triggered the call
 * @param {string} opts.endpoint     — Logical endpoint (e.g. "ocr", "chat")
 * @param {string} opts.model        — Claude model name
 * @param {Array}  opts.messages     — Message array for anthropic.messages.create
 * @param {number} opts.maxTokens    — Max tokens for the response
 * @param {string} [opts.system]     — System prompt
 * @param {Array}  [opts.tools]      — Tool definitions for tool_use
 * @param {Object} [opts.tool_choice] — Tool choice config (auto, any, specific)
 * @param {Object} [opts.requestSummary] — Summary of the request (not the full payload)
 * @returns {Promise<Object>} The Anthropic API response
 */
export async function trackedClaudeCall({
  tenantId,
  userId,
  endpoint,
  model,
  messages,
  maxTokens,
  system,
  tools,
  tool_choice,
  requestSummary,
}) {
  const startTime = Date.now();

  try {
    // Build params — only include optional fields if provided
    const params = { model, max_tokens: maxTokens, messages };
    if (system) params.system = system;
    if (tools?.length) params.tools = tools;
    if (tool_choice) params.tool_choice = tool_choice;

    const response = await getAnthropicClient().messages.create(params);

    const durationMs = Date.now() - startTime;
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const costUsd = calculateCost(model, inputTokens, outputTokens);

    // Extract a truncated text response for the log (max 2000 chars)
    const responseText = response.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .substring(0, 2000);

    // Log asynchronously — don't block the response
    basePrisma.apiUsageLog
      .create({
        data: {
          tenantId,
          userId: userId || null,
          endpoint,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          costUsd,
          durationMs,
          status: 'success',
          requestPayload: requestSummary || null,
          responsePayload: responseText ? { text: responseText } : null,
        },
      })
      .catch((err) => console.error('Failed to log API usage:', err.message));

    return response;
  } catch (err) {
    const durationMs = Date.now() - startTime;

    // Log the failed call
    basePrisma.apiUsageLog
      .create({
        data: {
          tenantId,
          userId: userId || null,
          endpoint,
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          durationMs,
          status: 'error',
          requestPayload: requestSummary || null,
          responsePayload: { error: err.message },
        },
      })
      .catch((logErr) =>
        console.error('Failed to log API usage error:', logErr.message)
      );

    throw err;
  }
}

/**
 * Streaming wrapper around the Anthropic SDK.
 * Returns the SDK stream object plus a finalize() function to log usage.
 *
 * Usage:
 *   const { stream, finalize } = await trackedClaudeStream({ ... });
 *   for await (const event of stream) { ... }
 *   await finalize();  // logs usage to ApiUsageLog
 *
 * @param {Object} opts — Same as trackedClaudeCall
 * @returns {{ stream: object, finalize: () => Promise<Object> }}
 */
export function trackedClaudeStream({
  tenantId,
  userId,
  endpoint,
  model,
  messages,
  maxTokens,
  system,
  tools,
  tool_choice,
  requestSummary,
}) {
  const startTime = Date.now();

  // Build params
  const params = { model, max_tokens: maxTokens, messages };
  if (system) params.system = system;
  if (tools?.length) params.tools = tools;
  if (tool_choice) params.tool_choice = tool_choice;

  const stream = getAnthropicClient().messages.stream(params);

  /**
   * Call after streaming is done to log usage stats.
   * Returns the final message object.
   */
  async function finalize() {
    try {
      const finalMessage = await stream.finalMessage();
      const durationMs = Date.now() - startTime;
      const inputTokens = finalMessage.usage?.input_tokens || 0;
      const outputTokens = finalMessage.usage?.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const costUsd = calculateCost(model, inputTokens, outputTokens);

      const responseText = finalMessage.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .substring(0, 2000);

      // Fire-and-forget logging
      basePrisma.apiUsageLog
        .create({
          data: {
            tenantId,
            userId: userId || null,
            endpoint,
            model,
            inputTokens,
            outputTokens,
            totalTokens,
            costUsd,
            durationMs,
            status: 'success',
            requestPayload: requestSummary || null,
            responsePayload: responseText ? { text: responseText } : null,
          },
        })
        .catch((err) => console.error('Failed to log API usage:', err.message));

      return { finalMessage, inputTokens, outputTokens, costUsd, durationMs };
    } catch (err) {
      const durationMs = Date.now() - startTime;

      basePrisma.apiUsageLog
        .create({
          data: {
            tenantId,
            userId: userId || null,
            endpoint,
            model,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costUsd: 0,
            durationMs,
            status: 'error',
            requestPayload: requestSummary || null,
            responsePayload: { error: err.message },
          },
        })
        .catch((logErr) =>
          console.error('Failed to log API usage error:', logErr.message)
        );

      throw err;
    }
  }

  return { stream, finalize };
}

export { calculateCost };
