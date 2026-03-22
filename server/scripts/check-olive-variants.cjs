const { PrismaClient } = require('../src/generated/prisma');
const p = new PrismaClient();
(async () => {
  const product = await p.product.findFirst({
    where: { name: { contains: 'Olive Oil', mode: 'insensitive' } },
    include: { variants: { include: { store: { select: { name: true } } } } }
  });
  if (!product) { console.log('Not found'); await p.$disconnect(); return; }
  console.log('Product:', product.name, '| costPrice:', product.costPrice, '| sellingPrice:', product.sellingPrice);
  for (const v of product.variants) {
    console.log('  Variant:', v.size, '| sku:', v.sku, '| currentCost:', v.currentCost, '| salePrice:', v.salePrice, '| store:', v.store.name);
  }
  await p.$disconnect();
})();
