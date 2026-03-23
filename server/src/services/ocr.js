import { trackedClaudeCall } from './apiUsageTracker.js';
import { assemblePrompt } from './promptAssemblyEngine.js';

// Hardcoded fallback — used only if DB prompt system has no active template
const FALLBACK_EXTRACTION_PROMPT = `You are an invoice data extraction system. Analyze this supplier invoice and extract all data into the following JSON structure. Be precise with numbers and dates.

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
- packSize: extract the pack/case size from the description or a dedicated size/weight column if present (e.g. "1 x ctn", "2 x ctns", "4 x ctns", "10kg bag", "12x2L", "25kg", "12L")
- baseUnit: infer the base selling unit — use "kg" for solid products and "L" for liquids (cleaning products, vinegar, oil, juice, sauces, beverages, etc.). NEVER use "each" or "unit" when the product has a clear weight or volume in its description or pack size. If the description contains volume indicators (LT, L, litre, ml) or the product is obviously a liquid, baseUnit MUST be "L".
- CRITICAL size/weight column rule: Some Australian wholesale invoices have a "Size (Kg)" or "Size" column AND a "Type" column (BAG, TUB, KILO, BOX). The Type column tells you HOW the price is quoted:
  A) Type = KILO or KG (per-kg pricing): The Price column is ALREADY per kilogram and the Ord/Qty is in kilograms. Do NOT use the Size column for packSize — set packSize to null. Set baseUnit="kg". The unitPrice IS the cost per kg.
    Example: "Organic Pumpkin Kernel" Size=5.000, Ord=10, Type=KILO, Price=$12.00, Total=$120.00 → packSize=null, baseUnit="kg", unitPrice=12, quantity=10 (price is per kg, 10kg ordered in 5kg bags)
    Example: "Aleppo Pepper Flakes" Size=2.000, Ord=2, Type=KILO, Price=$11.40, Total=$22.80 → packSize=null, baseUnit="kg", unitPrice=11.40, quantity=2
  B) Type = BAG, TUB, BOX, or similar (per-pack pricing): The Price is per pack/unit. Use the Size column for packSize to enable per-kg cost calculation. Set baseUnit="kg" (or "L" for liquids).
    Example: "Amaranth - Bulk" Size=25.000, Ord=1, Type=BAG, Price=$150.00 → packSize="25kg", baseUnit="kg", unitPrice=150, quantity=1
    Example: "Vinegar 20litre" Size=20.000, Ord=1, Type=TUB → packSize="20L", baseUnit="L"
    Example: "Pinenuts Chinese - Bulk" Size=12.500, Ord=1, Type=BAG, Price=$562.20 → packSize="12.5kg", baseUnit="kg", unitPrice=562.20, quantity=1
  IMPORTANT: baseUnit should always be "kg" (or "L" for liquids) — NEVER set baseUnit to BAG, TUB, BOX, KILO, etc. Those are packaging types, not selling units.
  If there is no Type column but there IS a Size/Weight column, assume per-pack pricing and use Size for packSize.
- IMPORTANT weight-based pricing convention: Many Australian wholesale invoices use a "kg" or "L" prefix in the description to indicate the product is priced PER KILOGRAM or PER LITRE. For example:
  - "kg Dried Australian Green Apple Rings (1 x ctn)" with QTY=3 means 3 KILOGRAMS (not 3 cartons), priced per kg. Set baseUnit="kg". The "(1 x ctn)" is just packaging info.
  - "kg Dried Australian Mango (4 x ctns)" with QTY=28 means 28 KILOGRAMS delivered in 4 cartons. Set baseUnit="kg".
  When you see this pattern (description starting with "kg" or "L" prefix, or the QTY column header says "kg"):
  - quantity = the weight/volume (e.g. 3 kg, 28 kg)
  - unitPrice = price per kg or per litre
  - baseUnit = "kg" or "L"
  - packSize = the container info (e.g. "1 x ctn", "4 x ctns") — this is delivery packaging, NOT the unit of sale
- gstInclusive: true if line prices include GST (look for 'inc GST', 'GST inclusive', 'Tax Invoice' where line totals already include tax, or line totals that sum to the total without separate GST). false if GST is a separate charge added to the subtotal (look for a distinct GST line/row at the bottom)
- CRITICAL per-line GST detection: Many Australian invoices have a dedicated GST column showing the exact GST dollar amount per line item. When you see a GST column:
  1. Extract the GST amount for each line as gstAmount (e.g. 0.00, 10.79)
  2. If gstAmount is 0.00 or 0, set gstApplicable to false (this item is GST-free)
  3. If gstAmount > 0, set gstApplicable to true
  This is the most reliable way to determine per-line GST applicability — always prefer the actual GST amounts over category guessing.
- GST validation: Cross-check your extraction by verifying:
  1. sum(lineTotal for all lines) should approximately equal subtotal (confirms line amounts are ex-GST, so gstInclusive = false)
  2. subtotal + total GST should approximately equal balance due / total (confirms GST is additional to subtotal)
  If these checks pass, you can be confident that gstInclusive = false and per-line GST amounts are accurate.
- gstApplicable (fallback when no per-line GST column): In Australia, most basic/unprocessed food (fresh fruit, vegetables, meat, bread, milk, eggs, flour, rice, pasta, dried fruit, nuts, oils, honey) is GST-free. Processed food, snacks, confectionery, soft drinks, alcohol, and non-food items attract 10% GST. Look for tax codes on the invoice (e.g. "T" = taxable, "*" = GST-free, "FRE" = free). If no per-line tax indicators exist, use product category knowledge to determine. Default to true if uncertain.
- gstOnFreightOnly: If the invoice has a GST amount but all line items appear to be GST-free food, AND there is a freight/delivery charge, then GST likely applies only to the freight. Set to true in this case. Also set to true if the GST amount exactly or approximately equals 10% of the freight amount. Default to false.
- ocrConfidence: 0.95+ for clear printed invoices, lower for handwritten or poor quality`;

/**
 * Extract structured invoice data from a file using Claude Vision API.
 * @param {Buffer} fileBuffer - The file contents
 * @param {string} mimeType - MIME type (application/pdf, image/jpeg, image/png, image/webp)
 * @returns {Promise<Object>} Extracted invoice data
 */
export async function extractInvoiceData(fileBuffer, mimeType, tenantId, userId) {
  // Load tenant-specific prompt via assembly engine, fall back to hardcoded
  let promptText = FALLBACK_EXTRACTION_PROMPT;
  let promptMeta = null;
  try {
    const assembly = await assemblePrompt({
      agentRoleKey: 'ocr_extraction',
      tenantId,
    });
    if (assembly) {
      promptText = assembly.prompt;
      promptMeta = assembly.metadata;
    }
  } catch (err) {
    console.warn('Failed to assemble prompt, using fallback:', err.message);
  }

  const base64Data = fileBuffer.toString('base64');

  let contentBlock;
  if (mimeType === 'application/pdf') {
    contentBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64Data,
      },
    };
  } else {
    contentBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: base64Data,
      },
    };
  }

  const response = await trackedClaudeCall({
    tenantId,
    userId,
    endpoint: 'ocr',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 4096,
    messages: [
      {
        role: 'user',
        content: [contentBlock, { type: 'text', text: promptText }],
      },
    ],
    requestSummary: { type: 'invoice_ocr', mimeType, fileSize: fileBuffer.length },
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Parse the JSON response — strip any accidental markdown fencing
  const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  const data = JSON.parse(cleaned);

  // Validate required structure
  if (!data.lineItems || !Array.isArray(data.lineItems)) {
    throw new Error('OCR response missing lineItems array');
  }

  // Attach prompt metadata so the route can log it in the interaction signal
  data._promptMeta = promptMeta || null;

  return data;
}
