import { useState, useCallback, useRef } from 'react';
import { api, chatStream } from '../services/api';

/**
 * Custom hook for the Business AI Advisor chat.
 * Manages conversations, messages, streaming, and feedback.
 */
export function useChat() {
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolProgress, setToolProgress] = useState([]);
  const [error, setError] = useState(null);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // Ref to track if we should abort streaming
  const abortRef = useRef(null);

  // ── Load all conversations ──
  const loadConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const data = await api.chat.getConversations();
      setConversations(data);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(err.message);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  // ── Load a specific conversation with messages ──
  const loadConversation = useCallback(async (id) => {
    try {
      setError(null);
      const data = await api.chat.getConversation(id);
      setActiveConversation(data);
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load conversation:', err);
      setError(err.message);
    }
  }, []);

  // ── Create a new conversation ──
  const createConversation = useCallback(async () => {
    try {
      setError(null);
      const conv = await api.chat.createConversation();
      setActiveConversation(conv);
      setMessages([]);
      // Prepend to conversations list
      setConversations((prev) => [conv, ...prev]);
      return conv;
    } catch (err) {
      console.error('Failed to create conversation:', err);
      setError(err.message);
      return null;
    }
  }, []);

  // ── Delete a conversation ──
  const deleteConversation = useCallback(
    async (id) => {
      try {
        await api.chat.deleteConversation(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversation?.id === id) {
          setActiveConversation(null);
          setMessages([]);
        }
      } catch (err) {
        console.error('Failed to delete conversation:', err);
        setError(err.message);
      }
    },
    [activeConversation]
  );

  // ── Send a message and stream the response ──
  const sendMessage = useCallback(
    async (content) => {
      if (!content.trim() || isStreaming) return;

      setError(null);
      let conversationId = activeConversation?.id;

      // Create conversation if needed
      if (!conversationId) {
        const conv = await createConversation();
        if (!conv) return;
        conversationId = conv.id;
      }

      // Optimistically add user message
      const userMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Update conversation title if first message
      if (messages.length === 0) {
        const title = content.trim().substring(0, 100);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId ? { ...c, title } : c
          )
        );
      }

      setIsStreaming(true);
      setStreamingText('');
      setToolProgress([]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await chatStream(conversationId, content.trim());
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullText = '';
        let buffer = '';
        let usageStats = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          let currentEvent = null;
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith('data: ') && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6));

                if (currentEvent === 'text') {
                  fullText += data.text;
                  setStreamingText(fullText);
                } else if (currentEvent === 'tool_progress') {
                  setToolProgress((prev) => {
                    // Update existing tool status or add new
                    const exists = prev.find(
                      (t) => t.tool === data.tool
                    );
                    if (exists) {
                      return prev.map((t) =>
                        t.tool === data.tool ? { ...t, ...data } : t
                      );
                    }
                    return [...prev, data];
                  });
                } else if (currentEvent === 'done') {
                  usageStats = data;
                } else if (currentEvent === 'error') {
                  setError(data.error);
                }
              } catch {
                // Ignore malformed JSON
              }
              currentEvent = null;
            } else if (line === '') {
              currentEvent = null;
            }
          }
        }

        // Finalize — add assistant message
        if (fullText) {
          const assistantMessage = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: fullText,
            inputTokens: usageStats?.inputTokens,
            outputTokens: usageStats?.outputTokens,
            costUsd: usageStats?.costUsd,
            durationMs: usageStats?.durationMs,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);

          // Update conversation in list
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? {
                    ...c,
                    lastMessageAt: new Date().toISOString(),
                    messageCount: (c.messageCount || 0) + 2,
                  }
                : c
            )
          );
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Chat stream error:', err);
          setError(err.message);
        }
      } finally {
        setIsStreaming(false);
        setStreamingText('');
        setToolProgress([]);
        abortRef.current = null;
      }
    },
    [activeConversation, isStreaming, messages.length, createConversation]
  );

  // ── Stop streaming ──
  const stopStreaming = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  // ── Submit feedback for a message ──
  const submitFeedback = useCallback(async (messageId, rating) => {
    try {
      await api.chat.sendFeedback(messageId, rating);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, feedbackRating: rating } : m
        )
      );
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  }, []);

  // ── Select a conversation ──
  const selectConversation = useCallback(
    async (id) => {
      if (id === activeConversation?.id) return;
      await loadConversation(id);
    },
    [activeConversation, loadConversation]
  );

  // ── Start a new chat ──
  const newChat = useCallback(() => {
    setActiveConversation(null);
    setMessages([]);
    setError(null);
  }, []);

  return {
    // State
    conversations,
    activeConversation,
    messages,
    isStreaming,
    streamingText,
    toolProgress,
    error,
    loadingConversations,

    // Actions
    loadConversations,
    loadConversation,
    selectConversation,
    createConversation,
    deleteConversation,
    sendMessage,
    stopStreaming,
    submitFeedback,
    newChat,
  };
}
