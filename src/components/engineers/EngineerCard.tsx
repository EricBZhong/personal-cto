'use client';

import { ModelBadge, TokenBadge } from '@/components/shared/StatusBadge';
import { useEngineerStore } from '@/stores/engineer-store';
import type { Engineer } from '@/types';
import type { EngineerMilestone } from '@/lib/engineer-progress';

interface EngineerCardProps {
  engineer: Engineer;
  log?: string;
  onKill: () => void;
}

const milestoneIcons: Record<EngineerMilestone['type'], string> = {
  file_read: 'R',
  file_edit: 'E',
  bash: '$',
  git_branch: 'B',
  git_commit: 'C',
  git_push: 'P',
  pr_created: 'PR',
  test_run: 'T',
};

const milestoneColors: Record<EngineerMilestone['type'], string> = {
  file_read: 'bg-zinc-700 text-zinc-300 ring-zinc-600/50',
  file_edit: 'bg-blue-600/40 text-blue-300 ring-blue-500/30',
  bash: 'bg-zinc-700 text-zinc-300 ring-zinc-600/50',
  git_branch: 'bg-purple-600/40 text-purple-300 ring-purple-500/30',
  git_commit: 'bg-amber-600/40 text-amber-300 ring-amber-500/30',
  git_push: 'bg-emerald-600/40 text-emerald-300 ring-emerald-500/30',
  pr_created: 'bg-emerald-600/60 text-emerald-200 ring-emerald-500/30',
  test_run: 'bg-cyan-600/40 text-cyan-300 ring-cyan-500/30',
};

export function EngineerCard({ engineer, log, onKill }: EngineerCardProps) {
  const progress = useEngineerStore((s) => s.engineerProgress[engineer.id]);
  const startMs = engineer.startedAt ? new Date(engineer.startedAt).getTime() : NaN;
  const elapsed = Number.isNaN(startMs) ? 0 : Math.floor((Date.now() - startMs) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  const budgetPct = engineer.tokenBudget > 0
    ? Math.min(100, Math.round((engineer.tokensUsed / engineer.tokenBudget) * 100))
    : 0;
  const budgetWarning = budgetPct >= 80;

  return (
    <div className="rounded-xl bg-zinc-800/80 ring-1 ring-zinc-700/50 overflow-hidden card-hover animate-scale-in">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-zinc-200 leading-snug">{engineer.taskTitle}</h3>
            <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
              <ModelBadge model={engineer.model} />
              <span className="tabular-nums">{minutes}m {seconds}s</span>
              {engineer.tokensUsed > 0 && <TokenBadge tokens={engineer.tokensUsed} />}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-gentle-pulse" />
              Running
            </span>
            <button
              onClick={onKill}
              className="text-xs text-red-400 hover:text-red-300 px-2.5 py-1 rounded-lg bg-red-500/10 ring-1 ring-red-500/20 hover:bg-red-500/20 hover:ring-red-500/30 transition-all duration-200 font-medium"
            >
              Kill
            </button>
          </div>
        </div>
      </div>

      {/* Token budget bar */}
      {engineer.tokenBudget > 0 && (
        <div className="px-4 pb-2.5">
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1">
            <span className="font-medium">Budget</span>
            <span className={`tabular-nums ${budgetWarning ? 'text-red-400' : ''}`}>{budgetPct}%</span>
          </div>
          <div className="h-1.5 bg-zinc-700/50 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                budgetWarning
                  ? 'bg-gradient-to-r from-red-500 to-red-400'
                  : 'bg-gradient-to-r from-indigo-500 to-blue-400'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Progress indicators */}
      {progress && (progress.currentActivity || progress.milestones.length > 0) && (
        <div className="px-4 pb-3 space-y-2">
          {/* Current activity */}
          {progress.currentActivity && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-gentle-pulse" />
              <span className="truncate">{progress.currentActivity}</span>
            </div>
          )}

          {/* Milestone chips */}
          {progress.milestones.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {progress.milestones.slice(-10).map((m, i) => (
                <span
                  key={`${m.type}-${i}`}
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ring-1 ${milestoneColors[m.type]}`}
                  title={m.label}
                >
                  <span className="font-bold">{milestoneIcons[m.type]}</span>
                  <span className="max-w-[80px] truncate">{m.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live output */}
      {log && (
        <div className="border-t border-zinc-700/50 bg-zinc-950/80 p-3 max-h-48 overflow-y-auto">
          <pre className="text-[11px] text-emerald-400/90 font-mono whitespace-pre-wrap leading-relaxed">
            {log.slice(-2000)}
          </pre>
        </div>
      )}
    </div>
  );
}
