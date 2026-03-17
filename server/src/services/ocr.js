import { trackedClaudeCall } from './apiUsageTracker.js';

const EXTRACTION_PROMPT = `You are an invoice data extraction system. Analyze this supplier invoice and extract all data into the following JSON structure. Be precise with numbers and dates.

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
      "baseUnit": "string or null — e.g. 'kg', 'each', 'litre'"
    }
  ],
  "gstInclusive": "boolean — true if line item prices already INCLUDE GST, false if GST is charged separately at the invoice total",
  "ocrConfidence": "number 0-1 — your confidence in the overall extraction accuracy"
}

Rules:
- All monetary values should be numbers (not strings), ex-GST unless specified
- Dates must be ISO 8601 format (YYYY-MM-DD)
- If a value cannot be determined, use null
- packSize: extract the pack/case size from the description if present
- baseUnit: infer the base selling unit (kg, each, litre, etc.)
- gstInclusive: true if line prices include GST (look for 'inc GST', 'GST inclusive', 'Tax Invoice' where line totals already include tax, or line totals that sum to the total without separate GST). false if GST is a separate charge added to the subtotal (look for a distinct GST line/row at the bottom)
- ocrConfidence: 0.95+ for clear printed invoices, lower for handwritten or poor quality`;

/**
 * Extract structured invoice data from a file using Claude Vision API.
 * @param {Buffer} fileBuffer - The file contents
 * @param {string} mimeType - MIME type (application/pdf, image/jpeg, image/png, image/webp)
 * @returns {Promise<Object>} Extracted invoice data
 */
export async function extractInvoiceData(fileBuffer, mimeType, tenantId, userId) {
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
        content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }],
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

  return data;
}
