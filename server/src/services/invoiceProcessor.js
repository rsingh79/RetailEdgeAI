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

  // Pattern 1: "NxM{unit}" or "N x M{unit}" — e.g. "5 x 1kg", "12x2L", "2 x 3kg"
  const multiMatch = s.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|l|ml|each|pkt|unit|box)?/i);
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

  // Pattern 1b: "{unit} x N" — e.g. "Tray x30", "1g x 12Pkt"
  // When the trailing part has a count-unit (pkt, box, each, etc), treat the
  // rightmost number as a pure count of items — don't multiply by the tiny
  // weight prefix.  E.g. "1g x 12Pkt" → 12 (not 0.012).
  const reverseMultiMatch = s.match(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|each|pkt|unit|box)?\s*x\s*(\d+(?:\.\d+)?)\s*(pkt|box|each|unit|bag|tray|case)?/i);
  if (reverseMultiMatch && !multiMatch) {
    const size = parseFloat(reverseMultiMatch[1]);
    const unit = reverseMultiMatch[2] || '';
    const count = parseFloat(reverseMultiMatch[3]);
    const countUnit = (reverseMultiMatch[4] || '').toLowerCase();

    // If the right side is a count-based unit (pkt, box, each…), the total
    // is simply the count (e.g. "1g x 12Pkt" → 12 items).
    if (['pkt', 'box', 'each', 'unit', 'bag', 'tray', 'case'].includes(countUnit)) {
      if (count > 0) return count;
    }

    let total = count * size;
    if (unit === 'g') total = total / 1000;
    if (unit === 'ml') total = total / 1000;
    if (total > 0) return total;
  }

  // Pattern 2: Simple "N{unit}" — e.g. "7KG", "12.5kg", "500g", "5kg bag"
  const simpleMatch = s.match(/^(\d+(?:\.\d+)?)\s*(kg|g|l|ml)\b/i);
  if (simpleMatch) {
    let qty = parseFloat(simpleMatch[1]);
    const unit = simpleMatch[2].toLowerCase();
    if (unit === 'g') qty = qty / 1000;
    if (unit === 'ml') qty = qty / 1000;
    if (qty > 0) return qty;
  }

  // Pattern 3: Just a number — e.g. "12", "6.5"
  const numMatch = s.match(/^(\d+(?:\.\d+)?)\s*(box|pkt|each|unit|bag|tray|case)?$/i);
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
      await prisma.supplier.update({
        where: { id: supplierId },
        data: { gstInclusive: ocrResult.gstInclusive },
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
          const packQty = parsePackSizeQty(line.packSize);
          const tbu = totalBaseUnits(line.quantity, packQty);
          if (tbu && tbu > 0 && line.lineTotal) {
            return Math.round((line.lineTotal / tbu) * 100) / 100;
          }
          return line.unitPrice;
        })(),
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
  const gstToAllocate = (!gstInclusive && gst && gst > 0) ? gst : 0;
  // Freight: always allocate proportionately if > 0
  const freightToAllocate = (freight && freight > 0) ? freight : 0;

  if (gstToAllocate === 0 && freightToAllocate === 0) {
    // Nothing to allocate — recalculate baseUnitCost from lineTotal
    for (const line of lines) {
      const packQty = parsePackSizeQty(line.packSize);
      const tbu = totalBaseUnits(line.quantity, packQty);
      const buc = tbu && tbu > 0 && line.lineTotal
        ? Math.round((line.lineTotal / tbu) * 100) / 100
        : line.unitPrice;
      await prisma.invoiceLine.update({
        where: { id: line.id },
        data: { gstAlloc: 0, freightAlloc: 0, baseUnitCost: buc },
      });
    }
    return;
  }

  // Use subtotal as the basis; fall back to sum of lineTotals
  const basis = subtotal || lines.reduce((s, l) => s + (l.lineTotal || 0), 0);
  if (basis === 0) return;

  let gstRemaining = gstToAllocate;
  let freightRemaining = freightToAllocate;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const proportion = (line.lineTotal || 0) / basis;
    let lineGst, lineFreight;

    if (i === lines.length - 1) {
      // Last line gets the remainder (avoids rounding drift)
      lineGst = Math.round(gstRemaining * 100) / 100;
      lineFreight = Math.round(freightRemaining * 100) / 100;
    } else {
      lineGst = Math.round(gstToAllocate * proportion * 100) / 100;
      lineFreight = Math.round(freightToAllocate * proportion * 100) / 100;
    }

    gstRemaining -= lineGst;
    freightRemaining -= lineFreight;

    // Recalculate baseUnitCost as landed cost: (lineTotal + gstAlloc + freightAlloc) / totalBaseUnits
    const landedLineTotal = (line.lineTotal || 0) + lineGst + lineFreight;
    const packQty = parsePackSizeQty(line.packSize);
    const tbu = totalBaseUnits(line.quantity, packQty);
    const baseUnitCost = tbu && tbu > 0
      ? Math.round((landedLineTotal / tbu) * 100) / 100
      : Math.round(landedLineTotal * 100) / 100;

    await prisma.invoiceLine.update({
      where: { id: line.id },
      data: { gstAlloc: lineGst, freightAlloc: lineFreight, baseUnitCost },
    });
  }
}
