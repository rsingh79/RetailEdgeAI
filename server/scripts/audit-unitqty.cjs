const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();

(async () => {
  const variants = await p.productVariant.findMany({
    where: { size: { not: null } },
    include: { product: { select: { name: true, baseUnit: true } } },
    orderBy: [{ productId: 'asc' }, { size: 'asc' }]
  });

  let issues = 0;
  for (const v of variants) {
    if (!v.size || !v.product.baseUnit) continue;
    const m = v.size.match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l)/i);
    if (!m) continue;
    const sizeVal = parseFloat(m[1]);
    const sizeUnit = m[2].toLowerCase();
    const baseUnit = v.product.baseUnit.toLowerCase();
    let expected = null;
    if (baseUnit === 'kg' && sizeUnit === 'g') expected = sizeVal / 1000;
    if (baseUnit === 'kg' && sizeUnit === 'kg') expected = sizeVal;
    if (expected !== null && Math.abs(v.unitQty - expected) > 0.001) {
      console.log(`MISMATCH: ${v.product.name} | size=${v.size} | unitQty=${v.unitQty} | expected=${expected}`);
      issues++;
    }
  }
  console.log(`\nAudit complete. ${issues} mismatches found out of ${variants.length} variants.`);
  await p.$disconnect();
})();
