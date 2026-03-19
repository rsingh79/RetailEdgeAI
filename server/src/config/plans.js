/**
 * @deprecated Legacy plan configuration — kept for backward compatibility.
 * The system now uses DB-driven Feature + PlanTier models.
 * Use the database (Feature, PlanTier, PlanTierFeature, PlanTierLimit) instead.
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
    features: ['invoices', 'products', 'pricing', 'reports', 'gmail_integration', 'folder_polling', 'drive_integration'],
  },
  enterprise: {
    label: 'Enterprise',
    price: 199,
    maxUsers: Infinity,
    maxStores: Infinity,
    maxApiCallsPerMonth: 2000,
    features: [
      'invoices', 'products', 'pricing', 'reports',
      'gmail_integration', 'folder_polling', 'drive_integration', 'competitor_intelligence',
    ],
  },
};

/**
 * @deprecated Use DB-driven feature checks via requirePlan middleware instead.
 */
export function planHasFeature(plan, feature) {
  return PLAN_CONFIG[plan]?.features.includes(feature) ?? false;
}

/**
 * @deprecated Use PlanTierLimit DB queries instead.
 */
export function getPlanLimits(plan) {
  return PLAN_CONFIG[plan] || PLAN_CONFIG.starter;
}
