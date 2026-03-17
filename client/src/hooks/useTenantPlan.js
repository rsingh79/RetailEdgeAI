import { useState, useEffect } from 'react';
import { api } from '../services/api';

let cachedPlan = null;

/**
 * Feature lists per plan — mirrors server-side PLAN_CONFIG in config/plans.js.
 */
const PLAN_FEATURES = {
  starter: ['invoices', 'products', 'pricing', 'reports'],
  professional: ['invoices', 'products', 'pricing', 'reports', 'gmail_integration'],
  enterprise: [
    'invoices', 'products', 'pricing', 'reports',
    'gmail_integration', 'competitor_intelligence',
  ],
};

/**
 * Hook to access the current tenant's plan info.
 * Fetches from /api/auth/me on first call, then caches module-level.
 *
 * @returns {{ plan: Object|null, loading: boolean, hasFeature: (feature: string) => boolean }}
 */
export function useTenantPlan() {
  const [plan, setPlan] = useState(cachedPlan);
  const [loading, setLoading] = useState(!cachedPlan);

  useEffect(() => {
    if (cachedPlan) return;

    api.me()
      .then((user) => {
        cachedPlan = {
          plan: user.tenant?.plan || 'starter',
          tenantName: user.tenant?.name,
          maxUsers: user.tenant?.maxUsers,
          maxStores: user.tenant?.maxStores,
          maxApiCalls: user.tenant?.maxApiCallsPerMonth,
          subscriptionStatus: user.tenant?.subscriptionStatus,
        };
        setPlan(cachedPlan);
      })
      .catch(() => {
        cachedPlan = { plan: 'starter' };
        setPlan(cachedPlan);
      })
      .finally(() => setLoading(false));
  }, []);

  const hasFeature = (feature) => {
    const planKey = plan?.plan || 'starter';
    return PLAN_FEATURES[planKey]?.includes(feature) ?? false;
  };

  return { plan, loading, hasFeature };
}

/**
 * Clear the cached plan — call on login/logout.
 */
export function clearPlanCache() {
  cachedPlan = null;
}
