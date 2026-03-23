/**
 * Thumbs up/down feedback below assistant messages.
 */
export default function MessageFeedback({ messageId, currentRating, onFeedback }) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onFeedback(messageId, 5)}
        className={`p-1 rounded transition ${
          currentRating === 5
            ? 'text-green-600 bg-green-50'
            : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
        }`}
        title="Helpful"
      >
        <svg className="w-3.5 h-3.5" fill={currentRating === 5 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 4.5c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 01-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 00-1.423-.23H5.904M14.25 9h2.25M5.904 18.75c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 01-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 10.203 4.167 9.75 5 9.75h1.053c.472 0 .745.556.5.96a8.958 8.958 0 00-1.302 4.665c0 1.194.232 2.333.654 3.375z" />
        </svg>
      </button>
      <button
        onClick={() => onFeedback(messageId, 1)}
        className={`p-1 rounded transition ${
          currentRating === 1
            ? 'text-red-600 bg-red-50'
            : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
        }`}
        title="Not helpful"
      >
        <svg className="w-3.5 h-3.5" fill={currentRating === 1 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M17.367 13.5c-.806 0-1.533.446-2.031 1.08a9.041 9.041 0 01-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 00-.322 1.672V21a.75.75 0 01-.75.75A2.25 2.25 0 017.5 19.5c0-1.152.26-2.243.723-3.218.266-.558-.107-1.282-.725-1.282H4.372c-1.026 0-1.945-.694-2.054-1.715A12.134 12.134 0 012.25 12c0-2.848.992-5.464 2.649-7.521.388-.482.987-.729 1.605-.729h2.024c.483 0 .964.078 1.423.23l3.114 1.04c.459.153.94.23 1.423.23h3.114M9.75 15H7.5m10.596-5.25c-.083-.205-.173-.405-.27-.602-.197-.4.078-.898.523-.898h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398-.306.774-1.086 1.227-1.918 1.227h-1.053c-.472 0-.745-.556-.5-.96a8.958 8.958 0 001.302-4.665 8.95 8.95 0 00-.654-3.375z" />
        </svg>
      </button>
    </div>
  );
}
