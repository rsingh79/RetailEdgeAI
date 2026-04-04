// server/tests/asal-integration.test.js
// Integration tests for the AI Service Abstraction Layer (ASAL).
// Mocks: provider SDKs (@anthropic-ai/sdk, cohere-ai) — never makes real API calls.
// Real: aiServiceRouter, registry DB lookups, usage logging.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ── SDK Mocks (hoisted) ──────────────────────────────────────

const mockAnthropicCreate = vi.fn();
const mockAnthropicStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = {
        create: mockAnthropicCreate,
        stream: mockAnthropicStream,
      };
    }
  },
}));

const mockCohereEmbed = vi.fn();
const mockCohereChat = vi.fn();
const mockCohereRerank = vi.fn();

vi.mock('cohere-ai', () => ({
  CohereClientV2: class MockCohere {
    constructor() {
      this.embed = mockCohereEmbed;
      this.chat = mockCohereChat;
      this.rerank = mockCohereRerank;
    }
  },
  CohereError: class CohereError extends Error {
    constructor(msg) { super(msg); this.name = 'CohereError'; }
  },
  CohereTimeoutError: class CohereTimeoutError extends Error {
    constructor(msg) { super(msg); this.name = 'CohereTimeoutError'; }
  },
}));

// ── Imports ──────────────────────────────────────────────────

import { testPrisma, cleanDatabase } from './helpers/prisma.js';
import { createTestTenant, createTestUser } from './helpers/fixtures.js';
import { generate, embed, rerank, invalidateCache } from '../src/services/ai/aiServiceRouter.js';

// ── Registry Seed Data ───────────────────────────────────────

const REGISTRY_ENTRIES = [
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'test_ocr_extraction',
    description: 'Test: OCR extraction',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 4096 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'test_conflict_detection',
    description: 'Test: Conflict detection (budget model)',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    config: { maxTokens: 200 },
    costPerUnit: 0.8,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'EMBEDDING',
    taskKey: 'test_product_embed',
    description: 'Test: Product embedding (Cohere)',
    provider: 'cohere',
    model: 'embed-english-v3.0',
    config: { dimensions: 1024 },
    costPerUnit: 0.1,
    costUnit: 'per_million_tokens',
    isActive: true, // activated for testing
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'test_with_fallback',
    description: 'Test: Task with fallback provider',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    fallbackProvider: 'cohere',
    fallbackModel: 'command-r-plus',
    config: { maxTokens: 2048 },
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'test_usage_tracking',
    description: 'Test: Usage tracking task',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 1024 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
];

// ── Tests ────────────────────────────────────────────────────

describe('AI Service Abstraction Layer (ASAL) — Integration Tests', () => {
  let tenant, user;

  beforeAll(async () => {
    await cleanDatabase();

    // Seed registry entries for tests
    for (const entry of REGISTRY_ENTRIES) {
      await testPrisma.aiServiceRegistry.upsert({
        where: { taskKey: entry.taskKey },
        update: entry,
        create: entry,
      });
    }
  });

  afterAll(async () => {
    // Clean up test registry entries
    await testPrisma.aiServiceRegistry.deleteMany({
      where: { taskKey: { startsWith: 'test_' } },
    });
    await cleanDatabase();
    await testPrisma.$disconnect();
  });

  beforeEach(async () => {
    // Wait for any fire-and-forget logging from the previous test to settle
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Clean tenant data but preserve registry entries
    await cleanDatabase();
    tenant = await createTestTenant('ASAL Test Business');
    user = await createTestUser(tenant.id, { role: 'OWNER' });

    // Reset mocks and cache
    mockAnthropicCreate.mockReset();
    mockCohereEmbed.mockReset();
    mockCohereChat.mockReset();
    mockCohereRerank.mockReset();
    invalidateCache();

    // Default mock responses
    mockAnthropicCreate.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'text', text: 'Mocked Anthropic response' }],
    });

    mockCohereEmbed.mockResolvedValue({
      embeddings: { float: [[0.1, 0.2, 0.3]] },
      meta: { billedUnits: { inputTokens: 15 } },
    });

    mockCohereChat.mockResolvedValue({
      usage: { billedUnits: { inputTokens: 80, outputTokens: 40 } },
      message: { content: [{ type: 'text', text: 'Mocked Cohere response' }] },
    });
  });

  // ────────────────────────────────────────────────────────────
  // TEST 1 — Provider routing: Cohere for embeddings
  // ────────────────────────────────────────────────────────────

  it('routes embedding requests to Cohere', async () => {
    const result = await embed('test_product_embed', 'Nike Air Max 90', {
      tenantId: tenant.id,
      inputType: 'search_query',
    });

    // Verify Cohere embed was called, not Anthropic
    expect(mockCohereEmbed).toHaveBeenCalledTimes(1);
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    // Verify response shape
    expect(result.vectors).toBeDefined();
    expect(result.provider).toBe('cohere');
    expect(result.model).toBe('embed-english-v3.0');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 2 — Provider routing: Anthropic for text generation
  // ────────────────────────────────────────────────────────────

  it('routes text generation to Anthropic', async () => {
    const result = await generate(
      'test_ocr_extraction',
      'You are an OCR assistant.',
      'Extract the invoice data from this image.',
      { tenantId: tenant.id },
    );

    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockCohereChat).not.toHaveBeenCalled();

    expect(result.response).toBe('Mocked Anthropic response');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 3 — Model selection: budget vs premium by task key
  // ────────────────────────────────────────────────────────────

  it('selects budget model (Haiku) for simple tasks, premium (Sonnet) for complex', async () => {
    // Call the budget task
    await generate('test_conflict_detection', 'system', 'detect conflict', { tenantId: tenant.id });

    const budgetCallArgs = mockAnthropicCreate.mock.calls[0][0];
    expect(budgetCallArgs.model).toBe('claude-haiku-4-5-20251001');

    mockAnthropicCreate.mockClear();

    // Call the premium task
    await generate('test_ocr_extraction', 'system', 'extract OCR', { tenantId: tenant.id });

    const premiumCallArgs = mockAnthropicCreate.mock.calls[0][0];
    expect(premiumCallArgs.model).toBe('claude-sonnet-4-20250514');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 4 — Provider fallback: primary unavailable
  // ────────────────────────────────────────────────────────────

  it('falls back to secondary provider when primary fails with retryable error', async () => {
    // Primary (Anthropic) fails with retryable error
    mockAnthropicCreate.mockRejectedValueOnce({
      status: 429,
      message: 'Rate limited',
      code: 'PROVIDER_RATE_LIMIT',
      retryable: true,
    });

    // Fallback (Cohere) succeeds
    mockCohereChat.mockResolvedValueOnce({
      usage: { billedUnits: { inputTokens: 60, outputTokens: 30 } },
      message: { content: [{ type: 'text', text: 'Fallback response from Cohere' }] },
    });

    const result = await generate(
      'test_with_fallback',
      'system prompt',
      'user query',
      { tenantId: tenant.id },
    );

    // Primary was attempted
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    // Fallback was used
    expect(mockCohereChat).toHaveBeenCalledTimes(1);

    expect(result.response).toBe('Fallback response from Cohere');
    expect(result.provider).toBe('cohere');
    expect(result.model).toBe('command-r-plus');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 5 — Both providers unavailable: graceful error
  // ────────────────────────────────────────────────────────────

  it('returns graceful error when both primary and fallback fail', async () => {
    // Primary fails
    mockAnthropicCreate.mockRejectedValueOnce({
      status: 429,
      message: 'Rate limited',
      retryable: true,
    });

    // Fallback also fails
    mockCohereChat.mockRejectedValueOnce({
      status: 500,
      message: 'Internal server error',
      retryable: true,
    });

    // Should throw the primary error (mapped by adapter to standardised format)
    await expect(
      generate('test_with_fallback', 'system', 'query', { tenantId: tenant.id }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMIT',
      retryable: true,
    });

    // Both were attempted
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockCohereChat).toHaveBeenCalledTimes(1);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 6 — Non-retryable error: no fallback attempted
  // ────────────────────────────────────────────────────────────

  it('does not attempt fallback for non-retryable errors (auth failure)', async () => {
    mockAnthropicCreate.mockRejectedValueOnce({
      status: 401,
      message: 'Invalid API key',
      retryable: false,
    });

    await expect(
      generate('test_with_fallback', 'system', 'query', { tenantId: tenant.id }),
    ).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILURE', retryable: false });

    // Primary attempted, fallback NOT attempted (non-retryable error)
    expect(mockAnthropicCreate).toHaveBeenCalledTimes(1);
    expect(mockCohereChat).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // TEST 7 — Usage tracking: AiServiceLog entries
  // ────────────────────────────────────────────────────────────

  it('logs each AI call to AiServiceLog with correct metadata', async () => {
    // Make 3 AI calls
    await generate('test_usage_tracking', 'sys', 'query 1', { tenantId: tenant.id });
    await generate('test_usage_tracking', 'sys', 'query 2', { tenantId: tenant.id });
    await generate('test_usage_tracking', 'sys', 'query 3', { tenantId: tenant.id });

    // Wait for fire-and-forget logging to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // AiServiceLog entries must exist (RLS fix: _logCall uses createTenantClient)
    const logs = await testPrisma.aiServiceLog.findMany({
      where: { taskKey: 'test_usage_tracking', tenantId: tenant.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(logs).toHaveLength(3);
    for (const log of logs) {
      expect(log.tenantId).toBe(tenant.id);
      expect(log.provider).toBe('anthropic');
      expect(log.model).toBe('claude-sonnet-4-20250514');
      expect(log.status).toBe('success');
      expect(log.inputTokens).toBe(100);
      expect(log.outputTokens).toBe(50);
      expect(log.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  // ────────────────────────────────────────────────────────────
  // TEST 7b — AiServiceLog: tenant isolation
  // ────────────────────────────────────────────────────────────

  it('AiServiceLog entries are tenant-scoped — other tenants cannot see them', async () => {
    // Tenant A makes an AI call
    await generate('test_usage_tracking', 'sys', 'tenant A query', { tenantId: tenant.id });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Create tenant B and make an AI call
    const tenantB = await createTestTenant('ASAL Tenant B');
    await generate('test_usage_tracking', 'sys', 'tenant B query', { tenantId: tenantB.id });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Each tenant should only see their own logs
    const logsA = await testPrisma.aiServiceLog.findMany({
      where: { taskKey: 'test_usage_tracking', tenantId: tenant.id },
    });
    const logsB = await testPrisma.aiServiceLog.findMany({
      where: { taskKey: 'test_usage_tracking', tenantId: tenantB.id },
    });

    expect(logsA).toHaveLength(1);
    expect(logsA[0].tenantId).toBe(tenant.id);
    expect(logsB).toHaveLength(1);
    expect(logsB[0].tenantId).toBe(tenantB.id);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 7c — AiServiceLog: system-level call (null tenantId)
  // ────────────────────────────────────────────────────────────

  it('system-level AI calls log with null tenantId via adminPrisma', async () => {
    // System call — no tenantId
    await generate('test_usage_tracking', 'sys', 'system query', {});
    await new Promise((resolve) => setTimeout(resolve, 500));

    const logs = await testPrisma.aiServiceLog.findMany({
      where: { taskKey: 'test_usage_tracking', tenantId: null },
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const systemLog = logs[logs.length - 1];
    expect(systemLog.tenantId).toBeNull();
    expect(systemLog.provider).toBe('anthropic');
    expect(systemLog.status).toBe('success');
  });

  // ────────────────────────────────────────────────────────────
  // TEST 8 — Concurrent usage tracking: no lost increments
  // ────────────────────────────────────────────────────────────

  it('concurrent requests — all 5 calls logged without race conditions', async () => {
    // Fire 5 concurrent AI calls
    const calls = Array.from({ length: 5 }, (_, i) =>
      generate('test_usage_tracking', 'sys', `concurrent query ${i + 1}`, {
        tenantId: tenant.id,
      }),
    );

    const results = await Promise.all(calls);
    expect(results).toHaveLength(5);

    // All calls should have returned successfully
    for (const result of results) {
      expect(result.response).toBe('Mocked Anthropic response');
    }

    // Wait for fire-and-forget logging
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // AiServiceLog must have all 5 entries (RLS fix: _logCall uses createTenantClient)
    const aiLogs = await testPrisma.aiServiceLog.findMany({
      where: { taskKey: 'test_usage_tracking', tenantId: tenant.id },
    });
    expect(aiLogs).toHaveLength(5);
  });

  // ────────────────────────────────────────────────────────────
  // TEST 9 — Intent mismatch: calling embed on a TEXT_GENERATION task
  // ────────────────────────────────────────────────────────────

  it('rejects intent mismatch — embed call on TEXT_GENERATION task', async () => {
    await expect(
      embed('test_ocr_extraction', 'some text', { tenantId: tenant.id }),
    ).rejects.toMatchObject({
      code: 'INTENT_MISMATCH',
      expected: 'EMBEDDING',
      actual: 'TEXT_GENERATION',
    });

    // No adapter should have been called
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockCohereEmbed).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // TEST 10 — Unknown task key: clear error
  // ────────────────────────────────────────────────────────────

  it('throws clear error for unregistered task key', async () => {
    await expect(
      generate('nonexistent_task_key', 'sys', 'query'),
    ).rejects.toMatchObject({
      code: 'TASK_KEY_NOT_FOUND',
      taskKey: 'nonexistent_task_key',
    });
  });
});
