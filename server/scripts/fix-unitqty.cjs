const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();

(async () => {
  const variants = await p.productVariant.findMany({
    where: { size: { not: null } },
    include: { product: { select: { name: true, baseUnit: true } } },
  });

  let fixed = 0;
  let skipped = 0;
  for (const v of variants) {
    if (!v.size || !v.product.baseUnit) continue;
    const m = v.size.match(/^(\d+(?:\.\d+)?)\s*(g|gm|kg|ml|l)\b/i);
    if (!m) continue;
    const sizeVal = parseFloat(m[1]);
    const sizeUnit = m[2].toLowerCase().replace('gm', 'g');
    const baseUnit = v.product.baseUnit.toLowerCase();

    let expected = null;
    if (baseUnit === 'kg' && sizeUnit === 'g') expected = Math.round(sizeVal / 1000 * 10000) / 10000;
    else if (baseUnit === 'kg' && sizeUnit === 'kg') expected = sizeVal;
    else if (baseUnit === 'l' && sizeUnit === 'ml') expected = Math.round(sizeVal / 1000 * 10000) / 10000;
    else if (baseUnit === 'l' && sizeUnit === 'l') expected = sizeVal;
    else if (baseUnit === sizeUnit) expected = sizeVal;

    if (expected !== null && Math.abs(v.unitQty - expected) > 0.001) {
      await p.productVariant.update({
        where: { id: v.id },
        data: { unitQty: expected }
      });
      console.log(`FIXED: ${v.product.name} | size=${v.size} | ${v.unitQty} -> ${expected}`);
      fixed++;
    } else if (expected === null) {
      skipped++;
    }
  }
  console.log(`\nDone. Fixed ${fixed} variants, skipped ${skipped} (unrecognised unit combo).`);
  await p.$disconnect();
})();
