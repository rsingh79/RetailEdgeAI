import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';

/** Icon for quick-access entries based on type */
function QuickAccessIcon({ type }) {
  switch (type) {
    case 'desktop':
      return (
        <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z" />
        </svg>
      );
    case 'documents':
      return (
        <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'downloads':
      return (
        <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
      );
    case 'cloud':
      return (
        <svg className="w-5 h-5 text-sky-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      );
  }
}

/**
 * FolderBrowser — Modal dialog for browsing server-side directories.
 *
 * Props:
 *   isOpen      — whether the modal is visible
 *   onClose     — called when Cancel is clicked or backdrop is clicked
 *   onSelect    — called with the chosen folder path string
 *   initialPath — optional starting path to pre-expand
 */
export default function FolderBrowser({ isOpen, onClose, onSelect, initialPath }) {
  const [entries, setEntries] = useState([]);
  const [quickAccess, setQuickAccess] = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [parentPath, setParentPath] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const browse = useCallback(async (folderPath) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.folderPolling.browse(folderPath || null);
      setEntries(result.entries || []);
      setQuickAccess(result.quickAccess || []);
      setCurrentPath(folderPath || null);
      setParentPath(result.parent || null);
      if (result.error) setError(result.error);
    } catch (err) {
      setError(err.message);
      setEntries([]);
      setQuickAccess([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load root when opened
  useEffect(() => {
    if (isOpen) {
      setSelectedPath(initialPath || null);
      browse(initialPath || null);
    }
  }, [isOpen, initialPath, browse]);

  const handleNavigate = (folderPath) => {
    setSelectedPath(folderPath);
    browse(folderPath);
  };

  const handleGoUp = () => {
    if (parentPath && parentPath !== currentPath) {
      browse(parentPath);
      setSelectedPath(parentPath);
    } else {
      // Go to root (drive list)
      browse(null);
      setSelectedPath(null);
    }
  };

  const handleConfirm = () => {
    if (selectedPath) {
      onSelect(selectedPath);
      onClose();
    }
  };

  if (!isOpen) return null;

  // Build breadcrumb segments from currentPath
  const breadcrumbs = [];
  if (currentPath) {
    const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let accumulated = '';
    for (const part of parts) {
      accumulated += (accumulated ? '\\' : '') + part;
      // On Windows, first part like "C:" needs the backslash
      const fullPath = accumulated.includes(':') && !accumulated.includes(':\\')
        ? accumulated + '\\'
        : accumulated;
      breadcrumbs.push({ label: part, path: fullPath });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Select Folder</h3>
          <p className="text-xs text-gray-500 mt-0.5">Browse and select a folder the server can access</p>
        </div>

        {/* Breadcrumb / Path bar */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-1 text-xs overflow-x-auto">
          <button
            onClick={() => { browse(null); setSelectedPath(null); }}
            className="text-brand-600 hover:text-brand-700 font-medium shrink-0"
          >
            Computer
          </button>
          {breadcrumbs.map((bc, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              <span className="text-gray-400">&rsaquo;</span>
              <button
                onClick={() => handleNavigate(bc.path)}
                className="text-brand-600 hover:text-brand-700 font-medium"
              >
                {bc.label}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {/* Up button */}
          {currentPath && (
            <button
              onClick={handleGoUp}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-sm text-gray-600 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>..</span>
            </button>
          )}

          {loading && (
            <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
          )}

          {error && (
            <div className="text-center py-4 text-red-500 text-xs">{error}</div>
          )}

          {/* Quick Access — shown at root level */}
          {!loading && !currentPath && quickAccess.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Quick Access
              </div>
              {quickAccess.map((qa) => (
                <button
                  key={qa.path}
                  onClick={() => handleNavigate(qa.path)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                    selectedPath === qa.path
                      ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                      : 'hover:bg-gray-100 text-gray-700'
                  }`}
                >
                  <QuickAccessIcon type={qa.icon} />
                  <span className="truncate text-left">{qa.name}</span>
                  <svg className="w-3 h-3 text-gray-400 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}

              {/* Separator before drives */}
              {entries.length > 0 && (
                <div className="px-3 pt-3 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Drives
                </div>
              )}
            </>
          )}

          {!loading && entries.length === 0 && quickAccess.length === 0 && !error && (
            <div className="text-center py-8 text-gray-400 text-sm">
              {currentPath ? 'No subfolders found' : 'No drives found'}
            </div>
          )}

          {!loading && entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => handleNavigate(entry.path)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                selectedPath === entry.path
                  ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                  : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              {/* Folder / Drive icon */}
              {!currentPath ? (
                <svg className="w-5 h-5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3.5h14A1.5 1.5 0 0120.5 5v14a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 19V5A1.5 1.5 0 015 3.5zM3.5 15h17" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
              )}
              <span className="truncate text-left">{entry.name}</span>
              {entry.hasChildren && (
                <svg className="w-3 h-3 text-gray-400 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Selected path display */}
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
          <div className="text-xs text-gray-500">Selected:</div>
          <div className="text-sm font-mono text-gray-800 truncate">
            {selectedPath || '(none)'}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedPath}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Select Folder
          </button>
        </div>
      </div>
    </div>
  );
}
