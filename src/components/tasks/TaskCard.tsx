'use client';

import { StatusBadge, PriorityBadge, TokenBadge, ModelBadge } from '@/components/shared/StatusBadge';
import { useTaskStore } from '@/stores/task-store';
import type { Task } from '@/types';

interface TaskCardProps {
  task: Task;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onClick: () => void;
  onUpdatePriority: (priority: string) => void;
  showRepo?: boolean;
}

/** Truncate to ~2 lines worth of text */
function summarize(text: string, maxLen = 120): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

/** Human-readable time ago */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Check if a task is stale (>24h since last update and still active) */
function isStale(task: Task): boolean {
  const activeStatuses = ['in_progress', 'in_review', 'verifying', 'approved', 'queued'];
  if (!activeStatuses.includes(task.status)) return false;
  const hoursSinceUpdate = (Date.now() - new Date(task.updated_at).getTime()) / (1000 * 60 * 60);
  return hoursSinceUpdate > 24;
}

const statusLabels: Record<string, string> = {
  suggested: 'Waiting for approval',
  approved: 'Queued for engineer',
  queued: 'Queued for engineer',
  in_progress: 'Engineer working',
  verifying: 'Verifying...',
  in_review: 'PR ready for review',
  done: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function TaskCard({ task, onApprove, onReject, onCancel, onClick, onUpdatePriority, showRepo }: TaskCardProps) {
  const isPending = useTaskStore((s) => s.isPending(task.id));

  return (
    <div
      className={`rounded-xl bg-zinc-800/80 ring-1 ring-zinc-700/50 p-3.5 cursor-pointer card-hover ${isPending ? 'opacity-60 animate-gentle-pulse' : ''}`}
      onClick={onClick}
    >
      {/* Repo / project tags */}
      <div className="flex flex-wrap gap-1 mb-2">
        {showRepo && task.repo && (
          <span className="inline-block text-[10px] font-mono text-zinc-400 bg-zinc-700/50 px-1.5 py-0.5 rounded-md">
            {task.repo}
          </span>
        )}
        {task.project && (
          <span className="inline-block text-[10px] font-mono text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded-md ring-1 ring-purple-500/20">
            {task.project}
          </span>
        )}
        {isStale(task) && (
          <span className="inline-block text-[10px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-md ring-1 ring-amber-500/20">
            Stale (24h+)
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-zinc-200 mb-1.5 line-clamp-2 leading-snug">{task.title}</p>

      {/* Description summary */}
      {task.description && (
        <p className="text-xs text-zinc-500 mb-2.5 leading-relaxed line-clamp-2">
          {summarize(task.description)}
        </p>
      )}

      {/* Status context line */}
      <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-2.5">
        <span>{statusLabels[task.status] || task.status}</span>
        {task.actioned_by && (
          <>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-400">
              {task.status === 'cancelled' ? 'Rejected' : 'Approved'} by {task.actioned_by}
            </span>
          </>
        )}
        <span className="text-zinc-700">·</span>
        <span>{timeAgo(task.updated_at)}</span>
      </div>
      {task.action_reason && (
        <p className="text-xs text-zinc-500 italic mb-2.5 line-clamp-1">
          &quot;{task.action_reason}&quot;
        </p>
      )}

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <PriorityBadge priority={task.priority} />
        <ModelBadge model={task.model} />
        {task.tokens_used > 0 && <TokenBadge tokens={task.tokens_used} />}
        {task.status === 'suggested' && task.estimatedTokens && task.estimatedTokens > 0 && (
          <span className="text-[10px] text-zinc-500 bg-zinc-700/50 px-1.5 py-0.5 rounded-md">
            Est. ~{task.estimatedTokens >= 1000 ? `${Math.round(task.estimatedTokens / 1000)}K` : task.estimatedTokens}
          </span>
        )}
      </div>

      {/* Branch */}
      {task.branch && (
        <div className="text-xs font-mono text-zinc-500 mb-2 truncate">
          {task.branch}
        </div>
      )}

      {/* Actions (only for certain statuses) */}
      {task.status === 'suggested' && (
        <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-zinc-700/50">
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(); }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-600/15 text-emerald-400 hover:bg-emerald-600/25 ring-1 ring-emerald-500/20 hover:ring-emerald-500/30 transition-all duration-200 font-medium"
          >
            Approve
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onReject(); }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-red-600/15 text-red-400 hover:bg-red-600/25 ring-1 ring-red-500/20 hover:ring-red-500/30 transition-all duration-200 font-medium"
          >
            Reject
          </button>
        </div>
      )}

      {(task.status === 'in_progress' || task.status === 'queued' || task.status === 'approved') && (
        <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-zinc-700/50">
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="flex-1 text-xs py-1.5 rounded-lg bg-red-600/15 text-red-400 hover:bg-red-600/25 ring-1 ring-red-500/20 hover:ring-red-500/30 transition-all duration-200 font-medium"
          >
            Cancel
          </button>
        </div>
      )}

      {task.error && (
        <div className="text-xs text-red-400 mt-2.5 p-2.5 rounded-lg bg-red-500/10 ring-1 ring-red-500/20 line-clamp-2">
          {task.error}
          {(task.errors?.length || 0) > 1 && (
            <span className="text-red-500/60 ml-1">({task.errors!.length} total)</span>
          )}
        </div>
      )}

      {task.verification_warning && (
        <div className="text-xs text-amber-400 mt-2.5 p-2.5 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 line-clamp-2">
          {task.verification_warning}
          {(task.verification_warnings?.length || 0) > 1 && (
            <span className="text-amber-500/60 ml-1">({task.verification_warnings!.length} total)</span>
          )}
        </div>
      )}

      {task.pr_url && (
        <div className="flex items-center gap-3 mt-2.5">
          <a
            href={task.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors duration-200"
          >
            View PR
          </a>
          <a
            href={`${task.pr_url}.patch`}
            download
            onClick={(e) => e.stopPropagation()}
            className="text-zinc-500 hover:text-zinc-300 transition-colors duration-200"
            title="Download patch"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </a>
        </div>
      )}
    </div>
  );
}
