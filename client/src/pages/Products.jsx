import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api';
import SmartImport from '../components/products/SmartImport';

const IMPORT_FIELDS = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'barcode', label: 'Barcode / UPC', required: false },
  { key: 'baseUnit', label: 'Base Unit (kg, each, etc.)', required: false },
  { key: 'costPrice', label: 'Cost Price', required: false },
  { key: 'sellingPrice', label: 'Selling Price', required: false },
];

export default function Products() {
  const [products, setProducts] = useState([]);
  const [sources, setSources] = useState([]);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(null); // single product id being deleted
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null); // 'bulk' | productId | null
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [addProductForm, setAddProductForm] = useState({ name: '', source: '', category: '', baseUnit: '', barcode: '', costPrice: '', sellingPrice: '' });
  const [addProductSaving, setAddProductSaving] = useState(false);

  const location = useLocation();
  const [showApprovalQueue, setShowApprovalQueue] = useState(false);
  const [approvalQueue, setApprovalQueue] = useState([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueSummary, setQueueSummary] = useState(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    try {
      const params = {};
      if (sourceFilter) params.source = sourceFilter;
      if (storeFilter) params.store = storeFilter;
      const data = await api.getProducts(Object.keys(params).length ? params : undefined);
      if (Array.isArray(data)) {
        setProducts(data);
      } else {
        setProducts(data.products);
        setSources(data.sources || []);
        setStores(data.stores || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, storeFilter]);

  const loadApprovalQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const [entriesRes, summaryRes] = await Promise.all([
        api.getApprovalQueue({ status: 'PENDING', limit: 100 }),
        api.getApprovalQueueSummary(),
      ]);
      setApprovalQueue(entriesRes.entries || []);
      setQueueSummary(summaryRes);
    } catch (err) {
      console.error('Failed to load approval queue:', err);
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
    loadApprovalQueue();
  }, [loadProducts, loadApprovalQueue]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('showApprovalQueue') === 'true') {
      setShowApprovalQueue(true);
      loadApprovalQueue();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [location.search, loadApprovalQueue]);

  const handleDeleteProduct = async (id) => {
    setDeleting(id);
    setShowDeleteConfirm(null);
    try {
      await api.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
    setDeleting(null);
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    setShowDeleteConfirm(null);
    try {
      const ids = [...selectedIds];
      await api.bulkDeleteProducts(ids);
      setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      setSelectedIds(new Set());
    } catch (err) {
      setError(err.message);
    }
    setBulkDeleting(false);
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();

  const filtered = products.filter((p) => {
    const matchesSearch =
      !searchTerm ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = !categoryFilter || p.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });


  const formatDate = (d) =>
    d ? new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div className="space-y-6">
      {/* Approval Queue Banner */}
      {queueSummary?.pendingTotal > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>⏳</span>
            <div>
              <div style={{ fontWeight: '600', color: '#92400e', fontSize: '14px' }}>{queueSummary.pendingTotal} products awaiting your review</div>
              <div style={{ color: '#b45309', fontSize: '12px' }}>These products were imported but need approval before appearing in your catalog</div>
            </div>
          </div>
          <button onClick={() => { setShowApprovalQueue(true); loadApprovalQueue(); }} style={{ background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: '600', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Review Now
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Product Catalog</h2>
          <p className="text-sm text-gray-500 mt-1">
            {products.length} products{categories.length > 0 && ` across ${categories.length} categories`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSmartImport(true)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Smart Import
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Manual Import
          </button>
          <button
            onClick={() => setShowAddProduct(true)}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
          >
            + Add Product
          </button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-4">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or barcode..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {categories.length > 0 && (
          <select
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {sources.length > 0 && (
          <select
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {stores.length > 0 && (
          <select
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
          >
            <option value="">All Stores</option>
            {stores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500 hover:text-red-700 font-medium">Dismiss</button>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-teal-800">
            {selectedIds.size} product{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-teal-600 hover:text-teal-800"
            >
              Clear Selection
            </button>
            <button
              onClick={() => setShowDeleteConfirm('bulk')}
              disabled={bulkDeleting}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {bulkDeleting ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Deleting...
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  Delete Selected
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Product Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {products.length === 0
              ? 'No products yet. Import a product list to get started.'
              : 'No products match your search.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="pl-4 pr-1 py-2.5 w-10">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2.5">Name</th>
                <th className="px-3 py-2.5">Category</th>
                <th className="px-3 py-2.5">Barcode</th>
                <th className="px-3 py-2.5">Base Unit</th>
                <th className="px-3 py-2.5 text-right">Cost</th>
                <th className="px-3 py-2.5 text-right">Sell</th>
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Store</th>
                <th className="px-3 py-2.5">Created</th>
                <th className="px-3 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((p) => {
                const isExpanded = expandedProduct === p.id;
                const hasVariants = p.variants && p.variants.length > 1;
                return (
                  <ProductRow
                    key={p.id}
                    product={p}
                    isExpanded={isExpanded}
                    hasVariants={hasVariants}
                    isSelected={selectedIds.has(p.id)}
                    onToggleExpand={() => setExpandedProduct(isExpanded ? null : p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onDelete={() => setShowDeleteConfirm(p.id)}
                    deleting={deleting === p.id}
                    formatDate={formatDate}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Smart Import Modal */}
      {showSmartImport && (
        <SmartImport
          onClose={() => setShowSmartImport(false)}
          onImportComplete={loadProducts}
        />
      )}

      {/* Approval Queue Backdrop */}
      {showApprovalQueue && (
        <div onClick={() => setShowApprovalQueue(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.3)', zIndex: 999 }} />
      )}

      {/* Approval Queue Drawer */}
      {showApprovalQueue && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: '600px', height: '100vh', background: 'white', boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', zIndex: 1000, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fffbeb' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <input
                  type="checkbox"
                  checked={approvalQueue.length > 0 && selectedQueueIds.size === approvalQueue.length}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedQueueIds(new Set(approvalQueue.map(e => e.id)));
                    else setSelectedQueueIds(new Set());
                  }}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#92400e' }}>Products Awaiting Review</h2>
              </div>
              {queueSummary && (
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#b45309' }}>
                  {queueSummary.pendingTotal} products need your approval before they appear in the catalog
                </p>
              )}
            </div>
            <button onClick={() => setShowApprovalQueue(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#6b7280', padding: '4px', lineHeight: 1 }}>×</button>
          </div>

          {/* Queue list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
            {queueLoading && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>Loading products for review...</div>
            )}

            {!queueLoading && approvalQueue.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>No products awaiting review.</div>
            )}

            {!queueLoading && approvalQueue.map((entry) => {
              const data = entry.normalizedData || {};
              return (
                <div key={entry.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '12px', background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <input
                      type="checkbox"
                      checked={selectedQueueIds.has(entry.id)}
                      onChange={(e) => {
                        setSelectedQueueIds(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(entry.id);
                          else next.delete(entry.id);
                          return next;
                        });
                      }}
                      style={{ marginTop: '4px', width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                  {/* Product info */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>{data.name || 'Unnamed Product'}</div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                        {[data.category, data.sku && `SKU: ${data.sku}`, data.barcode && `Barcode: ${data.barcode}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280', textAlign: 'right' }}>
                      {data.price || data.sellingPrice ? `$${parseFloat(data.price || data.sellingPrice).toFixed(2)}` : '—'}
                      {data.costPrice && <div style={{ color: '#9ca3af' }}>Cost: ${parseFloat(data.costPrice).toFixed(2)}</div>}
                    </div>
                  </div>

                  {/* Risk badge */}
                  {entry.invoiceRiskLevel && entry.invoiceRiskLevel !== 'NONE' && (
                    <div style={{ display: 'inline-block', background: '#fef3c7', color: '#92400e', fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '4px', marginBottom: '10px' }}>
                      ⚠ {entry.invoiceRiskLevel} INVOICE RISK
                    </div>
                  )}

                  {/* Reason */}
                  {entry.approvalRoute === 'ROUTE_REVIEW' && entry.riskExplanation && (
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px', fontStyle: 'italic' }}>{entry.riskExplanation}</div>
                  )}

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      onClick={async () => {
                        try {
                          await api.approveQueueEntry(entry.id, 'Approved via review queue');
                          setApprovalQueue(prev => prev.filter(e => e.id !== entry.id));
                          setQueueSummary(prev => prev ? { ...prev, pendingTotal: (prev.pendingTotal || 1) - 1 } : prev);
                          loadProducts();
                        } catch (err) {
                          alert('Approve failed: ' + err.message);
                        }
                      }}
                      style={{ background: '#059669', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}
                    >
                      ✓ Approve
                    </button>
                    <button
                      onClick={async () => {
                        const notes = window.prompt('Reason for rejecting this product?', 'Not required');
                        if (notes === null) return;
                        try {
                          await api.rejectQueueEntry(entry.id, notes || 'Rejected');
                          setApprovalQueue(prev => prev.filter(e => e.id !== entry.id));
                          setQueueSummary(prev => prev ? { ...prev, pendingTotal: (prev.pendingTotal || 1) - 1 } : prev);
                        } catch (err) {
                          alert('Reject failed: ' + err.message);
                        }
                      }}
                      style={{ background: 'white', color: '#dc2626', border: '1px solid #dc2626', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}
                    >
                      ✕ Reject
                    </button>
                  </div>
                    </div>{/* end flex:1 wrapper */}
                  </div>{/* end checkbox row */}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          {(approvalQueue.length > 0 || (queueSummary?.pendingTotal > 0)) && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Selected actions row */}
              {selectedQueueIds.size > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#374151', fontWeight: '500' }}>{selectedQueueIds.size} selected</span>
                  <button
                    disabled={bulkActionLoading}
                    onClick={async () => {
                      if (!window.confirm(`Approve ${selectedQueueIds.size} selected products?`)) return;
                      setBulkActionLoading(true);
                      try {
                        await Promise.all([...selectedQueueIds].map(id => api.approveQueueEntry(id, 'Approved via selection')));
                        setApprovalQueue(prev => prev.filter(e => !selectedQueueIds.has(e.id)));
                        setSelectedQueueIds(new Set());
                        setQueueSummary(prev => prev ? { ...prev, pendingTotal: Math.max(0, (prev.pendingTotal || 0) - selectedQueueIds.size) } : prev);
                        loadProducts();
                      } catch (err) {
                        alert('Failed: ' + err.message);
                      } finally {
                        setBulkActionLoading(false);
                      }
                    }}
                    style={{ background: '#059669', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', opacity: bulkActionLoading ? 0.6 : 1 }}
                  >
                    ✓ Approve Selected
                  </button>
                  <button
                    disabled={bulkActionLoading}
                    onClick={async () => {
                      const notes = window.prompt('Reason for rejecting selected products?', 'Not required');
                      if (notes === null) return;
                      setBulkActionLoading(true);
                      try {
                        await Promise.all([...selectedQueueIds].map(id => api.rejectQueueEntry(id, notes || 'Rejected')));
                        setApprovalQueue(prev => prev.filter(e => !selectedQueueIds.has(e.id)));
                        setSelectedQueueIds(new Set());
                        setQueueSummary(prev => prev ? { ...prev, pendingTotal: Math.max(0, (prev.pendingTotal || 0) - selectedQueueIds.size) } : prev);
                      } catch (err) {
                        alert('Failed: ' + err.message);
                      } finally {
                        setBulkActionLoading(false);
                      }
                    }}
                    style={{ background: 'white', color: '#dc2626', border: '1px solid #dc2626', borderRadius: '6px', padding: '6px 14px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', opacity: bulkActionLoading ? 0.6 : 1 }}
                  >
                    ✕ Reject Selected
                  </button>
                </div>
              )}
              {/* Approve All row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: '#6b7280' }}>{queueSummary?.pendingTotal || approvalQueue.length} products remaining</span>
                <button
                  disabled={bulkActionLoading}
                  onClick={async () => {
                    const total = queueSummary?.pendingTotal || approvalQueue.length;
                    if (!window.confirm(`Approve ALL ${total} products? This cannot be undone.`)) return;
                    setBulkActionLoading(true);
                    try {
                      await api.bulkApproveAllQueue();
                      setApprovalQueue([]);
                      setSelectedQueueIds(new Set());
                      setQueueSummary(null);
                      loadProducts();
                      setShowApprovalQueue(false);
                    } catch (err) {
                      alert('Approve All failed: ' + err.message);
                    } finally {
                      setBulkActionLoading(false);
                    }
                  }}
                  style={{ background: bulkActionLoading ? '#9ca3af' : '#059669', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 18px', fontSize: '13px', fontWeight: '600', cursor: bulkActionLoading ? 'not-allowed' : 'pointer' }}
                >
                  {bulkActionLoading ? 'Processing...' : `Approve All ${queueSummary?.pendingTotal || approvalQueue.length}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Product Slide-out */}
      {showAddProduct && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="w-[440px] bg-white h-full shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">Add Product</h3>
              <button onClick={() => setShowAddProduct(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={addProductForm.name}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Almonds Raw"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source / System <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={addProductForm.source}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, source: e.target.value }))}
                  placeholder="e.g. POS, Shopify, Manual"
                  list="source-suggestions"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
                <datalist id="source-suggestions">
                  <option value="Manual" />
                  {sources.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input
                  type="text"
                  value={addProductForm.category}
                  onChange={(e) => setAddProductForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Nuts & Seeds"
                  list="category-suggestions"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                />
                <datalist id="category-suggestions">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base Unit</label>
                  <select
                    value={addProductForm.baseUnit}
                    onChange={(e) => setAddProductForm((f) => ({ ...f, baseUnit: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 bg-white"
                  >
                    <option value="">Select...</option>
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="each">each</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
                  <input
                    type="text"
                    value={addProductForm.barcode}
                    onChange={(e) => setAddProductForm((f) => ({ ...f, barcode: e.target.value }))}
                    placeholder="UPC / EAN"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price (ex-GST)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={addProductForm.costPrice}
                      onChange={(e) => setAddProductForm((f) => ({ ...f, costPrice: e.target.value }))}
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Selling Price (ex-GST)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={addProductForm.sellingPrice}
                      onChange={(e) => setAddProductForm((f) => ({ ...f, sellingPrice: e.target.value }))}
                      placeholder="0.00"
                      className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>
              </div>
              {addProductForm.costPrice && addProductForm.sellingPrice && parseFloat(addProductForm.sellingPrice) > 0 && (
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <span className="text-gray-500">Margin: </span>
                  <span className="font-semibold text-gray-900">
                    {(((parseFloat(addProductForm.sellingPrice) - parseFloat(addProductForm.costPrice)) / parseFloat(addProductForm.sellingPrice)) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={() => setShowAddProduct(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!addProductForm.name.trim()) return;
                  setAddProductSaving(true);
                  try {
                    await api.createProduct({
                      name: addProductForm.name,
                      source: addProductForm.source.trim(),
                      category: addProductForm.category || null,
                      baseUnit: addProductForm.baseUnit || null,
                      barcode: addProductForm.barcode || null,
                      costPrice: addProductForm.costPrice ? parseFloat(addProductForm.costPrice) : null,
                      sellingPrice: addProductForm.sellingPrice ? parseFloat(addProductForm.sellingPrice) : null,
                    });
                    setShowAddProduct(false);
                    setAddProductForm({ name: '', source: '', category: '', baseUnit: '', barcode: '', costPrice: '', sellingPrice: '' });
                    loadProducts();
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setAddProductSaving(false);
                  }
                }}
                disabled={!addProductForm.name.trim() || !addProductForm.source.trim() || addProductSaving}
                className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                {addProductSaving ? 'Saving...' : 'Add Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Import Modal */}
      {showImport && (
        <ImportWizard
          onClose={() => {
            setShowImport(false);
            loadProducts();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {showDeleteConfirm === 'bulk' ? 'Delete Selected Products' : 'Delete Product'}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {showDeleteConfirm === 'bulk'
                    ? `Are you sure you want to delete ${selectedIds.size} selected product${selectedIds.size !== 1 ? 's' : ''}? This will also remove their variants, competitor monitors, and price alerts.`
                    : `Are you sure you want to delete "${products.find((p) => p.id === showDeleteConfirm)?.name}"? This will also remove its variants, competitor monitors, and price alerts.`}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (showDeleteConfirm === 'bulk') handleBulkDelete();
                  else handleDeleteProduct(showDeleteConfirm);
                }}
                className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Delete{showDeleteConfirm === 'bulk' ? ` ${selectedIds.size} Products` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Product Row with expandable variants ─────────────────────

function ProductRow({ product: p, isExpanded, hasVariants, isSelected, onToggleExpand, onToggleSelect, onDelete, deleting, formatDate }) {
  // Group variants by store
  const variantsByStore = {};
  if (p.variants) {
    for (const v of p.variants) {
      const storeName = v.store?.name || 'Unknown Store';
      if (!variantsByStore[storeName]) variantsByStore[storeName] = [];
      variantsByStore[storeName].push(v);
    }
  }

  // For single-variant products, use variant pricing as the authoritative source
  const singleVariant = p.variants && p.variants.length === 1 ? p.variants[0] : null;
  const displayCost = singleVariant ? singleVariant.currentCost : p.costPrice;
  const displayPrice = singleVariant ? singleVariant.salePrice : p.sellingPrice;

  return (
    <>
      <tr
        className={`hover:bg-gray-50 ${isSelected ? 'bg-teal-50/50' : ''} ${hasVariants ? 'cursor-pointer' : ''}`}
        onClick={hasVariants ? onToggleExpand : undefined}
      >
        <td className="pl-4 pr-1 py-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
            checked={isSelected}
            onChange={onToggleSelect}
          />
        </td>
        <td className="px-3 py-3 font-medium">
          <div className="flex items-center gap-2">
            {hasVariants && (
              <svg
                className={`w-3.5 h-3.5 text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            <span>{p.name}</span>
            {hasVariants && (
              <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
                {p.variants.length} variants
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 text-gray-600">{p.category || '—'}</td>
        <td className="px-3 py-3 text-gray-600 font-mono text-xs">{p.barcode || '—'}</td>
        <td className="px-3 py-3 text-gray-600">{p.baseUnit || '—'}</td>
        <td className="px-3 py-3 text-right text-gray-600">
          {displayCost != null ? `$${Number(displayCost).toFixed(2)}` : '—'}
        </td>
        <td className="px-3 py-3 text-right text-gray-600">
          {displayPrice != null ? `$${Number(displayPrice).toFixed(2)}` : '—'}
        </td>
        <td className="px-3 py-3">
          {p.source ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
              {p.source}
            </span>
          ) : (
            <span className="text-gray-400 text-xs">Manual</span>
          )}
        </td>
        <td className="px-3 py-3">
          {Object.keys(variantsByStore).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {Object.keys(variantsByStore).map((storeName) => (
                <span key={storeName} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700">
                  {storeName}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
        </td>
        <td className="px-3 py-3 text-gray-500 text-xs">{formatDate(p.createdAt)}</td>
        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
            title="Delete product"
          >
            {deleting ? (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            )}
          </button>
        </td>
      </tr>
      {isExpanded && hasVariants && Object.entries(variantsByStore).map(([storeName, variants]) => (
        <tr key={storeName} className="bg-gray-50/70">
          <td />
          <td colSpan={10} className="px-3 py-2">
            <div className="pl-6">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 flex items-center gap-2">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
                </svg>
                {storeName}
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-200">
                    <th className="text-left py-1 font-medium">SKU</th>
                    <th className="text-left py-1 font-medium">Variant</th>
                    <th className="text-left py-1 font-medium">Size</th>
                    <th className="text-right py-1 font-medium">Unit Qty</th>
                    <th className="text-right py-1 font-medium">Cost</th>
                    <th className="text-right py-1 font-medium">Price</th>
                    <th className="text-center py-1 font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((v) => (
                    <tr key={v.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-1.5 font-mono text-gray-500">{v.sku}</td>
                      <td className="py-1.5 text-gray-800 font-medium">{v.name}</td>
                      <td className="py-1.5 text-gray-600">{v.size || '—'}</td>
                      <td className="py-1.5 text-right text-gray-600">{v.unitQty}</td>
                      <td className="py-1.5 text-right text-gray-600">
                        {v.currentCost ? `$${Number(v.currentCost).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1.5 text-right text-gray-800 font-medium">
                        ${Number(v.salePrice).toFixed(2)}
                      </td>
                      <td className="py-1.5 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${v.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

// ── Import Wizard Modal ───────────────────────────────────────

function ImportWizard({ onClose }) {
  const [step, setStep] = useState(1);
  const fileInputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  // Step 1 state
  const [systemName, setSystemName] = useState('');
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadError, setUploadError] = useState(null);

  // Step 2 state
  const [mapping, setMapping] = useState({});
  const [savedMapping, setSavedMapping] = useState(null);

  // Step 3/4 state
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // Shopify-specific state
  const [shopifyDetected, setShopifyDetected] = useState(false);
  const [shopifyPreview, setShopifyPreview] = useState(null);
  const [deleteExisting, setDeleteExisting] = useState(true);

  // Load saved templates on mount
  useEffect(() => {
    api.getImportTemplates().then(setSavedTemplates).catch(() => {});
  }, []);

  // When system name matches a saved template, load its mapping
  useEffect(() => {
    if (!systemName) {
      setSavedMapping(null);
      return;
    }
    const match = savedTemplates.find(
      (t) => t.systemName.toLowerCase() === systemName.toLowerCase()
    );
    if (match) {
      api
        .getImportTemplate(match.systemName)
        .then((t) => {
          setSavedMapping(t.mapping);
          setMapping(t.mapping);
        })
        .catch(() => {});
    } else {
      setSavedMapping(null);
    }
  }, [systemName, savedTemplates]);

  const handleFile = async (file) => {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await api.uploadProductFile(formData);
      setUploadResult(result);
      if (result.shopifyDetected) {
        setShopifyDetected(true);
        setShopifyPreview(result.shopifyPreview);
        setSystemName('Shopify');
      } else if (savedMapping) {
        setMapping(savedMapping);
      }
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const canProceedToMapping = uploadResult && (shopifyDetected || systemName.trim());
  const canProceedToPreview = shopifyDetected || !!mapping.name;

  const handleImport = async () => {
    setImporting(true);
    setUploadError(null);
    try {
      const payload = shopifyDetected
        ? { uploadId: uploadResult.uploadId, shopifyMode: true, deleteExisting }
        : { uploadId: uploadResult.uploadId, systemName: systemName.trim(), mapping, saveTemplate };
      const result = await api.confirmProductImport(payload);
      setImportResult(result);
      setStep(4);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Build preview data using mapping
  const previewRows =
    uploadResult?.preview?.map((row) => {
      const mapped = {};
      for (const field of IMPORT_FIELDS) {
        const col = mapping[field.key];
        mapped[field.label] = col ? row[col] : '';
      }
      return mapped;
    }) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Import Products</h3>
            <p className="text-sm text-gray-500">Step {step} of 4</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-3 border-b border-gray-50 flex items-center gap-2">
          {['Upload', 'Map Columns', 'Preview', 'Done'].map((label, i) => {
            const stepNum = i + 1;
            const isSkipped = shopifyDetected && stepNum === 2;
            const isCompleted = stepNum < step || isSkipped;
            const isCurrent = stepNum === step;
            return (
              <div key={label} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-gray-300" />}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isCurrent
                      ? 'bg-teal-600 text-white'
                      : isCompleted
                      ? 'bg-teal-100 text-teal-700'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    stepNum
                  )}
                </div>
                <span className={`text-xs font-medium ${isCurrent ? 'text-teal-700' : isSkipped ? 'text-teal-500 line-through' : 'text-gray-500'}`}>
                  {isSkipped ? 'Auto-mapped' : label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="p-6">
          {uploadError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              {uploadError}
            </div>
          )}

          {/* Step 1: Upload + System Name */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">System Name</label>
                <p className="text-xs text-gray-500 mb-2">
                  Which POS or ecommerce system was this file exported from?
                </p>
                <input
                  type="text"
                  list="system-names"
                  placeholder="e.g. Lightspeed, Shopify, Square..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  value={systemName}
                  onChange={(e) => setSystemName(e.target.value)}
                />
                <datalist id="system-names">
                  {savedTemplates.map((t) => (
                    <option key={t.id} value={t.systemName} />
                  ))}
                </datalist>
                {savedMapping && (
                  <p className="mt-1.5 text-xs text-teal-600 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Saved column mapping found — will auto-apply
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Upload File</label>
                <div
                  className={`rounded-xl border-2 border-dashed transition p-8 text-center cursor-pointer ${
                    dragOver ? 'border-teal-400 bg-teal-50' : 'border-gray-300 hover:border-teal-400'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <div className="flex items-center justify-center gap-2 text-teal-600">
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Parsing file...
                    </div>
                  ) : uploadResult ? (
                    <div className="text-emerald-600">
                      <svg className="mx-auto w-8 h-8 mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      <p className="font-medium">{uploadResult.fileName}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        {uploadResult.totalRows} rows, {uploadResult.headers.length} columns
                      </p>
                    </div>
                  ) : (
                    <>
                      <svg className="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <p className="mt-2 text-sm font-medium text-gray-700">Drop file here or click to browse</p>
                      <p className="text-xs text-gray-400 mt-1">Excel (.xlsx) or CSV (.csv)</p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileSelect}
                  />
                </div>
                {shopifyDetected && shopifyPreview && (
                  <div className="mt-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.34 3.38c-.16-.09-.33-.07-.47.04l-1.26 1.04c-.07.06-.15.08-.24.06l-1.56-.44c-.17-.05-.34 0-.44.14l-.88 1.28c-.05.07-.13.12-.22.13l-1.62.16c-.18.02-.32.14-.36.31l-.33 1.58c-.02.09-.07.16-.15.2l-1.42.76c-.15.08-.24.25-.22.43l.22 1.62c.01.09-.02.17-.08.23l-1.1 1.2c-.12.13-.14.31-.06.47l.76 1.44c.04.08.04.17.01.26l-.52 1.52c-.06.17 0 .34.14.44l1.3.86c.07.05.12.13.14.22l.18 1.62c.02.18.15.31.32.35l1.58.3c.09.02.16.07.2.14l.8 1.4c.09.16.27.23.44.2l1.56-.38c.09-.02.18 0 .25.05l1.22 1.08c.14.12.33.13.47.03l1.28-1.02c.07-.06.16-.08.24-.06l1.56.42c.17.05.34 0 .44-.14l.88-1.26c.05-.07.13-.12.22-.13l1.62-.14c.18-.02.32-.14.36-.31l.34-1.58c.02-.09.07-.16.14-.2l1.44-.74c.15-.08.24-.25.22-.43l-.2-1.62c-.01-.09.01-.17.07-.24l1.12-1.18c.12-.13.14-.31.06-.47l-.74-1.46c-.04-.08-.04-.17-.01-.26l.54-1.52c.06-.17 0-.34-.14-.44l-1.3-.88c-.07-.05-.12-.13-.14-.22l-.2-1.6c-.02-.18-.14-.32-.32-.36l-1.58-.3c-.09-.02-.16-.07-.2-.14l-.8-1.42z"/></svg>
                      Shopify format detected
                    </div>
                    <p className="text-sm text-purple-600 mt-1">
                      {shopifyPreview.stats.totalProducts} products with{' '}
                      {shopifyPreview.stats.totalVariants} variants found
                      {shopifyPreview.stats.skippedArchived > 0 &&
                        ` (${shopifyPreview.stats.skippedArchived} archived excluded)`}
                    </p>
                    <p className="text-xs text-purple-500 mt-1">
                      Column mapping will be applied automatically
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === 2 && uploadResult && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Map each field to a column from your file. <strong>Product Name</strong> is required.
              </p>
              <div className="bg-gray-50 rounded-xl border border-gray-200 divide-y divide-gray-200">
                {IMPORT_FIELDS.map((field) => (
                  <div key={field.key} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <span className="text-sm font-medium text-gray-700">{field.label}</span>
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </div>
                    <select
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm min-w-[200px]"
                      value={mapping[field.key] || ''}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [field.key]: e.target.value || undefined,
                        }))
                      }
                    >
                      <option value="">(Unmapped)</option>
                      {uploadResult.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 3 && shopifyDetected && shopifyPreview && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Importing {shopifyPreview.stats.totalProducts} products with {shopifyPreview.stats.totalVariants} variants
              </p>

              {/* Delete existing checkbox */}
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <input
                  type="checkbox"
                  checked={deleteExisting}
                  onChange={(e) => setDeleteExisting(e.target.checked)}
                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <div>
                  <span className="font-medium">Delete existing Shopify products before importing</span>
                  <p className="text-xs text-amber-600 mt-0.5">Recommended for re-imports. Removes old flat products and their match history.</p>
                </div>
              </label>

              {/* Grouped product/variant preview */}
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-[360px] overflow-y-auto">
                {shopifyPreview.products.map((product, i) => (
                  <div key={i} className={i > 0 ? 'border-t border-gray-200' : ''}>
                    <div className="px-4 py-2.5 bg-gray-50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{product.name}</span>
                        {product.baseUnit && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded border border-indigo-100">
                            {product.baseUnit}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {product.category && (
                          <span className="text-xs text-gray-500">{product.category}</span>
                        )}
                        <span className="text-xs text-gray-400 font-medium">
                          {product.variantCount} variant{product.variantCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {product.variants.map((v, vi) => (
                        <div key={vi} className="flex items-center justify-between px-4 py-1.5 text-xs text-gray-600">
                          <div className="flex items-center gap-3">
                            <code className="text-gray-400 font-mono">{v.sku}</code>
                            {v.size && (
                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-medium">
                                {v.size}
                              </span>
                            )}
                            {!v.size && <span className="text-gray-400 italic">Default</span>}
                          </div>
                          <span className="font-mono">${(v.salePrice || 0).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                Showing {shopifyPreview.products.length} of {shopifyPreview.stats.totalProducts} products
              </p>
            </div>
          )}

          {step === 3 && !shopifyDetected && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Previewing {Math.min(10, uploadResult.totalRows)} of {uploadResult.totalRows} rows
              </p>
              <div className="overflow-x-auto border border-gray-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                      {IMPORT_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <th key={f.key} className="px-4 py-2.5">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {previewRows.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {IMPORT_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                          <td key={f.key} className="px-4 py-2.5 text-gray-700">
                            {String(row[f.label] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveTemplate}
                  onChange={(e) => setSaveTemplate(e.target.checked)}
                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                Save column mapping for future imports from &quot;{systemName}&quot;
              </label>
            </div>
          )}

          {/* Step 4: Results */}
          {step === 4 && importResult && importResult.shopifyMode && (
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold">Shopify Import Complete</h4>
              <div className="grid grid-cols-2 gap-3 max-w-md mx-auto text-sm">
                <div className="bg-emerald-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-emerald-700">{importResult.imported}</div>
                  <div className="text-gray-600">Products Created</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-blue-700">{importResult.totalVariants}</div>
                  <div className="text-gray-600">Variants Created</div>
                </div>
                {importResult.updated > 0 && (
                  <div className="bg-amber-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-amber-700">{importResult.updated}</div>
                    <div className="text-gray-600">Products Updated</div>
                  </div>
                )}
                {importResult.deleted > 0 && (
                  <div className="bg-red-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-red-700">{importResult.deleted}</div>
                    <div className="text-gray-600">Old Products Deleted</div>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">Store: {importResult.storeName}</p>
              {importResult.errors?.length > 0 && (
                <div className="mt-4 text-left bg-red-50 border border-red-200 rounded-lg p-3 max-h-32 overflow-y-auto text-xs text-red-700">
                  {importResult.errors.map((e, i) => (
                    <div key={i}>{e.product}{e.variant ? ` / ${e.variant}` : ''}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 4 && importResult && !importResult.shopifyMode && (
            <div className="text-center py-6 space-y-4">
              <div className="mx-auto w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h4 className="text-lg font-semibold">Import Complete</h4>
              <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto text-sm">
                <div className="bg-emerald-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-emerald-700">{importResult.imported}</div>
                  <div className="text-gray-600">Created</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-blue-700">{importResult.updated}</div>
                  <div className="text-gray-600">Updated</div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-2xl font-bold text-gray-600">{importResult.skipped}</div>
                  <div className="text-gray-600">Skipped</div>
                </div>
              </div>
              {importResult.templateSaved && (
                <p className="text-xs text-teal-600">Column mapping saved for &quot;{systemName}&quot;</p>
              )}
              {importResult.errors?.length > 0 && (
                <div className="mt-4 text-left bg-red-50 border border-red-200 rounded-lg p-3 max-h-32 overflow-y-auto text-xs text-red-700">
                  {importResult.errors.map((e, i) => (
                    <div key={i}>Row {e.row}: {e.error}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <div>
            {step > 1 && step < 4 && (
              <button
                onClick={() => setStep(shopifyDetected && step === 3 ? 1 : step - 1)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step < 4 && (
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                Cancel
              </button>
            )}
            {step === 1 && (
              <button
                onClick={() => setStep(shopifyDetected ? 3 : 2)}
                disabled={!canProceedToMapping}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {shopifyDetected ? 'Review & Import' : 'Next'}
              </button>
            )}
            {step === 2 && (
              <button
                onClick={() => setStep(3)}
                disabled={!canProceedToPreview}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            )}
            {step === 3 && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {importing && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {importing
                  ? 'Importing...'
                  : shopifyDetected
                    ? `Import ${shopifyPreview?.stats?.totalProducts || 0} Products`
                    : `Import ${uploadResult?.totalRows || 0} Products`}
              </button>
            )}
            {step === 4 && (
              <button
                onClick={onClose}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
