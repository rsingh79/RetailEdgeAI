import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import XLSX from 'xlsx';
import { isShopifyFormat, groupShopifyRows, importShopifyProducts } from '../services/shopifyImport.js';

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

// List all products for the tenant (optional ?source= filter)
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.source) {
      where.source = req.query.source;
    }
    const products = await req.prisma.product.findMany({
      where,
      include: {
        variants: { include: { store: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Also return distinct sources for the filter dropdown
    const sources = await req.prisma.product.findMany({
      where: { source: { not: null } },
      select: { source: true },
      distinct: ['source'],
      orderBy: { source: 'asc' },
    });

    res.json({ products, sources: sources.map((s) => s.source) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Search products by name, barcode, or SKU (for match resolution)
router.get('/search', async (req, res) => {
  try {
    const { q, storeId } = req.query;
    if (!q || q.length < 2) return res.json([]);

    // Normalize query: replace hyphens with spaces for Shopify-style handles
    const normalizedQ = q.replace(/-/g, ' ').trim();
    // Also create a hyphenated version of the query for searching hyphenated names
    const hyphenatedQ = q.replace(/\s+/g, '-').toLowerCase();
    // Individual words for broader matching
    const words = normalizedQ.split(/\s+/).filter(Boolean);

    const where = {
      OR: [
        // Direct search (handles both normal names and hyphenated names)
        { name: { contains: q, mode: 'insensitive' } },
        // Normalized (hyphens→spaces) search: finds "Organic Cacao Powder" from "organic-cacao-powder"
        { name: { contains: normalizedQ, mode: 'insensitive' } },
        // Hyphenated search: finds "organic-cacao-powder" from "organic cacao powder"
        { name: { contains: hyphenatedQ, mode: 'insensitive' } },
        // Barcode search
        { barcode: { contains: q, mode: 'insensitive' } },
        // SKU search
        { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
        // Word-level matching: each word matches part of the name
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

    // Deduplicate by product id (multiple OR clauses might match the same product)
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
      where: { id: req.params.id },
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

// Create a new product
router.post('/', async (req, res) => {
  try {
    const { name, category, baseUnit, barcode } = req.body;
    const product = await req.prisma.product.create({
      data: { name, category, baseUnit, barcode },
    });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete a single product (and its variants, matches, competitor monitors, alerts)
router.delete('/:id', async (req, res) => {
  try {
    const product = await req.prisma.product.findFirst({
      where: { id: req.params.id },
    });
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // Delete dependents first (variants, invoice line matches, competitor monitors, price alerts)
    await req.prisma.productVariant.deleteMany({ where: { productId: product.id } });
    await req.prisma.competitorMonitor.deleteMany({ where: { productId: product.id } });
    await req.prisma.priceAlert.deleteMany({ where: { productId: product.id } });

    await req.prisma.product.delete({ where: { id: product.id } });

    res.json({ message: 'Product deleted', id: product.id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Bulk delete products
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' });
    }

    // Verify all products belong to this tenant
    const products = await req.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    const foundIds = products.map((p) => p.id);
    if (foundIds.length === 0) {
      return res.status(404).json({ message: 'No matching products found' });
    }

    // Delete dependents first
    await req.prisma.productVariant.deleteMany({ where: { productId: { in: foundIds } } });
    await req.prisma.competitorMonitor.deleteMany({ where: { productId: { in: foundIds } } });
    await req.prisma.priceAlert.deleteMany({ where: { productId: { in: foundIds } } });

    const result = await req.prisma.product.deleteMany({
      where: { id: { in: foundIds } },
    });

    res.json({ message: `${result.count} products deleted`, count: result.count });
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

// Apply mapping → bulk-create/upsert products with optional pricing
router.post('/import/confirm', async (req, res) => {
  const { uploadId, systemName, mapping, saveTemplate, shopifyMode, deleteExisting } = req.body;

  // Shopify mode has different required fields
  if (shopifyMode) {
    if (!uploadId) {
      return res.status(400).json({ message: 'uploadId is required' });
    }
  } else if (!uploadId || !mapping || !mapping.name) {
    return res.status(400).json({ message: 'uploadId, mapping, and mapping.name are required' });
  }

  const filePath = path.join(importsDir, uploadId);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: 'Upload not found. Please re-upload the file.' });
  }

  try {
    // ── Shopify mode: variant-aware import ──
    if (shopifyMode) {
      const { rows } = parseWorkbook(filePath);
      const result = await importShopifyProducts(req.prisma, rows, { deleteExisting: !!deleteExisting });
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      return res.json(result);
    }

    // ── Generic mode (unchanged) ──
    const { rows } = parseWorkbook(filePath);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = String(row[mapping.name] || '').trim();
      if (!name) {
        skipped++;
        continue;
      }

      const productData = {
        name,
        category: mapping.category ? String(row[mapping.category] || '').trim() || null : null,
        barcode: mapping.barcode ? String(row[mapping.barcode] || '').trim() || null : null,
        baseUnit: mapping.baseUnit ? String(row[mapping.baseUnit] || '').trim() || null : null,
        source: systemName?.trim() || null,
      };

      // Parse price fields if mapped
      if (mapping.costPrice) {
        const raw = String(row[mapping.costPrice] || '').replace(/[^0-9.\-]/g, '');
        const val = parseFloat(raw);
        productData.costPrice = isNaN(val) ? null : val;
      }
      if (mapping.sellingPrice) {
        const raw = String(row[mapping.sellingPrice] || '').replace(/[^0-9.\-]/g, '');
        const val = parseFloat(raw);
        productData.sellingPrice = isNaN(val) ? null : val;
      }

      try {
        // Deduplicate: check barcode first, then fall back to exact name match
        let existing = null;

        if (productData.barcode) {
          existing = await req.prisma.product.findFirst({
            where: { barcode: productData.barcode },
          });
        }

        if (!existing) {
          const nameWhere = { name: { equals: name, mode: 'insensitive' } };
          if (productData.baseUnit) {
            nameWhere.baseUnit = { equals: productData.baseUnit, mode: 'insensitive' };
          }
          existing = await req.prisma.product.findFirst({ where: nameWhere });
        }

        if (existing) {
          await req.prisma.product.update({
            where: { id: existing.id },
            data: productData,
          });
          updated++;
        } else {
          await req.prisma.product.create({ data: productData });
          imported++;
        }
      } catch (rowErr) {
        errors.push({ row: i + 2, name, error: rowErr.message });
      }
    }

    // Save template if requested
    let templateSaved = false;
    if (saveTemplate && systemName) {
      try {
        const existing = await req.prisma.importTemplate.findFirst({
          where: { systemName },
        });
        if (existing) {
          await req.prisma.importTemplate.update({
            where: { id: existing.id },
            data: { mapping },
          });
        } else {
          await req.prisma.importTemplate.create({
            data: { systemName, mapping },
          });
        }
        templateSaved = true;
      } catch (tmplErr) {
        // Non-fatal — import still succeeds
        console.error('Failed to save template:', tmplErr.message);
      }
    }

    // Clean up uploaded file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }

    res.json({ imported, updated, skipped, errors, templateSaved });
  } catch (err) {
    res.status(500).json({ message: 'Import failed: ' + err.message });
  }
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
      where: { systemName: decodeURIComponent(req.params.systemName) },
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
      where: { systemName },
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
