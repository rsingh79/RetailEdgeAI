const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findFirst({
    where: { supplierName: { contains: 'Mount Zero', mode: 'insensitive' } },
    include: { lines: { orderBy: { lineNumber: 'asc' } } }
  });
  if (!inv) { console.log('No Mount Zero invoice found'); await p.$disconnect(); return; }

  console.log('BEFORE:');
  for (const l of inv.lines) {
    console.log('  Line', l.lineNumber, ':', l.description, '| baseUnitCost:', l.baseUnitCost, '| unitPrice:', l.unitPrice);
  }

  // Re-run allocation via importing the function indirectly
  // Since gst=0 and freight=null, allocation will set baseUnitCost = unitPrice for weight-based
  for (const l of inv.lines) {
    // Weight-based: baseUnit = 'L', so baseUnitCost = unitPrice when no allocations
    const buc = (l.quantity && l.quantity > 0 && l.lineTotal)
      ? Math.round((l.lineTotal / l.quantity) * 100) / 100
      : l.unitPrice;
    await p.invoiceLine.update({
      where: { id: l.id },
      data: { gstAlloc: 0, freightAlloc: 0, baseUnitCost: buc }
    });
  }

  const after = await p.invoice.findFirst({
    where: { id: inv.id },
    include: { lines: { orderBy: { lineNumber: 'asc' } } }
  });
  console.log('\nAFTER:');
  for (const l of after.lines) {
    console.log('  Line', l.lineNumber, ':', l.description, '| baseUnitCost:', l.baseUnitCost, '| unitPrice:', l.unitPrice);
  }
  await p.$disconnect();
})();
