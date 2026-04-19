'use client';

import { useCallback } from 'react';
import { useTaskStore } from '@/stores/task-store';
import { useToastStore } from '@/stores/toast-store';

export function useTasks(send: (type: string, payload?: Record<string, unknown>) => void) {
  const { tasks, selectedTaskId, taskLogs } = useTaskStore();

  const approveTask = useCallback((taskId: string, overrides?: { priority?: string; model?: string; reason?: string }) => {
    // Check task exists before optimistic update
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!task) {
      useToastStore.getState().addToast('error', 'Task no longer exists');
      return;
    }
    // Optimistic: move card to approved immediately
    useTaskStore.getState().optimisticUpdate(taskId, { status: 'approved' });
    send('task:approve', { taskId, actionedBy: 'Dashboard', ...overrides });
  }, [send]);

  const rejectTask = useCallback((taskId: string, reason?: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!task) {
      useToastStore.getState().addToast('error', 'Task no longer exists');
      return;
    }
    useTaskStore.getState().optimisticUpdate(taskId, { status: 'cancelled' });
    send('task:reject', { taskId, actionedBy: 'Dashboard', reason });
  }, [send]);

  const cancelTask = useCallback((taskId: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!task) {
      useToastStore.getState().addToast('error', 'Task no longer exists');
      return;
    }
    useTaskStore.getState().optimisticUpdate(taskId, { status: 'cancelled' });
    send('task:cancel', { taskId });
  }, [send]);

  const updatePriority = useCallback((taskId: string, priority: string) => {
    send('task:update_priority', { taskId, priority });
  }, [send]);

  const fetchLogs = useCallback((taskId: string) => {
    send('task:logs', { taskId });
  }, [send]);

  const refreshTasks = useCallback(() => {
    send('task:list');
  }, [send]);

  const setTaskStatus = useCallback((taskId: string, status: string, reason?: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!task) {
      useToastStore.getState().addToast('error', 'Task no longer exists');
      return;
    }
    useTaskStore.getState().optimisticUpdate(taskId, { status: status as import('@/types').Task['status'] });
    send('task:set_status', { taskId, status, actionedBy: 'Dashboard', reason });
  }, [send]);

  const interactWithTask = useCallback((taskId: string, instruction: string) => {
    const task = useTaskStore.getState().tasks.find(t => t.id === taskId);
    if (!task) {
      useToastStore.getState().addToast('error', 'Task no longer exists');
      return;
    }
    useTaskStore.getState().optimisticUpdate(taskId, { status: 'approved' });
    send('task:interact', { taskId, instruction });
  }, [send]);

  return {
    tasks,
    selectedTaskId,
    taskLogs,
    approveTask,
    rejectTask,
    cancelTask,
    updatePriority,
    fetchLogs,
    refreshTasks,
    setTaskStatus,
    interactWithTask,
  };
}
