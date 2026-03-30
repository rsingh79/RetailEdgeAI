// server/src/services/importJobService.js
// Import Job Service — creates and manages ImportJob records,
// assembles the full pipeline, and orchestrates execution.
// Route handlers call this service, not the pipeline directly.

import {
  PipelineRunner,
  createPipelineContext,
  createCanonicalProduct,
  SourceResolver,
  NormalisationEngine,
  FingerprintEngine,
  CatalogMatcher,
  InvoiceRiskAnalyser,
  ConfidenceScorer,
  ApprovalClassifier,
} from './agents/pipeline/index.js';
import { WriteLayer } from './agents/pipeline/stages/writeLayer.js';
import { AuditLogger } from './agents/pipeline/stages/auditLogger.js';
import { registerAgent } from './agents/agentRegistry.js';

// ── PART 1 — Register with agent registry ──

registerAgent({
  key: 'product_import_pipeline',
  name: 'Product Import Pipeline',
  agentRoleKey: 'product_import',
  description:
    'AI-assisted product import with ' +
    'duplicate detection, confidence scoring, ' +
    'and human approval gate',
  version: '2.0.0',
  stages: [
    'source_resolver',
    'normalisation_engine',
    'fingerprint_engine',
    'catalog_matcher',
    'invoice_risk_analyser',
    'confidence_scorer',
    'approval_classifier',
    'write_layer',
    'audit_logger',
  ],
});

// ── PART 2 — Build pipeline ──

function buildPipeline() {
  return new PipelineRunner([
    new SourceResolver(),
    new NormalisationEngine(),
    new FingerprintEngine(),
    new CatalogMatcher(),
    new InvoiceRiskAnalyser(),
    new ConfidenceScorer(),
    new ApprovalClassifier(),
    new WriteLayer(),
    new AuditLogger(),
  ]);
}

// ── PART 3 — Create ImportJob record ──

async function createImportJob(params, prisma) {
  return prisma.importJob.create({
    data: {
      tenantId: params.tenantId,
      userId: params.userId || null,
      status: 'PENDING',
      sourceType: params.sourceType || 'CSV_UPLOAD',
      sourceName: params.sourceName || null,
      fileName: params.fileName || null,
      fileHash: params.fileHash || null,
      totalRows: params.totalRows || 0,
      dryRun: params.dryRun || false,
      syncMode: params.syncMode || 'FULL',
    },
  });
}

// ── PART 4 — Convert raw rows to CanonicalProduct ──

function rowsToCanonical(rows, session) {
  return rows.map((row, i) => {
    const product = createCanonicalProduct({
      name: row.name || null,
      category: row.category || null,
      barcode: row.barcode || row.Barcode || row.BARCODE
            || row.ean || row.EAN
            || row.upc || row.UPC
            || row.gtin || row.GTIN
            || null,
      sku: row.sku || row.SKU || row.Sku
        || row.itemCode || row.item_code || row.ItemCode
        || null,
      baseUnit: row.baseUnit || null,
      size: row.size || null,
      packSize: row.packSize || null,
      unitQty: row.unitQty || 1,
      price: row.sellingPrice ?? row.price ?? null,
      sellingPrice: row.sellingPrice ?? null,
      costPrice: row.costPrice ?? null,
      currency: 'AUD',
      status: 'ACTIVE',
      rawSourceData: row,
      rowIndex: i,
      variants:
        row.variants?.map((v) => ({
          sku: v.sku || null,
          barcode: v.barcode || null,
          optionValue: v.variantName || v.name || null,
          size: v.variantSize || v.size || null,
          price: v.price ?? null,
          costPrice: v.cost ?? null,
          weight: v.weight ?? null,
          isActive: true,
        })) || [],
    });

    if (session.gstDetected) {
      product.customAttributes.gstDetected = true;
      product.customAttributes.gstRate = session.gstRate;
    }

    return product;
  });
}

// ── PART 5 — Run the full import pipeline ──

async function runImportPipeline(params) {
  const {
    importJobId,
    products,
    tenantId,
    userId,
    prisma,
    dryRun,
    sourceType,
    sourceName,
    syncMode,
    stageData,
  } = params;

  // Step 1 — Mark ImportJob as ANALYZING
  await prisma.importJob.update({
    where: { id: importJobId },
    data: { status: 'ANALYZING', startedAt: new Date() },
  });

  // Step 2 — Build pipeline context
  const context = createPipelineContext({
    importJobId,
    tenantId,
    userId,
    prisma,
    dryRun: dryRun || false,
    syncMode: syncMode || 'FULL',
    sourceType,
    sourceName,
    stageData: stageData || {},
  });

  // Step 3 — Build and run the pipeline
  const pipeline = buildPipeline();
  const { products: processed, context: finalContext } = await pipeline.run(
    products,
    context
  );

  // Step 4 — Return the result summary
  return {
    importJobId,
    status: 'COMPLETE',
    totalRows: finalContext.totalRows,
    rowsCreated: finalContext.rowsCreated,
    rowsUpdated: finalContext.rowsUpdated,
    rowsSkipped: finalContext.rowsSkipped,
    rowsFailed: finalContext.rowsFailed,
    rowsPendingApproval: finalContext.rowsPendingApproval,
    dryRun: dryRun,
    products: processed,
  };
}

export { createImportJob, rowsToCanonical, runImportPipeline, buildPipeline };
