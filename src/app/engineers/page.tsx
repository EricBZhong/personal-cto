'use client';

import { useEffect, useState, useMemo } from 'react';
import { EngineerCard } from '@/components/engineers/EngineerCard';
import { useWs } from '@/components/layout/DashboardShell';
import { useEngineerStore } from '@/stores/engineer-store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterBar } from '@/components/ui/FilterBar';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'task', label: 'By task name' },
  { value: 'tokens', label: 'Most tokens' },
];

export default function EngineersPage() {
  const { send } = useWs();
  const { engineers, engineerLogs, systemStatus } = useEngineerStore();
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');

  // Clear loading once we have store data (engineers array is populated by WS)
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1500);
    const unsub = useEngineerStore.subscribe(() => setLoading(false));
    return () => { clearTimeout(timer); unsub(); };
  }, []);

  useEffect(() => {
    document.title = 'Engineers — CTO Dashboard';
  }, []);

  const sorted = useMemo(() => {
    let items = [...engineers];
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(e => (e.taskTitle || '').toLowerCase().includes(q));
    }
    switch (sort) {
      case 'oldest':
        items.sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
        break;
      case 'task':
        items.sort((a, b) => (a.taskTitle || '').localeCompare(b.taskTitle || ''));
        break;
      case 'tokens':
        items.sort((a, b) => (b.tokensUsed || 0) - (a.tokensUsed || 0));
        break;
      default: // newest
        items.sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime());
    }
    return items;
  }, [engineers, sort, search]);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Engineers"
        subtitle={`${engineers.length} active / ${systemStatus.config?.maxEngineers || '?'} max`}
        actions={
          <>
            <button
              onClick={() => send('engineer:list')}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-3.5 py-1.5 rounded-lg bg-zinc-800/80 ring-1 ring-zinc-700/50 hover:bg-zinc-700/80 hover:ring-zinc-600/50 transition-all duration-200"
            >
              Refresh
            </button>
            {engineers.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('Kill all running engineers?')) {
                    send('engineer:kill_all');
                  }
                }}
                className="text-xs text-red-400 hover:text-red-300 px-3.5 py-1.5 rounded-lg bg-red-500/10 ring-1 ring-red-500/20 hover:bg-red-500/20 hover:ring-red-500/30 transition-all duration-200"
              >
                Kill All
              </button>
            )}
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size="lg" />
          </div>
        ) : engineers.length === 0 ? (
          <EmptyState
            icon="\u2699\uFE0F"
            title="No Active Engineers"
            description="Engineers are spawned when you approve tasks. Go to the CTO Chat to discuss what to work on, then approve the suggested tasks."
            action={{ label: 'Go to Chat', href: '/chat' }}
          />
        ) : (
          <div className="space-y-4">
            <FilterBar
              sortOptions={SORT_OPTIONS}
              activeSort={sort}
              onSortChange={setSort}
              searchPlaceholder="Search by task title..."
              searchValue={search}
              onSearchChange={setSearch}
            />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sorted.map((eng) => (
                <EngineerCard
                  key={eng.id}
                  engineer={eng}
                  log={engineerLogs[eng.id]}
                  onKill={() => send('engineer:kill', { engineerId: eng.id })}
                />
              ))}
            </div>
            {sorted.length === 0 && search && (
              <div className="text-center text-sm text-zinc-500 py-10">No engineers matching &quot;{search}&quot;</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
