import { useState, useEffect } from 'react';
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

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getInvoice(invoiceId);
        setInvoice(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [invoiceId]);

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

  const handleConfirm = async () => {
    setSaving(true);
    try {
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

  const fileUrl = invoice.originalFileUrl;
  const isPdf = fileUrl?.toLowerCase().endsWith('.pdf');
  const confidencePct = invoice.ocrConfidence != null ? Math.round(invoice.ocrConfidence * 100) : null;

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
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
              <span className="text-xs text-gray-400">{fileUrl?.split('/').pop()}</span>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-4 py-2.5 w-10">#</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5 text-right">Qty</th>
                  <th className="px-3 py-2.5 text-right">Unit Price</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5">Pack Size</th>
                  <th className="px-3 py-2.5">Base Unit</th>
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
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            step="0.01"
                            className="w-24 px-2 py-1 border rounded text-sm text-right"
                            value={editValues.lineTotal}
                            onChange={(e) => setEditValues({ ...editValues, lineTotal: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-24 px-2 py-1 border rounded text-sm"
                            value={editValues.packSize}
                            onChange={(e) => setEditValues({ ...editValues, packSize: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="w-16 px-2 py-1 border rounded text-sm"
                            value={editValues.baseUnit}
                            onChange={(e) => setEditValues({ ...editValues, baseUnit: e.target.value })}
                          />
                        </td>
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
                        <td className="px-4 py-3 text-gray-400">{line.lineNumber}</td>
                        <td className="px-3 py-3 font-medium">{line.description}</td>
                        <td className="px-3 py-3 text-right">{line.quantity}</td>
                        <td className="px-3 py-3 text-right">${Number(line.unitPrice).toFixed(2)}</td>
                        <td className="px-3 py-3 text-right font-medium">${Number(line.lineTotal).toFixed(2)}</td>
                        <td className="px-3 py-3 text-gray-500">{line.packSize || '—'}</td>
                        <td className="px-3 py-3 text-gray-500">{line.baseUnit || '—'}</td>
                        <td className="px-3 py-3">
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
