/**
 * Detect weight-based pricing: when baseUnit is a weight/volume unit (kg, g, L, ml)
 * and the pack size is a pure container type (ctn, carton, box, etc.), the quantity
 * on the invoice IS the weight and the unitPrice is already per-baseUnit.
 *
 * Common Australian wholesale format:
 *   "kg Dried Australian Green Apple Rings (1 x ctn)" → qty=3 means 3 kg, price is per kg
 *   "kg Dried Australian Mango (4 x ctns)" → qty=28 means 28 kg, price is per kg
 *
 * In this case, baseUnitCost = unitPrice (not lineTotal / packQty).
 */
const WEIGHT_VOLUME_UNITS = new Set(['kg', 'g', 'l', 'ml', 'lt', 'ltr', 'litre', 'liter']);
const CONTAINER_ONLY_PATTERN = /^\d+\s*x\s*(ctn|ctns|carton|cartons|box|boxes|bag|bags|tray|trays|case|cases|pkt|pkts|each|unit|units)$/i;

function isWeightBasedPricing(baseUnit, packSize) {
  if (!baseUnit || !packSize) return false;
  const unit = baseUnit.trim().toLowerCase();
  if (!WEIGHT_VOLUME_UNITS.has(unit)) return false;
  // Pack size must be a pure container descriptor (e.g. "1 x ctn", "4 x ctns")
  // NOT a weight-based pack (e.g. "5kg", "12x2L")
  return CONTAINER_ONLY_PATTERN.test(packSize.trim());
}

/**
 * Calculate the total number of base units for a line item.
 *
 * The key challenge is that OCR sometimes sets qty = total base units (e.g.
 * Melbourne Nut: "Sunflower Kernels 12.5kg" → qty=12.5, packQty=12.5)
 * and sometimes qty = number of packs (e.g. "Flour Rye 5kg" → qty=4, packQty=5).
 *
 * Heuristic: if qty equals packQty, the OCR treated qty as total base units,
 * so totalBaseUnits = packQty. Otherwise qty is number of packs, so
 * totalBaseUnits = qty × packQty.
 */
function totalBaseUnits(quantity, packQty) {
  if (!packQty || packQty <= 0) return null;
  const qty = quantity || 1;
  return qty === packQty ? packQty : qty * packQty;
}

/**
 * Parse a pack size string into the total quantity in base units.
 * Examples:
 *   "7KG" → 7,  "12.5kg" → 12.5,  "5 x 1kg" → 5,  "2 x 3kg" → 6
 *   "Tray x30" → 30,  "12x2L" → 24,  "1g x 12Pkt" → 12 (count)
 *   "5kg bag" → 5,  "500g" → 0.5 (convert grams to kg)
 *   "1Box" → 1 (fallback)
 * Returns null if it cannot parse a meaningful quantity > 0.
 */
export function parsePackSizeQty(packSize) {
  if (!packSize || typeof packSize !== 'string') return null;

  const s = packSize.trim().toLowerCase();

  // Normalize litre variants: lt, ltr, litre, liter → l
  const normalized = s.replace(/\b(\d+(?:\.\d+)?)\s*(lt|ltr|litre|liter)s?\b/gi, (m, num) => `${num}l`);

  // Pattern 1: "NxM{unit}" or "N x M{unit}" — e.g. "5 x 1kg", "12x2L", "2 x 3kg", "4x12lt"
  const multiMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|each|pkt|unit|box)?/i);
  if (multiMatch) {
    const count = parseFloat(multiMatch[1]);
    const size = parseFloat(multiMatch[2]);
    const unit = multiMatch[3] || '';
    let total = count * size;
    // Convert grams to kg if the base unit is 'g'
    if (unit === 'g') total = total / 1000;
    // Convert ml to litres
    if (unit === 'ml') total = total / 1000;
    if (total > 0) return total;
  }

  // Pattern 1c: "N x {container}" — e.g. "1 x ctn", "2 x carton", "5 x bag"
  // When the pack size is a container type without weight info, the quantity
  // is just the count of containers.
  const containerMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*x\s*(ctn|carton|box|bag|tray|case|pkt|each|unit|cask)\b/i);
  if (containerMatch && !multiMatch) {
    const count = parseFloat(containerMatch[1]);
    if (count > 0) return count;
  }

  // Pattern 1b: "{unit} x N" — e.g. "Tray x30", "1g x 12Pkt"
  // When the trailing part has a count-unit (pkt, box, each, etc), treat the
  // rightmost number as a pure count of items — don't multiply by the tiny
  // weight prefix.  E.g. "1g x 12Pkt" → 12 (not 0.012).
  const reverseMultiMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|each|pkt|unit|box)?\s*x\s*(\d+(?:\.\d+)?)\s*(pkt|box|each|unit|bag|tray|case|cask)?/i);
  if (reverseMultiMatch && !multiMatch) {
    const size = parseFloat(reverseMultiMatch[1]);
    const unit = reverseMultiMatch[2] || '';
    const count = parseFloat(reverseMultiMatch[3]);
    const countUnit = (reverseMultiMatch[4] || '').toLowerCase();

    // If the right side is a count-based unit (pkt, box, each…), the total
    // is simply the count (e.g. "1g x 12Pkt" → 12 items).
    if (['pkt', 'box', 'each', 'unit', 'bag', 'tray', 'case', 'cask'].includes(countUnit)) {
      if (count > 0) return count;
    }

    let total = count * size;
    if (unit === 'g') total = total / 1000;
    if (unit === 'ml') total = total / 1000;
    if (total > 0) return total;
  }

  // Pattern 2: Simple "N{unit}" — e.g. "7KG", "12.5kg", "500g", "5kg bag", "12lt cask"
  const simpleMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/i);
  if (simpleMatch) {
    let qty = parseFloat(simpleMatch[1]);
    const unit = simpleMatch[2].toLowerCase();
    if (unit === 'g') qty = qty / 1000;
    if (unit === 'ml') qty = qty / 1000;
    if (qty > 0) return qty;
  }

  // Pattern 3: Just a number — e.g. "12", "6.5"
  const numMatch = normalized.match(/^(\d+(?:\.\d+)?)\s*(box|pkt|each|unit|bag|tray|case|cask)?$/i);
  if (numMatch) {
    const qty = parseFloat(numMatch[1]);
    if (qty > 0) return qty;
  }

  return null;
}

/**
 * Shared invoice processing logic — applies OCR results to an invoice record.
 * Used by both manual upload (routes/invoices.js) and Gmail auto-import (services/gmail.js).
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {string} invoiceId - ID of the invoice to update
 * @param {Object} ocrResult - Result from extractInvoiceData()
 * @returns {Object} Full invoice with supplier and lines
 */
export async function applyOcrToInvoice(prisma, invoiceId, ocrResult) {
  // ── Document type check: discard non-invoices ──
  const docType = ocrResult.documentType || 'invoice';
  if (docType !== 'invoice' && docType !== 'credit_note') {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'DISCARDED',
        supplierName: ocrResult.supplier?.name || null,
        ocrConfidence: ocrResult.ocrConfidence || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'DOCUMENT_DISCARDED',
        entityType: 'Invoice',
        entityId: invoiceId,
        newVal: {
          documentType: docType,
          supplierName: ocrResult.supplier?.name || null,
          invoiceNumber: ocrResult.invoiceNumber || null,
        },
        metadata: {
          reason: `Document classified as "${docType}" by OCR, not a valid invoice — discarded automatically`,
        },
      },
    });

    return { discarded: true, documentType: docType, supplierName: ocrResult.supplier?.name };
  }

  // Try to match supplier by name (case-insensitive)
  let supplierId = null;
  if (ocrResult.supplier?.name) {
    const existing = await prisma.supplier.findFirst({
      where: {
        name: { contains: ocrResult.supplier.name, mode: 'insensitive' },
      },
    });
    if (existing) {
      supplierId = existing.id;
    } else {
      const newSupplier = await prisma.supplier.create({
        data: {
          name: ocrResult.supplier.name,
          abn: ocrResult.supplier.abn || null,
        },
      });
      supplierId = newSupplier.id;
    }
  }

  // Determine GST treatment: use OCR detection, fall back to supplier default
  let gstInclusive = ocrResult.gstInclusive ?? false;
  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId } });
    if (supplier && ocrResult.gstInclusive == null) {
      // OCR didn't detect — use supplier's saved default
      gstInclusive = supplier.gstInclusive;
    } else if (ocrResult.gstInclusive != null) {
      // OCR detected — update supplier default for future invoices
      const supplierUpdate = { gstInclusive: ocrResult.gstInclusive };
      // Detect per-line GST pattern and save for future invoices
      const hasPerLineGst = ocrResult.lineItems?.some(l => l.gstAmount != null && l.gstAmount > 0);
      if (hasPerLineGst) supplierUpdate.hasPerLineGst = true;
      await prisma.supplier.update({
        where: { id: supplierId },
        data: supplierUpdate,
      });
    }
  }

  // Update invoice with extracted header data
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      supplierId,
      supplierName: ocrResult.supplier?.name || null,
      invoiceNumber: ocrResult.invoiceNumber || null,
      invoiceDate: ocrResult.invoiceDate ? new Date(ocrResult.invoiceDate) : null,
      dueDate: ocrResult.dueDate ? new Date(ocrResult.dueDate) : null,
      subtotal: ocrResult.subtotal ?? null,
      gst: ocrResult.gst ?? null,
      freight: ocrResult.freight ?? null,
      total: ocrResult.total ?? null,
      gstInclusive,
      ocrConfidence: ocrResult.ocrConfidence ?? null,
      status: 'READY',
    },
  });

  // Create line items (baseUnitCost set as ex-GST fallback; allocateInvoiceCosts recalculates as landed cost)
  if (ocrResult.lineItems?.length > 0) {
    await prisma.invoiceLine.createMany({
      data: ocrResult.lineItems.map((line) => ({
        invoiceId,
        lineNumber: line.lineNumber,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
        packSize: line.packSize || null,
        baseUnit: line.baseUnit || null,
        baseUnitCost: (() => {
          // Weight-based pricing: unitPrice is already per-kg/L, no pack conversion needed
          if (isWeightBasedPricing(line.baseUnit, line.packSize)) {
            return line.unitPrice;
          }
          const packQty = parsePackSizeQty(line.packSize);
          const tbu = totalBaseUnits(line.quantity, packQty);
          if (tbu && tbu > 0 && line.lineTotal) {
            return Math.round((line.lineTotal / tbu) * 100) / 100;
          }
          return line.unitPrice;
        })(),
        gstApplicable: line.gstApplicable ?? true,
        lineGstAmount: line.gstAmount ?? null,
        ocrConfidence: ocrResult.ocrConfidence ?? null,
        status: 'PENDING',
      })),
    });
  }

  // Distribute GST and freight across lines, recalculate baseUnitCost as landed cost
  await allocateInvoiceCosts(prisma, invoiceId);

  // Return the complete invoice with lines and supplier
  return prisma.invoice.findFirst({
    where: { id: invoiceId },
    include: {
      supplier: true,
      lines: { orderBy: { lineNumber: 'asc' } },
    },
  });
}

/**
 * Distribute GST and freight from the invoice header proportionately across line items.
 * Recalculates baseUnitCost as landed cost (including allocated GST + freight).
 *
 * - GST is only allocated when gstInclusive === false (line prices don't include GST)
 * - Freight is always allocated proportionately based on line $ value
 * - Rounding difference goes to the last line item
 *
 * @param {PrismaClient} prisma - Tenant-scoped Prisma client
 * @param {string} invoiceId - ID of the invoice
 */
export async function allocateInvoiceCosts(prisma, invoiceId) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId },
    include: { lines: { orderBy: { lineTotal: 'desc' } } },
  });
  if (!invoice || invoice.lines.length === 0) return;

  const { gst, freight, subtotal, gstInclusive } = invoice;
  const lines = invoice.lines;

  // GST: only allocate if line prices are ex-GST and there's a GST amount
  let gstToAllocate = (!gstInclusive && gst && gst > 0) ? gst : 0;
  // Freight: always allocate proportionately if > 0
  const freightToAllocate = (freight && freight > 0) ? freight : 0;

  // Check if per-line GST amounts are available from OCR (e.g. invoice has a GST column)
  const hasActualLineGst = lines.some(l => l.lineGstAmount != null);

  // Per-line GST: only distribute GST to lines where gstApplicable = true
  const gstApplicableLines = lines.filter((l) => l.gstApplicable);
  const gstBasis = gstApplicableLines.reduce((s, l) => s + (l.lineTotal || 0), 0);
  if (gstBasis === 0 && !hasActualLineGst) gstToAllocate = 0; // No applicable lines → GST is on freight/other

  if (gstToAllocate === 0 && freightToAllocate === 0 && !hasActualLineGst) {
    // Nothing to allocate — recalculate baseUnitCost from lineTotal
    for (const line of lines) {
      let buc;
      if (isWeightBasedPricing(line.baseUnit, line.packSize)) {
        buc = line.unitPrice;
      } else {
        const packQty = parsePackSizeQty(line.packSize);
        const tbu = totalBaseUnits(line.quantity, packQty);
        buc = tbu && tbu > 0 && line.lineTotal
          ? Math.round((line.lineTotal / tbu) * 100) / 100
          : line.unitPrice;
      }
      await prisma.invoiceLine.update({
        where: { id: line.id },
        data: { gstAlloc: 0, freightAlloc: 0, baseUnitCost: buc },
      });
    }
    return;
  }

  // Freight basis: proportional across ALL lines by value
  const freightBasis = subtotal || lines.reduce((s, l) => s + (l.lineTotal || 0), 0);

  let gstRemaining = gstToAllocate;
  let freightRemaining = freightToAllocate;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lineGst, lineFreight;

    if (hasActualLineGst) {
      // Use actual per-line GST amounts from the invoice — most accurate
      lineGst = line.lineGstAmount ?? 0;
    } else if (!line.gstApplicable || gstToAllocate === 0) {
      // Proportional mode: non-applicable lines get 0
      lineGst = 0;
    } else {
      // Proportional mode: distribute invoice-level GST across applicable lines
      const lastApplicable = gstApplicableLines[gstApplicableLines.length - 1];
      if (line.id === lastApplicable.id) {
        lineGst = Math.round(gstRemaining * 100) / 100;
      } else {
        lineGst = Math.round(gstToAllocate * ((line.lineTotal || 0) / gstBasis) * 100) / 100;
      }
      gstRemaining -= lineGst;
    }

    // Freight: allocate proportionally across all lines
    if (freightToAllocate === 0 || freightBasis === 0) {
      lineFreight = 0;
    } else if (i === lines.length - 1) {
      lineFreight = Math.round(freightRemaining * 100) / 100;
    } else {
      lineFreight = Math.round(freightToAllocate * ((line.lineTotal || 0) / freightBasis) * 100) / 100;
    }
    freightRemaining -= lineFreight;

    // When per-line GST is available, override gstApplicable based on actual amount
    const effectiveGstApplicable = hasActualLineGst ? (lineGst > 0) : line.gstApplicable;

    // Recalculate baseUnitCost as landed cost
    const landedLineTotal = (line.lineTotal || 0) + lineGst + lineFreight;
    let baseUnitCost;

    if (isWeightBasedPricing(line.baseUnit, line.packSize)) {
      baseUnitCost = line.quantity && line.quantity > 0
        ? Math.round((landedLineTotal / line.quantity) * 100) / 100
        : line.unitPrice;
    } else {
      const packQty = parsePackSizeQty(line.packSize);
      const tbu = totalBaseUnits(line.quantity, packQty);
      baseUnitCost = tbu && tbu > 0
        ? Math.round((landedLineTotal / tbu) * 100) / 100
        : (line.quantity && line.quantity > 0
          ? Math.round((landedLineTotal / line.quantity) * 100) / 100
          : line.unitPrice || Math.round(landedLineTotal * 100) / 100);
    }

    await prisma.invoiceLine.update({
      where: { id: line.id },
      data: { gstAlloc: lineGst, gstApplicable: effectiveGstApplicable, freightAlloc: lineFreight, baseUnitCost },
    });
  }
}
