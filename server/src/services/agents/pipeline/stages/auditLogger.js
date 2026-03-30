// server/src/services/agents/pipeline/stages/auditLogger.js
// Audit Logger — Stage M of the product import pipeline.
// Writes AuditLog entries and emits InteractionSignals.
// Runs after the Write Layer. All writes are fire-and-forget.

import PipelineStage from '../pipelineStage.js';

// ── PART 1 — Write AuditLog entry ──

async function writeAuditLog(product, context, action) {
  try {
    if (context.dryRun) return;
    if (!context.prisma) return;
    if (!context.importJobId) return;

    await context.prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        userId: context.userId || null,
        action: action,
        entityType: 'Product',
        entityId: product.matchResult?.matchedProductId ||
          product.name || 'unknown',
        importJobId: context.importJobId,
        triggerSource: 'SYSTEM_PROCESS',
        triggerFunction: 'WriteLayer.process',
        triggerContext: {
          importJobId: context.importJobId,
          sourceSystem: product.sourceSystem,
          rowIndex: product.rowIndex,
          confidenceScore: product.confidenceScore,
          approvalRoute: product.approvalRoute,
          matchAction: product.matchResult?.action,
          invoiceRiskLevel: product.invoiceRisk?.level,
        },
        newVal: {
          name: product.name,
          barcode: product.barcode,
          sku: product.sku,
          price: product.price,
          costPrice: product.costPrice,
          category: product.category,
          source: product.sourceSystem,
        },
        metadata: {
          approvalReason: product.approvalReason,
          fingerprintTier: product.fingerprintTier,
          fingerprint: product.fingerprint,
          warnings: product.warnings?.length || 0,
          errors: product.errors?.length || 0,
        },
      },
    });
  } catch (err) {
    console.error('[AuditLogger] writeAuditLog failed:', err.message);
  }
}

// ── PART 2 — Emit InteractionSignal ──

async function emitInteractionSignal(product, context) {
  try {
    if (context.dryRun) return;
    if (!context.prisma) return;
    if (!context.stageData.agentRoleId) return;

    await context.prisma.interactionSignal.create({
      data: {
        tenantId: context.tenantId,
        agentRoleId: context.stageData.agentRoleId,
        baseVersionUsed: context.stageData.baseVersionId || 'unknown',
        resolutionStatus: product.approvalRoute === 'ROUTE_AUTO'
          ? 'resolved'
          : product.approvalRoute === 'ROUTE_REJECT'
            ? 'skipped'
            : 'pending',
        humanOverride: false,
        correctionCount: 0,
        topicTags: ['product_import'],
        tokenCount: context.stageData.totalTokens || 0,
        costUsd: context.stageData.totalCostUsd || 0,
        userId: context.userId || null,
        conversationId: `product_import_${context.importJobId}`,
      },
    });
  } catch (err) {
    console.error('[AuditLogger] emitInteractionSignal failed:', err.message);
  }
}

// ── PART 3 — AuditLogger stage class ──

class AuditLogger extends PipelineStage {
  constructor() {
    super('audit_logger');
  }

  async process(product, context) {
    const route = product.approvalRoute;
    const action = product.matchResult?.action;

    let auditAction = 'PRODUCT_IMPORT_FAILED';
    if (route === 'ROUTE_REJECT') {
      auditAction = 'PRODUCT_SKIPPED';
    } else if (route === 'ROUTE_AUTO' && action === 'CREATE') {
      auditAction = 'PRODUCT_IMPORTED';
    } else if (route === 'ROUTE_AUTO' && action === 'UPDATE') {
      auditAction = 'PRODUCT_UPDATED';
    } else if (route === 'ROUTE_REVIEW') {
      auditAction = 'PRODUCT_QUEUED_FOR_REVIEW';
    }

    if (product.errors?.some((e) => e.fatal)) {
      auditAction = 'PRODUCT_IMPORT_FAILED';
    }

    // Fire-and-forget — never block the pipeline
    writeAuditLog(product, context, auditAction).catch((err) =>
      this.error('AuditLog write failed', err)
    );

    if (context.stageData.agentRoleId) {
      emitInteractionSignal(product, context).catch((err) =>
        this.error('InteractionSignal emit failed', err)
      );
    }

    return product;
  }

  async teardown(context) {
    if (!context.prisma || !context.importJobId || context.dryRun) {
      return;
    }

    try {
      await context.prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          userId: context.userId || null,
          action: 'IMPORT_JOB_COMPLETED',
          entityType: 'ImportJob',
          entityId: context.importJobId,
          importJobId: context.importJobId,
          triggerSource: 'SYSTEM_PROCESS',
          triggerFunction: 'AuditLogger.teardown',
          triggerContext: {
            importJobId: context.importJobId,
          },
          newVal: {
            totalRows: context.totalRows,
            rowsCreated: context.rowsCreated,
            rowsUpdated: context.rowsUpdated,
            rowsSkipped: context.rowsSkipped,
            rowsFailed: context.rowsFailed,
            rowsPendingApproval: context.rowsPendingApproval,
            durationMs:
              context.completedAt && context.startedAt
                ? context.completedAt.getTime() - context.startedAt.getTime()
                : null,
          },
          metadata: {
            sourceSystem: context.sourceName,
            sourceType: context.sourceType,
            dryRun: context.dryRun,
          },
        },
      });

      await context.prisma.importJob.update({
        where: { id: context.importJobId },
        data: {
          status: 'COMPLETE',
          completedAt: new Date(),
          rowsCreated: context.rowsCreated,
          rowsUpdated: context.rowsUpdated,
          rowsSkipped: context.rowsSkipped,
          rowsFailed: context.rowsFailed,
          rowsPendingApproval: context.rowsPendingApproval,
        },
      });

      this.log(`Job ${context.importJobId} marked COMPLETE`);
    } catch (err) {
      this.error('Teardown audit failed', err);
    }
  }
}

export { writeAuditLog, AuditLogger };
export default AuditLogger;
