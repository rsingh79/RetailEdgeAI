import { useState, useEffect } from 'react';
import { api } from '../services/api';

/* ═══════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════ */
const SCOPE_STYLES = {
  GLOBAL: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Global' },
  CATEGORY: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Category' },
  SUPPLIER: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Supplier' },
  PRODUCT: { bg: 'bg-green-100', text: 'text-green-700', label: 'Product' },
};

const ROUNDING_OPTIONS = [
  { value: '.99', label: '.99 (e.g. $6.99)' },
  { value: '.49/.99', label: '.49/.99 (e.g. $6.49 or $6.99)' },
  { value: 'nearest_5', label: 'Nearest 5¢ (e.g. $6.95)' },
  { value: '', label: 'None (exact calculation)' },
];

const DEFAULT_RULE = {
  name: '',
  scope: 'GLOBAL',
  scopeValue: '',
  targetMargin: 35,
  minMargin: 20,
  maxPriceJump: 15,
  roundingStrategy: '.99',
  priority: 0,
};

const DEFAULT_THRESHOLDS = {
  autoApproveMaxDollar: 0.5,
  autoApproveMaxPercent: 5,
  ownerApprovalDollar: 2.0,
  ownerApprovalPercent: 15,
  blockBelowMargin: 20,
};

/* ═══════════════════════════════════════════════════════════════════
   Rule Card Component
   ═══════════════════════════════════════════════════════════════════ */
function RuleCard({ rule, onEdit, onDelete, onToggle }) {
  const scope = SCOPE_STYLES[rule.scope] || SCOPE_STYLES.GLOBAL;
  const roundingLabel = ROUNDING_OPTIONS.find((r) => r.value === rule.roundingStrategy)?.label || 'None';

  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-5 transition hover:shadow-md ${!rule.isActive ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${scope.bg} ${scope.text}`}>
            {scope.label}
          </span>
          {rule.scopeValue && (
            <span className="text-xs text-gray-500">· {rule.scopeValue}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle switch */}
          <button
            onClick={() => onToggle(rule)}
            className={`relative w-10 h-5 rounded-full transition ${rule.isActive ? 'bg-brand-600' : 'bg-gray-300'}`}
            title={rule.isActive ? 'Active — click to disable' : 'Inactive — click to enable'}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                rule.isActive ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <h3 className="font-semibold text-gray-900 mb-3">{rule.name}</h3>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-gray-500">Target Margin</span>
          <p className="font-medium text-gray-900">{rule.targetMargin != null ? `${rule.targetMargin}%` : '—'}</p>
        </div>
        <div>
          <span className="text-gray-500">Min Margin</span>
          <p className="font-medium text-gray-900">{rule.minMargin != null ? `${rule.minMargin}%` : '—'}</p>
        </div>
        <div>
          <span className="text-gray-500">Max Price Jump</span>
          <p className="font-medium text-gray-900">{rule.maxPriceJump != null ? `${rule.maxPriceJump}%` : '—'}</p>
        </div>
        <div>
          <span className="text-gray-500">Rounding</span>
          <p className="font-medium text-gray-900">{roundingLabel.split(' ')[0]}</p>
        </div>
      </div>

      {rule.priority > 0 && (
        <div className="mt-2 text-xs text-gray-400">Priority: {rule.priority}</div>
      )}

      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-gray-100">
        <button
          onClick={() => onEdit(rule)}
          className="px-3 py-1.5 text-sm text-brand-600 hover:bg-brand-50 rounded-lg transition"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(rule)}
          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Rule Modal (Add / Edit)
   ═══════════════════════════════════════════════════════════════════ */
function RuleModal({ rule, onSave, onClose, saving }) {
  const [form, setForm] = useState(rule || DEFAULT_RULE);
  const isEdit = !!rule?.id;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({
      ...form,
      targetMargin: form.targetMargin ? parseFloat(form.targetMargin) : null,
      minMargin: form.minMargin ? parseFloat(form.minMargin) : null,
      maxPriceJump: form.maxPriceJump ? parseFloat(form.maxPriceJump) : null,
      priority: parseInt(form.priority) || 0,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden slide-up">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit Pricing Rule' : 'Add Pricing Rule'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Rule Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Dairy Products Margin"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              required
            />
          </div>

          {/* Scope */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
              <select
                value={form.scope}
                onChange={(e) => setForm((p) => ({ ...p, scope: e.target.value, scopeValue: e.target.value === 'GLOBAL' ? '' : p.scopeValue }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              >
                <option value="GLOBAL">Global</option>
                <option value="CATEGORY">Category</option>
                <option value="SUPPLIER">Supplier</option>
                <option value="PRODUCT">Product</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.scope === 'GLOBAL' ? 'Scope Value' : `${form.scope.charAt(0) + form.scope.slice(1).toLowerCase()} Name/ID`}
              </label>
              <input
                type="text"
                value={form.scopeValue || ''}
                onChange={(e) => setForm((p) => ({ ...p, scopeValue: e.target.value }))}
                placeholder={form.scope === 'GLOBAL' ? 'N/A' : `e.g. ${form.scope === 'CATEGORY' ? 'Dairy' : form.scope === 'SUPPLIER' ? 'Farm Fresh' : 'SKU-001'}`}
                disabled={form.scope === 'GLOBAL'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>
          </div>

          {/* Margin Targets */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Margin %</label>
              <input
                type="number"
                step="0.1"
                value={form.targetMargin ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, targetMargin: e.target.value }))}
                placeholder="35"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Margin %</label>
              <input
                type="number"
                step="0.1"
                value={form.minMargin ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, minMargin: e.target.value }))}
                placeholder="20"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Price Jump %</label>
              <input
                type="number"
                step="0.1"
                value={form.maxPriceJump ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, maxPriceJump: e.target.value }))}
                placeholder="15"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Rounding & Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rounding Strategy</label>
              <select
                value={form.roundingStrategy || ''}
                onChange={(e) => setForm((p) => ({ ...p, roundingStrategy: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              >
                {ROUNDING_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
                placeholder="0"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              />
              <p className="text-xs text-gray-400 mt-1">Higher = takes precedence</p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.name.trim()}
              className="flex-1 px-6 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving...' : isEdit ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Approval Thresholds Section
   ═══════════════════════════════════════════════════════════════════ */
function ApprovalThresholds({ thresholds, onChange, onSave, saving }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Approval Thresholds</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Control which cost changes need manual review
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-1.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition"
        >
          {saving ? 'Saving...' : 'Save Thresholds'}
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* Auto-approve */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-900">Auto-approve small changes</h4>
            <p className="text-xs text-gray-500 mb-2">
              Cost changes below these thresholds are approved automatically
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Under $</span>
                <input
                  type="number"
                  step="0.1"
                  value={thresholds.autoApproveMaxDollar}
                  onChange={(e) => onChange({ ...thresholds, autoApproveMaxDollar: parseFloat(e.target.value) || 0 })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <span className="text-xs text-gray-400">or</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Under</span>
                <input
                  type="number"
                  step="0.5"
                  value={thresholds.autoApproveMaxPercent}
                  onChange={(e) => onChange({ ...thresholds, autoApproveMaxPercent: parseFloat(e.target.value) || 0 })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                />
                <span className="text-xs text-gray-500">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Owner approval */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-900">Require owner approval</h4>
            <p className="text-xs text-gray-500 mb-2">
              Cost changes above these thresholds need owner sign-off
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Above $</span>
                <input
                  type="number"
                  step="0.1"
                  value={thresholds.ownerApprovalDollar}
                  onChange={(e) => onChange({ ...thresholds, ownerApprovalDollar: parseFloat(e.target.value) || 0 })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <span className="text-xs text-gray-400">or</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Above</span>
                <input
                  type="number"
                  step="0.5"
                  value={thresholds.ownerApprovalPercent}
                  onChange={(e) => onChange({ ...thresholds, ownerApprovalPercent: parseFloat(e.target.value) || 0 })}
                  className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
                />
                <span className="text-xs text-gray-500">%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Block write-back */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-red-50 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-gray-900">Block POS write-back</h4>
            <p className="text-xs text-gray-500 mb-2">
              Never auto-push prices to POS when margin falls below this floor
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Block when margin below</span>
              <input
                type="number"
                step="0.5"
                value={thresholds.blockBelowMargin}
                onChange={(e) => onChange({ ...thresholds, blockBelowMargin: parseFloat(e.target.value) || 0 })}
                className="w-20 px-2 py-1 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-xs text-gray-500">%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main Pricing Page
   ═══════════════════════════════════════════════════════════════════ */
export default function Pricing() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { mode: 'add' } | { mode: 'edit', rule }
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [savingThresholds, setSavingThresholds] = useState(false);

  useEffect(() => {
    loadRules();
    // Load thresholds from localStorage (would be API in production)
    const saved = localStorage.getItem('retailedge_thresholds');
    if (saved) {
      try { setThresholds(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const loadRules = async () => {
    try {
      const data = await api.getPricingRules();
      setRules(data);
    } catch {
      // API not available — use mock data for demo
      setRules([
        { id: '1', name: 'Default Markup', scope: 'GLOBAL', scopeValue: null, targetMargin: 35, minMargin: 20, maxPriceJump: 15, roundingStrategy: '.99', priority: 0, isActive: true },
        { id: '2', name: 'Dairy Products', scope: 'CATEGORY', scopeValue: 'Dairy', targetMargin: 30, minMargin: 18, maxPriceJump: 10, roundingStrategy: '.49/.99', priority: 10, isActive: true },
        { id: '3', name: 'Farm Fresh Supplies', scope: 'SUPPLIER', scopeValue: 'Farm Fresh', targetMargin: 32, minMargin: 22, maxPriceJump: 12, roundingStrategy: '.99', priority: 20, isActive: true },
        { id: '4', name: 'Free Range Eggs 700g', scope: 'PRODUCT', scopeValue: 'EGG-FR-700', targetMargin: 40, minMargin: 25, maxPriceJump: 8, roundingStrategy: 'nearest_5', priority: 100, isActive: false },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (data) => {
    setSaving(true);
    try {
      if (modal?.mode === 'edit') {
        await api.updatePricingRule(modal.rule.id, data);
      } else {
        await api.createPricingRule(data);
      }
      await loadRules();
      setModal(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (rule) => {
    try {
      await api.updatePricingRule(rule.id, { isActive: !rule.isActive });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
    } catch {
      // Fallback — toggle locally
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, isActive: !r.isActive } : r));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deletePricingRule(deleteTarget.id);
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    } catch {
      // Fallback — remove locally
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    }
    setDeleteTarget(null);
  };

  const handleSaveThresholds = () => {
    setSavingThresholds(true);
    // Persist to localStorage (would be API in production)
    localStorage.setItem('retailedge_thresholds', JSON.stringify(thresholds));
    setTimeout(() => setSavingThresholds(false), 500);
  };

  // Group rules by scope for display
  const activeRules = rules.filter((r) => r.isActive);
  const inactiveRules = rules.filter((r) => !r.isActive);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading pricing rules...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pricing Rules</h2>
          <p className="text-sm text-gray-500 mt-1">
            Configure margin targets, markup rules, and rounding strategies.
            Rules are applied by specificity: Product {'>'} Supplier {'>'} Category {'>'} Global.
          </p>
        </div>
        <button
          onClick={() => setModal({ mode: 'add' })}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition flex items-center gap-1.5"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Rule
        </button>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-6 bg-white rounded-xl border border-gray-200 px-5 py-3">
        <div className="text-center">
          <div className="text-lg font-bold text-gray-900">{rules.length}</div>
          <div className="text-xs text-gray-500">Total Rules</div>
        </div>
        <div className="w-px h-8 bg-gray-200" />
        <div className="text-center">
          <div className="text-lg font-bold text-green-600">{activeRules.length}</div>
          <div className="text-xs text-gray-500">Active</div>
        </div>
        <div className="w-px h-8 bg-gray-200" />
        <div className="text-center">
          <div className="text-lg font-bold text-gray-400">{inactiveRules.length}</div>
          <div className="text-xs text-gray-500">Inactive</div>
        </div>
        <div className="w-px h-8 bg-gray-200" />
        {Object.entries(SCOPE_STYLES).map(([scope, style]) => {
          const count = rules.filter((r) => r.scope === scope).length;
          if (count === 0) return null;
          return (
            <div key={scope} className="flex items-center gap-1.5">
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
                {count}
              </span>
              <span className="text-xs text-gray-500">{style.label}</span>
            </div>
          );
        })}
      </div>

      {/* Rule Cards Grid */}
      {rules.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No pricing rules yet</h3>
          <p className="text-sm text-gray-500 mb-4">Create your first rule to set margin targets and rounding strategies.</p>
          <button
            onClick={() => setModal({ mode: 'add' })}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition"
          >
            Create First Rule
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onEdit={(r) => setModal({ mode: 'edit', rule: r })}
              onDelete={(r) => setDeleteTarget(r)}
              onToggle={handleToggle}
            />
          ))}
        </div>
      )}

      {/* Approval Thresholds */}
      <ApprovalThresholds
        thresholds={thresholds}
        onChange={setThresholds}
        onSave={handleSaveThresholds}
        saving={savingThresholds}
      />

      {/* Add/Edit Modal */}
      {modal && (
        <RuleModal
          rule={modal.mode === 'edit' ? modal.rule : null}
          onSave={handleSave}
          onClose={() => setModal(null)}
          saving={saving}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full slide-up">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Rule</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
