import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MessageFeedback from './MessageFeedback';

/**
 * Renders a single chat message (user or assistant).
 * User messages: teal, right-aligned.
 * Assistant messages: white, left-aligned, with markdown rendering.
 */
export default function ChatMessage({ message, onFeedback }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-teal-600 text-white'
            : 'bg-white border border-gray-200 text-gray-800 shadow-sm'
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-code:text-teal-700 prose-code:bg-teal-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-table:text-sm prose-th:text-left prose-th:px-3 prose-th:py-1.5 prose-th:bg-gray-50 prose-td:px-3 prose-td:py-1.5 prose-td:border-t prose-a:text-teal-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Feedback + stats for assistant messages */}
        {!isUser && (
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
            <MessageFeedback
              messageId={message.id}
              currentRating={message.feedbackRating}
              onFeedback={onFeedback}
            />
            {message.durationMs && (
              <span className="text-xs text-gray-400">
                {(message.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
