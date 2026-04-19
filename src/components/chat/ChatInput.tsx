'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  isWaitingForResponse?: boolean;
  disabled?: boolean;
  model: 'sonnet' | 'opus';
  onToggleModel: () => void;
}

export function ChatInput({ onSend, onAbort, isStreaming, isWaitingForResponse, disabled, model, onToggleModel }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = isStreaming || isWaitingForResponse;

  const handleSend = useCallback(() => {
    if (!input.trim() || isBusy || disabled) return;
    onSend(input);
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isBusy, disabled, onSend]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isOpus = model === 'opus';

  return (
    <div className="border-t border-zinc-800 bg-zinc-950/80 backdrop-blur-sm p-4">
      <div className="flex items-end gap-3 max-w-4xl mx-auto">
        {/* Model toggle */}
        <button
          onClick={onToggleModel}
          disabled={isStreaming}
          title={isOpus ? 'Using Opus (click for Sonnet)' : 'Using Sonnet (click for Opus)'}
          className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ring-1 ${
            isOpus
              ? 'bg-purple-500/15 ring-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:ring-purple-500/40'
              : 'bg-zinc-900 ring-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 hover:ring-zinc-600'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <span className={`w-2 h-2 rounded-full transition-colors duration-200 ${isOpus ? 'bg-purple-400' : 'bg-zinc-500'}`} />
          {isOpus ? 'Opus' : 'Sonnet'}
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isBusy ? 'CTO is thinking...' : 'Message the CTO...'}
            disabled={disabled || isBusy}
            rows={1}
            className="w-full resize-none rounded-xl bg-zinc-900 ring-1 ring-zinc-800 text-zinc-100 placeholder-zinc-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 hover:ring-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
          />
        </div>
        {isBusy ? (
          <button
            onClick={onAbort}
            className="flex-shrink-0 bg-red-600 hover:bg-red-500 text-white rounded-xl px-5 py-3 text-sm font-medium transition-all duration-200 shadow-sm hover:shadow-red-500/20 ring-1 ring-red-500/30"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!input.trim() || disabled}
            title={disabled ? 'Not connected to server' : undefined}
            className="flex-shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:ring-1 disabled:ring-zinc-700 disabled:cursor-not-allowed text-white rounded-xl px-5 py-3 text-sm font-medium transition-all duration-200 shadow-sm hover:shadow-indigo-500/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        )}
      </div>
      <div className="text-center mt-2 text-[10px] text-zinc-600">
        Enter to send &middot; Shift+Enter for new line &middot; {isOpus ? 'Opus mode (higher cost)' : 'Click model to switch'}
      </div>
    </div>
  );
}
