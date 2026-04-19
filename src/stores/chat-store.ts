import { create } from 'zustand';
import type { ChatMessage, ChatThread } from '@/types';

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  isWaitingForResponse: boolean;
  streamingMessageId: string | null;
  threads: ChatThread[];
  activeThreadId: string;

  addMessage: (msg: ChatMessage) => void;
  appendChunk: (messageId: string, text: string) => void;
  finishStreaming: (messageId: string, fullText: string, tokensUsed?: number) => void;
  setError: (messageId: string, error: string) => void;
  setHistory: (messages: ChatMessage[]) => void;
  startStreaming: (messageId: string) => void;
  setWaiting: (waiting: boolean) => void;
  clearMessages: () => void;

  // Thread actions
  setThreads: (threads: ChatThread[], activeThreadId: string) => void;
  addThread: (thread: ChatThread) => void;
  switchToThread: (threadId: string, messages: ChatMessage[]) => void;
  removeThread: (threadId: string) => void;
  setActiveThreadId: (threadId: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  isStreaming: false,
  isWaitingForResponse: false,
  streamingMessageId: null,
  threads: [],
  activeThreadId: 'default',

  addMessage: (msg) => {
    set((state) => ({ messages: [...state.messages, msg] }));
  },

  startStreaming: (messageId) => {
    const assistantMsg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    };
    set((state) => ({
      messages: [...state.messages, assistantMsg],
      isStreaming: true,
      isWaitingForResponse: false,
      streamingMessageId: messageId,
    }));
  },

  setWaiting: (waiting) => {
    set({ isWaitingForResponse: waiting });
  },

  appendChunk: (messageId, text) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + text } : m
      ),
    }));
  },

  finishStreaming: (messageId, fullText, tokensUsed) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: fullText, isStreaming: false, tokensUsed }
          : m
      ),
      isStreaming: false,
      isWaitingForResponse: false,
      streamingMessageId: null,
    }));
  },

  setError: (messageId, error) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId
          ? { ...m, content: `Error: ${error}`, isStreaming: false }
          : m
      ),
      isStreaming: false,
      isWaitingForResponse: false,
      streamingMessageId: null,
    }));
  },

  setHistory: (messages) => {
    set({ messages, isStreaming: false, isWaitingForResponse: false, streamingMessageId: null });
  },

  clearMessages: () => {
    set({ messages: [], isStreaming: false, streamingMessageId: null });
  },

  // Thread actions
  setThreads: (threads, activeThreadId) => {
    // Validate activeThreadId exists in the thread list
    const exists = threads.some((t) => t.id === activeThreadId);
    const safeActiveId = exists ? activeThreadId : threads[0]?.id || activeThreadId;
    set({ threads, activeThreadId: safeActiveId });
  },

  addThread: (thread) => {
    set((state) => ({
      threads: [thread, ...state.threads],
      activeThreadId: thread.id,
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
    }));
  },

  switchToThread: (threadId, messages) => {
    set({
      activeThreadId: threadId,
      messages,
      isStreaming: false,
      streamingMessageId: null,
    });
  },

  removeThread: (threadId) => {
    set((state) => {
      const remaining = state.threads.filter((t) => t.id !== threadId);
      // If we deleted the active thread, switch to the first remaining
      const needsSwitch = state.activeThreadId === threadId;
      return {
        threads: remaining,
        ...(needsSwitch ? {
          activeThreadId: remaining[0]?.id || state.activeThreadId,
          messages: [],
          isStreaming: false,
          streamingMessageId: null,
        } : {}),
      };
    });
  },

  setActiveThreadId: (threadId) => {
    set({ activeThreadId: threadId });
  },
}));
