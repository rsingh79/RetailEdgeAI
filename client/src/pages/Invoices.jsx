import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

// ── Reusable invoice table ───────────────────────────────────
function InvoiceTable({ invoices, showCheckbox, selectedIds, onToggleSelect, onToggleSelectAll, onRowClick, onDelete }) {
  if (invoices.length === 0) return null;

  const allSelected = showCheckbox && invoices.every((inv) => selectedIds.has(inv.id));
  const someSelected = showCheckbox && invoices.some((inv) => selectedIds.has(inv.id));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
          {showCheckbox && (
            <th className="pl-5 pr-2 py-2.5 w-10">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={() => onToggleSelectAll(invoices)}
                className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
              />
            </th>
          )}
          <th className={`${showCheckbox ? 'pl-0' : 'pl-5'} pr-3 py-2.5`}>Status</th>
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
            className={`hover:bg-gray-50 cursor-pointer transition-colors ${
              selectedIds?.has(inv.id) ? 'bg-teal-50/50' : ''
            }`}
            onClick={() => onRowClick(inv)}
          >
            {showCheckbox && (
              <td className="pl-5 pr-2 py-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(inv.id)}
                  onChange={() => onToggleSelect(inv.id)}
                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 cursor-pointer"
                />
              </td>
            )}
            <td className={`${showCheckbox ? 'pl-0' : 'pl-5'} pr-3 py-3`}>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || ''}`}>
                {inv.status}
              </span>
            </td>
            <td className="px-3 py-3">
              {inv.source === 'email' ? (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Email</span>
              ) : inv.source === 'drive' ? (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">Drive</span>
              ) : inv.source === 'folder' ? (
                <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium">Folder</span>
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
                onClick={() => onDelete(inv)}
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
  );
}

// ── Main Invoices page ───────────────────────────────────────
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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [otherExpanded, setOtherExpanded] = useState(false);

  // ── Active integrations for Poll Now ──
  // Each entry: { type: 'gmail'|'folder'|'drive', label, lastPollAt }
  const [activeIntegrations, setActiveIntegrations] = useState([]);
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState(null); // { found, message } | null

  // Split invoices into groups
  const { readyInvoices, inReviewInvoices, approvedInvoices, otherInvoices } = useMemo(() => {
    const ready = [];
    const inReview = [];
    const approved = [];
    const other = [];
    for (const inv of invoices) {
      if (inv.status === 'READY') ready.push(inv);
      else if (inv.status === 'IN_REVIEW') inReview.push(inv);
      else if (inv.status === 'APPROVED') approved.push(inv);
      else other.push(inv);
    }
    return { readyInvoices: ready, inReviewInvoices: inReview, approvedInvoices: approved, otherInvoices: other };
  }, [invoices]);

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

  // Check which integrations are active (non-fatal — runs in parallel)
  useEffect(() => {
    async function checkIntegrations() {
      const found = [];
      const [gmailStatus, folderStatus, driveStatus] = await Promise.allSettled([
        api.gmail.getStatus(),
        api.folderPolling.getStatus(),
        api.drive.getStatus(),
      ]);

      // Gmail / IMAP — may have multiple integrations
      if (gmailStatus.status === 'fulfilled') {
        const s = gmailStatus.value;
        const integrations = Array.isArray(s) ? s : (s.integrations || (s.connected ? [s] : []));
        for (const intg of integrations) {
          if (intg.connected !== false && intg.isActive !== false) {
            found.push({
              type: 'gmail',
              label: intg.email || intg.imapEmail || 'Email',
              lastPollAt: intg.lastPollAt,
            });
          }
        }
      }

      // Folder polling
      if (folderStatus.status === 'fulfilled') {
        const s = folderStatus.value;
        if (s.configured && s.isActive !== false) {
          found.push({
            type: 'folder',
            label: s.folderPath ? s.folderPath.split('/').pop() || 'Folder' : 'Folder',
            lastPollAt: s.lastPollAt,
          });
        }
      }

      // Google Drive
      if (driveStatus.status === 'fulfilled') {
        const s = driveStatus.value;
        const integrations = Array.isArray(s) ? s : (s.integrations || []);
        for (const intg of integrations) {
          if (intg.isActive !== false) {
            found.push({
              type: 'drive',
              id: intg.id,
              label: intg.email || 'Google Drive',
              lastPollAt: intg.lastPollAt,
            });
          }
        }
      }

      setActiveIntegrations(found);
    }
    checkIntegrations();
  }, []);

  // Poll all active integrations
  const handlePollNow = async () => {
    setPolling(true);
    setPollResult(null);
    let totalFound = 0;
    const errors = [];

    await Promise.allSettled(
      activeIntegrations.map(async (intg) => {
        try {
          let result;
          if (intg.type === 'gmail') {
            result = await api.gmail.poll();
          } else if (intg.type === 'folder') {
            result = await api.folderPolling.poll();
          } else if (intg.type === 'drive') {
            result = intg.id
              ? await api.drive.poll(intg.id)
              : await api.drive.pollAll();
          }
          // Count new invoices found (field name varies by integration)
          const found = result?.invoicesFound ?? result?.imported ?? result?.created ?? 0;
          totalFound += Number(found) || 0;
        } catch (err) {
          errors.push(`${intg.label}: ${err.message}`);
        }
      })
    );

    setPolling(false);
    setPollResult({ found: totalFound, errors });
    await loadInvoices();
  };

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  // ── Selection handlers ──
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((group) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = group.every((inv) => next.has(inv.id));
      if (allSelected) {
        group.forEach((inv) => next.delete(inv.id));
      } else {
        group.forEach((inv) => next.add(inv.id));
      }
      return next;
    });
  }, []);

  const handleReviewSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      navigate(`/invoices/${ids[0]}`);
    } else {
      navigate(`/review?ids=${ids.join(',')}`);
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ── Row click → always go to OCR & Extract detail first ──
  const handleRowClick = (inv) => {
    navigate(`/invoices/${inv.id}`);
  };

  // ── Upload handling ──
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
    setSelectedIds(new Set());
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

  // ── Delete handling ──
  const handleDelete = async () => {
    if (!deletingInvoice) return;
    setDeleting(true);
    try {
      await api.deleteInvoice(deletingInvoice.id);
      setInvoices((prev) => prev.filter((inv) => inv.id !== deletingInvoice.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deletingInvoice.id);
        return next;
      });
      setDeletingInvoice(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  // ── Empty state for a table section ──
  const EmptySection = ({ message }) => (
    <div className="px-5 py-6 text-center text-sm text-gray-400">{message}</div>
  );

  return (
    <div className="space-y-6">
      <WorkflowBreadcrumb step={1} />
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Upload Invoices</h2>
          <p className="text-sm text-gray-500 mt-1">
            Upload supplier invoices for OCR extraction and review
          </p>
        </div>
        {activeIntegrations.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handlePollNow}
              disabled={polling}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition"
            >
              {polling ? (
                <>
                  <svg className="animate-spin w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Polling…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 text-teal-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Poll Now
                </>
              )}
            </button>
            <div className="flex items-center gap-1.5">
              {activeIntegrations.map((intg, i) => (
                <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  intg.type === 'gmail' ? 'bg-blue-100 text-blue-700' :
                  intg.type === 'folder' ? 'bg-orange-100 text-orange-700' :
                  'bg-green-100 text-green-700'
                }`}>
                  {intg.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Poll result banner */}
      {pollResult && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between ${
          pollResult.errors.length > 0 ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'
        }`}>
          <span>
            {pollResult.found > 0
              ? `${pollResult.found} new invoice${pollResult.found !== 1 ? 's' : ''} found`
              : 'No new invoices found'}
            {pollResult.errors.length > 0 && ` · ${pollResult.errors.join(', ')}`}
          </span>
          <button onClick={() => setPollResult(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

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

      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 text-sm">
          No invoices yet. Upload one to get started.
        </div>
      ) : (
        <>
          {/* ── Ready for Review ── */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Ready for Review</h3>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                  {readyInvoices.length}
                </span>
              </div>
              {readyInvoices.length > 0 && selectedIds.size === 0 && (
                <span className="text-xs text-gray-400">Select invoices to batch review</span>
              )}
            </div>
            {readyInvoices.length === 0 ? (
              <EmptySection message="No invoices ready for review" />
            ) : (
              <InvoiceTable
                invoices={readyInvoices}
                showCheckbox
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onRowClick={handleRowClick}
                onDelete={setDeletingInvoice}
              />
            )}
          </div>

          {/* ── In Review ── */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">In Review</h3>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                  {inReviewInvoices.length}
                </span>
              </div>
              {inReviewInvoices.length > 0 && (
                <span className="text-xs text-gray-400">Invoices currently being reviewed</span>
              )}
            </div>
            {inReviewInvoices.length === 0 ? (
              <EmptySection message="No invoices in review" />
            ) : (
              <InvoiceTable
                invoices={inReviewInvoices}
                showCheckbox
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onRowClick={handleRowClick}
                onDelete={setDeletingInvoice}
              />
            )}
          </div>

          {/* ── Approved ── */}
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Approved</h3>
                <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">
                  {approvedInvoices.length}
                </span>
              </div>
            </div>
            {approvedInvoices.length === 0 ? (
              <EmptySection message="No approved invoices" />
            ) : (
              <InvoiceTable
                invoices={approvedInvoices}
                showCheckbox
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onRowClick={handleRowClick}
                onDelete={setDeletingInvoice}
              />
            )}
          </div>

          {/* ── Other Statuses (collapsible) ── */}
          {otherInvoices.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200">
              <button
                className="w-full px-5 py-3 border-b border-gray-100 flex items-center justify-between hover:bg-gray-50 transition-colors"
                onClick={() => setOtherExpanded((prev) => !prev)}
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 text-gray-400 transition-transform ${otherExpanded ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  <h3 className="font-semibold text-sm text-gray-600">Other Statuses</h3>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                    {otherInvoices.length}
                  </span>
                </div>
              </button>
              {otherExpanded && (
                <InvoiceTable
                  invoices={otherInvoices}
                  showCheckbox={false}
                  selectedIds={new Set()}
                  onToggleSelect={() => {}}
                  onToggleSelectAll={() => {}}
                  onRowClick={handleRowClick}
                  onDelete={setDeletingInvoice}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* ── Floating action bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-xl border border-gray-200 px-6 py-3 flex items-center gap-4 z-40">
          <span className="text-sm font-medium text-gray-700">
            {selectedIds.size} invoice{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={handleReviewSelected}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
            Review Selected
          </button>
          <button
            onClick={clearSelection}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Clear
          </button>
        </div>
      )}

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
