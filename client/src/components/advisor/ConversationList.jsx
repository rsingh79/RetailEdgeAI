import { useState } from 'react';

/**
 * Scrollable list of past conversations in the sidebar.
 */
export default function ConversationList({
  conversations,
  activeId,
  loading,
  onSelect,
  onDelete,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-sm text-gray-400 text-center">
          No conversations yet.
          <br />
          Start by asking a question!
        </p>
      </div>
    );
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`group px-3 py-2.5 cursor-pointer border-b border-gray-100 hover:bg-gray-50 transition ${
            activeId === conv.id ? 'bg-teal-50 border-l-2 border-l-teal-600' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-1">
            <p className="text-sm font-medium text-gray-800 truncate flex-1">
              {conv.title || 'New conversation'}
            </p>
            {/* Delete button */}
            {confirmDelete === conv.id ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                  setConfirmDelete(null);
                }}
                className="text-xs text-red-600 hover:text-red-800 font-medium flex-shrink-0"
              >
                Confirm
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(conv.id);
                  setTimeout(() => setConfirmDelete(null), 3000);
                }}
                className="opacity-0 group-hover:opacity-100 transition text-gray-400 hover:text-red-500 flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-400">
              {formatDate(conv.lastMessageAt || conv.createdAt)}
            </span>
            {conv.messageCount > 0 && (
              <span className="text-xs text-gray-400">
                · {conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
