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
  requestSummary,
}) {
  const startTime = Date.now();

  try {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: maxTokens,
      messages,
    });

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

export { calculateCost };
