'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useEngineerStore } from '@/stores/engineer-store';
import { useTaskStore } from '@/stores/task-store';
import { useSlackStore } from '@/stores/slack-store';
import { usePRStore } from '@/stores/pr-store';
import { useProjectStore } from '@/stores/project-store';

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

const navGroups = [
  {
    label: 'Core',
    items: [
      { href: '/chat', label: 'CTO Chat', icon: '💬' },
      { href: '/tasks', label: 'Task Board', icon: '📋' },
      { href: '/projects', label: 'Projects', icon: '🚀' },
      { href: '/pr-reviews', label: 'PR Reviews', icon: '🔍' },
      { href: '/engineers', label: 'Engineers', icon: '⚙️' },
    ],
  },
  {
    label: 'Ops',
    items: [
      { href: '/compliance', label: 'Compliance', icon: '🛡️' },
      { href: '/dogfood', label: 'Dogfood', icon: '🐕' },
      { href: '/analytics', label: 'Analytics', icon: '📊' },
      { href: '/activity', label: 'Activity', icon: '📜' },
      { href: '/slack', label: 'Slack', icon: '📡' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { href: '/features', label: 'Features', icon: '📖' },
      { href: '/docs', label: 'Docs', icon: '📚' },
      { href: '/settings', label: 'Settings', icon: '🔧' },
    ],
  },
];

export function Sidebar({ connected }: { connected: boolean }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { systemStatus, engineers } = useEngineerStore();
  const { tasks } = useTaskStore();

  const { queue: slackQueue } = useSlackStore();
  const { prs } = usePRStore();
  const { projects } = useProjectStore();
  const suggestedCount = tasks.filter(t => t.status === 'suggested').length;
  const activeProjectCount = projects.filter(p => p.status === 'active' || p.status === 'planning').length;
  const slackPendingCount = slackQueue.length;
  const prReviewCount = prs.filter(p => p.reviewDecision === 'REVIEW_REQUIRED' || !p.reviewDecision).length;

  const badgeMap: Record<string, { count: number; color: string }> = {
    '/engineers': { count: engineers.length, color: 'bg-blue-600' },
    '/tasks': { count: suggestedCount, color: 'bg-purple-600' },
    '/pr-reviews': { count: prReviewCount, color: 'bg-orange-600' },
    '/projects': { count: activeProjectCount, color: 'bg-emerald-600' },
    '/slack': { count: slackPendingCount, color: 'bg-yellow-600' },
  };

  return (
    <aside className="w-64 bg-zinc-900 text-zinc-100 flex flex-col border-r border-zinc-800 flex-shrink-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800">
        <h1 className="text-lg font-bold tracking-tight text-gradient">CTO Dashboard</h1>
        <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400">
          <span
            className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              connected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]'
            }`}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={group.label}>
            {gi > 0 && (
              <div className="mx-2 my-2 border-t border-zinc-800/60" />
            )}
            <div className="px-3 pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                {group.label}
              </span>
            </div>
            {group.items.map((item) => {
              const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
              const badge = badgeMap[item.href];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                    isActive
                      ? 'nav-active-glow text-white font-medium'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <span className="text-base w-5 text-center flex-shrink-0">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {badge && badge.count > 0 && (
                    <span className={`${badge.color} text-white text-[10px] font-medium min-w-[20px] text-center px-1.5 py-0.5 rounded-full leading-none`}>
                      {badge.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Status footer */}
      <div className="px-5 py-3 border-t border-zinc-800 text-xs text-zinc-500 space-y-2">
        <div className="flex justify-between items-center">
          <span>Engineers</span>
          <span className="text-zinc-300 font-medium tabular-nums">{engineers.length} active</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Today</span>
          <span className="text-zinc-300 font-medium tabular-nums">{formatTokenCount(systemStatus.dailyTokens || 0)} tokens</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Tasks</span>
          <span className="text-zinc-300 font-medium tabular-nums">{tasks.filter(t => !['done', 'cancelled', 'failed'].includes(t.status)).length} active</span>
        </div>
        <div className="flex justify-between items-center">
          <span>Total</span>
          <span className="text-zinc-300 font-medium tabular-nums">{tasks.length} tasks</span>
        </div>
        <div className="flex items-center justify-center pt-2 mt-2 border-t border-zinc-800/60">
          <kbd className="text-[10px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700/50">&#8984;K</kbd>
          <span className="ml-1.5 text-zinc-600">Command palette</span>
        </div>
      </div>

      {/* User info */}
      {session?.user && (
        <div className="px-5 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-2.5 mb-2">
            {session.user.image && (
              <img src={session.user.image} alt="" className="w-6 h-6 rounded-full ring-1 ring-zinc-700" />
            )}
            <span className="text-xs text-zinc-300 truncate">{session.user.email}</span>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-200 text-left"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
