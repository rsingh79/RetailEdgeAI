import { useState } from 'react';

export default function ConfirmationCard({ action, onConfirm, onReject, isLoading }) {
  const [result, setResult] = useState(null);

  const actionLabels = {
    add: 'Add new condition',
    remove: 'Remove condition',
    replace: 'Replace condition',
  };

  const agentLabels = {
    ocr_extraction: 'Invoice OCR',
    product_matching: 'Product Matching',
  };

  if (result) {
    return (
      <div className={`rounded-lg border p-3 text-sm ${result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className={`font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}>
          {result.success ? 'Change applied' : 'Change failed'}
        </div>
        <div className={`mt-1 ${result.success ? 'text-green-600' : 'text-red-600'}`}>
          {result.message}
        </div>
        {result.conflicts?.length > 0 && (
          <div className="mt-2 text-amber-700 bg-amber-50 rounded p-2 text-xs">
            {result.conflicts.length} conflict(s) detected — check your prompt configuration.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
      <div className="font-medium text-teal-900 mb-2">Proposed Change</div>

      <div className="space-y-1.5 text-teal-800 text-xs">
        <div className="flex gap-2">
          <span className="font-medium w-16 shrink-0">Action:</span>
          <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700">
            {actionLabels[action.action] || action.action}
          </span>
        </div>

        <div className="flex gap-2">
          <span className="font-medium w-16 shrink-0">Agent:</span>
          <span>{agentLabels[action.agentTypeKey] || action.agentTypeKey}</span>
        </div>

        {action.conditionKey && (
          <div className="flex gap-2">
            <span className="font-medium w-16 shrink-0">Target:</span>
            <span className="font-mono text-xs">{action.conditionKey}</span>
          </div>
        )}

        {action.customText && (
          <div className="mt-2">
            <span className="font-medium">New text:</span>
            <div className="mt-1 bg-white rounded border border-teal-100 p-2 text-xs font-mono whitespace-pre-wrap">
              {action.customText}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={async () => {
            const res = await onConfirm(action);
            setResult(res);
          }}
          disabled={isLoading}
          className="flex-1 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {isLoading ? 'Applying...' : 'Accept'}
        </button>
        <button
          onClick={onReject}
          disabled={isLoading}
          className="flex-1 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
