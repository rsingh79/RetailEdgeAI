import { useNavigate } from 'react-router-dom';

const PLAN_LABELS = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

const FEATURE_INFO = {
  gmail_integration: {
    title: 'Gmail Auto-Import',
    description: 'Automatically import invoices from your Gmail inbox. Set up sender whitelists, label filters, and let RetailEdge process invoices as they arrive.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  competitor_intelligence: {
    title: 'Competitor Intelligence',
    description: 'Monitor competitor prices from Woolworths, Coles, ALDI and IGA. Get AI-powered pricing recommendations, margin waterfall analysis, and automated price alerts.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
};

/**
 * Upgrade prompt shown when a user tries to access a plan-gated feature.
 * Displays a lock icon, feature description, and "Upgrade Plan" CTA.
 */
export default function UpgradePrompt({ feature, currentPlan, requiredPlan }) {
  const navigate = useNavigate();
  const info = FEATURE_INFO[feature] || {
    title: 'Premium Feature',
    description: 'This feature requires a plan upgrade.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  };

  const requiredLabel = PLAN_LABELS[requiredPlan] || requiredPlan;
  const currentLabel = PLAN_LABELS[currentPlan] || currentPlan || 'Starter';

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Lock icon */}
        <div className="mx-auto w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-200">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
        </div>

        {/* Feature info */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2 text-brand-600">
            {info.icon}
          </div>
          <h3 className="text-xl font-semibold text-gray-900">{info.title}</h3>
          <p className="text-gray-500 text-sm leading-relaxed">{info.description}</p>
        </div>

        {/* Plan badge */}
        <div className="flex items-center justify-center gap-2">
          <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
            Current: {currentLabel}
          </span>
          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
          <span className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium">
            Requires: {requiredLabel}
          </span>
        </div>

        {/* CTA */}
        <button
          onClick={() => navigate('/settings')}
          className="px-6 py-3 bg-brand-600 text-white rounded-xl text-sm font-semibold hover:bg-brand-700 transition shadow-sm"
        >
          Upgrade Plan
        </button>

        <p className="text-xs text-gray-400">
          Contact your administrator to upgrade your plan
        </p>
      </div>
    </div>
  );
}
