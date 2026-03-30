// server/src/services/agents/pipeline/stages/writeLayer.js
// Write Layer — Stage L of the product import pipeline.
// The only stage that writes Product and ProductVariant records to the DB.
// Respects approval routes: auto-approved products write immediately,
// review products queue, rejected products are blocked.

import PipelineStage from '../pipelineStage.js';
import { addError, addWarning } from '../canonicalProduct.js';
import { withTenantTransaction } from '../../../../lib/prisma.js';
import { embedProduct } from '../../../ai/embeddingMaintenance.js';
import { executeHook } from '../../../integrationHooks.js';

// ── PART 1 — Build Product data object ──

function buildProductData(product, context) {
  return {
    name: product.name,
    category: product.category || null,
    baseUnit: product.baseUnit || null,
    barcode: product.barcode || null,
    costPrice: product.costPrice ?? null,
    sellingPrice: product.price ?? product.sellingPrice ?? null,
    source: product.sourceSystem || 'Manual',
    externalId: product.externalId || null,
    productImportedThrough: product.productImportedThrough ||
      product.sourceType || null,
    fingerprint: product.fingerprint || null,
    importId: product.importJobId || null,
    approvalStatus: 'AUTO_APPROVED',
    lastSyncedAt: new Date(),
    confidenceScore: product.confidenceScore ?? null,
  };
}

// ── PART 2 — Build Variant data object ──

function buildVariantData(variant, productId, storeId) {
  return {
    productId,
    storeId,
    sku: variant.sku || `SKU-${Date.now()}`,
    name: variant.optionValue || variant.sku || 'Default',
    size: variant.size || null,
    unitQty: variant.unitQty || 1,
    currentCost: variant.costPrice || 0,
    salePrice: variant.price || 0,
    isActive: true,
  };
}

// ── PART 3 — Pre-write race condition check ──

async function preWriteCheck(product, prisma) {
  if (product.fingerprint) {
    const existing = await prisma.product.findFirst({
      where: { fingerprint: product.fingerprint, archivedAt: null },
    });
    if (existing) return { conflict: true, existingProduct: existing };
  }

  if (product.externalId && product.sourceSystem) {
    const existing = await prisma.product.findFirst({
      where: {
        externalId: product.externalId,
        source: product.sourceSystem,
        archivedAt: null,
      },
    });
    if (existing) return { conflict: true, existingProduct: existing };
  }

  if (product.barcode) {
    const existing = await prisma.product.findFirst({
      where: { barcode: product.barcode, archivedAt: null },
    });
    if (existing) return { conflict: true, existingProduct: existing };
  }

  return { conflict: false, existingProduct: null };
}

// ── PART 4 — Write a single ROUTE_AUTO product ──

async function writeProduct(product, context) {
  // Step 1 — Pre-write race condition check
  const check = await preWriteCheck(product, context.prisma);
  if (check.conflict) {
    product.approvalRoute = 'ROUTE_REVIEW';
    product.approvalReason =
      'Race condition: product created between analysis and approval — re-queued for review';
    context.rowsPendingApproval++;
    return { written: false, productId: null, action: 'REQUEUED', error: null };
  }

  // Step 2 — Write inside transaction
  const { writtenProduct, action } = await withTenantTransaction(
    context.tenantId,
    async (tx) => {
      let writtenProduct;
      let action;
      const matchedProductId = product.matchResult?.matchedProductId;

      if (product.matchResult?.action === 'UPDATE' && matchedProductId) {
        writtenProduct = await tx.product.update({
          where: { id: matchedProductId },
          data: buildProductData(product, context),
        });
        action = 'UPDATED';
      } else {
        writtenProduct = await tx.product.create({
          data: buildProductData(product, context),
        });
        action = 'CREATED';
      }

      // Write variants
      if (product.variants && product.variants.length > 0) {
        const storeId = context.stageData?.defaultStoreId;
        if (storeId) {
          for (const variant of product.variants) {
            const sku = variant.sku || `SKU-${Date.now()}`;
            await tx.productVariant.upsert({
              where: { storeId_sku: { storeId, sku } },
              update: buildVariantData(variant, writtenProduct.id, storeId),
              create: buildVariantData(variant, writtenProduct.id, storeId),
            });
          }
        }
      }

      // Write ProductImportRecord
      if (context.importJobId) {
        await tx.productImportRecord.create({
          data: {
            tenantId: context.tenantId,
            importJobId: context.importJobId,
            rowIndex: product.rowIndex || 0,
            rawSourceData: product.rawSourceData || {},
            normalizedData: {
              name: product.name,
              sku: product.sku,
              barcode: product.barcode,
            },
            fingerprint: product.fingerprint,
            fingerprintTier: product.fingerprintTier,
            matchAction: action === 'CREATED' ? 'CREATED' : 'UPDATED',
            matchedProductId: writtenProduct.id,
            productId: writtenProduct.id,
          },
        });

        // Update ImportJob counters
        const incrementData = {};
        if (action === 'CREATED') incrementData.rowsCreated = { increment: 1 };
        if (action === 'UPDATED') incrementData.rowsUpdated = { increment: 1 };
        await tx.importJob.update({
          where: { id: context.importJobId },
          data: incrementData,
        });
      }

      return { writtenProduct, action };
    }
  );

  // Link any archived predecessors to this new product
  // so the Business Advisor can follow the canonical
  // chain and return unified cost history
  try {
    const archivedPredecessors = await context.prisma.product.findMany({
      where: {
        name: { equals: product.name, mode: 'insensitive' },
        source: product.sourceSystem || null,
        archivedAt: { not: null },
        canonicalProductId: null,
      },
      select: { id: true, name: true },
    });

    if (archivedPredecessors.length > 0) {
      await context.prisma.product.updateMany({
        where: {
          id: { in: archivedPredecessors.map(p => p.id) },
        },
        data: {
          canonicalProductId: writtenProduct.id,
        },
      });

      console.log(
        `[Pipeline:write_layer] Linked ${archivedPredecessors.length} ` +
        `archived predecessor(s) to new product ` +
        `${writtenProduct.id} (${product.name})`
      );
    }
  } catch (err) {
    // Non-fatal — log but do not fail the write
    console.warn(
      '[Pipeline:write_layer] Failed to link archived predecessors:',
      err.message
    );
  }

  // Step 3 — Update context counters
  if (action === 'CREATED') context.rowsCreated++;
  if (action === 'UPDATED') context.rowsUpdated++;

  // Step 4 — Fire-and-forget embedding refresh
  embedProduct({
    id: writtenProduct.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    baseUnit: product.baseUnit,
    tenantId: context.tenantId,
  }).catch(() => {});

  // Step 5 — Fire-and-forget integration hook (e.g. Shopify variant creation)
  executeHook(
    product.sourceSystem,
    writtenProduct,
    product.integrationMetadata,
    context.prisma,
  ).catch(() => {});

  return { written: true, productId: writtenProduct.id, action, error: null };
}

// ── PART 5 — Queue a product for human review ──

async function queueProduct(product, context) {
  if (context.dryRun) {
    context.rowsPendingApproval++;
    return { queued: true, queueId: 'dry-run', error: null };
  }

  try {
    const queueEntry = await context.prisma.approvalQueueEntry.create({
      data: {
        tenantId: context.tenantId,
        importJobId: context.importJobId,
        rowIndex: product.rowIndex || 0,
        approvalRoute: product.approvalRoute,
        invoiceRiskLevel: product.invoiceRisk?.level || 'NONE',
        status: 'PENDING',
        normalizedData: {
          name: product.name,
          sku: product.sku,
          barcode: product.barcode,
          price: product.price,
          costPrice: product.costPrice,
          category: product.category,
          brand: product.brand,
          sourceSystem: product.sourceSystem,
          externalId: product.externalId,
          integrationMetadata: product.integrationMetadata || null,
        },
        matchResult: product.matchResult,
        similarProducts: product.invoiceRisk?.similarProducts || [],
        confidenceScore: product.confidenceScore,
        confidenceBreakdown: product.confidenceBreakdown,
        riskExplanation: product.invoiceRisk?.explanation || null,
        requiresSecondApproval: product.invoiceRisk?.level === 'HIGH',
        slaDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Create ProductImportRecord
    await context.prisma.productImportRecord.create({
      data: {
        tenantId: context.tenantId,
        importJobId: context.importJobId,
        rowIndex: product.rowIndex || 0,
        rawSourceData: product.rawSourceData || {},
        fingerprint: product.fingerprint,
        fingerprintTier: product.fingerprintTier,
        matchAction: 'SKIPPED',
        approvalQueueId: queueEntry.id,
      },
    });

    // Update ImportJob counter
    if (context.importJobId) {
      await context.prisma.importJob.update({
        where: { id: context.importJobId },
        data: { rowsPendingApproval: { increment: 1 } },
      });
    }

    context.rowsPendingApproval++;
    return { queued: true, queueId: queueEntry.id, error: null };
  } catch (err) {
    return { queued: false, queueId: null, error: err.message };
  }
}

// ── PART 6 — WriteLayer stage class ──

class WriteLayer extends PipelineStage {
  constructor() {
    super('write_layer');
  }

  async process(product, context) {
    // Dry run — no writes, just count
    if (context.dryRun) {
      const route = product.approvalRoute;
      if (route === 'ROUTE_REJECT') {
        context.rowsSkipped++;
        this.log(`[DRY RUN] Would SKIP: ${product.name}`);
      } else if (route === 'ROUTE_AUTO') {
        context.rowsCreated++;
        this.log(`[DRY RUN] Would CREATE: ${product.name}`);
      } else {
        context.rowsPendingApproval++;
        this.log(`[DRY RUN] Would QUEUE: ${product.name}`);
      }
      return product;
    }

    // No DB access
    if (!context.prisma) {
      addWarning(product, this.name, 'No prisma client — skipping write');
      return product;
    }

    try {
      const route = product.approvalRoute;

      // ROUTE_REJECT — blocked, log and skip
      if (route === 'ROUTE_REJECT') {
        context.rowsSkipped++;
        this.log(`BLOCKED: ${product.name} — ${product.approvalReason}`);

        if (context.importJobId) {
          await context.prisma.productImportRecord.create({
            data: {
              tenantId: context.tenantId,
              importJobId: context.importJobId,
              rowIndex: product.rowIndex || 0,
              rawSourceData: product.rawSourceData || {},
              fingerprint: product.fingerprint,
              matchAction: 'SKIPPED',
            },
          });
          await context.prisma.importJob.update({
            where: { id: context.importJobId },
            data: { rowsSkipped: { increment: 1 } },
          });
        }
        return product;
      }

      // ROUTE_REVIEW — queue for human
      if (route === 'ROUTE_REVIEW') {
        const result = await queueProduct(product, context);
        if (result.queued) {
          this.log(
            `QUEUED: ${product.name} — ${product.approvalReason}`
          );
        } else {
          this.error('Queue failed', new Error(result.error));
          context.rowsFailed++;
        }
        return product;
      }

      // ROUTE_AUTO — write immediately
      if (route === 'ROUTE_AUTO') {
        const result = await writeProduct(product, context);
        if (result.written) {
          this.log(
            `${result.action}: ${product.name} ` +
            `(id: ${result.productId})`
          );
        } else if (result.action === 'REQUEUED') {
          this.warn(
            `Race condition on ${product.name} — re-queued`
          );
        } else {
          this.error('Write failed', new Error(result.error));
          context.rowsFailed++;
        }
        return product;
      }

      // Unknown route — default to queue
      this.warn(
        `Unknown approval route "${route}" — queuing for safety`
      );
      await queueProduct(product, context);
    } catch (err) {
      this.error('Write layer failed', err);
      addError(product, this.name, err.message, true);
      context.rowsFailed++;

      if (context.importJobId) {
        try {
          await context.prisma.importJob.update({
            where: { id: context.importJobId },
            data: { rowsFailed: { increment: 1 } },
          });
        } catch (_) {}
      }
    }

    return product;
  }
}

export { buildProductData, preWriteCheck, WriteLayer };
export default WriteLayer;
