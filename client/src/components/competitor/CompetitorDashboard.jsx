import { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function CompetitorDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [monitors, setMonitors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.competitor.getMonitors().catch(() => []),
      api.competitor.getAlerts().catch(() => []),
    ])
      .then(([m, a]) => {
        setMonitors(m);
        setAlerts(a);
      })
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'suppliers', label: 'Supplier Comparison' },
    { id: 'alerts', label: 'Alerts & AI' },
  ];

  const unreadAlerts = alerts.filter((a) => !a.isRead && !a.isDismissed).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Competitor Intelligence</h2>
        <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
          Enterprise
        </span>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition border-b-2 ${
              activeTab === tab.id
                ? 'text-brand-600 border-brand-600'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
            {tab.id === 'alerts' && unreadAlerts > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full">
                {unreadAlerts}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading competitor data...</div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <DashboardTab monitors={monitors} setMonitors={setMonitors} />
          )}
          {activeTab === 'suppliers' && (
            <SupplierTab />
          )}
          {activeTab === 'alerts' && (
            <AlertsTab alerts={alerts} setAlerts={setAlerts} />
          )}
        </>
      )}
    </div>
  );
}

function DashboardTab({ monitors, setMonitors }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [products, setProducts] = useState([]);
  const [newMonitor, setNewMonitor] = useState({ productId: '', competitor: 'woolworths' });

  const totalMonitors = monitors.length;
  const activeMonitors = monitors.filter((m) => m.isActive).length;
  const withPrices = monitors.filter((m) => m.prices?.length > 0).length;

  const handleAddMonitor = async () => {
    if (!newMonitor.productId) return;
    try {
      const created = await api.competitor.createMonitor(newMonitor);
      setMonitors((prev) => [created, ...prev]);
      setShowAddModal(false);
      setNewMonitor({ productId: '', competitor: 'woolworths' });
    } catch (err) {
      alert(err.message);
    }
  };

  useEffect(() => {
    if (showAddModal) {
      api.getProducts().then(setProducts).catch(() => {});
    }
  }, [showAddModal]);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl font-bold text-gray-900">{totalMonitors}</div>
          <div className="text-sm text-gray-500 mt-1">Products Monitored</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl font-bold text-emerald-600">{activeMonitors}</div>
          <div className="text-sm text-gray-500 mt-1">Active Monitors</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl font-bold text-blue-600">{withPrices}</div>
          <div className="text-sm text-gray-500 mt-1">With Price Data</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-2xl font-bold text-gray-400">-</div>
          <div className="text-sm text-gray-500 mt-1">Avg Margin</div>
        </div>
      </div>

      {/* Monitors table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Competitor Monitors</h3>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition"
          >
            + Add Monitor
          </button>
        </div>

        {monitors.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-sm">No competitor monitors set up yet.</p>
            <p className="text-xs mt-1">Click "Add Monitor" to start tracking competitor prices.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Competitor</th>
                <th className="px-5 py-3">Latest Price</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {monitors.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    {m.product?.name || 'Unknown'}
                    {m.product?.category && (
                      <span className="ml-2 text-xs text-gray-400">{m.product.category}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 capitalize">{m.competitor}</td>
                  <td className="px-5 py-3">
                    {m.prices?.[0] ? (
                      <span className="font-mono">${m.prices[0].price.toFixed(2)}</span>
                    ) : (
                      <span className="text-gray-400">No data</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      m.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {m.isActive ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">
                    {m.lastScrapedAt ? new Date(m.lastScrapedAt).toLocaleDateString() : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Monitor Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Add Competitor Monitor</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
              <select
                value={newMonitor.productId}
                onChange={(e) => setNewMonitor((p) => ({ ...p, productId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">Select a product...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Competitor</label>
              <select
                value={newMonitor.competitor}
                onChange={(e) => setNewMonitor((p) => ({ ...p, competitor: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="woolworths">Woolworths</option>
                <option value="coles">Coles</option>
                <option value="aldi">ALDI</option>
                <option value="iga">IGA</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMonitor}
                disabled={!newMonitor.productId}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
              >
                Add Monitor
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SupplierTab() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 text-center text-gray-400">
      <p className="text-sm">Select a product to view cross-supplier cost comparison.</p>
      <p className="text-xs mt-1">Data is sourced from your invoice history.</p>
    </div>
  );
}

function AlertsTab({ alerts, setAlerts }) {
  const handleMarkRead = async (id) => {
    try {
      await api.competitor.updateAlert(id, { isRead: true });
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isRead: true } : a)));
    } catch (err) {
      console.error(err);
    }
  };

  const handleDismiss = async (id) => {
    try {
      await api.competitor.updateAlert(id, { isDismissed: true });
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isDismissed: true } : a)));
    } catch (err) {
      console.error(err);
    }
  };

  const severityStyles = {
    critical: 'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    info: 'bg-blue-50 border-blue-200 text-blue-700',
  };

  const alertTypeLabels = {
    competitor_undercut: 'Competitor Drop',
    margin_squeeze: 'Margin Alert',
    cost_increase: 'Cost Increase',
    price_opportunity: 'Opportunity',
  };

  const visibleAlerts = alerts.filter((a) => !a.isDismissed);

  return (
    <div className="space-y-4">
      {visibleAlerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          <p className="text-sm">No alerts. Generate alerts from your competitor data.</p>
          <button
            onClick={async () => {
              try {
                const result = await api.competitor.generateAlerts();
                alert(`${result.alertsGenerated} new alerts generated`);
              } catch (err) {
                alert(err.message);
              }
            }}
            className="mt-3 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium"
          >
            Generate Alerts
          </button>
        </div>
      ) : (
        visibleAlerts.map((alert) => (
          <div
            key={alert.id}
            className={`rounded-xl border p-4 ${severityStyles[alert.severity] || severityStyles.info} ${
              alert.isRead ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase">
                    {alertTypeLabels[alert.alertType] || alert.alertType}
                  </span>
                  {!alert.isRead && (
                    <span className="w-2 h-2 bg-current rounded-full" />
                  )}
                </div>
                <div className="font-medium">{alert.title}</div>
                <div className="text-sm opacity-80">{alert.description}</div>
                <div className="text-xs opacity-60">
                  {alert.product?.name} &middot; {new Date(alert.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                {!alert.isRead && (
                  <button
                    onClick={() => handleMarkRead(alert.id)}
                    className="text-xs underline opacity-70 hover:opacity-100"
                  >
                    Mark Read
                  </button>
                )}
                <button
                  onClick={() => handleDismiss(alert.id)}
                  className="text-xs underline opacity-70 hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
