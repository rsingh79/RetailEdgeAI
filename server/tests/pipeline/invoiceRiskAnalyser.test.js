import { describe, it, expect } from 'vitest';
import {
  computeNameSimilarity,
  classifyInvoiceRisk,
} from '../../src/services/agents/pipeline/stages/invoiceRiskAnalyser.js';

describe('computeNameSimilarity', () => {
  it('returns 100 for identical names', () => {
    expect(computeNameSimilarity('olive oil 500ml', 'olive oil 500ml')).toBe(100);
  });

  it('returns 0 for completely different names', () => {
    expect(computeNameSimilarity('coffee beans', 'mineral water')).toBe(0);
  });

  it('returns partial score for partial overlap', () => {
    const score = computeNameSimilarity('olive oil 500ml', 'olive oil 1L');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('handles empty strings without throwing', () => {
    expect(computeNameSimilarity('', '')).toBe(0);
    expect(computeNameSimilarity('test', '')).toBe(0);
    expect(computeNameSimilarity('', 'test')).toBe(0);
    expect(computeNameSimilarity(null, null)).toBe(0);
  });
});

describe('classifyInvoiceRisk', () => {
  it('returns HIGH for >= 85% + open invoices', () => {
    expect(classifyInvoiceRisk(90, {
      hasOpenInvoices: true, sameCategory: false,
      sameBrand: false, recentlyCreated: false,
    })).toBe('HIGH');
  });

  it('returns HIGH for >= 85% + same category', () => {
    expect(classifyInvoiceRisk(87, {
      hasOpenInvoices: false, sameCategory: true,
      sameBrand: false, recentlyCreated: false,
    })).toBe('HIGH');
  });

  it('returns HIGH for >= 75% + open invoices', () => {
    expect(classifyInvoiceRisk(78, {
      hasOpenInvoices: true, sameCategory: false,
      sameBrand: false, recentlyCreated: false,
    })).toBe('HIGH');
  });

  it('returns MEDIUM for 85% with no signals', () => {
    expect(classifyInvoiceRisk(85, {
      hasOpenInvoices: false, sameCategory: false,
      sameBrand: false, recentlyCreated: false,
    })).toBe('MEDIUM');
  });

  it('returns LOW for 75-79% similarity', () => {
    expect(classifyInvoiceRisk(77, {
      hasOpenInvoices: false, sameCategory: false,
      sameBrand: false, recentlyCreated: false,
    })).toBe('LOW');
  });

  it('returns NONE for < 75% similarity', () => {
    expect(classifyInvoiceRisk(60, {
      hasOpenInvoices: true, sameCategory: true,
      sameBrand: true, recentlyCreated: true,
    })).toBe('NONE');
  });
});
