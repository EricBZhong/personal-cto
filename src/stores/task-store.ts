import { create } from 'zustand';
import type { Task, TaskLog } from '@/types';
import { useToastStore } from '@/stores/toast-store';

interface TaskStore {
  tasks: Task[];
  selectedTaskId: string | null;
  taskLogs: Record<string, TaskLog[]>;
  pendingActions: Record<string, Task>; // original task state before optimistic update
  pendingTimers: Record<string, ReturnType<typeof setTimeout>>;

  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Partial<Task> & { id: string }) => void;
  selectTask: (id: string | null) => void;
  setTaskLogs: (taskId: string, logs: TaskLog[]) => void;

  // Optimistic updates
  optimisticUpdate: (taskId: string, updates: Partial<Task>) => void;
  confirmOptimistic: (taskId: string) => void;
  revertOptimistic: (taskId: string) => void;
  isPending: (taskId: string) => boolean;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  taskLogs: {},
  pendingActions: {},
  pendingTimers: {},

  setTasks: (tasks) => {
    const { pendingActions, pendingTimers, tasks: currentTasks } = get();
    // If no optimistic updates are pending, just replace wholesale
    if (Object.keys(pendingActions).length === 0) {
      set({ tasks });
      return;
    }
    // Reconcile: auto-confirm pending actions where server already matches expected state
    const reconciledActions = { ...pendingActions };
    const reconciledTimers = { ...pendingTimers };
    for (const [taskId, originalTask] of Object.entries(pendingActions)) {
      const serverTask = tasks.find(t => t.id === taskId);
      const optimisticTask = currentTasks.find(t => t.id === taskId);
      if (serverTask && optimisticTask && serverTask.status === optimisticTask.status) {
        // Server matches expected state — auto-confirm
        if (reconciledTimers[taskId]) clearTimeout(reconciledTimers[taskId]);
        delete reconciledActions[taskId];
        delete reconciledTimers[taskId];
      }
    }
    // Preserve the optimistic version for tasks with remaining pending actions
    const merged = tasks.map(t => {
      if (reconciledActions[t.id]) {
        const current = currentTasks.find(c => c.id === t.id);
        return current || t;
      }
      return t;
    });
    set({ tasks: merged, pendingActions: reconciledActions, pendingTimers: reconciledTimers });
  },

  addTask: (task) => {
    set((state) => {
      // Avoid duplicates
      const exists = state.tasks.find((t) => t.id === task.id);
      if (exists) {
        return { tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)) };
      }
      return { tasks: [task, ...state.tasks] };
    });
  },

  updateTask: (task) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === task.id ? { ...t, ...task } : t)),
    }));
  },

  selectTask: (id) => set({ selectedTaskId: id }),

  setTaskLogs: (taskId, logs) => {
    set((state) => ({
      taskLogs: { ...state.taskLogs, [taskId]: logs },
    }));
  },

  optimisticUpdate: (taskId, updates) => {
    const state = get();
    const original = state.tasks.find((t) => t.id === taskId);
    if (!original) return;

    // Save original state
    const pendingActions = { ...state.pendingActions, [taskId]: { ...original } };

    // Apply optimistic update
    const tasks = state.tasks.map((t) =>
      t.id === taskId ? { ...t, ...updates } : t
    );

    // Set 15s revert timeout (generous to account for network delays)
    const existingTimer = state.pendingTimers[taskId];
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      get().revertOptimistic(taskId);
      useToastStore.getState().addToast('error', 'Task update timed out \u2014 reverting');
    }, 15000);

    set({
      tasks,
      pendingActions,
      pendingTimers: { ...state.pendingTimers, [taskId]: timer },
    });
  },

  confirmOptimistic: (taskId) => {
    const state = get();
    const timer = state.pendingTimers[taskId];
    if (timer) clearTimeout(timer);

    const { [taskId]: _, ...remainingActions } = state.pendingActions;
    const { [taskId]: __, ...remainingTimers } = state.pendingTimers;

    set({
      pendingActions: remainingActions,
      pendingTimers: remainingTimers,
    });
  },

  revertOptimistic: (taskId) => {
    const state = get();
    const original = state.pendingActions[taskId];
    if (!original) return;

    const timer = state.pendingTimers[taskId];
    if (timer) clearTimeout(timer);

    const { [taskId]: _, ...remainingActions } = state.pendingActions;
    const { [taskId]: __, ...remainingTimers } = state.pendingTimers;

    // Restore original task state
    set({
      tasks: state.tasks.map((t) => (t.id === taskId ? original : t)),
      pendingActions: remainingActions,
      pendingTimers: remainingTimers,
    });
  },

  isPending: (taskId) => {
    return taskId in get().pendingActions;
  },
}));
