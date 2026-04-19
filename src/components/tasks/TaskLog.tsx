'use client';

import { useRef, useEffect } from 'react';
import type { TaskLog as TaskLogType } from '@/types';

interface TaskLogProps {
  logs: TaskLogType[];
  streamingOutput?: string;
}

export function TaskLog({ logs, streamingOutput }: TaskLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, streamingOutput]);

  return (
    <div
      ref={scrollRef}
      className="bg-zinc-950 rounded-lg border border-zinc-800 font-mono text-xs overflow-y-auto max-h-[500px] p-3"
    >
      {logs.map((log) => (
        <div key={log.id} className="mb-1">
          <span className={`${
            log.source === 'system' ? 'text-yellow-500' :
            log.source === 'stderr' ? 'text-red-400' :
            'text-zinc-400'
          }`}>
            [{log.source}]
          </span>
          <span className="text-zinc-500 ml-2">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          <pre className="text-zinc-300 whitespace-pre-wrap mt-0.5 ml-4">{log.content}</pre>
        </div>
      ))}
      {streamingOutput && (
        <pre className="text-green-400 whitespace-pre-wrap">{streamingOutput}</pre>
      )}
      {logs.length === 0 && !streamingOutput && (
        <div className="text-zinc-600 text-center py-8">No logs yet</div>
      )}
    </div>
  );
}
