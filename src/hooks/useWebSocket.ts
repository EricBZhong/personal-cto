'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useTaskStore } from '@/stores/task-store';
import { useEngineerStore } from '@/stores/engineer-store';
import { useDogfoodStore } from '@/stores/dogfood-store';
import { useSetupStore } from '@/stores/setup-store';
import { useSlackStore } from '@/stores/slack-store';
import { usePRStore } from '@/stores/pr-store';
import { useProjectStore } from '@/stores/project-store';
import type { ServerEvent, PullRequest, PRReview, Project, MemoryEntry, DeployRecord } from '@/types';
import { useToastStore } from '@/stores/toast-store';

interface QueuedMessage {
  type: string;
  payload?: Record<string, unknown>;
}

function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3101';
  // In production (Cloud Run), connect to the same origin on /ws path
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  // Local dev: connect to the orchestrator on port 3101
  return 'ws://localhost:3101';
}

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageQueueRef = useRef<QueuedMessage[]>([]);
  const logDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const chatStore = useChatStore();
  const taskStore = useTaskStore();
  const engineerStore = useEngineerStore();

  const send = useCallback((type: string, payload?: Record<string, unknown>) => {
    const ready = wsRef.current?.readyState === WebSocket.OPEN;
    console.log(`[WS] send(${type}) readyState=${wsRef.current?.readyState} open=${ready}`);
    if (ready) {
      wsRef.current!.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('[WS] Cannot send — buffering message:', type);
      messageQueueRef.current.push({ type, payload });
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data) as ServerEvent;

      switch (msg.type) {
        case 'cto:chunk':
          if ('data' in msg) {
            const { text, messageId } = msg.data;
            // If we don't have a streaming message yet, create one
            if (!useChatStore.getState().streamingMessageId) {
              useChatStore.getState().startStreaming(messageId);
            }
            useChatStore.getState().appendChunk(messageId, text);
          }
          break;

        case 'cto:done':
          if ('data' in msg) {
            const { messageId, fullText, tokensUsed } = msg.data;
            useChatStore.getState().finishStreaming(messageId, fullText, tokensUsed);
          }
          break;

        case 'cto:error':
          if ('data' in msg) {
            const { messageId, error } = msg.data;
            // If no streaming message exists yet, create one so the error is visible
            if (!useChatStore.getState().streamingMessageId) {
              useChatStore.getState().startStreaming(messageId);
            }
            useChatStore.getState().setError(messageId, error);
          }
          break;

        case 'chat:history':
          if ('payload' in msg) {
            const activeThreadId = useChatStore.getState().activeThreadId;
            const messages = msg.payload.messages.map((m, i) => ({
              id: `hist-${activeThreadId}-${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp,
            }));
            useChatStore.getState().setHistory(messages);
          }
          break;

        case 'task:created':
          if ('data' in msg) {
            useTaskStore.getState().addTask(msg.data as import('@/types').Task);
          }
          break;

        case 'task:updated':
          if ('data' in msg) {
            const taskUpdate = msg.data as Partial<import('@/types').Task> & { id: string };
            useTaskStore.getState().updateTask(taskUpdate);
            // Confirm any pending optimistic update for this task
            useTaskStore.getState().confirmOptimistic(taskUpdate.id);
          }
          break;

        case 'task:logs_updated':
          if ('data' in msg) {
            const { taskId: updatedTaskId } = msg.data as { taskId: string };
            // Auto-refresh logs if user is viewing this task (debounced)
            if (updatedTaskId === useTaskStore.getState().selectedTaskId) {
              if (logDebounceRef.current) clearTimeout(logDebounceRef.current);
              logDebounceRef.current = setTimeout(() => {
                wsRef.current?.send(JSON.stringify({ type: 'task:logs', payload: { taskId: updatedTaskId } }));
                logDebounceRef.current = null;
              }, 500);
            }
          }
          break;

        case 'task:list':
          if ('payload' in msg) {
            useTaskStore.getState().setTasks(msg.payload.tasks);
          }
          break;

        case 'task:logs':
          if ('payload' in msg) {
            useTaskStore.getState().setTaskLogs(msg.payload.taskId, msg.payload.logs);
          }
          break;

        case 'engineer:spawned':
          if ('data' in msg) {
            useEngineerStore.getState().addEngineer(msg.data as import('@/types').Engineer);
            useToastStore.getState().addToast('info', `Engineer started: ${(msg.data as import('@/types').Engineer).taskTitle}`);
          }
          break;

        case 'engineer:chunk':
          if ('data' in msg) {
            useEngineerStore.getState().appendEngineerLog(msg.data.engineerId, msg.data.text);
          }
          break;

        case 'engineer:done':
          if ('data' in msg) {
            useEngineerStore.getState().removeEngineer(msg.data.engineerId);
            useToastStore.getState().addToast('success', 'Engineer completed task');
          }
          break;

        case 'engineer:error':
          if ('data' in msg) {
            useEngineerStore.getState().removeEngineer(msg.data.engineerId);
            useToastStore.getState().addToast('error', `Engineer failed: ${msg.data.error || 'unknown error'}`);
          }
          break;

        case 'engineer:list':
          if ('payload' in msg) {
            useEngineerStore.getState().setEngineers(msg.payload.engineers);
          }
          break;

        case 'system:status': {
          const statusData = 'data' in msg ? msg.data : (msg as Record<string, unknown>).payload;
          if (statusData) {
            useEngineerStore.getState().setSystemStatus(statusData as import('@/types').SystemStatus);
          }
          break;
        }

        // Thread events
        case 'thread:list':
          if ('payload' in msg) {
            useChatStore.getState().setThreads(msg.payload.threads, msg.payload.activeThreadId);
          }
          break;

        case 'thread:created':
          if ('payload' in msg) {
            useChatStore.getState().addThread(msg.payload.thread);
          }
          break;

        case 'thread:switched':
          if ('payload' in msg) {
            const switchedThreadId = msg.payload.threadId as string;
            const messages = msg.payload.messages.map((m: { role: string; content: string; timestamp: string }, i: number) => ({
              id: `hist-${switchedThreadId}-${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp,
            }));
            useChatStore.getState().switchToThread(switchedThreadId, messages);
          }
          break;

        case 'thread:deleted':
          if ('payload' in msg) {
            useChatStore.getState().removeThread(msg.payload.threadId);
          }
          break;

        // Dogfood events
        case 'dogfood:started':
          if ('payload' in msg) {
            useDogfoodStore.getState().setRunning(msg.payload.testType, msg.payload.withAnalysis);
          }
          break;

        case 'dogfood:results':
          if ('payload' in msg) {
            useDogfoodStore.getState().setResults(msg.payload.results, msg.payload.report);
          }
          break;

        case 'dogfood:error':
          if ('payload' in msg) {
            useDogfoodStore.getState().setError(msg.payload.error);
          }
          break;

        case 'dogfood:progress':
          if ('payload' in msg) {
            useDogfoodStore.getState().addProgress(msg.payload);
          }
          break;

        // Eval events — store in dogfood store
        case 'eval:list':
        case 'eval:created':
        case 'eval:deleted':
        case 'eval:history':
        case 'eval:import_done':
          useDogfoodStore.getState().handleEvalEvent(msg.type, (msg as Record<string, unknown>).payload as Record<string, unknown>);
          break;

        // Slack events
        case 'slack:conversations':
          if ('payload' in msg) {
            const slackPayload = msg.payload as { conversations: import('@/types').SlackConversation[] };
            useSlackStore.getState().setConversations(slackPayload.conversations);
          }
          break;

        case 'slack:queue':
          if ('payload' in msg) {
            const queuePayload = msg.payload as { queue: import('@/types').SlackConversation[] };
            useSlackStore.getState().setQueue(queuePayload.queue);
          }
          break;

        case 'slack:status':
          if ('payload' in msg) {
            const statusPayload = msg.payload as { connected: boolean };
            useSlackStore.getState().setSlackConnected(statusPayload.connected);
          }
          break;

        // PR Review events
        case 'pr:list':
          if ('payload' in msg) {
            const prPayload = msg.payload as { prs: PullRequest[] };
            usePRStore.getState().setPRs(prPayload.prs);
          }
          break;

        case 'pr:detail':
          if ('payload' in msg) {
            const detailPayload = msg.payload as { pr: PullRequest; diff: string; reviews: PRReview[] };
            usePRStore.getState().setPRDetail(detailPayload);
          }
          break;

        case 'pr:review_started':
          if ('payload' in msg) {
            const startPayload = msg.payload as { prNumber: number };
            usePRStore.getState().setReviewInProgress(startPayload.prNumber);
          }
          break;

        case 'pr:review_complete':
          if ('payload' in msg) {
            const completePayload = msg.payload as { prNumber: number; reviewText: string; recommendation: string };
            usePRStore.getState().setReviewComplete(completePayload.prNumber, completePayload.reviewText, completePayload.recommendation);
          }
          break;

        case 'pr:action_result':
          if ('payload' in msg) {
            const actionPayload = msg.payload as { prNumber: number; action: string; success: boolean; error?: string };
            usePRStore.getState().handleActionResult(actionPayload.prNumber, actionPayload.action, actionPayload.success, actionPayload.error);
          }
          break;

        case 'pr:added':
          if ('payload' in msg) {
            const addedPayload = msg.payload as { pr?: PullRequest; error?: string };
            if (addedPayload.pr) {
              usePRStore.getState().addPR(addedPayload.pr);
              useToastStore.getState().addToast('success', `Added PR #${addedPayload.pr.number}: ${addedPayload.pr.title}`);
            }
            if (addedPayload.error) {
              usePRStore.getState().setError(addedPayload.error);
              useToastStore.getState().addToast('error', `Failed to add PR: ${addedPayload.error}`);
            }
          }
          break;

        // Daily check-in events — dispatch as custom events
        case 'checkin:started':
        case 'checkin:complete':
        case 'checkin:error':
        case 'checkin:report':
        case 'checkin:reports':
          if ('payload' in msg) {
            window.dispatchEvent(new CustomEvent(msg.type, { detail: msg.payload }));
          }
          break;

        // Config data — dispatch as custom event for any page that needs it
        case 'config:data':
          if ('payload' in msg) {
            window.dispatchEvent(new CustomEvent('config:data', { detail: msg.payload }));
          }
          break;

        // Analytics data — dispatch as custom event for the analytics page
        case 'analytics:usage':
          if ('payload' in msg) {
            window.dispatchEvent(new CustomEvent('analytics:usage', { detail: msg.payload }));
          }
          break;

        case 'analytics:activity':
          if ('payload' in msg) {
            window.dispatchEvent(new CustomEvent('analytics:activity', { detail: msg.payload }));
          }
          break;

        // Compliance data
        case 'compliance:overview':
        case 'compliance:failing':
          if ('payload' in msg) {
            window.dispatchEvent(new CustomEvent(msg.type, { detail: msg.payload }));
          }
          break;

        // Setup wizard — CTO or server triggers integration setup
        case 'setup:prompt':
          if ('payload' in msg) {
            const payload = msg.payload as { integration: string };
            if (payload.integration) {
              useSetupStore.getState().openSetup(payload.integration);
            }
          }
          break;

        // Project events
        case 'project:list':
          if ('payload' in msg) {
            const projectPayload = msg.payload as { projects?: Project[] };
            if (Array.isArray(projectPayload?.projects)) {
              useProjectStore.getState().setProjects(projectPayload.projects);
            }
          }
          break;

        case 'project:detail':
        case 'project:created':
        case 'project:updated':
          if ('payload' in msg) {
            const projectPayload = msg.payload as { project?: Project };
            if (projectPayload?.project && typeof projectPayload.project === 'object') {
              useProjectStore.getState().addProject(projectPayload.project);
            }
          }
          break;

        case 'project:advanced': {
          // Broadcast event from event bus: data: { projectId, phaseId, phaseName }
          const advData = ('data' in msg ? msg.data : msg.payload) as { projectId?: string; phaseId?: string; phaseName?: string } | undefined;
          if (advData?.phaseName) {
            useToastStore.getState().addToast('info', `Phase "${advData.phaseName}" completed — advancing project`);
          }
          // Refresh project list to get updated state
          wsRef.current?.send(JSON.stringify({ type: 'project:list' }));
          break;
        }

        case 'project:completed': {
          const compData = ('data' in msg ? msg.data : msg.payload) as { projectId?: string } | undefined;
          useToastStore.getState().addToast('success', 'Project completed!');
          wsRef.current?.send(JSON.stringify({ type: 'project:list' }));
          break;
        }

        case 'project:paused': {
          const pauseData = ('data' in msg ? msg.data : msg.payload) as { projectId?: string; reason?: string } | undefined;
          useToastStore.getState().addToast('error', `Project paused${pauseData?.reason ? `: ${pauseData.reason}` : ''}`);
          wsRef.current?.send(JSON.stringify({ type: 'project:list' }));
          break;
        }

        // Memory events
        case 'memory:list':
          if ('payload' in msg) {
            const memPayload = msg.payload as { entries?: MemoryEntry[] };
            if (Array.isArray(memPayload?.entries)) {
              useProjectStore.getState().setMemories(memPayload.entries);
            }
          }
          break;

        case 'memory:added': {
          const raw = msg as unknown as Record<string, unknown>;
          const memAddData = (raw.payload || raw.data) as { entry?: MemoryEntry } | undefined;
          if (memAddData?.entry && typeof memAddData.entry === 'object' && memAddData.entry.id) {
            useProjectStore.getState().addMemory(memAddData.entry);
          }
          break;
        }

        case 'memory:deleted': {
          const raw2 = msg as unknown as Record<string, unknown>;
          const memDelData = (raw2.payload || raw2.data) as { id?: string } | undefined;
          if (memDelData?.id && typeof memDelData.id === 'string') {
            useProjectStore.getState().removeMemory(memDelData.id);
          }
          break;
        }

        // Deploy events
        case 'deploy:started':
        case 'deploy:progress': {
          const rawDep = msg as unknown as Record<string, unknown>;
          const deployEvt = (rawDep.payload || rawDep.data) as { deploy?: DeployRecord } | undefined;
          if (deployEvt?.deploy && typeof deployEvt.deploy === 'object' && deployEvt.deploy.id) {
            useProjectStore.getState().addDeploy(deployEvt.deploy);
          }
          break;
        }

        case 'deploy:completed': {
          const rawDone = msg as unknown as Record<string, unknown>;
          const deployDoneEvt = (rawDone.payload || rawDone.data) as { deploy?: DeployRecord } | undefined;
          if (deployDoneEvt?.deploy && typeof deployDoneEvt.deploy === 'object' && deployDoneEvt.deploy.id) {
            useProjectStore.getState().updateDeploy(deployDoneEvt.deploy);
            const dStatus = deployDoneEvt.deploy.status === 'succeeded' ? 'success' : 'error';
            const dLabel = deployDoneEvt.deploy.status === 'succeeded' ? 'Deploy succeeded' : 'Deploy failed';
            useToastStore.getState().addToast(dStatus as 'success' | 'error', dLabel);
          }
          break;
        }

        case 'deploy:history':
          if ('payload' in msg) {
            const histPayload = msg.payload as { deploys?: DeployRecord[] };
            if (Array.isArray(histPayload?.deploys)) {
              useProjectStore.getState().setDeploys(histPayload.deploys);
            }
          }
          break;

        // Generic server error (SEC2 rate limit, SEC4 validation, etc.)
        case 'error':
          if ('payload' in msg) {
            const errMsg = (msg.payload as { error?: string }).error || 'Unknown server error';
            console.error('[WS] Server error:', errMsg);
            useToastStore.getState().addToast('error', errMsg);
            // If dogfood is running, surface the error there too
            if (useDogfoodStore.getState().running) {
              useDogfoodStore.getState().setError(errMsg);
            }
          }
          break;
      }
    } catch (err) {
      console.error('[WS] Failed to parse message:', err);
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      console.log('[WS] Connected');
      if (reconnectAttempt.current > 0) {
        useToastStore.getState().addToast('info', 'Reconnected to server');
      }
      setConnected(true);
      setReconnecting(false);
      reconnectAttempt.current = 0;

      // Request initial state
      ws.send(JSON.stringify({ type: 'thread:list' }));
      ws.send(JSON.stringify({ type: 'chat:history' }));
      ws.send(JSON.stringify({ type: 'task:list' }));
      ws.send(JSON.stringify({ type: 'engineer:list' }));
      ws.send(JSON.stringify({ type: 'status:get' }));
      ws.send(JSON.stringify({ type: 'slack:get_conversations' }));
      ws.send(JSON.stringify({ type: 'slack:status' }));
      ws.send(JSON.stringify({ type: 'pr:list' }));
      ws.send(JSON.stringify({ type: 'project:list' }));

      // Flush queued messages that were buffered while disconnected
      const queued = messageQueueRef.current;
      messageQueueRef.current = [];
      for (const m of queued) {
        console.log(`[WS] Flushing queued message: ${m.type}`);
        ws.send(JSON.stringify({ type: m.type, payload: m.payload }));
      }
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setConnected(false);
      useToastStore.getState().addToast('error', 'Disconnected from server');
      wsRef.current = null;
      // Reset dogfood running state so buttons aren't stuck disabled
      if (useDogfoodStore.getState().running) {
        useDogfoodStore.getState().setError('Connection lost during test');
      }

      // Reconnect with exponential backoff
      setReconnecting(true);
      const delay = Math.min(
        RECONNECT_DELAY * Math.pow(2, reconnectAttempt.current),
        MAX_RECONNECT_DELAY
      );
      reconnectAttempt.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };

    wsRef.current = ws;
  }, [handleMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { send, connected, reconnecting };
}
