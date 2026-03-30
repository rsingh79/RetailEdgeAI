// server/src/services/agents/pipeline/pipelineStage.js
// Base class every pipeline stage extends.

class PipelineStage {
  constructor(name) {
    this.name = name;
  }

  // Every stage must implement this method.
  // Receives: product (CanonicalProduct), context (PipelineContext)
  // Must return: the product (modified in place or new object)
  // Must never throw — catch all errors, call addError(), return product
  async process(product, context) {
    throw new Error(
      `Stage "${this.name}" must implement process(product, context)`
    );
  }

  // Called before process() — can be used for setup
  async setup(context) {}

  // Called after all products processed — can be used for teardown
  async teardown(context) {}

  log(message, data = null) {
    if (data) {
      console.log(`[Pipeline:${this.name}] ${message}`, data);
    } else {
      console.log(`[Pipeline:${this.name}] ${message}`);
    }
  }

  warn(message, data = null) {
    if (data) {
      console.warn(`[Pipeline:${this.name}] ${message}`, data);
    } else {
      console.warn(`[Pipeline:${this.name}] ${message}`);
    }
  }

  error(message, err = null) {
    if (err) {
      console.error(`[Pipeline:${this.name}] ${message}`, err.message);
    } else {
      console.error(`[Pipeline:${this.name}] ${message}`);
    }
  }
}

export default PipelineStage;
