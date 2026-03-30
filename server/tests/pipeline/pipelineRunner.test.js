import { describe, it, expect, vi } from 'vitest';
import PipelineRunner from '../../src/services/agents/pipeline/pipelineRunner.js';
import PipelineStage from '../../src/services/agents/pipeline/pipelineStage.js';
import { createPipelineContext } from '../../src/services/agents/pipeline/pipelineContext.js';
import {
  createCanonicalProduct,
  addError,
} from '../../src/services/agents/pipeline/canonicalProduct.js';

class UppercaseStage extends PipelineStage {
  constructor() { super('uppercase'); }
  async process(product) {
    if (product.name) product.name = product.name.toUpperCase();
    return product;
  }
}

class CounterStage extends PipelineStage {
  constructor() { super('counter'); this.count = 0; }
  async process(product) { this.count++; return product; }
}

class ThrowingStage extends PipelineStage {
  constructor() { super('thrower'); }
  async process() { throw new Error('stage exploded'); }
}

class SetupTeardownStage extends PipelineStage {
  constructor() {
    super('lifecycle');
    this.setupCalled = false;
    this.teardownCalled = false;
  }
  async setup() { this.setupCalled = true; }
  async teardown() { this.teardownCalled = true; }
  async process(product) { return product; }
}

describe('PipelineRunner', () => {
  it('runs all stages in order', async () => {
    const log = [];
    class LogStage extends PipelineStage {
      constructor(name) { super(name); }
      async process(product) { log.push(this.name); return product; }
    }
    const runner = new PipelineRunner([
      new LogStage('A'), new LogStage('B'), new LogStage('C'),
    ]);
    const ctx = createPipelineContext({ tenantId: 't' });
    const products = [createCanonicalProduct({ name: 'Test' })];
    await runner.run(products, ctx);
    expect(log).toEqual(['A', 'B', 'C']);
  });

  it('passes context between stages', async () => {
    class WriterStage extends PipelineStage {
      constructor() { super('writer'); }
      async process(product, context) {
        context.stageData.writerRan = true;
        return product;
      }
    }
    class ReaderStage extends PipelineStage {
      constructor() { super('reader'); this.sawData = false; }
      async process(product, context) {
        this.sawData = context.stageData.writerRan === true;
        return product;
      }
    }
    const reader = new ReaderStage();
    const runner = new PipelineRunner([new WriterStage(), reader]);
    const ctx = createPipelineContext({ tenantId: 't' });
    await runner.run([createCanonicalProduct({ name: 'T' })], ctx);
    expect(reader.sawData).toBe(true);
  });

  it('skips remaining stages on fatal error', async () => {
    const counter = new CounterStage();
    class FatalStage extends PipelineStage {
      constructor() { super('fatal'); }
      async process(product) {
        addError(product, 'fatal', 'boom', true);
        return product;
      }
    }
    const runner = new PipelineRunner([
      new FatalStage(), counter,
    ]);
    const ctx = createPipelineContext({ tenantId: 't' });
    await runner.run([createCanonicalProduct({ name: 'T' })], ctx);
    expect(counter.count).toBe(0);
  });

  it('calls setup() on all stages before processing', async () => {
    const stage = new SetupTeardownStage();
    const runner = new PipelineRunner([stage]);
    const ctx = createPipelineContext({ tenantId: 't' });
    await runner.run([createCanonicalProduct({ name: 'T' })], ctx);
    expect(stage.setupCalled).toBe(true);
  });

  it('calls teardown() on all stages after processing', async () => {
    const stage = new SetupTeardownStage();
    const runner = new PipelineRunner([stage]);
    const ctx = createPipelineContext({ tenantId: 't' });
    await runner.run([createCanonicalProduct({ name: 'T' })], ctx);
    expect(stage.teardownCalled).toBe(true);
  });

  it('handles a stage that throws without crashing other products', async () => {
    const counter = new CounterStage();
    const runner = new PipelineRunner([
      new ThrowingStage(), counter,
    ]);
    const ctx = createPipelineContext({ tenantId: 't' });
    const products = [
      createCanonicalProduct({ name: 'P1' }),
      createCanonicalProduct({ name: 'P2' }),
    ];
    const result = await runner.run(products, ctx);
    // Both products should still be returned
    expect(result.products).toHaveLength(2);
    // Both have fatal errors from the throw
    expect(result.products[0].errors).toHaveLength(1);
    expect(result.products[1].errors).toHaveLength(1);
    // Errors are recorded in run errors
    expect(result.errors).toHaveLength(2);
  });

  it('updates context.processedRows as it runs', async () => {
    const runner = new PipelineRunner([new UppercaseStage()]);
    const ctx = createPipelineContext({ tenantId: 't' });
    const products = [
      createCanonicalProduct({ name: 'a' }),
      createCanonicalProduct({ name: 'b' }),
      createCanonicalProduct({ name: 'c' }),
    ];
    await runner.run(products, ctx);
    expect(ctx.processedRows).toBe(3);
  });

  it('returns all products and final context', async () => {
    const runner = new PipelineRunner([new UppercaseStage()]);
    const ctx = createPipelineContext({ tenantId: 't' });
    const products = [
      createCanonicalProduct({ name: 'hello' }),
    ];
    const result = await runner.run(products, ctx);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('HELLO');
    expect(result.context).toBe(ctx);
    expect(result.context.startedAt).toBeInstanceOf(Date);
    expect(result.context.completedAt).toBeInstanceOf(Date);
  });

  it('works with zero products (empty batch)', async () => {
    const runner = new PipelineRunner([new UppercaseStage()]);
    const ctx = createPipelineContext({ tenantId: 't' });
    const result = await runner.run([], ctx);
    expect(result.products).toHaveLength(0);
    expect(result.context.totalRows).toBe(0);
  });

  it('works with a single product', async () => {
    const runner = new PipelineRunner([new UppercaseStage()]);
    const ctx = createPipelineContext({ tenantId: 't' });
    const result = await runner.run(
      [createCanonicalProduct({ name: 'single' })],
      ctx
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0].name).toBe('SINGLE');
    expect(result.context.processedRows).toBe(1);
  });
});
