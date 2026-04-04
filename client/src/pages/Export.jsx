import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import * as XLSX from 'xlsx';
import WorkflowBreadcrumb from '../components/layout/WorkflowBreadcrumb';
import StaleDataBanner from '../components/ui/StaleDataBanner';
import tabSync from '../services/tabSync';

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
const SearchIcon = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);
const ArrowLeft = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
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
  const navigate = useNavigate();
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
  // Stale data detection
  const [staleData, setStaleData] = useState(false);

  // ── Shopify sync flow state ───
  const [shopifySyncState, setShopifySyncState] = useState('idle'); // 'idle' | 'review' | 'syncing' | 'results'
  const [shopifySyncItems, setShopifySyncItems] = useState([]); // items for review screen with 'selected' boolean
  const [shopifySyncCsvItems, setShopifySyncCsvItems] = useState([]); // CSV items to export alongside Shopify sync
  const [shopifySyncResults, setShopifySyncResults] = useState(null); // results from backend

  // ── Invoice search, sort, pagination state ───
  const [readySearch, setReadySearch] = useState('');
  const [exportedSearch, setExportedSearch] = useState('');
  const [readySortKey, setReadySortKey] = useState('date'); // 'date' | 'supplier' | 'amount'
  const [readySortAsc, setReadySortAsc] = useState(false); // false = newest first
  const [exportedSortKey, setExportedSortKey] = useState('date');
  const [readyPage, setReadyPage] = useState(1);
  const [exportedPage, setExportedPage] = useState(1);
  const INVOICES_PER_PAGE = 10;

  // Register export screen as sensitive for multi-tab polling
  useEffect(() => {
    tabSync.setSensitiveScreen('export', new Date().toISOString());
    tabSync.onStaleData = () => setStaleData(true);
    return () => {
      tabSync.clearSensitiveScreen();
      tabSync.onStaleData = null;
    };
  }, []);

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
  const { readyInvoicesAll, exportedInvoicesAll } = useMemo(() => {
    const ready = [];
    const exported = [];
    for (const inv of invoices) {
      if (inv.lastExportedAt) exported.push(inv);
      else ready.push(inv);
    }
    return { readyInvoicesAll: ready, exportedInvoicesAll: exported };
  }, [invoices]);

  // ── Filter, sort, paginate invoice sections ───
  function filterInvoices(list, query) {
    if (!query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((inv) =>
      (inv.supplierName || '').toLowerCase().includes(q) ||
      (inv.invoiceNumber || '').toLowerCase().includes(q)
    );
  }

  function sortInvoices(list, key, asc) {
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (key === 'date') {
        cmp = new Date(a.invoiceDate || 0) - new Date(b.invoiceDate || 0);
      } else if (key === 'supplier') {
        cmp = (a.supplierName || '').localeCompare(b.supplierName || '');
      } else if (key === 'amount') {
        cmp = (a.totalAmount || 0) - (b.totalAmount || 0);
      } else if (key === 'lastExported') {
        cmp = new Date(a.lastExportedAt || 0) - new Date(b.lastExportedAt || 0);
      }
      return asc ? cmp : -cmp;
    });
  }

  const readyFiltered = useMemo(() =>
    sortInvoices(filterInvoices(readyInvoicesAll, readySearch), readySortKey, readySortAsc),
    [readyInvoicesAll, readySearch, readySortKey, readySortAsc]
  );
  const exportedFiltered = useMemo(() =>
    sortInvoices(filterInvoices(exportedInvoicesAll, exportedSearch), exportedSortKey, exportSortAsc),
    [exportedInvoicesAll, exportedSearch, exportedSortKey, exportSortAsc]
  );

  const readyTotalPages = Math.max(1, Math.ceil(readyFiltered.length / INVOICES_PER_PAGE));
  const exportedTotalPages = Math.max(1, Math.ceil(exportedFiltered.length / INVOICES_PER_PAGE));
  const readyInvoices = readyFiltered.slice((readyPage - 1) * INVOICES_PER_PAGE, readyPage * INVOICES_PER_PAGE);
  const exportedInvoices = exportedFiltered.slice((exportedPage - 1) * INVOICES_PER_PAGE, exportedPage * INVOICES_PER_PAGE);

  // Reset page when search changes
  useEffect(() => { setReadyPage(1); }, [readySearch, readySortKey, readySortAsc]);
  useEffect(() => { setExportedPage(1); }, [exportedSearch, exportedSortKey, exportSortAsc]);

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

  // ── Generate CSV/XLSX files for non-sync platforms ───
  function executeCsvExports(exportItems) {
    const ts = exportTimestamp();
    const bySource = {};
    for (const item of exportItems) {
      if (!item.source) continue;
      (bySource[item.source] ??= []).push(item);
    }

    let fileCount = 0;
    for (const [source, sourceItems] of Object.entries(bySource)) {
      if (platformActions[source] !== 'file') continue;
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

    return { fileCount, timestamp: ts };
  }

  // ── Core export logic (receives final, deduplicated item list) ───
  async function doExport(exportItems) {
    setExporting(true);
    setExportSuccess(null);

    try {
      // Determine which platforms are set to 'sync' (push via API)
      const syncPlatforms = availablePlatforms.filter(
        (p) => platformActions[p] === 'sync'
      );

      // Check for Shopify sync items — show review screen before syncing
      const hasShopifySync = syncPlatforms.some((p) => p.toLowerCase() === 'shopify');
      const shopifyItems = hasShopifySync
        ? exportItems.filter((i) => (i.source || '').toLowerCase() === 'shopify')
        : [];

      if (shopifyItems.length > 0) {
        // Show Shopify review screen — pause export until user confirms
        setShopifySyncItems(shopifyItems.map((i) => ({ ...i, selected: true })));
        setShopifySyncCsvItems(exportItems.filter((i) => (i.source || '').toLowerCase() !== 'shopify'));
        setShopifySyncState('review');
        setExporting(false);
        return; // Export continues in handleConfirmShopifySync
      }

      // No Shopify sync items — proceed with CSV/file exports only
      const { fileCount, timestamp } = executeCsvExports(exportItems);

      // Mark items as exported on server
      const matchIds = exportItems.map((item) => item.matchId);
      await api.markExported(matchIds, []);

      setExportSuccess({
        count: exportItems.length,
        fileCount,
        syncCount: 0,
        timestamp,
      });

      await refreshAfterExport();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  // ── Confirm Shopify sync from review screen ───
  async function handleConfirmShopifySync() {
    const selected = shopifySyncItems.filter((i) => i.selected);
    if (selected.length === 0) return;

    setShopifySyncState('syncing');

    try {
      // Execute CSV exports for non-Shopify items
      const { fileCount, timestamp } = executeCsvExports(shopifySyncCsvItems);

      // Mark all items as exported, push Shopify sync items
      const allMatchIds = [
        ...selected.map((i) => i.matchId),
        ...shopifySyncCsvItems.map((i) => i.matchId),
      ];
      const result = await api.markExported(allMatchIds, ['shopify']);

      setShopifySyncResults(result.shopifyResults || {
        summary: { total: selected.length, succeeded: selected.length, failed: 0 },
        results: selected.map((i) => ({ ...i, status: 'success' })),
      });
      setShopifySyncState('results');

      setExportSuccess({
        count: allMatchIds.length,
        fileCount,
        syncCount: 1,
        timestamp,
      });

      await refreshAfterExport();
    } catch (err) {
      console.error('Shopify sync failed:', err);
      setShopifySyncResults({
        summary: { total: selected.length, succeeded: 0, failed: selected.length },
        results: selected.map((i) => ({
          ...i,
          status: 'failed',
          error: err.message || 'Sync failed',
        })),
      });
      setShopifySyncState('results');
    }
  }

  // ── Download failure report CSV ───
  function downloadFailureReport(failures) {
    const headers = ['Shopify Variant ID', 'SKU', 'Product Name', 'Variant', 'Cost Price', 'Selling Price', 'Error Reason'];
    const rows = failures.map((f) => [
      f.shopifyVariantId || '',
      f.sku || '',
      f.productName || '',
      f.variantTitle || '',
      f.newCost ?? '',
      f.newPrice ?? '',
      f.error || '',
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, `shopify_sync_failures_${new Date().toISOString().split('T')[0]}.csv`);
  }

  // ── Refresh data after any export ───
  async function refreshAfterExport() {
    const data = await api.getExportItems([...selectedInvoiceIds], includeOtherExported);
    setItems(data.items || []);
    const invoiceData = await api.getExportableInvoices();
    setInvoices(invoiceData);
    setSelectedMatchIds(new Set());
    setPriceEdits({});
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
        <td className="hidden sm:table-cell px-3 py-3 text-center">
          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
            inv.confirmedCount === inv.totalCount ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {inv.confirmedCount}/{inv.totalCount}
          </span>
        </td>
        <td className="hidden sm:table-cell px-3 py-3">
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

  // ── Sortable column header helper ───
  function SortHeader({ label, sortKey, currentKey, asc, onToggle, className = '' }) {
    const active = currentKey === sortKey;
    return (
      <th
        className={`px-3 py-2.5 text-left cursor-pointer select-none hover:text-gray-700 transition ${className}`}
        onClick={() => onToggle(sortKey, active ? !asc : false)}
      >
        <div className="flex items-center gap-1">
          {label}
          {active && <span className="text-[10px]">{asc ? '▲' : '▼'}</span>}
        </div>
      </th>
    );
  }

  // ── Pagination component ───
  function Pagination({ currentPage, totalPages, totalItems, perPage, onPageChange }) {
    if (totalItems <= perPage) return null;
    const start = (currentPage - 1) * perPage + 1;
    const end = Math.min(currentPage * perPage, totalItems);
    return (
      <div className="px-5 py-2.5 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span>Showing {start}-{end} of {totalItems} invoices</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
            .reduce((acc, p, i, arr) => {
              if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="px-1">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`w-7 h-7 rounded ${p === currentPage ? 'bg-teal-600 text-white' : 'border border-gray-200 hover:bg-gray-50'}`}
                >
                  {p}
                </button>
              )
            )}
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="px-2.5 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // ── RENDER ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <WorkflowBreadcrumb step={3} onStepClick={(s) => {
        if (s === 1) navigate('/invoices');
        else if (s === 2) {
          const selIds = [...selectedInvoiceIds];
          navigate(selIds.length === 1 ? `/review/${selIds[0]}` : '/invoices');
        }
      }} />
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            const selIds = [...selectedInvoiceIds];
            navigate(selIds.length === 1 ? `/review/${selIds[0]}` : '/invoices');
          }}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-lg font-semibold">Export Price Updates</h2>
          <p className="text-sm text-gray-500">
            Select invoices, review confirmed items, adjust prices if needed, and export CSV/XLSX files for your POS and shelf labels.
          </p>
        </div>
      </div>

      {/* Stale data banner */}
      {staleData && (
        <StaleDataBanner onRefresh={() => { setStaleData(false); window.location.reload(); }} />
      )}

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
          {readyInvoicesAll.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Ready to Export</h3>
                <span className="text-xs text-gray-400">
                  {readyInvoicesAll.filter((inv) => selectedInvoiceIds.has(inv.id)).length} of {readyInvoicesAll.length} selected
                </span>
              </div>
              {readyInvoicesAll.length > 5 && (
                <div className="px-5 py-2 border-b border-gray-100">
                  <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by supplier or invoice #..."
                      value={readySearch}
                      onChange={(e) => setReadySearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-400"
                    />
                  </div>
                </div>
              )}
              <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pl-5 pr-2 py-2.5 text-left w-10">
                      <button
                        onClick={() => toggleSectionInvoices(readyFiltered)}
                        className="w-5 h-5 rounded flex items-center justify-center border-2 border-gray-300 hover:border-teal-500 transition"
                      >
                        {readyInvoices.length > 0 && readyInvoices.every((inv) => selectedInvoiceIds.has(inv.id)) && (
                          <Check className="w-3 h-3 text-teal-600" />
                        )}
                      </button>
                    </th>
                    <SortHeader label="Supplier" sortKey="supplier" currentKey={readySortKey} asc={readySortAsc} onToggle={(k, a) => { setReadySortKey(k); setReadySortAsc(a); }} />
                    <th className="px-3 py-2.5 text-left">Invoice #</th>
                    <SortHeader label="Date" sortKey="date" currentKey={readySortKey} asc={readySortAsc} onToggle={(k, a) => { setReadySortKey(k); setReadySortAsc(a); }} />
                    <th className="hidden sm:table-cell px-3 py-2.5 text-center">Confirmed</th>
                    <th className="hidden sm:table-cell px-3 py-2.5 text-center">Changes</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {readyInvoices.length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-4 text-center text-sm text-gray-400">No invoices match your search.</td></tr>
                  ) : readyInvoices.map((inv) => renderInvoiceRow(inv, false))}
                </tbody>
              </table>
              </div>
              <Pagination currentPage={readyPage} totalPages={readyTotalPages} totalItems={readyFiltered.length} perPage={INVOICES_PER_PAGE} onPageChange={setReadyPage} />
            </div>
          )}

          {/* Previously Exported */}
          {exportedInvoicesAll.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Previously Exported</h3>
                <span className="text-xs text-gray-400">
                  {exportedInvoicesAll.filter((inv) => selectedInvoiceIds.has(inv.id)).length} of {exportedInvoicesAll.length} selected
                </span>
              </div>
              {exportedInvoicesAll.length > 5 && (
                <div className="px-5 py-2 border-b border-gray-100">
                  <div className="relative">
                    <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by supplier or invoice #..."
                      value={exportedSearch}
                      onChange={(e) => setExportedSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-400"
                    />
                  </div>
                </div>
              )}
              <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pl-5 pr-2 py-2.5 text-left w-10">
                      <button
                        onClick={() => toggleSectionInvoices(exportedFiltered)}
                        className="w-5 h-5 rounded flex items-center justify-center border-2 border-gray-300 hover:border-teal-500 transition"
                      >
                        {exportedInvoices.length > 0 && exportedInvoices.every((inv) => selectedInvoiceIds.has(inv.id)) && (
                          <Check className="w-3 h-3 text-teal-600" />
                        )}
                      </button>
                    </th>
                    <SortHeader label="Supplier" sortKey="supplier" currentKey={exportedSortKey} asc={exportSortAsc} onToggle={(k, a) => { setExportedSortKey(k); setExportSortAsc(a); }} />
                    <th className="px-3 py-2.5 text-left">Invoice #</th>
                    <SortHeader label="Date" sortKey="date" currentKey={exportedSortKey} asc={exportSortAsc} onToggle={(k, a) => { setExportedSortKey(k); setExportSortAsc(a); }} />
                    <th className="hidden sm:table-cell px-3 py-2.5 text-center">Confirmed</th>
                    <th className="hidden sm:table-cell px-3 py-2.5 text-center">Changes</th>
                    <th className="px-3 py-2.5 text-center">Status</th>
                    <SortHeader label="Last Exported" sortKey="lastExported" currentKey={exportedSortKey} asc={exportSortAsc} onToggle={(k, a) => { setExportedSortKey(k); setExportSortAsc(a); }} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {exportedInvoices.length === 0 ? (
                    <tr><td colSpan={8} className="px-5 py-4 text-center text-sm text-gray-400">No invoices match your search.</td></tr>
                  ) : exportedInvoices.map((inv) => renderInvoiceRow(inv, true))}
                </tbody>
              </table>
              </div>
              <Pagination currentPage={exportedPage} totalPages={exportedTotalPages} totalItems={exportedFiltered.length} perPage={INVOICES_PER_PAGE} onPageChange={setExportedPage} />
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
            <div className="max-h-[480px] overflow-auto -mx-4 sm:mx-0">
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

      {/* ── Shopify Sync Review Screen ─── */}
      {shopifySyncState === 'review' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Shopify Sync Review</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Review and uncheck any items you don't want to sync to Shopify.
                </p>
              </div>
              <button
                onClick={() => { setShopifySyncState('idle'); setShopifySyncItems([]); }}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={shopifySyncItems.length > 0 && shopifySyncItems.every((i) => i.selected)}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setShopifySyncItems((prev) => prev.map((i) => ({ ...i, selected: checked })));
                  }}
                  className="rounded border-gray-300 text-teal-600"
                />
                Select All
              </label>
              <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-200">
                    <th className="pb-2 w-8"></th>
                    <th className="pb-2 px-2">Product</th>
                    <th className="pb-2 px-2">Variant</th>
                    <th className="pb-2 px-2 text-right">Old Sell</th>
                    <th className="pb-2 px-2 text-right">New Sell</th>
                    <th className="pb-2 px-2 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shopifySyncItems.map((item, idx) => (
                    <tr key={item.matchId} className={item.selected ? '' : 'opacity-50'}>
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={() => {
                            setShopifySyncItems((prev) => prev.map((it, i) =>
                              i === idx ? { ...it, selected: !it.selected } : it
                            ));
                          }}
                          className="rounded border-gray-300 text-teal-600"
                        />
                      </td>
                      <td className="py-2 px-2 font-medium text-gray-900">{item.productName}</td>
                      <td className="py-2 px-2 text-gray-600">{item.size || item.variantName || 'Default'}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-500">{money(item.currentPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono font-medium text-gray-900">{money(item.newPrice)}</td>
                      <td className="py-2 px-2 text-right font-mono text-gray-500">{money(item.newCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-gray-100 text-xs text-gray-500 space-y-1">
              <p>{shopifySyncItems.filter((i) => i.selected).length} of {shopifySyncItems.length} items selected for sync</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Only selling prices will be updated in Shopify</li>
                <li>No new products will be created</li>
                <li>No products will be deleted</li>
                <li>You can revert by changing prices in Shopify directly</li>
              </ul>
              {shopifySyncCsvItems.length > 0 && (
                <p className="text-teal-600 font-medium mt-1">
                  POS items ({shopifySyncCsvItems.length} item{shopifySyncCsvItems.length !== 1 ? 's' : ''}) will be exported as CSV.
                </p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => { setShopifySyncState('idle'); setShopifySyncItems([]); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmShopifySync}
                disabled={shopifySyncItems.filter((i) => i.selected).length === 0}
                className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Confirm sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Shopify Sync In Progress ─── */}
      {shopifySyncState === 'syncing' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl px-8 py-6 flex items-center gap-4">
            <svg className="animate-spin w-6 h-6 text-teal-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-gray-700">Syncing prices to Shopify...</span>
          </div>
        </div>
      )}

      {/* ── Shopify Sync Results Screen ─── */}
      {shopifySyncState === 'results' && shopifySyncResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Shopify Sync Complete</h3>
              <div className="flex items-center gap-4 mt-2 text-sm">
                {shopifySyncResults.summary.succeeded > 0 && (
                  <span className="text-emerald-700 font-medium">
                    {shopifySyncResults.summary.succeeded} product{shopifySyncResults.summary.succeeded !== 1 ? 's' : ''} updated successfully
                  </span>
                )}
                {shopifySyncResults.summary.failed > 0 && (
                  <span className="text-red-600 font-medium">
                    {shopifySyncResults.summary.failed} failed
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Successful items */}
              {shopifySyncResults.results.filter((r) => r.status === 'success').length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-gray-400 tracking-wider mb-2">Successful</h4>
                  <div className="space-y-1.5">
                    {shopifySyncResults.results.filter((r) => r.status === 'success').map((r) => (
                      <div key={r.matchId || r.shopifyVariantId} className="flex items-center gap-3 text-sm py-1.5 px-3 bg-emerald-50 rounded-lg">
                        <span className="text-emerald-600 font-medium">&#10003;</span>
                        <span className="font-medium text-gray-900">{r.productName}</span>
                        <span className="text-gray-500">{r.variantTitle}</span>
                        <span className="ml-auto font-mono text-gray-500">{money(r.oldPrice)}</span>
                        <span className="text-gray-400">&rarr;</span>
                        <span className="font-mono font-medium text-gray-900">{money(r.newPrice)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Failed items */}
              {shopifySyncResults.results.filter((r) => r.status !== 'success').length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-red-400 tracking-wider mb-2">Failed</h4>
                  <div className="space-y-1.5">
                    {shopifySyncResults.results.filter((r) => r.status !== 'success').map((r) => (
                      <div key={r.matchId || r.shopifyVariantId} className="flex items-center gap-3 text-sm py-1.5 px-3 bg-red-50 rounded-lg">
                        <span className="text-red-500 font-medium">&#10007;</span>
                        <span className="font-medium text-gray-900">{r.productName}</span>
                        <span className="text-gray-500">{r.variantTitle}</span>
                        <span className="ml-auto text-red-600 text-xs">{r.error}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex justify-between">
              {shopifySyncResults.results.filter((r) => r.status !== 'success').length > 0 ? (
                <button
                  onClick={() => downloadFailureReport(shopifySyncResults.results.filter((r) => r.status !== 'success'))}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-lg hover:bg-red-100 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export failure report
                </button>
              ) : <div />}
              <button
                onClick={() => { setShopifySyncState('idle'); setShopifySyncItems([]); setShopifySyncResults(null); }}
                className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
              >
                Done
              </button>
            </div>
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
