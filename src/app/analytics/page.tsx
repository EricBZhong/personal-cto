'use client';

import { useEffect, useState, useMemo } from 'react';
import { useWs } from '@/components/layout/DashboardShell';
import { useTaskStore } from '@/stores/task-store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBanner } from '@/components/ui/ErrorBanner';
import { FilterBar } from '@/components/ui/FilterBar';
import { formatDate } from '@/utils/date';

interface DailyTokens {
  date: string;
  total_tokens: number;
}

interface TaskTokens {
  id: string;
  title: string;
  tokens_used: number;
  model: string;
  status: string;
  repo?: string;
  project?: string;
  created_at: string;
}

interface ProjectTokens {
  project: string;
  taskCount: number;
  totalTokens: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const statusColors: Record<string, string> = {
  done: 'text-emerald-400',
  failed: 'text-red-400',
  in_progress: 'text-amber-400',
  in_review: 'text-cyan-400',
  suggested: 'text-purple-400',
  approved: 'text-blue-400',
  queued: 'text-yellow-400',
  cancelled: 'text-zinc-500',
};

export default function AnalyticsPage() {
  const { send, connected } = useWs();
  const { tasks } = useTaskStore();
  const [dailyTokens, setDailyTokens] = useState<DailyTokens[]>([]);
  const [taskTokens, setTaskTokens] = useState<TaskTokens[]>([]);
  const [totalAllTime, setTotalAllTime] = useState(0);
  const [todayTokens, setTodayTokens] = useState(0);
  const [projectTokens, setProjectTokens] = useState<ProjectTokens[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState('14');
  const [taskSearch, setTaskSearch] = useState('');

  useEffect(() => {
    if (connected) send('analytics:usage');
  }, [connected, send]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.error) {
        setError(detail.error);
      } else {
        setError(null);
      }
      if (detail.dailyTokens) setDailyTokens(detail.dailyTokens);
      if (detail.taskTokens) setTaskTokens(detail.taskTokens);
      if (detail.totalAllTime !== undefined) setTotalAllTime(detail.totalAllTime);
      if (detail.todayTokens !== undefined) setTodayTokens(detail.todayTokens);
      if (detail.projectTokens) setProjectTokens(detail.projectTokens);
      setLoading(false);
    };
    window.addEventListener('analytics:usage', handler);
    return () => window.removeEventListener('analytics:usage', handler);
  }, []);

  useEffect(() => {
    document.title = 'Analytics — CTO Dashboard';
  }, []);

  const tasksByStatus = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'done').length;
  const failedTasks = tasks.filter(t => t.status === 'failed').length;
  const successRate = totalTasks > 0 ? Math.round((completedTasks / Math.max(completedTasks + failedTasks, 1)) * 100) : 0;

  const days = parseInt(dateRange);
  const visibleDaily = dailyTokens.slice(0, days);
  const maxDailyTokens = visibleDaily.length > 0
    ? Math.max(...visibleDaily.map(d => d.total_tokens), 1)
    : 1;

  const filteredTaskTokens = useMemo(() => {
    if (!taskSearch.trim()) return taskTokens;
    const q = taskSearch.toLowerCase();
    return taskTokens.filter(t => t.title.toLowerCase().includes(q));
  }, [taskTokens, taskSearch]);

  const hasData = dailyTokens.length > 0 || taskTokens.length > 0 || totalAllTime > 0;

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Analytics"
        actions={
          <button
            onClick={() => { setLoading(true); send('analytics:usage'); }}
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
        ) : !hasData ? (
          <EmptyState icon="📊" title="No Usage Data" description="Token usage and task statistics will appear here once you start using the CTO." />
        ) : (
          <div className="max-w-5xl mx-auto p-6 space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Today's Tokens" value={formatTokens(todayTokens)} sub="tokens used" icon="⚡" />
              <StatCard label="All-Time Tokens" value={formatTokens(totalAllTime)} sub={`${dailyTokens.length} days`} icon="📈" />
              <StatCard label="Total Tasks" value={String(totalTasks)} sub={`${completedTasks} done, ${failedTasks} failed`} icon="📋" />
              <StatCard label="Success Rate" value={`${successRate}%`} sub={`${completedTasks}/${completedTasks + failedTasks} tasks`} color={successRate >= 80 ? 'green' : successRate >= 50 ? 'yellow' : 'red'} icon="🎯" />
            </div>

            {/* Task Status Breakdown */}
            <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-5">
              <h2 className="text-sm font-medium text-zinc-300 mb-4">Task Status Breakdown</h2>
              <div className="grid grid-cols-4 gap-4">
                {Object.entries(tasksByStatus).map(([status, count]) => (
                  <div key={status} className="text-center p-3 rounded-lg bg-zinc-800/40 ring-1 ring-zinc-700/30">
                    <div className={`text-xl font-bold tabular-nums ${statusColors[status] || 'text-zinc-200'}`}>{count}</div>
                    <div className="text-[11px] text-zinc-500 capitalize mt-0.5 font-medium">{status.replace('_', ' ')}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily Token Usage Chart */}
            <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-zinc-300">Daily Token Usage</h2>
                <FilterBar
                  sortOptions={[
                    { value: '7', label: 'Last 7 days' },
                    { value: '14', label: 'Last 14 days' },
                    { value: '30', label: 'Last 30 days' },
                  ]}
                  activeSort={dateRange}
                  onSortChange={setDateRange}
                />
              </div>
              <div className="space-y-1.5">
                {visibleDaily.map((day) => {
                  const pct = Math.min((day.total_tokens / maxDailyTokens) * 100, 100);
                  return (
                    <div key={day.date} className="flex items-center gap-3 group">
                      <span className="text-xs text-zinc-500 w-20 font-mono tabular-nums">{day.date}</span>
                      <div className="flex-1 bg-zinc-800/50 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-indigo-500 to-blue-400 h-2 rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-400 w-20 text-right font-mono tabular-nums group-hover:text-zinc-300 transition-colors duration-200">
                        {formatTokens(day.total_tokens || 0)}
                      </span>
                    </div>
                  );
                })}
                {visibleDaily.length === 0 && (
                  <div className="text-center text-xs text-zinc-600 py-6">No usage data yet</div>
                )}
              </div>
            </div>

            {/* Cost by Project */}
            {projectTokens.length > 0 && (
              <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-5">
                <h2 className="text-sm font-medium text-zinc-300 mb-4">Cost by Project</h2>
                <div className="space-y-2.5">
                  {projectTokens.map((p) => {
                    const maxProjectTokens = Math.max(...projectTokens.map(x => x.totalTokens), 1);
                    const pct = Math.min((p.totalTokens / maxProjectTokens) * 100, 100);
                    return (
                      <div key={p.project} className="flex items-center gap-3 group">
                        <span className="text-xs text-zinc-400 w-28 truncate font-mono" title={p.project}>{p.project}</span>
                        <div className="flex-1 bg-zinc-800/50 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-purple-500 to-violet-400 h-2 rounded-full transition-all duration-500 ease-out"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-zinc-400 w-16 text-right font-mono tabular-nums group-hover:text-zinc-300 transition-colors duration-200">
                          {formatTokens(p.totalTokens)}
                        </span>
                        <span className="text-xs text-zinc-500 w-16 text-right tabular-nums">{p.taskCount} tasks</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Highest Token Usage Tasks */}
            <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-zinc-300">Highest Token Usage Tasks</h2>
                <FilterBar
                  searchPlaceholder="Search tasks..."
                  searchValue={taskSearch}
                  onSearchChange={setTaskSearch}
                />
              </div>
              <div className="space-y-0">
                {filteredTaskTokens.map((task) => (
                  <div key={task.id} className="flex items-center justify-between py-2.5 border-b border-zinc-800/40 last:border-0 group hover:bg-zinc-800/20 -mx-2 px-2 rounded-lg transition-colors duration-200">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-zinc-300 truncate block group-hover:text-zinc-200 transition-colors duration-200" title={task.title}>{task.title}</span>
                      <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1.5">
                        <span className="font-medium">{task.model}</span>
                        <span className="text-zinc-700">·</span>
                        <span className={statusColors[task.status] || 'text-zinc-400'}>{task.status}</span>
                        {(task.project || task.repo) && (
                          <>
                            <span className="text-zinc-700">·</span>
                            <span className="text-purple-400">{task.project || task.repo}</span>
                          </>
                        )}
                        <span className="text-zinc-700">·</span>
                        <span>{formatDate(task.created_at)}</span>
                      </div>
                    </div>
                    <span className="text-sm font-mono text-zinc-300 flex-shrink-0 ml-3 tabular-nums">{formatTokens(task.tokens_used || 0)}</span>
                  </div>
                ))}
                {filteredTaskTokens.length === 0 && (
                  <div className="text-center text-xs text-zinc-600 py-6">
                    {taskSearch ? 'No matching tasks' : 'No token usage data yet'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon?: string }) {
  const textColor = color === 'red' ? 'text-red-400' : color === 'yellow' ? 'text-yellow-400' : color === 'green' ? 'text-emerald-400' : 'text-zinc-200';
  return (
    <div className="bg-zinc-900/60 rounded-xl ring-1 ring-zinc-800/50 p-4 card-hover">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className="text-sm">{icon}</span>}
        <span className="text-xs text-zinc-500 font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${textColor}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}
