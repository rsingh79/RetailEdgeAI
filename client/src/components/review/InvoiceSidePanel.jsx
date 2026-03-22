const formatDate = (dateStr) => {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const formatCurrency = (val) => {
  if (val == null) return '--';
  return `$${Number(val).toFixed(2)}`;
};

const CheckIcon = () => (
  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

export default function InvoiceSidePanel({ invoices, activeId, approvedIds, loading, onSelect, allComplete, onDone }) {
  return (
    <div className="w-72 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Review Batch</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          {approvedIds.size} of {invoices.length} approved
        </p>
        <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-500"
            style={{ width: `${invoices.length ? (approvedIds.size / invoices.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Invoice list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-center">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600 mx-auto" />
            <p className="text-xs text-gray-400 mt-2">Loading invoices...</p>
          </div>
        ) : (
          invoices.map((inv) => {
            const isApproved = approvedIds.has(inv.id);
            const isActive = inv.id === activeId && !isApproved;
            return (
              <button
                key={inv.id}
                onClick={() => !isApproved && onSelect(inv.id)}
                disabled={isApproved}
                className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                  isApproved
                    ? 'bg-emerald-50/60 cursor-default'
                    : isActive
                      ? 'bg-teal-50 border-l-2 border-l-teal-500'
                      : 'hover:bg-gray-50 cursor-pointer border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium truncate ${isApproved ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {inv.supplierName || 'Unknown Supplier'}
                  </span>
                  {isApproved && (
                    <span className="flex-shrink-0 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                      <CheckIcon />
                    </span>
                  )}
                </div>
                <div className={`text-xs mt-0.5 ${isApproved ? 'text-gray-400' : 'text-gray-500'}`}>
                  #{inv.invoiceNumber || '--'} · {formatDate(inv.invoiceDate)}
                </div>
                <div className={`text-xs font-medium mt-0.5 ${isApproved ? 'text-gray-400' : 'text-gray-700'}`}>
                  {formatCurrency(inv.total)} · {inv.lineCount} line{inv.lineCount !== 1 ? 's' : ''}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer */}
      {allComplete && (
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={onDone}
            className="w-full px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
          >
            Done — Back to Invoices
          </button>
        </div>
      )}
    </div>
  );
}
