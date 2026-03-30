import { PrismaClient } from '../src/generated/prisma/client.js';
const prisma = new PrismaClient();

const registryEntries = [
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'ocr_extraction',
    description: 'Invoice OCR extraction via Claude Vision',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 4096 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'product_matching_ai',
    description: 'AI fallback for unmatched invoice lines',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 4096 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'advisor_tool_round',
    description: 'Business Advisor tool-use rounds (non-streaming)',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 2048 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'advisor_stream',
    description: 'Business Advisor final streaming response',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 2048 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'product_import_analysis',
    description: 'Product import file analysis and chat',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 4096 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'prompt_management',
    description: 'Prompt customisation chat agent',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    config: { maxTokens: 4096 },
    costPerUnit: 3.0,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'conflict_detection',
    description: 'Prompt conflict detection (uses Haiku for cost efficiency)',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    config: { maxTokens: 200 },
    costPerUnit: 0.8,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'suggestion_generation',
    description: 'Prompt suggestion generation (uses Haiku for cost efficiency)',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    config: { maxTokens: 2000 },
    costPerUnit: 0.8,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  {
    intent: 'TEXT_GENERATION',
    taskKey: 'meta_optimizer',
    description: 'Cross-tenant meta-optimizer analysis (uses Haiku for cost efficiency)',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    config: { maxTokens: 2000 },
    costPerUnit: 0.8,
    costUnit: 'per_million_input_tokens',
    isActive: true,
  },
  // Placeholder entries for future Cohere integration (inactive)
  {
    intent: 'EMBEDDING',
    taskKey: 'product_matching_embed',
    description: 'Semantic product matching via embeddings (planned — Cohere or Voyage AI)',
    provider: 'cohere',
    model: 'embed-english-v3.0',
    config: { dimensions: 1024 },
    costPerUnit: 0.1,
    costUnit: 'per_million_tokens',
    isActive: false,
  },
  {
    intent: 'RERANKING',
    taskKey: 'advisor_context_rerank',
    description:
      'Advisor context reranking before sending to LLM (planned — Cohere or Voyage AI)',
    provider: 'cohere',
    model: 'rerank-v3.5',
    config: { topN: 10 },
    costPerUnit: 2.0,
    costUnit: 'per_1000_searches',
    isActive: false,
  },
];

async function seed() {
  console.log('[ASAL Seed] Upserting AI Service Registry entries...\n');

  for (const entry of registryEntries) {
    const result = await prisma.aiServiceRegistry.upsert({
      where: { taskKey: entry.taskKey },
      update: {
        intent: entry.intent,
        description: entry.description,
        provider: entry.provider,
        model: entry.model,
        config: entry.config,
        costPerUnit: entry.costPerUnit,
        costUnit: entry.costUnit,
        isActive: entry.isActive,
      },
      create: entry,
    });
    console.log(
      `  [${result.isActive ? 'ACTIVE' : 'INACTIVE'}] ${result.taskKey} → ${result.provider}/${result.model}`
    );
  }

  console.log(`\n[ASAL Seed] Done. ${registryEntries.length} entries upserted.`);
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error('[ASAL Seed] Failed:', err.message);
  process.exit(1);
});
