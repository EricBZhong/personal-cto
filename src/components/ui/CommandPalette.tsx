'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useWs } from '@/components/layout/DashboardShell';
import { useTaskStore } from '@/stores/task-store';
import { useToastStore } from '@/stores/toast-store';

interface Command {
  id: string;
  label: string;
  category: 'navigation' | 'action' | 'task';
  action: () => void;
}

const categoryIcons: Record<string, string> = {
  navigation: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101',
  action: 'M13 10V3L4 14h7v7l9-11h-7z',
  task: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
};

const navCommands: Array<{ path: string; label: string; keywords?: string }> = [
  { path: '/chat', label: 'CTO Chat', keywords: 'message talk ai' },
  { path: '/tasks', label: 'Task Board', keywords: 'kanban board work' },
  { path: '/pr-reviews', label: 'PR Reviews', keywords: 'pull request code review' },
  { path: '/engineers', label: 'Engineers', keywords: 'workers agents running' },
  { path: '/compliance', label: 'Compliance', keywords: 'soc2 vanta security' },
  { path: '/dogfood', label: 'Dogfood', keywords: 'test benchmark eval' },
  { path: '/analytics', label: 'Analytics', keywords: 'tokens usage stats cost' },
  { path: '/activity', label: 'Activity', keywords: 'log timeline history' },
  { path: '/slack', label: 'Slack', keywords: 'messages dm channel' },
  { path: '/settings', label: 'Settings', keywords: 'config preferences setup' },
];

/** Highlight matching text in search results */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-indigo-400 font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { send } = useWs();
  const tasks = useTaskStore((s) => s.tasks);

  // Toggle palette with Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // Navigation commands
    for (const nav of navCommands) {
      cmds.push({
        id: `nav-${nav.path}`,
        label: `Go to ${nav.label}`,
        category: 'navigation',
        action: () => { router.push(nav.path); setOpen(false); },
      });
    }

    // Quick actions
    cmds.push({
      id: 'action-approve-all',
      label: 'Approve all suggested tasks',
      category: 'action',
      action: () => { send('task:approve_all'); setOpen(false); },
    });
    cmds.push({
      id: 'action-kill-all',
      label: 'Kill all engineers',
      category: 'action',
      action: () => { send('engineer:kill_all'); setOpen(false); },
    });
    cmds.push({
      id: 'action-checkin',
      label: 'Trigger daily check-in',
      category: 'action',
      action: () => { send('checkin:trigger'); setOpen(false); },
    });
    cmds.push({
      id: 'action-refresh',
      label: 'Refresh tasks',
      category: 'action',
      action: () => { send('task:list'); setOpen(false); },
    });

    // Task search
    for (const task of tasks.slice(0, 50)) {
      cmds.push({
        id: `task-${task.id}`,
        label: `${task.title} [${task.status}]`,
        category: 'task',
        action: () => {
          // Re-check task existence before navigating
          const currentTask = useTaskStore.getState().tasks.find(t => t.id === task.id);
          if (!currentTask) {
            useToastStore.getState().addToast('error', `Task "${task.title}" no longer exists`);
            setOpen(false);
            return;
          }
          useTaskStore.getState().selectTask(task.id);
          router.push('/tasks');
          setOpen(false);
        },
      });
    }

    return cmds;
  }, [tasks, router, send]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands.slice(0, 15);
    const q = query.toLowerCase();
    return commands
      .filter((cmd) => {
        const searchText = cmd.label.toLowerCase();
        // Also search nav keywords
        const navCmd = navCommands.find((n) => cmd.id === `nav-${n.path}`);
        const keywords = navCmd?.keywords || '';
        return searchText.includes(q) || keywords.includes(q);
      })
      .slice(0, 15);
  }, [commands, query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
      }
    }
  }, [filtered, selectedIndex]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!open) return null;

  const categoryLabels: Record<string, string> = { navigation: 'Navigation', action: 'Actions', task: 'Tasks' };
  let lastCategory: string | null = null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" style={{ animation: 'palette-backdrop 0.15s ease-out' }} />

      <style>{`
        @keyframes palette-backdrop { from { opacity: 0; } to { opacity: 1; } }
        @keyframes palette-enter { from { opacity: 0; transform: scale(0.98) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>

      {/* Palette */}
      <div
        className="relative w-full max-w-lg bg-zinc-900 ring-1 ring-zinc-700 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'palette-enter 0.2s ease-out' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800">
          <svg className="w-5 h-5 text-zinc-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, pages, tasks..."
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <kbd className="text-[10px] text-zinc-500 bg-zinc-800 ring-1 ring-zinc-700 px-2 py-0.5 rounded-md font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="text-center py-10">
              <svg className="w-8 h-8 text-zinc-700 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <p className="text-sm text-zinc-500">No results found</p>
              <p className="text-xs text-zinc-600 mt-1">Try a different search term</p>
            </div>
          )}
          {filtered.map((cmd, i) => {
            const showCategory = cmd.category !== lastCategory;
            lastCategory = cmd.category;
            const iconPath = categoryIcons[cmd.category];

            return (
              <div key={cmd.id}>
                {showCategory && (
                  <div className="flex items-center gap-2 px-5 pt-3 pb-1.5">
                    <svg className="w-3 h-3 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
                    </svg>
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.15em]">
                      {categoryLabels[cmd.category]}
                    </span>
                  </div>
                )}
                <button
                  data-selected={i === selectedIndex}
                  className={`w-full text-left px-5 py-2.5 text-sm transition-all duration-150 flex items-center justify-between group ${
                    i === selectedIndex
                      ? 'bg-indigo-500/10 text-zinc-100'
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(i)}
                >
                  <span className="truncate">
                    <HighlightedText text={cmd.label} query={query} />
                  </span>
                  {i === selectedIndex && (
                    <kbd className="text-[9px] text-zinc-500 bg-zinc-800 ring-1 ring-zinc-700 px-1.5 py-0.5 rounded font-mono flex-shrink-0 ml-2 opacity-70">
                      Enter
                    </kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 px-5 py-2.5 flex items-center gap-5 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <kbd className="bg-zinc-800 ring-1 ring-zinc-700 px-1.5 py-0.5 rounded font-mono">&#8593;&#8595;</kbd>
            <span>navigate</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="bg-zinc-800 ring-1 ring-zinc-700 px-1.5 py-0.5 rounded font-mono">&#8629;</kbd>
            <span>select</span>
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="bg-zinc-800 ring-1 ring-zinc-700 px-1.5 py-0.5 rounded font-mono">esc</kbd>
            <span>close</span>
          </span>
          <span className="ml-auto text-zinc-600">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
