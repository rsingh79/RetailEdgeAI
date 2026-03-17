import { useState, useEffect } from 'react';
import { api } from '../../services/api';

export default function AdminApiUsage() {
  const [usage, setUsage] = useState(null);
  const [calls, setCalls] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState([]);
  const [expandedCall, setExpandedCall] = useState(null);
  const [callDetail, setCallDetail] = useState(null);
  const [showDrilldown, setShowDrilldown] = useState(false);
  const [drilldownTenantId, setDrilldownTenantId] = useState('');

  // Filters
  const [tenantFilter, setTenantFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    loadData();
    api.admin.getTenants().then(setTenants).catch(console.error);
  }, []);

  const loadData = () => {
    setLoading(true);
    const params = {};
    if (tenantFilter) params.tenantId = tenantFilter;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;

    api.admin.getApiUsage(Object.keys(params).length ? params : null)
      .then(setUsage)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const loadCalls = (tenantId) => {
    const params = { limit: 50 };
    if (tenantId) params.tenantId = tenantId;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    api.admin.getApiCalls(params).then(setCalls).catch(console.error);
    setShowDrilldown(true);
    setDrilldownTenantId(tenantId || '');
  };

  const loadCallDetail = async (callId) => {
    if (expandedCall === callId) {
      setExpandedCall(null);
      return;
    }
    try {
      const detail = await api.admin.getApiCallDetail(callId);
      setCallDetail(detail);
      setExpandedCall(callId);
    } catch (err) { console.error(err); }
  };

  const maxCost = usage?.chartData?.length
    ? Math.max(...usage.chartData.map((d) => d.cost))
    : 1;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">API Usage & Costs</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Tenants</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          placeholder="To"
        />
        <button
          onClick={loadData}
          className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          Apply
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64 text-gray-500">Loading...</div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total API Calls', value: usage?.summary?.totalCalls || 0, color: 'text-blue-600' },
              { label: 'Total Cost', value: `$${(usage?.summary?.totalCost || 0).toFixed(2)}`, color: 'text-purple-600' },
              { label: 'Input Tokens', value: (usage?.summary?.totalInputTokens || 0).toLocaleString(), color: 'text-emerald-600' },
              { label: 'Output Tokens', value: (usage?.summary?.totalOutputTokens || 0).toLocaleString(), color: 'text-amber-600' },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="text-sm text-gray-500">{card.label}</div>
                <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Cost Chart */}
          {usage?.chartData?.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
              <h3 className="font-semibold mb-4">Daily Cost</h3>
              <div className="flex items-end gap-1 h-32">
                {usage.chartData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center" title={`${d.date}: $${d.cost.toFixed(2)} (${d.calls} calls)`}>
                    <div
                      className="w-full bg-purple-500 rounded-t min-h-[2px]"
                      style={{ height: `${(d.cost / maxCost) * 100}%` }}
                    />
                    <div className="text-[9px] text-gray-400 mt-1 rotate-[-45deg] origin-top-left whitespace-nowrap">
                      {d.date.slice(5)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tenant Breakdown */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Tenant Breakdown</h3>
              <button
                onClick={() => loadCalls('')}
                className="text-sm text-brand-600 hover:underline"
              >
                View All Calls
              </button>
            </div>
            {(usage?.tenantBreakdown || []).length === 0 ? (
              <p className="text-gray-500 text-sm">No usage data</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2 font-medium text-gray-500">Tenant</th>
                    <th className="text-right py-2 font-medium text-gray-500">Calls</th>
                    <th className="text-right py-2 font-medium text-gray-500">Input Tokens</th>
                    <th className="text-right py-2 font-medium text-gray-500">Output Tokens</th>
                    <th className="text-right py-2 font-medium text-gray-500">Cost</th>
                    <th className="text-right py-2 font-medium text-gray-500">% of Total</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {usage.tenantBreakdown.map((t) => {
                    const pct = usage.summary.totalCost > 0
                      ? ((t.cost / usage.summary.totalCost) * 100).toFixed(1)
                      : 0;
                    return (
                      <tr key={t.tenantId} className="border-b border-gray-100">
                        <td className="py-2.5 font-medium text-gray-900">{t.tenantName}</td>
                        <td className="py-2.5 text-right text-gray-600">{t.calls}</td>
                        <td className="py-2.5 text-right text-gray-600">{t.inputTokens.toLocaleString()}</td>
                        <td className="py-2.5 text-right text-gray-600">{t.outputTokens.toLocaleString()}</td>
                        <td className="py-2.5 text-right font-medium">${t.cost.toFixed(2)}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-purple-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-gray-500 w-10 text-right">{pct}%</span>
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => loadCalls(t.tenantId)}
                            className="text-brand-600 hover:underline text-xs"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Drilldown: API Call Log */}
          {showDrilldown && calls && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold">
                  API Call Log
                  {drilldownTenantId && (
                    <span className="text-sm font-normal text-gray-500 ml-2">
                      ({tenants.find((t) => t.id === drilldownTenantId)?.name || 'Filtered'})
                    </span>
                  )}
                </h3>
                <button onClick={() => setShowDrilldown(false)} className="text-sm text-gray-500 hover:text-gray-700">
                  Close
                </button>
              </div>
              <div className="space-y-1">
                {(calls.calls || []).map((call) => (
                  <div key={call.id}>
                    <div
                      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm"
                      onClick={() => loadCallDetail(call.id)}
                    >
                      <span className="text-gray-400 w-36">{new Date(call.createdAt).toLocaleString()}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        call.endpoint === 'ocr' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {call.endpoint}
                      </span>
                      <span className="text-gray-500 text-xs">{call.model}</span>
                      <span className="flex-1" />
                      <span className="text-gray-600">{call.inputTokens?.toLocaleString()} / {call.outputTokens?.toLocaleString()}</span>
                      <span className="text-gray-400 text-xs w-14 text-right">{call.durationMs}ms</span>
                      <span className="font-medium w-16 text-right">${call.costUsd?.toFixed(4)}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${call.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {call.status}
                      </span>
                    </div>
                    {expandedCall === call.id && callDetail && (
                      <div className="mx-3 mb-3 p-4 bg-gray-900 rounded-lg text-xs font-mono text-gray-300">
                        <div className="mb-3">
                          <div className="text-gray-500 mb-1">Request</div>
                          <pre className="whitespace-pre-wrap">{JSON.stringify(callDetail.requestPayload, null, 2)}</pre>
                        </div>
                        <div>
                          <div className="text-gray-500 mb-1">Response</div>
                          <pre className="whitespace-pre-wrap">{JSON.stringify(callDetail.responsePayload, null, 2)}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {calls.pagination && calls.pagination.totalPages > 1 && (
                <div className="mt-3 text-center text-sm text-gray-500">
                  Page {calls.pagination.page} of {calls.pagination.totalPages} ({calls.pagination.total} total calls)
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
