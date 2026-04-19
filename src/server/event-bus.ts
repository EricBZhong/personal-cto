import { EventEmitter } from 'events';

export type DashboardEvent =
  | { type: 'cto:chunk'; data: { text: string; messageId: string } }
  | { type: 'cto:done'; data: { messageId: string; fullText: string; tokensUsed?: number } }
  | { type: 'cto:error'; data: { error: string; messageId: string } }
  | { type: 'cto:thinking'; data: { text: string; messageId: string } }
  | { type: 'task:created'; data: TaskEvent }
  | { type: 'task:updated'; data: Partial<TaskEvent> & { id: string } }
  | { type: 'task:logs_updated'; data: { taskId: string } }
  | { type: 'engineer:spawned'; data: EngineerSpawnEvent }
  | { type: 'engineer:chunk'; data: { engineerId: string; taskId: string; text: string } }
  | { type: 'engineer:done'; data: EngineerEvent }
  | { type: 'engineer:error'; data: { engineerId: string; taskId: string; error: string } }
  | { type: 'system:status'; data: { engineers: number; activeTasks: number; dailyTokens: number } }
  | { type: 'clarification:sent'; data: { id: string; ticketTitle: string; askUser: string } }
  | { type: 'clarification:answered'; data: { id: string; ticketTitle: string; answeredBy: string; answers: string } }
  | { type: 'strategy:posted'; data: { id: string; ticketTitle: string; channel: string } }
  | { type: 'strategy:decided'; data: { id: string; ticketTitle: string; chosenOption: string; decidedBy: string } }
  // PR Reviews
  | { type: 'pr:review_started'; data: { prNumber: number } }
  | { type: 'pr:review_complete'; data: { prNumber: number; reviewText: string; recommendation: string } }
  | { type: 'pr:action_result'; data: { prNumber: number; action: string; success: boolean; error?: string } }
  // Daily Check-in
  | { type: 'checkin:started'; data: Record<string, never> }
  | { type: 'checkin:complete'; data: { report: unknown } }
  | { type: 'checkin:error'; data: { error: string } }
  // Project lifecycle
  | { type: 'project:created'; data: { project: unknown } }
  | { type: 'project:updated'; data: { project: unknown } }
  | { type: 'project:advanced'; data: { projectId: string; phaseId: string; phaseName: string } }
  | { type: 'project:completed'; data: { projectId: string } }
  | { type: 'project:paused'; data: { projectId: string; reason: string } }
  // Memory
  | { type: 'memory:added'; data: { entry: unknown } }
  | { type: 'memory:deleted'; data: { id: string } }
  // Deploy
  | { type: 'deploy:started'; data: { deploy: unknown } }
  | { type: 'deploy:progress'; data: { deployId: string; status: string; message?: string } }
  | { type: 'deploy:completed'; data: { deploy: unknown } };

export interface TaskEvent {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  branch?: string;
  repo?: string;
  project?: string;
  model: string;
  engineer_id?: string;
  tokens_used: number;
  pr_url?: string;
  error?: string;
  verification_warning?: string;
  errors?: string[];
  verification_warnings?: string[];
  actioned_by?: string;
  action_reason?: string;
  notion_page_id?: string;
  slack_message_ts?: string;
  slack_channel_id?: string;
  // Project execution engine fields
  dependsOn?: string[];
  completionSummary?: string;
  phaseId?: string;
  projectId?: string;
  skillProfile?: string;
  created_at: string;
  updated_at: string;
}

export interface EngineerSpawnEvent {
  id: string;
  taskId: string;
  taskTitle: string;
  model: string;
  startedAt: string;
  tokensUsed: number;
}

export interface EngineerEvent {
  engineerId: string;
  taskId: string;
  status?: string;
  tokensUsed?: number;
}

class DashboardEventBus extends EventEmitter {
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  emitDashboard(event: DashboardEvent): void {
    this.emit('dashboard', event);
    this.emit(event.type, event.data);
  }
}

export const eventBus = new DashboardEventBus();
