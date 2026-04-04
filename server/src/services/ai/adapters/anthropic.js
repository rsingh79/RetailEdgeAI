/**
 * Anthropic Provider Adapter
 *
 * Translates between ASAL's three standardised contracts and the Anthropic
 * Messages API.  Uses a lazy-initialised singleton client (same pattern as
 * apiUsageTracker.js but independent of it).
 *
 * Exports: generate(), embed(), rerank()
 */

import Anthropic from '@anthropic-ai/sdk';

// ── Lazy singleton ───────────────────────────────────────────

let _client = null;

function getClient() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// ── Error mapping ────────────────────────────────────────────

function mapError(err, model) {
  const base = { provider: 'anthropic', model: model || 'unknown' };

  if (err.status === 429) {
    return { ...base, code: 'PROVIDER_RATE_LIMIT', message: err.message, retryable: true };
  }
  if (err.status === 401) {
    return { ...base, code: 'PROVIDER_AUTH_FAILURE', message: err.message, retryable: false };
  }
  if (err.status === 404) {
    return { ...base, code: 'PROVIDER_MODEL_NOT_FOUND', message: err.message, retryable: false };
  }
  if (err.status === 400) {
    return { ...base, code: 'PROVIDER_INVALID_INPUT', message: err.message, retryable: false };
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
    return { ...base, code: 'PROVIDER_TIMEOUT', message: err.message, retryable: true };
  }
  return { ...base, code: 'PROVIDER_UNAVAILABLE', message: err.message, retryable: true };
}

// ── TEXT_GENERATION ──────────────────────────────────────────

/**
 * Send a prompt, get a response.
 *
 * @param {string} systemPrompt - The system prompt
 * @param {string|Array} userPrompt - User message (string or content blocks for vision/document)
 * @param {string} model - Model identifier, e.g. 'claude-sonnet-4-20250514'
 * @param {object} config - { maxTokens, temperature, tools, tool_choice, stream, messages, ...rest }
 * @returns {Promise<{response: string|null, inputTokens: number, outputTokens: number, latencyMs: number, toolUse?: Array, rawStream?: object, raw: object}>}
 */
export async function generate(systemPrompt, userPrompt, model, config = {}) {
  const {
    maxTokens = 4096,
    temperature,
    tools,
    tool_choice,
    stream,
    messages: configMessages,
    ...rest
  } = config;

  // Build messages array
  let messages;
  if (configMessages) {
    // Multi-turn: caller provides full messages array (e.g. advisor tool rounds)
    messages = configMessages;
  } else {
    // Single-turn: wrap userPrompt (string or content-block array)
    messages = [{ role: 'user', content: userPrompt }];
  }

  // Build API params
  // Anthropic API requires system to be an array of content blocks
  const system = systemPrompt
    ? [{ type: 'text', text: systemPrompt }]
    : undefined;
  const params = { model, max_tokens: maxTokens, messages };
  if (system) params.system = system;
  if (temperature !== undefined) params.temperature = temperature;
  if (tools?.length) params.tools = tools;
  if (tool_choice) params.tool_choice = tool_choice;
  // Spread any extra provider-specific config the caller supplied
  Object.assign(params, rest);

  const client = getClient();

  // ── Streaming path ──
  if (stream) {
    try {
      const startMs = Date.now();
      const rawStream = client.messages.stream(params);
      return {
        response: null,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - startMs,
        rawStream,
        raw: null,
      };
    } catch (err) {
      throw mapError(err, model);
    }
  }

  // ── Non-streaming path ──
  const startMs = Date.now();
  try {
    const raw = await client.messages.create(params);
    const latencyMs = Date.now() - startMs;

    const inputTokens = raw.usage?.input_tokens || 0;
    const outputTokens = raw.usage?.output_tokens || 0;

    // Extract text content (may be empty if response is tool_use only)
    const textBlocks = raw.content.filter((b) => b.type === 'text');
    const response = textBlocks.length > 0 ? textBlocks.map((b) => b.text).join('') : null;

    // Extract tool_use blocks if present
    const toolUseBlocks = raw.content.filter((b) => b.type === 'tool_use');

    const result = { response, inputTokens, outputTokens, latencyMs, raw };
    if (toolUseBlocks.length > 0) {
      result.toolUse = toolUseBlocks;
    }
    return result;
  } catch (err) {
    throw mapError(err, model);
  }
}

// ── EMBEDDING ────────────────────────────────────────────────

/**
 * Not supported by Anthropic.
 */
export async function embed(text, model, config = {}) {
  throw {
    code: 'PROVIDER_INTENT_NOT_SUPPORTED',
    provider: 'anthropic',
    model: model || 'n/a',
    message: 'Anthropic does not provide embedding models. Use Cohere, Voyage AI, or OpenAI.',
    retryable: false,
  };
}

// ── RERANKING ────────────────────────────────────────────────

/**
 * Not supported by Anthropic.
 */
export async function rerank(query, documents, model, config = {}) {
  throw {
    code: 'PROVIDER_INTENT_NOT_SUPPORTED',
    provider: 'anthropic',
    model: model || 'n/a',
    message: 'Anthropic does not provide reranking models. Use Cohere, Voyage AI, or Jina AI.',
    retryable: false,
  };
}
