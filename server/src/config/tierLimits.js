/**
 * Tier limits — single source of truth for plan resource caps.
 *
 * These defaults are seeded into PlanTierLimit rows in the database.
 * Runtime lookups go through PlanTierLimit for per-tenant override support;
 * this file is the canonical fallback when no DB row exists.
 */

export const TIER_LIMITS = {
  starter: {
    aiQueries: 50,              // per month, invisible to user
    products: 500,              // visible limit
    integrations: 1,            // visible limit
    historicalSyncMonths: 12,   // 1 year of historical order sync
    analysisWindowMonths: 12,   // 1 year of sales data for AI analysis
  },
  growth: {
    aiQueries: 200,
    products: 5000,
    integrations: 3,
    historicalSyncMonths: 24,   // 2 years
    analysisWindowMonths: 24,
  },
  professional: {
    aiQueries: 500,
    products: 20000,
    integrations: 10,
    historicalSyncMonths: 60,   // 5 years
    analysisWindowMonths: 60,
  },
  enterprise: {
    aiQueries: -1,              // unlimited
    products: -1,
    integrations: -1,
    historicalSyncMonths: -1,   // unlimited
    analysisWindowMonths: -1,
  },
};

// AI throttling thresholds
export const AI_THROTTLE = {
  softWarningPercent: 90,     // show subtle notification at 90%
  throttlePercent: 95,        // switch to cheaper models at 95%
  hardLimitPercent: 100,      // hard stop only at 100%
};

/**
 * Map from TIER_LIMITS keys to PlanTierLimit.limitKey values in the DB.
 */
export const LIMIT_KEY_MAP = {
  aiQueries: 'ai_queries_per_month',
  products: 'max_products',
  integrations: 'max_integrations',
  historicalSyncMonths: 'historical_sync_months',
  analysisWindowMonths: 'analysis_window_months',
};

export function getLimit(tierSlug, resource) {
  const tier = TIER_LIMITS[tierSlug];
  if (!tier) return 0;
  return tier[resource] ?? 0;
}

export function isUnlimited(limit) {
  return limit === -1;
}

/**
 * Billing defaults — centralised configuration for subscription billing.
 * PlatformSettings (DB) can override defaultTrialDays and gracePeriodDays;
 * these are the hardcoded fallbacks.
 */
export const BILLING_DEFAULTS = {
  trialDays: 14,
  trialTier: 'growth',                   // generous tier during trial
  defaultGracePeriodDays: 14,             // days after payment failure before suspension
  dataRetentionDaysAfterSuspension: 30,   // days to retain data after full suspension
};

/**
 * Map Stripe Price IDs (from env) to tier slugs.
 * Enterprise is handled manually — not in Stripe.
 */
export function mapPriceToTier(priceId) {
  if (!priceId) return 'starter';
  const map = {};
  if (process.env.STRIPE_PRICE_STARTER) map[process.env.STRIPE_PRICE_STARTER] = 'starter';
  if (process.env.STRIPE_PRICE_GROWTH) map[process.env.STRIPE_PRICE_GROWTH] = 'growth';
  if (process.env.STRIPE_PRICE_PRO) map[process.env.STRIPE_PRICE_PRO] = 'professional';
  return map[priceId] || 'starter';
}

/**
 * Ordered price ranking for determining upgrade vs downgrade.
 */
export function getPriceRank(priceId) {
  if (!priceId) return 0;
  const order = {};
  if (process.env.STRIPE_PRICE_STARTER) order[process.env.STRIPE_PRICE_STARTER] = 1;
  if (process.env.STRIPE_PRICE_GROWTH) order[process.env.STRIPE_PRICE_GROWTH] = 2;
  if (process.env.STRIPE_PRICE_PRO) order[process.env.STRIPE_PRICE_PRO] = 3;
  return order[priceId] || 0;
}
