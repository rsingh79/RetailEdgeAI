import { useState, useRef, useEffect } from 'react';
import { api } from '../../services/api';
import ConfirmationCard from './ConfirmationCard';

export default function PromptChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [hasUnresolved, setHasUnresolved] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      // Load existing conversation history
      api.promptChat.getHistory().then((history) => {
        if (history.length > 0) {
          setMessages(history.map((m, i) => ({
            id: i,
            role: m.role,
            content: m.content,
          })));
        }
      }).catch(() => {});

      // Check for unresolved conflicts
      api.prompts.getConflicts().then((conflicts) => {
        setHasUnresolved(conflicts.length > 0);
      }).catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg = { id: Date.now(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setPendingAction(null);

    try {
      const result = await api.promptChat.sendMessage(text);
      const assistantMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: result.response,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      if (result.proposedAction) {
        setPendingAction(result.proposedAction);
      }
    } catch (err) {
      setMessages((prev) => [...prev, {
        id: Date.now() + 1,
        role: 'error',
        content: err.message || 'Failed to get response',
      }]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConfirm(action) {
    setIsLoading(true);
    try {
      const result = await api.promptChat.confirmAction(action);
      setPendingAction(null);
      return result;
    } catch (err) {
      return { success: false, message: err.message };
    } finally {
      setIsLoading(false);
    }
  }

  function handleReject() {
    setPendingAction(null);
    setMessages((prev) => [...prev, {
      id: Date.now(),
      role: 'assistant',
      content: 'Change rejected. Let me know if you\'d like to try a different approach.',
    }]);
  }

  async function handleClear() {
    await api.promptChat.clearHistory().catch(() => {});
    setMessages([]);
    setPendingAction(null);
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-teal-600 text-white shadow-lg hover:bg-teal-700 transition-all flex items-center justify-center"
        title="AI Prompt Configuration"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
        {hasUnresolved && !isOpen && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 rounded-full text-[10px] font-bold flex items-center justify-center">!</span>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-4 left-4 sm:left-auto sm:right-6 z-50 sm:w-96 h-[500px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-teal-600 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div>
              <div className="font-semibold text-sm">AI Prompt Assistant</div>
              <div className="text-teal-100 text-xs">Customize your AI behavior</div>
            </div>
            <button onClick={handleClear} className="text-teal-200 hover:text-white text-xs">
              Clear
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-xs mt-8 px-4">
                <p className="font-medium text-gray-500 mb-2">How can I help?</p>
                <p>Describe any issues with invoice processing or product matching, and I'll help adjust your AI prompts.</p>
                <div className="mt-4 space-y-1.5 text-left">
                  <button
                    onClick={() => setInput('Show me my current OCR extraction rules')}
                    className="w-full text-left px-3 py-1.5 rounded bg-gray-50 hover:bg-gray-100 text-gray-600"
                  >
                    Show my current OCR rules
                  </button>
                  <button
                    onClick={() => setInput('Show me my prompt change history')}
                    className="w-full text-left px-3 py-1.5 rounded bg-gray-50 hover:bg-gray-100 text-gray-600"
                  >
                    Show prompt change history
                  </button>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-teal-600 text-white'
                    : msg.role === 'error'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-gray-100 text-gray-800'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {pendingAction && (
              <ConfirmationCard
                action={pendingAction}
                onConfirm={handleConfirm}
                onReject={handleReject}
                isLoading={isLoading}
              />
            )}

            {isLoading && !pendingAction && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2 text-sm text-gray-500">
                  <div className="flex gap-1">
                    <span className="animate-bounce">.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="border-t border-gray-200 p-3 shrink-0">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe what you need changed..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="rounded-lg bg-teal-600 px-3 py-2 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
