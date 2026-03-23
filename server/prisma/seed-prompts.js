import { basePrisma } from '../src/lib/prisma.js';

/**
 * Seed the prompt management system with generic (system default) prompts.
 * Decomposes the hardcoded OCR and matching prompts into atomic conditions.
 */
async function seedPrompts() {
  console.log('Seeding AI agent types and prompt templates...');

  // ── 1. Create Agent Types ──

  const ocrAgent = await basePrisma.agentType.upsert({
    where: { key: 'ocr_extraction' },
    update: {},
    create: {
      key: 'ocr_extraction',
      name: 'Invoice OCR',
      description: 'Extracts structured invoice data from PDF/image files using Claude Vision',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    },
  });

  const matchingAgent = await basePrisma.agentType.upsert({
    where: { key: 'product_matching' },
    update: {},
    create: {
      key: 'product_matching',
      name: 'Product Matching',
      description: 'Matches invoice line items to product catalog entries',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 2000,
    },
  });

  await basePrisma.agentType.upsert({
    where: { key: 'prompt_management' },
    update: {},
    create: {
      key: 'prompt_management',
      name: 'Prompt Management',
      description: 'Chat agent that helps tenants customize their AI prompt configurations',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
    },
  });

  // ── 2. Create OCR Prompt Template ──

  const existingOcrTemplate = await basePrisma.promptTemplate.findFirst({
    where: { agentTypeId: ocrAgent.id, version: 1 },
  });

  if (!existingOcrTemplate) {
    const ocrTemplate = await basePrisma.promptTemplate.create({
      data: {
        agentTypeId: ocrAgent.id,
        version: 1,
        isActive: true,
        preamble: `You are an invoice data extraction system. Analyze this supplier invoice and extract all data into the following JSON structure. Be precise with numbers and dates.

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
  "ocrConfidence": "number 0-1 — your confidence in the overall extraction accuracy"
}`,
        postamble: null,
      },
    });

    // Decompose the OCR rules into individual conditions
    const ocrConditions = [
      {
        orderIndex: 1,
        category: 'format',
        key: 'monetary_values',
        text: 'All monetary values should be numbers (not strings), ex-GST unless specified',
        isRequired: true,
      },
      {
        orderIndex: 2,
        category: 'format',
        key: 'date_format',
        text: 'Dates must be ISO 8601 format (YYYY-MM-DD)',
        isRequired: true,
      },
      {
        orderIndex: 3,
        category: 'rule',
        key: 'null_handling',
        text: 'If a value cannot be determined, use null',
        isRequired: true,
      },
      {
        orderIndex: 4,
        category: 'rule',
        key: 'pack_size',
        text: 'packSize: extract the pack/case size from the description or a dedicated size/weight column if present (e.g. "1 x ctn", "2 x ctns", "4 x ctns", "10kg bag", "12x2L", "25kg", "12L")',
        isRequired: false,
        validationKey: 'has_pack_size_lines',
        validationDesc: 'Checks whether the tenant has invoice lines with pack size data that depend on this rule',
      },
      {
        orderIndex: 5,
        category: 'rule',
        key: 'base_unit',
        text: 'baseUnit: infer the base selling unit — use "kg" for solid products and "L" for liquids (cleaning products, vinegar, oil, juice, sauces, beverages, etc.). NEVER use "each" or "unit" when the product has a clear weight or volume in its description or pack size. If the description contains volume indicators (LT, L, litre, ml) or the product is obviously a liquid, baseUnit MUST be "L".',
        isRequired: false,
        validationKey: 'has_base_unit_products',
        validationDesc: 'Checks whether the tenant has products with base unit data that depend on this rule',
      },
      {
        orderIndex: 6,
        category: 'rule',
        key: 'size_weight_column',
        text: `CRITICAL size/weight column rule: Some Australian wholesale invoices have a "Size (Kg)" or "Size" column AND a "Type" column (BAG, TUB, KILO, BOX). The Type column tells you HOW the price is quoted:
  A) Type = KILO or KG (per-kg pricing): The Price column is ALREADY per kilogram and the Ord/Qty is in kilograms. Do NOT use the Size column for packSize — set packSize to null. Set baseUnit="kg". The unitPrice IS the cost per kg.
    Example: "Organic Pumpkin Kernel" Size=5.000, Ord=10, Type=KILO, Price=$12.00, Total=$120.00 → packSize=null, baseUnit="kg", unitPrice=12, quantity=10 (price is per kg, 10kg ordered in 5kg bags)
    Example: "Aleppo Pepper Flakes" Size=2.000, Ord=2, Type=KILO, Price=$11.40, Total=$22.80 → packSize=null, baseUnit="kg", unitPrice=11.40, quantity=2
  B) Type = BAG, TUB, BOX, or similar (per-pack pricing): The Price is per pack/unit. Use the Size column for packSize to enable per-kg cost calculation. Set baseUnit="kg" (or "L" for liquids).
    Example: "Amaranth - Bulk" Size=25.000, Ord=1, Type=BAG, Price=$150.00 → packSize="25kg", baseUnit="kg", unitPrice=150, quantity=1
    Example: "Vinegar 20litre" Size=20.000, Ord=1, Type=TUB → packSize="20L", baseUnit="L"
    Example: "Pinenuts Chinese - Bulk" Size=12.500, Ord=1, Type=BAG, Price=$562.20 → packSize="12.5kg", baseUnit="kg", unitPrice=562.20, quantity=1
  IMPORTANT: baseUnit should always be "kg" (or "L" for liquids) — NEVER set baseUnit to BAG, TUB, BOX, KILO, etc. Those are packaging types, not selling units.
  If there is no Type column but there IS a Size/Weight column, assume per-pack pricing and use Size for packSize.`,
        isRequired: false,
      },
      {
        orderIndex: 7,
        category: 'rule',
        key: 'weight_based_pricing',
        text: `IMPORTANT weight-based pricing convention: Many Australian wholesale invoices use a "kg" or "L" prefix in the description to indicate the product is priced PER KILOGRAM or PER LITRE. For example:
  - "kg Dried Australian Green Apple Rings (1 x ctn)" with QTY=3 means 3 KILOGRAMS (not 3 cartons), priced per kg. Set baseUnit="kg". The "(1 x ctn)" is just packaging info.
  - "kg Dried Australian Mango (4 x ctns)" with QTY=28 means 28 KILOGRAMS delivered in 4 cartons. Set baseUnit="kg".
  When you see this pattern (description starting with "kg" or "L" prefix, or the QTY column header says "kg"):
  - quantity = the weight/volume (e.g. 3 kg, 28 kg)
  - unitPrice = price per kg or per litre
  - baseUnit = "kg" or "L"
  - packSize = the container info (e.g. "1 x ctn", "4 x ctns") — this is delivery packaging, NOT the unit of sale`,
        isRequired: false,
      },
      {
        orderIndex: 8,
        category: 'rule',
        key: 'gst_detection',
        text: "gstInclusive: true if line prices include GST (look for 'inc GST', 'GST inclusive', 'Tax Invoice' where line totals already include tax, or line totals that sum to the total without separate GST). false if GST is a separate charge added to the subtotal (look for a distinct GST line/row at the bottom)",
        isRequired: false,
        validationKey: 'has_gst_invoices',
        validationDesc: 'Checks whether the tenant has invoices with GST-inclusive pricing that depend on this rule',
      },
      {
        orderIndex: 9,
        category: 'rule',
        key: 'per_line_gst',
        text: `CRITICAL per-line GST detection: Many Australian invoices have a dedicated GST column showing the exact GST dollar amount per line item. When you see a GST column:
  1. Extract the GST amount for each line as gstAmount (e.g. 0.00, 10.79)
  2. If gstAmount is 0.00 or 0, set gstApplicable to false (this item is GST-free)
  3. If gstAmount > 0, set gstApplicable to true
  This is the most reliable way to determine per-line GST applicability — always prefer the actual GST amounts over category guessing.`,
        isRequired: false,
        validationKey: 'has_gst_invoices',
        validationDesc: 'Checks whether the tenant has invoices with per-line GST data',
      },
      {
        orderIndex: 10,
        category: 'rule',
        key: 'gst_validation',
        text: `GST validation: Cross-check your extraction by verifying:
  1. sum(lineTotal for all lines) should approximately equal subtotal (confirms line amounts are ex-GST, so gstInclusive = false)
  2. subtotal + total GST should approximately equal balance due / total (confirms GST is additional to subtotal)
  If these checks pass, you can be confident that gstInclusive = false and per-line GST amounts are accurate.`,
        isRequired: false,
      },
      {
        orderIndex: 11,
        category: 'rule',
        key: 'gst_applicable_fallback',
        text: 'gstApplicable (fallback when no per-line GST column): In Australia, most basic/unprocessed food (fresh fruit, vegetables, meat, bread, milk, eggs, flour, rice, pasta, dried fruit, nuts, oils, honey) is GST-free. Processed food, snacks, confectionery, soft drinks, alcohol, and non-food items attract 10% GST. Look for tax codes on the invoice (e.g. "T" = taxable, "*" = GST-free, "FRE" = free). If no per-line tax indicators exist, use product category knowledge to determine. Default to true if uncertain.',
        isRequired: false,
      },
      {
        orderIndex: 12,
        category: 'rule',
        key: 'gst_freight_only',
        text: 'gstOnFreightOnly: If the invoice has a GST amount but all line items appear to be GST-free food, AND there is a freight/delivery charge, then GST likely applies only to the freight. Set to true in this case. Also set to true if the GST amount exactly or approximately equals 10% of the freight amount. Default to false.',
        isRequired: false,
      },
      {
        orderIndex: 13,
        category: 'rule',
        key: 'ocr_confidence',
        text: 'ocrConfidence: 0.95+ for clear printed invoices, lower for handwritten or poor quality',
        isRequired: true,
      },
    ];

    for (const condition of ocrConditions) {
      await basePrisma.promptCondition.create({
        data: {
          promptTemplateId: ocrTemplate.id,
          orderIndex: condition.orderIndex,
          category: condition.category,
          key: condition.key,
          text: condition.text,
          isRequired: condition.isRequired || false,
          validationKey: condition.validationKey || null,
          validationDesc: condition.validationDesc || null,
        },
      });
    }

    console.log(`  Created OCR template v1 with ${ocrConditions.length} conditions`);
  } else {
    console.log('  OCR template v1 already exists, skipping');
  }

  // ── 3. Create Product Matching Prompt Template ──

  const existingMatchTemplate = await basePrisma.promptTemplate.findFirst({
    where: { agentTypeId: matchingAgent.id, version: 1 },
  });

  if (!existingMatchTemplate) {
    const matchTemplate = await basePrisma.promptTemplate.create({
      data: {
        agentTypeId: matchingAgent.id,
        version: 1,
        isActive: true,
        preamble: 'You are a product matching assistant for a retail/grocery store. Match each invoice line to products in the catalog.',
        postamble: `Reply with ONLY a JSON array, one entry per invoice line (in order):
[{"line": 1, "matches": [{"product": <catalog number>, "confidence": <0.0-1.0>, "reason": "<brief>"}]}]
Each "matches" array should be sorted by confidence (highest first).
Use an empty matches array [] if no catalog item is a reasonable match.`,
      },
    });

    const matchConditions = [
      {
        orderIndex: 1,
        category: 'rule',
        key: 'name_similarity',
        text: 'Product name similarity (ignore pack sizes, weights, and country of origin in the invoice description)',
      },
      {
        orderIndex: 2,
        category: 'rule',
        key: 'category_relevance',
        text: 'Category relevance',
      },
      {
        orderIndex: 3,
        category: 'example',
        key: 'match_example',
        text: 'A "Sunflower Kernels" invoice line should match "Sunflower Kernel" not "Pistachio Kernels"',
      },
      {
        orderIndex: 4,
        category: 'constraint',
        key: 'confidence_threshold',
        text: 'Only include candidates with confidence >= 0.6 (skip weak/irrelevant matches)',
        isRequired: true,
      },
    ];

    for (const condition of matchConditions) {
      await basePrisma.promptCondition.create({
        data: {
          promptTemplateId: matchTemplate.id,
          orderIndex: condition.orderIndex,
          category: condition.category,
          key: condition.key,
          text: condition.text,
          isRequired: condition.isRequired || false,
        },
      });
    }

    console.log(`  Created Matching template v1 with ${matchConditions.length} conditions`);
  } else {
    console.log('  Matching template v1 already exists, skipping');
  }

  console.log('Prompt seeding complete.');
}

seedPrompts()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => basePrisma.$disconnect());
