/**
 * Tests for the Interaction Signal Collector.
 *
 * Verifies:
 * 1. Signals accumulate in the buffer without blocking
 * 2. Partial signals merge correctly across multiple calls
 * 3. emitSignal moves accumulated data to the flush buffer
 * 4. Buffer respects size limits
 * 5. All 6 signal types are captured correctly
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordPromptMeta,
  recordOutcome,
  recordSatisfaction,
  recordHumanOverride,
  recordCorrectionCount,
  recordEscalation,
  recordUsage,
  emitSignal,
  _getBufferSize,
  _getPartials,
  _clearAll,
} from '../src/services/signalCollector.js';

beforeEach(() => {
  _clearAll();
});

describe('SignalCollector', () => {
  describe('partial accumulation', () => {
    it('accumulates partial signals under a session key', () => {
      const key = 'test:conv1';

      recordPromptMeta(key, {
        agentRoleKey: 'business_advisor',
        tenantId: 'tenant1',
        userId: 'user1',
        baseVersionId: 'ver1',
      });

      recordOutcome(key, { resolutionStatus: 'resolved' });
      recordSatisfaction(key, 5);

      const partials = _getPartials();
      expect(partials.has(key)).toBe(true);

      const partial = partials.get(key);
      expect(partial.agentRoleKey).toBe('business_advisor');
      expect(partial.tenantId).toBe('tenant1');
      expect(partial.resolutionStatus).toBe('resolved');
      expect(partial.userSatisfactionScore).toBe(5);
    });

    it('accumulates usage across multiple calls', () => {
      const key = 'test:conv2';

      recordPromptMeta(key, {
        agentRoleKey: 'ocr_extraction',
        tenantId: 't1',
        baseVersionId: 'v1',
      });

      recordUsage(key, { tokenCount: 100, latencyMs: 500, costUsd: 0.01 });
      recordUsage(key, { tokenCount: 200, latencyMs: 300, costUsd: 0.02 });

      const partial = _getPartials().get(key);
      expect(partial.tokenCount).toBe(300);
      expect(partial.latencyMs).toBe(800);
      expect(partial.costUsd).toBeCloseTo(0.03);
    });
  });

  describe('emitSignal', () => {
    it('moves partial to buffer and clears partial', () => {
      const key = 'test:emit1';

      recordPromptMeta(key, {
        agentRoleKey: 'business_advisor',
        tenantId: 'tenant1',
        baseVersionId: 'ver1',
      });
      recordOutcome(key, { resolutionStatus: 'resolved' });

      expect(_getPartials().has(key)).toBe(true);
      expect(_getBufferSize()).toBe(0);

      emitSignal(key, 'conversation-123');

      expect(_getPartials().has(key)).toBe(false);
      expect(_getBufferSize()).toBe(1);
    });

    it('ignores emit for unknown session key', () => {
      emitSignal('nonexistent');
      expect(_getBufferSize()).toBe(0);
    });

    it('drops signal if tenantId is missing', () => {
      const key = 'test:no-tenant';
      recordOutcome(key, { resolutionStatus: 'resolved' });
      // No recordPromptMeta called — tenantId will be undefined

      emitSignal(key);
      expect(_getBufferSize()).toBe(0);
    });
  });

  describe('all 6 signal types', () => {
    it('SIGNAL 1: conversation outcome', () => {
      const key = 'test:s1';
      recordPromptMeta(key, { agentRoleKey: 'business_advisor', tenantId: 't1', baseVersionId: 'v1' });
      recordOutcome(key, {
        resolutionStatus: 'escalated',
        topicTags: ['pricing', 'margin'],
        failureReason: null,
      });
      emitSignal(key);

      expect(_getBufferSize()).toBe(1);
    });

    it('SIGNAL 2: user satisfaction', () => {
      const key = 'test:s2';
      recordPromptMeta(key, { agentRoleKey: 'business_advisor', tenantId: 't1', baseVersionId: 'v1' });
      recordSatisfaction(key, 1); // thumbs down
      emitSignal(key);

      expect(_getBufferSize()).toBe(1);
    });

    it('SIGNAL 3: human override (highest value)', () => {
      const key = 'test:s3';
      recordPromptMeta(key, { agentRoleKey: 'product_matching', tenantId: 't1', baseVersionId: 'v1' });
      recordHumanOverride(key, {
        humanOverride: true,
        humanOverrideDiff: {
          lineDescription: 'Sunflower Kernels 1kg',
          selectedProductIds: ['prod_123'],
          isManual: true,
        },
      });
      emitSignal(key);

      expect(_getBufferSize()).toBe(1);
    });

    it('SIGNAL 4: correction count', () => {
      const key = 'test:s4';
      recordPromptMeta(key, { agentRoleKey: 'business_advisor', tenantId: 't1', baseVersionId: 'v1' });
      recordCorrectionCount(key, 3); // user rephrased 3 times
      emitSignal(key);

      expect(_getBufferSize()).toBe(1);
    });

    it('SIGNAL 5: escalation', () => {
      const key = 'test:s5';
      recordPromptMeta(key, { agentRoleKey: 'business_advisor', tenantId: 't1', baseVersionId: 'v1' });
      recordEscalation(key, true);
      emitSignal(key);

      expect(_getBufferSize()).toBe(1);
    });

    it('SIGNAL 6: prompt metadata', () => {
      const key = 'test:s6';
      recordPromptMeta(key, {
        agentRoleKey: 'ocr_extraction',
        tenantId: 't1',
        userId: 'u1',
        baseVersionId: 'ver_abc',
        tenantConfigId: 'cfg_xyz',
      });
      emitSignal(key);

      expect(_getBufferSize()).toBe(1);
    });
  });

  describe('complete conversation simulation', () => {
    it('simulates a full advisor chat interaction', () => {
      const convId = 'conv_sim_001';
      const key = `chat:${convId}`;

      // Step 1: Prompt assembled (from orchestrator)
      recordPromptMeta(key, {
        agentRoleKey: 'business_advisor',
        tenantId: 'tenant_green_grocer',
        userId: 'user_sarah',
        baseVersionId: 'ver_base_1',
        tenantConfigId: null,
      });

      // Step 2: User sends message, AI responds
      recordUsage(key, { tokenCount: 1500, latencyMs: 2340, costUsd: 0.0045 });

      // Step 3: Correction count (2 user messages before resolution)
      recordCorrectionCount(key, 1);

      // Step 4: Outcome — resolved successfully
      recordOutcome(key, {
        resolutionStatus: 'resolved',
        topicTags: ['supplier_spend', 'Melbourne Nut Co'],
      });

      // Step 5: Emit complete signal
      emitSignal(key, convId);

      expect(_getBufferSize()).toBe(1);
      expect(_getPartials().size).toBe(0);
    });

    it('simulates OCR extraction with failure', () => {
      const invoiceId = 'inv_fail_001';
      const key = `ocr:${invoiceId}`;

      recordPromptMeta(key, {
        agentRoleKey: 'ocr_extraction',
        tenantId: 'tenant_green_grocer',
        userId: 'user_sarah',
        baseVersionId: 'ver_ocr_1',
      });

      recordOutcome(key, {
        resolutionStatus: 'failed',
        failureReason: 'OCR response missing lineItems array',
      });

      recordUsage(key, { latencyMs: 5200 });

      emitSignal(key, invoiceId);

      expect(_getBufferSize()).toBe(1);
    });

    it('simulates manual match override (highest value signal)', () => {
      const key = 'override:inv_001:line_005';

      recordPromptMeta(key, {
        agentRoleKey: 'product_matching',
        tenantId: 'tenant_green_grocer',
        userId: 'user_sarah',
        baseVersionId: 'manual_match',
      });

      recordHumanOverride(key, {
        humanOverride: true,
        humanOverrideDiff: {
          lineDescription: 'Organic Almonds Raw 1kg',
          selectedProductIds: ['prod_almond_raw'],
          isManual: true,
          hadPriceOverrides: true,
        },
      });

      recordOutcome(key, { resolutionStatus: 'resolved' });
      emitSignal(key, 'inv_001');

      expect(_getBufferSize()).toBe(1);
    });
  });

  describe('buffer limits', () => {
    it('drops oldest signal when buffer exceeds MAX_BUFFER_SIZE', () => {
      // Fill buffer with 201 signals (MAX is 200)
      for (let i = 0; i < 201; i++) {
        const key = `test:overflow_${i}`;
        recordPromptMeta(key, {
          agentRoleKey: 'business_advisor',
          tenantId: 't1',
          baseVersionId: 'v1',
        });
        emitSignal(key);
      }

      // Buffer should be capped at 200 (one was dropped)
      expect(_getBufferSize()).toBeLessThanOrEqual(200);
    });
  });
});
