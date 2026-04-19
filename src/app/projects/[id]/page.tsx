'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useProjectStore } from '@/stores/project-store';
import { useTaskStore } from '@/stores/task-store';
import { useWs } from '@/components/layout/DashboardShell';
import type { Project, ProjectPhase } from '@/types';

const phaseStatusColors: Record<string, string> = {
  pending: 'ring-zinc-700 bg-zinc-900/50',
  active: 'ring-blue-500/40 bg-blue-950/20',
  completed: 'ring-green-500/40 bg-green-950/15',
  failed: 'ring-red-500/40 bg-red-950/15',
};

const phaseStatusDots: Record<string, string> = {
  pending: 'bg-zinc-600',
  active: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

const phaseStatusBadge: Record<string, string> = {
  pending: 'bg-zinc-700/50 text-zinc-400',
  active: 'bg-blue-500/15 text-blue-400',
  completed: 'bg-green-500/15 text-green-400',
  failed: 'bg-red-500/15 text-red-400',
};

const statusBadgeColors: Record<string, string> = {
  draft: 'bg-zinc-700/50 text-zinc-300',
  planning: 'bg-yellow-500/15 text-yellow-400',
  active: 'bg-blue-500/15 text-blue-400',
  paused: 'bg-orange-500/15 text-orange-400',
  completed: 'bg-green-500/15 text-green-400',
  archived: 'bg-zinc-700/50 text-zinc-400',
};

const autonomyBadgeColors: Record<string, string> = {
  supervised: 'bg-yellow-500/15 text-yellow-400 ring-1 ring-yellow-500/20',
  'semi-autonomous': 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20',
  autonomous: 'bg-green-500/15 text-green-400 ring-1 ring-green-500/20',
};

const autonomyIcons: Record<string, string> = {
  supervised: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  'semi-autonomous': 'M13 10V3L4 14h7v7l9-11h-7z',
  autonomous: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { send, connected } = useWs();
  const { projects } = useProjectStore();
  const { tasks } = useTaskStore();
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  const projectId = params.id as string;
  const project = projects.find(p => p.id === projectId);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (project) {
      document.title = `${project.name} -- Projects -- CTO Dashboard`;
      if (loadTimerRef.current) {
        clearTimeout(loadTimerRef.current);
        loadTimerRef.current = null;
      }
    }
  }, [project]);

  useEffect(() => {
    if (connected && projectId) {
      send('project:get', { projectId });
    }
  }, [connected, projectId, send]);

  // F14: 5s timeout for loading
  useEffect(() => {
    if (!project) {
      loadTimerRef.current = setTimeout(() => {
        setLoadTimedOut(true);
      }, 5000);
    }
    return () => {
      if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
    };
  }, [project]);

  if (!project) {
    if (loadTimedOut) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-zinc-800 ring-1 ring-zinc-700 flex items-center justify-center mb-2">
            <svg className="w-6 h-6 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-zinc-400 text-sm">Project not found</p>
          <Link href="/projects" className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
            &larr; Back to Projects
          </Link>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
          <p className="text-zinc-500 text-sm">Loading project...</p>
        </div>
      </div>
    );
  }

  const projectTasks = tasks.filter(t => t.projectId === projectId);
  const activePhase = project.phases.find(p => p.status === 'active');

  const handleAction = (action: string) => {
    switch (action) {
      case 'pause':
        send('project:pause', { projectId });
        break;
      case 'resume':
        send('project:resume', { projectId });
        break;
      case 'advance':
        send('project:advance', { projectId });
        break;
      case 'archive':
        send('project:archive', { projectId });
        setShowConfirm(null);
        break;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <Link href="/projects" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-3">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All Projects
          </Link>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold text-zinc-100">{project.name}</h1>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadgeColors[project.status] || 'bg-zinc-700 text-zinc-400'}`}>
                  {project.status}
                </span>
              </div>
              <p className="text-sm text-zinc-500 mt-1 leading-relaxed">{project.goal || project.description}</p>
            </div>
            <div className="flex items-center gap-2 ml-4">
              {project.status === 'active' && (
                <>
                  <button
                    onClick={() => handleAction('pause')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20 hover:bg-orange-500/20 transition-all duration-200"
                  >
                    Pause
                  </button>
                  <button
                    onClick={() => handleAction('advance')}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20 hover:bg-blue-500/20 transition-all duration-200"
                  >
                    Advance Phase
                  </button>
                </>
              )}
              {project.status === 'paused' && (
                <button
                  onClick={() => handleAction('resume')}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 ring-1 ring-green-500/20 hover:bg-green-500/20 transition-all duration-200"
                >
                  Resume
                </button>
              )}
              {!['completed', 'archived'].includes(project.status) && (
                showConfirm === 'archive' ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAction('archive')}
                      className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 ring-1 ring-red-500/20 hover:bg-red-500/20 transition-all duration-200"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowConfirm(null)}
                      className="text-xs px-3 py-1.5 rounded-lg ring-1 ring-zinc-800 text-zinc-400 hover:bg-zinc-800 transition-all duration-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowConfirm('archive')}
                    className="text-xs px-3 py-1.5 rounded-lg ring-1 ring-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all duration-200"
                  >
                    Archive
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Status"
            value={project.status}
            color={project.status === 'active' ? 'text-blue-400' : project.status === 'completed' ? 'text-green-400' : 'text-zinc-200'}
          />
          <StatCard
            label="Autonomy"
            value={project.autonomy?.level || 'supervised'}
            color={project.autonomy?.level === 'autonomous' ? 'text-green-400' : project.autonomy?.level === 'semi-autonomous' ? 'text-blue-400' : 'text-yellow-400'}
          />
          <StatCard label="Tasks Done" value={String(project.totalTasksCompleted)} color="text-zinc-100" />
          <StatCard label="Tokens Used" value={project.totalTokensUsed > 0 ? `${(project.totalTokensUsed / 1000).toFixed(0)}K` : '0'} color="text-zinc-100" />
        </div>

        {/* Autonomy settings */}
        {project.autonomy && (
          <div className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={autonomyIcons[project.autonomy.level] || autonomyIcons.supervised} />
              </svg>
              <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Autonomy Settings</h2>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ml-auto ${autonomyBadgeColors[project.autonomy.level] || 'bg-zinc-800 text-zinc-400'}`}>
                {project.autonomy.level}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {project.autonomy.autonomousUntil && (
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Active Until</div>
                  <div className="text-xs text-zinc-300">{new Date(project.autonomy.autonomousUntil).toLocaleString()}</div>
                </div>
              )}
              {project.autonomy.pauseOnFailureCount && (
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Pause After</div>
                  <div className="text-xs text-zinc-300">{project.autonomy.pauseOnFailureCount} consecutive failures</div>
                </div>
              )}
              {project.tokenBudget && (
                <div className="bg-zinc-800/50 rounded-lg p-3">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Token Budget</div>
                  <div className="text-xs text-zinc-300">{(project.tokenBudget / 1000).toFixed(0)}K tokens</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase timeline */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-200 mb-4">Phases ({project.phases.length})</h2>
          {project.phases.length === 0 ? (
            <div className="text-center py-8 bg-zinc-900/50 ring-1 ring-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-500">No phases defined yet. The CTO will create phases when planning begins.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical timeline connector line */}
              <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-zinc-800" />
              <div className="space-y-3">
                {project.phases.map((phase, idx) => (
                  <PhaseCard
                    key={phase.id}
                    phase={phase}
                    index={idx}
                    isLast={idx === project.phases.length - 1}
                    tasks={projectTasks.filter(t => t.phaseId === phase.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Project tasks */}
        <div>
          <h2 className="text-sm font-semibold text-zinc-200 mb-4">Tasks ({projectTasks.length})</h2>
          {projectTasks.length === 0 ? (
            <div className="text-center py-8 bg-zinc-900/50 ring-1 ring-zinc-800 rounded-xl">
              <p className="text-xs text-zinc-500">No tasks assigned to this project yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {projectTasks.map(task => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="flex items-center justify-between bg-zinc-900 ring-1 ring-zinc-800 rounded-lg px-4 py-3 hover:ring-zinc-700 hover:bg-zinc-800/50 transition-all duration-200 group"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-zinc-200 truncate block group-hover:text-white transition-colors">{task.title}</span>
                    {task.phaseId && (
                      <span className="text-[10px] text-zinc-600 mt-0.5 block">
                        Phase: {project.phases.find(p => p.id === task.phaseId)?.name || task.phaseId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      task.status === 'done' ? 'bg-green-500/15 text-green-400' :
                      task.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400' :
                      task.status === 'failed' ? 'bg-red-500/15 text-red-400' :
                      task.status === 'in_review' ? 'bg-purple-500/15 text-purple-400' :
                      'bg-zinc-800 text-zinc-500'
                    }`}>
                      {task.status.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      task.priority === 'P0' ? 'text-red-400' :
                      task.priority === 'P1' ? 'text-orange-400' :
                      task.priority === 'P2' ? 'text-yellow-400' :
                      'text-zinc-500'
                    }`}>{task.priority}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color = 'text-zinc-200' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-4">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</div>
      <div className={`text-sm font-semibold mt-1.5 capitalize ${color}`}>{value}</div>
    </div>
  );
}

function PhaseCard({ phase, index, isLast, tasks }: { phase: ProjectPhase; index: number; isLast: boolean; tasks: Array<{ status: string }> }) {
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const totalTasks = tasks.length;
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <div className="relative flex gap-4 pl-0">
      {/* Timeline dot */}
      <div className="relative z-10 flex-shrink-0 mt-3.5">
        <div className={`w-[10px] h-[10px] rounded-full border-2 ${
          phase.status === 'completed' ? 'bg-green-500 border-green-500' :
          phase.status === 'active' ? 'bg-blue-500 border-blue-500' :
          phase.status === 'failed' ? 'bg-red-500 border-red-500' :
          'bg-zinc-900 border-zinc-600'
        }`} />
        {phase.status === 'active' && (
          <div className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-20" />
        )}
      </div>

      {/* Phase content */}
      <div className={`flex-1 ring-1 rounded-xl p-4 transition-all duration-200 ${phaseStatusColors[phase.status] || phaseStatusColors.pending}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-zinc-200">Phase {index + 1}: {phase.name}</span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${phaseStatusBadge[phase.status] || phaseStatusBadge.pending}`}>
            {phase.status}
          </span>
          {phase.requiresApproval && (
            <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/20 px-2 py-0.5 rounded-full">
              Gate
            </span>
          )}
        </div>
        {phase.description && (
          <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">{phase.description}</p>
        )}
        {totalTasks > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: pct === 100
                      ? 'linear-gradient(90deg, #22c55e, #4ade80)'
                      : 'linear-gradient(90deg, #3b82f6, #6366f1)',
                  }}
                />
              </div>
              <span className="text-[10px] text-zinc-500 tabular-nums font-medium">{doneTasks}/{totalTasks}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
