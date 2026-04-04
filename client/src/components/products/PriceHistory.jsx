import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';

const SOURCE_LABELS = {
  shopify_sync: 'Shopify sync',
  manual_edit: 'Manual edit',
  bulk_import: 'Bulk import',
  invoice_processing: 'Invoice processing',
  invoice_correction: 'Invoice correction',
  approval_action: 'Approval action',
  ai_recommendation: 'AI recommendation',
  api: 'API',
};

const PRICE_TYPE_LABELS = {
  selling_price: 'Selling price',
  cost_price: 'Cost price',
  sale_price: 'Sale price',
};

const PRICE_TYPE_COLORS = {
  selling_price: 'bg-blue-100 text-blue-700',
  cost_price: 'bg-amber-100 text-amber-700',
  sale_price: 'bg-purple-100 text-purple-700',
};

function formatPrice(value) {
  if (value == null) return '-';
  return `$${Number(value).toFixed(2)}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PriceHistory({ productId, onClose }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [priceTypeFilter, setPriceTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 20;

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { limit: pageSize, offset: page * pageSize };
      if (priceTypeFilter) params.priceType = priceTypeFilter;
      const data = await api.getProductPriceHistory(productId, params);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [productId, priceTypeFilter, page]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setPage(0);
  }, [priceTypeFilter]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h3 className="text-base font-semibold text-gray-900">Price History</h3>
        <div className="flex items-center gap-3">
          <select
            value={priceTypeFilter}
            onChange={(e) => setPriceTypeFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All price types</option>
            <option value="selling_price">Selling price</option>
            <option value="cost_price">Cost price</option>
            <option value="sale_price">Sale price</option>
          </select>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
          Loading price history...
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
          No price changes recorded yet
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3 text-right">Old Price</th>
                  <th className="px-5 py-3"></th>
                  <th className="px-5 py-3 text-right">New Price</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Changed by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.map((entry) => {
                  const priceUp = entry.oldPrice != null && entry.newPrice > entry.oldPrice;
                  const priceDown = entry.oldPrice != null && entry.newPrice < entry.oldPrice;
                  // For cost prices: increase is bad (red), decrease is good (green)
                  // For selling prices: increase is good (green), decrease is bad (red)
                  const isCost = entry.priceType === 'cost_price';
                  const isGood = isCost ? priceDown : priceUp;
                  const isBad = isCost ? priceUp : priceDown;
                  const arrowColor = isGood
                    ? 'text-green-600'
                    : isBad
                    ? 'text-red-600'
                    : 'text-gray-400';

                  return (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                        {formatDate(entry.createdAt)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            PRICE_TYPE_COLORS[entry.priceType] || 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {PRICE_TYPE_LABELS[entry.priceType] || entry.priceType}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-gray-500">
                        {formatPrice(entry.oldPrice)}
                      </td>
                      <td className={`px-2 py-3 text-center ${arrowColor}`}>
                        &rarr;
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-medium text-gray-900">
                        {formatPrice(entry.newPrice)}
                      </td>
                      <td className="px-5 py-3 text-gray-600">
                        {entry.invoiceContext ? (
                          <a
                            href={`/invoices/${entry.invoiceContext.invoiceId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-teal-600 hover:text-teal-800 hover:underline"
                          >
                            Invoice #{entry.invoiceContext.invoiceNumber || '—'}
                            {entry.invoiceContext.supplierName &&
                              ` — ${entry.invoiceContext.supplierName}`}
                          </a>
                        ) : (
                          SOURCE_LABELS[entry.changeSource] || entry.changeSource
                        )}
                        {!entry.invoiceContext && entry.reason && (
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {entry.reason}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {entry.changedBy ? 'User' : 'System'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-500">
              <span>
                Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
