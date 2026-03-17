import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import * as XLSX from 'xlsx';
import WorkflowBreadcrumb from '../components/layout/WorkflowBreadcrumb';

// ── Icons ─────────────────────────────────────────────────────
const Check = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);
const Download = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
);
const Pencil = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────
function money(v) {
  if (v == null) return '—';
  return '$' + Number(v).toFixed(2);
}

function exportTimestamp() {
  const d = new Date();
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0') + '_' +
    String(d.getHours()).padStart(2, '0') + '_' +
    String(d.getMinutes()).padStart(2, '0') + '_' +
    String(d.getSeconds()).padStart(2, '0')
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Inline editable price cell ─────────────────────────────────
function EditablePrice({ value, matchId, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  function startEdit(e) {
    e.stopPropagation(); // don't toggle row checkbox
    setDraft(value != null ? Number(value).toFixed(2) : '');
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commitEdit() {
    const parsed = parseFloat(draft);
    if (isNaN(parsed) || parsed <= 0) {
      setEditing(false);
      return;
    }
    // Only save if actually changed
    if (parsed !== Number(value)) {
      setSaving(true);
      try {
        await onSave(matchId, parsed);
      } catch { /* ignore */ }
      setSaving(false);
    }
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
        <span className="text-gray-400 mr-0.5 text-xs">$</span>
        <input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="w-20 text-right font-mono text-sm border border-teal-400 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-500 bg-white"
          autoFocus
        />
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-center justify-end gap-1 w-full text-right font-mono font-medium text-gray-900 hover:text-teal-700 transition"
      title="Click to edit price"
    >
      {money(value)}
      <Pencil className="w-3 h-3 text-gray-300 group-hover:text-teal-500 transition opacity-0 group-hover:opacity-100" />
    </button>
  );
}

// ══════════════════════════════════════════════════════════════
// ── EXPORT PAGE ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

export default function Export() {
  const [searchParams] = useSearchParams();
  const preselectedInvoiceId = searchParams.get('invoiceId');

  // ── State ───
  const [invoices, setInvoices] = useState([]);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState(new Set());
  const [items, setItems] = useState([]);
  const [selectedMatchIds, setSelectedMatchIds] = useState(new Set());
  const [showExported, setShowExported] = useState(true);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(null);
  // Track user price edits: { matchId: newPrice }
  const [priceEdits, setPriceEdits] = useState({});

  // ── Load invoices ───
  useEffect(() => {
    async function load() {
      try {
        const data = await api.getExportableInvoices();
        setInvoices(data);
        // Pre-select invoice if passed via URL
        if (preselectedInvoiceId) {
          const found = data.find((inv) => inv.id === preselectedInvoiceId);
          if (found) setSelectedInvoiceIds(new Set([found.id]));
        }
      } catch (err) {
        console.error('Failed to load exportable invoices:', err);
      } finally {
        setLoadingInvoices(false);
      }
    }
    load();
  }, [preselectedInvoiceId]);

  // ── Load items when invoice selection changes ───
  useEffect(() => {
    if (selectedInvoiceIds.size === 0) {
      setItems([]);
      setSelectedMatchIds(new Set());
      return;
    }
    async function loadItems() {
      setLoadingItems(true);
      try {
        const data = await api.getExportItems([...selectedInvoiceIds], showExported);
        setItems(data.items || []);
        // Auto-select: items NOT previously exported are checked, previously exported are unchecked
        const autoSelected = new Set();
        for (const item of data.items || []) {
          if (!item.exportedAt) autoSelected.add(item.matchId);
        }
        setSelectedMatchIds(autoSelected);
        // Clear price edits when invoice selection changes
        setPriceEdits({});
      } catch (err) {
        console.error('Failed to load export items:', err);
      } finally {
        setLoadingItems(false);
      }
    }
    loadItems();
  }, [selectedInvoiceIds, showExported]);

  // ── Invoice selection handlers ───
  const toggleInvoice = useCallback((id) => {
    setSelectedInvoiceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setExportSuccess(null);
  }, []);

  const toggleAllInvoices = useCallback(() => {
    setSelectedInvoiceIds((prev) => {
      if (prev.size === invoices.length) return new Set();
      return new Set(invoices.map((inv) => inv.id));
    });
    setExportSuccess(null);
  }, [invoices]);

  // ── Item selection handlers ───
  const toggleItem = useCallback((matchId) => {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  }, []);

  const toggleAllItems = useCallback(() => {
    setSelectedMatchIds((prev) => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map((item) => item.matchId));
    });
  }, [items]);

  // ── Price edit handler ───
  const handlePriceEdit = useCallback(async (matchId, newPrice) => {
    await api.updateExportPrice(matchId, newPrice);
    setPriceEdits((prev) => ({ ...prev, [matchId]: newPrice }));
    // Update the item in-place so the table re-renders with the new price
    setItems((prev) =>
      prev.map((item) =>
        item.matchId === matchId ? { ...item, newPrice } : item
      )
    );
  }, []);

  // ── Get effective price (edited or original) ───
  const getEffectivePrice = useCallback(
    (item) => (priceEdits[item.matchId] != null ? priceEdits[item.matchId] : item.newPrice),
    [priceEdits]
  );

  // ── Selected items for export (with effective prices) ───
  const selectedItems = useMemo(() => {
    return items
      .filter((item) => selectedMatchIds.has(item.matchId))
      .map((item) => ({ ...item, newPrice: getEffectivePrice(item) }));
  }, [items, selectedMatchIds, getEffectivePrice]);

  // ── Group by source ───
  const itemsBySource = useMemo(() => {
    const groups = {};
    for (const item of selectedItems) {
      const source = item.source || 'Other';
      if (!groups[source]) groups[source] = [];
      groups[source].push(item);
    }
    return groups;
  }, [selectedItems]);

  // ── Count of edited prices ───
  const editedCount = useMemo(() => {
    return Object.keys(priceEdits).length;
  }, [priceEdits]);

  // ── CSV helper: quote a field if it contains commas, quotes, or newlines ───
  function csvField(val) {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  // ── Build POS CSV (matches Abacus import format) ───
  function buildPosCsv(posItems) {
    const headers = ['Product Code', 'Product Name', 'Product Category', 'Stock Unit', 'Product Cost', 'Price Including Tax'];
    const rows = posItems.map((item) =>
      [
        csvField(item.sku || item.barcode),
        csvField(item.productName),
        csvField(item.category),
        csvField(item.baseUnit),
        item.newCost ?? '',
        item.newPrice ?? '',
      ].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  // ── Build Shopify CSV (matches Shopify import format) ───
  function buildShopifyCsv(shopifyItems) {
    const headers = ['Handle', 'Title', 'Variant SKU', 'Option1 Name', 'Option1 Value', 'Variant Price', 'Cost per item', 'Status'];
    const rows = shopifyItems.map((item) =>
      [
        csvField(item.handle),
        csvField(item.productName),
        csvField(item.sku),
        item.size ? 'Size' : '',
        csvField(item.size || item.variantName),
        item.newPrice ?? '',
        item.newCost ?? '',
        'active',
      ].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  // ── Export handler ───
  async function handleExport() {
    if (selectedItems.length === 0) return;
    setExporting(true);
    setExportSuccess(null);

    try {
      const ts = exportTimestamp();

      // Generate format-specific CSV per source system
      for (const [source, sourceItems] of Object.entries(itemsBySource)) {
        let csv;
        let label;
        const sourceLower = source.toLowerCase();

        if (sourceLower === 'shopify') {
          csv = buildShopifyCsv(sourceItems);
          label = 'Shopify';
        } else {
          // POS / other systems — use POS (Abacus) format
          csv = buildPosCsv(sourceItems);
          label = source;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const safeName = label.replace(/[^a-zA-Z0-9]/g, '_');
        downloadBlob(blob, `${ts}_${safeName}_price_update.csv`);
      }

      // Generate XLSX INSTORE_UPDATE — POS items only, deduplicated by product name
      const instoreMap = new Map();
      for (const item of selectedItems) {
        if (item.source !== 'POS') continue; // INSTORE labels are only for POS products
        const name = item.productName || '';
        if (!instoreMap.has(name)) {
          instoreMap.set(name, item.newPrice ?? '');
        }
      }
      const instoreData = Array.from(instoreMap.entries()).map(([name, price]) => ({
        'Product Name': name,
        'New Price': price,
      }));
      const ws = XLSX.utils.json_to_sheet(instoreData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'INSTORE_UPDATE');
      const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const xlsxBlob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      downloadBlob(xlsxBlob, `${ts}_INSTORE_UPDATE.xlsx`);

      // Mark items as exported on server
      const matchIds = selectedItems.map((item) => item.matchId);
      await api.markExported(matchIds);

      setExportSuccess({
        count: selectedItems.length,
        csvCount: Object.keys(itemsBySource).length,
        timestamp: ts,
      });

      // Refresh items to show updated exportedAt
      const data = await api.getExportItems([...selectedInvoiceIds], showExported);
      setItems(data.items || []);
      // Clear selection and price edits after export
      setSelectedMatchIds(new Set());
      setPriceEdits({});
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // ── RENDER ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <WorkflowBreadcrumb step={3} />
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Export Price Updates</h2>
        <p className="text-sm text-gray-500">
          Select invoices, review confirmed items, adjust prices if needed, and export CSV/XLSX files for your POS and shelf labels.
        </p>
      </div>

      {/* Success banner */}
      {exportSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <Check className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <div className="font-medium text-emerald-900">Export Complete</div>
            <p className="text-sm text-emerald-700 mt-0.5">
              {exportSuccess.count} item{exportSuccess.count !== 1 ? 's' : ''} exported across {exportSuccess.csvCount} CSV file{exportSuccess.csvCount !== 1 ? 's' : ''} + INSTORE_UPDATE.xlsx.
              Files prefixed with {exportSuccess.timestamp}.
            </p>
          </div>
        </div>
      )}

      {/* Invoice Selector */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Select Invoices</h3>
          <span className="text-xs text-gray-400">{selectedInvoiceIds.size} of {invoices.length} selected</span>
        </div>

        {loadingInvoices ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">Loading invoices...</div>
        ) : invoices.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No invoices with confirmed matches found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="pl-5 pr-2 py-2.5 text-left w-10">
                  <button onClick={toggleAllInvoices} className="w-5 h-5 rounded flex items-center justify-center border-2 border-gray-300 hover:border-teal-500 transition">
                    {selectedInvoiceIds.size === invoices.length && <Check className="w-3 h-3 text-teal-600" />}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">Supplier</th>
                <th className="px-3 py-2.5 text-left">Invoice #</th>
                <th className="px-3 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-center">Confirmed</th>
                <th className="px-3 py-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => {
                const isSelected = selectedInvoiceIds.has(inv.id);
                return (
                  <tr
                    key={inv.id}
                    className={`cursor-pointer transition ${isSelected ? 'bg-teal-50/60 hover:bg-teal-50' : 'hover:bg-gray-50'}`}
                    onClick={() => toggleInvoice(inv.id)}
                  >
                    <td className="pl-5 pr-2 py-3">
                      <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${isSelected ? 'bg-teal-600' : 'border-2 border-gray-300'}`}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-medium text-gray-900">{inv.supplierName}</td>
                    <td className="px-3 py-3 text-gray-600">{inv.invoiceNumber || '—'}</td>
                    <td className="px-3 py-3 text-gray-600">
                      {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        inv.confirmedCount === inv.totalCount ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {inv.confirmedCount}/{inv.totalCount}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        inv.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        inv.status === 'EXPORTED' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Export Items Table */}
      {selectedInvoiceIds.size > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Export Items
              {items.length > 0 && <span className="ml-2 text-xs text-gray-400 font-normal">{selectedMatchIds.size} of {items.length} selected</span>}
              {editedCount > 0 && (
                <span className="ml-2 text-xs text-teal-600 font-normal">
                  ({editedCount} price{editedCount !== 1 ? 's' : ''} updated)
                </span>
              )}
            </h3>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={showExported}
                onChange={(e) => setShowExported(e.target.checked)}
                className="rounded border-gray-300 text-teal-600"
              />
              Show previously exported
            </label>
          </div>

          {loadingItems ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">Loading items...</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-gray-400">No confirmed items found for selected invoices.</div>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pl-5 pr-2 py-2.5 text-left w-10">
                      <button onClick={toggleAllItems} className="w-5 h-5 rounded flex items-center justify-center border-2 border-gray-300 hover:border-teal-500 transition">
                        {selectedMatchIds.size === items.length && items.length > 0 && <Check className="w-3 h-3 text-teal-600" />}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left">Product</th>
                    <th className="px-3 py-2.5 text-left">SKU</th>
                    <th className="px-3 py-2.5 text-left">Invoice</th>
                    <th className="px-3 py-2.5 text-center">Source</th>
                    <th className="px-3 py-2.5 text-right">New Cost</th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center gap-1">
                        New Price
                        <Pencil className="w-3 h-3 text-gray-400" />
                      </span>
                    </th>
                    <th className="px-3 py-2.5 text-center">Exported</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => {
                    const isSelected = selectedMatchIds.has(item.matchId);
                    const wasExported = !!item.exportedAt;
                    const wasEdited = priceEdits[item.matchId] != null;
                    return (
                      <tr
                        key={item.matchId}
                        className={`cursor-pointer transition ${
                          wasExported ? 'bg-gray-50/50' : ''
                        } ${isSelected ? 'bg-teal-50/60 hover:bg-teal-50' : 'hover:bg-gray-50'}`}
                        onClick={() => toggleItem(item.matchId)}
                      >
                        <td className="pl-5 pr-2 py-3">
                          <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${isSelected ? 'bg-teal-600' : 'border-2 border-gray-300'}`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-gray-900">{item.productName}</div>
                          {item.size && <div className="text-xs text-gray-500">{item.size}</div>}
                        </td>
                        <td className="px-3 py-3 text-gray-600 font-mono text-xs">{item.sku || '—'}</td>
                        <td className="px-3 py-3 text-gray-600 text-xs">{item.invoiceNumber || '—'}</td>
                        <td className="px-3 py-3 text-center">
                          {item.source && (
                            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                              item.source === 'POS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                            }`}>{item.source}</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-700">{money(item.newCost)}</td>
                        <td className={`px-3 py-3 text-right ${wasEdited ? 'bg-teal-50/80' : ''}`}>
                          <EditablePrice
                            value={item.newPrice}
                            matchId={item.matchId}
                            onSave={handlePriceEdit}
                          />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {wasExported ? (
                            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-100 text-blue-700">
                              {new Date(item.exportedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Export button */}
      {selectedInvoiceIds.size > 0 && items.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-gray-500">
            {selectedMatchIds.size > 0 && (
              <>
                {Object.keys(itemsBySource).length} CSV file{Object.keys(itemsBySource).length !== 1 ? 's' : ''} ({Object.keys(itemsBySource).join(', ')}) + INSTORE_UPDATE.xlsx
              </>
            )}
          </div>
          <button
            onClick={handleExport}
            disabled={selectedMatchIds.size === 0 || exporting}
            className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {exporting ? 'Exporting...' : `Export ${selectedMatchIds.size} Item${selectedMatchIds.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
