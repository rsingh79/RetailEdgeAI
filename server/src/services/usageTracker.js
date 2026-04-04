import { adminPrisma } from '../lib/prisma.js';
import { TIER_LIMITS, LIMIT_KEY_MAP, isUnlimited } from '../config/tierLimits.js';

/**
 * Usage Tracking Service — manages per-tenant resource consumption.
 *
 * All writes go through adminPrisma (bypasses RLS) because usage records
 * are managed system-side, not by tenant-scoped requests. Reads for
 * user-facing endpoints should go through tenant-scoped prisma.
 */

// ── Helpers ──────────────────────────────────────────────────

/**
 * Get the start and end of the current calendar-month billing period.
 * Stripe alignment comes in Session 7 — for now, billing = calendar month.
 */
function getCurrentBillingPeriod() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Resolve the tier slug for a tenant. Returns the slug from the
 * planTier relation, falling back to the legacy plan field.
 */
async function resolveTierSlug(tenantId) {
  const tenant = await adminPrisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      plan: true,
      planTier: { select: { slug: true } },
    },
  });
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  return tenant.planTier?.slug || tenant.plan || 'starter';
}

/**
 * Look up a single limit value from PlanTierLimit (DB), falling back
 * to the in-code TIER_LIMITS config.
 *
 * When tierSlug is provided, looks up the PlanTier by slug (used during
 * tier changes to resolve the NEW tier's limits). Otherwise falls back
 * to the tenant's current planTierId.
 */
async function resolveLimitValue(tenantId, tierSlug, resource) {
  const dbKey = LIMIT_KEY_MAP[resource];
  if (dbKey) {
    // Prefer looking up by tierSlug (for tier changes)
    let planTierId = null;
    if (tierSlug) {
      const tier = await adminPrisma.planTier.findUnique({
        where: { slug: tierSlug },
        select: { id: true },
      });
      planTierId = tier?.id;
    }
    // Fallback to tenant's current tier
    if (!planTierId && tenantId) {
      const tenant = await adminPrisma.tenant.findUnique({
        where: { id: tenantId },
        select: { planTierId: true },
      });
      planTierId = tenant?.planTierId;
    }
    if (planTierId) {
      const row = await adminPrisma.planTierLimit.findUnique({
        where: { planTierId_limitKey: { planTierId, limitKey: dbKey } },
      });
      if (row) return row.limitValue;
    }
  }
  // Fallback to in-code config — default to unlimited (fail-open) rather than
  // 0 (fail-closed) so a missing limit row doesn't silently block all AI calls.
  const fallback = TIER_LIMITS[tierSlug]?.[resource];
  if (fallback === undefined) {
    console.warn(`[UsageTracker] No limit found for tenant ${tenantId}, resource ${resource}, tier ${tierSlug}. Defaulting to unlimited.`);
  }
  return fallback ?? -1;
}

/**
 * Build the full limits object for a TenantUsage record from the
 * tenant's current tier.
 */
async function buildLimitsFromTier(tenantId, tierSlug) {
  const [aiQueriesLimit, productsLimit, integrationsLimit, historicalSyncMonths] =
    await Promise.all([
      resolveLimitValue(tenantId, tierSlug, 'aiQueries'),
      resolveLimitValue(tenantId, tierSlug, 'products'),
      resolveLimitValue(tenantId, tierSlug, 'integrations'),
      resolveLimitValue(tenantId, tierSlug, 'historicalSyncMonths'),
    ]);
  return { aiQueriesLimit, productsLimit, integrationsLimit, historicalSyncMonths };
}

// ── Resource → column mapping ────────────────────────────────

const USAGE_COLUMNS = {
  aiQueries: { used: 'aiQueriesUsed', limit: 'aiQueriesLimit' },
  products: { used: 'productsImported', limit: 'productsLimit' },
  integrations: { used: 'integrationsUsed', limit: 'integrationsLimit' },
};

// ── Core functions ───────────────────────────────────────────

/**
 * Get or create the current billing period's usage record.
 * If no record exists for the current period, creates one with
 * limits from the tenant's tier.
 */
export async function getCurrentUsage(prismaClient, tenantId) {
  const { start, end } = getCurrentBillingPeriod();

  // Try to find existing record
  let usage = await adminPrisma.tenantUsage.findUnique({
    where: { tenantId_billingPeriodStart: { tenantId, billingPeriodStart: start } },
  });

  if (usage) return usage;

  // Create new record with limits from tenant's tier
  const tierSlug = await resolveTierSlug(tenantId);
  const limits = await buildLimitsFromTier(tenantId, tierSlug);

  usage = await adminPrisma.tenantUsage.create({
    data: {
      tenantId,
      billingPeriodStart: start,
      billingPeriodEnd: end,
      ...limits,
    },
  });

  return usage;
}

/**
 * Atomically increment a usage counter.
 * Uses Prisma's { increment } to avoid read-modify-write race conditions.
 *
 * @returns {{ currentUsage, limit, remaining, percentUsed, isUnlimited }}
 */
export async function incrementUsage(prismaClient, tenantId, resource, amount = 1) {
  const cols = USAGE_COLUMNS[resource];
  if (!cols) throw new Error(`Unknown resource: ${resource}`);

  // Ensure the record exists
  const existing = await getCurrentUsage(prismaClient, tenantId);

  // Atomic increment
  const updated = await adminPrisma.tenantUsage.update({
    where: { id: existing.id },
    data: { [cols.used]: { increment: amount } },
  });

  const currentUsage = updated[cols.used];
  const limit = updated[cols.limit];
  const unlimited = isUnlimited(limit);
  const remaining = unlimited ? Infinity : Math.max(0, limit - currentUsage);
  const percentUsed = unlimited ? 0 : limit > 0 ? Math.round((currentUsage / limit) * 100) : 100;

  return { currentUsage, limit, remaining, percentUsed, isUnlimited: unlimited };
}

/**
 * Pre-flight capacity check without incrementing.
 *
 * @returns {{ allowed, currentUsage, limit, remaining }}
 */
export async function checkCapacity(prismaClient, tenantId, resource, requestedAmount = 1) {
  const cols = USAGE_COLUMNS[resource];
  if (!cols) throw new Error(`Unknown resource: ${resource}`);

  const usage = await getCurrentUsage(prismaClient, tenantId);
  const currentUsage = usage[cols.used];
  const limit = usage[cols.limit];
  const unlimited = isUnlimited(limit);
  const remaining = unlimited ? Infinity : Math.max(0, limit - currentUsage);
  const allowed = unlimited || (currentUsage + requestedAmount <= limit);

  return { allowed, currentUsage, limit, remaining };
}

/**
 * Return usage for all resources.
 * AI queries section is INTERNAL ONLY — not included in user-facing responses.
 * For visible resources (products, integrations): include full stats.
 * For AI: only include if approaching limit (for internal notification logic).
 */
export async function getUsageSummary(prismaClient, tenantId) {
  const usage = await getCurrentUsage(prismaClient, tenantId);

  const makeStats = (used, limit) => {
    const unlimited = isUnlimited(limit);
    return {
      used,
      limit: unlimited ? -1 : limit,
      remaining: unlimited ? Infinity : Math.max(0, limit - used),
      percent: unlimited ? 0 : limit > 0 ? Math.round((used / limit) * 100) : 100,
      isUnlimited: unlimited,
    };
  };

  return {
    products: makeStats(usage.productsImported, usage.productsLimit),
    integrations: makeStats(usage.integrationsUsed, usage.integrationsLimit),
    historicalSyncMonths: usage.historicalSyncMonths,
    // AI stats are internal — not exposed in user-facing GET /api/usage/summary
    _internal: {
      aiQueries: makeStats(usage.aiQueriesUsed, usage.aiQueriesLimit),
    },
    billingPeriod: {
      start: usage.billingPeriodStart,
      end: usage.billingPeriodEnd,
    },
  };
}

/**
 * Reset counters for a new billing period.
 * Called by Session 7's Stripe webhook on payment_succeeded.
 */
export async function resetUsage(prismaClient, tenantId, newPeriodStart, newPeriodEnd) {
  const tierSlug = await resolveTierSlug(tenantId);
  const limits = await buildLimitsFromTier(tenantId, tierSlug);

  return adminPrisma.tenantUsage.create({
    data: {
      tenantId,
      billingPeriodStart: newPeriodStart,
      billingPeriodEnd: newPeriodEnd,
      lastResetAt: new Date(),
      ...limits,
    },
  });
}

/**
 * Update limits on the current period's usage record when a tenant
 * upgrades (takes effect immediately).
 * Downgrade scheduling is handled in Session 7 with Stripe.
 */
export async function updateLimitsForTierChange(prismaClient, tenantId, newTierSlug) {
  const currentPeriod = await getCurrentUsage(prismaClient, tenantId);
  const limits = await buildLimitsFromTier(tenantId, newTierSlug);

  return adminPrisma.tenantUsage.update({
    where: { id: currentPeriod.id },
    data: limits,
  });
}
