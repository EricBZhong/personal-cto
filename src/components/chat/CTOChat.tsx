'use client';

import { useRef, useEffect, useState } from 'react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { useCTOChat } from '@/hooks/useCTOChat';
import { TaskSuggestionCard } from '@/components/tasks/TaskSuggestionCard';
import type { ChatMessage, ChatThread } from '@/types';

interface CTOChatProps {
  send: (type: string, payload?: Record<string, unknown>) => void;
  connected: boolean;
}

export function CTOChat({ send, connected }: CTOChatProps) {
  const { messages, isStreaming, isWaitingForResponse, sendMessage, abort, model, toggleModel, threads, activeThreadId, createThread, switchThread, deleteThread } = useCTOChat(send);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-full">
      {/* Thread sidebar */}
      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThreadId}
        onNewChat={createThread}
        onSwitch={switchThread}
        onDelete={deleteThread}
      />

      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-1">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full animate-fade-in-up">
              <div className="text-center max-w-lg">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/10 ring-1 ring-indigo-500/20 mb-5">
                  <span className="text-3xl">🧠</span>
                </div>
                <h2 className="text-xl font-semibold text-zinc-200 mb-2">CTO Agent</h2>
                <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mx-auto">
                  Your AI CTO has full context on your codebase, active tasks, and deployment status.
                  Ask it what to work on, discuss architecture, or delegate tasks to engineer agents.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {[
                    'What should we work on next?',
                    'Review open PRs and suggest priorities',
                    'What tech debt should we address?',
                    'Analyze test coverage gaps',
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => sendMessage(suggestion)}
                      disabled={isStreaming || !connected}
                      className="text-xs px-3.5 py-2 rounded-lg bg-zinc-800/80 ring-1 ring-zinc-700/50 text-zinc-300 hover:bg-zinc-700/80 hover:text-white hover:ring-zinc-600/50 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={msg.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i * 20, 100)}ms` }}>
              <MessageWithTasks message={msg} send={send} />
            </div>
          ))}

          {/* Thinking indicator -- shown between send and first token */}
          {isWaitingForResponse && !isStreaming && (
            <div className="flex justify-start mb-4 animate-fade-in-up">
              <div className="max-w-[80%] rounded-2xl px-4 py-3 bg-zinc-800/80 ring-1 ring-zinc-700/50">
                <div className="text-xs font-medium mb-1.5 text-zinc-500">CTO</div>
                <div className="flex items-center gap-1.5 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={sendMessage}
          onAbort={abort}
          isStreaming={isStreaming}
          isWaitingForResponse={isWaitingForResponse}
          disabled={!connected}
          model={model}
          onToggleModel={toggleModel}
        />
      </div>
    </div>
  );
}

/** Thread sidebar -- ChatGPT-style conversation list */
function ThreadSidebar({
  threads,
  activeThreadId,
  onNewChat,
  onSwitch,
  onDelete,
}: {
  threads: ChatThread[];
  activeThreadId: string;
  onNewChat: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // F27: Reset confirmDeleteId when thread list changes to prevent stale confirmations
  useEffect(() => {
    setConfirmDeleteId(null);
  }, [threads]);

  return (
    <div className="w-56 bg-zinc-950/50 border-r border-zinc-800/60 flex flex-col flex-shrink-0">
      {/* New Chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm text-zinc-300 rounded-lg bg-zinc-800/50 ring-1 ring-zinc-700/50 hover:bg-zinc-800 hover:ring-zinc-600/50 transition-all duration-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 && (
          <div className="text-xs text-zinc-600 text-center mt-6 px-3">
            No conversations yet
          </div>
        )}
        {threads.map((thread) => {
          const isActive = thread.id === activeThreadId;
          const isConfirmingDelete = confirmDeleteId === thread.id;

          return (
            <div
              key={thread.id}
              className={`group relative flex items-center rounded-lg mb-0.5 cursor-pointer transition-all duration-200 ${
                isActive
                  ? 'bg-zinc-800/80 text-white ring-1 ring-zinc-700/40'
                  : 'text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200'
              }`}
            >
              <button
                onClick={() => onSwitch(thread.id)}
                className="flex-1 text-left px-3 py-2.5 text-sm truncate min-w-0"
                title={thread.title}
              >
                {thread.title}
              </button>

              {/* Delete button */}
              <div className={`flex-shrink-0 pr-1.5 ${isActive || isConfirmingDelete ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity duration-200`}>
                {isConfirmingDelete ? (
                  <div className="flex gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(thread.id); setConfirmDeleteId(null); }}
                      className="p-1 text-red-400 hover:text-red-300 text-xs transition-colors duration-200"
                      title="Confirm delete"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                      className="p-1 text-zinc-500 hover:text-zinc-300 text-xs transition-colors duration-200"
                      title="Cancel"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(thread.id); }}
                    className="p-1 text-zinc-600 hover:text-red-400 transition-colors duration-200"
                    title="Delete conversation"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Renders a message bubble, plus any task_assignment blocks as interactive cards */
function MessageWithTasks({ message, send }: { message: ChatMessage; send: (type: string, payload?: Record<string, unknown>) => void }) {
  if (message.role !== 'assistant' || message.isStreaming) {
    return <MessageBubble message={message} />;
  }

  // Parse out task_assignment blocks
  const parts = splitTaskAssignments(message.content);

  if (parts.length === 1 && !parts[0].isTask) {
    return <MessageBubble message={message} />;
  }

  return (
    <div className="mb-4">
      {parts.map((part, i) => {
        if (part.isTask && part.task) {
          return <TaskSuggestionCard key={i} task={part.task} send={send} />;
        }
        if (part.text.trim()) {
          return (
            <MessageBubble
              key={i}
              message={{ ...message, content: part.text, id: `${message.id}-${i}` }}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

interface ParsedPart {
  isTask: boolean;
  text: string;
  task?: {
    title: string;
    description: string;
    branch?: string;
    model?: string;
    maxBudget?: number;
    priority?: string;
  };
}

function splitTaskAssignments(text: string): ParsedPart[] {
  const parts: ParsedPart[] = [];
  const regex = /<task_assignment>\s*(\{[\s\S]*?\})\s*<\/task_assignment>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before the task
    if (match.index > lastIndex) {
      parts.push({ isTask: false, text: text.slice(lastIndex, match.index) });
    }

    try {
      const task = JSON.parse(match[1]);
      parts.push({ isTask: true, text: match[0], task });
    } catch {
      parts.push({ isTask: false, text: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last task
  if (lastIndex < text.length) {
    parts.push({ isTask: false, text: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ isTask: false, text });
  }

  return parts;
}
