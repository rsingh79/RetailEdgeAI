import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

const tabs = ['Details', 'Users', 'Subscription', 'Access Control'];

export default function AdminTenantDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Details');
  const [saving, setSaving] = useState(false);
  const [lockReason, setLockReason] = useState('');
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    api.admin.getTenant(id)
      .then((t) => {
        setTenant(t);
        setEditForm({ name: t.name, abn: t.abn || '', timezone: t.timezone, currency: t.currency, contactEmail: t.contactEmail || '', contactPhone: t.contactPhone || '' });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.admin.updateTenant(id, editForm);
      setTenant({ ...tenant, ...updated });
    } catch (err) { console.error(err); }
    setSaving(false);
  };

  const handleLock = async () => {
    try {
      const updated = await api.admin.lockTenant(id, lockReason);
      setTenant({ ...tenant, ...updated });
      setLockReason('');
      // Reload to get new access logs
      const full = await api.admin.getTenant(id);
      setTenant(full);
    } catch (err) { console.error(err); }
  };

  const handleUnlock = async () => {
    try {
      const updated = await api.admin.unlockTenant(id);
      setTenant({ ...tenant, ...updated });
      const full = await api.admin.getTenant(id);
      setTenant(full);
    } catch (err) { console.error(err); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>;
  if (!tenant) return <div className="text-center text-gray-500 py-12">Tenant not found</div>;

  const statusBadge = tenant.isLocked
    ? { label: 'Locked', cls: 'bg-red-100 text-red-700' }
    : tenant.subscriptionStatus === 'active'
    ? { label: 'Active', cls: 'bg-green-100 text-green-700' }
    : { label: tenant.subscriptionStatus, cls: 'bg-blue-100 text-blue-700' };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => navigate('/admin/tenants')} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge.cls}`}>{statusBadge.label}</span>
          </div>
          {tenant.abn && <p className="text-sm text-gray-500">ABN: {tenant.abn}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${
              activeTab === tab
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'Details' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Business Information</h3>
            <div className="space-y-3">
              {[
                { label: 'Business Name', key: 'name' },
                { label: 'ABN', key: 'abn' },
                { label: 'Timezone', key: 'timezone' },
                { label: 'Currency', key: 'currency' },
                { label: 'Contact Email', key: 'contactEmail', type: 'email' },
                { label: 'Contact Phone', key: 'contactPhone', type: 'tel' },
              ].map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                  <input
                    type={field.type || 'text'}
                    value={editForm[field.key] || ''}
                    onChange={(e) => setEditForm({ ...editForm, [field.key]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
              ))}
              <button
                onClick={handleSave}
                disabled={saving}
                className="mt-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold mb-3">Usage Summary</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500">Users</div>
                  <div className="text-lg font-semibold">{tenant._count?.users || tenant.users?.length || 0}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500">Stores</div>
                  <div className="text-lg font-semibold">{tenant._count?.stores || 0}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500">API Calls (MTD)</div>
                  <div className="text-lg font-semibold">{tenant.usageSummary?.apiCallsMtd || 0}</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-gray-500">API Cost (MTD)</div>
                  <div className="text-lg font-semibold text-purple-600">${(tenant.usageSummary?.apiCostMtd || 0).toFixed(2)}</div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold mb-3">Key Dates</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Registered</span>
                  <span className="font-medium">{new Date(tenant.createdAt).toLocaleDateString()}</span>
                </div>
                {tenant.trialEndsAt && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Trial Ends</span>
                    <span className="font-medium">{new Date(tenant.trialEndsAt).toLocaleDateString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Updated</span>
                  <span className="font-medium">{new Date(tenant.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Users' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody>
              {(tenant.users || []).map((u) => (
                <tr key={u.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">{u.role}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'Subscription' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Current Plan</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Plan</span>
                <span className="font-medium capitalize">{tenant.plan}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Status</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge.cls}`}>{tenant.subscriptionStatus}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Max Users</span>
                <span className="font-medium">{tenant.maxUsers}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-gray-500">Payment Method</span>
                <span className={`font-medium ${tenant.paymentMethodOnFile ? 'text-green-600' : 'text-amber-600'}`}>
                  {tenant.paymentMethodOnFile ? 'On File' : 'Not Provided'}
                </span>
              </div>
              {tenant.trialEndsAt && (
                <div className="flex justify-between py-2">
                  <span className="text-gray-500">Trial Ends</span>
                  <span className="font-medium">{new Date(tenant.trialEndsAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Billing History</h3>
            <p className="text-gray-500 text-sm">Billing history will be available after Stripe integration.</p>
          </div>
        </div>
      )}

      {activeTab === 'Access Control' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Access Status</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-3 h-3 rounded-full ${tenant.isLocked ? 'bg-red-500' : 'bg-green-500'}`} />
              <span className="text-lg font-medium">{tenant.isLocked ? 'Locked' : 'Active'}</span>
            </div>
            {tenant.isLocked ? (
              <div>
                {tenant.lockReason && (
                  <p className="text-sm text-gray-600 mb-3">Reason: {tenant.lockReason}</p>
                )}
                <button
                  onClick={handleUnlock}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  Unlock Access
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Lock Reason</label>
                <textarea
                  value={lockReason}
                  onChange={(e) => setLockReason(e.target.value)}
                  placeholder="Reason for locking access..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3"
                  rows={2}
                />
                <button
                  onClick={handleLock}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
                >
                  Lock Access
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Access History</h3>
            <div className="space-y-2">
              {(tenant.accessLogs || []).length === 0 ? (
                <p className="text-gray-500 text-sm">No access history</p>
              ) : (
                tenant.accessLogs.map((log, i) => (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.action === 'LOCKED' ? 'bg-red-100 text-red-700' :
                      log.action === 'UNLOCKED' ? 'bg-green-100 text-green-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {log.action}
                    </span>
                    <span className="flex-1 text-gray-600">{log.reason || 'No reason provided'}</span>
                    <span className="text-gray-400">{new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
