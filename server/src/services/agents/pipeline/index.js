// Product Import Pipeline — entry point
// Exports all pipeline infrastructure for use by
// route handlers and the import agent

export { default as PipelineStage } from './pipelineStage.js';
export { default as PipelineRunner } from './pipelineRunner.js';
export { createPipelineContext } from './pipelineContext.js';
export {
  createCanonicalProduct,
  createCanonicalVariant,
  addError,
  addWarning,
  hasFatalError,
  isReadyToWrite,
} from './canonicalProduct.js';

export { default as NormalisationEngine,
  normaliseString,
  normaliseProduct,
} from './stages/normalisationEngine.js';

export { default as SourceResolver,
  inferSourceFromFilename,
  inferSourceFromHeaders,
} from './stages/sourceResolver.js';

export { default as FingerprintEngine,
  computeFingerprint,
} from './stages/fingerprintEngine.js';

export { default as CatalogMatcher,
  computeFieldDiff,
} from './stages/catalogMatcher.js';

export { default as InvoiceRiskAnalyser,
  computeNameSimilarity,
  classifyInvoiceRisk,
} from './stages/invoiceRiskAnalyser.js';

export { default as ConfidenceScorer,
  computeConfidenceScore,
} from './stages/confidenceScorer.js';

export { default as ApprovalClassifier,
  classifyProduct,
} from './stages/approvalClassifier.js';

export { default as WriteLayer,
  buildProductData,
  preWriteCheck,
} from './stages/writeLayer.js';

export { default as AuditLogger,
  writeAuditLog,
} from './stages/auditLogger.js';
