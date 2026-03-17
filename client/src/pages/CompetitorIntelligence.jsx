import { useTenantPlan } from '../hooks/useTenantPlan';
import UpgradePrompt from '../components/UpgradePrompt';
import CompetitorDashboard from '../components/competitor/CompetitorDashboard';

export default function CompetitorIntelligence() {
  const { plan, loading, hasFeature } = useTenantPlan();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!hasFeature('competitor_intelligence')) {
    return (
      <UpgradePrompt
        feature="competitor_intelligence"
        currentPlan={plan?.plan}
        requiredPlan="enterprise"
      />
    );
  }

  return <CompetitorDashboard />;
}
