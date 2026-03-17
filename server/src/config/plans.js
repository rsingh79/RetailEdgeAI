/**
 * Plan configuration — single source of truth for product tiers.
 *
 * Starter ($29/mo)       — manual upload only
 * Professional ($79/mo)  — adds Gmail auto-import
 * Enterprise ($199/mo)   — adds Competitor Intelligence
 */
export const PLAN_CONFIG = {
  starter: {
    label: 'Starter',
    price: 29,
    maxUsers: 5,
    maxStores: 2,
    maxApiCallsPerMonth: 100,
    features: ['invoices', 'products', 'pricing', 'reports'],
  },
  professional: {
    label: 'Professional',
    price: 79,
    maxUsers: 15,
    maxStores: 10,
    maxApiCallsPerMonth: 500,
    features: ['invoices', 'products', 'pricing', 'reports', 'gmail_integration', 'folder_polling'],
  },
  enterprise: {
    label: 'Enterprise',
    price: 199,
    maxUsers: Infinity,
    maxStores: Infinity,
    maxApiCallsPerMonth: 2000,
    features: [
      'invoices', 'products', 'pricing', 'reports',
      'gmail_integration', 'folder_polling', 'competitor_intelligence',
    ],
  },
};

/**
 * Check if a plan includes a specific feature.
 * @param {string} plan - Plan key (starter, professional, enterprise)
 * @param {string} feature - Feature key (e.g. 'gmail_integration')
 * @returns {boolean}
 */
export function planHasFeature(plan, feature) {
  return PLAN_CONFIG[plan]?.features.includes(feature) ?? false;
}

/**
 * Get plan limits and config for a given plan.
 * Falls back to starter if plan is unknown.
 * @param {string} plan - Plan key
 * @returns {Object} Plan config object
 */
export function getPlanLimits(plan) {
  return PLAN_CONFIG[plan] || PLAN_CONFIG.starter;
}
