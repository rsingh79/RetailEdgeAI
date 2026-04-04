import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

const statusBadge = (tenant) => {
  if (tenant.isLocked) return { label: 'Locked', cls: 'bg-red-100 text-red-700' };
  if (tenant.subscriptionStatus === 'active') return { label: 'Active', cls: 'bg-green-100 text-green-700' };
  if (tenant.subscriptionStatus === 'trial') return { label: 'Trial', cls: 'bg-blue-100 text-blue-700' };
  if (tenant.subscriptionStatus === 'expired') return { label: 'Expired', cls: 'bg-gray-100 text-gray-700' };
  return { label: tenant.subscriptionStatus, cls: 'bg-gray-100 text-gray-700' };
};

export default function AdminTenants() {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', ownerEmail: '', ownerName: '', trialDays: 14 });
  const [addError, setAddError] = useState('');

  const loadTenants = () => {
    const params = {};
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    api.admin.getTenants(params)
      .then(setTenants)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadTenants(); }, [search, statusFilter]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setAddError('');
    try {
      await api.admin.createTenant(newTenant);
      setShowAddForm(false);
      setNewTenant({ name: '', ownerEmail: '', ownerName: '', trialDays: 14 });
      loadTenants();
    } catch (err) {
      setAddError(err.message);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition"
        >
          + Add Tenant
        </button>
      </div>

      {/* Add Tenant Form */}
      {showAddForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h3 className="font-semibold mb-4">New Tenant</h3>
          {addError && <div className="mb-3 p-2 bg-red-50 text-red-700 text-sm rounded">{addError}</div>}
          <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label>
              <input
                value={newTenant.name}
                onChange={(e) => setNewTenant({ ...newTenant, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner Email *</label>
              <input
                type="email"
                value={newTenant.ownerEmail}
                onChange={(e) => setNewTenant({ ...newTenant, ownerEmail: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner Name</label>
              <input
                value={newTenant.ownerName}
                onChange={(e) => setNewTenant({ ...newTenant, ownerName: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Trial Days</label>
              <input
                type="number"
                value={newTenant.trialDays}
                onChange={(e) => setNewTenant({ ...newTenant, trialDays: parseInt(e.target.value) || 14 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
                Create Tenant
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          placeholder="Search by name or ABN..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="locked">Locked</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : tenants.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No tenants found</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Tenant</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Plan</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Users</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Stores</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">API Cost MTD</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => {
                const badge = statusBadge(t);
                return (
                  <tr
                    key={t.id}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                    onClick={() => navigate(`/admin/tenants/${t.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-brand-100 text-brand-700 rounded-lg flex items-center justify-center text-xs font-bold">
                          {t.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{t.name}</div>
                          {t.abn && <div className="text-xs text-gray-400">ABN: {t.abn}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-600">{t.plan}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{t._count?.users || 0}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{t._count?.stores || 0}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">${(t.apiCostMtd || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right text-gray-400">
                      <svg className="w-4 h-4 inline" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
