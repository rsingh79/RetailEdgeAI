import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerIntegrationHook,
  executeHook,
  hasHook,
  clearHooks,
} from '../../../src/services/integrationHooks.js';

beforeEach(() => {
  clearHooks();
});

describe('registerIntegrationHook', () => {
  it('registers a handler for a source system', () => {
    const handler = vi.fn();
    registerIntegrationHook('shopify', handler);
    expect(hasHook('shopify')).toBe(true);
  });

  it('overwrites existing handler on re-registration', async () => {
    const first = vi.fn();
    const second = vi.fn();
    registerIntegrationHook('shopify', first);
    registerIntegrationHook('shopify', second);

    const product = { id: '1' };
    const meta = { variants: [] };
    await executeHook('shopify', product, meta, {});

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(product, meta, {});
  });

  it('uses case-insensitive source system matching', () => {
    registerIntegrationHook('Shopify', vi.fn());
    expect(hasHook('shopify')).toBe(true);
    expect(hasHook('SHOPIFY')).toBe(true);
  });
});

describe('executeHook', () => {
  it('calls the registered handler with product, metadata, and prisma', async () => {
    const handler = vi.fn();
    registerIntegrationHook('shopify', handler);

    const product = { id: 'prod-1', tenantId: 'tenant-1' };
    const meta = { variants: [{ sku: 'V1' }] };
    const prisma = { product: {} };

    await executeHook('shopify', product, meta, prisma);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(product, meta, prisma);
  });

  it('does nothing when no hook is registered (no error)', async () => {
    await expect(
      executeHook('woocommerce', { id: '1' }, { data: true }, {}),
    ).resolves.toBeUndefined();
  });

  it('does nothing when sourceSystem is null', async () => {
    const handler = vi.fn();
    registerIntegrationHook('shopify', handler);

    await executeHook(null, { id: '1' }, { data: true }, {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when integrationMetadata is null', async () => {
    const handler = vi.fn();
    registerIntegrationHook('shopify', handler);

    await executeHook('shopify', { id: '1' }, null, {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('catches and logs handler errors (fire-and-forget)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = vi.fn().mockRejectedValue(new Error('DB connection lost'));
    registerIntegrationHook('shopify', handler);

    await expect(
      executeHook('shopify', { id: 'prod-1' }, { variants: [] }, {}),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('shopify hook failed for product prod-1'),
      'DB connection lost',
    );
    warnSpy.mockRestore();
  });

  it('does not throw even if handler throws synchronously', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = vi.fn(() => { throw new Error('sync boom'); });
    registerIntegrationHook('shopify', handler);

    await expect(
      executeHook('shopify', { id: 'p1' }, { data: true }, {}),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('matches source system case-insensitively', async () => {
    const handler = vi.fn();
    registerIntegrationHook('Shopify', handler);

    await executeHook('SHOPIFY', { id: '1' }, { meta: true }, {});
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('hasHook', () => {
  it('returns true when hook is registered', () => {
    registerIntegrationHook('shopify', vi.fn());
    expect(hasHook('shopify')).toBe(true);
  });

  it('returns false when no hook is registered', () => {
    expect(hasHook('shopify')).toBe(false);
  });

  it('uses case-insensitive matching', () => {
    registerIntegrationHook('shopify', vi.fn());
    expect(hasHook('Shopify')).toBe(true);
    expect(hasHook('SHOPIFY')).toBe(true);
  });

  it('returns false for null/undefined input', () => {
    expect(hasHook(null)).toBe(false);
    expect(hasHook(undefined)).toBe(false);
  });
});
