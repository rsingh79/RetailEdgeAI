const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();
(async () => {
  // Find and delete Soya Crisps matches from Lime Slice line
  const deleted = await p.invoiceLineMatch.deleteMany({
    where: {
      invoiceLine: { description: { contains: 'Lime Slice', mode: 'insensitive' } },
      product: { name: { contains: 'Soya Crisps', mode: 'insensitive' } }
    }
  });
  console.log('Deleted', deleted.count, 'Soya Crisps match records from Lime Slice line');
  await p.$disconnect();
})();
