import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import WorkflowBreadcrumb from '../components/layout/WorkflowBreadcrumb';

const STATUS_STYLES = {
  PROCESSING: 'bg-amber-100 text-amber-700',
  READY: 'bg-emerald-100 text-emerald-700',
  IN_REVIEW: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-teal-100 text-teal-700',
  EXPORTED: 'bg-gray-100 text-gray-600',
  FAILED: 'bg-red-100 text-red-700',
};

export default function Invoices() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [deletingInvoice, setDeletingInvoice] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadInvoices = useCallback(async () => {
    try {
      const data = await api.getInvoices();
      setInvoices(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const processFiles = async (files) => {
    const validFiles = Array.from(files).filter((f) =>
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(f.type)
    );
    if (validFiles.length === 0) {
      setError('No valid files. Accepted: PDF, JPG, PNG, WEBP');
      return;
    }

    setUploading(true);
    setError(null);
    setUploadQueue(validFiles.map((f) => ({ name: f.name, status: 'pending' })));

    for (let i = 0; i < validFiles.length; i++) {
      setUploadQueue((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'uploading' } : item))
      );

      try {
        const formData = new FormData();
        formData.append('file', validFiles[i]);
        await api.uploadInvoice(formData);
        setUploadQueue((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: 'done' } : item))
        );
      } catch (err) {
        setUploadQueue((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'error', error: err.message } : item
          )
        );
      }
    }

    setUploading(false);
    loadInvoices();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const handleFileSelect = (e) => {
    if (e.target.files?.length) processFiles(e.target.files);
    e.target.value = '';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  };

  const formatCurrency = (val) => {
    if (val == null) return '—';
    return `$${Number(val).toFixed(2)}`;
  };

  const handleDelete = async () => {
    if (!deletingInvoice) return;
    setDeleting(true);
    try {
      await api.deleteInvoice(deletingInvoice.id);
      setInvoices((prev) => prev.filter((inv) => inv.id !== deletingInvoice.id));
      setDeletingInvoice(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <WorkflowBreadcrumb step={1} />
      <div>
        <h2 className="text-lg font-semibold">Upload Invoices</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload supplier invoices for OCR extraction and review
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`bg-white rounded-xl border-2 border-dashed transition p-12 text-center cursor-pointer ${
          dragOver ? 'border-teal-400 bg-teal-50' : 'border-gray-300 hover:border-teal-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="mt-3 text-lg font-medium text-gray-700">
          {dragOver ? 'Drop files here' : 'Drop files here or click to browse'}
        </p>
        <p className="text-sm text-gray-400 mt-1">PDF, JPG, PNG, or WEBP — up to 20MB</p>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          multiple
          onChange={handleFileSelect}
        />
      </div>

      {/* Upload progress */}
      {uploadQueue.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {uploadQueue.map((item, idx) => (
            <div key={idx} className="px-5 py-3 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 truncate max-w-xs">{item.name}</span>
              {item.status === 'pending' && <span className="text-xs text-gray-400">Queued</span>}
              {item.status === 'uploading' && (
                <span className="text-xs text-teal-600 flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Processing...
                </span>
              )}
              {item.status === 'done' && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Done
                </span>
              )}
              {item.status === 'error' && (
                <span className="text-xs text-red-600" title={item.error}>Failed</span>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Recent uploads */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-sm">Recent Invoices</h3>
          <span className="text-xs text-gray-400">{invoices.length} total</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : invoices.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No invoices yet. Upload one to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <th className="px-5 py-2.5">Status</th>
                <th className="px-3 py-2.5">Source</th>
                <th className="px-3 py-2.5">Supplier</th>
                <th className="px-3 py-2.5">Invoice #</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5 text-right">Lines</th>
                <th className="px-3 py-2.5 text-right">Total</th>
                <th className="px-3 py-2.5 text-right">Confidence</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => navigate(
                    ['IN_REVIEW', 'APPROVED', 'EXPORTED'].includes(inv.status)
                      ? `/review/${inv.id}`
                      : `/invoices/${inv.id}`
                  )}
                >
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || ''}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {inv.source === 'email' ? (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Email</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">Upload</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-medium">{inv.supplierName || '—'}</td>
                  <td className="px-3 py-3 text-gray-600">{inv.invoiceNumber || '—'}</td>
                  <td className="px-3 py-3 text-gray-600">{formatDate(inv.invoiceDate)}</td>
                  <td className="px-3 py-3 text-right text-gray-600">{inv.lines?.length || 0}</td>
                  <td className="px-3 py-3 text-right font-medium">{formatCurrency(inv.total)}</td>
                  <td className="px-3 py-3 text-right">
                    {inv.ocrConfidence != null ? (
                      <span className={`text-xs font-medium ${inv.ocrConfidence >= 0.9 ? 'text-emerald-600' : inv.ocrConfidence >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                        {Math.round(inv.ocrConfidence * 100)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setDeletingInvoice(inv)}
                      className="p-1 text-gray-300 hover:text-red-500 transition-colors rounded hover:bg-red-50"
                      title="Delete invoice"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {/* Delete confirmation modal */}
      {deletingInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => !deleting && setDeletingInvoice(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Delete Invoice</h3>
                <p className="text-sm text-gray-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-gray-700 mb-6">
              Are you sure you want to delete invoice <strong>{deletingInvoice.invoiceNumber || '(no number)'}</strong>
              {deletingInvoice.supplierName ? <> from <strong>{deletingInvoice.supplierName}</strong></> : ''}?
              All line items and match data will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingInvoice(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
