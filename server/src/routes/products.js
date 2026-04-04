import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import XLSX from 'xlsx';
import { isShopifyFormat, groupShopifyRows, importShopifyProducts } from '../services/shopifyImport.js';
import { embedProduct } from '../services/ai/embeddingMaintenance.js';
import { normalizeSource } from '../services/sourceNormalizer.js';
import { logPriceChange } from '../services/priceChangeLogger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const importsDir = path.join(__dirname, '..', '..', 'uploads', 'imports');

if (!fs.existsSync(importsDir)) {
  fs.mkdirSync(importsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: importsDir,
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  },
});

const importUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV (.csv) files are accepted'));
    }
  },
});

const router = Router();

// ── Product CRUD ──────────────────────────────────────────────

// List all products for the tenant (optional ?source= filter) — excludes archived
router.get('/', async (req, res) => {
  try {
    const where = { archivedAt: null };
    if (req.query.source) {
      where.source = req.query.source;
    }
    if (req.query.store) {
      where.variants = { some: { store: { name: req.query.store } } };
    }
    const products = await req.prisma.product.findMany({
      where,
      include: {
        variants: { include: { store: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Return distinct sources and store names for filter dropdowns
    const [sourceRows, storeRows] = await Promise.all([
      req.prisma.product.findMany({
        where: { archivedAt: null },
        select: { source: true },
        distinct: ['source'],
        orderBy: { source: 'asc' },
      }),
      req.prisma.store.findMany({
        where: { productVariants: { some: { product: { archivedAt: null } } } },
        select: { name: true },
        distinct: ['name'],
        orderBy: { name: 'asc' },
      }),
    ]);

    res.json({
      products,
      sources: sourceRows.map((s) => s.source),
      stores: storeRows.map((s) => s.name),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Search products by name, barcode, or SKU (for match resolution) — excludes archived
router.get('/search', async (req, res) => {
  try {
    const { q, storeId } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const normalizedQ = q.replace(/-/g, ' ').trim();
    const hyphenatedQ = q.replace(/\s+/g, '-').toLowerCase();
    const words = normalizedQ.split(/\s+/).filter(Boolean);

    const where = {
      archivedAt: null,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { name: { contains: normalizedQ, mode: 'insensitive' } },
        { name: { contains: hyphenatedQ, mode: 'insensitive' } },
        { barcode: { contains: q, mode: 'insensitive' } },
        { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
        ...words.length > 1
          ? [{ AND: words.map((w) => ({ name: { contains: w, mode: 'insensitive' } })) }]
          : [],
      ],
    };

    const products = await req.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        category: true,
        barcode: true,
        baseUnit: true,
        costPrice: true,
        sellingPrice: true,
        source: true,
        variants: {
          where: storeId ? { storeId, isActive: true } : { isActive: true },
          include: { store: true },
          orderBy: { store: { name: 'asc' } },
        },
      },
      orderBy: { name: 'asc' },
      take: 20,
    });

    const seen = new Set();
    const deduped = products.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    res.json(deduped);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get a single product with all variants across stores
router.get('/:id', async (req, res) => {
  try {
    const product = await req.prisma.product.findFirst({
      where: { id: req.params.id, archivedAt: null },
      include: {
        variants: {
          include: { store: true },
          orderBy: { store: { name: 'asc' } },
        },
      },
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get price history for a product
router.get('/:id/price-history', async (req, res) => {
  try {
    const { startDate, endDate, priceType, limit, offset } = req.query;
    const take = Math.min(parseInt(limit) || 50, 200);
    const skip = parseInt(offset) || 0;

    // Verify product exists and belongs to tenant
    const product = await req.prisma.product.findFirst({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const where = { productId: req.params.id };
    if (priceType) where.priceType = priceType;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [entries, total] = await Promise.all([
      req.prisma.priceChangeLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      req.prisma.priceChangeLog.count({ where }),
    ]);

    // Batch-enrich invoice-sourced entries with invoice + supplier context
    const invoiceSources = new Set(['invoice_processing', 'invoice_correction']);
    const invoiceIds = [
      ...new Set(
        entries
          .filter((e) => invoiceSources.has(e.changeSource) && e.sourceRef)
          .map((e) => e.sourceRef)
      ),
    ];

    let invoiceLookup = {};
    if (invoiceIds.length > 0) {
      try {
        const invoices = await req.prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            supplier: { select: { id: true, name: true } },
          },
        });
        for (const inv of invoices) {
          invoiceLookup[inv.id] = {
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            supplierId: inv.supplier?.id || null,
            supplierName: inv.supplier?.name || null,
          };
        }
      } catch {
        // Invoice lookup failure should never break the price history response
      }
    }

    const enrichedEntries = entries.map((e) => ({
      ...e,
      invoiceContext:
        invoiceSources.has(e.changeSource) && e.sourceRef
          ? invoiceLookup[e.sourceRef] || null
          : null,
    }));

    res.json({ entries: enrichedEntries, total, limit: take, offset: skip });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create a new product
router.post('/', async (req, res) => {
  try {
    const { name, category, baseUnit, barcode, costPrice, sellingPrice, source } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Product name is required' });
    }
    if (!source || !source.trim()) {
      return res.status(400).json({ message: 'Source / system is required' });
    }
    const product = await req.prisma.product.create({
      data: {
        name: name.trim(),
        category: category?.trim() || null,
        baseUnit: baseUnit?.trim() || null,
        barcode: barcode?.trim() || null,
        costPrice: costPrice != null ? parseFloat(costPrice) : null,
        sellingPrice: sellingPrice != null ? parseFloat(sellingPrice) : null,
        source: normalizeSource(source.trim()),
      },
    });

    // Fire-and-forget price change logging (new product — oldPrice is null)
    if (product.costPrice != null) {
      logPriceChange(req.prisma, {
        tenantId: req.tenantId,
        productId: product.id,
        priceType: 'cost_price',
        oldPrice: null,
        newPrice: product.costPrice,
        changeSource: 'manual_edit',
        changedBy: req.user.userId,
      }).catch(() => {});
    }
    if (product.sellingPrice != null) {
      logPriceChange(req.prisma, {
        tenantId: req.tenantId,
        productId: product.id,
        priceType: 'selling_price',
        oldPrice: null,
        newPrice: product.sellingPrice,
        changeSource: 'manual_edit',
        changedBy: req.user.userId,
      }).catch(() => {});
    }

    // Fire-and-forget embedding for the new product
    embedProduct({
      id: product.id,
      name: product.name,
      category: product.category,
      baseUnit: product.baseUnit,
      tenantId: req.tenantId,
    }).catch(() => {});

    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Archive a single product (soft-delete — preserves variants and match history)
router.delete('/:id', async (req, res) => {
  try {
    const product = await req.prisma.product.findFirst({
      where: { id: req.params.id, archivedAt: null },
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    await req.prisma.product.update({
      where: { id: product.id },
      data: { archivedAt: new Date() },
    });

    res.json({ message: 'Product archived', id: product.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Bulk archive products (soft-delete)
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' });
    }

    const result = await req.prisma.product.updateMany({
      where: { id: { in: ids }, archivedAt: null },
      data: { archivedAt: new Date() },
    });

    res.json({ message: `${result.count} products archived`, count: result.count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Import: Upload + Preview ──────────────────────────────────

function parseWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// Upload file → extract headers + 10-row preview
router.post('/import/upload', importUpload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const { headers, rows } = parseWorkbook(req.file.path);

    if (headers.length === 0) {
      return res.status(422).json({ message: 'File appears to be empty or has no headers' });
    }

    // Detect Shopify format and build grouped preview
    const shopifyDetected = isShopifyFormat(headers);
    let shopifyPreview = null;

    if (shopifyDetected) {
      const { products, stats } = groupShopifyRows(rows);
      shopifyPreview = {
        stats,
        products: products.slice(0, 10).map((p) => ({
          name: p.name,
          category: p.category,
          baseUnit: p.baseUnit,
          variantCount: p.variants.length,
          variants: p.variants.map((v) => ({
            sku: v.sku,
            name: v.name,
            size: v.size,
            salePrice: v.salePrice,
            currentCost: v.currentCost,
          })),
        })),
      };
    }

    res.json({
      uploadId: req.file.filename,
      fileName: req.file.originalname,
      headers,
      preview: rows.slice(0, 10),
      totalRows: rows.length,
      shopifyDetected,
      shopifyPreview,
    });
  } catch (err) {
    res.status(422).json({ message: 'Failed to parse file: ' + err.message });
  }
});

// Apply mapping → bulk-create/upsert products — RETIRED
// Replaced by POST /api/v1/products/import/confirm which includes
// duplicate detection, confidence scoring, and human approval gate.
router.post('/import/confirm', async (req, res) => {
  console.log(
    '[Products] Legacy import confirm route called — ' +
    'retired in favour of POST /api/v1/products/import/confirm'
  );
  res.status(410).json({
    message:
      'This import endpoint has been retired. ' +
      'Please use POST /api/v1/products/import/confirm ' +
      'which includes duplicate detection, confidence ' +
      'scoring, and human approval gate.',
    newEndpoint: '/api/v1/products/import/confirm',
  });
});

// ── Import Templates ──────────────────────────────────────────

// List saved system names (for autocomplete)
router.get('/import/templates', async (req, res) => {
  try {
    const templates = await req.prisma.importTemplate.findMany({
      select: { id: true, systemName: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get mapping for a specific system name
router.get('/import/templates/:systemName', async (req, res) => {
  try {
    const template = await req.prisma.importTemplate.findFirst({
      where: { systemName: decodeURIComponent(req.params.systemName), tenantId: req.tenantId },
    });
    if (!template) return res.status(404).json({ message: 'Template not found' });
    res.json(template);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Save/update a column mapping
router.put('/import/templates/:systemName', async (req, res) => {
  try {
    const systemName = decodeURIComponent(req.params.systemName);
    const { mapping } = req.body;
    if (!mapping) return res.status(400).json({ message: 'mapping is required' });

    const existing = await req.prisma.importTemplate.findFirst({
      where: { systemName, tenantId: req.tenantId },
    });

    let template;
    if (existing) {
      template = await req.prisma.importTemplate.update({
        where: { id: existing.id },
        data: { mapping },
      });
    } else {
      template = await req.prisma.importTemplate.create({
        data: { systemName, mapping },
      });
    }

    res.json(template);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
