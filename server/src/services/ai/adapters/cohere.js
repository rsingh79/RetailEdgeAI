/**
 * Cohere Provider Adapter
 *
 * Translates between ASAL's three standardised contracts and the Cohere
 * V2 API (SDK v7+).  Uses a lazy-initialised singleton client, same
 * pattern as the Anthropic adapter.
 *
 * Exports: generate(), embed(), rerank()
 */

import { CohereClientV2, CohereError, CohereTimeoutError } from 'cohere-ai';

// ── Lazy singleton ───────────────────────────────────────────

let _client = null;

function getClient() {
  if (!_client) {
    _client = new CohereClientV2({ token: process.env.COHERE_API_KEY });
  }
  return _client;
}

// ── Error mapping ────────────────────────────────────────────

function mapError(err, model) {
  const base = { provider: 'cohere', model: model || 'unknown' };

  if (err instanceof CohereTimeoutError || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') {
    return { ...base, code: 'PROVIDER_TIMEOUT', message: err.message, retryable: true };
  }

  const status = err.statusCode || err.status;
  if (status === 429) {
    return { ...base, code: 'PROVIDER_RATE_LIMIT', message: err.message, retryable: true };
  }
  if (status === 401) {
    return { ...base, code: 'PROVIDER_AUTH_FAILURE', message: err.message, retryable: false };
  }
  if (status === 404) {
    return { ...base, code: 'PROVIDER_MODEL_NOT_FOUND', message: err.message, retryable: false };
  }
  if (status === 400) {
    return { ...base, code: 'PROVIDER_INVALID_INPUT', message: err.message, retryable: false };
  }
  return { ...base, code: 'PROVIDER_UNAVAILABLE', message: err.message, retryable: true };
}

// ── EMBEDDING ───────────────────────────────────────────────

/**
 * Convert text to vectors via Cohere Embed V2 API.
 *
 * @param {string|string[]} text - Text to embed. Single string or array for batch.
 * @param {string} model - e.g. 'embed-english-v3.0'
 * @param {object} config - { inputType?, truncate?, outputDimension? }
 * @returns {Promise<{vectors: number[][], tokenCount: number, latencyMs: number}>}
 */
export async function embed(text, model, config = {}) {
  const texts = Array.isArray(text) ? text : [text];
  const client = getClient();

  const startMs = Date.now();
  try {
    const response = await client.embed({
      texts,
      model,
      inputType: config.inputType || 'search_document',
      truncate: config.truncate || 'END',
      embeddingTypes: ['float'],
      ...(config.outputDimension ? { outputDimension: config.outputDimension } : {}),
    });
    const latencyMs = Date.now() - startMs;

    const vectors = response.embeddings.float;
    const tokenCount = response.meta?.billedUnits?.inputTokens || 0;

    return { vectors, tokenCount, latencyMs };
  } catch (err) {
    throw mapError(err, model);
  }
}

// ── RERANKING ───────────────────────────────────────────────

/**
 * Reorder documents by relevance to a query.
 *
 * @param {string} query - The search query
 * @param {string[]} documents - Candidate documents to rerank
 * @param {string} model - e.g. 'rerank-v3.5'
 * @param {object} config - { topN?, maxTokensPerDoc? }
 * @returns {Promise<{results: Array<{index: number, relevanceScore: number, document: string}>, latencyMs: number}>}
 */
export async function rerank(query, documents, model, config = {}) {
  const client = getClient();

  const startMs = Date.now();
  try {
    const response = await client.rerank({
      query,
      documents,
      model,
      topN: config.topN || documents.length,
      ...(config.maxTokensPerDoc ? { maxTokensPerDoc: config.maxTokensPerDoc } : {}),
    });
    const latencyMs = Date.now() - startMs;

    const results = response.results.map((r) => ({
      index: r.index,
      relevanceScore: r.relevanceScore,
      document: documents[r.index],
    }));

    return { results, latencyMs };
  } catch (err) {
    throw mapError(err, model);
  }
}

// ── TEXT_GENERATION ──────────────────────────────────────────

/**
 * Generate text via Cohere Command V2 chat API.
 *
 * @param {string} systemPrompt - System/preamble text
 * @param {string} userPrompt - User message
 * @param {string} model - e.g. 'command-r', 'command-r-plus'
 * @param {object} config - { maxTokens?, temperature? }
 * @returns {Promise<{response: string, inputTokens: number, outputTokens: number, latencyMs: number}>}
 */
export async function generate(systemPrompt, userPrompt, model, config = {}) {
  const client = getClient();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const startMs = Date.now();
  try {
    const raw = await client.chat({
      model,
      messages,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.3,
    });
    const latencyMs = Date.now() - startMs;

    // Extract text from content blocks
    const textBlocks = (raw.message?.content || []).filter((b) => b.type === 'text');
    const response = textBlocks.map((b) => b.text).join('');

    const inputTokens = raw.usage?.billedUnits?.inputTokens || raw.usage?.tokens?.inputTokens || 0;
    const outputTokens = raw.usage?.billedUnits?.outputTokens || raw.usage?.tokens?.outputTokens || 0;

    return { response, inputTokens, outputTokens, latencyMs };
  } catch (err) {
    throw mapError(err, model);
  }
}
