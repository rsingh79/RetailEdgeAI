// server/src/services/agents/pipeline/pipelineContext.js
// Shared context object passed to every pipeline stage.

export function createPipelineContext(overrides = {}) {
  return {
    // Identity
    importJobId: null,
    tenantId: null,
    userId: null,

    // Database (tenant-scoped Prisma client)
    prisma: null,

    // Run configuration
    dryRun: false,
    syncMode: 'FULL',
    sourceType: null,
    sourceName: null,

    // Batch state (updated as pipeline runs)
    totalRows: 0,
    processedRows: 0,
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsFailed: 0,
    rowsPendingApproval: 0,

    // Timing
    startedAt: null,
    completedAt: null,

    // Stage-specific shared state (stages can write here)
    stageData: {},

    ...overrides,
  };
}
