import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the Cohere SDK ─────────────────────────────────────

const mockEmbed = vi.fn();
const mockRerank = vi.fn();
const mockChat = vi.fn();

class MockCohereError extends Error {
  constructor({ message, statusCode }) {
    super(message);
    this.statusCode = statusCode;
  }
}

class MockCohereTimeoutError extends Error {
  constructor(message) {
    super(message);
  }
}

vi.mock('cohere-ai', () => {
  class CohereClientV2 {
    constructor() {
      this.embed = mockEmbed;
      this.rerank = mockRerank;
      this.chat = mockChat;
    }
  }
  return {
    CohereClientV2,
    CohereError: MockCohereError,
    CohereTimeoutError: MockCohereTimeoutError,
  };
});

// Import AFTER mock is set up
const { embed, rerank, generate } = await import(
  '../../../../../src/services/ai/adapters/cohere.js'
);
const { loadAdapter } = await import(
  '../../../../../src/services/ai/adapters/index.js'
);

// ── Helpers ─────────────────────────────────────────────────

function makeEmbedResponse(vectors, inputTokens = 5) {
  return {
    embeddings: { float: vectors },
    meta: { billedUnits: { inputTokens } },
  };
}

function makeRerankResponse(results) {
  return {
    results: results.map((r) => ({
      index: r.index,
      relevanceScore: r.relevanceScore,
    })),
  };
}

function makeChatResponse(text, { inputTokens = 10, outputTokens = 20 } = {}) {
  return {
    message: {
      content: [{ type: 'text', text }],
    },
    usage: {
      billedUnits: { inputTokens, outputTokens },
      tokens: { inputTokens, outputTokens },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('Cohere adapter — embed()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { vectors, tokenCount, latencyMs } on success', async () => {
    const vectors = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]];
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse(vectors, 12));

    const result = await embed(['hello', 'world'], 'embed-english-v3.0');

    expect(result.vectors).toEqual(vectors);
    expect(result.tokenCount).toBe(12);
    expect(result.latencyMs).toBeTypeOf('number');
  });

  it('handles single string input (wraps in array)', async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse([[0.1, 0.2]]));

    await embed('hello', 'embed-english-v3.0');

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ texts: ['hello'] }),
    );
  });

  it('handles array input (passes through)', async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse([[0.1], [0.2]]));

    await embed(['a', 'b'], 'embed-english-v3.0');

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ texts: ['a', 'b'] }),
    );
  });

  it("passes inputType from config ('search_document' vs 'search_query')", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse([[0.1]]));

    await embed('query text', 'embed-english-v3.0', { inputType: 'search_query' });

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ inputType: 'search_query' }),
    );
  });

  it("defaults inputType to 'search_document'", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbedResponse([[0.1]]));

    await embed('text', 'embed-english-v3.0');

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ inputType: 'search_document' }),
    );
  });

  it('maps 429 to PROVIDER_RATE_LIMIT with retryable: true', async () => {
    mockEmbed.mockRejectedValueOnce(new MockCohereError({ message: 'Rate limited', statusCode: 429 }));

    await expect(embed('text', 'embed-english-v3.0')).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMIT',
      provider: 'cohere',
      retryable: true,
    });
  });

  it('maps 401 to PROVIDER_AUTH_FAILURE with retryable: false', async () => {
    mockEmbed.mockRejectedValueOnce(new MockCohereError({ message: 'Unauthorized', statusCode: 401 }));

    await expect(embed('text', 'embed-english-v3.0')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILURE',
      provider: 'cohere',
      retryable: false,
    });
  });

  it('maps timeout errors to PROVIDER_TIMEOUT with retryable: true', async () => {
    mockEmbed.mockRejectedValueOnce(new MockCohereTimeoutError('Request timed out'));

    await expect(embed('text', 'embed-english-v3.0')).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      provider: 'cohere',
      retryable: true,
    });
  });
});

describe('Cohere adapter — rerank()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { results: [{index, relevanceScore, document}], latencyMs } on success', async () => {
    mockRerank.mockResolvedValueOnce(
      makeRerankResponse([
        { index: 0, relevanceScore: 0.95 },
        { index: 2, relevanceScore: 0.80 },
        { index: 1, relevanceScore: 0.45 },
      ]),
    );

    const docs = ['Bulla Cream Cheese 250g', 'Smith Chips 175g', 'Philadelphia CC 250g'];
    const result = await rerank('cream cheese 250g', docs, 'rerank-v3.5');

    expect(result.results).toHaveLength(3);
    expect(result.results[0]).toEqual({
      index: 0,
      relevanceScore: 0.95,
      document: 'Bulla Cream Cheese 250g',
    });
    expect(result.results[1]).toEqual({
      index: 2,
      relevanceScore: 0.80,
      document: 'Philadelphia CC 250g',
    });
    expect(result.latencyMs).toBeTypeOf('number');
  });

  it('results are ordered by relevanceScore descending (preserves API order)', async () => {
    mockRerank.mockResolvedValueOnce(
      makeRerankResponse([
        { index: 1, relevanceScore: 0.99 },
        { index: 0, relevanceScore: 0.50 },
      ]),
    );

    const result = await rerank('query', ['doc0', 'doc1'], 'rerank-v3.5');

    expect(result.results[0].relevanceScore).toBeGreaterThan(result.results[1].relevanceScore);
  });

  it('respects topN config', async () => {
    mockRerank.mockResolvedValueOnce(
      makeRerankResponse([{ index: 0, relevanceScore: 0.9 }]),
    );

    await rerank('query', ['a', 'b', 'c'], 'rerank-v3.5', { topN: 1 });

    expect(mockRerank).toHaveBeenCalledWith(
      expect.objectContaining({ topN: 1 }),
    );
  });

  it('maps errors to standardised codes', async () => {
    mockRerank.mockRejectedValueOnce(new MockCohereError({ message: 'Not found', statusCode: 404 }));

    await expect(rerank('q', ['d'], 'bad-model')).rejects.toMatchObject({
      code: 'PROVIDER_MODEL_NOT_FOUND',
      provider: 'cohere',
      retryable: false,
    });
  });
});

describe('Cohere adapter — generate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { response, inputTokens, outputTokens, latencyMs } on success', async () => {
    mockChat.mockResolvedValueOnce(makeChatResponse('Hello world', { inputTokens: 15, outputTokens: 30 }));

    const result = await generate('You are helpful.', 'Hi', 'command-r');

    expect(result.response).toBe('Hello world');
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(30);
    expect(result.latencyMs).toBeTypeOf('number');
  });

  it('sends system + user messages in V2 format', async () => {
    mockChat.mockResolvedValueOnce(makeChatResponse('ok'));

    await generate('system text', 'user text', 'command-r');

    expect(mockChat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'system text' },
          { role: 'user', content: 'user text' },
        ],
      }),
    );
  });

  it('maps errors to standardised codes', async () => {
    mockChat.mockRejectedValueOnce(new MockCohereError({ message: 'Bad request', statusCode: 400 }));

    await expect(generate('sys', 'msg', 'command-r')).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_INPUT',
      provider: 'cohere',
      retryable: false,
    });
  });

  it('maps network errors to PROVIDER_TIMEOUT', async () => {
    const err = new Error('Connection refused');
    err.code = 'ECONNREFUSED';
    mockChat.mockRejectedValueOnce(err);

    await expect(generate('sys', 'msg', 'command-r')).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      provider: 'cohere',
      retryable: true,
    });
  });

  it('maps unknown errors to PROVIDER_UNAVAILABLE', async () => {
    mockChat.mockRejectedValueOnce(new MockCohereError({ message: 'Internal error', statusCode: 500 }));

    await expect(generate('sys', 'msg', 'command-r')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      provider: 'cohere',
      retryable: true,
    });
  });
});

describe('Adapter loader — loadAdapter("cohere")', () => {
  it('returns the cohere module with all three intent functions', async () => {
    const mod = await loadAdapter('cohere');
    expect(mod.generate).toBeTypeOf('function');
    expect(mod.embed).toBeTypeOf('function');
    expect(mod.rerank).toBeTypeOf('function');
  });
});
