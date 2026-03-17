import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import WorkflowBreadcrumb from '../components/layout/WorkflowBreadcrumb';

// ── Store color palette ───────────────────────────────────────
const STORE_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', headerBg: 'bg-blue-50', headerBorder: 'border-blue-200', headerText: 'text-blue-800', dot: 'bg-blue-500', btnText: 'text-blue-600' },
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', headerBg: 'bg-violet-50', headerBorder: 'border-violet-200', headerText: 'text-violet-800', dot: 'bg-violet-500', btnText: 'text-violet-600' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', headerBg: 'bg-emerald-50', headerBorder: 'border-emerald-200', headerText: 'text-emerald-800', dot: 'bg-emerald-500', btnText: 'text-emerald-600' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', headerBg: 'bg-rose-50', headerBorder: 'border-rose-200', headerText: 'text-rose-800', dot: 'bg-rose-500', btnText: 'text-rose-600' },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', headerBg: 'bg-orange-50', headerBorder: 'border-orange-200', headerText: 'text-orange-800', dot: 'bg-orange-500', btnText: 'text-orange-600' },
];

// ── Icons (inline SVGs) ───────────────────────────────────────
const ChevronRight = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
);
const Check = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
);
const ArrowRight = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
);
const ArrowLeft = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
);
const Warning = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
);
const Search = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
);
const Download = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
);
const Store = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.15c0 .415.336.75.75.75z" /></svg>
);
const Swap = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
);
const XMark = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
);

// ── Helpers ───────────────────────────────────────────────────
const pct = (v) => (v * 100).toFixed(1) + '%';
const money = (v) => v != null ? '$' + Number(v).toFixed(2) : '—';
const costChangePct = (prev, next) => {
  if (!prev || prev === 0) return null;
  return ((next - prev) / prev) * 100;
};
const marginPct = (price, cost) => {
  if (!price || price === 0) return 0;
  return ((price - cost) / price) * 100;
};
const marginDollar = (price, cost) => price - cost;

// ── Step progress bar ─────────────────────────────────────────
function StepProgress({ step }) {
  const steps = [
    { num: 1, label: 'Match & Price' },
    { num: 2, label: 'Approval Summary' },
    { num: 3, label: 'Export' },
  ];
  const current = step - 1; // step 2→index 1, step 3→index 2, step 4→index 3
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          {i > 0 && <div className={`w-8 h-px ${i < current ? 'bg-teal-500' : 'bg-gray-300'}`} />}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
            i < current ? 'bg-teal-100 text-teal-700' :
            i === current ? 'bg-teal-600 text-white' :
            'bg-gray-100 text-gray-500'
          }`}>
            {i < current ? <Check className="w-3.5 h-3.5" /> : null}
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Store pricing card ────────────────────────────────────────
function StoreCard({ storeId, matches, color, storeName, platform, invoiceId, lineId, onPriceUpdate }) {
  const storeMatches = matches.filter((m) => m.productVariant?.storeId === storeId);
  if (storeMatches.length === 0) return null;

  return (
    <div className={`border ${color.border} rounded-lg overflow-hidden`}>
      <div className={`px-4 py-2.5 ${color.headerBg} border-b ${color.headerBorder} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Store className={`w-4 h-4 ${color.btnText}`} />
          <span className={`text-sm font-semibold ${color.headerText}`}>{storeName}</span>
          {platform && <span className={`text-xs ${color.btnText} ml-1`}>({platform})</span>}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-white border-b border-gray-100">
            <th className="px-4 py-2">SKU</th>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2">Size</th>
            <th className="px-3 py-2 text-right">Curr Cost</th>
            <th className="px-3 py-2 text-center w-8"></th>
            <th className="px-3 py-2 text-right">New Cost</th>
            <th className="px-3 py-2 text-right">Curr Price</th>
            <th className="px-3 py-2 text-right">Sugg Price</th>
            <th className="px-3 py-2 text-right">Margin %</th>
            <th className="px-3 py-2 text-right">Margin $</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {storeMatches.map((match) => {
            const v = match.productVariant;
            const change = costChangePct(match.previousCost, match.newCost);
            const price = match.approvedPrice ?? match.suggestedPrice ?? v.salePrice;
            const margin = marginPct(price, match.newCost);
            const marginD = marginDollar(price, match.newCost);

            return (
              <tr key={match.id} className="bg-white hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{v.sku}</td>
                <td className="px-3 py-2.5 font-medium">{v.name}</td>
                <td className="px-3 py-2.5 text-gray-600">{v.size || '—'}</td>
                <td className="px-3 py-2.5 text-right font-mono">{money(match.previousCost)}</td>
                <td className="px-3 py-2.5 text-center">
                  <ArrowRight className="w-4 h-4 text-gray-300 inline" />
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  <span className={change > 0 ? 'text-red-600 font-medium' : change < 0 ? 'text-emerald-600 font-medium' : ''}>
                    {money(match.newCost)}
                  </span>
                  {change != null && change !== 0 && (
                    <span className={`text-xs ml-1 ${change > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                      {change > 0 ? '+' : ''}{change.toFixed(1)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{money(match.currentPrice)}</td>
                <td className="px-3 py-2.5 text-right">
                  <input
                    type="text"
                    defaultValue={price?.toFixed(2)}
                    className="w-20 text-right font-mono px-2 py-1 border border-gray-200 rounded bg-white text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val) && val !== price) {
                        onPriceUpdate(invoiceId, lineId, match.id, val);
                      }
                    }}
                  />
                </td>
                <td className={`px-3 py-2.5 text-right font-mono font-medium ${margin >= 25 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-red-600'}`}>
                  {margin.toFixed(1)}%
                </td>
                <td className={`px-3 py-2.5 text-right font-mono ${marginD >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {money(marginD)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Export flag icon ──────────────────────────────────────────
const ExportFlag = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" /></svg>
);

// ── Match resolution panel (table-based, with pricing) ────────
function MatchResolutionPanel({ line, invoice, stores, storeColorMap, onConfirmMatch }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStoreFilter, setSearchStoreFilter] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const [saveMapping, setSaveMapping] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  // Track user price overrides: { variantId: newSellPrice }
  const [priceOverrides, setPriceOverrides] = useState({});
  const [marginMode, setMarginMode] = useState('pct'); // 'pct' or 'dollar'

  const baseUnitCost = line.baseUnitCost || line.unitPrice;

  // Toggle product selection (multi-select)
  function toggleProduct(productId) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setIsConfirmed(false); // re-activate confirm button on selection change
  }

  // Build unified product list from suggestions + search results
  // Each product groups its variants, each variant carries match-record pricing
  const suggestions = useMemo(() => {
    if (!line.matches || line.matches.length === 0) return [];
    const byProduct = {};
    for (const m of line.matches) {
      let pid, pName, pSource, pCost, pPrice, pCategory, pBarcode, pBaseUnit;
      if (m.productVariant?.product) {
        const p = m.productVariant.product;
        pid = p.id; pName = p.name; pSource = p.source; pCost = p.costPrice; pPrice = p.sellingPrice;
        pCategory = p.category; pBarcode = p.barcode; pBaseUnit = p.baseUnit;
      } else if (m.product) {
        pid = m.product.id; pName = m.product.name; pSource = m.product.source;
        pCost = m.product.costPrice; pPrice = m.product.sellingPrice;
        pCategory = m.product.category; pBarcode = m.product.barcode; pBaseUnit = m.product.baseUnit;
      } else continue;
      if (!byProduct[pid]) {
        byProduct[pid] = {
          productId: pid, productName: pName, confidence: m.confidence,
          matchReason: m.matchReason, source: pSource,
          costPrice: pCost, sellingPrice: pPrice,
          category: pCategory, barcode: pBarcode, baseUnit: pBaseUnit,
          variants: [], isSuggestion: true,
        };
      }
      if (m.productVariant) {
        // Variant-level match — attach match-record pricing to the variant (deduplicate by variant ID)
        if (!byProduct[pid].variants.some((ev) => ev.id === m.productVariant.id)) {
          byProduct[pid].variants.push({
            ...m.productVariant,
            matchId: m.id,
            newCost: m.newCost,
            previousCost: m.previousCost,
            currentPrice: m.currentPrice,
            suggestedPrice: m.suggestedPrice,
            approvedPrice: m.approvedPrice,
            exportFlagged: m.exportFlagged,
          });
        }
      } else if (m.product?.variants?.length) {
        // Product-level match with variants — pull from product, no match pricing yet
        for (const v of m.product.variants) {
          if (!byProduct[pid].variants.some((ev) => ev.id === v.id)) {
            byProduct[pid].variants.push({
              ...v,
              matchId: null,
              newCost: baseUnitCost ? Math.round(baseUnitCost * (v.unitQty || 1) * 100) / 100 : null,
              previousCost: v.currentCost,
              currentPrice: v.salePrice,
              suggestedPrice: null,
              approvedPrice: null,
              exportFlagged: false,
            });
          }
        }
      } else {
        // Product-level match with NO variants — create synthetic variant entry
        byProduct[pid].variants.push({
          id: null, sku: pBarcode || '', name: pName, size: null,
          unitQty: 1, currentCost: pCost, salePrice: pPrice, store: null,
          matchId: m.id,
          newCost: m.newCost,
          previousCost: m.previousCost,
          currentPrice: m.currentPrice,
          suggestedPrice: m.suggestedPrice,
          approvedPrice: m.approvedPrice,
          exportFlagged: m.exportFlagged,
        });
      }
    }
    return Object.values(byProduct);
  }, [line.matches, baseUnitCost]);

  // Auto-select all suggestions initially
  useEffect(() => {
    if (suggestions.length > 0 && selectedProductIds.size === 0) {
      setSelectedProductIds(new Set(suggestions.map((s) => s.productId)));
    }
  }, [suggestions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize search — only auto-search if no AI suggestions exist
  useEffect(() => {
    const words = line.description.split(/\s+/).slice(0, 2).join(' ');
    setSearchQuery(words);
    if (suggestions.length === 0) {
      doSearch(words, '');
    }
  }, [line.description, suggestions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doSearch(q, storeId) {
    if (!q || q.length < 2) return;
    setSearching(true);
    try {
      const results = await api.searchProducts(q, storeId || undefined);
      setSearchResults(results);
    } catch { /* ignore */ } finally { setSearching(false); }
  }

  function clearSearch() {
    setSearchQuery('');
    setSearchResults([]);
  }

  // Merge suggestions + search results, dedup by product id, sort by confidence desc
  const allProducts = useMemo(() => {
    const seen = new Set();
    const merged = [];
    for (const s of suggestions) {
      seen.add(s.productId);
      merged.push(s);
    }
    for (const p of searchResults) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const searchVariants = (p.variants && p.variants.length > 0)
        ? p.variants.map(v => ({
            ...v,
            matchId: null,
            newCost: baseUnitCost ? Math.round(baseUnitCost * (v.unitQty || 1) * 100) / 100 : null,
            previousCost: v.currentCost,
            currentPrice: v.salePrice,
            suggestedPrice: null,
            approvedPrice: null,
            exportFlagged: false,
          }))
        : [{
            id: null, sku: p.barcode || '', name: p.name, size: null,
            unitQty: 1, currentCost: p.costPrice, salePrice: p.sellingPrice, store: null,
            matchId: null,
            newCost: baseUnitCost ? Math.round(baseUnitCost * 100) / 100 : null,
            previousCost: p.costPrice,
            currentPrice: p.sellingPrice,
            suggestedPrice: null,
            approvedPrice: null,
            exportFlagged: false,
          }];
      merged.push({
        productId: p.id, productName: p.name, confidence: null,
        matchReason: null, source: p.source,
        costPrice: p.costPrice, sellingPrice: p.sellingPrice,
        category: p.category, barcode: p.barcode, baseUnit: p.baseUnit,
        variants: searchVariants, isSuggestion: false,
      });
    }
    // Sort by confidence descending (null/no-score items last)
    merged.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
    return merged;
  }, [suggestions, searchResults]);

  function handleSellPriceChange(variantKey, value) {
    setPriceOverrides((prev) => ({ ...prev, [variantKey]: value }));
    setIsConfirmed(false); // re-activate confirm button on price change
  }

  function handleMarginChange(variantKey, marginValue, newCost) {
    if (newCost == null || newCost === 0) return;
    let sellPrice;
    if (marginMode === 'pct') {
      if (marginValue >= 100) return; // margin can't be ≥100%
      sellPrice = Math.round((newCost / (1 - marginValue / 100)) * 100) / 100;
    } else {
      sellPrice = Math.round((newCost + marginValue) * 100) / 100;
    }
    if (sellPrice > 0) {
      setPriceOverrides((prev) => ({ ...prev, [variantKey]: sellPrice }));
      setIsConfirmed(false); // re-activate confirm button on margin change
    }
  }

  async function handleConfirm() {
    if (selectedProductIds.size === 0) return;
    setConfirming(true);
    try {
      // Build variant-level overrides: only for selected products
      const variantOverrides = {};
      for (const pid of selectedProductIds) {
        const item = allProducts.find((p) => p.productId === pid);
        if (!item) continue;
        for (const v of item.variants) {
          const key = v.id || pid; // variantId for real variants, productId for variant-less
          if (priceOverrides[key] != null) variantOverrides[key] = priceOverrides[key];
        }
      }
      await onConfirmMatch(line.id, [...selectedProductIds], saveMapping, variantOverrides);
      setIsConfirmed(true);
    } finally { setConfirming(false); }
  }

  // Calculate per-variant pricing data
  function getVariantPricing(variant, productId) {
    const currentCost = variant.previousCost ?? variant.currentCost ?? null;
    const sellPrice = variant.currentPrice ?? variant.salePrice ?? null;
    const currentMarginPct = sellPrice && currentCost ? marginPct(sellPrice, currentCost) : null;
    const currentMarginDol = sellPrice && currentCost != null ? marginDollar(sellPrice, currentCost) : null;
    const newCost = variant.newCost ?? (baseUnitCost
      ? Math.round(baseUnitCost * (variant.unitQty || 1) * 100) / 100
      : null);
    // Default new sell price chain: approvedPrice → suggestedPrice → current sell price
    const defaultSellPrice = variant.approvedPrice ?? variant.suggestedPrice ?? sellPrice ?? null;
    const overrideKey = variant.id || productId;
    const overridePrice = priceOverrides[overrideKey];
    const effectiveSellPrice = overridePrice != null ? overridePrice : defaultSellPrice;
    const newMarginPct = effectiveSellPrice && newCost ? marginPct(effectiveSellPrice, newCost) : null;
    const newMarginDol = effectiveSellPrice && newCost != null ? marginDollar(effectiveSellPrice, newCost) : null;
    const costChange = currentCost && newCost ? costChangePct(currentCost, newCost) : null;
    const priceChanged = overridePrice != null && overridePrice !== defaultSellPrice;
    return { currentCost, sellPrice, currentMarginPct, currentMarginDol, newCost, defaultSellPrice, effectiveSellPrice, newMarginPct, newMarginDol, costChange, priceChanged };
  }

  return (
    <div className="border-t border-amber-300 bg-amber-50/20">
      <div className="grid grid-cols-12 divide-x divide-gray-200 min-h-[380px]">
        {/* LEFT: Invoice context + search */}
        <div className="col-span-3 p-5 space-y-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Invoice Line</h4>
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
              <div className="font-medium">{line.description}</div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>Pack size: <span className="font-medium text-gray-900">{line.packSize || '—'}</span></div>
                <div>Unit price: <span className="font-medium text-gray-900">{money(line.unitPrice)}</span></div>
                <div>Landed cost: <span className="font-medium text-gray-900">{line.baseUnitCost ? money(line.baseUnitCost) + '/' + (line.baseUnit || 'unit') : '—'}</span></div>
                <div>Qty ordered: <span className="font-medium text-gray-900">{line.quantity}</span></div>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Search Products</h4>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doSearch(searchQuery, searchStoreFilter)}
                  placeholder="Name, SKU, barcode..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                />
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              </div>
              <button
                onClick={() => doSearch(searchQuery, searchStoreFilter)}
                className="px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
              >
                Search
              </button>
              {searchResults.length > 0 && (
                <button
                  onClick={clearSearch}
                  className="px-2 py-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
                  title="Clear search — show AI suggestions only"
                >
                  <XMark className="w-4 h-4" />
                </button>
              )}
            </div>
            {stores.length > 0 && (
              <select
                value={searchStoreFilter}
                onChange={(e) => { setSearchStoreFilter(e.target.value); doSearch(searchQuery, e.target.value); }}
                className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">All Stores</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* RIGHT: Product results table with pricing */}
        <div className="col-span-9 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              {searchResults.length === 0 && suggestions.length > 0 ? 'AI Suggestions' : 'Select Products to Match'}
            </h4>
            <span className="text-xs text-teal-600 font-medium">
              {selectedProductIds.size > 0 ? `${selectedProductIds.size} of ${allProducts.length} selected` : `${allProducts.length} results`}
            </span>
          </div>

          {searching && <div className="text-sm text-gray-400 py-8 text-center">Searching...</div>}
          {!searching && allProducts.length === 0 && (
            <div className="text-sm text-gray-400 py-8 text-center">No results found</div>
          )}

          {!searching && allProducts.length > 0 && (
            <div className="border border-gray-200 rounded-lg overflow-auto max-h-[340px]">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pl-4 pr-2 py-2.5 text-left w-8"></th>
                    <th className="px-3 py-2.5 text-left">Product</th>
                    <th className="px-2 py-2.5 text-left w-16">Source</th>
                    <th className="px-2 py-2.5 text-center w-14">Score</th>
                    <th className="px-2 py-2.5 text-right w-20">Curr Cost</th>
                    <th className="px-2 py-2.5 text-right w-20">Sell Price</th>
                    <th className="px-2 py-2.5 text-right w-20">
                      <button onClick={() => setMarginMode((m) => m === 'pct' ? 'dollar' : 'pct')} className="hover:text-teal-600 transition-colors" title="Toggle margin % / $">
                        Margin {marginMode === 'pct' ? '%' : '$'}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-right w-20">New Cost</th>
                    <th className="px-2 py-2.5 text-right w-24">New Sell</th>
                    <th className="px-2 py-2.5 text-right w-24">
                      <button onClick={() => setMarginMode((m) => m === 'pct' ? 'dollar' : 'pct')} className="hover:text-teal-600 transition-colors" title="Toggle margin % / $">
                        New Margin {marginMode === 'pct' ? '%' : '$'}
                      </button>
                    </th>
                    <th className="px-2 py-2.5 text-center w-16">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allProducts.map((item) => {
                    const isSelected = selectedProductIds.has(item.productId);
                    const hasVariants = item.variants.length > 1 || (item.variants.length === 1 && item.variants[0].id != null);
                    const anyVariantPriceChanged = item.variants.some((v) => {
                      const vp = getVariantPricing(v, item.productId);
                      return vp.priceChanged;
                    });

                    if (!hasVariants) {
                      // ─── Single flat row for products without variants ───
                      const v = item.variants[0] || {};
                      const p = getVariantPricing(v, item.productId);
                      const overrideKey = v.id || item.productId;
                      return (
                        <tr
                          key={item.productId}
                          className={`cursor-pointer transition ${item.isSuggestion ? 'border-l-2 border-l-teal-400' : ''} ${isSelected ? 'bg-teal-50/60 hover:bg-teal-50' : 'hover:bg-gray-50'}`}
                          onClick={() => toggleProduct(item.productId)}
                        >
                          <td className="pl-4 pr-2 py-3">
                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${isSelected ? 'bg-teal-600' : 'border-2 border-gray-300'}`}>
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-gray-900">{item.productName}</span>
                              {p.priceChanged && (
                                <span title="Price changed — flagged for export">
                                  <ExportFlag className="w-3.5 h-3.5 text-orange-500" />
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.category || '—'}
                              {item.barcode && <> &middot; {item.barcode}</>}
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            {item.source && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                item.source === 'POS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                              }`}>{item.source}</span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-center">
                            {item.confidence != null ? (
                              <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${
                                item.confidence >= 0.8 ? 'bg-emerald-100 text-emerald-700' :
                                item.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                              }`}>{Math.round(item.confidence * 100)}%</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className={`px-2 py-3 text-right font-mono ${isSelected ? 'text-gray-700' : 'text-gray-400'}`}>
                            {p.currentCost != null ? money(p.currentCost) : '—'}
                          </td>
                          <td className={`px-2 py-3 text-right font-mono ${isSelected ? 'text-gray-700' : 'text-gray-400'}`}>
                            {p.sellPrice != null ? money(p.sellPrice) : '—'}
                          </td>
                          <td className={`px-2 py-3 text-right font-mono ${isSelected ? '' : 'text-gray-400'}`}>
                            {p.currentMarginPct != null ? (
                              marginMode === 'pct' ? `${p.currentMarginPct.toFixed(1)}%` : money(p.currentMarginDol)
                            ) : '—'}
                          </td>
                          <td className={`px-2 py-3 text-right font-mono font-medium ${
                            p.costChange != null && p.costChange > 0 ? 'text-red-600' : p.costChange != null && p.costChange < 0 ? 'text-emerald-600' : isSelected ? 'text-gray-700' : 'text-gray-400'
                          }`}>{p.newCost != null ? money(p.newCost) : '—'}</td>
                          <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            {p.defaultSellPrice != null ? (
                              <input type="number" step="0.01" defaultValue={p.effectiveSellPrice?.toFixed(2)}
                                key={`sell-${overrideKey}-${p.effectiveSellPrice}`}
                                className={`w-20 text-right font-mono px-1.5 py-1 border rounded text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${
                                  p.priceChanged ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white'
                                }`}
                                onBlur={(e) => { const val = parseFloat(e.target.value); if (!isNaN(val)) handleSellPriceChange(overrideKey, val); }}
                              />
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            {p.newMarginPct != null ? (
                              <input type="number" step={marginMode === 'pct' ? '0.1' : '0.01'}
                                key={`margin-${overrideKey}-${marginMode}-${p.effectiveSellPrice}`}
                                defaultValue={marginMode === 'pct' ? p.newMarginPct.toFixed(1) : p.newMarginDol?.toFixed(2)}
                                className={`w-20 text-right font-mono px-1.5 py-1 border border-gray-200 bg-white rounded text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${
                                  marginMode === 'pct'
                                    ? (p.newMarginPct >= 25 ? 'text-emerald-600' : p.newMarginPct >= 10 ? 'text-amber-600' : 'text-red-600')
                                    : 'text-gray-700'
                                }`}
                                onBlur={(e) => { const val = parseFloat(e.target.value); if (!isNaN(val)) handleMarginChange(overrideKey, val, p.newCost); }}
                              />
                            ) : '—'}
                          </td>
                          <td className="px-2 py-3 text-center">
                            {p.costChange != null && p.costChange !== 0 ? (
                              <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${p.costChange > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                {p.costChange > 0 ? '+' : ''}{p.costChange.toFixed(1)}%
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      );
                    }

                    // ─── Product header row + variant sub-rows ───
                    return (
                      <React.Fragment key={item.productId}>
                        {/* Product header row */}
                        <tr
                          className={`cursor-pointer transition ${item.isSuggestion ? 'border-l-2 border-l-teal-400' : ''} ${isSelected ? 'bg-teal-50/60 hover:bg-teal-50' : 'hover:bg-gray-50'}`}
                          onClick={() => toggleProduct(item.productId)}
                        >
                          <td className="pl-4 pr-2 py-3">
                            <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${isSelected ? 'bg-teal-600' : 'border-2 border-gray-300'}`}>
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-gray-900">{item.productName}</span>
                              {anyVariantPriceChanged && (
                                <span title="Variant price(s) changed — flagged for export">
                                  <ExportFlag className="w-3.5 h-3.5 text-orange-500" />
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.category || '—'}
                              {item.barcode && <> &middot; {item.barcode}</>}
                              {item.baseUnit && (
                                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded border border-indigo-100">
                                  ⚖ {item.baseUnit}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            {item.source && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                item.source === 'POS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                              }`}>{item.source}</span>
                            )}
                          </td>
                          <td className="px-2 py-3 text-center">
                            {item.confidence != null ? (
                              <span className={`px-1.5 py-0.5 text-xs rounded-full font-medium ${
                                item.confidence >= 0.8 ? 'bg-emerald-100 text-emerald-700' :
                                item.confidence >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                              }`}>{Math.round(item.confidence * 100)}%</span>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                          {/* Pricing columns — show variant count instead of individual pricing */}
                          <td colSpan={7} className="px-2 py-3 text-center text-xs text-gray-500 italic">
                            {item.variants.length} variant{item.variants.length !== 1 ? 's' : ''}
                          </td>
                        </tr>

                        {/* Variant sub-rows */}
                        {item.variants.map((v, vi) => {
                          const p = getVariantPricing(v, item.productId);
                          const overrideKey = v.id || item.productId;
                          return (
                            <tr
                              key={v.id || `${item.productId}-v${vi}`}
                              className={`transition ${item.isSuggestion ? 'border-l-2 border-l-teal-400' : ''} ${isSelected ? 'bg-teal-50/30' : 'bg-gray-50/30'}`}
                            >
                              <td className="pl-4 pr-2 py-2"></td>
                              <td className="pl-12 pr-3 py-2">
                                <div className="flex items-center gap-2">
                                  {v.size && (
                                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded border border-indigo-100">
                                      ⚖ {v.size}
                                    </span>
                                  )}
                                  {v.sku && <span className="text-xs text-gray-400 font-mono">{v.sku}</span>}
                                  {v.store?.name && <span className="text-xs text-gray-400">· {v.store.name}</span>}
                                  {p.priceChanged && (
                                    <span title="Price changed — flagged for export">
                                      <ExportFlag className="w-3 h-3 text-orange-500" />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-2 py-2"></td>
                              <td className="px-2 py-2"></td>
                              <td className={`px-2 py-2 text-right font-mono text-xs ${isSelected ? 'text-gray-600' : 'text-gray-400'}`}>
                                {p.currentCost != null ? money(p.currentCost) : '—'}
                              </td>
                              <td className={`px-2 py-2 text-right font-mono text-xs ${isSelected ? 'text-gray-600' : 'text-gray-400'}`}>
                                {p.sellPrice != null ? money(p.sellPrice) : '—'}
                              </td>
                              <td className={`px-2 py-2 text-right font-mono text-xs ${isSelected ? '' : 'text-gray-400'}`}>
                                {p.currentMarginPct != null ? (
                                  marginMode === 'pct' ? `${p.currentMarginPct.toFixed(1)}%` : money(p.currentMarginDol)
                                ) : '—'}
                              </td>
                              <td className={`px-2 py-2 text-right font-mono text-xs font-medium ${
                                p.costChange != null && p.costChange > 0 ? 'text-red-600' : p.costChange != null && p.costChange < 0 ? 'text-emerald-600' : isSelected ? 'text-gray-600' : 'text-gray-400'
                              }`}>{p.newCost != null ? money(p.newCost) : '—'}</td>
                              <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                {p.defaultSellPrice != null ? (
                                  <input type="number" step="0.01" defaultValue={p.effectiveSellPrice?.toFixed(2)}
                                    key={`sell-${overrideKey}-${p.effectiveSellPrice}`}
                                    className={`w-20 text-right font-mono px-1.5 py-1 border rounded text-xs focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${
                                      p.priceChanged ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white'
                                    }`}
                                    onBlur={(e) => { const val = parseFloat(e.target.value); if (!isNaN(val)) handleSellPriceChange(overrideKey, val); }}
                                  />
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                              <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                {p.newMarginPct != null ? (
                                  <input type="number" step={marginMode === 'pct' ? '0.1' : '0.01'}
                                    key={`margin-${overrideKey}-${marginMode}-${p.effectiveSellPrice}`}
                                    defaultValue={marginMode === 'pct' ? p.newMarginPct.toFixed(1) : p.newMarginDol?.toFixed(2)}
                                    className={`w-20 text-right font-mono px-1.5 py-1 border border-gray-200 bg-white rounded text-xs focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${
                                      marginMode === 'pct'
                                        ? (p.newMarginPct >= 25 ? 'text-emerald-600' : p.newMarginPct >= 10 ? 'text-amber-600' : 'text-red-600')
                                        : 'text-gray-700'
                                    }`}
                                    onBlur={(e) => { const val = parseFloat(e.target.value); if (!isNaN(val)) handleMarginChange(overrideKey, val, p.newCost); }}
                                  />
                                ) : '—'}
                              </td>
                              <td className="px-2 py-2 text-center">
                                {p.costChange != null && p.costChange !== 0 ? (
                                  <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${p.costChange > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                                    {p.costChange > 0 ? '+' : ''}{p.costChange.toFixed(1)}%
                                  </span>
                                ) : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="px-5 py-3 bg-white border-t border-gray-200 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={saveMapping}
            onChange={(e) => setSaveMapping(e.target.checked)}
            className="rounded border-gray-300 text-teal-600"
          />
          Save this mapping for future invoices from {invoice.supplierName || 'this supplier'}
        </label>
        <div className="flex items-center gap-3">
          {Object.keys(priceOverrides).length > 0 && (
            <span className="flex items-center gap-1 text-xs text-orange-600">
              <ExportFlag className="w-3.5 h-3.5" />
              {Object.keys(priceOverrides).length} price{Object.keys(priceOverrides).length !== 1 ? 's' : ''} changed — will flag for export
            </span>
          )}
          {selectedProductIds.size > 0 && (
            <span className="text-xs text-gray-500">{selectedProductIds.size} product{selectedProductIds.size !== 1 ? 's' : ''} selected</span>
          )}
          <button
            onClick={handleConfirm}
            disabled={selectedProductIds.size === 0 || confirming || isConfirmed}
            className={`px-5 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 flex items-center gap-2 ${
              isConfirmed ? 'bg-emerald-600 cursor-default' : 'bg-teal-600 hover:bg-teal-700'
            }`}
          >
            <Check className="w-4 h-4" />
            {isConfirmed ? 'Confirmed' : confirming ? 'Matching...' : `Confirm Match${selectedProductIds.size > 1 ? 'es' : ''} & Continue`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Line item row (expandable) ────────────────────────────────
function LineItemRow({ line, invoice, stores, storeColorMap, expanded, onToggle, onConfirmMatch, onApproveLine, onPriceUpdate }) {
  const hasMatches = line.matches && line.matches.length > 0;
  const bestConfidence = hasMatches ? Math.max(...line.matches.map((m) => m.confidence)) : 0;
  const isLowConfidence = bestConfidence < 0.8;
  const isApproved = line.status === 'APPROVED';
  const isNeedsReview = line.status === 'NEEDS_REVIEW' || line.status === 'PENDING';

  // Get unique stores that have matches (skip product-level matches with no variant)
  const matchedStoreIds = useMemo(() => {
    if (!hasMatches) return [];
    return [...new Set(line.matches.filter((m) => m.productVariant?.storeId).map((m) => m.productVariant.storeId))];
  }, [line.matches, hasMatches]);

  const baseUnitCost = line.baseUnitCost || line.unitPrice;

  return (
    <div className={`bg-white rounded-xl overflow-hidden ${
      isNeedsReview && isLowConfidence ? 'border-2 border-amber-400 shadow-sm' : 'border border-gray-200'
    }`}>
      {/* Collapsed header */}
      <div
        className={`px-5 py-3 flex items-center justify-between cursor-pointer transition ${
          isNeedsReview ? 'hover:bg-amber-50/50' : 'hover:bg-gray-50'
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-4">
          <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
          <div>
            <div className="font-medium text-sm">{line.description}</div>
            <div className="text-xs text-gray-500">
              {line.packSize && <>Pack: {line.packSize} &nbsp;|&nbsp; </>}
              Qty: {line.quantity} &nbsp;|&nbsp; Unit: {money(line.unitPrice)}
              {baseUnitCost && line.baseUnit && (
                <> &nbsp;|&nbsp; <span className="font-medium text-teal-700">Landed cost: {money(baseUnitCost)}/{line.baseUnit}</span></>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Store dots */}
          <div className="flex gap-1">
            {matchedStoreIds.map((sid) => {
              const sc = storeColorMap[sid];
              return <span key={sid} className={`w-2 h-2 ${sc?.dot || 'bg-gray-400'} rounded-full mt-1.5`} />;
            })}
          </div>
          {hasMatches && <span className="text-xs text-gray-500">{line.matches.length} SKU{line.matches.length !== 1 ? 's' : ''}</span>}
          {hasMatches && (
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              bestConfidence >= 0.8 ? 'bg-emerald-100 text-emerald-700' :
              bestConfidence >= 0.5 ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-700'
            }`}>
              {bestConfidence >= 0.8 ? 'High' : bestConfidence >= 0.5 ? `${Math.round(bestConfidence * 100)}%` : 'Low'}
            </span>
          )}
          <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
            isApproved ? 'bg-emerald-100 text-emerald-700' :
            isNeedsReview ? 'bg-red-100 text-red-700' :
            line.status === 'MATCHED' ? 'bg-amber-100 text-amber-700' :
            line.status === 'HELD' ? 'bg-gray-100 text-gray-600' :
            line.status === 'FLAGGED' ? 'bg-red-100 text-red-700' :
            'bg-gray-100 text-gray-500'
          }`}>
            {line.status === 'NEEDS_REVIEW' ? 'Needs Review' : line.status === 'MATCHED' ? 'Pending' : line.status}
          </span>
        </div>
      </div>

      {/* Expanded detail — always show MatchResolutionPanel so users can view/update */}
      {expanded && (
        <MatchResolutionPanel
          line={line}
          invoice={invoice}
          stores={stores}
          storeColorMap={storeColorMap}
          onConfirmMatch={onConfirmMatch}
        />
      )}
    </div>
  );
}

// ── Step 3: Approval Summary ──────────────────────────────────
function ApprovalSummary({ invoice, onGoToItem, onApproveAnyway, onBack, onConfirmExports, onPriceUpdate }) {
  const lines = invoice.lines || [];

  const approvedLines = lines.filter((l) => l.status === 'APPROVED');
  const reviewLines = lines.filter((l) => ['NEEDS_REVIEW', 'PENDING', 'MATCHED', 'FLAGGED'].includes(l.status));

  // Calculate metrics
  const totalMatches = approvedLines.reduce((sum, l) => sum + (l.matches?.length || 0), 0);

  const allApprovedMatches = approvedLines.flatMap((l) => l.matches || []);
  const avgCostChange = allApprovedMatches.length > 0
    ? allApprovedMatches.reduce((sum, m) => {
        if (!m.previousCost || m.previousCost === 0) return sum;
        return sum + ((m.newCost - m.previousCost) / m.previousCost) * 100;
      }, 0) / allApprovedMatches.length
    : 0;

  const avgMargin = allApprovedMatches.length > 0
    ? allApprovedMatches.reduce((sum, m) => {
        const price = m.approvedPrice || m.suggestedPrice || m.currentPrice;
        if (!price || price === 0) return sum;
        return sum + ((price - m.newCost) / price) * 100;
      }, 0) / allApprovedMatches.length
    : 0;

  const storeCount = new Set(allApprovedMatches.map((m) => m.productVariant?.storeId).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Approval Summary</h2>
        <p className="text-sm text-gray-500">Review all changes before confirming — {invoice.invoiceNumber || 'Invoice'}. Click any price to adjust it.</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Line Items</div>
          <div className="text-2xl font-bold mt-1">{lines.length}</div>
          <div className="text-xs text-gray-400 mt-1">{approvedLines.length} approved &middot; {reviewLines.length} needs review</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">SKUs Affected</div>
          <div className="text-2xl font-bold mt-1">{totalMatches}</div>
          <div className="text-xs text-gray-400 mt-1">Across {storeCount} store{storeCount !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Avg Cost Change</div>
          <div className={`text-2xl font-bold mt-1 ${avgCostChange > 0 ? 'text-red-600' : avgCostChange < 0 ? 'text-emerald-600' : ''}`}>
            {avgCostChange > 0 ? '+' : ''}{avgCostChange.toFixed(1)}%
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-sm text-gray-500">Avg Projected Margin</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1">{avgMargin.toFixed(1)}%</div>
        </div>
      </div>

      {/* Approved items — expanded detail with editable prices */}
      {approvedLines.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
            <Check className="w-5 h-5 text-emerald-600" />
            <span className="font-semibold text-sm">Approved — {approvedLines.length} line item{approvedLines.length !== 1 ? 's' : ''}, {totalMatches} SKU{totalMatches !== 1 ? 's' : ''}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100 bg-gray-50">
                  <th className="px-5 py-2.5">Invoice Item</th>
                  <th className="px-3 py-2.5">Product / SKU</th>
                  <th className="px-3 py-2.5 text-right">Prev Cost</th>
                  <th className="px-3 py-2.5 text-right">New Cost</th>
                  <th className="px-3 py-2.5 text-right">Curr Price</th>
                  <th className="px-3 py-2.5 text-right">New Price</th>
                  <th className="px-3 py-2.5 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {approvedLines.map((line) => {
                  const matches = line.matches || [];
                  return matches.map((m, mi) => {
                    const productName = m.productVariant?.product?.name || m.product?.name || '—';
                    const sku = m.productVariant?.sku || m.product?.barcode || '';
                    const storeName = m.productVariant?.store?.name;
                    const size = m.productVariant?.size;
                    const newPrice = m.approvedPrice ?? m.suggestedPrice ?? m.currentPrice;
                    const margin = newPrice && m.newCost ? ((newPrice - m.newCost) / newPrice * 100) : null;
                    return (
                      <tr key={m.id} className={mi === 0 ? 'border-t border-gray-200' : ''}>
                        {mi === 0 ? (
                          <td className="px-5 py-2.5 font-medium align-top" rowSpan={matches.length}>
                            <div>{line.description}</div>
                            <div className="text-xs text-gray-400 font-normal">{line.packSize || ''}</div>
                          </td>
                        ) : null}
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-gray-900 text-xs">{productName}</div>
                          <div className="text-[10px] text-gray-400 flex items-center gap-1">
                            {sku && <span className="font-mono">{sku}</span>}
                            {size && <span className="px-1 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px]">{size}</span>}
                            {storeName && <span>· {storeName}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-500 text-xs">{money(m.previousCost)}</td>
                        <td className={`px-3 py-2.5 text-right font-mono text-xs font-medium ${
                          m.newCost > (m.previousCost || 0) ? 'text-red-600' : m.newCost < (m.previousCost || 0) ? 'text-emerald-600' : 'text-gray-700'
                        }`}>{money(m.newCost)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-gray-500 text-xs">{money(m.currentPrice)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={newPrice?.toFixed(2)}
                            key={`summary-price-${m.id}-${newPrice}`}
                            className="w-20 text-right font-mono px-1.5 py-1 border border-gray-200 bg-white rounded text-xs focus:ring-2 focus:ring-teal-500 focus:border-teal-500 hover:border-teal-400"
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val > 0 && val !== newPrice) {
                                onPriceUpdate(invoice.id, line.id, m.id, val);
                              }
                            }}
                          />
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono text-xs font-medium ${
                          margin != null ? (margin >= 25 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-red-600') : 'text-gray-400'
                        }`}>
                          {margin != null ? `${margin.toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Needs review */}
      {reviewLines.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-300">
          <div className="px-5 py-3 border-b border-amber-200 flex items-center gap-2 bg-amber-50 rounded-t-xl">
            <Warning className="w-5 h-5 text-amber-600" />
            <span className="font-semibold text-sm text-amber-800">Needs Review — {reviewLines.length} item{reviewLines.length !== 1 ? 's' : ''}</span>
          </div>
          {reviewLines.map((line) => (
            <div key={line.id} className="px-5 py-3 flex items-center justify-between border-b border-gray-100 last:border-0">
              <div>
                <div className="font-medium text-sm">{line.description}</div>
                <div className="text-xs text-gray-500">Verify product mapping before approval</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onGoToItem(line.id)}
                  className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100"
                >
                  Go to item
                </button>
                <button
                  onClick={() => onApproveAnyway(line.id)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700"
                >
                  Approve anyway
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Matching
        </button>
        <button
          onClick={onConfirmExports}
          className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center gap-2"
        >
          Confirm & Generate Exports
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Export panel ───────────────────────────────────────
function ExportPanel({ invoice, exportData, onDone, navigate }) {
  function downloadCSV(storeExport) {
    const headers = ['SKU', 'Product', 'Size', 'Previous Cost', 'New Cost', 'Current Price', 'New Price', 'Shelf Location'];
    const rows = storeExport.items.map((item) =>
      [item.sku, item.productName, item.size || '', item.previousCost, item.newCost, item.currentPrice, item.newPrice, item.shelfLocation || ''].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${storeExport.store.name.replace(/[^a-zA-Z0-9]/g, '_')}-price-update.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalItems = exportData?.stores?.reduce((sum, s) => sum + s.items.length, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Success banner */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 flex items-start gap-4">
        <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
          <Check className="w-6 h-6 text-emerald-600" />
        </div>
        <div>
          <h2 className="font-semibold text-emerald-900">Invoice Approved Successfully</h2>
          <p className="text-sm text-emerald-700 mt-1">
            {invoice.invoiceNumber || 'Invoice'} from {invoice.supplierName || 'supplier'} — {totalItems} price update{totalItems !== 1 ? 's' : ''} generated across {exportData?.stores?.length || 0} store{exportData?.stores?.length !== 1 ? 's' : ''}.
          </p>
        </div>
      </div>

      {/* Per-store export cards */}
      <div className="grid grid-cols-2 gap-6">
        {(exportData?.stores || []).map((storeExport, i) => {
          const color = STORE_COLORS[i % STORE_COLORS.length];
          return (
            <div key={storeExport.store.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`px-5 py-3 ${color.headerBg} border-b ${color.headerBorder} flex items-center gap-2`}>
                <Store className={`w-5 h-5 ${color.btnText}`} />
                <div>
                  <div className={`font-semibold text-sm ${color.headerText}`}>{storeExport.store.name}</div>
                  <div className={`text-xs ${color.btnText}`}>
                    {storeExport.store.platform || 'Store'} &middot; {storeExport.items.length} product{storeExport.items.length !== 1 ? 's' : ''} updated
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <button
                  onClick={() => downloadCSV(storeExport)}
                  className="w-full px-3 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download CSV
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Audit record */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex items-center gap-3 text-sm text-gray-600">
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <span>
          Audit record created: Invoice <strong>{invoice.invoiceNumber || invoice.id}</strong> approved on{' '}
          <strong>{new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
        </span>
      </div>

      {/* Done / Full Export buttons */}
      <div className="flex justify-between">
        <button
          onClick={() => navigate(`/export?invoiceId=${invoice.id}`)}
          className="px-5 py-2.5 text-sm font-medium text-teal-700 bg-teal-50 rounded-lg hover:bg-teal-100 transition flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Go to Full Export
        </button>
        <button
          onClick={onDone}
          className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition"
        >
          Done — Return to Invoices
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ── MAIN REVIEW PAGE ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════════

export default function Review() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState(2);
  const [invoice, setInvoice] = useState(null);
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState(null);
  const [expandedLines, setExpandedLines] = useState(new Set());
  const [approving, setApproving] = useState(false);
  const [exportData, setExportData] = useState(null);

  // If no invoiceId, show a placeholder
  if (!invoiceId) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Invoice Review</h2>
        <p className="text-sm text-gray-500">Select an invoice from the Invoices page to begin review.</p>
      </div>
    );
  }

  // Store color map
  const storeColorMap = useMemo(() => {
    const map = {};
    stores.forEach((store, i) => {
      map[store.id] = STORE_COLORS[i % STORE_COLORS.length];
    });
    return map;
  }, [stores]);

  // ── Load invoice + stores + auto-match ──
  useEffect(() => {
    let cancelled = false; // Prevent duplicate calls from React StrictMode
    async function load() {
      try {
        const [inv, storeList] = await Promise.all([
          api.getInvoice(invoiceId),
          api.getStores(),
        ]);
        if (cancelled) return;
        setInvoice(inv);
        setStores(storeList);

        // If no matches exist yet, auto-run matching
        const hasMatches = inv.lines?.some((l) => l.matches?.length > 0);
        if (!hasMatches && inv.lines?.length > 0) {
          setMatching(true);
          try {
            const matched = await api.runMatching(invoiceId);
            if (cancelled) return;
            setInvoice(matched);
            // Auto-expand lines that need review
            const needsReview = new Set();
            matched.lines?.forEach((l) => {
              if (l.status === 'NEEDS_REVIEW') needsReview.add(l.id);
            });
            setExpandedLines(needsReview);
          } catch (matchErr) {
            if (!cancelled) console.error('Auto-matching failed:', matchErr);
          } finally {
            if (!cancelled) setMatching(false);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [invoiceId]);

  // ── Handlers ──
  const toggleLine = useCallback((lineId) => {
    setExpandedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }, []);

  const handleConfirmMatch = useCallback(async (lineId, productIds, saveMapping, variantPriceOverrides) => {
    try {
      // Support both single ID (string) and array of IDs
      const ids = Array.isArray(productIds) ? productIds : [productIds];
      const payload = { productIds: ids, saveMapping };
      // Include variant-level price overrides if any sell prices were changed
      if (variantPriceOverrides && Object.keys(variantPriceOverrides).length > 0) {
        payload.variantPriceOverrides = variantPriceOverrides;
      }
      const updatedLine = await api.setLineMatch(invoiceId, lineId, payload);
      setInvoice((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.id === lineId ? updatedLine : l)),
      }));
    } catch (err) {
      setError(err.message);
    }
  }, [invoiceId]);

  const handleApproveLine = useCallback(async (lineId, status) => {
    try {
      const updatedLine = await api.confirmLine(invoiceId, lineId, { status });
      setInvoice((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.id === lineId ? updatedLine : l)),
      }));
    } catch (err) {
      setError(err.message);
    }
  }, [invoiceId]);

  const handlePriceUpdate = useCallback(async (invId, lineId, matchId, price) => {
    try {
      await api.updateMatch(invId, lineId, matchId, { approvedPrice: price });
      // Update local state
      setInvoice((prev) => ({
        ...prev,
        lines: prev.lines.map((l) =>
          l.id === lineId
            ? { ...l, matches: l.matches.map((m) => (m.id === matchId ? { ...m, approvedPrice: price } : m)) }
            : l
        ),
      }));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const handleApproveAll = useCallback(async () => {
    for (const line of invoice.lines) {
      if (line.status !== 'APPROVED' && line.matches?.length > 0) {
        await handleApproveLine(line.id, 'APPROVED');
      }
    }
  }, [invoice, handleApproveLine]);

  const handleGoToItem = useCallback((lineId) => {
    setStep(2);
    setExpandedLines(new Set([lineId]));
  }, []);

  const handleApproveAnyway = useCallback(async (lineId) => {
    await handleApproveLine(lineId, 'APPROVED');
  }, [handleApproveLine]);

  const handleConfirmExports = useCallback(async () => {
    setApproving(true);
    try {
      await api.approveInvoice(invoiceId);
      const data = await api.getExportData(invoiceId);
      setExportData(data);
      // Refresh invoice
      const updated = await api.getInvoice(invoiceId);
      setInvoice(updated);
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  }, [invoiceId]);

  // ── Render ──
  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading invoice...</div>;
  }

  if (error && !invoice) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    );
  }

  if (!invoice) return null;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <WorkflowBreadcrumb step={2} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/invoices')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-semibold">Invoice Review</h2>
            <p className="text-sm text-gray-500">
              {invoice.supplierName || 'Unknown'} — {invoice.invoiceNumber || 'Invoice'} — {invoice.lines?.length || 0} line items
            </p>
          </div>
        </div>
        <StepProgress step={step} />
      </div>

      {/* GST & Freight info bar */}
      {(invoice.gst != null || (invoice.freight != null && invoice.freight > 0)) && (
        <div className="flex items-center gap-5 text-sm bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
          {invoice.gst != null && invoice.gst > 0 && (
            <label className="flex items-center gap-2 text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={invoice.gstInclusive || false}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                onChange={async (e) => {
                  const checked = e.target.checked;
                  await api.updateInvoice(invoiceId, { gstInclusive: checked });
                  const updated = await api.reallocateCosts(invoiceId);
                  setInvoice(updated);
                }}
              />
              Line prices include GST
            </label>
          )}
          {invoice.gst != null && <span className="text-gray-500">GST: <span className="font-medium text-gray-700">{money(invoice.gst)}</span></span>}
          {invoice.freight != null && invoice.freight > 0 && (
            <span className="text-gray-500">Freight: <span className="font-medium text-gray-700">{money(invoice.freight)}</span></span>
          )}
          {invoice.subtotal != null && <span className="text-gray-500">Subtotal: <span className="font-medium text-gray-700">{money(invoice.subtotal)}</span></span>}
          {invoice.total != null && <span className="text-gray-500">Total: <span className="font-medium text-gray-700">{money(invoice.total)}</span></span>}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {matching && (
        <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-3 text-sm text-teal-700 flex items-center gap-2">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Running auto-matching engine...
        </div>
      )}

      {/* Step 2: Match & Price */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Store legend + actions */}
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-xs flex-wrap">
              {stores.length > 1 && stores.map((store, i) => {
                const sc = STORE_COLORS[i % STORE_COLORS.length];
                return (
                  <span key={store.id} className={`flex items-center gap-1.5 px-3 py-1.5 ${sc.bg} ${sc.text} rounded-full font-medium`}>
                    <span className={`w-2 h-2 ${sc.dot} rounded-full`} />
                    {store.type === 'POS' ? 'POS' : 'Ecom'}: {store.name}
                  </span>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (expandedLines.size === invoice.lines.length) {
                    setExpandedLines(new Set());
                  } else {
                    setExpandedLines(new Set(invoice.lines.map((l) => l.id)));
                  }
                }}
                className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200"
              >
                {expandedLines.size === invoice.lines?.length ? 'Collapse All' : 'Expand All'}
              </button>
              <button
                onClick={handleApproveAll}
                className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700"
              >
                Approve All Lines
              </button>
            </div>
          </div>

          {/* Line items */}
          {(invoice.lines || []).map((line) => (
            <LineItemRow
              key={line.id}
              line={line}
              invoice={invoice}
              stores={stores}
              storeColorMap={storeColorMap}
              expanded={expandedLines.has(line.id)}
              onToggle={() => toggleLine(line.id)}
              onConfirmMatch={handleConfirmMatch}
              onApproveLine={handleApproveLine}
              onPriceUpdate={handlePriceUpdate}
            />
          ))}

          {/* Navigation */}
          <div className="flex justify-end">
            <button
              onClick={() => setStep(3)}
              className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center gap-2"
            >
              Continue to Summary
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Approval Summary */}
      {step === 3 && (
        <ApprovalSummary
          invoice={invoice}
          onGoToItem={handleGoToItem}
          onApproveAnyway={handleApproveAnyway}
          onBack={() => setStep(2)}
          onConfirmExports={handleConfirmExports}
          onPriceUpdate={handlePriceUpdate}
        />
      )}

      {/* Step 4: Export */}
      {step === 4 && (
        <ExportPanel
          invoice={invoice}
          exportData={exportData}
          onDone={() => navigate('/invoices')}
          navigate={navigate}
        />
      )}

      {approving && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 shadow-xl flex items-center gap-3">
            <svg className="animate-spin w-5 h-5 text-teal-600" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">Approving invoice and updating prices...</span>
          </div>
        </div>
      )}
    </div>
  );
}
