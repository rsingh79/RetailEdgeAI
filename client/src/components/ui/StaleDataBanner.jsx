import { useState } from 'react';

export default function StaleDataBanner({ onRefresh }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-amber-800">
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
        This data has been updated in another tab.
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onRefresh}
          className="text-teal-700 font-medium hover:text-teal-900 hover:underline"
        >
          Refresh to see changes
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-600 hover:text-amber-800"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
