'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useProjectStore } from '@/stores/project-store';
import { useWs } from '@/components/layout/DashboardShell';
import type { Project } from '@/types';

const statusColors: Record<string, string> = {
  draft: 'bg-zinc-600/80 text-zinc-200',
  planning: 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/30',
  active: 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30',
  paused: 'bg-orange-500/20 text-orange-400 ring-1 ring-orange-500/30',
  completed: 'bg-green-500/20 text-green-400 ring-1 ring-green-500/30',
  archived: 'bg-zinc-700/50 text-zinc-400',
};

const autonomyColors: Record<string, string> = {
  supervised: 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/25',
  'semi-autonomous': 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/25',
  autonomous: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/25',
};

const autonomyLabels: Record<string, string> = {
  supervised: 'Supervised',
  'semi-autonomous': 'Semi-Auto',
  autonomous: 'Autonomous',
};

function phaseProgress(project: Project) {
  const total = project.phases.length;
  if (total === 0) return { completed: 0, total: 0, pct: 0 };
  const completed = project.phases.filter(p => p.status === 'completed').length;
  return { completed, total, pct: Math.round((completed / total) * 100) };
}

export default function ProjectsPage() {
  const { send } = useWs();
  const { projects } = useProjectStore();

  useEffect(() => {
    document.title = 'Projects -- CTO Dashboard';
  }, []);

  // F13: Fetch fresh project list on mount
  useEffect(() => {
    send('project:list');
  }, [send]);

  const active = projects.filter(p => ['active', 'planning'].includes(p.status));
  const paused = projects.filter(p => p.status === 'paused');
  const completed = projects.filter(p => p.status === 'completed');
  const other = projects.filter(p => ['draft', 'archived'].includes(p.status));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">Projects</h1>
            <p className="text-sm text-zinc-500 mt-1">Autonomous multi-phase project execution</p>
          </div>
          <button
            onClick={() => send('project:list')}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg ring-1 ring-zinc-800 hover:ring-zinc-700 bg-zinc-900 hover:bg-zinc-800 transition-all duration-200"
          >
            Refresh
          </button>
        </div>

        {projects.length === 0 && (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded-xl bg-zinc-800 ring-1 ring-zinc-700 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-zinc-400 text-sm font-medium">No projects yet</p>
            <p className="text-zinc-600 text-xs mt-1.5 max-w-xs mx-auto">
              Ask the CTO to &quot;Build me X&quot; and it will create a project with phases and tasks.
            </p>
          </div>
        )}

        {active.length > 0 && <ProjectGroup title="Active" projects={active} />}
        {paused.length > 0 && <ProjectGroup title="Paused" projects={paused} />}
        {completed.length > 0 && <ProjectGroup title="Completed" projects={completed} />}
        {other.length > 0 && <ProjectGroup title="Other" projects={other} />}
      </div>
    </div>
  );
}

function ProjectGroup({ title, projects }: { title: string; projects: Project[] }) {
  return (
    <div>
      <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">{title} ({projects.length})</h2>
      <div className="space-y-3">
        {projects.map(p => <ProjectCard key={p.id} project={p} />)}
      </div>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const progress = phaseProgress(project);
  const activePhase = project.phases.find(p => p.status === 'active');

  return (
    <Link
      href={`/projects/${project.id}`}
      className="block bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-5 hover:ring-zinc-700 hover:bg-zinc-900/80 transition-all duration-200 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-zinc-100 truncate group-hover:text-white transition-colors">{project.name}</h3>
          <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">{project.description || project.goal}</p>
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${statusColors[project.status] || 'bg-zinc-600 text-zinc-300'}`}>
            {project.status}
          </span>
          {project.autonomy && (
            <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${autonomyColors[project.autonomy.level] || 'bg-zinc-800 text-zinc-400'}`}>
              {autonomyLabels[project.autonomy.level] || project.autonomy.level}
            </span>
          )}
        </div>
      </div>

      {/* Phase timeline visualization */}
      {progress.total > 0 && (
        <div className="mt-4">
          {/* Phase dots connected by lines */}
          <div className="flex items-center gap-0 mb-3">
            {project.phases.map((phase, idx) => {
              const isCompleted = phase.status === 'completed';
              const isActive = phase.status === 'active';
              const isPending = phase.status === 'pending';
              return (
                <div key={phase.id} className="flex items-center flex-1 last:flex-none">
                  {/* Dot */}
                  <div className="relative flex-shrink-0 group/dot" title={`${phase.name} (${phase.status})`}>
                    <div className={`w-3 h-3 rounded-full transition-all duration-300 ${
                      isCompleted ? 'bg-green-500 ring-2 ring-green-500/30' :
                      isActive ? 'bg-blue-500 ring-2 ring-blue-500/30' :
                      'bg-zinc-700 ring-2 ring-zinc-800'
                    }`} />
                    {isActive && (
                      <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-30" />
                    )}
                    {/* Phase name tooltip on hover */}
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover/dot:opacity-100 transition-opacity duration-200 pointer-events-none">
                      <span className="text-[9px] text-zinc-400 whitespace-nowrap bg-zinc-800 px-1.5 py-0.5 rounded">{phase.name}</span>
                    </div>
                  </div>
                  {/* Connecting line */}
                  {idx < project.phases.length - 1 && (
                    <div className="flex-1 h-0.5 mx-0.5">
                      <div className={`h-full rounded-full transition-all duration-300 ${
                        isCompleted ? 'bg-green-500/50' : 'bg-zinc-800'
                      }`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Progress info */}
          <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1.5">
            <span className="font-medium">Phase {progress.completed}/{progress.total}</span>
            {activePhase && <span className="text-zinc-400">Current: {activePhase.name}</span>}
            <span className="tabular-nums">{progress.pct}%</span>
          </div>

          {/* Gradient progress bar */}
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progress.pct}%`,
                background: progress.pct === 100
                  ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                  : 'linear-gradient(90deg, #3b82f6, #6366f1)',
              }}
            />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-4 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {project.totalTasksCompleted} done
        </span>
        {project.totalTasksFailed > 0 && (
          <span className="text-red-400 flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {project.totalTasksFailed} failed
          </span>
        )}
        {project.totalTokensUsed > 0 && (
          <span className="tabular-nums">{(project.totalTokensUsed / 1000).toFixed(0)}K tokens</span>
        )}
        {project.repo && (
          <span className="font-mono text-zinc-600">{project.repo}</span>
        )}
      </div>
    </Link>
  );
}
