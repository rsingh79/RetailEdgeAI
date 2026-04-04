import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';

const FREIGHT_OPTIONS = [
  { value: 'PROPORTIONAL_VALUE', label: 'Proportional by value' },
  { value: 'EQUAL_SPLIT', label: 'Equal split' },
  { value: 'PROPORTIONAL_QTY', label: 'Proportional by qty' },
  { value: 'MANUAL', label: 'Manual' },
];

export default function InvoiceDetail() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingLine, setEditingLine] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [fileBlobUrl, setFileBlobUrl] = useState(null);
  const [costBasis, setCostBasis] = useState({}); // lineId → 'inc' | 'exc'
  const [reOcrLoading, setReOcrLoading] = useState(false);

  const loadInvoice = useCallback(async () => {
    try {
      const data = await api.getInvoiceDetails(invoiceId);
      setInvoice(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    loadInvoice();
  }, [loadInvoice]);

  // Fetch file with auth token and create blob URL for iframe/img
  useEffect(() => {
    if (!invoice?.originalFileUrl) return;
    let revoked = false;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(invoice.originalFileUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (revoked) return;
        setFileBlobUrl(URL.createObjectURL(blob));
      } catch { /* ignore */ }
    })();
    return () => {
      revoked = true;
      setFileBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [invoice?.originalFileUrl]);

  const handleHeaderChange = async (field, value) => {
    setSaving(true);
    try {
      const updated = await api.updateInvoice(invoiceId, { [field]: value });
      setInvoice(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEditLine = (line) => {
    setEditingLine(line.id);
    setEditValues({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      packSize: line.packSize || '',
      baseUnit: line.baseUnit || '',
    });
  };

  const saveLineEdit = async (lineId) => {
    setSaving(true);
    try {
      await api.updateInvoiceLine(invoiceId, lineId, {
        ...editValues,
        quantity: Number(editValues.quantity),
        unitPrice: Number(editValues.unitPrice),
        lineTotal: Number(editValues.lineTotal),
      });
      const updated = await api.getInvoice(invoiceId);
      setInvoice(updated);
      setEditingLine(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReOcr = async () => {
    if (!confirm('Re-run OCR on this invoice? This will replace all current line items with freshly extracted data.')) return;
    setReOcrLoading(true);
    setError(null);
    try {
      const result = await api.reOcr(invoiceId);
      // Reload the full invoice to get updated lines
      const updated = await api.getInvoice(invoiceId);
      setInvoice(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setReOcrLoading(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      // Save chosen cost basis (inc/exc GST) to each line's baseUnitCost
      await Promise.all(
        (invoice.lines || []).map((line) => {
          const cost = getCostToUse(line);
          if (cost != null && Math.abs(cost - (line.baseUnitCost || 0)) > 0.001) {
            return api.updateInvoiceLine(invoiceId, line.id, { baseUnitCost: cost });
          }
          return Promise.resolve();
        })
      );
      await api.updateInvoice(invoiceId, { status: 'IN_REVIEW' });
      navigate('/review/' + invoiceId);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">Loading invoice...</div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    );
  }

  if (!invoice) return null;

  // Approved/exported invoices use the full Review flow
  if (invoice.status === 'APPROVED' || invoice.status === 'EXPORTED') {
    navigate(`/review/${invoiceId}`, { replace: true });
    return null;
  }

  const fileUrl = invoice.originalFileUrl;
  const isPdf = fileUrl?.toLowerCase().endsWith('.pdf');
  const confidencePct = invoice.ocrConfidence != null ? Math.round(invoice.ocrConfidence * 100) : null;

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // ── GST helpers ──────────────────────────────────────────────
  const GST_RATE = 0.10;
  const addGst = (v) => v != null ? Math.round(v * (1 + GST_RATE) * 100) / 100 : null;
  const removeGst = (v) => v != null ? Math.round((v / (1 + GST_RATE)) * 100) / 100 : null;

  // Per-line: does baseUnitCost already include GST for this line?
  // - gstInclusive=true → lineTotal includes GST → baseUnitCost includes GST (for GST-applicable lines)
  // - gstInclusive=false, gst>0 → GST was allocated → baseUnitCost includes GST (for GST-applicable lines)
  // - gstInclusive=false, gst=0 → no GST → baseUnitCost does NOT include GST
  const lineBucIncludesGst = (line) => {
    if (!line.gstApplicable) return false;
    return invoice.gstInclusive || (invoice.gst > 0);
  };

  const costExGst = (line) => {
    if (line.baseUnitCost == null) return null;
    if (!line.gstApplicable) return line.baseUnitCost;
    return lineBucIncludesGst(line) ? removeGst(line.baseUnitCost) : line.baseUnitCost;
  };
  const costIncGst = (line) => {
    if (line.baseUnitCost == null) return null;
    if (!line.gstApplicable) return line.baseUnitCost;
    return lineBucIncludesGst(line) ? line.baseUnitCost : addGst(line.baseUnitCost);
  };
  const getLineCostBasis = (lineId) => costBasis[lineId] || 'inc';
  const getCostToUse = (line) =>
    getLineCostBasis(line.id) === 'inc' ? costIncGst(line) : costExGst(line);
  const setAllCostBasis = (basis) => {
    const updated = {};
    (invoice.lines || []).forEach((l) => { updated[l.id] = basis; });
    setCostBasis(updated);
  };

  const handleGstToggle = async (line) => {
    setSaving(true);
    try {
      const result = await api.updateInvoiceLine(invoiceId, line.id, {
        gstApplicable: !line.gstApplicable,
      });
      // Endpoint returns the full invoice when gstApplicable changes
      setInvoice(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/invoices')}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div>
            <h2 className="text-lg font-semibold">Invoice & OCR Review</h2>
            <p className="text-sm text-gray-500">
              {invoice.invoiceNumber || 'Untitled'} — {invoice.supplierName || 'Unknown supplier'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {confidencePct != null && (
            <span
              className={`px-2.5 py-1 text-xs font-medium rounded-full flex items-center gap-1 ${
                confidencePct >= 90
                  ? 'bg-emerald-100 text-emerald-700'
                  : confidencePct >= 70
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              OCR Confidence: {confidencePct}%
            </span>
          )}
          <button
            onClick={handleReOcr}
            disabled={reOcrLoading || saving}
            className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {reOcrLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Re-scanning...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                Re-OCR
              </>
            )}
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || invoice.status === 'FAILED'}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm & Continue
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Split view */}
      <div className="grid grid-cols-5 gap-6">
        {/* Left: File Preview */}
        <div className="col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold">Invoice Preview</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{fileUrl?.split('/').pop()}</span>
                {fileBlobUrl && (
                  <button
                    onClick={() => window.open(fileBlobUrl, '_blank', 'width=900,height=700,scrollbars=yes,resizable=yes')}
                    className="p-1 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition"
                    title="Open in new window"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="bg-gray-100 min-h-[500px]">
              {isPdf ? (
                fileBlobUrl ? (
                  <iframe src={fileBlobUrl} className="w-full h-[600px]" title="Invoice PDF" />
                ) : (
                  <div className="flex items-center justify-center h-[600px] text-gray-400 text-sm">Loading PDF...</div>
                )
              ) : fileUrl ? (
                fileBlobUrl ? (
                  <img src={fileBlobUrl} alt="Invoice" className="w-full object-contain" />
                ) : (
                  <div className="flex items-center justify-center h-[500px] text-gray-400 text-sm">Loading image...</div>
                )
              ) : (
                <div className="flex items-center justify-center h-[500px] text-gray-400 text-sm">
                  No file preview available
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Extracted Data */}
        <div className="col-span-3 space-y-4">
          {/* Header data */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="font-semibold mb-4">Extracted Invoice Data</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Field label="Supplier" value={invoice.supplierName} />
              <Field label="Invoice #" value={invoice.invoiceNumber} />
              <Field label="Invoice Date" value={formatDate(invoice.invoiceDate)} />
              <Field label="Due Date" value={formatDate(invoice.dueDate)} />
              <Field label="Subtotal (ex GST)" value={invoice.subtotal != null ? `$${Number(invoice.subtotal).toFixed(2)}` : null} />
              <Field label="GST" value={invoice.gst != null ? `$${Number(invoice.gst).toFixed(2)}` : null} />
              <Field label="Freight" value={invoice.freight != null ? `$${Number(invoice.freight).toFixed(2)}` : null} />
              <div>
                <span className="text-gray-500 block text-xs">Total (inc GST)</span>
                <span className="font-semibold text-teal-700">
                  {invoice.total != null ? `$${Number(invoice.total).toFixed(2)}` : '—'}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">GST Treatment</span>
                <span className={`inline-flex items-center mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                  invoice.gstInclusive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {invoice.gstInclusive ? 'Prices Inc GST' : invoice.gstInclusive === false ? 'Prices Ex GST' : 'Unknown'}
                </span>
              </div>
              <div>
                <span className="text-gray-500 block text-xs">Freight Allocation</span>
                <select
                  className="mt-1 px-2 py-1 border border-gray-300 rounded text-xs w-full"
                  value={invoice.freightMethod}
                  onChange={(e) => handleHeaderChange('freightMethod', e.target.value)}
                >
                  {FREIGHT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Extracted Line Items</h3>
              <span className="text-xs text-gray-400">{invoice.lines?.length || 0} items</span>
            </div>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-4 py-2.5 w-10">#</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5">Qty</th>
                  <th className="px-3 py-2.5">
                    <div>Unit Price</div>
                    <div className="font-normal normal-case tracking-normal text-gray-400">(inc / ex GST)</div>
                  </th>
                  <th className="hidden md:table-cell px-3 py-2.5">
                    <div>Total</div>
                    <div className="font-normal normal-case tracking-normal text-gray-400">(inc / ex GST)</div>
                  </th>
                  <th className="hidden lg:table-cell px-3 py-2.5">Pack Size</th>
                  <th className="hidden lg:table-cell px-3 py-2.5">Base Unit</th>
                  <th className="hidden lg:table-cell px-3 py-2.5">Freight Alloc</th>
                  <th className="hidden md:table-cell px-2 py-2.5 w-14">
                    <div>GST</div>
                  </th>
                  <th className="px-3 py-2.5">
                    <div>Total Cost to Use</div>
                    <div className="flex items-center justify-center gap-1 mt-0.5 font-normal normal-case tracking-normal">
                      <button className="text-[10px] text-teal-600 hover:underline" onClick={() => setAllCostBasis('inc')}>all inc</button>
                      <span className="text-gray-300">|</span>
                      <button className="text-[10px] text-teal-600 hover:underline" onClick={() => setAllCostBasis('exc')}>all exc</button>
                    </div>
                  </th>
                  <th className="px-3 py-2.5 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(invoice.lines || []).map((line) => (
                  <tr key={line.id} className="hover:bg-gray-50">
                    {editingLine === line.id ? (
                      <>
                        <td className="px-4 py-2 text-gray-400">{line.lineNumber}</td>
                        <td className="px-3 py-2">
                          <input
                            className="w-full px-2 py-1 border rounded text-sm"
                            value={editValues.description}
                            onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            className="w-20 px-2 py-1 border rounded text-sm text-right"
                            value={editValues.quantity}
                            onChange={(e) => setEditValues({ ...editValues, quantity: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className="w-24 px-2 py-1 border rounded text-sm text-right"
                            value={editValues.unitPrice}
                            onChange={(e) => setEditValues({ ...editValues, unitPrice: e.target.value })}
                          />
                        </td>
                        <td className="hidden md:table-cell px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className="w-24 px-2 py-1 border rounded text-sm text-right"
                            value={editValues.lineTotal}
                            onChange={(e) => setEditValues({ ...editValues, lineTotal: e.target.value })}
                          />
                        </td>
                        <td className="hidden lg:table-cell px-3 py-2">
                          <input
                            className="w-24 px-2 py-1 border rounded text-sm"
                            value={editValues.packSize}
                            onChange={(e) => setEditValues({ ...editValues, packSize: e.target.value })}
                          />
                        </td>
                        <td className="hidden lg:table-cell px-3 py-2">
                          <input
                            className="w-16 px-2 py-1 border rounded text-sm"
                            value={editValues.baseUnit}
                            onChange={(e) => setEditValues({ ...editValues, baseUnit: e.target.value })}
                          />
                        </td>
                        <td className="hidden lg:table-cell px-3 py-2 text-right text-xs text-gray-400">
                          {line.freightAlloc ? `$${Number(line.freightAlloc).toFixed(2)}` : '—'}
                        </td>
                        <td className="hidden md:table-cell px-2 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={line.gstApplicable}
                            onChange={() => handleGstToggle(line)}
                            disabled={saving}
                            className="w-4 h-4 text-teal-600 rounded border-gray-300 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-gray-400">—</td>
                        <td className="px-3 py-2 flex gap-1">
                          <button
                            onClick={() => saveLineEdit(line.id)}
                            disabled={saving}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            title="Save"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setEditingLine(null)}
                            className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                            title="Cancel"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-center text-gray-400">{line.lineNumber}</td>
                        <td className="px-3 py-3 font-medium">{line.description}</td>
                        <td className="px-3 py-3 text-center">{line.quantity}</td>
                        <td className="px-3 py-3 text-center">
                          {!line.gstApplicable ? (
                            <div>${Number(line.unitPrice).toFixed(2)}</div>
                          ) : invoice.gstInclusive ? (
                            <>
                              <div>${Number(line.unitPrice).toFixed(2)}</div>
                              <div className="text-xs text-gray-400">${removeGst(line.unitPrice)?.toFixed(2)} ex</div>
                            </>
                          ) : (
                            <>
                              <div>${addGst(line.unitPrice)?.toFixed(2)}</div>
                              <div className="text-xs text-gray-400">${Number(line.unitPrice).toFixed(2)} ex</div>
                            </>
                          )}
                        </td>
                        <td className="hidden md:table-cell px-3 py-3 text-center">
                          {!line.gstApplicable ? (
                            <div className="font-medium">${Number(line.lineTotal).toFixed(2)}</div>
                          ) : invoice.gstInclusive ? (
                            <>
                              <div className="font-medium">${Number(line.lineTotal).toFixed(2)}</div>
                              <div className="text-xs text-gray-400">${removeGst(line.lineTotal)?.toFixed(2)} ex</div>
                            </>
                          ) : (
                            <>
                              <div className="font-medium">${addGst(line.lineTotal)?.toFixed(2)}</div>
                              <div className="text-xs text-gray-400">${Number(line.lineTotal).toFixed(2)} ex</div>
                            </>
                          )}
                        </td>
                        <td className="hidden lg:table-cell px-3 py-3 text-center text-gray-500">{line.packSize || '—'}</td>
                        <td className="hidden lg:table-cell px-3 py-3 text-center text-gray-500">{line.baseUnit || '—'}</td>
                        <td className="hidden lg:table-cell px-3 py-3 text-center text-gray-500">
                          {line.freightAlloc ? `$${Number(line.freightAlloc).toFixed(2)}` : '—'}
                        </td>
                        <td className="hidden md:table-cell px-2 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={line.gstApplicable}
                            onChange={() => handleGstToggle(line)}
                            disabled={saving}
                            className="w-4 h-4 text-teal-600 rounded border-gray-300 cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-3 text-center">
                          {line.baseUnitCost != null ? (
                            <div className="space-y-1">
                              <div className="font-semibold text-teal-700">
                                ${getCostToUse(line)?.toFixed(2)}/{line.baseUnit || 'unit'}
                              </div>
                              {line.gstApplicable ? (
                                <select
                                  className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 bg-white"
                                  value={getLineCostBasis(line.id)}
                                  onChange={(e) => setCostBasis(prev => ({ ...prev, [line.id]: e.target.value }))}
                                >
                                  <option value="inc">Inc GST</option>
                                  <option value="exc">Exc GST</option>
                                </select>
                              ) : (
                                <span className="text-[10px] text-gray-400">GST-free</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={() => startEditLine(line)}
                            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z" />
                            </svg>
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <span className="text-gray-500 block text-xs">{label}</span>
      <span className="font-medium">{value || '—'}</span>
    </div>
  );
}
