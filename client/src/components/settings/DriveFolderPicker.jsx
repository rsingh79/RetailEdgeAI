import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';

/**
 * DriveFolderPicker — Modal dialog for browsing Google Drive folders.
 *
 * Props:
 *   isOpen         — whether the modal is visible
 *   onClose        — called when Cancel is clicked or backdrop is clicked
 *   onSelect       — called with { id, name } of the chosen folder
 *   integrationId  — optional: use a specific integration's tokens for browsing
 */
export default function DriveFolderPicker({ isOpen, onClose, onSelect, integrationId }) {
  const [folders, setFolders] = useState([]);
  const [currentParentId, setCurrentParentId] = useState('root');
  const [breadcrumb, setBreadcrumb] = useState([{ id: 'root', name: 'My Drive' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadFolders = useCallback(async (parentId) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.drive.getFolders(parentId, integrationId);
      setFolders(result.folders || []);
    } catch (err) {
      setError(err.message);
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [integrationId]);

  useEffect(() => {
    if (isOpen) {
      setCurrentParentId('root');
      setBreadcrumb([{ id: 'root', name: 'My Drive' }]);
      loadFolders('root');
    }
  }, [isOpen, loadFolders]);

  const handleNavigateInto = (folder) => {
    setCurrentParentId(folder.id);
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
    loadFolders(folder.id);
  };

  const handleBreadcrumbClick = (index) => {
    const target = breadcrumb[index];
    setCurrentParentId(target.id);
    setBreadcrumb((prev) => prev.slice(0, index + 1));
    loadFolders(target.id);
  };

  const handleSelectThisFolder = () => {
    const current = breadcrumb[breadcrumb.length - 1];
    onSelect({ id: current.id, name: current.name });
    onClose();
  };

  if (!isOpen) return null;

  const currentFolderName = breadcrumb[breadcrumb.length - 1]?.name || 'My Drive';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Select Google Drive Folder</h3>
              <p className="text-xs text-gray-500">Choose a folder to watch for invoice files</p>
            </div>
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-1 text-xs overflow-x-auto">
          {breadcrumb.map((bc, i) => (
            <span key={bc.id} className="flex items-center gap-1 shrink-0">
              {i > 0 && <span className="text-gray-400">&rsaquo;</span>}
              <button
                onClick={() => handleBreadcrumbClick(i)}
                className={`font-medium ${i === breadcrumb.length - 1 ? 'text-gray-700' : 'text-brand-600 hover:text-brand-700'}`}
              >
                {bc.name}
              </button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-2">
          {/* Back / up button */}
          {breadcrumb.length > 1 && (
            <button
              onClick={() => handleBreadcrumbClick(breadcrumb.length - 2)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 text-sm text-gray-600 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span>..</span>
            </button>
          )}

          {loading && (
            <div className="text-center py-8 text-gray-400 text-sm">Loading folders...</div>
          )}

          {error && (
            <div className="text-center py-4 text-red-500 text-xs">{error}</div>
          )}

          {!loading && folders.length === 0 && !error && (
            <div className="text-center py-8 text-gray-400 text-sm">
              No subfolders found
            </div>
          )}

          {!loading && folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => handleNavigateInto(folder)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-gray-100 text-gray-700 transition"
            >
              <svg className="w-5 h-5 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span className="truncate text-left">{folder.name}</span>
              <svg className="w-3 h-3 text-gray-400 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {/* Current selection */}
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
          <div className="text-xs text-gray-500">Will watch:</div>
          <div className="text-sm font-medium text-gray-800 truncate">
            {currentFolderName}
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
            onClick={handleSelectThisFolder}
            className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition"
          >
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );
}
