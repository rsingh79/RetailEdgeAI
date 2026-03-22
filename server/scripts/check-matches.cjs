const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();
(async () => {
  const lines = await p.invoiceLine.findMany({
    where: { description: { contains: 'Lime Slice', mode: 'insensitive' } },
    include: {
      matches: {
        include: { product: { select: { name: true } }, productVariant: { select: { size: true, sku: true } } }
      },
      invoice: { select: { invoiceNumber: true } }
    }
  });
  for (const l of lines) {
    console.log('Line:', l.description, '| Status:', l.status, '| Invoice:', l.invoice.invoiceNumber);
    for (const m of l.matches) {
      console.log('  Match:', m.product?.name, '| Variant:', m.productVariant?.size || 'none', '| Status:', m.status, '| Confidence:', m.confidence);
    }
    if (l.matches.length === 0) console.log('  (no matches)');
  }
  await p.$disconnect();
})();
