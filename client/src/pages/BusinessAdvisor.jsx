import { useTenantPlan } from '../hooks/useTenantPlan';
import UpgradePrompt from '../components/UpgradePrompt';
import ChatPanel from '../components/advisor/ChatPanel';

/**
 * Business AI Advisor page — plan-gated chat interface.
 */
export default function BusinessAdvisor() {
  const { plan, loading, hasFeature } = useTenantPlan();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (!hasFeature('ai_advisor')) {
    return <UpgradePrompt feature="ai_advisor" currentPlan={plan?.tierName || plan?.plan} />;
  }

  return <ChatPanel />;
}
