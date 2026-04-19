'use client';

import { useEffect } from 'react';
import { TaskBoard } from '@/components/tasks/TaskBoard';
import { TaskDetailSidebar } from '@/components/tasks/TaskDetailSidebar';
import { useWs } from '@/components/layout/DashboardShell';
import { useTasks } from '@/hooks/useTasks';
import { useTaskStore } from '@/stores/task-store';

export default function TasksPage() {
  useEffect(() => {
    document.title = 'Task Board — CTO Dashboard';
  }, []);
  const { send } = useWs();
  const { tasks, approveTask, rejectTask, cancelTask, updatePriority, setTaskStatus, interactWithTask } = useTasks(send);
  const { selectedTaskId, taskLogs, selectTask } = useTaskStore();

  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) : null;
  const selectedLogs = selectedTaskId ? (taskLogs[selectedTaskId] || []) : [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/60">
        <h1 className="text-lg font-semibold text-zinc-200">Task Board</h1>
        <button
          onClick={() => send('task:list')}
          className="text-xs text-zinc-400 hover:text-zinc-200 px-3.5 py-1.5 rounded-lg bg-zinc-800/80 ring-1 ring-zinc-700/50 hover:bg-zinc-700/80 hover:ring-zinc-600/50 transition-all duration-200"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden">
          <TaskBoard
            tasks={tasks}
            onApprove={approveTask}
            onReject={rejectTask}
            onCancel={cancelTask}
            onSelect={(id) => {
              selectTask(id);
              send('task:logs', { taskId: id });
            }}
            onUpdatePriority={updatePriority}
          />
        </div>

        {selectedTask && (
          <TaskDetailSidebar
            task={selectedTask}
            logs={selectedLogs}
            onClose={() => selectTask(null)}
            onApprove={(reason) => { approveTask(selectedTask.id, { reason }); selectTask(null); }}
            onReject={(reason) => { rejectTask(selectedTask.id, reason); selectTask(null); }}
            onCancel={() => { cancelTask(selectedTask.id); selectTask(null); }}
            onRetry={() => send('task:retry', { taskId: selectedTask.id })}
            onRefreshLogs={() => send('task:logs', { taskId: selectedTask.id })}
            onSetStatus={(status, reason) => setTaskStatus(selectedTask.id, status, reason)}
            onInteract={(instruction) => interactWithTask(selectedTask.id, instruction)}
          />
        )}
      </div>
    </div>
  );
}
