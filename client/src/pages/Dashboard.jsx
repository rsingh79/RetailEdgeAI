import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

const STATUS_STYLES = {
  READY: 'bg-amber-100 text-amber-700',
  IN_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-teal-100 text-teal-700',
};

const STATUS_DOT = {
  READY: 'bg-amber-500',
  IN_REVIEW: 'bg-amber-500',
  APPROVED: 'bg-emerald-500',
};

const STATUS_LABEL = {
  READY: 'Ready',
  IN_REVIEW: 'In Review',
  APPROVED: 'Approved',
};

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(val) {
  if (val == null) return '—';
  return `$${Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [actionInvoices, setActionInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsData, invoicesData] = await Promise.all([
          api.getDashboardStats(),
          api.getActionInvoices(),
        ]);
        if (!cancelled) {
          setStats(statsData);
          setActionInvoices(invoicesData);
        }
      } catch {
        // ignore — dashboard data is non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pipeline = stats?.pipeline || { upload: 0, review: 0, export: 0 };

  const cards = stats
    ? [
        {
          label: 'Pending Invoices',
          value: stats.pendingInvoices,
          sub: stats.pendingInvoices === 1 ? '1 invoice to review' : `${stats.pendingInvoices} invoices to review`,
          color: 'amber',
        },
        {
          label: 'Awaiting Approval',
          value: stats.awaitingApproval,
          sub: stats.awaitingApprovalValue > 0
            ? `$${stats.awaitingApprovalValue.toLocaleString()} in cost changes`
            : 'No pending approvals',
          color: 'brand',
        },
        {
          label: 'Margin Alerts',
          value: stats.marginAlerts,
          sub: stats.marginAlerts === 1
            ? '1 product with >10% cost increase'
            : `${stats.marginAlerts} products with >10% cost increase`,
          color: stats.marginAlerts > 0 ? 'red' : 'emerald',
        },
        {
          label: 'Cost Changes Today',
          value: stats.costChangesToday,
          sub: stats.avgCostIncrease !== 0
            ? `${stats.avgCostIncrease > 0 ? '+' : ''}${stats.avgCostIncrease}% avg change`
            : 'No changes today',
          color: 'emerald',
        },
      ]
    : [
        { label: 'Pending Invoices', value: '—', sub: '', color: 'brand' },
        { label: 'Awaiting Approval', value: '—', sub: '', color: 'amber' },
        { label: 'Margin Alerts', value: '—', sub: '', color: 'red' },
        { label: 'Cost Changes Today', value: '—', sub: '', color: 'emerald' },
      ];

  const colorMap = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    brand: 'text-gray-900',
  };

  function handleActionClick(inv, e) {
    e.stopPropagation();
    if (inv.status === 'APPROVED') {
      navigate(`/export?invoiceId=${inv.id}`);
    } else {
      navigate(`/review/${inv.id}`);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Invoice Pipeline ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-5">Invoice Pipeline</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0">
          {/* Stage 1: Upload */}
          <div
            onClick={() => navigate('/invoices')}
            className="flex-1 cursor-pointer group"
          >
            <div className="bg-blue-50 border-2 border-blue-200 group-hover:border-blue-400 rounded-xl p-4 text-center transition">
              <div className="flex items-center justify-center gap-2 mb-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-sm font-semibold text-blue-700">1. Upload</span>
              </div>
              <div className={`text-3xl font-bold text-blue-600 ${loading ? 'animate-pulse' : ''}`}>
                {loading ? '—' : pipeline.upload}
              </div>
              <div className="text-xs text-blue-500 mt-1">processing</div>
            </div>
          </div>

          {/* Arrow */}
          <div className="hidden sm:block flex-shrink-0 px-3">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
          {/* Down arrow (mobile) */}
          <div className="sm:hidden flex justify-center">
            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
            </svg>
          </div>

          {/* Stage 2: Review & Price */}
          <div
            onClick={() => navigate('/review')}
            className="flex-1 cursor-pointer group"
          >
            <div className="bg-amber-50 border-2 border-amber-200 group-hover:border-amber-400 rounded-xl p-4 text-center transition">
              <div className="flex items-center justify-center gap-2 mb-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.35 3.836c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m8.9-4.414c.376.023.75.05 1.124.08 1.131.094 1.976 1.057 1.976 2.192V16.5A2.25 2.25 0 0118 18.75h-2.25m-7.5-10.5H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V18.75m-7.5-10.5h6.375c.621 0 1.125.504 1.125 1.125v9.375m-8.25-3l1.5 1.5 3-3.75" />
                </svg>
                <span className="text-sm font-semibold text-amber-700">2. Review & Price</span>
              </div>
              <div className={`text-3xl font-bold text-amber-600 ${loading ? 'animate-pulse' : ''}`}>
                {loading ? '—' : pipeline.review}
              </div>
              <div className="text-xs text-amber-500 mt-1">awaiting review</div>
            </div>
          </div>

          {/* Arrow */}
          <div className="hidden sm:block flex-shrink-0 px-3">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
          {/* Down arrow (mobile) */}
          <div className="sm:hidden flex justify-center">
            <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
            </svg>
          </div>

          {/* Stage 3: Export */}
          <div
            onClick={() => navigate('/export')}
            className="flex-1 cursor-pointer group"
          >
            <div className="bg-emerald-50 border-2 border-emerald-200 group-hover:border-emerald-400 rounded-xl p-4 text-center transition">
              <div className="flex items-center justify-center gap-2 mb-2">
                <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <span className="text-sm font-semibold text-emerald-700">3. Export</span>
              </div>
              <div className={`text-3xl font-bold text-emerald-600 ${loading ? 'animate-pulse' : ''}`}>
                {loading ? '—' : pipeline.export}
              </div>
              <div className="text-xs text-emerald-500 mt-1">ready to export</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((stat) => (
          <div
            key={stat.label}
            className={`bg-white rounded-xl border border-gray-200 p-5 transition ${loading ? 'animate-pulse' : ''}`}
          >
            <div className="text-sm font-medium text-gray-500 mb-3">{stat.label}</div>
            <div className={`text-3xl font-bold ${colorMap[stat.color] || ''}`}>
              {stat.value}
            </div>
            <div className="text-sm text-gray-500 mt-1">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Invoices Requiring Action ── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Invoices Requiring Action</h3>
          <button
            onClick={() => navigate('/invoices')}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            View All
          </button>
        </div>

        {actionInvoices.length === 0 && !loading ? (
          <div className="px-6 py-10 text-center text-gray-400">
            All invoices are up to date
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="px-4 sm:px-6 py-3">Status</th>
                <th className="px-4 sm:px-6 py-3">Supplier</th>
                <th className="hidden sm:table-cell px-6 py-3">Invoice #</th>
                <th className="hidden md:table-cell px-6 py-3">Date</th>
                <th className="hidden md:table-cell px-6 py-3">Lines</th>
                <th className="px-4 sm:px-6 py-3">Total</th>
                <th className="hidden sm:table-cell px-6 py-3">Next Step</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {actionInvoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => handleActionClick(inv, { stopPropagation: () => {} })}
                >
                  <td className="px-4 sm:px-6 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[inv.status] || 'bg-gray-400'}`} />
                      {STATUS_LABEL[inv.status] || inv.status}
                    </span>
                  </td>
                  <td className="px-4 sm:px-6 py-3 text-sm font-medium truncate max-w-[120px] sm:max-w-none">{inv.supplierName || inv.supplier || '—'}</td>
                  <td className="hidden sm:table-cell px-6 py-3 text-sm text-gray-600">{inv.invoiceNumber || '—'}</td>
                  <td className="hidden md:table-cell px-6 py-3 text-sm text-gray-500">{formatDate(inv.invoiceDate || inv.createdAt)}</td>
                  <td className="hidden md:table-cell px-6 py-3 text-sm">{inv._count?.lines ?? '—'}</td>
                  <td className="px-4 sm:px-6 py-3 text-sm font-medium">{formatCurrency(inv.total)}</td>
                  <td className="hidden sm:table-cell px-6 py-3">
                    {inv.status === 'APPROVED' ? (
                      <button
                        onClick={(e) => handleActionClick(inv, e)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Export
                      </button>
                    ) : (
                      <button
                        onClick={(e) => handleActionClick(inv, e)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        {inv.status === 'IN_REVIEW' ? 'Continue Review' : 'Review'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
