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
  const [includeOtherExported, setIncludeOtherExported] = useState(false);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(null);
  // Track user price edits: { matchId: newPrice }
  const [priceEdits, setPriceEdits] = useState({});
  // Duplicate resolution state
  const [duplicateGroups, setDuplicateGroups] = useState(null);
  const [duplicateChoices, setDuplicateChoices] = useState({});
  // Invoice sort state for "Previously Exported" section
  const [exportSortAsc, setExportSortAsc] = useState(true);
  // Per-platform action: { [source]: 'sync' | 'file' }
  const [platformActions, setPlatformActions] = useState({});
  // Whether Shopify integration is active
  const [shopifyConnected, setShopifyConnected] = useState(false);

  // ── Load Shopify integration status ───
  useEffect(() => {
    api.shopify.getStatus().then((data) => {
      setShopifyConnected(!!(data?.isActive));
    }).catch(() => {});
  }, []);

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
        const data = await api.getExportItems([...selectedInvoiceIds], includeOtherExported);
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
  }, [selectedInvoiceIds, includeOtherExported]);

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

  const toggleSectionInvoices = useCallback((sectionInvoices) => {
    setSelectedInvoiceIds((prev) => {
      const sectionIds = sectionInvoices.map((inv) => inv.id);
      const allSelected = sectionIds.length > 0 && sectionIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        sectionIds.forEach((id) => next.delete(id));
      } else {
        sectionIds.forEach((id) => next.add(id));
      }
      return next;
    });
    setExportSuccess(null);
  }, []);

  // ── Source filter for items table (must be declared before toggleAllItems) ───
  const [sourceFilter, setSourceFilter] = useState(new Set()); // empty = show all

  // Available sources derived from loaded items (exclude items with no source)
  const availableItemSources = useMemo(() => {
    return [...new Set(items.map((i) => i.source).filter(Boolean))].sort();
  }, [items]);

  // Reset source filter when items change (new invoice selection)
  useEffect(() => {
    setSourceFilter(new Set());
  }, [items]);

  const toggleSourceFilter = useCallback((source) => {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }, []);

  // Filtered items (source filter applied — items with no source always show)
  const filteredItems = useMemo(() => {
    if (sourceFilter.size === 0) return items;
    return items.filter((i) => !i.source || sourceFilter.has(i.source));
  }, [items, sourceFilter]);

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
      const visibleIds = filteredItems.map((item) => item.matchId);
      const allVisible = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allVisible) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [filteredItems]);

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
      if (!item.source) continue;
      if (!groups[item.source]) groups[item.source] = [];
      groups[item.source].push(item);
    }
    return groups;
  }, [selectedItems]);

  // ── Available export platforms (derived from loaded items — exclude no-source) ───
  const availablePlatforms = useMemo(() => {
    return [...new Set(items.map((i) => i.source).filter(Boolean))].sort();
  }, [items]);

  // Auto-init platform actions when available platforms or shopifyConnected changes
  const prevPlatformsKey = useRef('');
  useEffect(() => {
    const key = [...availablePlatforms].sort().join(',') + '|' + String(shopifyConnected);
    if (key !== prevPlatformsKey.current) {
      prevPlatformsKey.current = key;
      setPlatformActions((prev) => {
        const next = { ...prev };
        for (const platform of availablePlatforms) {
          if (!(platform in next)) {
            // Default: 'sync' for Shopify if connected, 'file' otherwise
            next[platform] = (platform.toLowerCase() === 'shopify' && shopifyConnected) ? 'sync' : 'file';
          }
        }
        return next;
      });
    }
  }, [availablePlatforms, shopifyConnected]);

  // ── Count of edited prices ───
  const editedCount = useMemo(() => {
    return Object.keys(priceEdits).length;
  }, [priceEdits]);

  // ── Split invoices into Ready / Previously Exported ───
  const { readyInvoices, exportedInvoices } = useMemo(() => {
    const ready = [];
    const exported = [];
    for (const inv of invoices) {
      if (inv.lastExportedAt) exported.push(inv);
      else ready.push(inv);
    }
    exported.sort((a, b) => {
      const diff = new Date(a.lastExportedAt) - new Date(b.lastExportedAt);
      return exportSortAsc ? diff : -diff;
    });
    return { readyInvoices: ready, exportedInvoices: exported };
  }, [invoices, exportSortAsc]);

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

  // ── Export handler — detects POS duplicates before exporting ───
  async function handleExport() {
    if (selectedItems.length === 0) return;

    // Detect POS duplicates (same product name from different invoices)
    const posItems = selectedItems.filter((i) => i.source === 'POS');
    const groups = {};
    for (const item of posItems) {
      const name = item.productName || '';
      (groups[name] ??= []).push(item);
    }
    const dupes = Object.entries(groups)
      .filter(([, items]) => items.length > 1)
      .map(([productName, items]) => ({ productName, items }));

    if (dupes.length > 0) {
      // Pre-select most recent invoice per group
      const choices = {};
      for (const g of dupes) {
        const sorted = [...g.items].sort(
          (a, b) => new Date(b.invoiceDate || 0) - new Date(a.invoiceDate || 0)
        );
        choices[g.productName] = sorted[0].matchId;
      }
      setDuplicateChoices(choices);
      setDuplicateGroups(dupes);
      return; // show modal, don't export yet
    }

    // No duplicates → proceed directly
    await doExport(selectedItems);
  }

  // ── Core export logic (receives final, deduplicated item list) ───
  async function doExport(exportItems) {
    setExporting(true);
    setExportSuccess(null);

    try {
      const ts = exportTimestamp();

      // Group by source (skip items with no source)
      const bySource = {};
      for (const item of exportItems) {
        if (!item.source) continue;
        (bySource[item.source] ??= []).push(item);
      }

      // Determine which platforms are set to 'sync' (push via API)
      const syncPlatforms = availablePlatforms.filter(
        (p) => platformActions[p] === 'sync'
      );

      // Generate files for platforms set to 'file' action
      let fileCount = 0;
      for (const [source, sourceItems] of Object.entries(bySource)) {
        if (platformActions[source] !== 'file') continue; // sync platforms skip file generation
        let csv;
        let label;
        const sourceLower = source.toLowerCase();

        if (sourceLower === 'shopify') {
          csv = buildShopifyCsv(sourceItems);
          label = 'Shopify';
        } else {
          csv = buildPosCsv(sourceItems);
          label = source;
        }

        const blob = new Blob([csv], { type: 'text/csv' });
        const safeName = label.replace(/[^a-zA-Z0-9]/g, '_');
        downloadBlob(blob, `${ts}_${safeName}_price_update.csv`);
        fileCount++;
      }

      // Generate XLSX INSTORE_UPDATE for POS items set to 'file' action
      if (platformActions['POS'] === 'file' && bySource['POS']?.length > 0) {
        const instoreData = bySource['POS'].map((item) => ({
          'Product Name': item.productName || '',
          'New Price': item.newPrice ?? '',
        }));
        const ws = XLSX.utils.json_to_sheet(instoreData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'INSTORE_UPDATE');
        const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const xlsxBlob = new Blob([xlsxData], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        downloadBlob(xlsxBlob, `${ts}_INSTORE_UPDATE.xlsx`);
        fileCount++;
      }

      // Mark items as exported on server — pass syncPlatforms so backend knows what to push
      const matchIds = exportItems.map((item) => item.matchId);
      await api.markExported(matchIds, syncPlatforms.length > 0 ? syncPlatforms : []);

      setExportSuccess({
        count: exportItems.length,
        fileCount,
        syncCount: syncPlatforms.length,
        timestamp: ts,
      });

      // Refresh items to show updated exportedAt
      const data = await api.getExportItems([...selectedInvoiceIds], includeOtherExported);
      setItems(data.items || []);
      // Refresh invoices to update lastExportedAt
      const invoiceData = await api.getExportableInvoices();
      setInvoices(invoiceData);
      // Clear selection and price edits after export
      setSelectedMatchIds(new Set());
      setPriceEdits({});
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  // ── Resolve duplicates and export ───
  async function handleResolveAndExport() {
    const dupeProductNames = new Set(duplicateGroups.map((g) => g.productName));
    const chosenMatchIds = new Set(Object.values(duplicateChoices));

    const deduplicatedItems = selectedItems.filter((item) => {
      if (item.source !== 'POS') return true; // non-POS items pass through
      if (!dupeProductNames.has(item.productName)) return true; // non-duplicate POS items pass through
      return chosenMatchIds.has(item.matchId); // for duplicates, keep only the chosen one
    });

    setDuplicateGroups(null);
    await doExport(deduplicatedItems);
  }

  // ── Shared invoice row renderer ───
  function renderInvoiceRow(inv, showLastExported) {
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
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1 justify-center">
            {inv.costChangedCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 text-amber-700"
                    title="Cost price changed">
                {inv.costChangedCount} cost
              </span>
            )}
            {inv.priceChangedCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-teal-100 text-teal-700"
                    title="Selling price changed">
                {inv.priceChangedCount} price
              </span>
            )}
            {inv.costUnchangedCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-500"
                    title="No cost change">
                {inv.costUnchangedCount} same cost
              </span>
            )}
            {inv.priceUnchangedCount > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-500"
                    title="No selling price change">
                {inv.priceUnchangedCount} same price
              </span>
            )}
          </div>
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
        {showLastExported && (
          <td className="px-3 py-3 text-gray-600 text-xs">
            {inv.lastExportedAt
              ? new Date(inv.lastExportedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
              : '—'}
          </td>
        )}
      </tr>
    );
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
              {exportSuccess.count} item{exportSuccess.count !== 1 ? 's' : ''} processed.
              {exportSuccess.fileCount > 0 && ` ${exportSuccess.fileCount} file${exportSuccess.fileCount !== 1 ? 's' : ''} downloaded (prefixed ${exportSuccess.timestamp}).`}
              {exportSuccess.syncCount > 0 && ` Prices pushed to ${exportSuccess.syncCount} connected platform${exportSuccess.syncCount !== 1 ? 's' : ''}.`}
            </p>
          </div>
        </div>
      )}

      {/* Invoice Selector */}
      {loadingInvoices ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center text-sm text-gray-400">
          Loading invoices...
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-center text-sm text-gray-400">
          No invoices with confirmed matches found.
        </div>
      ) : (
        <>
          {/* Ready to Export */}
          {readyInvoices.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Ready to Export</h3>
                <span className="text-xs text-gray-400">
                  {readyInvoices.filter((inv) => selectedInvoiceIds.has(inv.id)).length} of {readyInvoices.length} selected
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pl-5 pr-2 py-2.5 text-left w-10">
                      <button
                        onClick={() => toggleSectionInvoices(readyInvoices)}
                        className="w-5 h-5 rounded flex items-center justify-center border-2 border-gray-300 hover:border-teal-500 transition"
                      >
                        {readyInvoices.length > 0 && readyInvoices.every((inv) => selectedInvoiceIds.has(inv.id)) && (
                          <Check className="w-3 h-3 text-teal-600" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left">Supplier</th>
                    <th className="px-3 py-2.5 text-left">Invoice #</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-center">Confirmed</th>
                    <th className="px-3 py-2.5 text-center">Changes</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {readyInvoices.map((inv) => renderInvoiceRow(inv, false))}
                </tbody>
              </table>
            </div>
          )}

          {/* Previously Exported */}
          {exportedInvoices.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Previously Exported</h3>
                <span className="text-xs text-gray-400">
                  {exportedInvoices.filter((inv) => selectedInvoiceIds.has(inv.id)).length} of {exportedInvoices.length} selected
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pl-5 pr-2 py-2.5 text-left w-10">
                      <button
                        onClick={() => toggleSectionInvoices(exportedInvoices)}
                        className="w-5 h-5 rounded flex items-center justify-center border-2 border-gray-300 hover:border-teal-500 transition"
                      >
                        {exportedInvoices.length > 0 && exportedInvoices.every((inv) => selectedInvoiceIds.has(inv.id)) && (
                          <Check className="w-3 h-3 text-teal-600" />
                        )}
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-left">Supplier</th>
                    <th className="px-3 py-2.5 text-left">Invoice #</th>
                    <th className="px-3 py-2.5 text-left">Date</th>
                    <th className="px-3 py-2.5 text-center">Confirmed</th>
                    <th className="px-3 py-2.5 text-center">Changes</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <th
                      className="px-3 py-2.5 text-left cursor-pointer select-none hover:text-gray-700 transition"
                      onClick={() => setExportSortAsc((prev) => !prev)}
                    >
                      <div className="flex items-center gap-1">
                        Last Exported
                        <span className="text-[10px]">{exportSortAsc ? '▲' : '▼'}</span>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {exportedInvoices.map((inv) => renderInvoiceRow(inv, true))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Export Items Table */}
      {selectedInvoiceIds.size > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                Export Items
                {items.length > 0 && (
                  <span className="ml-2 text-xs text-gray-400 font-normal">
                    {selectedMatchIds.size} of {sourceFilter.size > 0 ? filteredItems.length : items.length} selected
                    {sourceFilter.size > 0 && ` (filtered from ${items.length})`}
                  </span>
                )}
                {editedCount > 0 && (
                  <span className="ml-2 text-xs text-teal-600 font-normal">
                    ({editedCount} price{editedCount !== 1 ? 's' : ''} updated)
                  </span>
                )}
              </h3>
              <label className="flex items-center gap-2 text-xs text-gray-500">
                <input
                  type="checkbox"
                  checked={includeOtherExported}
                  onChange={(e) => setIncludeOtherExported(e.target.checked)}
                  className="rounded border-gray-300 text-teal-600"
                />
                Include exported from other invoices
              </label>
            </div>
            {/* Source filter pills */}
            {availableItemSources.length > 1 && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-400">Filter by source:</span>
                {availableItemSources.map((source) => {
                  const active = sourceFilter.has(source);
                  const count = items.filter((i) => (i.source || 'Other') === source).length;
                  return (
                    <button
                      key={source}
                      onClick={() => toggleSourceFilter(source)}
                      className={`px-2.5 py-0.5 text-xs font-medium rounded-full border transition ${
                        active
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400 hover:text-teal-700'
                      }`}
                    >
                      {source} <span className={active ? 'text-teal-200' : 'text-gray-400'}>{count}</span>
                    </button>
                  );
                })}
                {sourceFilter.size > 0 && (
                  <button
                    onClick={() => setSourceFilter(new Set())}
                    className="text-xs text-gray-400 hover:text-gray-600 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
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
                        {filteredItems.length > 0 && filteredItems.every((i) => selectedMatchIds.has(i.matchId)) && <Check className="w-3 h-3 text-teal-600" />}
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
                  {filteredItems.map((item) => {
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

      {/* Per-platform action selector & export button */}
      {selectedInvoiceIds.size > 0 && items.length > 0 && availablePlatforms.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Platform cards */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider shrink-0">
                Update via:
              </span>
              {availablePlatforms.map((platform) => {
                const isShopify = platform.toLowerCase() === 'shopify';
                const canSync = isShopify && shopifyConnected;
                const action = platformActions[platform] ?? 'file';
                const itemCount = items.filter((i) => i.source === platform).length;
                return (
                  <div
                    key={platform}
                    className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-gray-200 bg-gray-50 min-w-[140px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-gray-800">{platform}</span>
                      <span className="text-[11px] text-gray-400">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
                    </div>
                    {canSync ? (
                      /* Shopify connected: toggle between Sync and File */
                      <div className="flex rounded-md overflow-hidden border border-gray-200 text-xs font-medium">
                        <button
                          onClick={() => setPlatformActions((prev) => ({ ...prev, [platform]: 'sync' }))}
                          className={`flex-1 px-2 py-1 transition ${
                            action === 'sync'
                              ? 'bg-teal-600 text-white'
                              : 'bg-white text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          Sync
                        </button>
                        <button
                          onClick={() => setPlatformActions((prev) => ({ ...prev, [platform]: 'file' }))}
                          className={`flex-1 px-2 py-1 transition border-l border-gray-200 ${
                            action === 'file'
                              ? 'bg-teal-600 text-white'
                              : 'bg-white text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          Export CSV
                        </button>
                      </div>
                    ) : (
                      /* Not connected: file export only */
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        <Download className="w-3 h-3" />
                        Export CSV
                        {isShopify && (
                          <span className="ml-1 text-[10px] text-amber-600">(not connected)</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Export button */}
            <button
              onClick={handleExport}
              disabled={selectedMatchIds.size === 0 || exporting}
              className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition flex items-center gap-2 shrink-0"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Processing...' : `Export ${selectedMatchIds.size} Item${selectedMatchIds.size !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Duplicate Resolution Modal ─── */}
      {duplicateGroups && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Resolve Duplicate POS Products</h3>
              <p className="text-sm text-gray-500 mt-1">
                {duplicateGroups.length} product{duplicateGroups.length !== 1 ? 's' : ''} found on multiple invoices.
                Choose which price to use for each.
              </p>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {duplicateGroups.map((group) => (
                <div key={group.productName}>
                  <div className="text-sm font-semibold text-gray-900 mb-2">{group.productName}</div>
                  <div className="space-y-2">
                    {group.items.map((item) => {
                      const isChosen = duplicateChoices[group.productName] === item.matchId;
                      return (
                        <label
                          key={item.matchId}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                            isChosen ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`dup-${group.productName}`}
                            checked={isChosen}
                            onChange={() =>
                              setDuplicateChoices((prev) => ({
                                ...prev,
                                [group.productName]: item.matchId,
                              }))
                            }
                            className="text-teal-600 focus:ring-teal-500"
                          />
                          <div className="flex-1 grid grid-cols-[minmax(60px,auto)_1fr_80px_60px_16px_60px] items-center gap-2 text-sm">
                            <span className="text-gray-600 font-medium truncate">{item.invoiceNumber || '—'}</span>
                            <span className="text-gray-500 truncate">{item.supplierName || '—'}</span>
                            <span className="text-gray-500 text-xs">
                              {item.invoiceDate
                                ? new Date(item.invoiceDate).toLocaleDateString('en-AU', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })
                                : '—'}
                            </span>
                            <span className="font-mono text-gray-700 text-right">{money(item.newCost)}</span>
                            <span className="text-gray-400 text-center">&rarr;</span>
                            <span className="font-mono font-medium text-gray-900 text-right">{money(item.newPrice)}</span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setDuplicateGroups(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveAndExport}
                className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Resolve &amp; Export ({selectedItems.length - duplicateGroups.reduce((sum, g) => sum + g.items.length - 1, 0)} items)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
