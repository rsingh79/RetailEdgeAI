const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findFirst({
    where: { supplierName: { contains: 'Mount Zero', mode: 'insensitive' } },
    include: { lines: { orderBy: { lineNumber: 'asc' } } }
  });
  if (!inv) { console.log('No Mount Zero invoice found'); await p.$disconnect(); return; }
  console.log('Invoice:', inv.invoiceNumber, '| gstInclusive:', inv.gstInclusive, '| gst:', inv.gst, '| freight:', inv.freight);
  for (const l of inv.lines) {
    console.log('\n  Line', l.lineNumber, ':', l.description);
    console.log('    unitPrice:', l.unitPrice, '| lineTotal:', l.lineTotal, '| baseUnitCost:', l.baseUnitCost);
    console.log('    gstAlloc:', l.gstAlloc, '| freightAlloc:', l.freightAlloc, '| gstApplicable:', l.gstApplicable);
    console.log('    baseUnit:', l.baseUnit, '| qty:', l.quantity);
    const GST_RATE = 0.10;
    const bucIncGst = l.gstApplicable && (inv.gstInclusive || (inv.gst > 0));
    const costExGst = bucIncGst ? Math.round((l.baseUnitCost / (1 + GST_RATE)) * 100) / 100 : l.baseUnitCost;
    const costIncGst = bucIncGst ? l.baseUnitCost : Math.round(l.baseUnitCost * (1 + GST_RATE) * 100) / 100;
    console.log('    -> costExGst:', costExGst, '| costIncGst:', costIncGst);
  }
  await p.$disconnect();
})();
