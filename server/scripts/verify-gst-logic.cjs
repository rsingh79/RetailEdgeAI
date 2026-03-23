const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();
(async () => {
  const GST_RATE = 0.10;
  const addGst = (v) => v != null ? Math.round(v * (1 + GST_RATE) * 100) / 100 : null;
  const removeGst = (v) => v != null ? Math.round((v / (1 + GST_RATE)) * 100) / 100 : null;

  // Test all invoices
  const invoices = await p.invoice.findMany({
    include: { lines: { orderBy: { lineNumber: 'asc' }, take: 2 } },
    take: 5
  });

  for (const inv of invoices) {
    console.log(`\n=== ${inv.supplierName} (${inv.invoiceNumber}) ===`);
    console.log(`  gstInclusive: ${inv.gstInclusive} | gst: ${inv.gst} | freight: ${inv.freight}`);

    for (const l of inv.lines) {
      const lineBucIncludesGst = l.gstApplicable && (inv.gstInclusive || (inv.gst > 0));
      const costExGst = !l.gstApplicable ? l.baseUnitCost
        : lineBucIncludesGst ? removeGst(l.baseUnitCost) : l.baseUnitCost;
      const costIncGst = !l.gstApplicable ? l.baseUnitCost
        : lineBucIncludesGst ? l.baseUnitCost : addGst(l.baseUnitCost);

      console.log(`  Line ${l.lineNumber}: ${l.description.substring(0, 40)}`);
      console.log(`    baseUnitCost: ${l.baseUnitCost} | gstApplicable: ${l.gstApplicable}`);
      console.log(`    bucIncludesGst: ${lineBucIncludesGst}`);
      console.log(`    -> Exc GST: $${costExGst?.toFixed(2)} | Inc GST: $${costIncGst?.toFixed(2)}`);
    }
  }
  await p.$disconnect();
})();
