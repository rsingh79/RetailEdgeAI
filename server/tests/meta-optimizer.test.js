/**
 * Tests for the Meta-Optimization Agent.
 *
 * Tests the cross-tenant aggregation, outperformer detection,
 * and recommendation generation using sample data.
 * (LLM calls and DB writes are NOT tested — only deterministic logic.)
 */
import { describe, it, expect } from 'vitest';
import {
  _computeTenantStats,
  _computeBaseline,
  _identifyOutperformers,
  _generateCrossTenantRecommendations,
} from '../src/services/metaOptimizer.js';

function makeSignal(overrides = {}) {
  return {
    tenantId: 'tenant_default',
    resolutionStatus: 'resolved',
    userSatisfactionScore: null,
    humanOverride: false,
    escalationOccurred: false,
    correctionCount: 0,
    tokenCount: 500,
    latencyMs: 2000,
    costUsd: 0.01,
    configVersionUsed: null,
    ...overrides,
  };
}

describe('MetaOptimizer', () => {
  describe('computeTenantStats', () => {
    it('computes stats for a single tenant', () => {
      const signals = [
        makeSignal({ resolutionStatus: 'resolved', userSatisfactionScore: 5 }),
        makeSignal({ resolutionStatus: 'resolved', userSatisfactionScore: 4 }),
        makeSignal({ resolutionStatus: 'failed' }),
        makeSignal({ resolutionStatus: 'resolved', humanOverride: true }),
      ];

      const stats = _computeTenantStats('tenant1', signals);

      expect(stats.tenantId).toBe('tenant1');
      expect(stats.total).toBe(4);
      expect(stats.resolutionRate).toBeCloseTo(3 / 4);
      expect(stats.overrideRate).toBeCloseTo(1 / 4);
      expect(stats.avgSatisfaction).toBeCloseTo(4.5);
    });
  });

  describe('computeBaseline', () => {
    it('computes weighted baseline from multiple tenants', () => {
      const tenants = [
        { tenantId: 't1', total: 20, resolutionRate: 0.8, overrideRate: 0.1, escalationRate: 0.05, avgSatisfaction: 4.0 },
        { tenantId: 't2', total: 10, resolutionRate: 0.6, overrideRate: 0.3, escalationRate: 0.1, avgSatisfaction: 3.0 },
      ];

      const baseline = _computeBaseline(tenants);

      // Weighted by signal count: (0.8*20 + 0.6*10) / 30 = 22/30 ≈ 0.733
      expect(baseline.resolutionRate).toBeCloseTo(22 / 30);
      // Weighted override: (0.1*20 + 0.3*10) / 30 = 5/30 ≈ 0.167
      expect(baseline.overrideRate).toBeCloseTo(5 / 30);
      // Simple average satisfaction: (4.0 + 3.0) / 2 = 3.5
      expect(baseline.avgSatisfaction).toBeCloseTo(3.5);
      expect(baseline.tenantCount).toBe(2);
      expect(baseline.totalSignals).toBe(30);
    });

    it('returns zeros for empty tenant list', () => {
      const baseline = _computeBaseline([]);
      expect(baseline.resolutionRate).toBe(0);
      expect(baseline.tenantCount).toBe(0);
    });
  });

  describe('identifyOutperformers', () => {
    it('identifies tenants with significantly better resolution rate', () => {
      const crossTenantStats = {
        defaultBaseline: {
          resolutionRate: 0.65,
          overrideRate: 0.25,
          escalationRate: 0.1,
          avgSatisfaction: 3.0,
          tenantCount: 5,
        },
        customizedTenants: [
          {
            tenantId: 'good_tenant',
            total: 20,
            resolutionRate: 0.95,  // 65% → 95% = +30% (> 15% threshold)
            overrideRate: 0.05,
            escalationRate: 0.0,
            avgSatisfaction: 4.5,
            configVersionUsed: 'cfg_good',
          },
          {
            tenantId: 'normal_tenant',
            total: 15,
            resolutionRate: 0.70,  // 65% → 70% = +5% (< 15% threshold)
            overrideRate: 0.23,   // close to baseline 0.25, not significantly better
            escalationRate: 0.05,
            avgSatisfaction: 3.2,
            configVersionUsed: 'cfg_normal',
          },
        ],
      };

      const outperformers = _identifyOutperformers(crossTenantStats);

      expect(outperformers.length).toBe(1);
      expect(outperformers[0].tenantId).toBe('good_tenant');
      expect(outperformers[0].improvements.resolutionRate).toBeDefined();
      expect(outperformers[0].improvements.resolutionRate.delta).toBeCloseTo(0.3);
    });

    it('detects override rate reduction as improvement', () => {
      const crossTenantStats = {
        defaultBaseline: {
          resolutionRate: 0.80,
          overrideRate: 0.40,  // 40% overrides
          escalationRate: 0.1,
          avgSatisfaction: 3.0,
          tenantCount: 3,
        },
        customizedTenants: [
          {
            tenantId: 'low_override',
            total: 20,
            resolutionRate: 0.80,
            overrideRate: 0.10,  // 40% → 10% (75% reduction, >> 15% threshold)
            escalationRate: 0.05,
            avgSatisfaction: 3.0,
            configVersionUsed: 'cfg_low',
          },
        ],
      };

      const outperformers = _identifyOutperformers(crossTenantStats);

      expect(outperformers.length).toBe(1);
      expect(outperformers[0].improvements.overrideRate).toBeDefined();
      expect(outperformers[0].improvements.overrideRate.delta).toBeCloseTo(0.30);
    });

    it('returns empty when no significant improvement', () => {
      const crossTenantStats = {
        defaultBaseline: {
          resolutionRate: 0.80,
          overrideRate: 0.15,
          escalationRate: 0.05,
          avgSatisfaction: 4.0,
          tenantCount: 5,
        },
        customizedTenants: [
          {
            tenantId: 'similar',
            total: 15,
            resolutionRate: 0.82,  // only +2% (< 15%)
            overrideRate: 0.14,
            escalationRate: 0.04,
            avgSatisfaction: 4.1,
            configVersionUsed: 'cfg_similar',
          },
        ],
      };

      const outperformers = _identifyOutperformers(crossTenantStats);
      expect(outperformers.length).toBe(0);
    });

    it('returns empty when no default baseline exists', () => {
      const crossTenantStats = {
        defaultBaseline: { resolutionRate: 0, overrideRate: 0, tenantCount: 0 },
        customizedTenants: [],
      };

      const outperformers = _identifyOutperformers(crossTenantStats);
      expect(outperformers.length).toBe(0);
    });
  });

  describe('generateCrossTenantRecommendations', () => {
    it('recommends customization to default tenants with similar weaknesses', () => {
      const crossTenantStats = {
        defaultBaseline: {
          resolutionRate: 0.65,
          overrideRate: 0.30,
          tenantCount: 3,
        },
        defaultTenants: [
          { tenantId: 'weak_1', total: 15, resolutionRate: 0.60, overrideRate: 0.35, avgSatisfaction: 3.0 },
          { tenantId: 'weak_2', total: 12, resolutionRate: 0.55, overrideRate: 0.40, avgSatisfaction: 2.5 },
        ],
        customizedTenants: [],
      };

      const outperformers = [
        {
          tenantId: 'star_tenant',
          configVersionUsed: 'cfg_star',
          signalCount: 25,
          improvements: {
            resolutionRate: {
              tenantValue: 0.92,
              baseline: 0.65,
              delta: 0.27,
            },
          },
        },
      ];

      const recommendations = _generateCrossTenantRecommendations(crossTenantStats, outperformers);

      expect(recommendations.length).toBe(2); // both weak tenants
      expect(recommendations[0].tenantId).toBe('weak_1');
      expect(recommendations[0].type).toBe('ADOPT_CUSTOMIZATION');
      expect(recommendations[0].content.sourceOutperformer).toBe('star_tenant');
      expect(recommendations[0].content.metric).toBe('resolutionRate');
      expect(recommendations[1].tenantId).toBe('weak_2');
    });

    it('deduplicates to max 1 recommendation per tenant', () => {
      const crossTenantStats = {
        defaultBaseline: { resolutionRate: 0.65, overrideRate: 0.30, tenantCount: 2 },
        defaultTenants: [
          { tenantId: 'weak', total: 15, resolutionRate: 0.60, overrideRate: 0.35, avgSatisfaction: 3.0 },
        ],
        customizedTenants: [],
      };

      const outperformers = [
        {
          tenantId: 'star_1',
          configVersionUsed: 'cfg_1',
          signalCount: 20,
          improvements: {
            resolutionRate: { tenantValue: 0.90, baseline: 0.65, delta: 0.25 },
          },
        },
        {
          tenantId: 'star_2',
          configVersionUsed: 'cfg_2',
          signalCount: 18,
          improvements: {
            resolutionRate: { tenantValue: 0.88, baseline: 0.65, delta: 0.23 },
          },
        },
      ];

      const recommendations = _generateCrossTenantRecommendations(crossTenantStats, outperformers);

      // Should only have 1 recommendation for the weak tenant (deduped)
      expect(recommendations.length).toBe(1);
      expect(recommendations[0].tenantId).toBe('weak');
    });

    it('returns empty when no outperformers or default tenants', () => {
      const crossTenantStats = {
        defaultBaseline: { resolutionRate: 0.80, tenantCount: 0 },
        defaultTenants: [],
        customizedTenants: [],
      };

      const recommendations = _generateCrossTenantRecommendations(crossTenantStats, []);
      expect(recommendations.length).toBe(0);
    });
  });

  describe('full pipeline simulation', () => {
    it('simulates a realistic multi-tenant scenario', () => {
      // 3 tenants on defaults (performing average)
      const defaultTenants = [
        { tenantId: 'grocer_a', total: 20, resolutionRate: 0.65, overrideRate: 0.30, escalationRate: 0.1, avgSatisfaction: 3.0, hasConfig: false, configVersionUsed: null },
        { tenantId: 'grocer_b', total: 18, resolutionRate: 0.60, overrideRate: 0.35, escalationRate: 0.15, avgSatisfaction: 2.8, hasConfig: false, configVersionUsed: null },
        { tenantId: 'grocer_c', total: 22, resolutionRate: 0.70, overrideRate: 0.25, escalationRate: 0.05, avgSatisfaction: 3.5, hasConfig: false, configVersionUsed: null },
      ];

      // 2 customized tenants — one outperforms significantly
      const customizedTenants = [
        {
          tenantId: 'grocer_star', total: 25,
          resolutionRate: 0.92, overrideRate: 0.08, escalationRate: 0.02,
          avgSatisfaction: 4.5, hasConfig: true, configVersionUsed: 'cfg_star',
        },
        {
          tenantId: 'grocer_mid', total: 15,
          resolutionRate: 0.72, overrideRate: 0.20, escalationRate: 0.08,
          avgSatisfaction: 3.3, hasConfig: true, configVersionUsed: 'cfg_mid',
        },
      ];

      const defaultBaseline = _computeBaseline(defaultTenants);
      const customizedBaseline = _computeBaseline(customizedTenants);

      // Default baseline: weighted avg resolution ≈ (0.65*20 + 0.60*18 + 0.70*22) / 60
      expect(defaultBaseline.resolutionRate).toBeCloseTo((13 + 10.8 + 15.4) / 60);
      expect(defaultBaseline.tenantCount).toBe(3);

      // Find outperformers
      const crossTenantStats = { defaultBaseline, customizedTenants, defaultTenants };
      const outperformers = _identifyOutperformers(crossTenantStats);

      // grocer_star should be identified (resolution 92% vs baseline ~65%, override 8% vs ~30%)
      const starFound = outperformers.find((o) => o.tenantId === 'grocer_star');
      expect(starFound).toBeDefined();
      expect(starFound.improvements.resolutionRate).toBeDefined();

      // grocer_mid may also be detected if override rate improvement is significant
      // (its override rate 20% vs baseline ~30% is a notable improvement)
      expect(outperformers.length).toBeGreaterThanOrEqual(1);

      // Generate cross-tenant recommendations
      const recommendations = _generateCrossTenantRecommendations(crossTenantStats, outperformers);

      // Tenants with below-baseline metrics should get recommendations
      // grocer_c (0.70 resolution, 0.25 override) performs above baseline on some metrics
      // so it may not get a recommendation — only weak tenants do
      expect(recommendations.length).toBeGreaterThanOrEqual(2);
      const tenantIds = recommendations.map((r) => r.tenantId).sort();
      expect(tenantIds).toContain('grocer_a');
      expect(tenantIds).toContain('grocer_b');

      // Each recommendation should reference an outperformer and be ADOPT_CUSTOMIZATION
      for (const rec of recommendations) {
        expect(rec.type).toBe('ADOPT_CUSTOMIZATION');
        expect(rec.content.sourceOutperformer).toBeDefined();
      }
    });
  });
});
