import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Tool name → friendly label mapping.
 */
const TOOL_LABELS = {
  get_recent_invoices: 'Looking up recent invoices',
  get_invoice_cost_summary: 'Analysing costs',
  get_supplier_spend_analysis: 'Analysing supplier spending',
  search_products: 'Searching products',
  get_low_margin_products: 'Finding low-margin products',
  get_category_performance: 'Analysing category performance',
  get_product_cost_history: 'Checking cost history',
  get_pricing_rules: 'Loading pricing rules',
  get_margin_analysis: 'Analysing margins',
  get_repricing_candidates: 'Finding repricing candidates',
  get_competitor_price_position: 'Comparing competitor prices',
  get_active_alerts: 'Checking alerts',
  synthesis: 'Preparing response',
};

/**
 * Renders the in-progress streaming response.
 * Shows tool progress indicators and the accumulating text.
 */
export default function StreamingMessage({ text, toolProgress }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] rounded-2xl px-4 py-3 bg-white border border-gray-200 text-gray-800 shadow-sm">
        {/* Tool progress indicators */}
        {toolProgress.length > 0 && (
          <div className="mb-3 space-y-1">
            {toolProgress.map((tp, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {tp.status === 'running' ? (
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-teal-600" />
                ) : (
                  <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <span className={tp.status === 'running' ? 'text-teal-700' : 'text-gray-400'}>
                  {TOOL_LABELS[tp.tool] || tp.tool}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Streaming text */}
        {text ? (
          <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-code:text-teal-700 prose-code:bg-teal-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm prose-th:text-left prose-th:px-3 prose-th:py-1.5 prose-th:bg-gray-50 prose-td:px-3 prose-td:py-1.5 prose-td:border-t prose-a:text-teal-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {text}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Thinking...</span>
          </div>
        )}

        {/* Blinking cursor */}
        {text && (
          <span className="inline-block w-0.5 h-4 bg-teal-600 animate-pulse ml-0.5" />
        )}
      </div>
    </div>
  );
}
