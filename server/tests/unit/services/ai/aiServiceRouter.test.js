import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Prisma ─────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockLogCreate = vi.fn();

vi.mock('../../../../src/lib/prisma.js', () => ({
  basePrisma: {
    aiServiceRegistry: { findMany: (...args) => mockFindMany(...args) },
    aiServiceLog: { create: (...args) => mockLogCreate(...args) },
  },
  createTenantClient: () => ({
    aiServiceLog: { create: (...args) => mockLogCreate(...args) },
  }),
  adminPrisma: {
    aiServiceLog: { create: (...args) => mockLogCreate(...args) },
  },
}));

// ── Mock adapter loader ─────────────────────────────────────

const mockGenerate = vi.fn();
const mockEmbed = vi.fn();
const mockRerank = vi.fn();

vi.mock('../../../../src/services/ai/adapters/index.js', () => ({
  loadAdapter: vi.fn(async (provider) => {
    if (provider === 'anthropic') {
      return { generate: mockGenerate, embed: mockEmbed, rerank: mockRerank };
    }
    if (provider === 'fallback-provider') {
      return { generate: mockGenerate, embed: mockEmbed, rerank: mockRerank };
    }
    throw { code: 'PROVIDER_NOT_FOUND', provider, retryable: false };
  }),
}));

// Import after mocks
const { generate, embed, rerank, invalidateCache } = await import(
  '../../../../src/services/ai/aiServiceRouter.js'
);

// ── Test fixtures ───────────────────────────────────────────

function makeRegistryEntry(overrides = {}) {
  return {
    id: 'reg_1',
    intent: 'TEXT_GENERATION',
    taskKey: 'test_generate',
    description: 'Test generation task',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 4096 },
    fallbackProvider: null,
    fallbackModel: null,
    isActive: true,
    costPerUnit: '3.00',
    costUnit: 'per_million_input_tokens',
    ...overrides,
  };
}

const GEN_ENTRY = makeRegistryEntry();

const EMBED_ENTRY = makeRegistryEntry({
  id: 'reg_2',
  intent: 'EMBEDDING',
  taskKey: 'test_embed',
  provider: 'anthropic',
  model: 'embed-english-v3.0',
  costPerUnit: '0.10',
  costUnit: 'per_million_tokens',
});

const RERANK_ENTRY = makeRegistryEntry({
  id: 'reg_3',
  intent: 'RERANKING',
  taskKey: 'test_rerank',
  provider: 'anthropic',
  model: 'rerank-v3.5',
  costPerUnit: '1.00',
  costUnit: 'per_1000_searches',
});

const FALLBACK_ENTRY = makeRegistryEntry({
  id: 'reg_4',
  taskKey: 'test_with_fallback',
  fallbackProvider: 'fallback-provider',
  fallbackModel: 'fallback-model-1',
});

function seedRegistry(entries = [GEN_ENTRY, EMBED_ENTRY, RERANK_ENTRY, FALLBACK_ENTRY]) {
  mockFindMany.mockResolvedValue(entries);
}

// ── Setup / Teardown ────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  invalidateCache();
  mockLogCreate.mockResolvedValue({});
});

// ── Registry cache tests ────────────────────────────────────

describe('Registry cache', () => {
  it('loads from DB on first call (cold cache)', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });

    await generate('test_generate', 'sys', 'hi');

    expect(mockFindMany).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it('returns cached entry on subsequent calls (warm cache)', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValue({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });

    await generate('test_generate', 'sys', 'hi');
    await generate('test_generate', 'sys', 'hi again');

    // Only one DB call despite two generate calls
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it('reloads from DB after TTL expires', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValue({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });

    await generate('test_generate', 'sys', 'hi');

    // Simulate TTL expiry by manipulating the timestamp
    // We invalidate and re-seed to simulate a TTL reload
    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    seedRegistry();

    await generate('test_generate', 'sys', 'hi');

    expect(mockFindMany).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws TASK_KEY_NOT_FOUND for unknown task', async () => {
    seedRegistry();

    await expect(generate('nonexistent_task', 'sys', 'hi')).rejects.toMatchObject({
      code: 'TASK_KEY_NOT_FOUND',
      taskKey: 'nonexistent_task',
      retryable: false,
    });
  });

  it('invalidateCache() forces next call to reload from DB', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValue({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });

    await generate('test_generate', 'sys', 'hi');
    expect(mockFindMany).toHaveBeenCalledTimes(1);

    invalidateCache();
    seedRegistry();

    await generate('test_generate', 'sys', 'hi');
    expect(mockFindMany).toHaveBeenCalledTimes(2);
  });
});

// ── generate() tests ────────────────────────────────────────

describe('generate()', () => {
  it('returns response with provider and model metadata attached', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValueOnce({
      response: 'Hello world',
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = await generate('test_generate', 'You are helpful.', 'Hi');

    expect(result.response).toBe('Hello world');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.latencyMs).toBeTypeOf('number');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('throws INTENT_MISMATCH if registry entry is not TEXT_GENERATION', async () => {
    seedRegistry();

    await expect(generate('test_embed', 'sys', 'hi')).rejects.toMatchObject({
      code: 'INTENT_MISMATCH',
      expected: 'TEXT_GENERATION',
      actual: 'EMBEDDING',
      retryable: false,
    });
  });

  it('passes options.maxTokens to adapter (overrides registry config)', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });

    await generate('test_generate', 'sys', 'hi', { maxTokens: 8192 });

    // The adapter's config should have the overridden maxTokens
    const callArgs = mockGenerate.mock.calls[0];
    const config = callArgs[3]; // generate(systemPrompt, userPrompt, model, config)
    expect(config.maxTokens).toBe(8192);
  });

  it('passes tools and messages through to adapter', async () => {
    seedRegistry();
    const tools = [{ name: 'get_data', description: 'Gets data', input_schema: {} }];
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ];
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
      toolUse: [],
    });

    await generate('test_generate', 'sys', 'hi', { tools, messages });

    const config = mockGenerate.mock.calls[0][3];
    expect(config.tools).toBe(tools);
    expect(config.messages).toBe(messages);
  });

  it('handles streaming (passes stream: true to adapter)', async () => {
    seedRegistry();
    const fakeStream = { on: vi.fn() };
    mockGenerate.mockResolvedValueOnce({
      response: null,
      inputTokens: 0,
      outputTokens: 0,
      rawStream: fakeStream,
    });

    const result = await generate('test_generate', 'sys', 'hi', { stream: true });

    const config = mockGenerate.mock.calls[0][3];
    expect(config.stream).toBe(true);
    expect(result.rawStream).toBe(fakeStream);
  });
});

// ── embed() tests ───────────────────────────────────────────

describe('embed()', () => {
  it('throws TASK_KEY_NOT_FOUND for non-existent task', async () => {
    seedRegistry();

    await expect(embed('nonexistent_embed', 'hello')).rejects.toMatchObject({
      code: 'TASK_KEY_NOT_FOUND',
      taskKey: 'nonexistent_embed',
    });
  });

  it('throws INTENT_MISMATCH if registry entry is not EMBEDDING', async () => {
    seedRegistry();

    await expect(embed('test_generate', 'hello')).rejects.toMatchObject({
      code: 'INTENT_MISMATCH',
      expected: 'EMBEDDING',
      actual: 'TEXT_GENERATION',
      retryable: false,
    });
  });
});

// ── rerank() tests ──────────────────────────────────────────

describe('rerank()', () => {
  it('throws TASK_KEY_NOT_FOUND for non-existent task', async () => {
    seedRegistry();

    await expect(rerank('nonexistent_rerank', 'query', ['doc'])).rejects.toMatchObject({
      code: 'TASK_KEY_NOT_FOUND',
      taskKey: 'nonexistent_rerank',
    });
  });

  it('throws INTENT_MISMATCH if registry entry is not RERANKING', async () => {
    seedRegistry();

    await expect(rerank('test_generate', 'query', ['doc'])).rejects.toMatchObject({
      code: 'INTENT_MISMATCH',
      expected: 'RERANKING',
      actual: 'TEXT_GENERATION',
      retryable: false,
    });
  });
});

// ── Fallback tests ──────────────────────────────────────────

describe('Fallback', () => {
  it('on adapter failure with retryable error + fallback configured, calls fallback adapter', async () => {
    seedRegistry();
    // Primary fails with retryable error, fallback succeeds
    mockGenerate
      .mockRejectedValueOnce({ code: 'PROVIDER_RATE_LIMIT', retryable: true })
      .mockResolvedValueOnce({
        response: 'fallback response',
        inputTokens: 20,
        outputTokens: 10,
      });

    const result = await generate('test_with_fallback', 'sys', 'hi');

    expect(result.response).toBe('fallback response');
    expect(result.provider).toBe('fallback-provider');
    expect(result.model).toBe('fallback-model-1');
  });

  it('on adapter failure with retryable error + no fallback, throws original error', async () => {
    seedRegistry();
    const error = { code: 'PROVIDER_RATE_LIMIT', retryable: true, message: 'Rate limited' };
    mockGenerate.mockRejectedValueOnce(error);

    // test_generate has no fallback configured
    await expect(generate('test_generate', 'sys', 'hi')).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMIT',
    });
  });

  it('on adapter failure with retryable: false, throws immediately (no fallback attempt)', async () => {
    seedRegistry();
    mockGenerate.mockRejectedValueOnce({
      code: 'PROVIDER_AUTH_FAILURE',
      retryable: false,
    });

    await expect(generate('test_with_fallback', 'sys', 'hi')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILURE',
      retryable: false,
    });

    // Adapter should only be called once (no fallback attempt)
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('on fallback also failing, throws original primary error', async () => {
    seedRegistry();
    mockGenerate
      .mockRejectedValueOnce({ code: 'PROVIDER_RATE_LIMIT', retryable: true })
      .mockRejectedValueOnce({ code: 'FALLBACK_ALSO_FAILED', retryable: true });

    await expect(generate('test_with_fallback', 'sys', 'hi')).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMIT',
    });
  });
});

// ── Logging tests ───────────────────────────────────────────

describe('Logging', () => {
  it('successful call creates AiServiceLog with status success', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 100,
      outputTokens: 50,
    });

    await generate('test_generate', 'sys', 'hi');

    // Allow fire-and-forget to resolve
    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled());

    expect(mockLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskKey: 'test_generate',
        status: 'success',
        inputTokens: 100,
        outputTokens: 50,
        isFallback: false,
      }),
    });
  });

  it('failed call creates AiServiceLog with status failure and errorCode', async () => {
    seedRegistry();
    mockGenerate.mockRejectedValueOnce({ code: 'PROVIDER_RATE_LIMIT', retryable: true });

    await expect(generate('test_generate', 'sys', 'hi')).rejects.toBeTruthy();

    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled());

    expect(mockLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskKey: 'test_generate',
        status: 'failure',
        errorCode: 'PROVIDER_RATE_LIMIT',
      }),
    });
  });

  it('fallback success creates AiServiceLog with status fallback_success and isFallback: true', async () => {
    seedRegistry();
    mockGenerate
      .mockRejectedValueOnce({ code: 'PROVIDER_RATE_LIMIT', retryable: true })
      .mockResolvedValueOnce({
        response: 'fallback ok',
        inputTokens: 20,
        outputTokens: 10,
      });

    await generate('test_with_fallback', 'sys', 'hi');

    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalledTimes(2));

    // Second log call should be the fallback success
    const fallbackLogCall = mockLogCreate.mock.calls[1][0];
    expect(fallbackLogCall.data).toMatchObject({
      status: 'fallback_success',
      isFallback: true,
      provider: 'fallback-provider',
      model: 'fallback-model-1',
    });
  });

  it('logging failure does not break the AI call (fire-and-forget)', async () => {
    seedRegistry();
    mockLogCreate.mockRejectedValue(new Error('DB connection lost'));
    mockGenerate.mockResolvedValueOnce({
      response: 'still works',
      inputTokens: 10,
      outputTokens: 5,
    });

    // Should not throw even though logging fails
    const result = await generate('test_generate', 'sys', 'hi');
    expect(result.response).toBe('still works');
  });

  it('tenantId from options is passed through to the log entry', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 10,
      outputTokens: 5,
    });

    await generate('test_generate', 'sys', 'hi', { tenantId: 'tenant_abc' });

    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled());

    expect(mockLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant_abc',
      }),
    });
  });
});

// ── Cost estimation tests ───────────────────────────────────

describe('Cost estimation', () => {
  it('calculates correctly for per_million_input_tokens', async () => {
    seedRegistry();
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 1_000_000,
      outputTokens: 0,
    });

    await generate('test_generate', 'sys', 'hi');

    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled());

    const logData = mockLogCreate.mock.calls[0][0].data;
    // GEN_ENTRY has costPerUnit: '3.00', costUnit: 'per_million_input_tokens'
    // 1M tokens * 3.00 / 1M = 3.00
    expect(logData.estimatedCost).toBeCloseTo(3.0);
  });

  it('returns null when costPerUnit is not set', async () => {
    const noCostEntry = makeRegistryEntry({
      taskKey: 'no_cost_task',
      costPerUnit: null,
      costUnit: null,
    });
    seedRegistry([noCostEntry]);
    mockGenerate.mockResolvedValueOnce({
      response: 'ok',
      inputTokens: 100,
      outputTokens: 50,
    });

    await generate('no_cost_task', 'sys', 'hi');

    await vi.waitFor(() => expect(mockLogCreate).toHaveBeenCalled());

    const logData = mockLogCreate.mock.calls[0][0].data;
    expect(logData.estimatedCost).toBeNull();
  });
});
