import WebSocket from 'ws';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { getConfig } from '../config';
import { buildClaudeEnv } from '../claude-auth';
import { collections } from '../firestore';
import { eventBus } from '../event-bus';
import { taskQueue, Task } from '../task-queue';
import { buildCTOSystemPrompt } from '../prompts/cto-system';
import { clarificationTracker, strategyPollTracker } from '../clarification-tracker';
import { notionClient } from './notion';

/**
 * Slack integration for CTO bot.
 */

// Slack error codes that indicate an invalid/revoked token — stop retrying, surface to user
const AUTH_ERRORS = ['not_authed', 'invalid_auth', 'token_revoked', 'account_inactive', 'missing_scope'];

interface SlackEvent {
  type: string;
  envelope_id?: string;
  payload?: {
    type?: string;
    event?: {
      type: string;
      text?: string;
      user?: string;
      channel?: string;
      ts?: string;
      thread_ts?: string;
      channel_type?: string;
      bot_id?: string;
    };
    event_id?: string;
    user?: { id: string; username: string; name: string };
    actions?: Array<{
      action_id: string;
      value: string;
      block_id?: string;
      type: string;
    }>;
    channel?: { id: string; name: string };
    message?: { ts: string };
    container?: { message_ts: string; channel_id: string };
  };
  retry_attempt?: number;
  retry_reason?: string;
}

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: { email?: string };
}

interface SlackPostResult {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

export class SlackBot {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private userCache: Map<string, SlackUser> = new Map();
  private userListCache: SlackUser[] | null = null;
  private connected = false;
  private taskCreatedListener: ((data: unknown) => void) | null = null;
  private taskUpdatedListener: ((data: unknown) => void) | null = null;
  private processingQueue = false;
  private ctoAvailable = true;
  private authFailed = false;
  private reconnectAttempts = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  get isConfigured(): boolean {
    const config = getConfig();
    return !!(config.slackBotToken && config.slackAppToken);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Get trimmed bot token (prevents whitespace/newline auth failures) */
  private get botToken(): string {
    return (getConfig().slackBotToken || '').trim();
  }

  async start(): Promise<void> {
    if (!this.isConfigured) {
      console.log('[Slack] Not configured — skipping. Set Slack tokens in Settings.');
      return;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.connected = false;
    this.authFailed = false;
    this.reconnectAttempts = 0;

    console.log('[Slack] Starting Slack bot...');
    // Clean up old event listeners before re-registering
    if (this.taskCreatedListener) {
      eventBus.removeListener('task:created', this.taskCreatedListener);
      this.taskCreatedListener = null;
    }
    if (this.taskUpdatedListener) {
      eventBus.removeListener('task:updated', this.taskUpdatedListener);
      this.taskUpdatedListener = null;
    }
    await this.connect();
    this.startPeriodicUpdates();
    this.registerEventListeners();

    setTimeout(() => this.drainMessageQueue(), 5000);
  }

  stop(): void {
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.taskCreatedListener) {
      eventBus.removeListener('task:created', this.taskCreatedListener);
      this.taskCreatedListener = null;
    }
    if (this.taskUpdatedListener) {
      eventBus.removeListener('task:updated', this.taskUpdatedListener);
      this.taskUpdatedListener = null;
    }
  }

  private registerEventListeners(): void {
    this.taskCreatedListener = (data: unknown) => {
      const taskEvent = data as { id: string; title: string; status: string; priority: string };
      const task = taskQueue.getTask(taskEvent.id);
      if (task) {
        this.postTaskNotification(task).catch(err =>
          console.error('[Slack] Failed to post task notification:', err)
        );
      }
    };
    eventBus.on('task:created', this.taskCreatedListener);

    this.taskUpdatedListener = (data: unknown) => {
      const taskEvent = data as { id: string; status: string };
      const task = taskQueue.getTask(taskEvent.id);
      if (task?.slack_message_ts && task?.slack_channel_id) {
        const resolvedStatuses = ['approved', 'cancelled', 'done', 'failed'];
        if (resolvedStatuses.includes(task.status)) {
          const actionLabel = task.status === 'approved' ? 'Approved' :
            task.status === 'cancelled' ? 'Rejected' :
            task.status === 'done' ? 'Completed' : 'Failed';
          this.updateMessage(
            task.slack_channel_id,
            task.slack_message_ts,
            `*${task.title}* — ${actionLabel} (from dashboard)`,
            this.buildTaskResolvedBlocks(task, actionLabel, 'Dashboard')
          ).catch(err => console.error('[Slack] Failed to update task message:', err));
        }
      }
    };
    eventBus.on('task:updated', this.taskUpdatedListener);
  }

  private async validateBotToken(botToken: string): Promise<boolean> {
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        console.error(`[Slack] Bot token is invalid or revoked. Please re-authenticate in Settings. (error: ${data.error})`);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[Slack] Failed to validate bot token:', err);
      return false;
    }
  }

  private async connect(): Promise<void> {
    if (this.authFailed) {
      console.warn('[Slack] Auth previously failed — not reconnecting until token is updated in Settings.');
      return;
    }

    // Re-read tokens fresh from config on every connect attempt to support token rotation
    const slackBotToken = (getConfig().slackBotToken || '').trim();
    const slackAppToken = (getConfig().slackAppToken || '').trim();
    if (!slackBotToken || !slackAppToken) {
      console.warn('[Slack] Missing tokens — cannot connect');
      return;
    }

    // Validate bot token before attempting Socket Mode connection
    const tokenValid = await this.validateBotToken(slackBotToken);
    if (!tokenValid) {
      this.connected = false;
      this.ctoAvailable = false;
      this.authFailed = true;
      return;
    }

    try {
      const res = await fetch('https://slack.com/api/apps.connections.open', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackAppToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as { ok: boolean; url?: string; error?: string };
      if (!data.ok || !data.url) {
        if (AUTH_ERRORS.includes(data.error ?? '')) {
          this.handleAuthError(data.error!);
        } else {
          console.error('[Slack] Failed to open connection:', data.error);
          this.scheduleReconnect();
        }
        return;
      }

      this.ws = new WebSocket(data.url);

      this.ws.on('open', () => {
        console.log('[Slack] Socket Mode connected');
        this.connected = true;
        this.reconnectAttempts = 0;

        // S21: Start 30s heartbeat ping to keep Socket Mode connection alive
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30_000);
      });

      this.ws.on('message', (raw: Buffer) => {
        try {
          const event: SlackEvent = JSON.parse(raw.toString());
          this.handleSocketEvent(event);
        } catch (err) {
          console.error('[Slack] Failed to parse event:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('[Slack] Disconnected');
        this.connected = false;
        this.ws = null;
        // S21: Stop heartbeat on disconnect
        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[Slack] WebSocket error:', err);
      });
    } catch (err) {
      console.error('[Slack] Connection error:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.authFailed) {
      console.warn('[Slack] Not reconnecting — auth failed. Update token in Settings to reconnect.');
      return;
    }
    if (this.reconnectAttempts >= 3) {
      console.error(`[Slack] Max reconnect attempts (3) reached — giving up. Check your Slack tokens in Settings.`);
      this.connected = false;
      this.ctoAvailable = false;
      return;
    }
    if (this.reconnectTimer) return;
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 5 * 60 * 1000);
    this.reconnectAttempts++;
    console.log(`[Slack] Reconnecting in ${delayMs / 1000}s (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }

  private handleAuthError(error: string): void {
    console.error(`[Slack] Auth error (${error}) — stopping retries. Token may need refresh.`);
    this.authFailed = true;
    this.connected = false;
    this.ctoAvailable = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async handleSocketEvent(event: SlackEvent): Promise<void> {
    if (event.envelope_id && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ envelope_id: event.envelope_id }));
    }

    if (event.type === 'events_api' && event.payload?.event) {
      const slackEvent = event.payload.event;
      if (slackEvent.bot_id) return;

      switch (slackEvent.type) {
        case 'app_mention':
          await this.handleMention(slackEvent);
          break;
        case 'message':
          if (slackEvent.channel_type === 'im' || slackEvent.channel_type === 'mpim') {
            await this.handleDirectMessage(slackEvent);
          }
          if (slackEvent.thread_ts && slackEvent.channel_type === 'channel') {
            await this.handleChannelThreadReply(slackEvent);
          }
          break;
      }
    }

    if (event.type === 'interactive' && event.payload?.actions) {
      await this.handleBlockActions(event.payload);
    }

    if (event.type === 'hello') {
      console.log('[Slack] Received hello — connection established');
    }
  }

  private async handleMention(event: {
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  }): Promise<void> {
    if (!event.text || !event.channel || !event.ts) return;

    const userName = await this.getUserName(event.user || '');
    const cleanText = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!cleanText) {
      await this.postMessage(event.channel, 'How can I help?', event.thread_ts || event.ts);
      return;
    }

    console.log(`[Slack] Mention from ${userName} in ${event.channel}: ${cleanText.slice(0, 100)}`);

    const threadTs = event.thread_ts || event.ts;

    const queueId = await this.queueMessage({
      slackUserId: event.user || '',
      slackChannelId: event.channel,
      messageText: cleanText,
      messageType: 'mention',
      threadTs,
      userName,
    });

    if (!this.ctoAvailable) {
      await this.postMessage(event.channel, this.getOfflineMessage(), threadTs);
      return;
    }

    // Send instant acknowledgment
    await this.postMessage(event.channel, "Gotcha! Give me a second to think...", threadTs);

    // Fetch thread conversation context if replying in a thread
    let conversationContext = '';
    if (event.thread_ts) {
      conversationContext = await this.getThreadHistory(event.channel, event.thread_ts, event.ts);
    }

    try {
      const messageForCTO = conversationContext
        ? `${conversationContext}\n[Slack channel mention from ${userName}] ${cleanText}`
        : `[Slack channel mention from ${userName}] ${cleanText}`;
      const { text: response, tasks } = await this.getCTOResponseWithTasks(messageForCTO);

      await this.postMessage(event.channel, response, threadTs);

      for (const task of tasks) {
        await this.postTaskNotification(task, event.channel, threadTs);
      }

      await this.markQueueProcessed(queueId, response);
    } catch (err) {
      console.error('[Slack] Mention response failed:', err);
      this.ctoAvailable = false;
      await this.postMessage(event.channel, this.getOfflineMessage(), threadTs);
    }
  }

  private async handleDirectMessage(event: {
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    channel_type?: string;
  }): Promise<void> {
    if (!event.text || !event.channel) return;

    const pendingRequestId = clarificationTracker.isPendingResponse(event.channel);
    if (pendingRequestId) {
      await this.handleClarificationResponse(pendingRequestId, event.text, event.user || '', event.channel);
      return;
    }

    const userName = await this.getUserName(event.user || '');
    const isGroup = event.channel_type === 'mpim';

    console.log(`[Slack] ${isGroup ? 'Group' : 'DM'} from ${userName}: ${event.text.slice(0, 100)}`);

    const queueId = await this.queueMessage({
      slackUserId: event.user || '',
      slackChannelId: event.channel,
      messageText: event.text,
      messageType: isGroup ? 'group' : 'dm',
      userName: userName,
    });

    if (!this.ctoAvailable) {
      await this.postMessage(event.channel, this.getOfflineMessage());
      return;
    }

    // Send instant acknowledgment
    await this.postMessage(event.channel, "Gotcha! Give me a second to think...");

    const prefix = isGroup
      ? `[Slack group chat from ${userName}]`
      : `[Slack DM from ${userName}]`;

    try {
      const { text: response, tasks } = await this.getCTOResponseWithTasks(`${prefix} ${event.text}`);
      await this.postMessage(event.channel, response);

      for (const task of tasks) {
        await this.postTaskNotification(task, event.channel);
      }

      await this.markQueueProcessed(queueId, response);
    } catch (err) {
      console.error('[Slack] DM response failed:', err);
      this.ctoAvailable = false;
      await this.postMessage(event.channel, this.getOfflineMessage());
    }
  }

  private async handleChannelThreadReply(event: {
    text?: string;
    user?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
  }): Promise<void> {
    if (!event.thread_ts || !event.channel || !event.text) return;

    const pollId = strategyPollTracker.isPendingPoll(event.channel, event.thread_ts);
    if (!pollId) return;

    await this.handleStrategyPollResponse(pollId, event.text, event.user || '', event.channel, event.thread_ts);
  }

  /**
   * Fetch thread history from Slack to provide conversation context.
   * Excludes the current message (currentTs) since it's already being processed.
   */
  private async getThreadHistory(channel: string, threadTs: string, currentTs?: string): Promise<string> {
    const config = getConfig();
    if (!config.slackBotToken) return '';

    try {
      const res = await fetch(
        `https://slack.com/api/conversations.replies?channel=${channel}&ts=${threadTs}&limit=50`,
        { headers: { 'Authorization': `Bearer ${this.botToken}` }, signal: AbortSignal.timeout(10000) }
      );
      const data = await res.json() as {
        ok: boolean;
        error?: string;
        messages?: Array<{ user?: string; bot_id?: string; text?: string; ts?: string }>;
      };
      if (!data.ok) {
        if (AUTH_ERRORS.includes(data.error ?? '')) {
          this.handleAuthError(data.error!);
        }
        return '';
      }
      if (!data.messages || data.messages.length <= 1) return '';

      const lines: string[] = [];
      for (const msg of data.messages) {
        // Skip the current message being processed
        if (currentTs && msg.ts === currentTs) continue;

        const text = (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
        if (!text) continue;

        if (msg.bot_id) {
          lines.push(`Eric AI: ${text}`);
        } else {
          const name = await this.getUserName(msg.user || '');
          lines.push(`${name}: ${text}`);
        }
      }

      if (lines.length === 0) return '';
      return `[Thread conversation so far:\n${lines.join('\n')}\n]`;
    } catch (err) {
      console.error('[Slack] Failed to fetch thread history:', err);
      return '';
    }
  }

  private async handleBlockActions(payload: {
    user?: { id: string; username: string; name: string };
    actions?: Array<{ action_id: string; value: string }>;
    channel?: { id: string };
    message?: { ts: string };
    container?: { message_ts: string; channel_id: string };
  }): Promise<void> {
    if (!payload.actions?.length) return;

    const action = payload.actions[0];
    const userName = payload.user?.name || payload.user?.username || 'Unknown';
    const channelId = payload.container?.channel_id || payload.channel?.id;
    const messageTs = payload.container?.message_ts || payload.message?.ts;

    if (!channelId || !messageTs) return;

    const taskId = action.value;
    const task = taskQueue.getTask(taskId);
    if (!task) {
      console.warn(`[Slack] Block action for unknown task: ${taskId}`);
      return;
    }

    if (task.status !== 'suggested') {
      console.log(`[Slack] Task ${taskId} already ${task.status}, ignoring action`);
      return;
    }

    if (action.action_id === 'approve_task') {
      await taskQueue.updateTask(taskId, { status: 'approved', actioned_by: userName });
      const updated = taskQueue.getTask(taskId)!;
      await this.updateMessage(
        channelId, messageTs,
        `*${updated.title}* — Approved by ${userName}`,
        this.buildTaskResolvedBlocks(updated, 'Approved', userName)
      );
      console.log(`[Slack] Task "${updated.title}" approved by ${userName}`);
      eventBus.emitDashboard({
        type: 'task:updated',
        data: { id: taskId, title: updated.title, status: 'approved', priority: updated.priority },
      });
    } else if (action.action_id === 'reject_task') {
      await taskQueue.updateTask(taskId, { status: 'cancelled', actioned_by: userName });
      const updated = taskQueue.getTask(taskId)!;
      await this.updateMessage(
        channelId, messageTs,
        `*${updated.title}* — Rejected by ${userName}`,
        this.buildTaskResolvedBlocks(updated, 'Rejected', userName)
      );
      console.log(`[Slack] Task "${updated.title}" rejected by ${userName}`);
      eventBus.emitDashboard({
        type: 'task:updated',
        data: { id: taskId, title: updated.title, status: 'cancelled', priority: updated.priority },
      });
    }
  }

  private async handleClarificationResponse(requestId: string, text: string, userId: string, channelId: string): Promise<void> {
    const request = await clarificationTracker.getRequest(requestId);
    if (!request) return;

    const userName = await this.getUserName(userId);
    console.log(`[Slack] Clarification response from ${userName} for "${request.ticket_title}"`);

    await clarificationTracker.recordAnswer(requestId, text);

    if (notionClient.isConfigured) {
      try {
        const answersBlock = `\n---\n**Clarification from ${userName}** (via Slack):\n${text}`;
        await notionClient.appendToPage(request.notion_page_id, answersBlock);
        console.log(`[Slack] Appended clarification to Notion page ${request.notion_page_id}`);
      } catch (err) {
        console.error('[Slack] Failed to append to Notion:', (err as Error).message);
      }
    }

    await this.postMessage(channelId, `Got it — your answers have been recorded and added to the ticket. Thanks!`);

    eventBus.emitDashboard({
      type: 'clarification:answered',
      data: { id: requestId, ticketTitle: request.ticket_title, answeredBy: userName, answers: text },
    });
  }

  private async handleStrategyPollResponse(pollId: string, text: string, userId: string, channelId: string, threadTs: string): Promise<void> {
    const poll = await strategyPollTracker.getPoll(pollId);
    if (!poll) return;

    const userName = await this.getUserName(userId);
    console.log(`[Slack] Strategy poll response from ${userName} for "${poll.ticket_title}": ${text.slice(0, 100)}`);

    const chosenOption = this.matchPollOption(text, poll.options);

    await strategyPollTracker.recordDecision(pollId, chosenOption || text, `Decision by ${userName}`);

    await this.postMessage(channelId, `Decision recorded: *${chosenOption || text}*. I'll proceed with this approach.`, threadTs);

    eventBus.emitDashboard({
      type: 'strategy:decided',
      data: { id: pollId, ticketTitle: poll.ticket_title, chosenOption: chosenOption || text, decidedBy: userName },
    });
  }

  private matchPollOption(text: string, options: Array<{ label: string; description: string }>): string | null {
    const lower = text.toLowerCase().trim();
    for (const opt of options) {
      if (lower === opt.label.toLowerCase() || lower.includes(opt.label.toLowerCase())) {
        return opt.label;
      }
    }
    const letterMatch = lower.match(/^(?:option\s+)?([a-d1-4])$/);
    if (letterMatch) {
      const index = letterMatch[1].charCodeAt(0) - (letterMatch[1] >= 'a' ? 'a'.charCodeAt(0) : '1'.charCodeAt(0));
      if (index >= 0 && index < options.length) {
        return options[index].label;
      }
    }
    return null;
  }

  private async getCTOResponseWithTasks(message: string): Promise<{ text: string; tasks: Task[] }> {
    try {
      const response = await this.callCTODirect(message);
      const tasks = await this.extractAndCreateTasks(response);
      let cleanResponse = response;

      cleanResponse = cleanResponse.replace(/<task_assignment>[\s\S]*?<\/task_assignment>/g, '');
      cleanResponse = cleanResponse.replace(/<clarification_request>[\s\S]*?<\/clarification_request>/g, '');
      cleanResponse = cleanResponse.replace(/<strategy_poll>[\s\S]*?<\/strategy_poll>/g, '');
      cleanResponse = cleanResponse.trim();

      if (tasks.length > 0) {
        cleanResponse += `\n\n_${tasks.length} task${tasks.length > 1 ? 's' : ''} created — approve or reject above._`;
      }

      if (cleanResponse.length > 3800) {
        cleanResponse = cleanResponse.slice(0, 3800) + '\n\n_...response truncated. See full response on the dashboard._';
      }

      return { text: cleanResponse, tasks };
    } catch (err) {
      return { text: `Error: ${(err as Error).message}`, tasks: [] };
    }
  }

  private async callCTODirect(message: string): Promise<string> {
    const config = getConfig();

    const tasks = taskQueue.getAllTasks();
    const activeTasks = tasks
      .filter(t => !['done', 'cancelled'].includes(t.status))
      .map(t => `- [${t.status}] ${t.title} (${t.priority})`)
      .join('\n');

    const systemPrompt = buildCTOSystemPrompt({
      repoPath: config.colbyRepoPath,
      ctoDashboardPath: config.ctoDashboardRepoPath,
      repos: config.repos,
      activeTasks: activeTasks || undefined,
      dailyTokens: taskQueue.getDailyTokens(),
      currentModel: config.ctoModel,
      slackConnected: true,
    });

    const claudePath = config.claudeCliPath || 'claude';
    const args = [
      '--print',
      '--output-format', 'text',
      '--model', config.ctoModel || 'opus',
      '--max-turns', '300',
      '--system-prompt', systemPrompt,
      message,
    ];

    const cwd = config.colbyRepoPath && existsSync(config.colbyRepoPath)
      ? config.colbyRepoPath
      : process.cwd();

    // Explicitly inject GH_TOKEN so Slack CTO's tool subprocesses can use gh/git
    const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();

    return new Promise<string>((resolve, reject) => {
      const child = spawn(claudePath, args, {
        cwd,
        env: buildClaudeEnv({
          ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve(stdout || "I'm taking longer than expected. Check the dashboard.");
      }, 180000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !stdout) {
          reject(new Error(stderr || `Claude CLI exited with code ${code}`));
          return;
        }
        resolve(stdout);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private async extractAndCreateTasks(text: string): Promise<Task[]> {
    const tasks: Task[] = [];
    const regex = /<task_assignment>\s*(\{[\s\S]*?\})\s*<\/task_assignment>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const assignment = JSON.parse(match[1]);
        const task = await taskQueue.createTask({
          title: assignment.title,
          description: assignment.description,
          branch: assignment.branch,
          repo: assignment.repo,
          model: assignment.model,
          priority: assignment.priority,
        });
        tasks.push(task);
      } catch (err) {
        console.error('[Slack] Failed to parse task assignment:', err);
      }
    }

    return tasks;
  }

  // ---- Message Queue (Offline Resilience) ----

  private async queueMessage(params: {
    slackUserId: string;
    slackChannelId: string;
    messageText: string;
    messageType: string;
    threadTs?: string;
    userName?: string;
  }): Promise<string> {
    try {
      const docRef = await collections.slackMessageQueue.add({
        slack_user_id: params.slackUserId,
        slack_channel_id: params.slackChannelId,
        message_text: params.messageText,
        message_type: params.messageType,
        thread_ts: params.threadTs || null,
        user_name: params.userName || null,
        status: 'pending',
        response: null,
        created_at: new Date().toISOString(),
        processed_at: null,
      });
      return docRef.id;
    } catch (err) {
      console.error('[Slack] Failed to queue message:', err);
      return '';
    }
  }

  private async markQueueProcessed(queueId: string, response: string): Promise<void> {
    if (!queueId) return;
    try {
      await collections.slackMessageQueue.doc(queueId).update({
        status: 'processed',
        response: response.slice(0, 4000),
        processed_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Slack] Failed to mark queue processed:', err);
    }
  }

  private async drainMessageQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    try {
      const snap = await collections.slackMessageQueue
        .where('status', '==', 'pending')
        .orderBy('created_at', 'asc')
        .get();

      if (snap.empty) {
        this.processingQueue = false;
        return;
      }

      console.log(`[Slack] Draining message queue: ${snap.size} pending messages`);

      for (const doc of snap.docs) {
        const msg = doc.data();
        try {
          const prefix = msg.message_type === 'mention'
            ? `[Slack channel mention from ${msg.user_name || 'Unknown'}]`
            : msg.message_type === 'group'
              ? `[Slack group chat from ${msg.user_name || 'Unknown'}]`
              : `[Slack DM from ${msg.user_name || 'Unknown'}]`;

          const { text: response, tasks } = await this.getCTOResponseWithTasks(`${prefix} ${msg.message_text}`);

          const delayedResponse = `_Sorry for the delay — I was offline when you sent this._\n\n${response}`;
          await this.postMessage(msg.slack_channel_id, delayedResponse, msg.thread_ts || undefined);

          for (const task of tasks) {
            await this.postTaskNotification(task, msg.slack_channel_id, msg.thread_ts || undefined);
          }

          await this.markQueueProcessed(doc.id, response);
          this.ctoAvailable = true;
        } catch (err) {
          console.error(`[Slack] Failed to process queued message ${doc.id}:`, err);
          await collections.slackMessageQueue.doc(doc.id).update({
            status: 'failed',
            processed_at: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.error('[Slack] Failed to drain message queue:', err);
    } finally {
      this.processingQueue = false;
    }
  }

  private getOfflineMessage(): string {
    const config = getConfig();
    const statusUrl = config.colbyRepoPath ? 'the CTO Dashboard' : 'the status page';
    return `:warning: It seems I'm offline right now! Your message has been queued and I'll respond as soon as I'm back.\n\nIn the meantime, check ${statusUrl} to see the status of the AI CTO.`;
  }

  // ---- Block Kit Messages ----

  private buildTaskBlocks(task: Task): unknown[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${task.title}*\n${task.description.slice(0, 200)}${task.description.length > 200 ? '...' : ''}`,
        },
        fields: [
          { type: 'mrkdwn', text: `*Priority:* ${task.priority}` },
          { type: 'mrkdwn', text: `*Model:* ${task.model}` },
          ...(task.branch ? [{ type: 'mrkdwn', text: `*Branch:* \`${task.branch}\`` }] : []),
          ...(task.repo ? [{ type: 'mrkdwn', text: `*Repo:* ${task.repo}` }] : []),
        ],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve', emoji: true },
            style: 'primary',
            action_id: 'approve_task',
            value: task.id,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject', emoji: true },
            style: 'danger',
            action_id: 'reject_task',
            value: task.id,
          },
        ],
      },
    ];
  }

  private buildTaskResolvedBlocks(task: Task, action: string, userName: string): unknown[] {
    const emoji = action === 'Approved' ? ':white_check_mark:' :
      action === 'Rejected' ? ':x:' :
      action === 'Completed' ? ':tada:' : ':warning:';

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${task.title}* — _${action} by ${userName}_`,
        },
        fields: [
          { type: 'mrkdwn', text: `*Priority:* ${task.priority}` },
          { type: 'mrkdwn', text: `*Status:* ${task.status}` },
        ],
      },
    ];
  }

  buildStrategyPollBlocks(ticketTitle: string, options: Array<{ label: string; description: string }>, context?: string): unknown[] {
    const optionLines = options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      return `*${letter}. ${opt.label}*\n${opt.description}`;
    }).join('\n\n');

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:bar_chart: *Strategy Decision Needed: ${ticketTitle}*${context ? `\n_${context}_` : ''}\n\n${optionLines}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_Reply in this thread with your choice (e.g. "A" or the option name)._',
        },
      },
    ];
  }

  async postTaskNotification(task: Task, channel?: string, threadTs?: string): Promise<void> {
    const config = getConfig();
    const targetChannel = channel || config.slackUpdateChannel;
    if (!targetChannel || !this.isConfigured) return;

    const result = await this.postBlockMessage(
      targetChannel,
      `New task: ${task.title} (${task.priority})`,
      this.buildTaskBlocks(task),
      threadTs
    );

    if (result.ok && result.ts) {
      await taskQueue.updateTask(task.id, {
        slack_message_ts: result.ts,
        slack_channel_id: targetChannel,
      });
    }
  }

  // ---- Slack API ----

  async postBlockMessage(channel: string, text: string, blocks: unknown[], threadTs?: string): Promise<SlackPostResult> {
    const config = getConfig();
    if (!config.slackBotToken) return { ok: false, error: 'No bot token' };

    try {
      const body: Record<string, unknown> = { channel, text, blocks };
      if (threadTs) body.thread_ts = threadTs;

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as SlackPostResult;
      if (!data.ok && AUTH_ERRORS.includes(data.error ?? '')) {
        this.handleAuthError(data.error!);
      }
      return data;
    } catch (err) {
      console.error('[Slack] postBlockMessage error:', err);
      return { ok: false, error: (err as Error).message };
    }
  }

  async updateMessage(channel: string, ts: string, text: string, blocks?: unknown[]): Promise<boolean> {
    const config = getConfig();
    if (!config.slackBotToken) return false;

    try {
      const body: Record<string, unknown> = { channel, ts, text };
      if (blocks) body.blocks = blocks;

      const res = await fetch('https://slack.com/api/chat.update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        if (AUTH_ERRORS.includes(data.error ?? '')) {
          this.handleAuthError(data.error!);
        } else {
          console.error('[Slack] updateMessage error:', data.error);
        }
        return false;
      }
      return true;
    } catch (err) {
      console.error('[Slack] updateMessage error:', err);
      return false;
    }
  }

  async postMessage(channel: string, text: string, threadTs?: string): Promise<boolean> {
    const config = getConfig();
    if (!config.slackBotToken) return false;

    try {
      const body: Record<string, string> = { channel, text };
      if (threadTs) body.thread_ts = threadTs;

      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        if (AUTH_ERRORS.includes(data.error ?? '')) {
          this.handleAuthError(data.error!);
        } else {
          console.error('[Slack] postMessage error:', data.error);
        }
        return false;
      }
      return true;
    } catch (err) {
      console.error('[Slack] postMessage error:', err);
      return false;
    }
  }

  async lookupUserByEmail(email: string): Promise<SlackUser | null> {
    const config = getConfig();
    if (!config.slackBotToken) return null;

    try {
      const res = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
        headers: { 'Authorization': `Bearer ${this.botToken}` },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as { ok: boolean; user?: SlackUser; error?: string };
      if (!data.ok && AUTH_ERRORS.includes(data.error ?? '')) {
        this.handleAuthError(data.error!);
        return null;
      }
      if (data.ok && data.user) {
        this.userCache.set(data.user.id, data.user);
        return data.user;
      }
    } catch {
      // Fall through to null
    }
    return null;
  }

  async lookupUserByName(name: string): Promise<SlackUser | null> {
    if (!this.userListCache) {
      await this.loadUserList();
    }
    if (!this.userListCache) return null;

    const lower = name.toLowerCase();
    return this.userListCache.find(u =>
      u.real_name?.toLowerCase().includes(lower) ||
      u.name?.toLowerCase().includes(lower)
    ) || null;
  }

  private async loadUserList(): Promise<void> {
    const config = getConfig();
    if (!config.slackBotToken) return;

    try {
      const res = await fetch('https://slack.com/api/users.list?limit=200', {
        headers: { 'Authorization': `Bearer ${this.botToken}` },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as { ok: boolean; members?: SlackUser[]; error?: string };
      if (!data.ok && AUTH_ERRORS.includes(data.error ?? '')) {
        this.handleAuthError(data.error!);
        return;
      }
      if (data.ok && data.members) {
        this.userListCache = data.members;
        for (const u of data.members) {
          this.userCache.set(u.id, u);
        }
      }
    } catch {
      // ignore
    }
  }

  async openDMChannel(userId: string): Promise<string | null> {
    const config = getConfig();
    if (!config.slackBotToken) return null;

    try {
      const res = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ users: userId }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as { ok: boolean; channel?: { id: string }; error?: string };
      if (!data.ok && AUTH_ERRORS.includes(data.error ?? '')) {
        this.handleAuthError(data.error!);
        return null;
      }
      if (data.ok && data.channel) return data.channel.id;
    } catch {
      // ignore
    }
    return null;
  }

  async sendDM(userId: string, text: string, blocks?: unknown[]): Promise<{ channelId: string; ts: string } | null> {
    const channelId = await this.openDMChannel(userId);
    if (!channelId) return null;

    if (blocks) {
      const result = await this.postBlockMessage(channelId, text, blocks);
      if (result.ok && result.ts) return { channelId, ts: result.ts };
    } else {
      const config = getConfig();
      try {
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: channelId, text }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as SlackPostResult;
        if (!data.ok && AUTH_ERRORS.includes(data.error ?? '')) {
          this.handleAuthError(data.error!);
          return null;
        }
        if (data.ok && data.ts) return { channelId, ts: data.ts };
      } catch {
        // ignore
      }
    }
    return null;
  }

  private async getUserName(userId: string): Promise<string> {
    if (!userId) return 'Unknown';
    if (this.userCache.has(userId)) return this.userCache.get(userId)!.real_name || this.userCache.get(userId)!.name;

    const config = getConfig();
    try {
      const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
        headers: { 'Authorization': `Bearer ${this.botToken}` },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json() as { ok: boolean; user?: SlackUser; error?: string };
      if (!data.ok && AUTH_ERRORS.includes(data.error ?? '')) {
        this.handleAuthError(data.error!);
        return userId;
      }
      if (data.ok && data.user) {
        this.userCache.set(userId, data.user);
        return data.user.real_name || data.user.name;
      }
    } catch {
      // Fall back to user ID
    }
    return userId;
  }

  private startPeriodicUpdates(): void {
    const config = getConfig();
    if (!config.slackUpdateChannel) {
      console.log('[Slack] No update channel configured — periodic updates disabled');
      return;
    }

    const TWO_HOURS = 2 * 60 * 60 * 1000;
    this.updateInterval = setInterval(() => {
      this.postStatusUpdate();
    }, TWO_HOURS);

    setTimeout(() => this.postStatusUpdate(), 30000);
  }

  async postStatusUpdate(): Promise<void> {
    const config = getConfig();
    if (!config.slackUpdateChannel || !this.isConfigured) return;

    try {
      const tasks = taskQueue.getAllTasks();
      const inProgress = tasks.filter(t => t.status === 'in_progress');
      const inReview = tasks.filter(t => t.status === 'in_review');
      const suggested = tasks.filter(t => t.status === 'suggested');
      const recentDone = tasks.filter(t =>
        t.status === 'done' &&
        (Date.now() - new Date(t.updated_at).getTime()) < 24 * 60 * 60 * 1000
      );
      const dailyTokens = taskQueue.getDailyTokens();

      if (inProgress.length === 0 && inReview.length === 0 && recentDone.length === 0 && suggested.length === 0) {
        return;
      }

      let update = '*CTO Status Update*\n\n';

      if (inProgress.length > 0) {
        update += `*In Progress (${inProgress.length}):*\n`;
        for (const t of inProgress.slice(0, 5)) {
          update += `  • ${t.title} (${t.priority})\n`;
        }
        update += '\n';
      }

      if (inReview.length > 0) {
        update += `*Ready for Review (${inReview.length}):*\n`;
        for (const t of inReview.slice(0, 5)) {
          update += `  • ${t.title}${t.pr_url ? ` — <${t.pr_url}|View PR>` : ''}\n`;
        }
        update += '\n';
      }

      if (recentDone.length > 0) {
        update += `*Completed Today (${recentDone.length}):*\n`;
        for (const t of recentDone.slice(0, 5)) {
          update += `  • ${t.title}\n`;
        }
        update += '\n';
      }

      if (suggested.length > 0) {
        update += `*Awaiting Approval (${suggested.length}):*\n`;
        for (const t of suggested.slice(0, 3)) {
          update += `  • ${t.title} (${t.priority})\n`;
        }
        update += '\n';
      }

      update += `_Tokens used today: ${dailyTokens.toLocaleString()}_`;

      await this.postMessage(config.slackUpdateChannel, update);
    } catch (err) {
      console.error('[Slack] Failed to post status update:', err);
    }
  }

  async postToUpdatesChannel(message: string): Promise<boolean> {
    const config = getConfig();
    if (!config.slackUpdateChannel) return false;
    return this.postMessage(config.slackUpdateChannel, message);
  }
}

export const slackBot = new SlackBot();
