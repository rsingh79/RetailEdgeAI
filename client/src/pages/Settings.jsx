import { useState } from 'react';
import { useTenantPlan } from '../hooks/useTenantPlan';
import UpgradePrompt from '../components/UpgradePrompt';
import IntegrationsTab from '../components/settings/IntegrationsTab';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('business');
  const { plan, hasFeature, loading } = useTenantPlan();

  const tabs = [
    { id: 'business', label: 'Business Profile' },
    { id: 'users', label: 'Users & Roles' },
    { id: 'integrations', label: 'Integrations', requiredFeature: 'gmail_integration' },
    { id: 'notifications', label: 'Notifications' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Settings</h2>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => {
          const locked = tab.requiredFeature && !loading && !hasFeature(tab.requiredFeature);
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition border-b-2 ${
                activeTab === tab.id
                  ? 'text-brand-600 border-brand-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
              } ${locked ? 'opacity-50' : ''}`}
            >
              {tab.label}
              {locked && (
                <svg className="inline-block w-3.5 h-3.5 ml-1.5 -mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'business' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
          Business profile settings will go here
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
          Users & roles management will go here
        </div>
      )}

      {activeTab === 'integrations' && (
        hasFeature('gmail_integration') ? (
          <IntegrationsTab />
        ) : (
          <UpgradePrompt
            feature="gmail_integration"
            currentPlan={plan?.plan}
            requiredPlan="professional"
          />
        )
      )}

      {activeTab === 'notifications' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
          Notification preferences will go here
        </div>
      )}
    </div>
  );
}
