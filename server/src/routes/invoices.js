import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { requireRole } from '../middleware/auth.js';
import { checkApiLimit } from '../middleware/apiLimiter.js';
import { extractInvoiceData } from '../services/ocr.js';
import { applyOcrToInvoice, allocateInvoiceCosts } from '../services/invoiceProcessor.js';
import { matchInvoiceLines, createMatchRecords } from '../services/matching.js';
import { pushPriceUpdate } from '../services/shopify.js';
import { decrypt } from '../lib/encryption.js';
import basePrisma from '../lib/prisma.js';
import {
  recordPromptMeta,
  recordOutcome,
  recordSatisfaction,
  recordUsage,
  recordHumanOverride,
  recordEscalation,
  recordImplicitSatisfaction,
  emitSignal,
} from '../services/signalCollector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, JPG, PNG, and WEBP files are accepted'));
    }
  },
});

const router = Router();

// Helper: fetch full invoice with nested matches
async function fetchFullInvoice(prisma, id) {
  return prisma.invoice.findFirst({
    where: { id },
    include: {
      supplier: true,
      lines: {
        orderBy: { lineNumber: 'asc' },
        include: {
          matches: {
            include: {
              productVariant: { include: { product: true, store: true } },
              product: { include: { variants: { where: { isActive: true }, select: { id: true, size: true, sku: true, name: true } } } }, // for variant-less (product-level) matches — include variants for size display
            },
          },
        },
      },
    },
  });
}

// ── Sidebar counts ───────────────────────────────────────────

// Return badge counts for sidebar (total invoices + needing review)
router.get('/counts', async (req, res) => {
  try {
    const [totalInvoices, reviewInvoices] = await Promise.all([
      req.prisma.invoice.count({ where: { archivedAt: null } }),
      req.prisma.invoice.count({
        where: { archivedAt: null, status: { in: ['READY', 'IN_REVIEW'] } },
      }),
    ]);
    res.json({ totalInvoices, reviewInvoices });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Dashboard stats ──────────────────────────────────────────

router.get('/dashboard-stats', async (req, res) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      pendingInvoices,
      awaitingApproval,
      costChangesToday,
      costChangeValues,
      pipelineUpload,
      pipelineReview,
      pipelineExport,
    ] = await Promise.all([
      // Invoices needing review (READY or IN_REVIEW)
      req.prisma.invoice.count({
        where: { archivedAt: null, status: { in: ['READY', 'IN_REVIEW'] } },
      }),
      // Invoices with confirmed matches awaiting final approval
      req.prisma.invoice.count({
        where: {
          archivedAt: null,
          status: 'IN_REVIEW',
          lines: {
            some: {
              matches: { some: { status: 'CONFIRMED' } },
            },
          },
        },
      }),
      // Matches approved/confirmed today
      req.prisma.invoiceLineMatch.count({
        where: {
          status: { in: ['CONFIRMED', 'APPROVED'] },
          updatedAt: { gte: todayStart },
        },
      }),
      // Sum of cost change values for awaiting-approval matches
      req.prisma.invoiceLineMatch.aggregate({
        _sum: { newCost: true },
        where: {
          status: 'CONFIRMED',
          newCost: { not: null },
        },
      }),
      // Pipeline stage counts
      req.prisma.invoice.count({ where: { archivedAt: null, status: 'PROCESSING' } }),
      req.prisma.invoice.count({ where: { archivedAt: null, status: { in: ['READY', 'IN_REVIEW'] } } }),
      req.prisma.invoice.count({ where: { archivedAt: null, status: 'APPROVED' } }),
    ]);

    // Margin alerts: matches where newCost increased > 10% over previousCost
    const marginAlerts = await req.prisma.invoiceLineMatch.count({
      where: {
        status: { in: ['CONFIRMED', 'APPROVED'] },
        previousCost: { not: null, gt: 0 },
        newCost: { not: null },
      },
    });

    // Filter in JS for > 10% cost increase (Prisma can't compare two columns)
    let marginAlertCount = 0;
    if (marginAlerts > 0) {
      const alertMatches = await req.prisma.invoiceLineMatch.findMany({
        where: {
          status: { in: ['CONFIRMED', 'APPROVED'] },
          previousCost: { not: null, gt: 0 },
          newCost: { not: null },
        },
        select: { previousCost: true, newCost: true },
      });
      marginAlertCount = alertMatches.filter(
        (m) => m.newCost > m.previousCost * 1.10
      ).length;
    }

    // Average cost increase % for today's changes
    let avgIncrease = 0;
    if (costChangesToday > 0) {
      const todayMatches = await req.prisma.invoiceLineMatch.findMany({
        where: {
          status: { in: ['CONFIRMED', 'APPROVED'] },
          updatedAt: { gte: todayStart },
          previousCost: { not: null, gt: 0 },
          newCost: { not: null },
        },
        select: { previousCost: true, newCost: true },
      });
      if (todayMatches.length > 0) {
        const totalPct = todayMatches.reduce((sum, m) => {
          return sum + ((m.newCost - m.previousCost) / m.previousCost) * 100;
        }, 0);
        avgIncrease = Math.round((totalPct / todayMatches.length) * 10) / 10;
      }
    }

    res.json({
      pendingInvoices,
      awaitingApproval,
      awaitingApprovalValue: Math.round((costChangeValues._sum.newCost || 0) * 100) / 100,
      marginAlerts: marginAlertCount,
      costChangesToday,
      avgCostIncrease: avgIncrease,
      pipeline: {
        upload: pipelineUpload,
        review: pipelineReview,
        export: pipelineExport,
      },
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Invoices requiring action (for dashboard) ────────────────

router.get('/action-invoices', async (req, res) => {
  try {
    const invoices = await req.prisma.invoice.findMany({
      where: { archivedAt: null, status: { in: ['READY', 'IN_REVIEW', 'APPROVED'] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { _count: { select: { lines: true } } },
    });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── List / Detail ─────────────────────────────────────────────

// List all invoices for the tenant (excludes archived)
router.get('/', async (req, res) => {
  try {
    const invoices = await req.prisma.invoice.findMany({
      where: { archivedAt: null },
      include: { supplier: true, lines: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Cross-Invoice Export ─────────────────────────────────────

// Get invoices that have confirmed/approved matches (for export invoice selector)
router.get('/exportable', async (req, res) => {
  try {
    const invoices = await req.prisma.invoice.findMany({
      where: {
        archivedAt: null,
        status: { in: ['IN_REVIEW', 'APPROVED', 'EXPORTED'] },
      },
      include: {
        supplier: true,
        lines: {
          include: {
            matches: {
              where: {
                status: { in: ['CONFIRMED', 'APPROVED', 'EXPORTED'] },
                // Only count matches linked to active (non-archived) products
                OR: [
                  { productVariant: { product: { archivedAt: null } } },
                  { productVariantId: null, product: { archivedAt: null } },
                ],
              },
              select: {
                id: true,
                exportedAt: true,
                previousCost: true,
                newCost: true,
                currentPrice: true,
                suggestedPrice: true,
                approvedPrice: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Only include invoices that have at least one confirmed match
    const result = invoices
      .map((inv) => {
        const totalCount = inv.lines.length;
        const confirmedCount = inv.lines.filter((l) => l.matches.length > 0).length;

        // Compute per-invoice cost/price change stats
        const allMatches = inv.lines.flatMap((l) => l.matches);
        const matchedCount = allMatches.length;
        let costChangedCount = 0, costUnchangedCount = 0;
        let priceChangedCount = 0, priceUnchangedCount = 0;
        for (const m of allMatches) {
          const costChanged = m.newCost != null &&
            (m.previousCost == null || Math.abs(m.newCost - m.previousCost) >= 0.005);
          if (costChanged) costChangedCount++; else costUnchangedCount++;
          const newPrice = m.approvedPrice ?? m.suggestedPrice ?? m.currentPrice;
          const priceChanged = newPrice != null &&
            (m.currentPrice == null || Math.abs(newPrice - m.currentPrice) >= 0.005);
          if (priceChanged) priceChangedCount++; else priceUnchangedCount++;
        }

        const exportDates = inv.lines
          .flatMap((l) => l.matches.map((m) => m.exportedAt))
          .filter(Boolean);
        const lastExportedAt = exportDates.length > 0
          ? new Date(Math.max(...exportDates.map((d) => new Date(d).getTime())))
          : null;
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          supplierName: inv.supplierName || inv.supplier?.name || 'Unknown',
          invoiceDate: inv.invoiceDate,
          status: inv.status,
          confirmedCount,
          totalCount,
          lastExportedAt,
          matchedCount,
          costChangedCount,
          costUnchangedCount,
          priceChangedCount,
          priceUnchangedCount,
        };
      })
      .filter((inv) => inv.confirmedCount > 0);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get export items from selected invoices
router.get('/export/items', async (req, res) => {
  try {
    const { invoiceIds, includeOtherExported } = req.query;
    if (!invoiceIds) return res.status(400).json({ message: 'invoiceIds query parameter required' });

    const ids = invoiceIds.split(',').filter(Boolean);

    const whereClause = {
      status: { in: ['CONFIRMED', 'APPROVED', 'EXPORTED'] },
    };

    if (includeOtherExported === 'true') {
      // Items from selected invoices + exported items from ANY other invoice
      whereClause.OR = [
        { invoiceLine: { invoiceId: { in: ids } } },
        { exportedAt: { not: null }, invoiceLine: { invoiceId: { notIn: ids } } },
      ];
    } else {
      // Only items from selected invoices (both exported and non-exported)
      whereClause.invoiceLine = { invoiceId: { in: ids } };
    }

    // Only fetch matches linked to active (non-archived) products
    // Uses AND so it composes cleanly with the existing OR invoice filter
    whereClause.AND = [
      {
        OR: [
          { productVariant: { product: { archivedAt: null } } },
          { productVariantId: null, product: { archivedAt: null } },
        ],
      },
    ];

    const matches = await req.prisma.invoiceLineMatch.findMany({
      where: whereClause,
      include: {
        invoiceLine: {
          include: {
            invoice: { select: { id: true, invoiceNumber: true, invoiceDate: true, supplierName: true } },
          },
        },
        productVariant: {
          include: { product: true, store: true },
        },
        product: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const items = matches.map((m) => {
      const product = m.productVariant?.product || m.product;
      // Skip matches with no product or an archived product
      if (!product || product.archivedAt) return null;
      const productName = product.name;
      const sku = m.productVariant?.sku || product?.barcode || '';
      const size = m.productVariant?.size || null;
      const source = product?.source || '';
      const shelfLocation = m.productVariant?.shelfLocation || null;
      const newPrice = m.approvedPrice ?? m.suggestedPrice ?? m.currentPrice;
      const store = m.productVariant?.store;

      return {
        matchId: m.id,
        invoiceId: m.invoiceLine.invoiceId,
        invoiceNumber: m.invoiceLine.invoice?.invoiceNumber || '',
        invoiceDate: m.invoiceLine.invoice?.invoiceDate || null,
        supplierName: m.invoiceLine.invoice?.supplierName || '',
        productName,
        sku,
        size,
        source,
        newPrice,
        newCost: m.newCost,
        previousCost: m.previousCost,
        currentPrice: m.currentPrice,
        exportFlagged: m.exportFlagged,
        exportedAt: m.exportedAt,
        shelfLocation,
        // Additional fields for format-specific exports
        barcode: product?.barcode || '',
        category: product?.category || '',
        baseUnit: product?.baseUnit || '',
        variantName: m.productVariant?.name || '',
        storeName: store?.name || '',
        storeType: store?.type || '',
        handle: productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      };
    }).filter((item) => {
      // Remove orphaned matches (no product)
      if (!item) return false;
      // Only include items where cost or selling price has actually changed
      const costChanged = item.newCost != null && (
        item.previousCost == null ||
        Math.abs(item.newCost - item.previousCost) >= 0.005
      );
      const priceChanged = item.newPrice != null && (
        item.currentPrice == null ||
        Math.abs(item.newPrice - item.currentPrice) >= 0.005
      );
      return costChanged || priceChanged;
    });

    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update price on a match (from Export page inline editing)
router.patch('/export/price', async (req, res) => {
  try {
    const { matchId, approvedPrice } = req.body;
    if (!matchId || approvedPrice == null) {
      return res.status(400).json({ message: 'matchId and approvedPrice are required' });
    }
    const price = parseFloat(approvedPrice);
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ message: 'approvedPrice must be a positive number' });
    }
    const match = await req.prisma.invoiceLineMatch.update({
      where: { id: matchId },
      data: { approvedPrice: price },
    });
    res.json({ matchId: match.id, approvedPrice: match.approvedPrice });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Match not found' });
    res.status(500).json({ message: err.message });
  }
});

// Mark matches as exported
router.post('/export/mark', async (req, res) => {
  try {
    const { matchIds, syncPlatforms } = req.body;
    if (!matchIds || !Array.isArray(matchIds) || matchIds.length === 0) {
      return res.status(400).json({ message: 'matchIds array is required' });
    }

    const result = await req.prisma.invoiceLineMatch.updateMany({
      where: { id: { in: matchIds } },
      data: {
        exportedAt: new Date(),
        status: 'EXPORTED',
      },
    });

    // ── Push prices to Shopify (non-fatal) ──────────────────
    // syncPlatforms (string[]) comes from the frontend per-platform action choice.
    // If provided, push only when 'shopify' is in the list.
    // If not provided, fall back to the integration's global pushPricesOnExport setting.
    const syncPlatformsLower = Array.isArray(syncPlatforms)
      ? syncPlatforms.map((p) => p.toLowerCase())
      : null;

    try {
      const integration = await basePrisma.shopifyIntegration.findUnique({
        where: { tenantId: req.user.tenantId },
      });
      const pushEnabled = syncPlatformsLower !== null
        ? syncPlatformsLower.includes('shopify')
        : integration?.pushPricesOnExport;
      if (integration?.isActive && pushEnabled && integration.accessTokenEnc) {
        const accessToken = decrypt(integration.accessTokenEnc);

        // Load the exported matches — only for active (non-archived) products
        const matches = await req.prisma.invoiceLineMatch.findMany({
          where: {
            id: { in: matchIds },
            status: 'EXPORTED',
            productVariant: { product: { archivedAt: null } },
          },
          include: {
            productVariant: { select: { shopifyVariantId: true } },
          },
        });

        for (const match of matches) {
          const shopifyVariantId = match.productVariant?.shopifyVariantId;
          if (!shopifyVariantId) continue;
          const price = match.approvedPrice ?? match.suggestedPrice;
          if (!price) continue;
          // Push price update — errors are non-fatal
          pushPriceUpdate(
            integration.shop,
            accessToken,
            shopifyVariantId,
            price,
            match.newCost ?? undefined
          ).catch((err) => {
            console.warn(`Shopify price push failed for variant ${shopifyVariantId}:`, err.message);
          });
        }
      }
    } catch (pushErr) {
      // Non-fatal — export still succeeds
      console.warn('Shopify price push error:', pushErr.message);
    }

    res.json({ updated: result.count });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Reallocate GST and freight across lines (after user changes gstInclusive, gst, or freight)
router.post('/:id/reallocate', async (req, res) => {
  try {
    // Re-run cost allocation
    await allocateInvoiceCosts(req.prisma, req.params.id);

    // Recalculate newCost on all existing match records for this invoice's lines
    const invoice = await fetchFullInvoice(req.prisma, req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    for (const line of invoice.lines) {
      for (const match of (line.matches || [])) {
        const unitQty = match.productVariant?.unitQty || 1;
        if (line.baseUnitCost) {
          const newCost = Math.round(line.baseUnitCost * unitQty * 100) / 100;
          await req.prisma.invoiceLineMatch.update({
            where: { id: match.id },
            data: { newCost },
          });
        }
      }
    }

    const updated = await fetchFullInvoice(req.prisma, req.params.id);
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Invoice not found' });
    res.status(500).json({ message: err.message });
  }
});

// ── List / Detail (cont.) ────────────────────────────────────

// Get a single invoice with full detail
router.get('/:id', async (req, res) => {
  try {
    const invoice = await fetchFullInvoice(req.prisma, req.params.id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Upload + OCR ──────────────────────────────────────────────

// Upload a new invoice — triggers OCR processing
router.post('/upload', checkApiLimit, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const fileUrl = `/api/uploads/${req.file.filename}`;

  // Create invoice record with PROCESSING status
  let invoice;
  try {
    invoice = await req.prisma.invoice.create({
      data: {
        status: 'PROCESSING',
        originalFileUrl: fileUrl,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create invoice record: ' + err.message });
  }

  // Run OCR extraction and apply results via shared processor
  const ocrSignalKey = `ocr:${invoice.id}`;
  const ocrStart = Date.now();
  try {
    const fileBuffer = fs.readFileSync(req.file.path);
    const ocrResult = await extractInvoiceData(fileBuffer, req.file.mimetype, req.user.tenantId, req.user.userId);
    const result = await applyOcrToInvoice(req.prisma, invoice.id, ocrResult);

    // Signal: OCR success — use real prompt metadata from assembly engine
    const ocrMeta = ocrResult._promptMeta || {};
    recordPromptMeta(ocrSignalKey, {
      agentRoleKey: 'ocr_extraction',
      tenantId: req.user.tenantId,
      userId: req.user.id,
      baseVersionId: ocrMeta.baseVersionId || 'fallback',
      tenantConfigId: ocrMeta.tenantConfigId || null,
      baseVersionNumber: ocrMeta.baseVersionNumber,
    });
    recordOutcome(ocrSignalKey, {
      resolutionStatus: 'resolved',
      topicTags: [ocrResult.supplier?.name, `confidence:${ocrResult.ocrConfidence}`].filter(Boolean),
    });
    recordUsage(ocrSignalKey, { latencyMs: Date.now() - ocrStart });
    emitSignal(ocrSignalKey, invoice.id);

    // Check if document was discarded (not an invoice)
    if (result?.discarded) {
      return res.status(200).json({
        discarded: true,
        documentType: result.documentType,
        supplierName: result.supplierName,
        invoiceId: invoice.id,
        message: `Document classified as "${result.documentType}" — discarded. This is not a valid invoice.`,
      });
    }

    res.status(201).json(result);
  } catch (ocrErr) {
    console.error('OCR extraction failed:', ocrErr);

    // Signal: OCR failure
    recordPromptMeta(ocrSignalKey, {
      agentRoleKey: 'ocr_extraction',
      tenantId: req.user.tenantId,
      userId: req.user.id,
      baseVersionId: 'unknown',
    });
    recordOutcome(ocrSignalKey, {
      resolutionStatus: 'failed',
      failureReason: ocrErr.message,
    });
    recordUsage(ocrSignalKey, { latencyMs: Date.now() - ocrStart });
    emitSignal(ocrSignalKey, invoice.id);

    // Mark invoice as failed but keep the record
    await req.prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: 'FAILED' },
    });
    res.status(422).json({
      message: 'OCR extraction failed: ' + ocrErr.message,
      invoiceId: invoice.id,
    });
  }
});

// Re-OCR an existing invoice — re-reads the original file and re-extracts data
router.post('/:id/reocr', checkApiLimit, async (req, res) => {
  try {
    const invoice = await req.prisma.invoice.findFirst({
      where: { id: req.params.id },
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    if (!invoice.originalFileUrl) return res.status(400).json({ message: 'No original file to re-process' });

    // Read the original file
    const filePath = path.join(process.cwd(), invoice.originalFileUrl.replace(/^\/api/, ''));
    if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Original file not found on disk' });

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : 'image/jpeg';

    // SIGNAL 5: Re-OCR is an escalation — the first OCR was bad enough to redo
    const escalationKey = `reocr:${invoice.id}`;
    recordPromptMeta(escalationKey, {
      agentRoleKey: 'ocr_extraction',
      tenantId: req.user.tenantId,
      userId: req.user.id,
      baseVersionId: 'reocr_escalation',
    });
    recordEscalation(escalationKey, true);
    recordSatisfaction(escalationKey, 1); // first OCR was bad enough to redo
    recordOutcome(escalationKey, {
      resolutionStatus: 'escalated',
      topicTags: ['reocr', invoice.supplierName].filter(Boolean),
    });
    emitSignal(escalationKey, invoice.id);

    // Delete existing lines (cascade deletes matches too)
    await req.prisma.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });

    // Re-run OCR and apply
    const ocrResult = await extractInvoiceData(fileBuffer, mimeType, req.user.tenantId, req.user.userId);
    const result = await applyOcrToInvoice(req.prisma, invoice.id, ocrResult);

    if (result?.discarded) {
      return res.json({
        discarded: true,
        documentType: result.documentType,
        supplierName: result.supplierName,
        invoiceId: invoice.id,
        message: `Document classified as "${result.documentType}" — discarded.`,
      });
    }

    res.json(result);
  } catch (err) {
    console.error('Re-OCR failed:', err);
    res.status(500).json({ message: 'Re-OCR failed: ' + err.message });
  }
});

// ── Header / Line Editing ─────────────────────────────────────

// Update invoice header (for correcting OCR data)
router.patch('/:id', async (req, res) => {
  try {
    const { supplierName, invoiceNumber, invoiceDate, dueDate, subtotal, gst, freight, total, freightMethod, gstInclusive, status } = req.body;

    const updateData = {};
    if (supplierName !== undefined) updateData.supplierName = supplierName;
    if (invoiceNumber !== undefined) updateData.invoiceNumber = invoiceNumber;
    if (invoiceDate !== undefined) updateData.invoiceDate = invoiceDate ? new Date(invoiceDate) : null;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (subtotal !== undefined) updateData.subtotal = subtotal;
    if (gst !== undefined) updateData.gst = gst;
    if (freight !== undefined) updateData.freight = freight;
    if (total !== undefined) updateData.total = total;
    if (freightMethod !== undefined) updateData.freightMethod = freightMethod;
    if (gstInclusive !== undefined) updateData.gstInclusive = gstInclusive;
    if (status !== undefined) updateData.status = status;

    const invoice = await req.prisma.invoice.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        supplier: true,
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    });

    // SIGNAL 2: Implicit OCR satisfaction — how many header fields did user correct?
    const editableHeaderFields = ['supplierName', 'invoiceNumber', 'invoiceDate', 'dueDate', 'subtotal', 'gst', 'freight', 'total', 'gstInclusive'];
    const fieldsChanged = editableHeaderFields.filter((f) => req.body[f] !== undefined).length;
    if (fieldsChanged > 0) {
      const satKey = `ocr_edit:${req.params.id}:header`;
      recordPromptMeta(satKey, {
        agentRoleKey: 'ocr_extraction',
        tenantId: req.user.tenantId,
        userId: req.user.id,
        baseVersionId: 'ocr_correction',
      });
      recordImplicitSatisfaction(satKey, fieldsChanged, editableHeaderFields.length);
      recordOutcome(satKey, {
        resolutionStatus: 'resolved',
        topicTags: ['ocr_correction', `fields:${fieldsChanged}`],
      });
      emitSignal(satKey, req.params.id);
    }

    res.json(invoice);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Invoice not found' });
    res.status(500).json({ message: err.message });
  }
});

// Update a line item (for correcting OCR data)
router.patch('/:id/lines/:lineId', async (req, res) => {
  try {
    const { description, quantity, unitPrice, lineTotal, packSize, baseUnit, baseUnitCost, gstApplicable } = req.body;

    const updateData = {};
    if (description !== undefined) updateData.description = description;
    if (quantity !== undefined) updateData.quantity = quantity;
    if (unitPrice !== undefined) updateData.unitPrice = unitPrice;
    if (lineTotal !== undefined) updateData.lineTotal = lineTotal;
    if (packSize !== undefined) updateData.packSize = packSize;
    if (baseUnit !== undefined) updateData.baseUnit = baseUnit;
    if (baseUnitCost !== undefined) updateData.baseUnitCost = baseUnitCost;
    if (gstApplicable !== undefined) updateData.gstApplicable = gstApplicable;

    await req.prisma.invoiceLine.update({
      where: { id: req.params.lineId },
      data: updateData,
    });

    // SIGNAL 2: Implicit OCR satisfaction — line-level correction
    const editableLineFields = ['description', 'quantity', 'unitPrice', 'lineTotal', 'packSize', 'baseUnit', 'baseUnitCost', 'gstApplicable'];
    const lineFieldsChanged = editableLineFields.filter((f) => req.body[f] !== undefined).length;
    if (lineFieldsChanged > 0) {
      const satKey = `ocr_edit:${req.params.id}:line:${req.params.lineId}`;
      recordPromptMeta(satKey, {
        agentRoleKey: 'ocr_extraction',
        tenantId: req.user.tenantId,
        userId: req.user.id,
        baseVersionId: 'ocr_correction',
      });
      recordImplicitSatisfaction(satKey, lineFieldsChanged, editableLineFields.length);
      recordOutcome(satKey, {
        resolutionStatus: 'resolved',
        topicTags: ['ocr_line_correction', `fields:${lineFieldsChanged}`],
      });
      emitSignal(satKey, req.params.id);
    }

    // When gstApplicable changes, re-run cost allocation and return the full invoice
    if (gstApplicable !== undefined) {
      await allocateInvoiceCosts(req.prisma, req.params.id);
      const invoice = await req.prisma.invoice.findFirst({
        where: { id: req.params.id },
        include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
      });
      return res.json(invoice);
    }

    const line = await req.prisma.invoiceLine.findFirst({ where: { id: req.params.lineId } });
    res.json(line);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Line item not found' });
    res.status(500).json({ message: err.message });
  }
});

// Delete an invoice (cascades to lines + matches via Prisma schema)
router.delete('/:id', requireRole('OWNER', 'OPS_MANAGER'), async (req, res) => {
  try {
    const invoice = await req.prisma.invoice.findFirst({
      where: { id: req.params.id, archivedAt: null },
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    await req.prisma.invoice.update({
      where: { id: req.params.id },
      data: { archivedAt: new Date() },
    });
    res.json({ message: 'Invoice archived' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Product Matching ──────────────────────────────────────────

// Auto-match all lines in an invoice
router.post('/:id/match', requireRole('OWNER', 'OPS_MANAGER', 'MERCHANDISER'), async (req, res) => {
  try {
    const invoice = await req.prisma.invoice.findFirst({
      where: { id: req.params.id },
      include: { supplier: true, lines: { orderBy: { lineNumber: 'asc' } } },
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    // Delete any existing matches for these lines (supports re-run)
    const lineIds = invoice.lines.map((l) => l.id);
    if (lineIds.length > 0) {
      await req.prisma.invoiceLineMatch.deleteMany({
        where: { invoiceLineId: { in: lineIds } },
      });
    }

    // Pass tenantId for AI fallback tracking
    if (!invoice.tenantId) invoice.tenantId = req.user.tenantId;
    const matchStart = Date.now();
    await matchInvoiceLines(req.prisma, invoice);

    // Signal: matching completed
    const matchSignalKey = `match:${invoice.id}`;
    recordPromptMeta(matchSignalKey, {
      agentRoleKey: 'product_matching',
      tenantId: req.user.tenantId,
      userId: req.user.id,
      baseVersionId: 'match_run',
    });
    recordOutcome(matchSignalKey, {
      resolutionStatus: 'resolved',
      topicTags: [`lines:${invoice.lines.length}`],
    });
    recordUsage(matchSignalKey, { latencyMs: Date.now() - matchStart });
    emitSignal(matchSignalKey, invoice.id);

    // Re-fetch with full match data populated
    const updated = await fetchFullInvoice(req.prisma, req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Manually set the product match for a specific line (supports single or multiple products)
router.post('/:id/lines/:lineId/matches', async (req, res) => {
  try {
    const { productId, productIds, saveMapping, priceOverrides, variantPriceOverrides } = req.body;
    // Support both single productId (legacy) and multiple productIds (new)
    const ids = productIds || (productId ? [productId] : []);
    if (ids.length === 0) return res.status(400).json({ message: 'productId or productIds is required' });

    const line = await req.prisma.invoiceLine.findFirst({
      where: { id: req.params.lineId, invoiceId: req.params.id },
    });
    if (!line) return res.status(404).json({ message: 'Line not found' });

    // ── Capture AI's original suggestions BEFORE deleting (Signal 3 data) ──
    const previousMatches = await req.prisma.invoiceLineMatch.findMany({
      where: { invoiceLineId: line.id },
      include: {
        product: { select: { id: true, name: true, category: true } },
        productVariant: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { confidence: 'desc' },
    });
    const aiSuggestions = previousMatches.map((m) => ({
      productId: m.productId,
      productName: m.product?.name || null,
      productCategory: m.product?.category || null,
      variantId: m.productVariantId,
      variantName: m.productVariant?.name || null,
      confidence: m.confidence,
      matchReason: m.matchReason,
      suggestedPrice: m.suggestedPrice,
      isManual: m.isManual,
    }));

    // Delete existing matches for this line
    await req.prisma.invoiceLineMatch.deleteMany({
      where: { invoiceLineId: line.id },
    });

    // Create match records for each selected product
    for (const pid of ids) {
      await createMatchRecords(req.prisma, line.id, pid, line, 1.0, 'manual', true, req.user.userId);
    }

    // User explicitly confirmed — upgrade all matches from PENDING to CONFIRMED
    await req.prisma.invoiceLineMatch.updateMany({
      where: { invoiceLineId: line.id, status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });

    // Also mark the line itself as APPROVED (user confirmed their product selection)
    await req.prisma.invoiceLine.update({
      where: { id: line.id },
      data: { status: 'APPROVED' },
    });

    // Apply per-variant price overrides (new format: keyed by variantId or productId for variant-less)
    // Also remember the margin as a PRODUCT-scope PricingRule for future invoices
    if (variantPriceOverrides && typeof variantPriceOverrides === 'object') {
      const marginsByProduct = {}; // { productId: { totalMargin, count } }

      for (const [variantKey, newSellPrice] of Object.entries(variantPriceOverrides)) {
        const price = parseFloat(newSellPrice);
        if (isNaN(price) || price <= 0) continue;

        // Try as variant ID first (for products with variants)
        let match = await req.prisma.invoiceLineMatch.findFirst({
          where: { invoiceLineId: line.id, productVariantId: variantKey },
        });
        // Fallback: try as productId for variant-less products
        if (!match) {
          match = await req.prisma.invoiceLineMatch.findFirst({
            where: { invoiceLineId: line.id, productId: variantKey, productVariantId: null },
          });
        }
        if (match) {
          await req.prisma.invoiceLineMatch.update({
            where: { id: match.id },
            data: { approvedPrice: price, exportFlagged: true },
          });

          // Calculate margin % from the override: margin = 1 - (cost / sellPrice)
          if (match.newCost > 0 && match.productId) {
            const margin = 1 - (match.newCost / price);
            if (margin > 0 && margin < 1) {
              const pid = match.productId;
              if (!marginsByProduct[pid]) marginsByProduct[pid] = { totalMargin: 0, count: 0 };
              marginsByProduct[pid].totalMargin += margin;
              marginsByProduct[pid].count += 1;
            }
          }
        }
      }

      // Save averaged margin as PRODUCT-scope PricingRule for each product
      const invoice = await req.prisma.invoice.findFirst({ where: { id: req.params.id } });
      for (const [productId, { totalMargin, count }] of Object.entries(marginsByProduct)) {
        const avgMargin = Math.round((totalMargin / count) * 10000) / 10000; // 4 decimal places
        const existing = await req.prisma.pricingRule.findFirst({
          where: { scope: 'PRODUCT', scopeValue: productId, tenantId: invoice.tenantId },
        });
        if (existing) {
          await req.prisma.pricingRule.update({
            where: { id: existing.id },
            data: { targetMargin: avgMargin, isActive: true },
          });
        } else {
          const product = await req.prisma.product.findFirst({ where: { id: productId }, select: { name: true } });
          await req.prisma.pricingRule.create({
            data: {
              tenantId: invoice.tenantId,
              name: `${product?.name || 'Product'} margin`,
              scope: 'PRODUCT',
              scopeValue: productId,
              targetMargin: avgMargin,
              priority: 100, // PRODUCT rules have highest priority
              isActive: true,
            },
          });
        }
      }
    }

    // Backward compat: apply old priceOverrides (keyed by productId, same price for all variants)
    if (priceOverrides && typeof priceOverrides === 'object' && !variantPriceOverrides) {
      for (const [overrideProductId, newSellPrice] of Object.entries(priceOverrides)) {
        const price = parseFloat(newSellPrice);
        if (isNaN(price)) continue;
        const matchesToUpdate = await req.prisma.invoiceLineMatch.findMany({
          where: { invoiceLineId: line.id, productId: overrideProductId },
        });
        for (const match of matchesToUpdate) {
          await req.prisma.invoiceLineMatch.update({
            where: { id: match.id },
            data: { approvedPrice: price, exportFlagged: true },
          });
        }
      }
    }

    // Optionally save SupplierProductMapping for future reuse (save for first product only)
    if (saveMapping && ids.length > 0) {
      const invoice = await req.prisma.invoice.findFirst({ where: { id: req.params.id } });
      if (invoice?.supplierId) {
        const existing = await req.prisma.supplierProductMapping.findFirst({
          where: { supplierId: invoice.supplierId, supplierDescription: line.description },
        });
        if (existing) {
          await req.prisma.supplierProductMapping.update({
            where: { id: existing.id },
            data: { productId: ids[0], confirmedByUserId: req.user.userId, timesUsed: { increment: 1 } },
          });
        } else {
          await req.prisma.supplierProductMapping.create({
            data: {
              supplierId: invoice.supplierId,
              supplierDescription: line.description,
              productId: ids[0],
              confidence: 1.0,
              confirmedByUserId: req.user.userId,
            },
          });
        }
      }
    }

    // SIGNAL 3: Human override — this is the HIGHEST VALUE signal
    // Compare what the AI suggested vs what the user chose
    const aiTopSuggestion = aiSuggestions.find((s) => !s.isManual);
    const aiTopProductId = aiTopSuggestion?.productId || null;
    const aiTopWasCorrect = aiTopProductId ? ids.includes(aiTopProductId) : false;

    // Fetch user-selected product names for the diff
    let userSelectedNames = [];
    try {
      const selectedProducts = await req.prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, category: true },
      });
      userSelectedNames = selectedProducts.map((p) => ({ id: p.id, name: p.name, category: p.category }));
    } catch { /* non-critical */ }

    const overrideKey = `override:${req.params.id}:${line.id}`;
    recordPromptMeta(overrideKey, {
      agentRoleKey: 'product_matching',
      tenantId: req.user.tenantId,
      userId: req.user.id,
      baseVersionId: 'manual_match',
    });
    recordHumanOverride(overrideKey, {
      humanOverride: true,
      humanOverrideDiff: {
        lineDescription: line.description,
        packSize: line.packSize,
        aiSuggestions: aiSuggestions.filter((s) => !s.isManual).slice(0, 5),
        aiHadSuggestions: aiSuggestions.filter((s) => !s.isManual).length > 0,
        aiTopWasCorrect,
        userSelected: userSelectedNames,
        savedMapping: !!saveMapping,
        priceOverridden: !!(variantPriceOverrides || priceOverrides),
      },
    });
    recordOutcome(overrideKey, { resolutionStatus: 'resolved' });
    emitSignal(overrideKey, req.params.id);

    // Return updated line with matches
    const updatedLine = await req.prisma.invoiceLine.findFirst({
      where: { id: line.id },
      include: {
        matches: {
          include: {
            productVariant: { include: { product: true, store: true } },
            product: { include: { variants: { where: { isActive: true }, select: { id: true, size: true, sku: true, name: true } } } },
          },
        },
      },
    });
    res.json(updatedLine);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update approved price on a single match
router.patch('/:id/lines/:lineId/matches/:matchId', async (req, res) => {
  try {
    const { approvedPrice } = req.body;
    const match = await req.prisma.invoiceLineMatch.update({
      where: { id: req.params.matchId },
      data: { approvedPrice },
      include: {
        productVariant: { include: { product: true, store: true } },
        product: { include: { variants: { where: { isActive: true }, select: { id: true, size: true, sku: true, name: true } } } },
      },
    });
    res.json(match);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Match not found' });
    res.status(500).json({ message: err.message });
  }
});

// Confirm line match — set line + match statuses
router.post('/:id/lines/:lineId/confirm', async (req, res) => {
  try {
    const { status } = req.body; // 'APPROVED', 'HELD', 'FLAGGED'

    // Update all matches for this line to CONFIRMED
    await req.prisma.invoiceLineMatch.updateMany({
      where: { invoiceLineId: req.params.lineId },
      data: { status: 'CONFIRMED' },
    });

    // Update line status
    const line = await req.prisma.invoiceLine.update({
      where: { id: req.params.lineId },
      data: { status: status || 'APPROVED' },
      include: {
        matches: {
          include: {
            productVariant: { include: { product: true, store: true } },
            product: { include: { variants: { where: { isActive: true }, select: { id: true, size: true, sku: true, name: true } } } },
          },
        },
      },
    });
    res.json(line);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ message: 'Line not found' });
    res.status(500).json({ message: err.message });
  }
});

// ── Approval & Export ─────────────────────────────────────────

// Approve an invoice — apply cost/price updates to product variants
router.post('/:id/approve', requireRole('OWNER', 'OPS_MANAGER', 'MERCHANDISER'), async (req, res) => {
  try {
    const invoice = await req.prisma.invoice.findFirst({
      where: { id: req.params.id },
      include: {
        lines: {
          include: {
            matches: { include: { productVariant: true, product: true } },
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    // Update confirmed matches to APPROVED and apply cost/price changes
    for (const line of invoice.lines) {
      for (const match of line.matches) {
        if (match.status === 'CONFIRMED') {
          await req.prisma.invoiceLineMatch.update({
            where: { id: match.id },
            data: { status: 'APPROVED' },
          });

          if (match.productVariantId) {
            // Variant-level: apply cost + price update to the product variant
            const updateData = { currentCost: match.newCost };
            if (match.approvedPrice != null) {
              updateData.salePrice = match.approvedPrice;
            }
            await req.prisma.productVariant.update({
              where: { id: match.productVariantId },
              data: updateData,
            });

            // Create audit log entry
            await req.prisma.auditLog.create({
              data: {
                userId: req.user.userId,
                action: 'PRICE_UPDATED',
                entityType: 'ProductVariant',
                entityId: match.productVariantId,
                previousVal: { cost: match.previousCost, price: match.currentPrice },
                newVal: { cost: match.newCost, price: match.approvedPrice },
                metadata: { invoiceId: invoice.id, lineId: line.id },
              },
            });
          } else if (match.productId) {
            // Product-level: apply cost + price update to the product directly
            const updateData = { costPrice: match.newCost };
            if (match.approvedPrice != null) {
              updateData.sellingPrice = match.approvedPrice;
            }
            await req.prisma.product.update({
              where: { id: match.productId },
              data: updateData,
            });

            // Create audit log entry
            await req.prisma.auditLog.create({
              data: {
                userId: req.user.userId,
                action: 'PRICE_UPDATED',
                entityType: 'Product',
                entityId: match.productId,
                previousVal: { cost: match.previousCost, price: match.currentPrice },
                newVal: { cost: match.newCost, price: match.approvedPrice },
                metadata: { invoiceId: invoice.id, lineId: line.id },
              },
            });
          }
        }
      }
    }

    // SIGNAL 2: Matching satisfaction — derived from manual vs auto match ratio
    const allMatches = invoice.lines.flatMap((l) => l.matches);
    const totalMatches = allMatches.length;
    const manualMatches = allMatches.filter((m) => m.isManual).length;
    const priceOverrides = allMatches.filter((m) => m.approvedPrice != null && m.suggestedPrice != null && m.approvedPrice !== m.suggestedPrice).length;
    if (totalMatches > 0) {
      const manualRatio = manualMatches / totalMatches;
      let matchSat;
      if (manualRatio === 0 && priceOverrides === 0) matchSat = 5;      // all auto, no price edits
      else if (manualRatio <= 0.2 && priceOverrides <= 1) matchSat = 4; // mostly auto
      else if (manualRatio <= 0.5) matchSat = 3;                        // mixed
      else matchSat = 1;                                                 // mostly manual
      const matchSatKey = `match_sat:${req.params.id}`;
      recordPromptMeta(matchSatKey, {
        agentRoleKey: 'product_matching',
        tenantId: req.user.tenantId,
        userId: req.user.id,
        baseVersionId: 'approval',
      });
      recordSatisfaction(matchSatKey, matchSat);
      recordOutcome(matchSatKey, {
        resolutionStatus: 'resolved',
        topicTags: [`manual:${manualMatches}/${totalMatches}`, `price_overrides:${priceOverrides}`],
      });
      emitSignal(matchSatKey, req.params.id);
    }

    // Update invoice status
    const updated = await fetchFullInvoice(req.prisma, req.params.id);
    await req.prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
    });

    res.json({ ...updated, status: 'APPROVED' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get export data — approved matches grouped by store
router.get('/:id/export', async (req, res) => {
  try {
    const invoice = await req.prisma.invoice.findFirst({
      where: { id: req.params.id },
      include: {
        supplier: true,
        lines: {
          include: {
            matches: {
              where: { status: { in: ['CONFIRMED', 'APPROVED'] } },
              include: {
                productVariant: {
                  include: { product: true, store: true },
                },
                product: { include: { variants: { where: { isActive: true }, select: { id: true, size: true, sku: true, name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

    // Group by store (variant-level) + collect product-level matches
    const storeMap = {};
    const productLevelItems = [];
    for (const line of invoice.lines) {
      for (const match of line.matches) {
        if (match.productVariant) {
          const store = match.productVariant.store;
          if (!storeMap[store.id]) {
            storeMap[store.id] = { store, items: [] };
          }
          storeMap[store.id].items.push({
            sku: match.productVariant.sku,
            productName: match.productVariant.name,
            size: match.productVariant.size,
            previousCost: match.previousCost,
            newCost: match.newCost,
            currentPrice: match.currentPrice,
            newPrice: match.approvedPrice,
            exportFlagged: match.exportFlagged || false,
            shelfLocation: match.productVariant.shelfLocation,
          });
        } else if (match.product) {
          productLevelItems.push({
            productName: match.product.name,
            category: match.product.category,
            previousCost: match.previousCost,
            newCost: match.newCost,
            currentPrice: match.currentPrice,
            newPrice: match.approvedPrice,
            exportFlagged: match.exportFlagged || false,
          });
        }
      }
    }

    res.json({
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        supplierName: invoice.supplierName,
      },
      stores: Object.values(storeMap),
      productLevelItems, // matches without a specific store/variant
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
