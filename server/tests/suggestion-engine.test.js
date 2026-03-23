/**
 * Tests for the Suggestion Engine.
 *
 * Tests the aggregation, failure pattern detection, override clustering,
 * and batch ID generation using sample interaction data.
 * (LLM calls are NOT tested — only the deterministic logic.)
 */
import { describe, it, expect } from 'vitest';
import {
  _aggregateStats,
  _identifyFailurePatterns,
  _clusterOverrides,
  _generateBatchId,
} from '../src/services/suggestionEngine.js';

// ── Sample interaction signal data ──

function makeSignal(overrides = {}) {
  return {
    id: `sig_${Math.random().toString(36).slice(2, 8)}`,
    tenantId: 'tenant_test',
    agentRoleId: 'role_matching',
    resolutionStatus: 'resolved',
    userSatisfactionScore: null,
    humanOverride: false,
    humanOverrideDiff: null,
    correctionCount: 0,
    escalationOccurred: false,
    failureReason: null,
    topicTags: [],
    tokenCount: 500,
    latencyMs: 2000,
    costUsd: 0.01,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('SuggestionEngine', () => {
  describe('aggregateStats', () => {
    it('calculates summary statistics correctly', () => {
      const signals = [
        makeSignal({ resolutionStatus: 'resolved', userSatisfactionScore: 5 }),
        makeSignal({ resolutionStatus: 'resolved', userSatisfactionScore: 4 }),
        makeSignal({ resolutionStatus: 'failed', failureReason: 'timeout' }),
        makeSignal({ resolutionStatus: 'abandoned' }),
        makeSignal({ resolutionStatus: 'resolved', humanOverride: true }),
        makeSignal({ resolutionStatus: 'resolved', escalationOccurred: true }),
      ];

      const stats = _aggregateStats(signals);

      expect(stats.summary.total).toBe(6);
      expect(stats.summary.resolved).toBe(4);
      expect(stats.summary.failed).toBe(1);
      expect(stats.summary.abandoned).toBe(1);
      expect(stats.summary.escalated).toBe(1);
      expect(stats.summary.overrides).toBe(1);
      expect(stats.summary.resolutionRate).toBeCloseTo(4 / 6);
      expect(stats.summary.overrideRate).toBeCloseTo(1 / 6);
      expect(stats.summary.avgSatisfaction).toBeCloseTo(4.5); // (5+4)/2
    });

    it('groups by topic tags', () => {
      const signals = [
        makeSignal({ topicTags: ['supplier:FreshCo'], resolutionStatus: 'resolved' }),
        makeSignal({ topicTags: ['supplier:FreshCo'], resolutionStatus: 'failed' }),
        makeSignal({ topicTags: ['supplier:FreshCo'], humanOverride: true }),
        makeSignal({ topicTags: ['supplier:NutCo'], resolutionStatus: 'resolved' }),
      ];

      const stats = _aggregateStats(signals);
      const freshCoTopic = stats.topicStats.find((t) => t.topic === 'supplier:FreshCo');
      const nutCoTopic = stats.topicStats.find((t) => t.topic === 'supplier:NutCo');

      expect(freshCoTopic).toBeDefined();
      expect(freshCoTopic.count).toBe(3);
      expect(freshCoTopic.resolutionRate).toBeCloseTo(2 / 3); // resolved + override(resolved) = 2, failed = 1
      expect(freshCoTopic.overrideRate).toBeCloseTo(1 / 3);

      expect(nutCoTopic).toBeDefined();
      expect(nutCoTopic.count).toBe(1);
      expect(nutCoTopic.resolutionRate).toBe(1);
    });

    it('handles empty signals', () => {
      const stats = _aggregateStats([]);
      expect(stats.summary.total).toBe(0);
      expect(stats.summary.resolutionRate).toBe(0);
      expect(stats.summary.avgSatisfaction).toBeNull();
    });
  });

  describe('identifyFailurePatterns', () => {
    it('detects high override rate', () => {
      // 10 signals, 4 with overrides (40% > 30% threshold)
      const signals = [
        ...Array(6).fill(null).map(() => makeSignal()),
        ...Array(4).fill(null).map(() => makeSignal({ humanOverride: true })),
      ];

      const stats = _aggregateStats(signals);
      const patterns = _identifyFailurePatterns(stats);

      const overridePattern = patterns.find((p) => p.type === 'high_override_rate');
      expect(overridePattern).toBeDefined();
      expect(overridePattern.value).toBeCloseTo(0.4);
    });

    it('detects low satisfaction', () => {
      const signals = Array(10).fill(null).map(() =>
        makeSignal({ userSatisfactionScore: 2 })
      );

      const stats = _aggregateStats(signals);
      const patterns = _identifyFailurePatterns(stats);

      const satPattern = patterns.find((p) => p.type === 'low_satisfaction');
      expect(satPattern).toBeDefined();
      expect(satPattern.value).toBe(2);
    });

    it('detects topic-specific high override rate', () => {
      // Overall override rate: 3/12 = 25%
      // supplier:BadCo override rate: 3/4 = 75% (>> 25%)
      const signals = [
        ...Array(8).fill(null).map(() => makeSignal({ topicTags: ['supplier:GoodCo'] })),
        makeSignal({ topicTags: ['supplier:BadCo'], humanOverride: true }),
        makeSignal({ topicTags: ['supplier:BadCo'], humanOverride: true }),
        makeSignal({ topicTags: ['supplier:BadCo'], humanOverride: true }),
        makeSignal({ topicTags: ['supplier:BadCo'] }),
      ];

      const stats = _aggregateStats(signals);
      const patterns = _identifyFailurePatterns(stats);

      const topicPattern = patterns.find(
        (p) => p.type === 'topic_high_override' && p.topic === 'supplier:BadCo'
      );
      expect(topicPattern).toBeDefined();
      expect(topicPattern.value).toBeCloseTo(0.75);
    });

    it('returns empty when everything is healthy', () => {
      const signals = Array(10).fill(null).map(() =>
        makeSignal({ resolutionStatus: 'resolved', userSatisfactionScore: 5 })
      );

      const stats = _aggregateStats(signals);
      const patterns = _identifyFailurePatterns(stats);

      expect(patterns.length).toBe(0);
    });
  });

  describe('clusterOverrides', () => {
    it('clusters wrong product match overrides', () => {
      const overrideSignals = [
        makeSignal({
          humanOverride: true,
          humanOverrideDiff: {
            lineDescription: 'Almonds Raw 1kg',
            aiSuggestions: [{ productName: 'Almond Butter', confidence: 0.6 }],
            aiHadSuggestions: true,
            aiTopWasCorrect: false,
            userSelected: [{ name: 'Raw Almonds' }],
          },
        }),
        makeSignal({
          humanOverride: true,
          humanOverrideDiff: {
            lineDescription: 'Cashews Roasted 500g',
            aiSuggestions: [{ productName: 'Cashew Paste', confidence: 0.55 }],
            aiHadSuggestions: true,
            aiTopWasCorrect: false,
            userSelected: [{ name: 'Roasted Cashews' }],
          },
        }),
        makeSignal({
          humanOverride: true,
          humanOverrideDiff: {
            lineDescription: 'Walnuts Halves',
            aiSuggestions: [{ productName: 'Mixed Nuts', confidence: 0.5 }],
            aiHadSuggestions: true,
            aiTopWasCorrect: false,
            userSelected: [{ name: 'Walnut Halves' }],
          },
        }),
      ];

      const clusters = _clusterOverrides(overrideSignals);

      expect(clusters.length).toBe(1);
      expect(clusters[0].type).toBe('wrong_product_match');
      expect(clusters[0].count).toBe(3);
      expect(clusters[0].examples.length).toBe(3);
      expect(clusters[0].examples[0].lineDescription).toBe('Almonds Raw 1kg');
    });

    it('clusters no-match-found overrides separately', () => {
      const overrideSignals = [
        makeSignal({
          humanOverride: true,
          humanOverrideDiff: {
            lineDescription: 'Specialty Spice Blend',
            aiHadSuggestions: false,
            aiTopWasCorrect: false,
            userSelected: [{ name: 'Custom Spice Mix' }],
          },
        }),
        makeSignal({
          humanOverride: true,
          humanOverrideDiff: {
            lineDescription: 'Artisan Olive Oil',
            aiHadSuggestions: false,
            aiTopWasCorrect: false,
            userSelected: [{ name: 'Premium Olive Oil' }],
          },
        }),
      ];

      const clusters = _clusterOverrides(overrideSignals);
      expect(clusters.length).toBe(1);
      expect(clusters[0].type).toBe('no_match_found');
      expect(clusters[0].count).toBe(2);
    });

    it('filters out clusters with fewer than 2 occurrences', () => {
      const overrideSignals = [
        makeSignal({
          humanOverride: true,
          humanOverrideDiff: {
            lineDescription: 'One-off item',
            aiHadSuggestions: true,
            aiTopWasCorrect: false,
            aiSuggestions: [{ productName: 'Wrong' }],
            userSelected: [{ name: 'Right' }],
          },
        }),
      ];

      const clusters = _clusterOverrides(overrideSignals);
      expect(clusters.length).toBe(0); // single occurrence filtered out
    });

    it('handles empty override list', () => {
      const clusters = _clusterOverrides([]);
      expect(clusters.length).toBe(0);
    });
  });

  describe('generateBatchId', () => {
    it('produces deterministic batch IDs', () => {
      const date = new Date('2026-03-15T00:00:00Z');
      const id1 = _generateBatchId('tenant1', 'product_matching', date);
      const id2 = _generateBatchId('tenant1', 'product_matching', date);
      expect(id1).toBe(id2);
    });

    it('produces different IDs for different tenants', () => {
      const date = new Date('2026-03-15T00:00:00Z');
      const id1 = _generateBatchId('tenant1', 'product_matching', date);
      const id2 = _generateBatchId('tenant2', 'product_matching', date);
      expect(id1).not.toBe(id2);
    });

    it('produces different IDs for different dates', () => {
      const id1 = _generateBatchId('tenant1', 'ocr', new Date('2026-03-15'));
      const id2 = _generateBatchId('tenant1', 'ocr', new Date('2026-03-16'));
      expect(id1).not.toBe(id2);
    });

    it('returns a 16-character hex string', () => {
      const id = _generateBatchId('t', 'r', new Date());
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('full pipeline simulation', () => {
    it('detects patterns from realistic retail interaction data', () => {
      // Simulate 2 weeks of a nut/dried goods retailer
      const signals = [
        // Good matches — resolved, no overrides
        ...Array(15).fill(null).map(() => makeSignal({
          resolutionStatus: 'resolved',
          topicTags: ['supplier:MelbourneNutCo'],
        })),
        // Bad matches from a specific supplier — user had to override
        makeSignal({ resolutionStatus: 'resolved', humanOverride: true, topicTags: ['supplier:FreshFarms'], humanOverrideDiff: { aiTopWasCorrect: false, aiSuggestions: [{ productName: 'Mixed Nuts', confidence: 0.5 }], aiHadSuggestions: true, userSelected: [{ name: 'Organic Walnuts' }], lineDescription: 'Org Walnuts 1kg' } }),
        makeSignal({ resolutionStatus: 'resolved', humanOverride: true, topicTags: ['supplier:FreshFarms'], humanOverrideDiff: { aiTopWasCorrect: false, aiSuggestions: [{ productName: 'Trail Mix', confidence: 0.45 }], aiHadSuggestions: true, userSelected: [{ name: 'Dried Cranberries' }], lineDescription: 'Dried Cran 500g' } }),
        makeSignal({ resolutionStatus: 'resolved', humanOverride: true, topicTags: ['supplier:FreshFarms'], humanOverrideDiff: { aiTopWasCorrect: false, aiSuggestions: [{ productName: 'Cashew Raw', confidence: 0.6 }], aiHadSuggestions: true, userSelected: [{ name: 'Roasted Cashews Salted' }], lineDescription: 'R/Cashews Salted 250g' } }),
        // OCR failures
        makeSignal({ resolutionStatus: 'failed', topicTags: ['supplier:FreshFarms'], failureReason: 'OCR response missing lineItems' }),
        // Re-OCR escalation
        makeSignal({ resolutionStatus: 'escalated', escalationOccurred: true, topicTags: ['reocr', 'supplier:FreshFarms'] }),
      ];

      const stats = _aggregateStats(signals);
      const patterns = _identifyFailurePatterns(stats);
      const overrideClusters = _clusterOverrides(signals.filter((s) => s.humanOverride && s.humanOverrideDiff));

      // Should detect topic-specific issues with FreshFarms
      // 15 good + 3 overrides + 1 failed + 1 escalated = 20
      expect(stats.summary.total).toBe(20);
      expect(stats.summary.overrides).toBe(3);

      // FreshFarms: 3 overrides + 1 failed + 1 escalated = 5 signals
      const freshFarmsTopic = stats.topicStats.find((t) => t.topic === 'supplier:FreshFarms');
      expect(freshFarmsTopic).toBeDefined();
      expect(freshFarmsTopic.overrideRate).toBeCloseTo(3 / 5); // 3 overrides out of 5 FreshFarms signals

      // Should detect the wrong_product_match cluster
      expect(overrideClusters.length).toBe(1);
      expect(overrideClusters[0].type).toBe('wrong_product_match');
      expect(overrideClusters[0].count).toBe(3);

      // Should detect topic-specific high override for FreshFarms
      const topicPattern = patterns.find(
        (p) => p.type === 'topic_high_override' && p.topic === 'supplier:FreshFarms'
      );
      expect(topicPattern).toBeDefined();
    });
  });
});
