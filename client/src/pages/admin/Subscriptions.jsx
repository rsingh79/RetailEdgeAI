import { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function AdminSubscriptions() {
  const [settings, setSettings] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editSettings, setEditSettings] = useState({});
  const [extendModal, setExtendModal] = useState(null);
  const [extendDays, setExtendDays] = useState(14);
  const [changingPlan, setChangingPlan] = useState(null); // tenant ID being updated

  useEffect(() => {
    Promise.all([api.admin.getSettings(), api.admin.getTenants()])
      .then(([s, t]) => {
        setSettings(s);
        setEditSettings({
          defaultTrialDays: s.defaultTrialDays,
          autoLockOnTrialExpiry: s.autoLockOnTrialExpiry,
          gracePeriodDays: s.gracePeriodDays,
        });
        setTenants(t);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const updated = await api.admin.updateSettings(editSettings);
      setSettings(updated);
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const handleExtendTrial = async () => {
    if (!extendModal) return;
    try {
      const newEnd = new Date(Date.now() + extendDays * 86400000).toISOString();
      await api.admin.updateSubscription(extendModal.id, { trialEndsAt: newEnd, subscriptionStatus: 'trial' });
      // Reload tenants
      const updated = await api.admin.getTenants();
      setTenants(updated);
      setExtendModal(null);
    } catch (err) { console.error(err); }
  };

  const handleChangePlan = async (tenantId, newPlan) => {
    setChangingPlan(tenantId);
    try {
      await api.admin.updateSubscription(tenantId, { plan: newPlan });
      const updated = await api.admin.getTenants();
      setTenants(updated);
    } catch (err) {
      console.error(err);
    }
    setChangingPlan(null);
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>;

  // Subscription status counts
  const counts = { active: 0, trial: 0, locked: 0, expired: 0, cancelled: 0 };
  tenants.forEach((t) => {
    if (t.isLocked) counts.locked++;
    else if (t.subscriptionStatus === 'active') counts.active++;
    else if (t.subscriptionStatus === 'trial') counts.trial++;
    else if (t.subscriptionStatus === 'expired') counts.expired++;
    else if (t.subscriptionStatus === 'cancelled') counts.cancelled++;
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Subscriptions & Billing</h1>

      {/* Global Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="font-semibold mb-4">Global Trial & Subscription Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Trial Days</label>
            <input
              type="number"
              value={editSettings.defaultTrialDays}
              onChange={(e) => setEditSettings({ ...editSettings, defaultTrialDays: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              min={0}
              max={90}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Grace Period Days</label>
            <input
              type="number"
              value={editSettings.gracePeriodDays}
              onChange={(e) => setEditSettings({ ...editSettings, gracePeriodDays: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              min={0}
              max={30}
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editSettings.autoLockOnTrialExpiry}
                onChange={(e) => setEditSettings({ ...editSettings, autoLockOnTrialExpiry: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Auto-lock on trial expiry</span>
            </label>
          </div>
        </div>
        <button
          onClick={handleSaveSettings}
          disabled={saving}
          className="mt-4 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Active', count: counts.active, border: 'border-l-green-500', color: 'text-green-600' },
          { label: 'Trial', count: counts.trial, border: 'border-l-blue-500', color: 'text-blue-600' },
          { label: 'Locked / Expired', count: counts.locked + counts.expired, border: 'border-l-red-500', color: 'text-red-600' },
          { label: 'Cancelled', count: counts.cancelled, border: 'border-l-gray-400', color: 'text-gray-600' },
        ].map((card) => (
          <div key={card.label} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${card.border} p-4`}>
            <div className="text-sm text-gray-500">{card.label}</div>
            <div className={`text-2xl font-bold ${card.color}`}>{card.count}</div>
          </div>
        ))}
      </div>

      {/* Tenant Subscription Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Tenant</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Trial Ends</th>
              <th className="text-center px-4 py-3 font-medium text-gray-500">Payment</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => {
              const isExpiredTrial = t.subscriptionStatus === 'trial' && t.trialEndsAt && new Date(t.trialEndsAt) < new Date();
              const statusCls = t.isLocked
                ? 'bg-red-100 text-red-700'
                : t.subscriptionStatus === 'active'
                ? 'bg-green-100 text-green-700'
                : isExpiredTrial
                ? 'bg-amber-100 text-amber-700'
                : 'bg-blue-100 text-blue-700';
              const statusLabel = t.isLocked ? 'Locked' : isExpiredTrial ? 'Trial Expired' : t.subscriptionStatus;

              return (
                <tr key={t.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${statusCls}`}>{statusLabel}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={t.plan}
                      onChange={(e) => handleChangePlan(t.id, e.target.value)}
                      disabled={changingPlan === t.id}
                      className={`px-2 py-1 border border-gray-200 rounded text-xs font-medium capitalize cursor-pointer ${
                        changingPlan === t.id ? 'opacity-50' : ''
                      } ${
                        t.plan === 'enterprise' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                        t.plan === 'professional' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        'bg-gray-50 text-gray-700'
                      }`}
                    >
                      <option value="starter">Starter</option>
                      <option value="professional">Professional</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {t.trialEndsAt ? new Date(t.trialEndsAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {t.paymentMethodOnFile ? (
                      <span className="text-green-600 text-xs font-medium">On File</span>
                    ) : (
                      <span className="text-amber-600 text-xs font-medium">Missing</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      {t.subscriptionStatus === 'trial' && (
                        <button
                          onClick={() => { setExtendModal(t); setExtendDays(14); }}
                          className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                        >
                          Extend Trial
                        </button>
                      )}
                      {t.isLocked && (
                        <button
                          onClick={async () => {
                            await api.admin.unlockTenant(t.id);
                            const updated = await api.admin.getTenants();
                            setTenants(updated);
                          }}
                          className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100"
                        >
                          Unlock
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Extend Trial Modal */}
      {extendModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setExtendModal(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Extend Trial — {extendModal.name}</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Extend by (days)</label>
              <input
                type="number"
                value={extendDays}
                onChange={(e) => setExtendDays(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                min={1}
                max={365}
              />
              <p className="text-xs text-gray-500 mt-1">
                New trial end: {new Date(Date.now() + extendDays * 86400000).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExtendModal(null)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button onClick={handleExtendTrial} className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700">
                Extend Trial
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
