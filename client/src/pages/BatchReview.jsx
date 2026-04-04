import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import Review from './Review';
import InvoiceSidePanel from '../components/review/InvoiceSidePanel';

// ── Completion screen shown when all invoices in the batch are approved ──
function BatchCompleteMessage({ count, onGoToInvoices, onGoToExport }) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-gray-900">
          All {count} Invoice{count !== 1 ? 's' : ''} Approved
        </h2>
        <p className="text-sm text-gray-500 max-w-sm mx-auto">
          All invoices in this batch have been reviewed and approved. You can now export them or return to the invoices list.
        </p>
        <div className="flex items-center gap-3 justify-center pt-2">
          <button
            onClick={onGoToInvoices}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back to Invoices
          </button>
          <button
            onClick={onGoToExport}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
          >
            Go to Export
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BatchReview() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Parse batch IDs from URL
  const batchIds = useMemo(() => {
    const idsParam = searchParams.get('ids');
    return idsParam ? idsParam.split(',').filter(Boolean) : [];
  }, [searchParams]);

  const isBatch = batchIds.length > 0;

  // Invoice summaries for the side panel
  const [invoiceSummaries, setInvoiceSummaries] = useState([]);
  const [loadingSummaries, setLoadingSummaries] = useState(true);

  // Currently active invoice ID in the batch
  const [activeInvoiceId, setActiveInvoiceId] = useState(null);

  // Set of approved invoice IDs
  const [approvedIds, setApprovedIds] = useState(new Set());

  const allComplete = isBatch && invoiceSummaries.length > 0 && approvedIds.size === batchIds.length;

  // Fetch summaries for all batch invoices on mount
  useEffect(() => {
    if (!isBatch) return;
    let cancelled = false;

    async function loadSummaries() {
      try {
        const results = await Promise.all(
          batchIds.map((id) => api.getInvoice(id).catch(() => null))
        );
        if (cancelled) return;

        const summaries = results
          .filter(Boolean)
          .map((inv) => ({
            id: inv.id,
            supplierName: inv.supplierName,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: inv.invoiceDate,
            total: inv.total,
            status: inv.status,
            lineCount: inv.lines?.length || 0,
          }));

        setInvoiceSummaries(summaries);

        // Pre-populate already-approved invoices
        const alreadyApproved = new Set();
        for (const s of summaries) {
          if (s.status === 'APPROVED' || s.status === 'EXPORTED') {
            alreadyApproved.add(s.id);
          }
        }
        setApprovedIds(alreadyApproved);

        // Set first non-approved invoice as active
        const firstActive = summaries.find((s) => !alreadyApproved.has(s.id));
        setActiveInvoiceId(firstActive?.id || summaries[0]?.id || null);
      } catch {
        // Summaries failed to load — still set loading false
      } finally {
        if (!cancelled) setLoadingSummaries(false);
      }
    }

    loadSummaries();
    return () => { cancelled = true; };
  }, [batchIds, isBatch]);

  // Handle invoice approval from the Review component
  const handleApproved = useCallback((invoiceId) => {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      next.add(invoiceId);
      return next;
    });

    // Update summary status
    setInvoiceSummaries((prev) =>
      prev.map((s) => (s.id === invoiceId ? { ...s, status: 'APPROVED' } : s))
    );

    // Auto-advance to next unapproved invoice after a short delay
    setTimeout(() => {
      setApprovedIds((currentApproved) => {
        const remaining = batchIds.filter((id) => !currentApproved.has(id));
        if (remaining.length > 0) {
          setActiveInvoiceId(remaining[0]);
        }
        return currentApproved;
      });
    }, 1500);
  }, [batchIds]);

  // ── Non-batch mode: delegate directly to Review ──
  if (!isBatch) {
    return <Review />;
  }

  // ── Batch mode: side panel + Review ──
  return (
    <div className="flex gap-0 -m-6">
      {/* Left side panel */}
      <InvoiceSidePanel
        invoices={invoiceSummaries}
        activeId={activeInvoiceId}
        approvedIds={approvedIds}
        loading={loadingSummaries}
        onSelect={setActiveInvoiceId}
        allComplete={allComplete}
        onDone={() => navigate('/invoices')}
        onViewApproved={(id) => navigate(`/invoices/${id}`)}
      />

      {/* Main review area */}
      <div className="flex-1 p-6 overflow-auto">
        {allComplete ? (
          <BatchCompleteMessage
            count={batchIds.length}
            onGoToInvoices={() => navigate('/invoices')}
            onGoToExport={() => navigate('/export')}
          />
        ) : activeInvoiceId ? (
          <Review
            key={activeInvoiceId}
            invoiceIdProp={activeInvoiceId}
            onApproved={handleApproved}
          />
        ) : (
          <div className="p-8 text-center text-gray-400 text-sm">
            Select an invoice from the panel to begin review.
          </div>
        )}
      </div>
    </div>
  );
}
