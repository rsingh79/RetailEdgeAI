// server/src/services/agents/pipeline/pipelineRunner.js
// Orchestrator that runs a batch of products through an ordered list of stages.

import { addError, hasFatalError } from './canonicalProduct.js';

class PipelineRunner {
  constructor(stages = []) {
    this.stages = stages;
  }

  // Run all products through all stages in order.
  // products: CanonicalProduct[]
  // context:  PipelineContext
  // Returns:  { products, context, errors }
  async run(products, context) {
    context.startedAt = new Date();
    context.totalRows = products.length;

    console.log(
      `[PipelineRunner] Starting — ${products.length} products,` +
      ` ${this.stages.length} stages, dryRun: ${context.dryRun}`
    );

    // Setup all stages before processing begins
    for (const stage of this.stages) {
      try {
        await stage.setup(context);
      } catch (err) {
        console.error(
          `[PipelineRunner] Stage setup failed: ${stage.name}`,
          err.message
        );
      }
    }

    const runErrors = [];

    // Process each product through each stage in order
    for (let i = 0; i < products.length; i++) {
      let product = products[i];
      context.processedRows = i + 1;

      for (const stage of this.stages) {
        // If the product has a fatal error skip remaining stages
        if (hasFatalError(product)) {
          stage.warn(
            `Skipping product ${i + 1} — fatal error from prior stage`
          );
          break;
        }

        try {
          product = await stage.process(product, context);
          if (!product) {
            throw new Error(
              `Stage "${stage.name}" returned null or undefined`
            );
          }
        } catch (err) {
          console.error(
            `[PipelineRunner] Unhandled error in stage "${stage.name}"` +
            ` for product ${i + 1}:`,
            err.message
          );
          addError(product, stage.name, err.message, true);
          runErrors.push({ stage: stage.name, rowIndex: i, error: err.message });
        }
      }

      products[i] = product;
    }

    // Teardown all stages after processing completes
    for (const stage of this.stages) {
      try {
        await stage.teardown(context);
      } catch (err) {
        console.error(
          `[PipelineRunner] Stage teardown failed: ${stage.name}`,
          err.message
        );
      }
    }

    context.completedAt = new Date();
    const durationMs =
      context.completedAt.getTime() - context.startedAt.getTime();

    console.log(
      `[PipelineRunner] Complete — ${durationMs}ms` +
      ` | created: ${context.rowsCreated}` +
      ` | updated: ${context.rowsUpdated}` +
      ` | skipped: ${context.rowsSkipped}` +
      ` | failed: ${context.rowsFailed}` +
      ` | pending: ${context.rowsPendingApproval}`
    );

    return { products, context, errors: runErrors };
  }
}

export default PipelineRunner;
