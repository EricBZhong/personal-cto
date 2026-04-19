'use client';

const statusConfig: Record<string, { colors: string; pulse?: boolean }> = {
  suggested: { colors: 'bg-purple-500/15 text-purple-300 ring-purple-500/25' },
  approved: { colors: 'bg-blue-500/15 text-blue-300 ring-blue-500/25' },
  queued: { colors: 'bg-yellow-500/15 text-yellow-300 ring-yellow-500/25' },
  in_progress: { colors: 'bg-amber-500/15 text-amber-300 ring-amber-500/25', pulse: true },
  verifying: { colors: 'bg-yellow-500/15 text-yellow-300 ring-yellow-500/25', pulse: true },
  in_review: { colors: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/25' },
  done: { colors: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/25' },
  failed: { colors: 'bg-red-500/15 text-red-300 ring-red-500/25' },
  cancelled: { colors: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/25' },
};

const statusDotColors: Record<string, string> = {
  suggested: 'bg-purple-400',
  approved: 'bg-blue-400',
  queued: 'bg-yellow-400',
  in_progress: 'bg-amber-400',
  verifying: 'bg-yellow-400',
  in_review: 'bg-cyan-400',
  done: 'bg-emerald-400',
  failed: 'bg-red-400',
  cancelled: 'bg-zinc-500',
};

const priorityColors: Record<string, string> = {
  P0: 'bg-red-600 text-white ring-red-500/30',
  P1: 'bg-orange-500 text-white ring-orange-400/30',
  P2: 'bg-blue-500 text-white ring-blue-400/30',
  P3: 'bg-zinc-600 text-zinc-200 ring-zinc-500/30',
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || { colors: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/25' };
  const dotColor = statusDotColors[status] || 'bg-zinc-500';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium ring-1 ${config.colors}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} ${config.pulse ? 'animate-gentle-pulse' : ''}`} />
      {status.replace('_', ' ')}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const colors = priorityColors[priority] || 'bg-zinc-600 text-zinc-200 ring-zinc-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold ring-1 ${colors}`}>
      {priority}
    </span>
  );
}

export function TokenBadge({ tokens }: { tokens: number }) {
  if (!tokens) return null;
  const formatted = tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M tokens`
    : tokens >= 1_000
      ? `${(tokens / 1_000).toFixed(1)}K tokens`
      : `${tokens} tokens`;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
      {formatted}
    </span>
  );
}

/** @deprecated Use TokenBadge instead */
export function CostBadge({ costUsd }: { costUsd: number }) {
  if (!costUsd) return null;
  return <TokenBadge tokens={costUsd} />;
}

export function ModelBadge({ model }: { model: string }) {
  const colors = model === 'opus'
    ? 'bg-violet-500/15 text-violet-300 ring-violet-500/25'
    : model === 'sonnet'
      ? 'bg-sky-500/15 text-sky-300 ring-sky-500/25'
      : 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/25';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${colors}`}>
      {model}
    </span>
  );
}
