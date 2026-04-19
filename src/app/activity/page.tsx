'use client';

import { useEffect, useState, useMemo } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { FilterBar } from '@/components/ui/FilterBar';
import { formatDateTime } from '@/utils/date';

interface Activity {
  timestamp: string;
  type: string;
  message: string;
  trigger?: string;
  oldValue?: string;
  newValue?: string;
}

const triggerColors: Record<string, string> = {
  user_action: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
  scheduled: 'bg-zinc-500/10 text-zinc-400 ring-zinc-500/20',
  slack_message: 'bg-purple-500/10 text-purple-400 ring-purple-500/20',
  auto_fix: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  periodic_checkin: 'bg-cyan-500/10 text-cyan-400 ring-cyan-500/20',
  task_completion: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
};

const typeColors: Record<string, string> = {
  chat: 'text-blue-400',
  task: 'text-purple-400',
  engineer: 'text-amber-400',
  analysis: 'text-cyan-400',
  config: 'text-zinc-400',
  deploy: 'text-emerald-400',
  error: 'text-red-400',
};

const typeDotColors: Record<string, string> = {
  chat: 'bg-blue-500 shadow-blue-500/30',
  task: 'bg-purple-500 shadow-purple-500/30',
  engineer: 'bg-amber-500 shadow-amber-500/30',
  analysis: 'bg-cyan-500 shadow-cyan-500/30',
  config: 'bg-zinc-500 shadow-zinc-500/30',
  deploy: 'bg-emerald-500 shadow-emerald-500/30',
  error: 'bg-red-500 shadow-red-500/30',
};

const typeIcons: Record<string, string> = {
  chat: '\u{1F4AC}',
  task: '\u{1F4CB}',
  engineer: '\u2699\uFE0F',
  analysis: '\u{1F50D}',
  config: '\u{1F527}',
  deploy: '\u{1F680}',
  error: '\u274C',
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'chat', label: 'Chat' },
  { value: 'task', label: 'Task' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'config', label: 'Config' },
  { value: 'error', label: 'Error' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

export default function ActivityPage() {
  const { send, connected } = useWs();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (connected) send('analytics:activity');
  }, [connected, send]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.error) {
        setError(detail.error);
      } else {
        setError(null);
      }
      if (detail.activities) setActivities(detail.activities);
      setLoading(false);
    };
    window.addEventListener('analytics:activity', handler);
    return () => window.removeEventListener('analytics:activity', handler);
  }, []);

  useEffect(() => {
    document.title = 'Activity — CTO Dashboard';
  }, []);

  const filtered = useMemo(() => {
    let items = activities;
    if (filter !== 'all') {
      items = items.filter(a => a.type === filter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(a => a.message.toLowerCase().includes(q));
    }
    const sorted = [...items];
    if (sort === 'newest') {
      sorted.reverse();
    }
    return sorted;
  }, [activities, filter, sort, search]);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Activity Timeline"
        actions={
          <button
            onClick={() => { setLoading(true); send('analytics:activity'); }}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-3.5 py-1.5 rounded-lg bg-zinc-800/80 ring-1 ring-zinc-700/50 hover:bg-zinc-700/80 hover:ring-zinc-600/50 transition-all duration-200"
          >
            Refresh
          </button>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size="lg" />
          </div>
        ) : activities.length === 0 ? (
          <EmptyState
            icon="\u{1F4DC}"
            title="No Activity Yet"
            description="Activity will appear here as you interact with the CTO, create tasks, and run engineers."
            action={{ label: 'Go to Chat', href: '/chat' }}
          />
        ) : (
          <div className="max-w-3xl mx-auto p-6 space-y-4">
            <FilterBar
              filters={FILTER_OPTIONS}
              activeFilter={filter}
              onFilterChange={setFilter}
              sortOptions={SORT_OPTIONS}
              activeSort={sort}
              onSortChange={setSort}
              searchPlaceholder="Search activity..."
              searchValue={search}
              onSearchChange={setSearch}
            />

            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-5 top-2 bottom-2 w-px bg-gradient-to-b from-zinc-700 via-zinc-800 to-transparent" />

              <div className="space-y-3">
                {filtered.map((activity, i) => {
                  const dotColor = typeDotColors[activity.type] || 'bg-zinc-500 shadow-zinc-500/30';
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-4 relative animate-fade-in-up"
                      style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                    >
                      {/* Timeline dot */}
                      <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-zinc-900/80 ring-1 ring-zinc-800/60 text-sm z-10 relative">
                        {typeIcons[activity.type] || '\u{1F4CC}'}
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-zinc-900 shadow-[0_0_6px] ${dotColor}`} />
                      </div>

                      {/* Content card */}
                      <div className="flex-1 bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-3.5 hover:bg-zinc-800/40 hover:ring-zinc-700/50 transition-all duration-200">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className={`text-xs font-semibold capitalize ${typeColors[activity.type] || 'text-zinc-400'}`}>
                            {activity.type}
                          </span>
                          {activity.trigger && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md ring-1 font-medium ${triggerColors[activity.trigger] || 'bg-zinc-800 text-zinc-400 ring-zinc-700'}`}>
                              {activity.trigger.replace('_', ' ')}
                            </span>
                          )}
                          <span className="text-[11px] text-zinc-600 ml-auto tabular-nums">
                            {formatDateTime(activity.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-zinc-300 leading-relaxed">{activity.message}</p>
                        {activity.oldValue && activity.newValue && (
                          <div className="flex items-center gap-2 mt-1.5 text-[11px]">
                            <span className="text-zinc-500 bg-zinc-800/50 px-1.5 py-0.5 rounded">{activity.oldValue}</span>
                            <svg className="w-3 h-3 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                            <span className="text-zinc-400 bg-zinc-800/50 px-1.5 py-0.5 rounded">{activity.newValue}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="text-center text-sm text-zinc-500 py-10">No matching activity</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
