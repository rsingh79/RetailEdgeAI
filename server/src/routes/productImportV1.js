// server/src/routes/productImportV1.js
// Product Import Pipeline v1 — AI-assisted import with approval gate
// Full route implementation for the new DB-backed, approval-gated pipeline.

import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import XLSX from 'xlsx';
import {
  createImportJob,
  rowsToCanonical,
  runImportPipeline,
} from '../services/importJobService.js';
import {
  analyzeFile,
  chat,
  getSession,
  createSession,
  testRun,
} from '../services/agents/productImportAgent.js';
import { buildProductData, findOrCreateStore } from '../services/agents/pipeline/stages/writeLayer.js';
import { withTenantTransaction } from '../lib/prisma.js';
import { executeHook } from '../services/integrationHooks.js';
import { normalizeSource } from '../services/sourceNormalizer.js';

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

function buildReverseMapping(session) {
  const mapping = session.columnMapping || {};
  const reverse = {};
  for (const [sourceCol, info] of Object.entries(mapping)) {
    const target = typeof info === 'string' ? info : info?.target;
    if (target && target !== 'skip') {
      reverse[target] = sourceCol;
    }
  }
  if (session.variantColumns) {
    const vc = session.variantColumns;
    if (vc.skuColumn) reverse['variant_sku'] = vc.skuColumn;
    if (vc.priceColumn) reverse['variant_price'] = vc.priceColumn;
    if (vc.costColumn) reverse['variant_cost'] = vc.costColumn;
    if (vc.barcodeColumn) reverse['variant_barcode'] = vc.barcodeColumn;
    if (vc.sizeColumn) reverse['variant_size'] = vc.sizeColumn;
    if (vc.weightColumn) reverse['variant_weight'] = vc.weightColumn;
    if (vc.optionColumns) {
      vc.optionColumns.forEach((col, i) => {
        reverse[`variant_option_${i}`] = col;
      });
    }
  }
  return reverse;
}

const router = Router();

// ── ROUTE 1 — Health check ──

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    pipeline: 'product-import-v1',
    version: '2.0.0',
    tenant: req.tenantId,
  });
});

// ── ROUTE 2 — File upload and analysis ──

router.post('/import/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const { headers, rows } = parseWorkbook(req.file.path);

    if (headers.length === 0) {
      return res.status(422).json({ message: 'File appears to be empty or has no headers' });
    }

    const analysis = await analyzeFile({
      headers,
      sampleRows: rows.slice(0, 20),
      totalRows: rows.length,
      tenantId: req.tenantId,
      userId: req.user.id,
    });

    const systemName = req.body.systemName?.trim() || null;

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

    const importJob = await createImportJob(
      {
        tenantId: req.tenantId,
        userId: req.user.id,
        sourceType: 'CSV_UPLOAD',
        sourceName: systemName,
        fileName: req.file.originalname,
        totalRows: rows.length,
        dryRun: false,
      },
      req.prisma
    );

    // Save analysis results to ImportJob for session recovery
    await req.prisma.importJob.update({
      where: { id: importJob.id },
      data: {
        status: 'ANALYZING',
        columnMapping: analysis.columnMapping || null,
        patterns: analysis.patterns || null,
        gstDetected: analysis.gstDetected || false,
        gstRate: analysis.gstRate || null,
        hasVariants: analysis.hasVariants || false,
        groupByColumn: analysis.groupByColumn || null,
        variantColumns: analysis.variantColumns || null,
      },
    });

    const patternSummary = (analysis.patterns || [])
      .map(
        (p) =>
          `**Pattern ${p.id} (${p.rowCount} rows):** ${p.label} — ${p.description}`
      )
      .join('\n');

    const obsText = (analysis.observations || []).map((o) => `- ${o}`).join('\n');

    const agentReply = `I've analyzed your file **${req.file.originalname}** (${rows.length} rows, ${headers.length} columns).

I identified **${(analysis.patterns || []).length} patterns** in your data:

${patternSummary}

**Key observations:**
${obsText}

Please review the column mapping and patterns on the right. Let me know if anything needs adjusting.`;

    session.messages.push({ role: 'assistant', content: agentReply });

    res.json({
      importJobId: importJob.id,
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
      status: 'analyzing',
    });
  } catch (err) {
    console.error('[ProductImportV1] upload failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 3 — Chat refinement ──

router.post('/import/chat', async (req, res) => {
  const { uploadId, importJobId, message } = req.body;

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

    // If the agent confirmed the import is ready,
    // automatically run the test so the frontend
    // can show the Import button immediately
    let testResults = null;
    if (result.status === 'confirmed' && session.filePath) {
      try {
        console.log(
          '[ProductImportV1] Chat confirmed — auto-running test preview'
        );
        const { rows: allRows } = parseWorkbook(session.filePath);
        const testResult = testRun({ session, allRows });
        testResults = {
          summary: {
            total: allRows.length,
            successful: testResult.successful?.length || 0,
            warnings: testResult.warnings?.length || 0,
            failed: testResult.failed?.length || 0,
          },
          sampleSuccessful: testResult.successful?.slice(0, 5) || [],
          sampleWarnings: testResult.warnings?.slice(0, 5) || [],
          allFailed: testResult.failed || [],
          status: 'ready_to_import',
        };
      } catch (err) {
        console.warn('[ProductImportV1] Auto test-run failed:', err.message);
      }
    }

    res.json({
      reply: result.reply,
      patterns: result.patterns,
      columnMapping: result.columnMapping,
      status: result.status,
      testResults,
    });
  } catch (err) {
    console.error('[ProductImportV1] chat failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 4 — Test run preview ──

router.post('/import/test', async (req, res) => {
  const { uploadId, importJobId } = req.body;

  const session = getSession(uploadId);
  if (!session) {
    return res.status(404).json({ message: 'Session expired. Please re-upload.' });
  }

  try {
    const { rows } = parseWorkbook(session.filePath);
    const results = testRun({ session, allRows: rows });

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
    console.error('[ProductImportV1] test failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 5 — Confirm: run full pipeline ──

router.post('/import/confirm', async (req, res) => {
  const { uploadId, importJobId, dryRun, saveTemplate: saveTemplateOverride } = req.body;

  if (!importJobId) {
    return res.status(400).json({ message: 'importJobId is required' });
  }

  let session = getSession(uploadId);

  if (!session) {
    // Session expired — try to recover from ImportJob
    try {
      const job = await req.prisma.importJob.findFirst({
        where: { id: importJobId },
      });

      if (job && job.columnMapping) {
        session = {
          columnMapping: job.columnMapping,
          patterns: job.patterns || [],
          hasVariants: job.hasVariants || false,
          groupByColumn: job.groupByColumn || null,
          variantColumns: job.variantColumns || null,
          gstDetected: job.gstDetected || false,
          gstRate: job.gstRate || 0,
          systemName: job.sourceName || null,
          fileName: job.fileName || null,
          status: 'confirmed',
        };
        console.log(
          '[ProductImportV1] Session recovered from ImportJob:',
          importJobId
        );
      }
    } catch (recoveryErr) {
      console.error('[ProductImportV1] Session recovery failed:', recoveryErr.message);
    }

    if (!session) {
      return res.status(404).json({
        message:
          'Session expired and could not be recovered. ' +
          'Please re-upload the file to start a new import.',
        code: 'SESSION_EXPIRED',
      });
    }
  }

  try {
    const { rows } = parseWorkbook(session.filePath);
    const testResults = testRun({ session, allRows: rows });
    const canonicalProducts = rowsToCanonical(testResults.successful, session);

    const sourceName = session.systemName || req.body.systemName || 'Manual';

    // Look up prior completed imports from this source
    const priorJobs = await req.prisma.importJob.findMany({
      where: {
        sourceName: sourceName,
        status: 'COMPLETE',
        NOT: { id: importJobId },
      },
      select: { id: true },
    });
    const priorImportCount = priorJobs.length;
    const sourceTrusted = priorImportCount >= 3;

    // Count active products in catalog for this tenant
    const catalogProductCount = await req.prisma.product.count({
      where: { archivedAt: null },
    });

    const result = await runImportPipeline({
      importJobId,
      products: canonicalProducts,
      tenantId: req.tenantId,
      userId: req.user.id,
      prisma: req.prisma,
      dryRun: dryRun || false,
      sourceType: 'CSV_UPLOAD',
      sourceName,
      syncMode: 'FULL',
      stageData: {
        fileName: session.fileName,
        headers: session.headers,
        gstDetected: session.gstDetected,
        gstRate: session.gstRate,
        sourcePriorImports: priorImportCount,
        sourceTrusted: sourceTrusted,
        sourceResolutionMethod: 'explicit',
        autoApproveThreshold: 95,
        protectedCategories: ['services', 'subscriptions'],
        catalogProductCount,
      },
    });

    // Save template if requested
    const systemName = session.systemName || session.fileName;
    const saveTemplate = saveTemplateOverride !== false && systemName;
    if (saveTemplate) {
      try {
        const templateData = {
          headers: session.headers,
          columnMapping: session.columnMapping,
          reverseMapping: buildReverseMapping(session),
          gstDetected: session.gstDetected,
          gstRate: session.gstRate,
          patterns: session.patterns,
          transformRules: session.transformRules,
          hasVariants: session.hasVariants || false,
          groupByColumn: session.groupByColumn || null,
          variantColumns: session.variantColumns || null,
          observations: session.observations,
          createdFrom: session.fileName,
          version: 1,
        };

        const existing = await req.prisma.importTemplate.findFirst({
          where: { systemName, tenantId: req.tenantId },
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
        console.error('[ProductImportV1] Failed to save template:', e.message);
      }
    }

    // Clean up file
    try {
      fs.unlinkSync(session.filePath);
    } catch {
      /* ignore */
    }

    res.json(result);
  } catch (err) {
    console.error('[ProductImportV1] confirm failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 6 — Import job status ──

router.get('/import/status/:jobId', async (req, res) => {
  try {
    const job = await req.prisma.importJob.findFirst({
      where: { id: req.params.jobId },
    });
    if (!job) {
      return res.status(404).json({ message: 'Import job not found' });
    }
    res.json(job);
  } catch (err) {
    console.error('[ProductImportV1] status failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 7 — Import job history ──

router.get('/import/history', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const status = req.query.status || undefined;

    const where = status ? { status } : {};
    const [jobs, total] = await Promise.all([
      req.prisma.importJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      req.prisma.importJob.count({ where }),
    ]);

    res.json({ jobs, page, limit, total });
  } catch (err) {
    console.error('[ProductImportV1] history failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 8 — Approval queue summary (static — before :queueId) ──

router.get('/approval-queue/summary', async (req, res) => {
  try {
    const [
      pendingTotal,
      highCount,
      mediumCount,
      lowCount,
      noneCount,
      oldest,
    ] = await Promise.all([
      req.prisma.approvalQueueEntry.count({ where: { status: 'PENDING' } }),
      req.prisma.approvalQueueEntry.count({
        where: { status: 'PENDING', invoiceRiskLevel: 'HIGH' },
      }),
      req.prisma.approvalQueueEntry.count({
        where: { status: 'PENDING', invoiceRiskLevel: 'MEDIUM' },
      }),
      req.prisma.approvalQueueEntry.count({
        where: { status: 'PENDING', invoiceRiskLevel: 'LOW' },
      }),
      req.prisma.approvalQueueEntry.count({
        where: { status: 'PENDING', invoiceRiskLevel: 'NONE' },
      }),
      req.prisma.approvalQueueEntry.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    res.json({
      pendingTotal,
      byRisk: {
        HIGH: highCount,
        MEDIUM: mediumCount,
        LOW: lowCount,
        NONE: noneCount,
      },
      oldestPendingAt: oldest?.createdAt || null,
    });
  } catch (err) {
    console.error('[ProductImportV1] approval-queue summary failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 9 — Approval queue list (before :queueId) ──

router.get('/approval-queue', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const status = req.query.status || 'PENDING';
    const invoiceRisk = req.query.invoiceRisk || undefined;
    const importJobId = req.query.importJobId || undefined;

    const where = { status };
    if (invoiceRisk) where.invoiceRiskLevel = invoiceRisk;
    if (importJobId) where.importJobId = importJobId;

    const [entries, total] = await Promise.all([
      req.prisma.approvalQueueEntry.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      req.prisma.approvalQueueEntry.count({ where }),
    ]);

    res.json({ entries, page, limit, total });
  } catch (err) {
    console.error('[ProductImportV1] approval-queue list failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 9b — Bulk approve/reject queue entries ──

router.post('/approval-queue/bulk', async (req, res) => {
  try {
    const { action, notes, approveAll, queue_ids } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({ message: 'notes is required' });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'action must be approve or reject' });
    }

    const where = approveAll
      ? { status: 'PENDING' }
      : { id: { in: queue_ids || [] }, status: 'PENDING' };

    const entries = await req.prisma.approvalQueueEntry.findMany({ where });

    if (entries.length === 0) {
      return res.json({ processed: 0, succeeded: 0, failed: 0 });
    }

    let succeeded = 0;
    let failed = 0;
    const errors = [];

    for (const entry of entries) {
      try {
        if (action === 'approve') {
          const nd = entry.normalizedData || {};
          const newProduct = await withTenantTransaction(req.tenantId, async (tx) => {
            return tx.product.create({
              data: {
                tenantId: req.tenantId,
                name: nd.name || 'Unknown',
                category: nd.category || null,
                barcode: nd.barcode || null,
                baseUnit: nd.baseUnit || null,
                costPrice: nd.costPrice ?? null,
                sellingPrice: nd.price ?? nd.sellingPrice ?? null,
                source: normalizeSource(nd.sourceSystem),
                externalId: nd.externalId || null,
                productImportedThrough: nd.productImportedThrough || null,
                importId: entry.importJobId || null,
                approvalStatus: 'APPROVED',
                lastSyncedAt: new Date(),
                confidenceScore: entry.confidenceScore ?? null,
              },
            });
          });

          // Link any archived predecessors to this product
          try {
            const archivedPredecessors = await req.prisma.product.findMany({
              where: {
                archivedAt: { not: null },
                canonicalProductId: null,
                OR: [
                  { name: { equals: nd.name || '', mode: 'insensitive' } },
                  ...(nd.barcode ? [{ barcode: nd.barcode }] : []),
                ],
              },
              select: { id: true },
            });

            if (archivedPredecessors.length > 0) {
              for (const predecessor of archivedPredecessors) {
                await req.prisma.product.update({
                  where: { id: predecessor.id },
                  data: { canonicalProductId: newProduct.id },
                });
              }
            }
          } catch (linkErr) {
            console.warn(
              '[BulkApprove] Failed to link archived predecessors for ' +
              (nd.name || 'unknown') + ':', linkErr.message
            );
          }

          // Create a default variant if the product has pricing/SKU data
          try {
            if (nd.price || nd.sellingPrice || nd.sku) {
              const sourceSystem = nd.sourceSystem || 'Manual';
              const store = await findOrCreateStore(sourceSystem, req.tenantId, req.prisma);
              const sku = nd.sku || `${sourceSystem}-${newProduct.id}`;
              await req.prisma.productVariant.create({
                data: {
                  productId: newProduct.id,
                  storeId: store.id,
                  name: nd.name || 'Default',
                  sku,
                  barcode: nd.barcode || null,
                  salePrice: nd.price ? parseFloat(nd.price) : (nd.sellingPrice ? parseFloat(nd.sellingPrice) : 0),
                  currentCost: nd.costPrice ? parseFloat(nd.costPrice) : 0,
                  unitQty: 1,
                  isActive: true,
                },
              });
            }
          } catch (variantErr) {
            console.warn(
              `[BulkApprove] Failed to create default variant for product ${newProduct.id}:`,
              variantErr.message
            );
          }

          // Fire-and-forget integration hook
          executeHook(
            nd.sourceSystem,
            newProduct,
            nd.integrationMetadata,
            req.prisma,
          ).catch(() => {});
        }

        await req.prisma.approvalQueueEntry.update({
          where: { id: entry.id },
          data: {
            status: action === 'approve' ? 'APPROVED' : 'REJECTED',
            action: action === 'approve' ? 'APPROVE' : 'REJECT',
            actionedBy: req.user.id,
            actionedAt: new Date(),
            actionNotes: notes,
          },
        });
        succeeded++;
      } catch (err) {
        failed++;
        errors.push({ entryId: entry.id, error: err.message });
      }
    }

    // Update ImportJob counters
    const jobIds = [...new Set(entries.map(e => e.importJobId).filter(Boolean))];
    for (const jobId of jobIds) {
      const jobEntries = entries.filter(e => e.importJobId === jobId);
      if (action === 'approve') {
        await req.prisma.importJob.update({
          where: { id: jobId },
          data: {
            rowsCreated: { increment: jobEntries.length },
            rowsPendingApproval: { decrement: jobEntries.length },
          },
        }).catch(() => {});
      }
    }

    // Audit log
    await req.prisma.auditLog.create({
      data: {
        tenantId: req.tenantId,
        userId: req.user.id,
        action: action === 'approve' ? 'PRODUCT_IMPORTED' : 'PRODUCT_SKIPPED',
        entityType: 'ApprovalQueue',
        entityId: approveAll ? 'all' : (queue_ids || []).join(','),
        triggerSource: 'UI_ACTION',
        triggerFunction: 'ApprovalQueue.bulk',
        triggerContext: { action, approveAll, count: succeeded },
        newVal: { succeeded, failed, notes },
      },
    }).catch(() => {});

    return res.json({ processed: entries.length, succeeded, failed, errors });
  } catch (err) {
    console.error('[ProductImportV1] bulk action failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 10 — Approve a queue entry ──

router.post('/approval-queue/:queueId/approve', async (req, res) => {
  const { notes } = req.body;

  if (!notes || !notes.trim()) {
    return res.status(400).json({ message: 'notes are required' });
  }

  try {
    const entry = await req.prisma.approvalQueueEntry.findFirst({
      where: { id: req.params.queueId },
    });

    if (!entry) {
      return res.status(404).json({ message: 'Queue entry not found' });
    }
    if (entry.status !== 'PENDING') {
      return res.status(400).json({ message: `Entry already ${entry.status}` });
    }

    // Determine action from stored matchResult
    const matchAction =
      entry.matchResult?.action === 'UPDATE' ? 'UPDATE' : 'CREATE';
    const matchedProductId = entry.matchResult?.matchedProductId || null;

    // Build product data from normalizedData
    const nd = entry.normalizedData || {};
    const productData = {
      tenantId: req.tenantId,
      name: nd.name,
      category: nd.category || null,
      baseUnit: null,
      barcode: nd.barcode || null,
      costPrice: nd.costPrice ?? null,
      sellingPrice: nd.price ?? null,
      source: normalizeSource(nd.sourceSystem),
      externalId: nd.externalId || null,
      productImportedThrough: null,
      fingerprint: null,
      importId: entry.importJobId || null,
      approvalStatus: 'APPROVED',
      lastSyncedAt: new Date(),
      confidenceScore: entry.confidenceScore ?? null,
    };

    // Write product inside transaction
    const { writtenProduct, action } = await withTenantTransaction(
      req.tenantId,
      async (tx) => {
        let writtenProduct;
        let action;

        if (matchAction === 'UPDATE' && matchedProductId) {
          writtenProduct = await tx.product.update({
            where: { id: matchedProductId, tenantId: req.tenantId },
            data: productData,
          });
          action = 'UPDATED';
        } else {
          writtenProduct = await tx.product.create({
            data: productData,
          });
          action = 'CREATED';
        }

        return { writtenProduct, action };
      }
    );

    // Link any archived predecessors to this product and transfer variants
    try {
      const archivedPredecessors = await req.prisma.product.findMany({
        where: {
          archivedAt: { not: null },
          canonicalProductId: null,
          OR: [
            { name: { equals: nd.name || '', mode: 'insensitive' } },
            ...(nd.barcode ? [{ barcode: nd.barcode }] : []),
          ],
        },
        select: { id: true, name: true },
        include: { variants: true },
      });

      if (archivedPredecessors.length > 0) {
        for (const predecessor of archivedPredecessors) {
          await req.prisma.product.update({
            where: { id: predecessor.id },
            data: { canonicalProductId: writtenProduct.id },
          });

          if (predecessor.variants && predecessor.variants.length > 0) {
            await req.prisma.productVariant.updateMany({
              where: { productId: predecessor.id },
              data: { productId: writtenProduct.id },
            });
          }
        }

        console.log(
          `[ApprovalQueue] Linked ${archivedPredecessors.length} archived ` +
          `predecessor(s) to new product ${writtenProduct.id} (${nd.name})`
        );
      }
    } catch (err) {
      console.warn('[ApprovalQueue] Failed to link archived predecessors:', err.message);
    }

    // Create a default variant if the product has no variants and has pricing/SKU data
    try {
      const existingVariants = await req.prisma.productVariant.count({
        where: { productId: writtenProduct.id },
      });

      if (existingVariants === 0 && (nd.price || nd.sellingPrice || nd.sku)) {
        const sourceSystem = nd.sourceSystem || 'Manual';
        const store = await findOrCreateStore(sourceSystem, req.tenantId, req.prisma);
        const sku = nd.sku || `${sourceSystem}-${writtenProduct.id}`;
        await req.prisma.productVariant.create({
          data: {
            productId: writtenProduct.id,
            storeId: store.id,
            name: nd.name || 'Default',
            sku,
            barcode: nd.barcode || null,
            salePrice: nd.price ? parseFloat(nd.price) : (nd.sellingPrice ? parseFloat(nd.sellingPrice) : 0),
            currentCost: nd.costPrice ? parseFloat(nd.costPrice) : 0,
            unitQty: 1,
            isActive: true,
          },
        });
      }
    } catch (variantErr) {
      console.warn(
        `[ApprovalQueue] Failed to create default variant for product ${writtenProduct.id}:`,
        variantErr.message
      );
    }

    // Fire-and-forget integration hook (e.g. Shopify variant creation)
    const normalizedData = entry.normalizedData || {};
    executeHook(
      normalizedData.sourceSystem,
      writtenProduct,
      normalizedData.integrationMetadata,
      req.prisma,
    ).catch(() => {});

    // Update queue entry
    await req.prisma.approvalQueueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'APPROVED',
        action: 'APPROVE',
        actionedBy: req.user.id,
        actionedAt: new Date(),
        actionNotes: notes,
      },
    });

    // Audit log
    req.prisma.auditLog
      .create({
        data: {
          tenantId: req.tenantId,
          userId: req.user.id,
          action: action === 'CREATED' ? 'PRODUCT_IMPORTED' : 'PRODUCT_UPDATED',
          entityType: 'Product',
          entityId: writtenProduct.id,
          importJobId: entry.importJobId,
          triggerSource: 'UI_ACTION',
          triggerFunction: 'ApprovalQueue.approve',
          triggerContext: {
            queueEntryId: entry.id,
            approvedBy: req.user.id,
          },
          newVal: productData,
          metadata: { notes },
        },
      })
      .catch((err) =>
        console.error('[ProductImportV1] audit log failed:', err.message)
      );

    res.json({ status: 'approved', productId: writtenProduct.id });
  } catch (err) {
    console.error('[ProductImportV1] approve failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 11 — Reject a queue entry ──

router.post('/approval-queue/:queueId/reject', async (req, res) => {
  const { notes } = req.body;

  if (!notes || !notes.trim()) {
    return res.status(400).json({ message: 'notes are required' });
  }

  try {
    const entry = await req.prisma.approvalQueueEntry.findFirst({
      where: { id: req.params.queueId },
    });

    if (!entry) {
      return res.status(404).json({ message: 'Queue entry not found' });
    }
    if (entry.status !== 'PENDING') {
      return res.status(400).json({ message: `Entry already ${entry.status}` });
    }

    await req.prisma.approvalQueueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'REJECTED',
        action: 'REJECT',
        actionedBy: req.user.id,
        actionedAt: new Date(),
        actionNotes: notes,
      },
    });

    // Audit log (fire-and-forget)
    req.prisma.auditLog
      .create({
        data: {
          tenantId: req.tenantId,
          userId: req.user.id,
          action: 'PRODUCT_SKIPPED',
          entityType: 'ApprovalQueueEntry',
          entityId: entry.id,
          importJobId: entry.importJobId,
          triggerSource: 'UI_ACTION',
          triggerFunction: 'ApprovalQueue.reject',
          triggerContext: {
            queueEntryId: entry.id,
            rejectedBy: req.user.id,
          },
          metadata: { notes },
        },
      })
      .catch((err) =>
        console.error('[ProductImportV1] audit log failed:', err.message)
      );

    // Update ImportJob counters
    if (entry.importJobId) {
      req.prisma.importJob
        .update({
          where: { id: entry.importJobId },
          data: {
            rowsSkipped: { increment: 1 },
            rowsPendingApproval: { decrement: 1 },
          },
        })
        .catch((err) =>
          console.error('[ProductImportV1] importJob counter update failed:', err.message)
        );
    }

    res.json({ status: 'rejected' });
  } catch (err) {
    console.error('[ProductImportV1] reject failed:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── ROUTE 12 — Get single queue entry (dynamic — must be last) ──

router.get('/approval-queue/:queueId', async (req, res) => {
  try {
    const entry = await req.prisma.approvalQueueEntry.findFirst({
      where: { id: req.params.queueId },
    });
    if (!entry) {
      return res.status(404).json({ message: 'Queue entry not found' });
    }
    res.json(entry);
  } catch (err) {
    console.error('[ProductImportV1] get queue entry failed:', err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
