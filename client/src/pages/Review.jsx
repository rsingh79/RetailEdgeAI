import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import WorkflowBreadcrumb from '../components/layout/WorkflowBreadcrumb';

// ── Store color palette ───────────────────────────────────────
const STORE_COLORS = [
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', headerBg: 'bg-blue-50', headerBorder: 'border-blue-200', headerText: 'text-blue-800', dot: 'bg-blue-500', btnText: 'text-blue-600', pushBg: 'bg-blue-600', pushHover: 'hover:bg-blue-700' },
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', headerBg: 'bg-violet-50', headerBorder: 'border-violet-200', headerText: 'text-violet-800', dot: 'bg-violet-500', btnText: 'text-violet-600', pushBg: 'bg-violet-600', pushHover: 'hover:bg-violet-700' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', headerBg: 'bg-emerald-50', headerBorder: 'border-emerald-200', headerText: 'text-emerald-800', dot: 'bg-emerald-500', btnText: 'text-emerald-600', pushBg: 'bg-emerald-600', pushHover: 'hover:bg-emerald-700' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', headerBg: 'bg-rose-50', headerBorder: 'border-rose-200', headerText: 'text-rose-800', dot: 'bg-rose-500', btnText: 'text-rose-600', pushBg: 'bg-rose-600', pushHover: 'hover:bg-rose-700' },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', headerBg: 'bg-orange-50', headerBorder: 'border-orange-200', headerText: 'text-orange-800', dot: 'bg-orange-500', btnText: 'text-orange-600', pushBg: 'bg-orange-600', pushHover: 'hover:bg-orange-700' },
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
const Upload = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
);
const Store = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.15c0 .415.336.75.75.75z" /></svg>
);
const XMark = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
);
const Lightning = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
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

// ── Step progress bar (4 steps) ──────────────────────────────
function StepProgress({ step }) {
  const steps = [
    { num: 1, label: 'OCR & Extract' },
    { num: 2, label: 'Match & Price' },
    { num: 3, label: 'Review & Approve' },
    { num: 4, label: 'Export & Push' },
  ];
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          {i > 0 && <div className={`w-8 h-px ${s.num <= step ? 'bg-teal-500' : 'bg-gray-300'}`} />}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
            s.num < step ? 'bg-teal-100 text-teal-700' :
            s.num === step ? 'bg-teal-600 text-white' :
            'bg-gray-100 text-gray-500'
          }`}>
            {s.num < step ? <Check className="w-3.5 h-3.5" /> : null}
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Export flag icon ──────────────────────────────────────────
const ExportFlag = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5" /></svg>
);

// ── OCR & Extract Panel (Step 1) ─────────────────────────────
function OCRExtractPanel({ invoice, onProceed }) {
  const lines = invoice.lines || [];
  const ocrConfidence = invoice.ocrConfidence || 97;

  return (
    <div className="space-y-4">
      {/* AI Processing Summary */}
      <div className="bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200 rounded-xl p-4 flex items-center gap-4">
        <div className="w-12 h-12 bg-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xl">🤖</span>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-teal-900 text-sm">AI Ingestion Agent completed processing</h3>
          <p className="text-sm text-teal-700 mt-0.5">
            Extracted {lines.length} line items from invoice
            {invoice.supplierName ? ` · Supplier matched: ${invoice.supplierName}` : ''}
            {` · OCR confidence: ${ocrConfidence}%`}
            {invoice.gstInclusive != null ? ` · GST: ${invoice.gstInclusive ? 'Inclusive' : 'Exclusive'}` : ''}
            {invoice.freight > 0 ? ` · Freight: ${money(invoice.freight)} allocated proportionally` : ''}
          </p>
        </div>
        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium flex-shrink-0">✓ Auto-processed</span>
      </div>

      <div className="grid grid-cols-5 gap-6">
        {/* Invoice Preview (2 cols) */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-sm">Invoice PDF</h3>
            {invoice.fileUrl && (
              <a href={invoice.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-teal-600 hover:text-teal-700 font-medium">Open Full Size ↗</a>
            )}
          </div>
          <div className="bg-gray-100 p-6 min-h-[400px]">
            {invoice.fileUrl ? (
              <img src={invoice.fileUrl} alt="Invoice" className="w-full rounded shadow" />
            ) : (
              <div className="bg-white rounded shadow p-6 text-xs space-y-4 font-mono">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-sm">{invoice.supplierName || 'SUPPLIER'}</div>
                    <div className="text-gray-500">Invoice document</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg text-teal-700">INVOICE</div>
                    <div className="mt-1">Invoice #: <strong>{invoice.invoiceNumber || '—'}</strong></div>
                    <div>Date: <strong>{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : '—'}</strong></div>
                  </div>
                </div>
                <table className="w-full text-[10px] mt-3">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="text-left px-2 py-1">Description</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-right">Unit</th>
                      <th className="px-2 py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.slice(0, 5).map((line) => (
                      <tr key={line.id} className="border-t">
                        <td className="px-2 py-1">{line.description}</td>
                        <td className="px-2 py-1 text-right">{line.quantity}</td>
                        <td className="px-2 py-1 text-right">{money(line.unitPrice)}</td>
                        <td className="px-2 py-1 text-right">{money(line.lineTotal)}</td>
                      </tr>
                    ))}
                    {lines.length > 5 && (
                      <tr className="border-t text-gray-400"><td className="px-2 py-1" colSpan="4">... {lines.length - 5} more items</td></tr>
                    )}
                  </tbody>
                </table>
                <div className="border-t border-gray-300 pt-2 text-right space-y-1">
                  {invoice.subtotal != null && <div>Subtotal: <strong>{money(invoice.subtotal)}</strong></div>}
                  {invoice.freight > 0 && <div>Freight: <strong>{money(invoice.freight)}</strong></div>}
                  {invoice.gst > 0 && <div>GST: <strong>{money(invoice.gst)}</strong></div>}
                  {invoice.total != null && <div className="text-sm font-bold">Total: {money(invoice.total)}</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Extracted Data (3 cols) */}
        <div className="col-span-3 space-y-4">
          {/* Header Data */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold text-sm mb-3">Extracted Invoice Data</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">Supplier</div>
                <div className="font-medium text-sm">{invoice.supplierName || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Invoice Number</div>
                <div className="font-medium text-sm">#{invoice.invoiceNumber || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Invoice Date</div>
                <div className="font-medium text-sm">{invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : '—'}</div>
              </div>
              {invoice.subtotal != null && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Subtotal</div>
                  <div className="font-medium text-sm">{money(invoice.subtotal)}</div>
                </div>
              )}
              {invoice.gst != null && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">GST</div>
                  <div className="font-medium text-sm">{money(invoice.gst)} <span className="text-xs text-gray-400">({invoice.gstInclusive ? 'inclusive' : 'exclusive'})</span></div>
                </div>
              )}
              {invoice.total != null && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Total</div>
                  <div className="font-semibold text-sm text-teal-700">{money(invoice.total)}</div>
                </div>
              )}
              {invoice.freight != null && invoice.freight > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Freight</div>
                  <div className="font-medium text-sm">{money(invoice.freight)} <span className="text-xs text-gray-400">(proportional allocation)</span></div>
                </div>
              )}
              <div>
                <div className="text-xs text-gray-500 mb-1">OCR Confidence</div>
                <div className="font-medium text-sm flex items-center gap-1">
                  <span className={`w-2 h-2 ${ocrConfidence >= 90 ? 'bg-green-500' : ocrConfidence >= 70 ? 'bg-amber-500' : 'bg-red-500'} rounded-full`} />
                  {ocrConfidence}%
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Line Items</div>
                <div className="font-medium text-sm">{lines.length}</div>
              </div>
            </div>
          </div>

          {/* Extracted Lines */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Extracted Line Items ({lines.length})</h3>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-gray-500 uppercase">
                    <th className="text-left px-4 py-2 font-medium">#</th>
                    <th className="text-left px-4 py-2 font-medium">Description</th>
                    <th className="text-center px-4 py-2 font-medium">Qty</th>
                    <th className="text-right px-4 py-2 font-medium">Unit Price</th>
                    <th className="text-right px-4 py-2 font-medium">Line Total</th>
                    {invoice.freight > 0 && <th className="text-right px-4 py-2 font-medium">Landed Unit</th>}
                    <th className="text-center px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line, i) => (
                    <tr key={line.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{i + 1}</td>
                      <td className="px-4 py-2 font-medium">{line.description}</td>
                      <td className="px-4 py-2 text-center">{line.quantity}</td>
                      <td className="px-4 py-2 text-right font-mono">{money(line.unitPrice)}</td>
                      <td className="px-4 py-2 text-right font-mono">{money(line.lineTotal)}</td>
                      {invoice.freight > 0 && (
                        <td className="px-4 py-2 text-right font-mono font-medium">{line.baseUnitCost ? money(line.baseUnitCost) : '—'}</td>
                      )}
                      <td className="px-4 py-2 text-center">
                        <span className={`w-2 h-2 rounded-full inline-block ${
                          line.matches?.length > 0 && Math.max(...(line.matches || []).map(m => m.confidence || 0)) >= 0.9 ? 'bg-green-500' :
                          line.matches?.length > 0 ? 'bg-amber-500' : 'bg-gray-300'
                        }`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => window.history.back()}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={onProceed}
              className="px-6 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center gap-2"
            >
              Proceed to Matching & Pricing
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Match resolution panel (table-based, with pricing + AI Insight) ─
function MatchResolutionPanel({ line, invoice, stores, storeColorMap, onConfirmMatch, onApproveAndNext }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStoreFilter, setSearchStoreFilter] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const [saveMapping, setSaveMapping] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [priceOverrides, setPriceOverrides] = useState({});
  const [marginMode, setMarginMode] = useState('pct');

  const baseUnitCost = line.baseUnitCost || line.unitPrice;
  const bestConfidence = line.matches?.length > 0 ? Math.max(...line.matches.map(m => m.confidence || 0)) : 0;
  const isAutoMatched = bestConfidence >= 0.9;
  const isNeedsReview = bestConfidence > 0 && bestConfidence < 0.9;
  const isUnmatched = !line.matches || line.matches.length === 0;

  function toggleProduct(productId) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setIsConfirmed(false);
  }

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

  useEffect(() => {
    if (suggestions.length > 0 && selectedProductIds.size === 0) {
      setSelectedProductIds(new Set(suggestions.map((s) => s.productId)));
    }
  }, [suggestions]); // eslint-disable-line react-hooks/exhaustive-deps

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
    merged.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
    return merged;
  }, [suggestions, searchResults]);

  function handleSellPriceChange(variantKey, value) {
    setPriceOverrides((prev) => ({ ...prev, [variantKey]: value }));
    setIsConfirmed(false);
  }

  function handleMarginChange(variantKey, marginValue, newCost) {
    if (newCost == null || newCost === 0) return;
    let sellPrice;
    if (marginMode === 'pct') {
      if (marginValue >= 100) return;
      sellPrice = Math.round((newCost / (1 - marginValue / 100)) * 100) / 100;
    } else {
      sellPrice = Math.round((newCost + marginValue) * 100) / 100;
    }
    if (sellPrice > 0) {
      setPriceOverrides((prev) => ({ ...prev, [variantKey]: sellPrice }));
      setIsConfirmed(false);
    }
  }

  async function handleConfirm() {
    if (selectedProductIds.size === 0) return;
    setConfirming(true);
    try {
      const variantOverrides = {};
      for (const pid of selectedProductIds) {
        const item = allProducts.find((p) => p.productId === pid);
        if (!item) continue;
        for (const v of item.variants) {
          const key = v.id || pid;
          if (priceOverrides[key] != null) variantOverrides[key] = priceOverrides[key];
        }
      }
      await onConfirmMatch(line.id, [...selectedProductIds], saveMapping, variantOverrides);
      setIsConfirmed(true);
    } finally { setConfirming(false); }
  }

  async function handleApproveNext() {
    await handleConfirm();
    if (onApproveAndNext) onApproveAndNext(line.id);
  }

  function getVariantPricing(variant, productId) {
    const currentCost = variant.previousCost ?? variant.currentCost ?? null;
    const sellPrice = variant.currentPrice ?? variant.salePrice ?? null;
    const currentMarginPct = sellPrice && currentCost ? marginPct(sellPrice, currentCost) : null;
    const currentMarginDol = sellPrice && currentCost != null ? marginDollar(sellPrice, currentCost) : null;
    const newCost = variant.newCost ?? (baseUnitCost
      ? Math.round(baseUnitCost * (variant.unitQty || 1) * 100) / 100
      : null);
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

  // Determine border color based on intervention state
  const panelBorderClass = isAutoMatched ? 'border-t border-green-200 bg-green-50/20' :
    isNeedsReview ? 'border-t border-amber-300 bg-amber-50/20' :
    'border-t border-red-200 bg-red-50/20';

  return (
    <div className={panelBorderClass}>
      {/* Pack Conversion Info */}
      {baseUnitCost && line.packSize && (
        <div className="px-5 py-2.5 bg-blue-50/50 border-b border-gray-100 text-xs flex items-center gap-3">
          <span className="font-medium text-blue-800">Pack Conversion:</span>
          <span className="text-blue-700">
            Supplier: "{line.packSize}" @ {money(line.unitPrice)}/unit → Base unit: {line.baseUnit || 'unit'} → Landed cost: <strong>{money(baseUnitCost)}</strong> per unit
          </span>
        </div>
      )}

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
                              {p.priceChanged && <span title="Price changed"><ExportFlag className="w-3.5 h-3.5 text-orange-500" /></span>}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.category || '—'}
                              {item.barcode && <> &middot; {item.barcode}</>}
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            {item.source && (
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${item.source === 'POS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{item.source}</span>
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
                          <td className={`px-2 py-3 text-right font-mono ${isSelected ? 'text-gray-700' : 'text-gray-400'}`}>{p.currentCost != null ? money(p.currentCost) : '—'}</td>
                          <td className={`px-2 py-3 text-right font-mono ${isSelected ? 'text-gray-700' : 'text-gray-400'}`}>{p.sellPrice != null ? money(p.sellPrice) : '—'}</td>
                          <td className={`px-2 py-3 text-right font-mono ${isSelected ? '' : 'text-gray-400'}`}>
                            {p.currentMarginPct != null ? (marginMode === 'pct' ? `${p.currentMarginPct.toFixed(1)}%` : money(p.currentMarginDol)) : '—'}
                          </td>
                          <td className={`px-2 py-3 text-right font-mono font-medium ${
                            p.costChange != null && p.costChange > 0 ? 'text-red-600' : p.costChange != null && p.costChange < 0 ? 'text-emerald-600' : isSelected ? 'text-gray-700' : 'text-gray-400'
                          }`}>{p.newCost != null ? money(p.newCost) : '—'}</td>
                          <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            {p.defaultSellPrice != null ? (
                              <input type="number" step="0.01" defaultValue={p.effectiveSellPrice?.toFixed(2)}
                                key={`sell-${overrideKey}-${p.effectiveSellPrice}`}
                                className={`w-20 text-right font-mono px-1.5 py-1 border rounded text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${p.priceChanged ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white'}`}
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
                                  marginMode === 'pct' ? (p.newMarginPct >= 25 ? 'text-emerald-600' : p.newMarginPct >= 10 ? 'text-amber-600' : 'text-red-600') : 'text-gray-700'
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

                    return (
                      <React.Fragment key={item.productId}>
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
                              {anyVariantPriceChanged && <span title="Variant price(s) changed"><ExportFlag className="w-3.5 h-3.5 text-orange-500" /></span>}
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
                              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${item.source === 'POS' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{item.source}</span>
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
                          <td colSpan={7} className="px-2 py-3 text-center text-xs text-gray-500 italic">
                            {item.variants.length} variant{item.variants.length !== 1 ? 's' : ''}
                          </td>
                        </tr>
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
                                  {v.size && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded border border-indigo-100">⚖ {v.size}</span>}
                                  {v.sku && <span className="text-xs text-gray-400 font-mono">{v.sku}</span>}
                                  {v.store?.name && <span className="text-xs text-gray-400">· {v.store.name}</span>}
                                  {p.priceChanged && <span title="Price changed"><ExportFlag className="w-3 h-3 text-orange-500" /></span>}
                                </div>
                              </td>
                              <td className="px-2 py-2"></td>
                              <td className="px-2 py-2"></td>
                              <td className={`px-2 py-2 text-right font-mono text-xs ${isSelected ? 'text-gray-600' : 'text-gray-400'}`}>{p.currentCost != null ? money(p.currentCost) : '—'}</td>
                              <td className={`px-2 py-2 text-right font-mono text-xs ${isSelected ? 'text-gray-600' : 'text-gray-400'}`}>{p.sellPrice != null ? money(p.sellPrice) : '—'}</td>
                              <td className={`px-2 py-2 text-right font-mono text-xs ${isSelected ? '' : 'text-gray-400'}`}>
                                {p.currentMarginPct != null ? (marginMode === 'pct' ? `${p.currentMarginPct.toFixed(1)}%` : money(p.currentMarginDol)) : '—'}
                              </td>
                              <td className={`px-2 py-2 text-right font-mono text-xs font-medium ${
                                p.costChange != null && p.costChange > 0 ? 'text-red-600' : p.costChange != null && p.costChange < 0 ? 'text-emerald-600' : isSelected ? 'text-gray-600' : 'text-gray-400'
                              }`}>{p.newCost != null ? money(p.newCost) : '—'}</td>
                              <td className="px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                                {p.defaultSellPrice != null ? (
                                  <input type="number" step="0.01" defaultValue={p.effectiveSellPrice?.toFixed(2)}
                                    key={`sell-${overrideKey}-${p.effectiveSellPrice}`}
                                    className={`w-20 text-right font-mono px-1.5 py-1 border rounded text-xs focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${p.priceChanged ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-white'}`}
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
                                      marginMode === 'pct' ? (p.newMarginPct >= 25 ? 'text-emerald-600' : p.newMarginPct >= 10 ? 'text-amber-600' : 'text-red-600') : 'text-gray-700'
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

      {/* AI Pricing Insight */}
      {suggestions.length > 0 && (
        <div className="mx-5 mb-3 bg-gradient-to-r from-teal-50 to-emerald-50 border border-teal-200 rounded-lg p-3 flex items-start gap-3">
          <span className="text-lg flex-shrink-0">🤖</span>
          <div className="text-xs text-teal-800">
            <strong>AI Insight:</strong>{' '}
            {(() => {
              const avgCostChange = suggestions.reduce((sum, s) => {
                const changes = s.variants.map(v => {
                  const prev = v.previousCost ?? v.currentCost;
                  return prev && v.newCost ? ((v.newCost - prev) / prev) * 100 : 0;
                });
                return sum + (changes.length > 0 ? changes.reduce((a, b) => a + b, 0) / changes.length : 0);
              }, 0) / (suggestions.length || 1);
              const direction = avgCostChange > 0 ? 'increased' : avgCostChange < 0 ? 'decreased' : 'unchanged';
              return `Cost ${direction} ${Math.abs(avgCostChange).toFixed(1)}%.`;
            })()}{' '}
            {selectedProductIds.size > 0 && `${selectedProductIds.size} product${selectedProductIds.size !== 1 ? 's' : ''} selected for matching. `}
            {suggestions[0]?.matchReason && `Match reason: ${suggestions[0].matchReason}.`}
          </div>
        </div>
      )}

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
              {Object.keys(priceOverrides).length} price{Object.keys(priceOverrides).length !== 1 ? 's' : ''} changed
            </span>
          )}
          {selectedProductIds.size > 0 && (
            <span className="text-xs text-gray-500">{selectedProductIds.size} product{selectedProductIds.size !== 1 ? 's' : ''} selected</span>
          )}
          <button
            onClick={handleConfirm}
            disabled={selectedProductIds.size === 0 || confirming || isConfirmed}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 flex items-center gap-2 ${
              isConfirmed ? 'bg-emerald-600 cursor-default' : 'bg-teal-600 hover:bg-teal-700'
            }`}
          >
            <Check className="w-4 h-4" />
            {isConfirmed ? 'Confirmed' : confirming ? 'Matching...' : `Confirm Match${selectedProductIds.size > 1 ? 'es' : ''}`}
          </button>
          {onApproveAndNext && (
            <button
              onClick={handleApproveNext}
              disabled={selectedProductIds.size === 0 || confirming}
              className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              ✓ Approve & Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Line item row (expandable, with 3 intervention states) ───
function LineItemRow({ line, invoice, stores, storeColorMap, expanded, onToggle, onConfirmMatch, onApproveLine, onPriceUpdate, onApproveAndNext }) {
  const hasMatches = line.matches && line.matches.length > 0;
  const bestConfidence = hasMatches ? Math.max(...line.matches.map((m) => m.confidence)) : 0;
  const isAutoMatched = hasMatches && bestConfidence >= 0.9;
  const isNeedsReview = hasMatches && bestConfidence < 0.9;
  const isUnmatched = !hasMatches;
  const isApproved = line.status === 'APPROVED';

  const matchedStoreIds = useMemo(() => {
    if (!hasMatches) return [];
    return [...new Set(line.matches.filter((m) => m.productVariant?.storeId).map((m) => m.productVariant.storeId))];
  }, [line.matches, hasMatches]);

  const baseUnitCost = line.baseUnitCost || line.unitPrice;

  // Determine the primary match info for the collapsed view
  const primaryMatchName = hasMatches
    ? [...new Set(line.matches.map(m => m.productVariant?.product?.name || m.product?.name).filter(Boolean))].join(', ')
    : null;

  // Cost change for collapsed view
  const prevCost = hasMatches ? line.matches[0]?.previousCost : null;
  const newCost = hasMatches ? line.matches[0]?.newCost : null;
  const costChange = prevCost && newCost ? costChangePct(prevCost, newCost) : null;

  // Determine match reason badge text
  const matchReasonBadge = hasMatches ? (line.matches[0]?.matchReason || (bestConfidence >= 0.9 ? 'Learned' : 'AI fuzzy')) : null;

  // Border styling based on intervention state
  const borderClass = isApproved
    ? 'border border-green-300 opacity-80'
    : isAutoMatched
      ? 'border border-gray-200'
      : isNeedsReview
        ? 'border-2 border-amber-400 shadow-sm'
        : 'border-2 border-red-300 shadow-sm';

  const headerBgClass = isApproved
    ? 'bg-green-50/30'
    : isNeedsReview
      ? 'bg-amber-50/50'
      : isUnmatched
        ? 'bg-red-50/50'
        : '';

  return (
    <div className={`bg-white rounded-xl overflow-hidden ${borderClass}`}>
      {/* Collapsed header */}
      <div
        className={`px-5 py-3.5 flex items-center gap-4 cursor-pointer transition hover:bg-gray-50 ${headerBgClass}`}
        onClick={onToggle}
      >
        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-200 flex-shrink-0 ${expanded ? 'rotate-90' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{line.description}</span>
            <span className="text-xs text-gray-500">
              {line.packSize ? `${line.packSize} · ` : ''}
              {line.quantity && `× ${line.quantity} · `}
              {money(line.unitPrice)}/unit
              {baseUnitCost && baseUnitCost !== line.unitPrice && (
                <span className="font-mono text-gray-400"> → landed {money(baseUnitCost)}</span>
              )}
            </span>
            {isNeedsReview && (
              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-bold uppercase">Needs Your Input</span>
            )}
            {isUnmatched && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded text-[10px] font-bold uppercase">New Product</span>
            )}
          </div>
          {primaryMatchName && (
            <div className="text-xs text-gray-500 mt-0.5">
              Matched → <span className="font-medium text-gray-700">{primaryMatchName}</span>
            </div>
          )}
          {isNeedsReview && (
            <div className="text-xs text-amber-700 mt-0.5 font-medium">
              ⚠ AI found a probable match but confidence is below 90% — please confirm or select a different product
            </div>
          )}
          {isUnmatched && (
            <div className="text-xs text-red-700 mt-0.5 font-medium">
              ❌ No matching product found — search your catalog or create a new product
            </div>
          )}
        </div>

        {/* Store dots */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {matchedStoreIds.map((sid) => {
            const sc = storeColorMap[sid];
            return <span key={sid} className={`w-2.5 h-2.5 ${sc?.dot || 'bg-gray-400'} rounded-full`} />;
          })}
        </div>

        {/* Confidence badge */}
        {hasMatches && (
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
            bestConfidence >= 0.9 ? 'bg-green-50 text-green-700' :
            bestConfidence >= 0.5 ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
            {Math.round(bestConfidence * 100)}% · {matchReasonBadge}
          </span>
        )}

        {/* Cost change indicator */}
        {costChange != null && (
          <div className="flex items-center gap-1.5 flex-shrink-0 text-sm">
            <span className="text-gray-500">{money(prevCost)}</span>
            <ArrowRight className={`w-3 h-3 ${costChange > 0 ? 'text-red-500' : 'text-emerald-500'}`} />
            <span className={`font-semibold ${costChange > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{money(newCost)}</span>
            <span className={`text-xs ${costChange > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
              {costChange > 0 ? '+' : ''}{costChange.toFixed(1)}%
            </span>
          </div>
        )}

        {/* Status badge */}
        <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
          isApproved ? 'bg-green-100 text-green-700' :
          isAutoMatched ? 'bg-green-50 text-green-700' :
          isNeedsReview ? 'bg-red-50 text-red-700' :
          'bg-red-100 text-red-700'
        }`}>
          {isApproved ? '✓ Approved' : isAutoMatched ? '✓ Matched' : isNeedsReview ? '⬤ Needs Review' : '⬤ Unmatched'}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <MatchResolutionPanel
          line={line}
          invoice={invoice}
          stores={stores}
          storeColorMap={storeColorMap}
          onConfirmMatch={onConfirmMatch}
          onApproveAndNext={onApproveAndNext}
        />
      )}
    </div>
  );
}

// ── Step 3: Review & Approve (Approval Summary) ──────────────
function ApprovalSummary({ invoice, onGoToItem, onApproveAnyway, onBack, onConfirmExports, onPriceUpdate }) {
  const lines = invoice.lines || [];

  const approvedLines = lines.filter((l) => l.status === 'APPROVED');
  const reviewLines = lines.filter((l) => ['NEEDS_REVIEW', 'PENDING', 'MATCHED', 'FLAGGED'].includes(l.status));

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

  // Estimated weekly margin impact (simplified calculation)
  const weeklyImpact = allApprovedMatches.reduce((sum, m) => {
    const oldPrice = m.currentPrice || 0;
    const newPrice = m.approvedPrice || m.suggestedPrice || oldPrice;
    const priceDiff = newPrice - oldPrice;
    return sum + (priceDiff * 10); // Rough estimate: 10 units/week
  }, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Review & Approve</h2>
        <p className="text-sm text-gray-500">Review all changes before confirming — {invoice.invoiceNumber || 'Invoice'}. Click any price to adjust it.</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold">{lines.length}</div>
          <div className="text-xs text-gray-500 mt-1">Line Items</div>
          <div className="text-xs text-green-600 mt-1">{approvedLines.length} approved · {reviewLines.length} needs review</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold">{totalMatches}</div>
          <div className="text-xs text-gray-500 mt-1">SKUs Affected</div>
          <div className="text-xs text-gray-500 mt-1">Across {storeCount} store{storeCount !== 1 ? 's' : ''}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className={`text-2xl font-bold ${avgCostChange > 0 ? 'text-red-600' : avgCostChange < 0 ? 'text-emerald-600' : ''}`}>
            {avgCostChange > 0 ? '+' : ''}{avgCostChange.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">Avg Cost Change</div>
          {avgCostChange > 0 && <div className="text-xs text-red-600 mt-1">Supplier cost increases</div>}
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{avgMargin.toFixed(1)}%</div>
          <div className="text-xs text-gray-500 mt-1">Projected Avg Margin</div>
        </div>
      </div>

      {/* Approved items */}
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

      {/* Estimated Weekly Margin Impact */}
      {weeklyImpact !== 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-5 flex items-center gap-4">
          <div className="w-14 h-14 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-white text-2xl">📈</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-green-900">Estimated Weekly Margin Impact</h3>
            <p className="text-sm text-green-700 mt-0.5">Based on projected price changes across {storeCount} store{storeCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-3xl font-bold ${weeklyImpact >= 0 ? 'text-green-700' : 'text-red-700'}`}>
              {weeklyImpact >= 0 ? '+' : ''}{money(weeklyImpact)}
            </div>
            <div className="text-sm text-green-600">per week</div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Matching
        </button>
        <button
          onClick={onConfirmExports}
          className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 transition flex items-center gap-2"
        >
          Approve All & Continue to Export
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Export & Push panel ───────────────────────────────
function ExportPanel({ invoice, exportData, stores, storeColorMap, onDone, navigate }) {
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
  const priceChanges = exportData?.stores?.reduce((sum, s) => sum + s.items.filter(i => i.newPrice !== i.currentPrice).length, 0) || 0;

  return (
    <div className="space-y-6">
      {/* Success banner */}
      <div className="bg-green-600 rounded-xl p-5 text-white flex items-center gap-4">
        <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="text-3xl">✅</span>
        </div>
        <div>
          <h2 className="text-lg font-bold">Invoice {invoice.invoiceNumber || ''} Approved — Ready to Push</h2>
          <p className="text-green-100 mt-0.5">
            {invoice.lines?.length || 0} line items matched · {totalItems} SKUs updated · {priceChanges} price change{priceChanges !== 1 ? 's' : ''} across {exportData?.stores?.length || 0} store{exportData?.stores?.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Per-store push cards */}
      <div className="grid grid-cols-2 gap-4">
        {(exportData?.stores || []).map((storeExport, i) => {
          const color = STORE_COLORS[i % STORE_COLORS.length];
          const platform = storeExport.store.platform || storeExport.store.type || 'Store';
          return (
            <div key={storeExport.store.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`${color.pushBg} px-5 py-3 text-white flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 bg-white/50 rounded-full" />
                  <span className="font-semibold">{storeExport.store.name}</span>
                </div>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                  {storeExport.items.length} product{storeExport.items.length !== 1 ? 's' : ''} · {platform}
                </span>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex gap-2">
                  <button
                    className={`flex-1 px-4 py-2.5 ${color.pushBg} text-white rounded-lg text-sm font-medium ${color.pushHover} transition flex items-center justify-center gap-2`}
                    onClick={() => {
                      // Future: integrate with POS API
                      alert(`Push to ${platform} coming soon! For now, download the CSV.`);
                    }}
                  >
                    <Upload className="w-4 h-4" />
                    Push to {platform === 'POS' ? 'POS' : platform}
                  </button>
                  <button
                    onClick={() => downloadCSV(storeExport)}
                    className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                  >
                    CSV
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  {platform === 'POS'
                    ? 'Pushes cost and price updates directly to your POS catalog via API'
                    : 'Updates product prices on your store via API'
                  }
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Push All */}
      {(exportData?.stores?.length || 0) > 1 && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-teal-900">Push to all connected stores at once</h3>
            <p className="text-sm text-teal-700 mt-0.5">Updates prices on all connected stores simultaneously. Changes reflect within 30 seconds.</p>
          </div>
          <button
            className="px-6 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition flex items-center gap-2"
            onClick={() => alert('Push All coming soon! For now, download CSVs from each store.')}
          >
            <Lightning className="w-5 h-5" />
            Push All Stores Now
          </button>
        </div>
      )}

      {/* Audit record */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 flex items-center gap-3 text-sm text-gray-600">
        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
        <span>
          Invoice <strong>{invoice.invoiceNumber || invoice.id}</strong> approved on{' '}
          <strong>{new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })}</strong>
          {' · '}{totalItems} SKU{totalItems !== 1 ? 's' : ''} updated
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
  const lineRefs = useRef({});

  const [step, setStep] = useState(1);
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
    let cancelled = false;
    async function load() {
      try {
        const [inv, storeList] = await Promise.all([
          api.getInvoice(invoiceId),
          api.getStores(),
        ]);
        if (cancelled) return;
        setInvoice(inv);
        setStores(storeList);

        // If matches already exist, skip to step 2
        const hasMatches = inv.lines?.some((l) => l.matches?.length > 0);
        if (hasMatches) {
          setStep(2);
          // Auto-expand lines that need review
          const needsReview = new Set();
          inv.lines?.forEach((l) => {
            const best = l.matches?.length > 0 ? Math.max(...l.matches.map(m => m.confidence || 0)) : 0;
            if (l.status === 'NEEDS_REVIEW' || best < 0.9) needsReview.add(l.id);
            if (!l.matches || l.matches.length === 0) needsReview.add(l.id);
          });
          setExpandedLines(needsReview);
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
      const ids = Array.isArray(productIds) ? productIds : [productIds];
      const payload = { productIds: ids, saveMapping };
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
    // Scroll to the line after step transition
    setTimeout(() => {
      lineRefs.current[lineId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  const handleApproveAnyway = useCallback(async (lineId) => {
    await handleApproveLine(lineId, 'APPROVED');
  }, [handleApproveLine]);

  // Approve & Next: approve current line, collapse it, expand next unresolved
  const handleApproveAndNext = useCallback(async (lineId) => {
    // Approve the line
    await handleApproveLine(lineId, 'APPROVED');

    // Find the next line that needs attention
    const lines = invoice?.lines || [];
    const currentIndex = lines.findIndex(l => l.id === lineId);
    let nextLineId = null;
    for (let i = currentIndex + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.status !== 'APPROVED') {
        nextLineId = l.id;
        break;
      }
    }

    // Collapse current, expand next
    setExpandedLines((prev) => {
      const next = new Set(prev);
      next.delete(lineId);
      if (nextLineId) next.add(nextLineId);
      return next;
    });

    // Scroll to next line
    if (nextLineId) {
      setTimeout(() => {
        lineRefs.current[nextLineId]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
  }, [invoice, handleApproveLine]);

  const handleConfirmExports = useCallback(async () => {
    setApproving(true);
    try {
      await api.approveInvoice(invoiceId);
      const data = await api.getExportData(invoiceId);
      setExportData(data);
      const updated = await api.getInvoice(invoiceId);
      setInvoice(updated);
      setStep(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setApproving(false);
    }
  }, [invoiceId]);

  // Proceed from Step 1 to Step 2: run auto-matching
  const handleProceedToMatching = useCallback(async () => {
    setStep(2);
    setMatching(true);
    try {
      const matched = await api.runMatching(invoiceId);
      setInvoice(matched);
      // Auto-expand lines that need review or are unmatched
      const needsExpand = new Set();
      matched.lines?.forEach((l) => {
        const best = l.matches?.length > 0 ? Math.max(...l.matches.map(m => m.confidence || 0)) : 0;
        if (best < 0.9 || !l.matches || l.matches.length === 0) {
          needsExpand.add(l.id);
        }
      });
      setExpandedLines(needsExpand);
    } catch (matchErr) {
      console.error('Auto-matching failed:', matchErr);
      setError(matchErr.message);
    } finally {
      setMatching(false);
    }
  }, [invoiceId]);

  // ── Derived stats for Step 2 summary bar ──
  const lineStats = useMemo(() => {
    if (!invoice?.lines) return { autoMatched: 0, needsReview: 0, unmatched: 0 };
    let autoMatched = 0, needsReview = 0, unmatched = 0;
    for (const line of invoice.lines) {
      if (!line.matches || line.matches.length === 0) {
        unmatched++;
      } else {
        const best = Math.max(...line.matches.map(m => m.confidence || 0));
        if (best >= 0.9) autoMatched++;
        else needsReview++;
      }
    }
    return { autoMatched, needsReview, unmatched };
  }, [invoice?.lines]);

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
            <h2 className="text-lg font-semibold">Invoice Review — {invoice.invoiceNumber ? `#${invoice.invoiceNumber}` : 'Invoice'}</h2>
            <p className="text-sm text-gray-500">
              {invoice.supplierName || 'Unknown'} — {invoice.lines?.length || 0} line items
              {step >= 2 && invoice.lines?.length > 0 && (
                <span className="text-teal-600 font-medium ml-2">AI processed</span>
              )}
            </p>
          </div>
        </div>
        <StepProgress step={step} />
      </div>

      {/* GST & Freight info bar */}
      {step >= 2 && (invoice.gst != null || (invoice.freight != null && invoice.freight > 0)) && (
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
          Running AI matching engine — analyzing {invoice.lines?.length || 0} line items...
        </div>
      )}

      {/* ═══ Step 1: OCR & Extract ═══ */}
      {step === 1 && (
        <OCRExtractPanel
          invoice={invoice}
          onProceed={handleProceedToMatching}
        />
      )}

      {/* ═══ Step 2: Match & Price ═══ */}
      {step === 2 && (
        <div className="space-y-4">
          {/* AI Matching Summary Bar */}
          <div className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Invoice #{invoice.invoiceNumber || '—'}</span>
              <span className="text-sm text-gray-500">{invoice.supplierName}</span>
            </div>
            <div className="h-5 w-px bg-gray-200" />
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full" /> {lineStats.autoMatched} auto-matched</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-amber-500 rounded-full" /> {lineStats.needsReview} need review</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-500 rounded-full" /> {lineStats.unmatched} no match</span>
            </div>
            <div className="h-5 w-px bg-gray-200" />
            {/* Store legend */}
            <div className="flex items-center gap-3 text-xs">
              {stores.map((store, i) => {
                const sc = STORE_COLORS[i % STORE_COLORS.length];
                return (
                  <span key={store.id} className={`flex items-center gap-1 ${sc.text}`}>
                    <span className={`w-2.5 h-2.5 ${sc.dot} rounded-full`} />
                    {store.name}
                  </span>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => {
                  if (expandedLines.size === invoice.lines.length) {
                    setExpandedLines(new Set());
                  } else {
                    setExpandedLines(new Set(invoice.lines.map((l) => l.id)));
                  }
                }}
                className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200"
              >
                {expandedLines.size === invoice.lines?.length ? 'Collapse All' : 'Expand All'}
              </button>
              <button
                onClick={handleApproveAll}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"
              >
                Approve All Matched
              </button>
            </div>
          </div>

          {/* Line items */}
          {(invoice.lines || []).map((line) => (
            <div key={line.id} ref={el => lineRefs.current[line.id] = el}>
              <LineItemRow
                line={line}
                invoice={invoice}
                stores={stores}
                storeColorMap={storeColorMap}
                expanded={expandedLines.has(line.id)}
                onToggle={() => toggleLine(line.id)}
                onConfirmMatch={handleConfirmMatch}
                onApproveLine={handleApproveLine}
                onPriceUpdate={handlePriceUpdate}
                onApproveAndNext={handleApproveAndNext}
              />
            </div>
          ))}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back to OCR
            </button>
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-500">
                <span className="font-medium text-gray-900">{lineStats.autoMatched}</span> of {invoice.lines?.length || 0} lines matched
                {lineStats.needsReview > 0 && <> · <span className="font-medium text-amber-600">{lineStats.needsReview}</span> need review</>}
                {lineStats.unmatched > 0 && <> · <span className="font-medium text-red-600">{lineStats.unmatched}</span> unmatched</>}
              </div>
              <button
                onClick={() => setStep(3)}
                className="px-6 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center gap-2"
              >
                Continue to Approval
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Step 3: Review & Approve ═══ */}
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

      {/* ═══ Step 4: Export & Push ═══ */}
      {step === 4 && (
        <ExportPanel
          invoice={invoice}
          exportData={exportData}
          stores={stores}
          storeColorMap={storeColorMap}
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
