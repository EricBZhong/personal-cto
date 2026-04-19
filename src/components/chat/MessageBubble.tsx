'use client';

import type { ChatMessage } from '@/types';
import { TokenBadge } from '@/components/shared/StatusBadge';

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
      style={{
        animation: 'msg-appear 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes msg-appear {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 transition-colors duration-200 ${
          isUser
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20'
            : 'bg-zinc-800/80 text-zinc-100 ring-1 ring-zinc-700/50'
        }`}
      >
        {/* Role label */}
        <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${isUser ? 'text-indigo-200' : 'text-zinc-500'}`}>
          {isUser ? 'You' : 'CTO'}
        </div>

        {/* Content */}
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {renderContent(message.content, isUser)}
          {message.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm" />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between mt-2.5 gap-2">
          <span className={`text-[10px] ${isUser ? 'text-indigo-300/70' : 'text-zinc-600'}`}>
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          {message.tokensUsed && <TokenBadge tokens={message.tokensUsed} />}
        </div>
      </div>
    </div>
  );
}

/** Render content with inline code block styling */
function renderContent(content: string, isUser: boolean) {
  if (!content) return null;

  // Split on code blocks (```...```)
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf('\n');
      const lang = newlineIdx > 0 ? inner.slice(0, newlineIdx).trim() : '';
      const code = newlineIdx > 0 ? inner.slice(newlineIdx + 1) : inner;

      return (
        <pre
          key={i}
          className={`my-2 p-3 rounded-lg text-xs font-mono overflow-x-auto leading-relaxed ${
            isUser
              ? 'bg-indigo-700/40 text-indigo-100'
              : 'bg-zinc-950 text-zinc-300 ring-1 ring-zinc-800'
          }`}
        >
          {lang && (
            <div className={`text-[10px] mb-2 font-sans font-medium ${isUser ? 'text-indigo-300/70' : 'text-zinc-500'}`}>
              {lang}
            </div>
          )}
          <code>{code}</code>
        </pre>
      );
    }

    // Handle inline code (`...`)
    const inlineParts = part.split(/(`[^`]+`)/g);
    return inlineParts.map((inline, j) => {
      if (inline.startsWith('`') && inline.endsWith('`')) {
        return (
          <code
            key={`${i}-${j}`}
            className={`px-1 py-0.5 rounded text-xs font-mono ${
              isUser
                ? 'bg-indigo-700/40 text-indigo-100'
                : 'bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800'
            }`}
          >
            {inline.slice(1, -1)}
          </code>
        );
      }
      return <span key={`${i}-${j}`}>{inline}</span>;
    });
  });
}
