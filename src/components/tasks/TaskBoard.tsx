'use client';

import { useMemo, useState } from 'react';
import { TaskCard } from './TaskCard';
import type { Task } from '@/types';

interface TaskBoardProps {
  tasks: Task[];
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
  onCancel: (taskId: string) => void;
  onSelect: (taskId: string) => void;
  onUpdatePriority: (taskId: string, priority: string) => void;
}

const ALL_PROJECTS = '__all__';
const ARCHIVE_DAYS = 7;
const COLLAPSED_LIMIT = 5;

const closedStatuses = new Set(['done', 'failed', 'cancelled']);

const columns = [
  { key: 'suggested', label: 'Suggested', color: 'border-t-purple-500', bgAccent: 'bg-purple-500/5', collapsible: false },
  { key: 'approved,queued', label: 'Queued', color: 'border-t-blue-500', bgAccent: 'bg-blue-500/5', collapsible: false },
  { key: 'in_progress,verifying', label: 'In Progress', color: 'border-t-amber-500', bgAccent: 'bg-amber-500/5', collapsible: false },
  { key: 'in_review', label: 'In Review', color: 'border-t-cyan-500', bgAccent: 'bg-cyan-500/5', collapsible: false },
  { key: 'done', label: 'Done', color: 'border-t-emerald-500', bgAccent: 'bg-emerald-500/5', collapsible: true },
  { key: 'failed,cancelled', label: 'Closed', color: 'border-t-zinc-500', bgAccent: 'bg-zinc-500/5', collapsible: true },
];

export function TaskBoard({ tasks, onApprove, onReject, onCancel, onSelect, onUpdatePriority }: TaskBoardProps) {
  const [selectedProject, setSelectedProject] = useState<string>(ALL_PROJECTS);
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({});

  const projects = useMemo(() => {
    const keys = new Set<string>();
    for (const t of tasks) {
      keys.add(t.project || t.repo || 'default');
    }
    return Array.from(keys).sort();
  }, [tasks]);

  // Auto-archive: hide closed tasks older than ARCHIVE_DAYS
  const activeTasks = useMemo(() => {
    const cutoff = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
    return tasks.filter((t) => {
      if (!closedStatuses.has(t.status)) return true;
      const updatedAt = new Date(t.updated_at).getTime();
      return updatedAt >= cutoff;
    });
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (selectedProject === ALL_PROJECTS) return activeTasks;
    return activeTasks.filter((t) => (t.project || t.repo || 'default') === selectedProject);
  }, [activeTasks, selectedProject]);

  const archivedCount = tasks.length - activeTasks.length;

  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of columns) {
      const statuses = col.key.split(',');
      // Sort closed columns by updated_at descending (most recent first)
      const colTasks = filteredTasks.filter((t) => statuses.includes(t.status));
      if (col.collapsible) {
        colTasks.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
      }
      map[col.key] = colTasks;
    }
    return map;
  }, [filteredTasks]);

  const toggleColumn = (key: string) => {
    setExpandedColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Project filter */}
      <div className="flex items-center gap-3 px-4 pt-3">
        {projects.length > 1 && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 font-medium">Project</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="text-sm bg-zinc-800 text-zinc-200 ring-1 ring-zinc-700 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-zinc-500 cursor-pointer transition-all duration-200"
            >
              <option value={ALL_PROJECTS}>All Projects ({activeTasks.length})</option>
              {projects.map((proj) => {
                const count = activeTasks.filter((t) => (t.project || t.repo || 'default') === proj).length;
                return (
                  <option key={proj} value={proj}>
                    {proj} ({count})
                  </option>
                );
              })}
            </select>
          </div>
        )}
        {archivedCount > 0 && (
          <span className="text-xs text-zinc-600">
            {archivedCount} archived task{archivedCount !== 1 ? 's' : ''} hidden ({ARCHIVE_DAYS}d+)
          </span>
        )}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-4 flex-1 overflow-x-auto p-4">
        {columns.map((col) => {
          const allColTasks = grouped[col.key] || [];
          const isExpanded = expandedColumns[col.key];
          const isCollapsible = col.collapsible && allColTasks.length > COLLAPSED_LIMIT;
          const visibleTasks = isCollapsible && !isExpanded
            ? allColTasks.slice(0, COLLAPSED_LIMIT)
            : allColTasks;
          const hiddenCount = allColTasks.length - visibleTasks.length;

          return (
            <div
              key={col.key}
              className={`flex-shrink-0 w-72 flex flex-col rounded-xl bg-zinc-900/60 border-t-2 ring-1 ring-zinc-800/50 ${col.color}`}
            >
              {/* Column header */}
              <div className={`flex items-center justify-between px-3 py-2.5 border-b border-zinc-800/60 ${col.bgAccent} rounded-t-xl`}>
                <span className="text-sm font-medium text-zinc-300">{col.label}</span>
                <span className="text-[11px] text-zinc-500 bg-zinc-800/80 px-2 py-0.5 rounded-md font-medium tabular-nums">
                  {allColTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {visibleTasks.map((task, i) => (
                  <div key={task.id} className="animate-scale-in" style={{ animationDelay: `${i * 30}ms` }}>
                    <TaskCard
                      task={task}
                      onApprove={() => onApprove(task.id)}
                      onReject={() => onReject(task.id)}
                      onCancel={() => onCancel(task.id)}
                      onClick={() => onSelect(task.id)}
                      onUpdatePriority={(p) => onUpdatePriority(task.id, p)}
                      showRepo={selectedProject === ALL_PROJECTS && projects.length > 1}
                    />
                  </div>
                ))}

                {/* Show more / Show less for collapsible columns */}
                {isCollapsible && !isExpanded && (
                  <button
                    onClick={() => toggleColumn(col.key)}
                    className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2.5 rounded-lg hover:bg-zinc-800/50 transition-all duration-200 cursor-pointer ring-1 ring-transparent hover:ring-zinc-700/50"
                  >
                    Show {hiddenCount} more
                  </button>
                )}
                {isCollapsible && isExpanded && (
                  <button
                    onClick={() => toggleColumn(col.key)}
                    className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2.5 rounded-lg hover:bg-zinc-800/50 transition-all duration-200 cursor-pointer ring-1 ring-transparent hover:ring-zinc-700/50"
                  >
                    Show less
                  </button>
                )}

                {allColTasks.length === 0 && (
                  <div className="text-center text-xs text-zinc-600 py-10">No tasks</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
