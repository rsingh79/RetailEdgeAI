import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../services/api';

export default function MatchCorrectionModal({
  invoiceId,
  line,
  currentMatch, // null for unmatched lines
  dataVersion,
  onClose,
  onCorrected, // callback with { dataVersion } after successful correction
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [action, setAction] = useState(currentMatch ? 'rematch' : 'match');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [newerWarning, setNewerWarning] = useState(null);
  const debounceRef = useRef(null);

  const currentProduct = currentMatch?.productVariant?.product || currentMatch?.product;
  const currentVariantLabel = currentMatch?.productVariant?.name || currentMatch?.productVariant?.size || '';

  // Debounced product search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchProducts(searchQuery);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
    // Auto-select the first variant if there's exactly one
    if (product.variants?.length === 1) {
      setSelectedVariantId(product.variants[0].id);
    } else {
      setSelectedVariantId(null);
    }
    setAction('rematch');
  };

  const handleSave = useCallback(async (acknowledgeNewer = false) => {
    setSaving(true);
    setError(null);
    setNewerWarning(null);

    const body = {
      action,
      correctionReason: reason || undefined,
      dataVersion,
      acknowledgeNewerInvoice: acknowledgeNewer,
    };

    if (action === 'rematch' || action === 'match') {
      if (!selectedProduct) {
        setError('Select a product to match to.');
        setSaving(false);
        return;
      }
      body.newProductId = selectedProduct.id;
      body.newVariantId = selectedVariantId || undefined;
    }

    try {
      const result = await api.correctMatch(invoiceId, line.id, body);
      onCorrected({ dataVersion: result.dataVersion });
    } catch (err) {
      if (err.code === 'STALE_DATA') {
        setError('This invoice has been modified since you loaded it. Please close and refresh.');
        setSaving(false);
        return;
      }

      if (err.code === 'NEWER_INVOICE_EXISTS') {
        setNewerWarning(err.data.newerInvoice);
        setSaving(false);
        return;
      }

      setError(err.message || 'Correction failed');
      setSaving(false);
    }
  }, [action, selectedProduct, selectedVariantId, reason, dataVersion, invoiceId, line.id, onCorrected]);

  const formatCurrency = (v) => (v != null ? `$${Number(v).toFixed(2)}` : '—');
  const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">
            {currentMatch ? 'Correct Match' : 'Add Match'}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">{line.description}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Qty: {line.quantity} — Unit cost: {formatCurrency(line.baseUnitCost ?? line.unitPrice)}
          </p>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Current match info */}
          {currentMatch && currentProduct && (
            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <div className="text-xs font-medium text-gray-500 uppercase mb-1">Currently matched to</div>
              <div className="font-medium text-gray-900">{currentProduct.name}</div>
              {currentVariantLabel && <div className="text-xs text-gray-500">{currentVariantLabel}</div>}
              <div className="text-xs text-gray-400 mt-1">
                Confidence: {Math.round((currentMatch.confidence || 0) * 100)}%
                {currentMatch.matchReason && ` (${currentMatch.matchReason})`}
              </div>
            </div>
          )}

          {/* Action selection for matched lines */}
          {currentMatch && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="correctionAction"
                  value="rematch"
                  checked={action === 'rematch'}
                  onChange={() => setAction('rematch')}
                  className="text-teal-600 focus:ring-teal-500"
                />
                Rematch to different product
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="correctionAction"
                  value="unmatch"
                  checked={action === 'unmatch'}
                  onChange={() => { setAction('unmatch'); setSelectedProduct(null); }}
                  className="text-teal-600 focus:ring-teal-500"
                />
                Unmatch
              </label>
            </div>
          )}

          {/* Product search (for rematch and match) */}
          {(action === 'rematch' || action === 'match') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search for product
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Type product name, SKU, or barcode..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                autoFocus
              />
              {/* Search results */}
              {searching && (
                <div className="mt-2 text-xs text-gray-400">Searching...</div>
              )}
              {searchResults.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleSelectProduct(p)}
                      className={`w-full text-left px-3 py-2 hover:bg-teal-50 transition text-sm ${
                        selectedProduct?.id === p.id ? 'bg-teal-50 ring-1 ring-teal-300' : ''
                      }`}
                    >
                      <div className="font-medium text-gray-900">{p.name}</div>
                      <div className="text-xs text-gray-500">
                        {p.barcode && `${p.barcode} · `}
                        Cost: {formatCurrency(p.costPrice)}
                        {p.variants?.length > 0 && ` · ${p.variants.length} variant${p.variants.length !== 1 ? 's' : ''}`}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <div className="mt-2 text-xs text-gray-400">No products found</div>
              )}
            </div>
          )}

          {/* Variant selection if product has multiple variants */}
          {selectedProduct && selectedProduct.variants?.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Select variant</label>
              <div className="space-y-1">
                {selectedProduct.variants.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 text-sm cursor-pointer px-3 py-1.5 rounded hover:bg-gray-50">
                    <input
                      type="radio"
                      name="variantSelect"
                      value={v.id}
                      checked={selectedVariantId === v.id}
                      onChange={() => setSelectedVariantId(v.id)}
                      className="text-teal-600 focus:ring-teal-500"
                    />
                    {v.name || v.size || v.sku || 'Default'}
                    {v.store && <span className="text-xs text-gray-400">({v.store.name})</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Selected product confirmation */}
          {selectedProduct && (action === 'rematch' || action === 'match') && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3">
              <div className="text-xs font-medium text-teal-700 uppercase mb-1">
                {action === 'rematch' ? 'Rematching to' : 'Matching to'}
              </div>
              <div className="font-medium text-gray-900">{selectedProduct.name}</div>
              <div className="text-xs text-gray-600 mt-0.5">
                Current cost: {formatCurrency(selectedProduct.costPrice)} — will be updated to {formatCurrency(line.baseUnitCost ?? line.unitPrice)}
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this correction needed?"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          {/* Newer invoice warning dialog */}
          {newerWarning && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <div className="text-sm">
                  <p className="font-medium text-amber-800">Newer invoice has updated this product</p>
                  <p className="text-amber-700 mt-1">
                    Invoice #{newerWarning.invoiceNumber || '—'}
                    {newerWarning.supplierName && ` (${newerWarning.supplierName})`}
                    {' — '}{formatDate(newerWarning.invoiceDate)}
                    {' set cost to '}{formatCurrency(newerWarning.newCost)}
                  </p>
                  <p className="text-amber-700 mt-1">
                    Proceeding will detach this match but leave the newer invoice&apos;s cost in place.
                  </p>
                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={() => setNewerWarning(null)}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleSave(true)}
                      disabled={saving}
                      className="px-3 py-1.5 text-sm font-medium text-amber-800 bg-amber-200 rounded-lg hover:bg-amber-300 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'I understand, proceed'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          {!newerWarning && (
            <button
              onClick={() => handleSave(false)}
              disabled={saving || (action !== 'unmatch' && !selectedProduct)}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : action === 'unmatch' ? 'Unmatch' : 'Save Correction'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
