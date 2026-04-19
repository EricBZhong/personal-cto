'use client';

import { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from '@/stores/chat-store';
import type { ChatMessage } from '@/types';

export function useCTOChat(send: (type: string, payload?: Record<string, unknown>) => void) {
  const { messages, isStreaming, isWaitingForResponse, threads, activeThreadId } = useChatStore();
  const [model, setModel] = useState<'sonnet' | 'opus'>('opus');

  const sendMessage = useCallback((text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date().toISOString(),
    };

    useChatStore.getState().addMessage(userMsg);
    useChatStore.getState().setWaiting(true);
    send('chat:send', { message: text.trim(), model });
  }, [send, isStreaming, model]);

  const abort = useCallback(() => {
    send('chat:abort');
  }, [send]);

  const toggleModel = useCallback(() => {
    setModel((prev) => (prev === 'sonnet' ? 'opus' : 'sonnet'));
  }, []);

  const createThread = useCallback(() => {
    send('thread:create');
  }, [send]);

  const switchThread = useCallback((threadId: string) => {
    send('thread:switch', { threadId });
  }, [send]);

  const deleteThread = useCallback((threadId: string) => {
    send('thread:delete', { threadId });
  }, [send]);

  return { messages, isStreaming, isWaitingForResponse, sendMessage, abort, model, toggleModel, threads, activeThreadId, createThread, switchThread, deleteThread };
}
