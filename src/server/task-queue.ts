import { v4 as uuidv4 } from 'uuid';
import { db, collections, taskLogs, FieldValue, toISOString } from './firestore';
import { eventBus, type TaskEvent } from './event-bus';
import { notionClient } from './integrations/notion';
import { retryFirestoreWrite } from './utils/reliability';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'suggested' | 'approved' | 'queued' | 'in_progress' | 'verifying' | 'in_review' | 'done' | 'failed' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  branch?: string;
  repo?: string;
  project?: string;
  model: string;
  engineer_id?: string;
  tokens_used: number;
  pr_url?: string;
  error?: string;
  verification_warning?: string;
  errors: string[];
  verification_warnings: string[];
  notion_page_id?: string;
  actioned_by?: string;
  action_reason?: string;
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

export interface TaskLog {
  id: number;
  task_id: string;
  source: string;
  content: string;
  timestamp: string;
}

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function docToTask(id: string, data: FirebaseFirestore.DocumentData): Task {
  return {
    id,
    title: data.title || '',
    description: data.description || '',
    status: data.status || 'suggested',
    priority: data.priority || 'P2',
    branch: data.branch || undefined,
    repo: data.repo || undefined,
    project: data.project || undefined,
    model: data.model || 'sonnet',
    engineer_id: data.engineer_id || undefined,
    tokens_used: data.tokens_used ?? data.cost_usd ?? 0,
    pr_url: data.pr_url || undefined,
    error: data.error || undefined,
    verification_warning: data.verification_warning || undefined,
    errors: Array.isArray(data.errors) ? data.errors : [],
    verification_warnings: Array.isArray(data.verification_warnings) ? data.verification_warnings : [],
    notion_page_id: data.notion_page_id || undefined,
    actioned_by: data.actioned_by || undefined,
    action_reason: data.action_reason || undefined,
    slack_message_ts: data.slack_message_ts || undefined,
    slack_channel_id: data.slack_channel_id || undefined,
    // Project execution engine fields
    dependsOn: Array.isArray(data.dependsOn) ? data.dependsOn : undefined,
    completionSummary: data.completionSummary || undefined,
    phaseId: data.phaseId || undefined,
    projectId: data.projectId || undefined,
    skillProfile: data.skillProfile || undefined,
    created_at: toISOString(data.created_at),
    updated_at: toISOString(data.updated_at),
  };
}

export class TaskQueue {
  async createTask(params: {
    title: string;
    description: string;
    branch?: string;
    repo?: string;
    project?: string;
    model?: string;
    priority?: string;
    notion_page_id?: string;
    dependsOn?: string[];
    phaseId?: string;
    projectId?: string;
    skillProfile?: string;
    status?: string;
  }): Promise<Task> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const taskData = {
      title: params.title,
      description: params.description,
      status: params.status || 'suggested',
      priority: params.priority || 'P2',
      branch: params.branch || null,
      repo: params.repo || null,
      project: params.project || null,
      model: params.model || 'sonnet',
      engineer_id: null,
      tokens_used: 0,
      pr_url: null,
      error: null,
      verification_warning: null,
      errors: [],
      verification_warnings: [],
      notion_page_id: params.notion_page_id || null,
      actioned_by: null,
      action_reason: null,
      slack_message_ts: null,
      slack_channel_id: null,
      // Project execution engine fields
      dependsOn: params.dependsOn || null,
      completionSummary: null,
      phaseId: params.phaseId || null,
      projectId: params.projectId || null,
      skillProfile: params.skillProfile || null,
      created_at: now,
      updated_at: now,
    };

    const task = docToTask(id, taskData);
    // Add to local cache immediately so dequeue() and getTask() can find it
    this._cache.set(id, task);
    eventBus.emitDashboard({ type: 'task:created', data: taskToEvent(task) });

    // Await Firestore write so cache and Firestore stay in sync
    try {
      await retryFirestoreWrite(
        () => collections.tasks.doc(id).set(taskData),
        3, 500, 'TaskQueue.createTask',
      );
    } catch (err) {
      console.error('[TaskQueue] Failed to write task to Firestore after retries — removing from cache:', err);
      this._cache.delete(id);
    }

    // Sync to Notion (async, non-blocking)
    this.syncToNotion(task);

    return task;
  }

  getTask(id: string): Task | null {
    // Synchronous read not possible with Firestore — use cached approach
    // For sync callers, we return null and they should use getTaskAsync
    return this._cache.get(id) || null;
  }

  async getTaskAsync(id: string): Promise<Task | null> {
    const doc = await collections.tasks.doc(id).get();
    if (!doc.exists) return null;
    const task = docToTask(doc.id, doc.data()!);
    this._cache.set(id, task);
    return task;
  }

  getAllTasks(): Task[] {
    return Array.from(this._cache.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  async getAllTasksAsync(): Promise<Task[]> {
    const snap = await collections.tasks.orderBy('created_at', 'desc').get();
    const firestoreTasks = snap.docs.map(doc => docToTask(doc.id, doc.data()));

    // Merge Firestore results into cache, preferring whichever has the newer updated_at.
    // This preserves in-flight creates/updates that haven't landed in Firestore yet.
    const firestoreIds = new Set<string>();
    for (const t of firestoreTasks) {
      firestoreIds.add(t.id);
      const cached = this._cache.get(t.id);
      if (cached && new Date(cached.updated_at).getTime() > new Date(t.updated_at).getTime()) {
        // Cache is newer — keep it
        continue;
      }
      this._cache.set(t.id, t);
    }
    // Don't remove cache entries missing from Firestore — they may be in-flight creates

    return Array.from(this._cache.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  getTasksByStatus(...statuses: string[]): Task[] {
    return Array.from(this._cache.values())
      .filter(t => statuses.includes(t.status))
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 9;
        const pb = PRIORITY_ORDER[b.priority] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
  }

  async getTasksByStatusAsync(...statuses: string[]): Promise<Task[]> {
    const snap = await collections.tasks.where('status', 'in', statuses).get();
    const tasks = snap.docs.map(doc => docToTask(doc.id, doc.data()));
    for (const t of tasks) this._cache.set(t.id, t);
    return tasks.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 9;
      const pb = PRIORITY_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }

  async updateTask(id: string, updates: Partial<Pick<Task, 'status' | 'priority' | 'engineer_id' | 'tokens_used' | 'pr_url' | 'error' | 'verification_warning' | 'notion_page_id' | 'branch' | 'model' | 'actioned_by' | 'action_reason' | 'slack_message_ts' | 'slack_channel_id'>>): Promise<Task | null> {
    const fields: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        fields[key] = value;
      }
    }

    if (Object.keys(fields).length === 0) return this.getTask(id);

    fields.updated_at = new Date().toISOString();

    // S11: Write Firestore first, then update cache on success. On failure, revert.
    // Snapshot the cached task before mutation so we can revert on Firestore failure.
    const cached = this._cache.get(id);
    const cacheSnapshot = cached ? { ...cached } : null;

    // Optimistically update cache for fast local reads
    if (cached) {
      Object.assign(cached, fields);
      this._cache.set(id, cached);
      if (fields.status) {
        console.log(`[TaskQueue] updateTask: task ${id.slice(0, 8)} cache updated to status="${fields.status}"; approved-count=${this.getTasksByStatus('approved', 'queued').length}`);
      }
    }

    const task = this.getTask(id);
    if (task) {
      eventBus.emitDashboard({ type: 'task:updated', data: taskToEvent(task) });
      // Sync status changes to Notion (async, non-blocking)
      if (updates.status && task.notion_page_id) {
        this.syncStatusToNotion(task.notion_page_id, updates.status);
      } else if (updates.status && !task.notion_page_id && notionClient.isConfigured) {
        console.warn(`[Notion] Skipping status sync for task ${id.slice(0, 8)} — no notion_page_id`);
      }
    }

    // Persist to Firestore — revert cache on failure
    try {
      await collections.tasks.doc(id).update(fields);
    } catch (err) {
      console.error('[TaskQueue] Failed to update task in Firestore — reverting cache:', err);
      // Revert cache to pre-update state
      if (cacheSnapshot) {
        this._cache.set(id, cacheSnapshot as Task);
      }
    }

    return task;
  }

  addLog(taskId: string, content: string, source: string = 'engineer'): void {
    const logData = {
      task_id: taskId,
      source,
      content,
      timestamp: new Date().toISOString(),
    };
    retryFirestoreWrite(
      () => taskLogs(taskId).add(logData),
      3, 500, 'TaskQueue.addLog',
    ).catch(err =>
      console.error('[TaskQueue] Failed to add log to Firestore after retries:', err)
    );
  }

  async getLogsAsync(taskId: string, limit: number = 200): Promise<TaskLog[]> {
    const snap = await taskLogs(taskId).orderBy('timestamp', 'desc').limit(limit).get();
    return snap.docs.map((doc, index) => {
      const data = doc.data() || {};
      return {
        id: index,
        task_id: data.task_id || taskId,
        source: data.source || 'unknown',
        content: data.content || '',
        timestamp: toISOString(data.timestamp),
      };
    });
  }

  getLogs(taskId: string, limit: number = 200): TaskLog[] {
    // Return from log cache if available
    return this._logCache.get(taskId)?.slice(0, limit) || [];
  }

  /** Get next task ready for execution, ordered by priority. Skips tasks with unmet dependencies. */
  dequeue(): Task | null {
    const tasks = this.getTasksByStatus('approved', 'queued');
    for (const task of tasks) {
      if (!task.dependsOn || task.dependsOn.length === 0) return task;
      const allDone = task.dependsOn.every(depId => {
        const dep = this.getTask(depId);
        return dep?.status === 'done';
      });
      if (allDone) return task;
    }
    return null;
  }

  /** Atomically claim a task for an engineer using a Firestore transaction */
  async atomicClaim(taskId: string, engineerId: string): Promise<boolean> {
    try {
      const success = await db.runTransaction(async (txn) => {
        const ref = collections.tasks.doc(taskId);
        const snap = await txn.get(ref);
        if (!snap.exists) return false;
        const data = snap.data()!;
        if (data.status !== 'approved' && data.status !== 'queued') return false;
        txn.update(ref, {
          status: 'in_progress',
          engineer_id: engineerId,
          updated_at: new Date().toISOString(),
        });
        return true;
      });

      if (success) {
        // Update local cache to match
        const cached = this._cache.get(taskId);
        if (cached) {
          cached.status = 'in_progress';
          cached.engineer_id = engineerId;
          cached.updated_at = new Date().toISOString();
        }
      }
      return success;
    } catch (err) {
      console.error('[TaskQueue] atomicClaim transaction failed:', err);
      return false;
    }
  }

  /** Track daily token usage */
  addTokens(amount: number): number {
    const today = new Date().toISOString().slice(0, 10);

    // Update cache
    this._dailyTokens = (this._dailyTokens || 0) + amount;

    // Write to Firestore (merge to handle concurrent updates)
    retryFirestoreWrite(
      () => collections.dailyTokens.doc(today).set(
        { total_tokens: FieldValue.increment(amount), date: today },
        { merge: true }
      ),
      3, 500, 'TaskQueue.addTokens',
    ).catch(err =>
      console.error('[TaskQueue] Failed to update daily tokens after retries:', err)
    );

    return this._dailyTokens;
  }

  getDailyTokens(): number {
    return this._dailyTokens || 0;
  }

  async getDailyTokensAsync(): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const doc = await collections.dailyTokens.doc(today).get();
    this._dailyTokens = doc.exists ? (doc.data()!.total_tokens || 0) : 0;
    return this._dailyTokens;
  }

  /** Initialize cache from Firestore on startup */
  async hydrate(): Promise<void> {
    try {
      const tasks = await this.getAllTasksAsync();
      console.log(`[TaskQueue] Hydrated ${tasks.length} tasks from Firestore`);
      await this.getDailyTokensAsync();
    } catch (err) {
      console.error('[TaskQueue] Failed to hydrate from Firestore:', err);
    }
  }

  // ---- Internal Cache ----
  private _cache: Map<string, Task> = new Map();
  private _logCache: Map<string, TaskLog[]> = new Map();
  private _dailyTokens: number = 0;
  private _retryContext: Map<string, string> = new Map();
  private _interactionContext: Map<string, string> = new Map();

  // ---- Clear Current Error/Warning (preserves history arrays) ----

  async clearCurrentError(taskId: string): Promise<void> {
    const cached = this._cache.get(taskId);
    if (cached) {
      cached.error = undefined;
      cached.updated_at = new Date().toISOString();
    }
    try {
      await collections.tasks.doc(taskId).update({ error: null, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[TaskQueue] Failed to clear error:', err);
    }
  }

  async clearCurrentWarning(taskId: string): Promise<void> {
    const cached = this._cache.get(taskId);
    if (cached) {
      cached.verification_warning = undefined;
      cached.updated_at = new Date().toISOString();
    }
    try {
      await collections.tasks.doc(taskId).update({ verification_warning: null, updated_at: new Date().toISOString() });
    } catch (err) {
      console.error('[TaskQueue] Failed to clear verification warning:', err);
    }
  }

  // ---- History Append Helpers ----

  /** Append a verification warning to history and set it as the current warning */
  async appendVerificationWarning(taskId: string, warning: string): Promise<void> {
    const cached = this._cache.get(taskId);
    if (cached) {
      cached.verification_warnings = [...(cached.verification_warnings || []), warning];
      cached.verification_warning = warning;
      cached.updated_at = new Date().toISOString();
      this._cache.set(taskId, cached);
    }

    const task = this.getTask(taskId);
    if (task) {
      eventBus.emitDashboard({ type: 'task:updated', data: taskToEvent(task) });
    }

    try {
      await retryFirestoreWrite(
        () => collections.tasks.doc(taskId).update({
          verification_warning: warning,
          verification_warnings: FieldValue.arrayUnion(warning),
          updated_at: new Date().toISOString(),
        }),
        3, 500, 'TaskQueue.appendVerificationWarning',
      );
    } catch (err) {
      console.error('[TaskQueue] Failed to append verification warning after retries:', err);
    }
  }

  /** Append an error to history and set it as the current error */
  async appendError(taskId: string, error: string): Promise<void> {
    const cached = this._cache.get(taskId);
    if (cached) {
      cached.errors = [...(cached.errors || []), error];
      cached.error = error;
      cached.updated_at = new Date().toISOString();
      this._cache.set(taskId, cached);
    }

    const task = this.getTask(taskId);
    if (task) {
      eventBus.emitDashboard({ type: 'task:updated', data: taskToEvent(task) });
    }

    try {
      await retryFirestoreWrite(
        () => collections.tasks.doc(taskId).update({
          error,
          errors: FieldValue.arrayUnion(error),
          updated_at: new Date().toISOString(),
        }),
        3, 500, 'TaskQueue.appendError',
      );
    } catch (err) {
      console.error('[TaskQueue] Failed to append error after retries:', err);
    }
  }

  // ---- Completion Summary ----

  async updateCompletionSummary(taskId: string, summary: string): Promise<void> {
    const cached = this._cache.get(taskId);
    if (cached) {
      cached.completionSummary = summary;
      cached.updated_at = new Date().toISOString();
      this._cache.set(taskId, cached);
    }
    try {
      await retryFirestoreWrite(
        () => collections.tasks.doc(taskId).update({
          completionSummary: summary,
          updated_at: new Date().toISOString(),
        }),
        3, 500, 'TaskQueue.updateCompletionSummary',
      );
    } catch (err) {
      console.error('[TaskQueue] Failed to update completion summary after retries:', err);
    }
  }

  /** Get tasks belonging to a project */
  getTasksByProject(projectId: string): Task[] {
    return Array.from(this._cache.values())
      .filter(t => t.projectId === projectId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  /** Get tasks belonging to a specific phase */
  getTasksByPhase(projectId: string, phaseId: string): Task[] {
    return Array.from(this._cache.values())
      .filter(t => t.projectId === projectId && t.phaseId === phaseId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  // ---- Retry Context ----

  setRetryContext(taskId: string, context: string): void {
    this._retryContext.set(taskId, context);
  }

  getRetryContext(taskId: string): string | undefined {
    const ctx = this._retryContext.get(taskId);
    if (ctx) this._retryContext.delete(taskId); // consume once
    return ctx;
  }

  // ---- Interaction Context ----

  setInteractionContext(taskId: string, context: string): void {
    this._interactionContext.set(taskId, context);
  }

  getInteractionContext(taskId: string): string | undefined {
    const ctx = this._interactionContext.get(taskId);
    if (ctx) this._interactionContext.delete(taskId); // consume once
    return ctx;
  }

  // ---- Notion Sync ----

  /** Create a Notion ticket for a task (async, non-blocking) */
  private async syncToNotion(task: Task): Promise<void> {
    if (!notionClient.isConfigured) return;

    try {
      const notionStatus = this.mapStatusToNotion(task.status);
      let page;
      try {
        page = await notionClient.createTicket({
          title: task.title,
          description: task.description,
          status: notionStatus,
          priority: task.priority,
        });
      } catch (firstErr) {
        // Retry without Status/Priority — schema mismatch is the most common cause
        console.warn(`[Notion] First attempt failed for "${task.title}" (${(firstErr as Error).message}), retrying without Status/Priority`);
        page = await notionClient.createTicket({
          title: task.title,
          description: task.description,
        });
      }

      // Store the Notion page ID on the task
      retryFirestoreWrite(
        () => collections.tasks.doc(task.id).update({ notion_page_id: page.id }),
        3, 500, 'TaskQueue.syncToNotion',
      ).catch((err) => {
        console.warn(`[Notion] Failed to store notion_page_id for task "${task.title}" after retries:`, (err as Error).message);
      });
      const cached = this._cache.get(task.id);
      if (cached) {
        cached.notion_page_id = page.id;
      }
      console.log(`[Notion] Created ticket for task "${task.title}": ${page.url}`);
    } catch (err) {
      console.error(`[Notion] Failed to create ticket for task "${task.title}":`, (err as Error).message);
    }
  }

  /** Sync a status change to Notion (async, non-blocking) */
  private async syncStatusToNotion(notionPageId: string, status: string): Promise<void> {
    if (!notionClient.isConfigured) return;

    try {
      const notionStatus = this.mapStatusToNotion(status);
      await notionClient.updateTicketStatus(notionPageId, notionStatus);
      console.log(`[Notion] Updated ticket status to "${notionStatus}"`);
    } catch (err) {
      console.error(`[Notion] Failed to sync status:`, (err as Error).message);
    }
  }

  /** Add a completion summary comment to the Notion ticket */
  async addCompletionComment(taskId: string, summary: string, prUrl?: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!notionClient.isConfigured) return;
    if (!task?.notion_page_id) {
      console.warn(`[Notion] Skipping completion comment for task "${task?.title}" — no notion_page_id`);
      return;
    }

    try {
      const lines: string[] = [];
      lines.push('--- Engineer Completion Summary ---');
      lines.push('');
      if (prUrl) {
        lines.push(`PR: ${prUrl}`);
      }
      lines.push(`Status: ${task.error ? 'Failed' : 'Completed'}`);
      lines.push(`Tokens used: ${task.tokens_used.toLocaleString()}`);
      lines.push('');
      lines.push(summary);

      await notionClient.appendToPage(task.notion_page_id, lines.join('\n'));
      console.log(`[Notion] Added completion comment to task "${task.title}"`);
    } catch (err) {
      console.error(`[Notion] Failed to add completion comment:`, (err as Error).message);
    }
  }

  /** Map CTO dashboard task status to Notion board status */
  private mapStatusToNotion(status: string): string {
    const map: Record<string, string> = {
      suggested: 'Backlog',
      approved: 'To Do',
      queued: 'To Do',
      in_progress: 'In Progress',
      verifying: 'In Progress',
      in_review: 'In Review',
      done: 'Done',
      failed: 'Blocked',
      cancelled: 'Cancelled',
    };
    return map[status] || 'Backlog';
  }
}

function taskToEvent(task: Task): TaskEvent {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    branch: task.branch,
    repo: task.repo,
    project: task.project,
    model: task.model,
    engineer_id: task.engineer_id,
    tokens_used: task.tokens_used,
    pr_url: task.pr_url,
    error: task.error,
    verification_warning: task.verification_warning,
    errors: task.errors,
    verification_warnings: task.verification_warnings,
    actioned_by: task.actioned_by,
    action_reason: task.action_reason,
    notion_page_id: task.notion_page_id,
    slack_message_ts: task.slack_message_ts,
    slack_channel_id: task.slack_channel_id,
    dependsOn: task.dependsOn,
    completionSummary: task.completionSummary,
    phaseId: task.phaseId,
    projectId: task.projectId,
    skillProfile: task.skillProfile,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

export const taskQueue = new TaskQueue();
