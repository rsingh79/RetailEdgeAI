import { describe, it, expect } from 'vitest';
import { classifyProduct } from '../../src/services/agents/pipeline/stages/approvalClassifier.js';
import { createCanonicalProduct } from '../../src/services/agents/pipeline/canonicalProduct.js';

const baseContext = {
  stageData: {
    sourceTrusted: true,
    sourcePriorImports: 5,
    autoApproveThreshold: 95,
    protectedCategories: ['services', 'subscriptions'],
  },
};

function makeProduct(overrides = {}) {
  const p = createCanonicalProduct({
    name: 'Test Product',
    price: 9.99,
    currency: 'AUD',
    status: 'ACTIVE',
    ...overrides,
  });
  p.matchResult = { action: 'CREATE', matchScore: null };
  p.invoiceRisk = { level: 'NONE' };
  p.confidenceScore = 96;
  return p;
}

describe('classifyProduct', () => {
  it('routes SKIP action to ROUTE_REJECT', () => {
    const p = makeProduct();
    p.matchResult.action = 'SKIP';
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REJECT');
  });

  it('routes MERGE action to ROUTE_REVIEW', () => {
    const p = makeProduct();
    p.matchResult.action = 'MERGE';
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('routes UPDATE action to ROUTE_REVIEW', () => {
    const p = makeProduct();
    p.matchResult.action = 'UPDATE';
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('routes REVIEW action to ROUTE_REVIEW', () => {
    const p = makeProduct();
    p.matchResult.action = 'REVIEW';
    p.matchResult.matchScore = 85;
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('routes HIGH invoice risk to ROUTE_REVIEW even when confidence is high', () => {
    const p = makeProduct();
    p.confidenceScore = 99;
    p.invoiceRisk = { level: 'HIGH', explanation: 'risky' };
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('routes missing name to ROUTE_REVIEW', () => {
    const p = makeProduct({ name: null });
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('routes T3/T4 product on first import to ROUTE_REVIEW', () => {
    const p = makeProduct();
    p.fingerprintTier = 4;
    const ctx = {
      stageData: { ...baseContext.stageData, sourcePriorImports: 0 },
    };
    const { route } = classifyProduct(p, ctx);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('routes T1 product on first import to ROUTE_AUTO when confidence is high enough', () => {
    const p = makeProduct({ category: 'Dairy' });
    p.fingerprintTier = 1;
    p.confidenceScore = 91;
    p.matchResult = { action: 'CREATE' };
    p.invoiceRisk = { level: 'NONE' };
    const ctx = {
      stageData: { ...baseContext.stageData, sourcePriorImports: 0 },
    };
    const { route } = classifyProduct(p, ctx);
    expect(route).toBe('ROUTE_AUTO');
  });

  it('uses lower threshold for established trusted source', () => {
    const p = makeProduct({ category: 'Dairy' });
    p.fingerprintTier = 1;
    p.confidenceScore = 78;
    p.matchResult = { action: 'CREATE' };
    p.invoiceRisk = { level: 'NONE' };
    const ctx = {
      stageData: {
        sourceTrusted: true,
        sourcePriorImports: 5,
        autoApproveThreshold: 95,
        protectedCategories: ['services', 'subscriptions'],
      },
    };
    const { route } = classifyProduct(p, ctx);
    expect(route).toBe('ROUTE_AUTO');
  });

  it('routes to ROUTE_AUTO when ALL conditions met', () => {
    const p = makeProduct({ category: 'Dairy' });
    p.fingerprintTier = 1;
    p.confidenceScore = 96;
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_AUTO');
  });

  it('routes below-threshold to ROUTE_REVIEW', () => {
    const p = makeProduct();
    p.fingerprintTier = 1;
    p.confidenceScore = 50;
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('defaults to ROUTE_REVIEW on unknown route', () => {
    const p = makeProduct();
    p.matchResult.action = 'SOMETHING_UNKNOWN';
    p.confidenceScore = 96;
    // Unknown action doesn't match any early rule, falls through to Rule 8
    // Rule 8 requires action === 'CREATE', so it fails, Rule 9 default kicks in
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('never auto-approves when price and sellingPrice are both null', () => {
    const p = makeProduct({ price: null });
    p.sellingPrice = null; // explicitly null (not undefined) to trigger missing-price check
    p.confidenceScore = 99;
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });

  it('never auto-approves protected category (services, subscriptions)', () => {
    const p = makeProduct({ category: 'Services' });
    p.confidenceScore = 99;
    const { route } = classifyProduct(p, baseContext);
    expect(route).toBe('ROUTE_REVIEW');
  });
});
