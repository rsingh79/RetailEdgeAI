import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';

// ── Limit Key Definitions ─────────────────────────────────────────

const LIMIT_KEYS = [
  { key: 'max_users', label: 'Max Users', description: 'Maximum team members' },
  { key: 'max_stores', label: 'Max Stores', description: 'Maximum stores (POS + ecommerce)' },
  { key: 'max_invoice_pages_per_month', label: 'Invoice Pages/Month', description: 'Invoice pages processed per month (OCR)' },
  { key: 'max_products', label: 'Max Products', description: 'Maximum products in catalog' },
  { key: 'max_pricing_rules', label: 'Pricing Rules', description: 'Maximum pricing rules' },
  { key: 'max_exports_per_month', label: 'Exports/Month', description: 'Exports per month' },
  { key: 'max_email_imports_per_month', label: 'Email Imports/Month', description: 'Email invoice imports per month' },
  { key: 'max_folder_imports_per_month', label: 'Folder Imports/Month', description: 'Folder invoice imports per month' },
  { key: 'max_competitors_monitored', label: 'Competitors', description: 'Competitors monitored' },
  { key: 'max_demand_products', label: 'Demand Products', description: 'Products with demand analysis' },
];

// ── Sub-components ────────────────────────────────────────────────

function FeatureTable({ features, onToggle, onEdit, onDelete }) {
  const categories = [...new Set(features.map((f) => f.category))];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold">Feature Registry</h3>
        <span className="text-xs text-gray-500">{features.length} features</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-gray-500 w-8"></th>
            <th className="text-left px-4 py-2.5 font-medium text-gray-500">Feature</th>
            <th className="text-left px-4 py-2.5 font-medium text-gray-500">Key</th>
            <th className="text-left px-4 py-2.5 font-medium text-gray-500">Category</th>
            <th className="text-center px-4 py-2.5 font-medium text-gray-500">Core</th>
            <th className="text-center px-4 py-2.5 font-medium text-gray-500">Active</th>
            <th className="text-center px-4 py-2.5 font-medium text-gray-500">In Tiers</th>
            <th className="text-right px-4 py-2.5 font-medium text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody>
          {features.map((f) => (
            <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="px-4 py-2.5 text-lg">{f.icon}</td>
              <td className="px-4 py-2.5 font-medium text-gray-900">{f.name}</td>
              <td className="px-4 py-2.5">
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{f.key}</code>
              </td>
              <td className="px-4 py-2.5 text-gray-600 capitalize">{f.category}</td>
              <td className="px-4 py-2.5 text-center">
                {f.isCore ? (
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">Core</span>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-center">
                <button
                  onClick={() => onToggle(f.id, !f.isActive)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    f.isActive ? 'bg-brand-600' : 'bg-gray-300'
                  }`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    f.isActive ? 'translate-x-4.5' : 'translate-x-1'
                  }`} />
                </button>
              </td>
              <td className="px-4 py-2.5 text-center text-gray-600">{f._count?.tiers || 0}</td>
              <td className="px-4 py-2.5 text-right">
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => onEdit(f)}
                    className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                  >
                    Edit
                  </button>
                  {!f.isCore && (f._count?.tiers || 0) === 0 && (
                    <button
                      onClick={() => onDelete(f.id)}
                      className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TierCard({ tier, features, onEdit, onDelete }) {
  const tierFeatureKeys = tier.features?.map((f) => f.feature.key) || [];
  const coreCount = tier.features?.filter((f) => f.feature.isCore).length || 0;
  const gatableCount = (tier.features?.length || 0) - coreCount;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg">{tier.name}</h3>
              {tier.isDefault && (
                <span className="text-xs bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full font-medium">Default</span>
              )}
              {!tier.isActive && (
                <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium">Inactive</span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">{tier.description || 'No description'}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">${tier.monthlyPrice}<span className="text-sm font-normal text-gray-500">/mo</span></div>
            <div className="text-xs text-gray-400">${tier.annualPrice}/yr</div>
          </div>
        </div>

        {/* Tenant count */}
        <div className="text-xs text-gray-500 mb-3">
          {tier._count?.tenants || 0} tenant{(tier._count?.tenants || 0) !== 1 ? 's' : ''} on this tier
        </div>

        {/* Features */}
        <div className="mb-4">
          <div className="text-xs font-medium text-gray-500 uppercase mb-2">Features ({tier.features?.length || 0})</div>
          <div className="flex flex-wrap gap-1.5">
            {features.map((f) => {
              const included = tierFeatureKeys.includes(f.key);
              return (
                <span
                  key={f.id}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                    f.isCore
                      ? 'bg-blue-50 text-blue-700'
                      : included
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-50 text-gray-400 line-through'
                  }`}
                >
                  <span>{f.icon}</span> {f.name}
                  {f.isCore && <span className="text-blue-400 text-[10px]">(core)</span>}
                </span>
              );
            })}
          </div>
        </div>

        {/* Limits */}
        {tier.limits?.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-gray-500 uppercase mb-2">Limits</div>
            <div className="grid grid-cols-2 gap-1.5">
              {tier.limits.map((l) => (
                <div key={l.limitKey} className="flex justify-between text-xs bg-gray-50 px-2 py-1.5 rounded">
                  <span className="text-gray-600">{LIMIT_KEYS.find((k) => k.key === l.limitKey)?.label || l.limitKey}</span>
                  <span className="font-medium text-gray-900">
                    {l.limitValue >= 999 ? (l.limitValue >= 999999 ? 'Unlimited' : '999+') : l.limitValue}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex gap-2">
        <button onClick={() => onEdit(tier)} className="px-3 py-1.5 text-xs bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">
          Edit Tier
        </button>
        {(tier._count?.tenants || 0) === 0 && (
          <button onClick={() => onDelete(tier.id)} className="px-3 py-1.5 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function TierModal({ tier, features, onSave, onClose }) {
  const [form, setForm] = useState({
    name: tier?.name || '',
    slug: tier?.slug || '',
    description: tier?.description || '',
    monthlyPrice: tier?.monthlyPrice || 0,
    annualPrice: tier?.annualPrice || 0,
    sortOrder: tier?.sortOrder || 0,
    isDefault: tier?.isDefault || false,
    featureIds: tier?.features?.map((f) => f.feature.id) || features.filter((f) => f.isCore).map((f) => f.id),
    limits: LIMIT_KEYS.map((lk) => {
      const existing = tier?.limits?.find((l) => l.limitKey === lk.key);
      return {
        limitKey: lk.key,
        limitValue: existing?.limitValue ?? 0,
        description: lk.description,
      };
    }),
  });
  const [saving, setSaving] = useState(false);

  const handleToggleFeature = (featureId, isCore) => {
    if (isCore) return; // Cannot toggle core features
    setForm((prev) => ({
      ...prev,
      featureIds: prev.featureIds.includes(featureId)
        ? prev.featureIds.filter((id) => id !== featureId)
        : [...prev.featureIds, featureId],
    }));
  };

  const handleLimitChange = (limitKey, value) => {
    setForm((prev) => ({
      ...prev,
      limits: prev.limits.map((l) =>
        l.limitKey === limitKey ? { ...l, limitValue: parseInt(value) || 0 } : l
      ),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const slug = form.slug || form.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      await onSave({
        name: form.name,
        slug,
        description: form.description,
        monthlyPrice: parseFloat(form.monthlyPrice) || 0,
        annualPrice: parseFloat(form.annualPrice) || 0,
        sortOrder: parseInt(form.sortOrder) || 0,
        isDefault: form.isDefault,
        featureIds: form.featureIds,
        limits: form.limits.filter((l) => l.limitValue > 0),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-8" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-bold">{tier ? 'Edit Tier' : 'Create New Tier'}</h2>
          </div>

          <div className="p-6 space-y-5 max-h-[65vh] overflow-y-auto">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tier Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. Premium"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="auto-generated"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={2}
                placeholder="Brief description of this tier"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Price ($)</label>
                <input
                  type="number"
                  value={form.monthlyPrice}
                  onChange={(e) => setForm({ ...form, monthlyPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min={0}
                  step={0.01}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Annual Price ($)</label>
                <input
                  type="number"
                  value={form.annualPrice}
                  onChange={(e) => setForm({ ...form, annualPrice: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min={0}
                  step={0.01}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min={0}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Set as default tier for new tenants</span>
            </label>

            {/* Features */}
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">Features</div>
              <div className="space-y-1.5">
                {features.map((f) => (
                  <label
                    key={f.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${
                      f.isCore
                        ? 'bg-blue-50 border-blue-200 cursor-not-allowed'
                        : form.featureIds.includes(f.id)
                        ? 'bg-green-50 border-green-200 cursor-pointer'
                        : 'bg-white border-gray-200 cursor-pointer hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={form.featureIds.includes(f.id) || f.isCore}
                      onChange={() => handleToggleFeature(f.id, f.isCore)}
                      disabled={f.isCore}
                      className="rounded"
                    />
                    <span className="text-sm">{f.icon}</span>
                    <span className="text-sm font-medium">{f.name}</span>
                    {f.isCore && <span className="text-xs text-blue-600 ml-auto">Core — always included</span>}
                  </label>
                ))}
              </div>
            </div>

            {/* Limits */}
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">Usage Limits</div>
              <div className="grid grid-cols-2 gap-3">
                {form.limits.map((l) => {
                  const def = LIMIT_KEYS.find((k) => k.key === l.limitKey);
                  return (
                    <div key={l.limitKey}>
                      <label className="block text-xs font-medium text-gray-600 mb-1">{def?.label || l.limitKey}</label>
                      <input
                        type="number"
                        value={l.limitValue}
                        onChange={(e) => handleLimitChange(l.limitKey, e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm"
                        min={0}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-2">Set to 0 to disable. Use 999 or 999999 for effectively unlimited.</p>
            </div>
          </div>

          <div className="p-6 border-t border-gray-100 flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium">
              {saving ? 'Saving...' : tier ? 'Save Changes' : 'Create Tier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FeatureModal({ feature, onSave, onClose }) {
  const [form, setForm] = useState({
    key: feature?.key || '',
    name: feature?.name || '',
    description: feature?.description || '',
    icon: feature?.icon || '',
    category: feature?.category || 'general',
    sortOrder: feature?.sortOrder || 0,
    isCore: feature?.isCore || false,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-bold">{feature ? 'Edit Feature' : 'Add New Feature'}</h2>
          </div>

          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. Demand Forecasting"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key {!feature && '*'}</label>
                <input
                  type="text"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. demand_forecasting"
                  disabled={!!feature}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                rows={2}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Icon (emoji)</label>
                <input
                  type="text"
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g. 📊"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="core">Core</option>
                  <option value="integrations">Integrations</option>
                  <option value="pricing">Pricing</option>
                  <option value="intelligence">Intelligence</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min={0}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isCore}
                onChange={(e) => setForm({ ...form, isCore: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Core feature (always included in every tier)</span>
            </label>
          </div>

          <div className="p-6 border-t border-gray-100 flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm text-white bg-brand-600 rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium">
              {saving ? 'Saving...' : feature ? 'Save Changes' : 'Create Feature'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function AdminProductSetup() {
  const [features, setFeatures] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [featureModal, setFeatureModal] = useState(null); // null | {} (new) | feature (edit)
  const [tierModal, setTierModal] = useState(null); // null | {} (new) | tier (edit)

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [featureList, tierList] = await Promise.all([
        api.admin.getFeatures(),
        api.admin.getTiers(),
      ]);
      setFeatures(featureList);
      setTiers(tierList);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Feature handlers
  const handleFeatureToggle = async (id, isActive) => {
    try {
      await api.admin.updateFeature(id, { isActive });
      setFeatures((prev) => prev.map((f) => f.id === id ? { ...f, isActive } : f));
    } catch (err) {
      console.error(err);
    }
  };

  const handleFeatureSave = async (data) => {
    try {
      if (featureModal?.id) {
        await api.admin.updateFeature(featureModal.id, data);
      } else {
        await api.admin.createFeature(data);
      }
      setFeatureModal(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleFeatureDelete = async (id) => {
    if (!confirm('Delete this feature?')) return;
    try {
      await api.admin.deleteFeature(id);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  // Tier handlers
  const handleTierSave = async (data) => {
    try {
      if (tierModal?.id) {
        await api.admin.updateTier(tierModal.id, data);
      } else {
        await api.admin.createTier(data);
      }
      setTierModal(null);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleTierDelete = async (id) => {
    if (!confirm('Delete this tier? This cannot be undone.')) return;
    try {
      await api.admin.deleteTier(id);
      loadData();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-500">Loading product setup...</div>;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-600 mb-2">Error: {error}</p>
        <button onClick={loadData} className="text-sm text-brand-600 hover:text-brand-700">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Product Setup</h1>
      </div>

      {/* ── Section 1: Feature Registry ── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Features</h2>
            <p className="text-sm text-gray-500">Manage the feature registry. Core features are always included in every tier.</p>
          </div>
          <button
            onClick={() => setFeatureModal({})}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
          >
            + Add Feature
          </button>
        </div>
        <FeatureTable
          features={features}
          onToggle={handleFeatureToggle}
          onEdit={(f) => setFeatureModal(f)}
          onDelete={handleFeatureDelete}
        />
      </div>

      {/* ── Section 2: Plan Tiers ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Plan Tiers</h2>
            <p className="text-sm text-gray-500">Configure pricing tiers with features and usage limits.</p>
          </div>
          <button
            onClick={() => setTierModal({})}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
          >
            + Create Tier
          </button>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              features={features}
              onEdit={(t) => setTierModal(t)}
              onDelete={handleTierDelete}
            />
          ))}
        </div>
        {tiers.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">
            No tiers configured yet. Create your first tier to get started.
          </div>
        )}
      </div>

      {/* Modals */}
      {featureModal !== null && (
        <FeatureModal
          feature={featureModal.id ? featureModal : null}
          onSave={handleFeatureSave}
          onClose={() => setFeatureModal(null)}
        />
      )}
      {tierModal !== null && (
        <TierModal
          tier={tierModal.id ? tierModal : null}
          features={features}
          onSave={handleTierSave}
          onClose={() => setTierModal(null)}
        />
      )}
    </div>
  );
}
