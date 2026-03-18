import { useState, useEffect } from 'react';
import { api } from '../services/api';

let cachedPlan = null;

/**
 * Hook to access the current tenant's plan info.
 * Fetches enabledFeatures and limits from /api/auth/me (DB-driven).
 * No hardcoded feature lists — everything comes from the server.
 *
 * @returns {{ plan: Object|null, loading: boolean, hasFeature: (feature: string) => boolean, getLimit: (limitKey: string) => number|null }}
 */
export function useTenantPlan() {
  const [plan, setPlan] = useState(cachedPlan);
  const [loading, setLoading] = useState(!cachedPlan);

  useEffect(() => {
    if (cachedPlan) return;

    api.me()
      .then((user) => {
        cachedPlan = {
          plan: user.tierSlug || user.tenant?.plan || 'starter',
          tierName: user.tierName || null,
          tenantName: user.tenant?.name,
          maxUsers: user.tenant?.maxUsers,
          maxStores: user.tenant?.maxStores,
          maxApiCalls: user.tenant?.maxApiCallsPerMonth,
          subscriptionStatus: user.tenant?.subscriptionStatus,
          enabledFeatures: user.enabledFeatures || [],
          limits: user.limits || {},
        };
        setPlan(cachedPlan);
      })
      .catch(() => {
        cachedPlan = { plan: 'starter', enabledFeatures: [], limits: {} };
        setPlan(cachedPlan);
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Check if a feature is enabled for the current tenant's tier.
   * Uses the enabledFeatures array from the /me endpoint.
   */
  const hasFeature = (feature) => {
    return plan?.enabledFeatures?.includes(feature) ?? false;
  };

  /**
   * Get a usage limit value by key (e.g. 'max_users', 'max_invoice_pages_per_month').
   * Returns null if no limit is set.
   */
  const getLimit = (limitKey) => {
    return plan?.limits?.[limitKey] ?? null;
  };

  return { plan, loading, hasFeature, getLimit };
}

/**
 * Clear the cached plan — call on login/logout.
 */
export function clearPlanCache() {
  cachedPlan = null;
}
