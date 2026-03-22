import { useEffect, useRef } from 'react';
import { useChat } from '../../hooks/useChat';
import ConversationList from './ConversationList';
import ChatMessage from './ChatMessage';
import StreamingMessage from './StreamingMessage';
import ChatInput from './ChatInput';
import QuickActions from './QuickActions';

/**
 * Main chat panel layout: sidebar + chat area.
 */
export default function ChatPanel() {
  const {
    conversations,
    activeConversation,
    messages,
    isStreaming,
    streamingText,
    toolProgress,
    error,
    loadingConversations,
    loadConversations,
    selectConversation,
    deleteConversation,
    sendMessage,
    submitFeedback,
    newChat,
  } = useChat();

  const messagesEndRef = useRef(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const isEmpty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-gray-50">
      {/* Conversation sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-3 border-b border-gray-200">
          <button
            onClick={newChat}
            className="w-full px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Chat
          </button>
        </div>
        <ConversationList
          conversations={conversations}
          activeId={activeConversation?.id}
          loading={loadingConversations}
          onSelect={selectConversation}
          onDelete={deleteConversation}
        />
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-6 py-3 border-b border-gray-200 bg-white">
          <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
            AI Business Advisor
          </h1>
          {activeConversation?.title && (
            <p className="text-sm text-gray-500 mt-0.5 truncate">
              {activeConversation.title}
            </p>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {isEmpty ? (
            <QuickActions onSelect={sendMessage} />
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  onFeedback={submitFeedback}
                />
              ))}
              {isStreaming && (
                <StreamingMessage
                  text={streamingText}
                  toolProgress={toolProgress}
                />
              )}
            </>
          )}

          {error && (
            <div className="mx-auto max-w-2xl p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <ChatInput
          onSend={sendMessage}
          disabled={isStreaming}
        />
      </div>
    </div>
  );
}
