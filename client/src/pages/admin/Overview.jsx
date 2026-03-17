import { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.admin.getOverviewStats(), api.admin.getActivity(15)])
      .then(([s, a]) => {
        setStats(s);
        setActivity(a);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>;
  }

  const statCards = [
    { label: 'Active Tenants', value: stats?.totalTenants || 0, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'API Calls (MTD)', value: stats?.apiCallsMtd || 0, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'API Cost (MTD)', value: `$${(stats?.apiCostMtd || 0).toFixed(2)}`, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Active Trials', value: stats?.trialTenants || 0, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  const actionLabel = {
    REGISTERED: 'New tenant registered',
    LOCKED: 'Tenant locked',
    UNLOCKED: 'Tenant unlocked',
    tenant_created: 'Tenant created',
  };

  const actionColor = {
    REGISTERED: 'bg-green-100 text-green-700',
    LOCKED: 'bg-red-100 text-red-700',
    UNLOCKED: 'bg-blue-100 text-blue-700',
    tenant_created: 'bg-green-100 text-green-700',
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Platform Overview</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="text-sm text-gray-500 mb-1">{card.label}</div>
            <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold mb-4">Recent Activity</h2>
          <div className="space-y-3">
            {activity.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent activity</p>
            ) : (
              activity.map((item, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor[item.action] || 'bg-gray-100 text-gray-700'}`}>
                    {item.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-gray-900">{item.tenantName}</span>
                    {item.reason && (
                      <span className="text-xs text-gray-500 ml-2">— {item.reason}</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(item.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold mb-4">Platform Health</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">Locked Tenants</span>
              <span className={`text-sm font-semibold ${stats?.lockedTenants > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {stats?.lockedTenants || 0}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">Active Users (7d)</span>
              <span className="text-sm font-semibold text-gray-900">{stats?.activeUsers || 0}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100">
              <span className="text-sm text-gray-600">API Calls (MTD)</span>
              <span className="text-sm font-semibold text-gray-900">{stats?.apiCallsMtd || 0}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-gray-600">Total API Cost (MTD)</span>
              <span className="text-sm font-semibold text-purple-600">${(stats?.apiCostMtd || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
