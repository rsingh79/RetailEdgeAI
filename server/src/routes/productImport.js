/**
 * Smart Product Import routes — AI-powered file analysis and import.
 *
 * Uses the existing file upload infrastructure from products.js,
 * adds AI analysis, chat-based pattern refinement, and test-before-import.
 */

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import XLSX from 'xlsx';
import {
  analyzeFile,
  chat,
  testRun,
  applyImport,
  getSession,
  createSession,
} from '../services/agents/productImportAgent.js';
import { isShopifyFormat } from '../services/shopifyImport.js';

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

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, and .csv files are supported'));
    }
  },
});

function parseWorkbook(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

const router = Router();

// POST /api/product-import/upload — Upload + AI analysis
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const { headers, rows } = parseWorkbook(req.file.path);

    if (headers.length === 0) {
      return res.status(422).json({ message: 'File appears to be empty or has no headers' });
    }

    // Run AI analysis
    const analysis = await analyzeFile({
      headers,
      sampleRows: rows.slice(0, 20),
      totalRows: rows.length,
      tenantId: req.tenantId,
      userId: req.user.id,
    });

    // System name from the upload form (required for export round-trip)
    const systemName = req.body.systemName?.trim() || null;

    console.log('[SmartImport] Analysis result:', JSON.stringify({
      hasVariants: analysis.hasVariants,
      groupByColumn: analysis.groupByColumn,
      variantColumns: analysis.variantColumns,
      patternCount: analysis.patterns?.length,
      mappingKeys: Object.keys(analysis.columnMapping || {}),
    }));

    // Create session
    const session = createSession(req.file.filename, {
      uploadId: req.file.filename,
      fileName: req.file.originalname,
      filePath: req.file.path,
      headers,
      totalRows: rows.length,
      tenantId: req.tenantId,
      systemName,
      columnMapping: analysis.columnMapping,
      patterns: analysis.patterns,
      gstDetected: analysis.gstDetected,
      gstRate: analysis.gstRate,
      observations: analysis.observations,
      hasVariants: analysis.hasVariants || false,
      groupByColumn: analysis.groupByColumn || null,
      variantColumns: analysis.variantColumns || null,
      status: 'patterns_proposed',
    });

    // Build the initial agent message
    const patternSummary = (analysis.patterns || []).map((p) =>
      `**Pattern ${p.id} (${p.rowCount} rows):** ${p.label} — ${p.description}`
    ).join('\n');

    const obsText = (analysis.observations || []).map((o) => `- ${o}`).join('\n');

    const agentReply = `I've analyzed your file **${req.file.originalname}** (${rows.length} rows, ${headers.length} columns).

I identified **${(analysis.patterns || []).length} patterns** in your data:

${patternSummary}

**Key observations:**
${obsText}

Please review the column mapping and patterns on the right. Let me know if anything needs adjusting.`;

    session.messages.push({ role: 'assistant', content: agentReply });

    res.json({
      uploadId: req.file.filename,
      fileName: req.file.originalname,
      headers,
      totalRows: rows.length,
      preview: rows.slice(0, 10),
      analysis: {
        columnMapping: analysis.columnMapping,
        patterns: analysis.patterns,
        observations: analysis.observations,
        gstDetected: analysis.gstDetected,
        gstRate: analysis.gstRate,
      },
      agentReply,
      status: 'patterns_proposed',
    });
  } catch (err) {
    console.error('Smart import upload failed:', err);
    res.status(500).json({ message: 'Analysis failed: ' + err.message });
  }
});

// POST /api/product-import/chat — Chat with the agent to refine patterns
router.post('/chat', async (req, res) => {
  const { uploadId, message } = req.body;

  if (!uploadId || !message) {
    return res.status(400).json({ message: 'uploadId and message are required' });
  }

  const session = getSession(uploadId);
  if (!session) {
    return res.status(404).json({ message: 'Session expired or not found. Please re-upload.' });
  }

  try {
    const result = await chat({
      session,
      userMessage: message,
      tenantId: req.tenantId,
      userId: req.user.id,
    });

    res.json({
      reply: result.reply,
      patterns: result.patterns,
      columnMapping: result.columnMapping,
      status: result.status,
    });
  } catch (err) {
    console.error('Smart import chat failed:', err);
    res.status(500).json({ message: 'Chat failed: ' + err.message });
  }
});

// POST /api/product-import/test — Run deterministic test on all rows
router.post('/test', async (req, res) => {
  const { uploadId } = req.body;

  const session = getSession(uploadId);
  if (!session) {
    return res.status(404).json({ message: 'Session expired. Please re-upload.' });
  }

  try {
    const { rows } = parseWorkbook(session.filePath);

    const results = testRun({ session, allRows: rows });

    // Return summary + samples from each category
    res.json({
      summary: {
        total: results.totalRows,
        successful: results.successful.length,
        warnings: results.warnings.length,
        failed: results.failed.length,
      },
      sampleSuccessful: results.successful.slice(0, 5),
      sampleWarnings: results.warnings.slice(0, 5),
      allFailed: results.failed,
      status: session.status,
    });
  } catch (err) {
    console.error('Smart import test failed:', err);
    res.status(500).json({ message: 'Test run failed: ' + err.message });
  }
});

// POST /api/product-import/confirm — Apply the import
router.post('/confirm', async (req, res) => {
  const { uploadId, saveTemplate: saveTemplateOverride } = req.body;

  const session = getSession(uploadId);
  if (!session) {
    return res.status(404).json({ message: 'Session expired. Please re-upload.' });
  }

  try {
    const { rows } = parseWorkbook(session.filePath);
    const testResults = testRun({ session, allRows: rows });

    const systemName = session.systemName || session.fileName;

    const result = await applyImport({
      session,
      testResults,
      prisma: req.prisma,
      source: systemName,
      allRows: rows,
    });

    // Always save template when systemName exists — stores COMPLETE file blueprint for round-trip export
    const saveTemplate = saveTemplateOverride !== false && systemName;
    if (saveTemplate) {
      try {
        const templateData = {
          // ── File structure (for export reconstruction) ──
          headers: session.headers,                     // original column names in order
          columnMapping: session.columnMapping,          // source col → target field mapping
          reverseMapping: buildReverseMapping(session),  // target field → source col (for export)

          // ── Transform rules (with reverse for export) ──
          gstDetected: session.gstDetected,
          gstRate: session.gstRate,
          // Import: ÷ (1 + gstRate).  Export: × (1 + gstRate)
          patterns: session.patterns,
          transformRules: session.transformRules,

          // ── Variant structure ──
          hasVariants: session.hasVariants || false,
          groupByColumn: session.groupByColumn || null,
          variantColumns: session.variantColumns || null,

          // ── Metadata ──
          observations: session.observations,
          createdFrom: session.fileName,
          version: 1,
        };

        const existing = await req.prisma.importTemplate.findFirst({
          where: { systemName },
        });
        if (existing) {
          await req.prisma.importTemplate.update({
            where: { id: existing.id },
            data: { mapping: templateData },
          });
        } else {
          await req.prisma.importTemplate.create({
            data: { systemName, mapping: templateData },
          });
        }
        result.templateSaved = true;
        result.templateName = systemName;
      } catch (e) {
        console.error('Failed to save template:', e.message);
      }
    }

    // Clean up file
    try { fs.unlinkSync(session.filePath); } catch { /* ignore */ }

    res.json(result);
  } catch (err) {
    console.error('Smart import confirm failed:', err);
    res.status(500).json({ message: 'Import failed: ' + err.message });
  }
});

// GET /api/product-import/session/:uploadId — Get current session state
router.get('/session/:uploadId', (req, res) => {
  const session = getSession(req.params.uploadId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  res.json({
    uploadId: session.uploadId,
    fileName: session.fileName,
    totalRows: session.totalRows,
    headers: session.headers,
    columnMapping: session.columnMapping,
    patterns: session.patterns,
    observations: session.observations,
    gstDetected: session.gstDetected,
    gstRate: session.gstRate,
    messages: session.messages,
    status: session.status,
  });
});

// ── Export — reconstruct file in original format with updated prices ──

router.post('/export', async (req, res) => {
  const { systemName } = req.body;

  if (!systemName) {
    return res.status(400).json({ message: 'systemName is required' });
  }

  try {
    // Load template
    const template = await req.prisma.importTemplate.findFirst({
      where: { systemName },
    });
    if (!template) {
      return res.status(404).json({ message: `No import template found for "${systemName}"` });
    }

    const blueprint = template.mapping;
    const reverse = blueprint.reverseMapping;
    if (!reverse || !blueprint.headers) {
      return res.status(400).json({ message: 'Template missing export blueprint. Re-import to update.' });
    }

    // Load all products from this source
    const products = await req.prisma.product.findMany({
      where: { source: systemName },
      include: {
        variants: {
          include: { store: true },
          where: { isActive: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (products.length === 0) {
      return res.status(404).json({ message: `No products found with source "${systemName}"` });
    }

    const gstRate = blueprint.gstRate || 0.1;
    const addGst = blueprint.gstDetected || false;

    // Build rows in original column format
    const exportRows = [];

    for (const product of products) {
      if (blueprint.hasVariants && product.variants.length > 0) {
        // Parent/child format: one row per variant, grouped by product
        for (let vi = 0; vi < product.variants.length; vi++) {
          const variant = product.variants[vi];
          const row = buildExportRow(blueprint, reverse, product, variant, {
            addGst,
            gstRate,
            isFirstVariant: vi === 0,
          });
          exportRows.push(row);
        }
      } else {
        // Flat format: one row per product
        const row = buildExportRow(blueprint, reverse, product, null, {
          addGst,
          gstRate,
          isFirstVariant: true,
        });
        exportRows.push(row);
      }
    }

    // Build workbook
    const worksheet = XLSX.utils.json_to_sheet(exportRows, { header: blueprint.headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

    // Write to buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const fileName = `${systemName.replace(/[^a-zA-Z0-9]/g, '_')}_export_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Export failed:', err);
    res.status(500).json({ message: 'Export failed: ' + err.message });
  }
});

// ── Helpers ──

function buildReverseMapping(session) {
  const mapping = session.columnMapping || {};
  const reverse = {};

  for (const [sourceCol, info] of Object.entries(mapping)) {
    const target = typeof info === 'string' ? info : info?.target;
    if (target && target !== 'skip') {
      reverse[target] = sourceCol;
    }
  }

  // Add variant column reverse mappings
  if (session.variantColumns) {
    const vc = session.variantColumns;
    if (vc.skuColumn) reverse['variant_sku'] = vc.skuColumn;
    if (vc.priceColumn) reverse['variant_price'] = vc.priceColumn;
    if (vc.costColumn) reverse['variant_cost'] = vc.costColumn;
    if (vc.barcodeColumn) reverse['variant_barcode'] = vc.barcodeColumn;
    if (vc.sizeColumn) reverse['variant_size'] = vc.sizeColumn;
    if (vc.weightColumn) reverse['variant_weight'] = vc.weightColumn;
    if (vc.optionColumns) {
      vc.optionColumns.forEach((col, i) => { reverse[`variant_option_${i}`] = col; });
    }
  }

  return reverse;
}

function buildExportRow(blueprint, reverse, product, variant, opts = {}) {
  const row = {};
  const { addGst, gstRate, isFirstVariant } = opts;

  // Initialize all columns with empty strings to preserve structure
  for (const header of blueprint.headers) {
    row[header] = '';
  }

  // Map product fields to source columns
  if (reverse.name) {
    // If import split name+size, recombine for export
    let exportName = product.name;
    if (variant?.size) {
      exportName = `${product.name} ${variant.size}`;
    }
    row[reverse.name] = exportName;

    // For parent/child: only first row gets the full name in some formats
    if (blueprint.hasVariants && !isFirstVariant && blueprint.groupByColumn) {
      // Variant rows typically leave the name empty
      row[reverse.name] = '';
    }
  }

  if (reverse.category && product.category) row[reverse.category] = product.category;
  if (reverse.barcode && product.barcode) row[reverse.barcode] = product.barcode;
  if (reverse.baseUnit && product.baseUnit) row[reverse.baseUnit] = product.baseUnit;
  if (reverse.sku && variant?.sku) row[reverse.sku] = variant.sku;

  // Prices — reverse GST transform if original was GST-inclusive
  const costPrice = variant?.currentCost ?? product.costPrice;
  const sellPrice = variant?.salePrice ?? product.sellingPrice;

  if (reverse.costPrice && costPrice != null) {
    row[reverse.costPrice] = addGst ? Math.round(costPrice * (1 + gstRate) * 100) / 100 : costPrice;
  }
  if (reverse.sellingPrice && sellPrice != null) {
    row[reverse.sellingPrice] = addGst ? Math.round(sellPrice * (1 + gstRate) * 100) / 100 : sellPrice;
  }

  // Variant-specific columns
  if (variant) {
    if (reverse.variant_sku) row[reverse.variant_sku] = variant.sku || '';
    if (reverse.variant_price && sellPrice != null) {
      row[reverse.variant_price] = addGst ? Math.round(sellPrice * (1 + gstRate) * 100) / 100 : sellPrice;
    }
    if (reverse.variant_cost && costPrice != null) {
      row[reverse.variant_cost] = addGst ? Math.round(costPrice * (1 + gstRate) * 100) / 100 : costPrice;
    }
    if (reverse.variant_barcode) row[reverse.variant_barcode] = variant.barcode || '';
    if (reverse.variant_size) row[reverse.variant_size] = variant.size || '';
    if (reverse.variant_weight && variant.unitQty) row[reverse.variant_weight] = variant.unitQty * 1000; // kg→g
  }

  // GroupBy column — always set for all rows in the group
  if (blueprint.groupByColumn && product.name) {
    row[blueprint.groupByColumn] = product.name.toLowerCase().replace(/\s+/g, '-');
  }

  return row;
}

export default router;
