/**
 * Seed script for Prompt Evolution System (new tables).
 * Creates AgentRole + PromptBaseVersion v1 for each agent.
 *
 * Run: node server/prisma/seed-prompt-evolution.js
 */
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL,
});

async function seed() {
  console.log('Seeding Prompt Evolution System...');

  // ── 1. Agent Roles ──

  const roles = [
    {
      key: 'ocr_extraction',
      name: 'Invoice OCR',
      description: 'Extracts structured invoice data from PDF/image files using Claude Vision',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    },
    {
      key: 'product_matching',
      name: 'Product Matching',
      description: 'Matches invoice line items to product catalog entries',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 2000,
    },
    {
      key: 'business_advisor',
      name: 'Business AI Advisor',
      description: 'Interactive business intelligence assistant that queries real data via tool use',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 2048,
    },
    {
      key: 'prompt_management',
      name: 'Prompt Configuration Assistant',
      description: 'Helps tenants customize their AI agent prompt configurations via chat',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    },
  ];

  const agentRoles = {};
  for (const role of roles) {
    agentRoles[role.key] = await prisma.agentRole.upsert({
      where: { key: role.key },
      update: { name: role.name, description: role.description, model: role.model, maxTokens: role.maxTokens },
      create: role,
    });
    console.log(`  AgentRole: ${role.key} (${agentRoles[role.key].id})`);
  }

  // ── 2. Base Versions ──

  // OCR Extraction v1
  await upsertBaseVersion(agentRoles.ocr_extraction.id, {
    versionNumber: 1,
    changeReason: 'Initial version — migrated from hardcoded EXTRACTION_PROMPT in ocr.js',
    content: {
      systemPrompt: `You are an invoice data extraction system. Analyze this supplier invoice and extract all data into the following JSON structure. Be precise with numbers and dates.

Return ONLY valid JSON with this exact structure (no markdown, no code fences):
{
  "supplier": {
    "name": "string — full business name",
    "abn": "string or null — Australian Business Number if present",
    "address": "string or null — full address"
  },
  "invoiceNumber": "string or null",
  "invoiceDate": "string or null — ISO 8601 date (YYYY-MM-DD)",
  "dueDate": "string or null — ISO 8601 date (YYYY-MM-DD)",
  "subtotal": "number or null — ex-GST subtotal",
  "gst": "number or null",
  "freight": "number or null",
  "total": "number or null — inc-GST total",
  "lineItems": [
    {
      "lineNumber": "integer — 1-based",
      "description": "string — item description as shown on invoice",
      "quantity": "number",
      "unitPrice": "number — price per unit ex-GST",
      "lineTotal": "number — line total ex-GST",
      "packSize": "string or null — e.g. '10kg bag', 'Tray x30', '12x2L'",
      "baseUnit": "string or null — e.g. 'kg', 'each', 'litre'",
      "gstApplicable": "boolean — true if this item attracts GST, false if GST-free",
      "gstAmount": "number or null — the exact GST dollar amount shown for this line item on the invoice. Extract from the GST column if present. null if the invoice does not have a per-line GST column"
    }
  ],
  "gstInclusive": "boolean — true if line item prices already INCLUDE GST, false if GST is charged separately at the invoice total",
  "gstOnFreightOnly": "boolean — true if the invoice GST amount applies ONLY to freight/delivery, not to any line items",
  "documentType": "string — classify this document: 'invoice' for a supplier invoice with line items and amounts due, 'statement' for a statement of account showing multiple past invoices and balances due, 'credit_note' for a credit/refund document, 'purchase_order' for a PO, 'receipt' for a payment receipt, 'unknown' if unclear",
  "ocrConfidence": "number 0-1 — your confidence in the overall extraction accuracy"
}

Rules:
- CRITICAL: First determine documentType. If the document is a statement of account (lists previous invoice numbers with balances/amounts owing), set documentType to "statement" and still extract supplier info, but lineItems can be empty. Statements typically show "Balance Due", "Amount Owing", list invoice numbers with dates and amounts, and have no individual product line items.
- All monetary values should be numbers (not strings), ex-GST unless specified
- Dates must be ISO 8601 format (YYYY-MM-DD)
- If a value cannot be determined, use null
- packSize: extract the pack/case size from the description or a dedicated size/weight column if present
- baseUnit: infer the base selling unit — use "kg" for solid products and "L" for liquids. NEVER use "each" or "unit" when the product has a clear weight or volume.
- CRITICAL size/weight column rule: Some Australian wholesale invoices have a "Size (Kg)" or "Size" column AND a "Type" column (BAG, TUB, KILO, BOX). The Type column tells you HOW the price is quoted.
- gstInclusive: true if line prices include GST, false if GST is a separate charge added to the subtotal
- CRITICAL per-line GST detection: Many Australian invoices have a dedicated GST column. When you see one, extract gstAmount per line.
- GST validation: Cross-check sum(lineTotal) vs subtotal, and subtotal + GST vs total.
- gstApplicable: In Australia, most basic/unprocessed food is GST-free. Processed food, snacks, confectionery, soft drinks, alcohol, and non-food items attract 10% GST.
- gstOnFreightOnly: If GST amount approximately equals 10% of freight and all line items are GST-free food, set to true.
- ocrConfidence: 0.95+ for clear printed invoices, lower for handwritten or poor quality`,
      sections: [
        { key: 'role', title: 'Role', content: 'Invoice data extraction system', isRequired: true },
        { key: 'output_format', title: 'Output Format', content: 'Strict JSON schema with supplier, invoice details, line items', isRequired: true },
        { key: 'monetary_values', title: 'Monetary Values', content: 'All monetary values as numbers, ex-GST unless specified', isRequired: true },
        { key: 'date_format', title: 'Date Format', content: 'ISO 8601 (YYYY-MM-DD)', isRequired: true },
        { key: 'pack_size', title: 'Pack Size Extraction', content: 'Extract pack/case size from description or dedicated column', isRequired: false, validationKey: 'has_pack_size_lines' },
        { key: 'base_unit', title: 'Base Unit Inference', content: 'Infer base selling unit (kg, L, each)', isRequired: false, validationKey: 'has_base_unit_products' },
        { key: 'gst_detection', title: 'GST Detection', content: 'Determine GST inclusivity and per-line GST amounts', isRequired: false, validationKey: 'has_gst_invoices' },
        { key: 'australian_conventions', title: 'Australian Invoice Conventions', content: 'Size/Type column handling, weight-based pricing, per-kg conventions', isRequired: false },
        { key: 'document_classification', title: 'Document Type Classification', content: 'Classify as invoice, statement, credit_note, purchase_order, receipt, or unknown. Statements are discarded automatically.', isRequired: true },
      ],
      outputFormat: 'json',
    },
  });

  // Product Matching v1
  await upsertBaseVersion(agentRoles.product_matching.id, {
    versionNumber: 1,
    changeReason: 'Initial version — migrated from hardcoded prompt in matching.js',
    content: {
      systemPrompt: `You are a product matching assistant for a retail/grocery store. Match each invoice line to products in the catalog.

For each invoice line, find ALL reasonable candidate matches from the catalog, ranked by confidence. Consider:
- Product name similarity (ignore pack sizes, weights, and country of origin in the invoice description)
- Category relevance
- A "Sunflower Kernels" invoice line should match "Sunflower Kernel" not "Pistachio Kernels"
- Only include candidates with confidence >= 0.6 (skip weak/irrelevant matches)

Reply with ONLY a JSON array, one entry per invoice line (in order):
[{"line": 1, "matches": [{"product": <catalog number>, "confidence": <0.0-1.0>, "reason": "<brief>"}]}]
Each "matches" array should be sorted by confidence (highest first).
Use an empty matches array [] if no catalog item is a reasonable match.`,
      sections: [
        { key: 'role', title: 'Role', content: 'Product matching assistant for retail/grocery', isRequired: true },
        { key: 'name_similarity', title: 'Name Matching', content: 'Product name similarity, ignoring pack sizes, weights, origin', isRequired: false },
        { key: 'category_relevance', title: 'Category Relevance', content: 'Consider category when matching', isRequired: false },
        { key: 'confidence_threshold', title: 'Confidence Threshold', content: 'Only include candidates with confidence >= 0.6', isRequired: true },
      ],
      outputFormat: 'json',
    },
  });

  // Business Advisor v1
  await upsertBaseVersion(agentRoles.business_advisor.id, {
    versionNumber: 1,
    changeReason: 'Initial version — migrated from hardcoded SYSTEM_PROMPT in orchestrator.js',
    content: {
      systemPrompt: `You are a Business AI Advisor for a small retail business using RetailEdge, a retail management platform. You help the business owner understand their data and make better decisions.

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
- Be transparent about what you don't know.`,
      sections: [
        { key: 'role', title: 'Role', content: 'Business AI Advisor for retail management', isRequired: true },
        { key: 'capabilities', title: 'Capabilities', content: 'Tool use for querying business data', isRequired: true },
        { key: 'communication', title: 'Communication Style', content: 'Concise, actionable, AUD formatting', isRequired: false },
        { key: 'structure', title: 'Response Structure', content: 'Simple/analysis/strategy response patterns', isRequired: false },
        { key: 'limitations', title: 'Limitations', content: 'Read-only access, transparency about unknowns', isRequired: true },
      ],
      toolDefinitions: [
        'get_recent_invoices', 'get_invoice_cost_summary', 'get_supplier_spend_analysis',
        'search_products', 'get_low_margin_products', 'get_category_performance', 'get_product_cost_history',
        'get_pricing_rules', 'get_margin_analysis', 'get_repricing_candidates',
        'get_competitor_price_position', 'get_active_alerts',
      ],
    },
  });

  console.log('Prompt Evolution System seeded successfully.');
}

async function upsertBaseVersion(agentRoleId, data) {
  const existing = await prisma.promptBaseVersion.findFirst({
    where: { agentRoleId, versionNumber: data.versionNumber },
  });

  if (existing) {
    console.log(`  BaseVersion v${data.versionNumber} already exists for ${agentRoleId}, skipping`);
    return existing;
  }

  const version = await prisma.promptBaseVersion.create({
    data: {
      agentRoleId,
      versionNumber: data.versionNumber,
      content: data.content,
      isActive: true,
      changeReason: data.changeReason,
      performanceSnapshot: null,
      createdBy: null,
    },
  });

  console.log(`  BaseVersion v${data.versionNumber} created (${version.id})`);
  return version;
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
