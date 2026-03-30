import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the Anthropic SDK ───────────────────────────────────

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  function MockAnthropic() {
    return {
      messages: {
        create: mockCreate,
        stream: mockStream,
      },
    };
  }
  return { default: MockAnthropic };
});

// Import AFTER mock is set up
const { generate, embed, rerank } = await import(
  '../../../../../src/services/ai/adapters/anthropic.js'
);
const { loadAdapter } = await import(
  '../../../../../src/services/ai/adapters/index.js'
);

// ── Helpers ──────────────────────────────────────────────────

function makeResponse(text, { inputTokens = 10, outputTokens = 20, extraBlocks = [] } = {}) {
  return {
    content: [{ type: 'text', text }, ...extraBlocks],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('Anthropic adapter — generate()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { response, inputTokens, outputTokens, latencyMs } on success', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('Hello world'));

    const result = await generate('You are helpful.', 'Hi', 'claude-sonnet-4-20250514');

    expect(result.response).toBe('Hello world');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
    expect(result.latencyMs).toBeTypeOf('number');
    expect(result.raw).toBeDefined();
  });

  it('handles string userPrompt (wraps in messages array)', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('ok'));

    await generate('sys', 'hello string', 'model-1');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'hello string' }],
      }),
    );
  });

  it('handles array userPrompt (content blocks for vision — passes through)', async () => {
    const contentBlocks = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'abc' } },
      { type: 'text', text: 'Extract data' },
    ];
    mockCreate.mockResolvedValueOnce(makeResponse('extracted'));

    await generate('sys', contentBlocks, 'model-1');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: contentBlocks }],
      }),
    );
  });

  it('handles config.messages (multi-turn — passes through directly)', async () => {
    const multiTurn = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'follow-up' },
    ];
    mockCreate.mockResolvedValueOnce(makeResponse('answer'));

    await generate('sys', 'ignored', 'model-1', { messages: multiTurn });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ messages: multiTurn }),
    );
  });

  it('handles config.tools (includes tools, returns toolUse array)', async () => {
    const tools = [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: {} } }];
    const toolBlock = { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Sydney' } };
    mockCreate.mockResolvedValueOnce(
      makeResponse(null, { extraBlocks: [toolBlock] }),
    );

    // The response text will be null since makeResponse(null) produces { type: 'text', text: null }
    // But our adapter joins text blocks — let's make it cleaner
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce({
      content: [toolBlock],
      usage: { input_tokens: 15, output_tokens: 25 },
    });

    const result = await generate('sys', 'What is the weather?', 'model-1', { tools });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ tools }),
    );
    expect(result.toolUse).toEqual([toolBlock]);
    expect(result.response).toBeNull();
  });

  it('handles config.stream === true (returns rawStream)', async () => {
    const fakeStream = { on: vi.fn(), finalMessage: vi.fn() };
    mockStream.mockReturnValueOnce(fakeStream);

    const result = await generate('sys', 'Hello', 'model-1', { stream: true });

    expect(result.rawStream).toBe(fakeStream);
    expect(result.response).toBeNull();
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(mockStream).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('maps 429 to PROVIDER_RATE_LIMIT with retryable: true', async () => {
    mockCreate.mockRejectedValueOnce({ status: 429, message: 'Rate limited' });

    await expect(generate('sys', 'hi', 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMIT',
      provider: 'anthropic',
      retryable: true,
    });
  });

  it('maps 401 to PROVIDER_AUTH_FAILURE with retryable: false', async () => {
    mockCreate.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

    await expect(generate('sys', 'hi', 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILURE',
      provider: 'anthropic',
      retryable: false,
    });
  });

  it('maps 404 to PROVIDER_MODEL_NOT_FOUND with retryable: false', async () => {
    mockCreate.mockRejectedValueOnce({ status: 404, message: 'Not found' });

    await expect(generate('sys', 'hi', 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_MODEL_NOT_FOUND',
      provider: 'anthropic',
      retryable: false,
    });
  });

  it('maps network errors to PROVIDER_TIMEOUT with retryable: true', async () => {
    mockCreate.mockRejectedValueOnce({ code: 'ECONNREFUSED', message: 'Connection refused' });

    await expect(generate('sys', 'hi', 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      provider: 'anthropic',
      retryable: true,
    });
  });

  it('maps unknown errors to PROVIDER_UNAVAILABLE with retryable: true', async () => {
    mockCreate.mockRejectedValueOnce({ status: 500, message: 'Internal server error' });

    await expect(generate('sys', 'hi', 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    });
  });
});

describe('Anthropic adapter — embed()', () => {
  it('throws PROVIDER_INTENT_NOT_SUPPORTED', async () => {
    await expect(embed('some text', 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_INTENT_NOT_SUPPORTED',
      provider: 'anthropic',
      retryable: false,
    });
  });
});

describe('Anthropic adapter — rerank()', () => {
  it('throws PROVIDER_INTENT_NOT_SUPPORTED', async () => {
    await expect(rerank('query', ['doc1', 'doc2'], 'model-1')).rejects.toMatchObject({
      code: 'PROVIDER_INTENT_NOT_SUPPORTED',
      provider: 'anthropic',
      retryable: false,
    });
  });
});

describe('Adapter loader — loadAdapter()', () => {
  it("loadAdapter('anthropic') returns the anthropic module", async () => {
    const mod = await loadAdapter('anthropic');
    expect(mod.generate).toBeTypeOf('function');
    expect(mod.embed).toBeTypeOf('function');
    expect(mod.rerank).toBeTypeOf('function');
  });

  it("loadAdapter('unknown') throws PROVIDER_NOT_FOUND", async () => {
    await expect(loadAdapter('unknown')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_FOUND',
      provider: 'unknown',
      retryable: false,
    });
  });
});
