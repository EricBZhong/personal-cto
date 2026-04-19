import { WebSocket } from 'ws';
import { ctoSession } from './cto-session';
import { taskQueue } from './task-queue';
import { engineerPool } from './engineer-pool';
import { eventBus } from './event-bus';
import { getConfig, updateConfig, isCloudRun, DashboardConfig, getConfigRevisions, rollbackConfig } from './config';
import { notionClient } from './integrations/notion';
import { githubClient } from './integrations/github';
import { gcpClient } from './integrations/gcp';
import { vantaClient } from './integrations/vanta';
import { runDogfoodTest, formatDogfoodReport, dogfoodWithCTOAnalysis, enrichScreenshots, DogfoodTestType, evalStore, runEvals, generateCTOEvals, importEvalsViaCTO, type DogfoodProgressCallback } from './dogfood';
import { slackBot } from './integrations/slack';
import { errorCollector } from './error-collector';
import { clarificationTracker, strategyPollTracker } from './clarification-tracker';
import { collections } from './firestore';
import { dailyCheckin } from './daily-checkin';
import { projectManager } from './project-manager';
import { memoryStore } from './memory-store';
import { deployManager } from './deploy-manager';
import { SlidingWindowRateLimiter, validateWsMessage } from './utils/reliability';
import type { PullRequest, PRReview, Project, AutonomySettings } from '../types';

// SEC2: Module-level rate limiters
const generalLimiter = new SlidingWindowRateLimiter(60, 60_000); // 60 requests/min
const chatLimiter = new SlidingWindowRateLimiter(10, 60_000);    // 10 chat sends/min

// SEC2: WeakMap to assign stable IDs to WebSocket connections for rate limiting
const wsIdMap = new WeakMap<WebSocket, string>();
let wsIdCounter = 0;
function getWsId(ws: WebSocket): string {
  let id = wsIdMap.get(ws);
  if (!id) {
    id = `ws-${++wsIdCounter}`;
    wsIdMap.set(ws, id);
  }
  return id;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

/** Mask secret fields before sending config to the frontend */
function maskSecrets(config: DashboardConfig): Record<string, unknown> {
  const secretFields = ['notionApiKey', 'vantaApiKey', 'vantaClientSecret', 'githubToken', 'slackBotToken', 'slackAppToken', 'slackSigningSecret', 'twilioAccountSid', 'twilioAuthToken', 'sfPassword', 'sfSecurityToken', 'claudeOauthToken'] as const;
  const safe: Record<string, unknown> = { ...(config as unknown as Record<string, unknown>) };
  for (const field of secretFields) {
    safe[field] = safe[field] ? '***' : '';
  }
  // Ensure optional string fields are never undefined (JSON.stringify drops undefined)
  for (const [key, value] of Object.entries(safe)) {
    if (value === undefined) safe[key] = '';
  }
  return safe;
}

export class Orchestrator {
  private activityLog: Array<{ timestamp: string; type: string; message: string }> = [];
  private pendingTaskNotifications: Array<{ taskId: string; title: string; oldStatus: string; newStatus: string; actionedBy?: string; reason?: string; timestamp: string }> = [];
  /** URLs of externally-added PRs (from pr:add) — re-fetched on each pr:list */
  private externalPRUrls: Set<string> = new Set();
  /** Per-connection active thread ID — isolates multi-user sessions */
  private connectionThreads: Map<WebSocket, string> = new Map();

  async init(wss: import('ws').WebSocketServer): Promise<void> {
    // Hydrate data from Firestore before accepting connections
    try {
      await taskQueue.hydrate();
      console.log('[Orchestrator] Task queue hydrated');
    } catch (err) {
      console.error('[Orchestrator] Failed to hydrate task queue:', err);
    }
    try {
      await projectManager.hydrate();
      await memoryStore.hydrate();
    } catch (err) {
      console.error('[Orchestrator] Failed to hydrate projects/memory:', err);
    }

    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', async (raw: Buffer) => {
        try {
          // SEC4: Validate message type + payload before dispatch
          const validated = validateWsMessage(raw.toString());
          if (!validated.valid) {
            console.warn(`[Orchestrator] Invalid WS message: ${validated.error}`);
            this.send(ws, { type: 'error', payload: { error: validated.error || 'Invalid message' } });
            return;
          }
          const msg: WsMessage = { type: validated.type!, payload: validated.payload };
          await this.handleMessage(ws, msg);
        } catch (err) {
          console.error('[Orchestrator] Message handler error:', (err as Error).message);
          // Send error back so client isn't left waiting
          try {
            this.send(ws, { type: 'error', payload: { error: (err as Error).message } });
          } catch { /* ws might be closed */ }
        }
      });

      ws.on('close', () => {
        this.connectionThreads.delete(ws);
      });
    });

    engineerPool.startPolling();
  }

  private async handleMessage(ws: WebSocket, msg: WsMessage): Promise<void> {
    console.log(`[Orchestrator] Received: ${msg.type}`, msg.payload ? JSON.stringify(msg.payload).slice(0, 200) : '');

    // SEC2: Rate limiting
    const wsId = getWsId(ws);
    if (!generalLimiter.allow(wsId)) {
      this.send(ws, { type: 'error', payload: { error: 'Rate limited: too many requests (60/min). Please slow down.' } });
      return;
    }
    if (msg.type === 'chat:send' && !chatLimiter.allow(wsId)) {
      this.send(ws, { type: 'error', payload: { error: 'Rate limited: too many chat messages (10/min). Please slow down.' } });
      return;
    }

    switch (msg.type) {
      // Chat
      case 'chat:send':
        await this.handleChatSend(ws, msg.payload?.message as string, msg.payload?.model as string | undefined);
        break;
      case 'chat:abort':
        ctoSession.abort();
        break;
      case 'chat:history':
        await this.sendHistory(ws);
        break;
      case 'chat:clear':
        await this.clearHistory(ws);
        break;

      // Threads
      case 'thread:list':
        await this.sendThreads(ws);
        break;
      case 'thread:create':
        await this.createThread(ws);
        break;
      case 'thread:switch':
        await this.switchThread(ws, msg.payload?.threadId as string);
        break;
      case 'thread:delete':
        await this.deleteThread(ws, msg.payload?.threadId as string);
        break;

      // Tasks
      case 'task:approve':
        await this.approveTask(msg.payload?.taskId as string, msg.payload as Record<string, unknown>);
        break;
      case 'task:approve_by_title':
        await this.approveTaskByTitle(msg.payload?.title as string, msg.payload as Record<string, unknown>);
        break;
      case 'task:reject':
        await this.rejectTask(msg.payload?.taskId as string, msg.payload?.actionedBy as string | undefined, msg.payload?.reason as string | undefined);
        break;
      case 'task:reject_by_title':
        await this.rejectTaskByTitle(msg.payload?.title as string, msg.payload?.actionedBy as string | undefined, msg.payload?.reason as string | undefined);
        break;
      case 'task:cancel':
        await this.cancelTask(msg.payload?.taskId as string);
        break;
      case 'task:list':
        this.sendTasks(ws);
        break;
      case 'task:get':
        await this.sendTaskDetail(ws, msg.payload?.taskId as string);
        break;
      case 'task:logs':
        await this.sendTaskLogs(ws, msg.payload?.taskId as string);
        break;
      case 'task:update_priority':
        await this.updateTaskPriority(msg.payload?.taskId as string, msg.payload?.priority as string);
        break;
      case 'task:retry':
        await this.retryTask(msg.payload?.taskId as string);
        break;
      case 'task:interact':
        await this.interactWithTask(msg.payload?.taskId as string, msg.payload?.instruction as string);
        break;
      case 'task:approve_all':
        await this.approveAllSuggested();
        break;
      case 'task:set_status':
        await this.setTaskStatus(
          msg.payload?.taskId as string,
          msg.payload?.status as string,
          msg.payload?.actionedBy as string | undefined,
          msg.payload?.reason as string | undefined,
        );
        break;

      // Engineers
      case 'engineer:list':
        this.sendEngineers(ws);
        break;
      case 'engineer:kill':
        engineerPool.kill(msg.payload?.engineerId as string);
        break;
      case 'engineer:kill_all':
        engineerPool.killAll();
        break;

      // Config
      case 'config:get':
        this.sendConfig(ws);
        break;
      case 'config:update':
        this.handleConfigUpdate(ws, msg.payload as Partial<DashboardConfig>);
        break;
      case 'config:revisions':
        await this.sendConfigRevisions(ws);
        break;
      case 'config:rollback':
        await this.handleConfigRollback(ws, msg.payload?.revisionId as string);
        break;

      // Status & integrations
      case 'status:get':
        this.sendStatus(ws);
        break;
      case 'health:ping':
        await this.sendHealthPings(ws);
        break;

      // Integrations
      case 'notion:tickets':
        await this.sendNotionTickets(ws);
        break;
      case 'github:prs':
        this.sendGitHubPRs(ws);
        break;
      case 'github:pr_diff':
        this.sendPRDiff(ws, msg.payload?.prNumber as number);
        break;
      case 'gcp:health':
        await this.sendGCPHealth(ws);
        break;
      case 'gcp:logs':
        this.sendGCPLogs(ws, msg.payload?.service as string, msg.payload?.project as string);
        break;

      // Compliance
      case 'compliance:overview':
        await this.sendComplianceOverview(ws);
        break;
      case 'compliance:failing':
        await this.sendFailingControls(ws);
        break;

      // Analytics
      case 'analytics:cost':
      case 'analytics:usage':
        await this.sendUsageAnalytics(ws);
        break;
      case 'analytics:activity':
        this.sendActivityLog(ws);
        break;

      // Errors
      case 'error:report':
        await this.handleErrorReport(msg.payload as Record<string, unknown>);
        break;
      case 'error:list':
        await this.sendErrors(ws);
        break;
      case 'error:resolve':
        await this.resolveError(msg.payload?.errorId as string);
        break;

      // Codebase analysis
      case 'analysis:run':
        await this.runCodebaseAnalysis(msg.payload?.focus as string);
        break;

      // Dogfood testing
      case 'dogfood:run':
        await this.runDogfoodTest(ws, msg.payload?.testType as string, msg.payload as Record<string, unknown>);
        break;
      case 'dogfood:run_with_analysis':
        await this.runDogfoodWithAnalysis(ws, msg.payload?.testType as string, msg.payload as Record<string, unknown>);
        break;

      // Evals
      case 'eval:list':
        await this.sendEvals(ws);
        break;
      case 'eval:create':
        await this.createEval(ws, msg.payload as Record<string, unknown>);
        break;
      case 'eval:delete':
        await this.deleteEval(ws, msg.payload?.evalId as string);
        break;
      case 'eval:run':
        await this.runEvalSuite(ws, msg.payload?.evalIds as string[] | undefined, msg.payload?.durationMinutes as number | undefined);
        break;
      case 'eval:generate':
        await this.generateEvals(ws);
        break;
      case 'eval:history':
        await this.sendEvalHistory(ws, msg.payload?.evalId as string | undefined);
        break;
      case 'eval:seed':
        await this.seedEvalDefaults(ws);
        break;
      case 'eval:import':
        await this.importEvals(ws, msg.payload?.content as string);
        break;

      // Slack
      case 'slack:status':
        this.sendSlackStatus(ws);
        break;
      case 'slack:get_conversations':
        await this.sendSlackConversations(ws);
        break;
      case 'slack:get_queue':
        await this.sendSlackQueue(ws);
        break;
      case 'slack:reconnect':
        await this.reconnectSlack(ws);
        break;
      case 'slack:post_update':
        await this.postSlackUpdate(ws);
        break;
      case 'slack:send_message':
        await this.sendSlackMessage(ws, msg.payload?.channel as string, msg.payload?.message as string);
        break;

      // PR Reviews
      case 'pr:list':
        this.sendPRList(ws);
        break;
      case 'pr:add':
        this.addPRByUrl(ws, msg.payload?.url as string);
        break;
      case 'pr:detail':
        this.sendPRDetail(ws, msg.payload?.prNumber as number, msg.payload?.repoSlug as string | undefined);
        break;
      case 'pr:review':
        await this.reviewPR(ws, msg.payload?.prNumber as number, msg.payload?.repoSlug as string | undefined);
        break;
      case 'pr:approve':
        this.approvePR(ws, msg.payload?.prNumber as number, msg.payload?.repoSlug as string | undefined);
        break;
      case 'pr:merge':
        this.mergePR(ws, msg.payload?.prNumber as number, msg.payload?.method as string | undefined, msg.payload?.repoSlug as string | undefined);
        break;
      case 'pr:comment':
        this.commentOnPR(ws, msg.payload?.prNumber as number, msg.payload?.body as string, msg.payload?.repoSlug as string | undefined);
        break;

      // Daily Check-in
      case 'checkin:trigger':
        await this.triggerCheckin(ws);
        break;
      case 'checkin:get_report':
        await this.getCheckinReport(ws, msg.payload?.reportId as string);
        break;
      case 'checkin:list_reports':
        await this.listCheckinReports(ws);
        break;

      // Projects
      case 'project:list':
        await this.sendProjects(ws);
        break;
      case 'project:get':
        await this.sendProjectDetail(ws, msg.payload?.projectId as string);
        break;
      case 'project:create':
        await this.createProject(ws, msg.payload as Record<string, unknown>);
        break;
      case 'project:update':
        await this.updateProjectFromWs(ws, msg.payload?.projectId as string, msg.payload as Record<string, unknown>);
        break;
      case 'project:advance':
        await this.advanceProject(ws, msg.payload?.projectId as string);
        break;
      case 'project:archive':
        await this.archiveProject(ws, msg.payload?.projectId as string);
        break;
      case 'project:pause':
        await this.pauseProject(ws, msg.payload?.projectId as string);
        break;
      case 'project:resume':
        await this.resumeProject(ws, msg.payload?.projectId as string);
        break;

      // Memory
      case 'memory:list':
        await this.sendMemories(ws, msg.payload?.projectId as string | undefined);
        break;
      case 'memory:add':
        await this.addMemory(ws, msg.payload as Record<string, unknown>);
        break;
      case 'memory:delete':
        await this.deleteMemory(ws, msg.payload?.id as string);
        break;
      case 'memory:search':
        this.searchMemories(ws, msg.payload?.query as string);
        break;

      // Deploy
      case 'deploy:trigger':
        await this.triggerDeploy(ws, msg.payload as Record<string, unknown>);
        break;
      case 'deploy:history':
        await this.sendDeployHistory(ws);
        break;

      default:
        console.warn('[Orchestrator] Unknown message type:', msg.type);
    }
  }

  // ---- Chat ----

  private async handleChatSend(ws: WebSocket, message: string, modelOverride?: string): Promise<void> {
    if (!message?.trim()) return;
    this.logActivity('chat', `User: ${message.slice(0, 100)}`, { trigger: 'user_action' });

    try {
      const threadId = this.getConnectionThread(ws);
      const fullText = await ctoSession.sendMessage(message.trim(), modelOverride, threadId);

      if (fullText) {
        await this.parseTaskAssignments(fullText);
        this.parseClarificationRequests(fullText);
        this.parseStrategyPolls(fullText);
        await this.parseProjectPlans(fullText);
        await this.parseMemoryEntries(fullText);
        await this.parseDeployTriggers(fullText);
        await this.parseRepoCreation(fullText);
      }
    } catch (err) {
      console.error('[Orchestrator] Chat error:', err);
      errorCollector.record({
        source: 'cto-session',
        level: 'error',
        message: (err as Error).message,
        stack: (err as Error).stack,
        context: JSON.stringify({ action: 'chat:send', model: modelOverride }),
      });
    }
  }

  private async parseTaskAssignments(text: string): Promise<void> {
    const regex = /<task_assignment>\s*(\{[\s\S]*?\})\s*<\/task_assignment>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const assignment = JSON.parse(match[1]);

        // Determine initial status — check for auto-approval
        let initialStatus: string | undefined;
        if (assignment.projectId) {
          const project = projectManager.getProject(assignment.projectId);
          if (project) {
            const autonomy = project.autonomy;
            if (autonomy.level === 'autonomous') {
              const priority = assignment.priority || 'P2';
              if (priority === 'P0' && autonomy.requireApprovalForP0 !== false) {
                // P0 always requires human approval unless explicitly overridden
              } else {
                initialStatus = 'approved';
              }
            } else if (autonomy.level === 'semi-autonomous') {
              const priority = assignment.priority || 'P2';
              if (priority === 'P2' || priority === 'P3') {
                initialStatus = 'approved';
              }
            }
            // Check autonomousUntil timeout
            if (autonomy.autonomousUntil) {
              const until = new Date(autonomy.autonomousUntil).getTime();
              if (Date.now() >= until) {
                // Autonomy expired — revert
                initialStatus = undefined;
              }
            }
          }
        }

        const task = await taskQueue.createTask({
          title: assignment.title,
          description: assignment.description,
          branch: assignment.branch,
          repo: assignment.repo,
          project: assignment.project,
          model: assignment.model,
          priority: assignment.priority,
          notion_page_id: assignment.notion_page_id,
          dependsOn: assignment.dependsOn,
          phaseId: assignment.phaseId,
          projectId: assignment.projectId,
          skillProfile: assignment.skillProfile,
          status: initialStatus,
        });
        this.logActivity('task', `CTO suggested: ${task.title}`, { trigger: 'user_action' });

        // If auto-approved, trigger queue processing
        if (initialStatus === 'approved') {
          engineerPool.processQueue();
        }
      } catch (err) {
        console.error('[Orchestrator] Failed to parse task assignment:', err);
      }
    }
  }

  private parseClarificationRequests(text: string): void {
    const regex = /<clarification_request>\s*(\{[\s\S]*?\})\s*<\/clarification_request>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        this.handleClarificationRequest(parsed);
      } catch (err) {
        console.error('[Orchestrator] Failed to parse clarification request:', err);
      }
    }
  }

  private parseStrategyPolls(text: string): void {
    const regex = /<strategy_poll>\s*(\{[\s\S]*?\})\s*<\/strategy_poll>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        this.handleStrategyPoll(parsed);
      } catch (err) {
        console.error('[Orchestrator] Failed to parse strategy poll:', err);
      }
    }
  }

  private async handleClarificationRequest(data: {
    notion_page_id: string;
    ticket_title: string;
    questions: string[];
    ask_user: string;
    context?: string;
  }): Promise<void> {
    if (!slackBot.isConnected) {
      console.warn('[Orchestrator] Cannot send clarification — Slack not connected');
      return;
    }

    // Create the tracker record
    const request = await clarificationTracker.createRequest({
      notionPageId: data.notion_page_id,
      ticketTitle: data.ticket_title,
      questions: data.questions,
      askUserName: data.ask_user,
      context: data.context,
    });

    // Resolve Notion user → Slack user
    let slackUser: { id: string } | null = null;

    // Try by email first (via Notion page creator)
    if (notionClient.isConfigured) {
      try {
        const creator = await notionClient.getPageCreator(data.notion_page_id);
        if (creator?.email) {
          slackUser = await slackBot.lookupUserByEmail(creator.email);
        }
      } catch {
        // Fall through to name lookup
      }
    }

    // Fallback: lookup by name
    if (!slackUser) {
      slackUser = await slackBot.lookupUserByName(data.ask_user);
    }

    if (!slackUser) {
      console.warn(`[Orchestrator] Could not find Slack user for "${data.ask_user}"`);
      await clarificationTracker.markFailed(request.id);
      return;
    }

    // Build the DM message
    const questionsText = data.questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    const message = `:question: *Clarification needed on: ${data.ticket_title}*${data.context ? `\n_${data.context}_` : ''}\n\n${questionsText}\n\n_Reply to this message with your answers and I'll update the ticket._`;

    const result = await slackBot.sendDM(slackUser.id, message);
    if (result) {
      await clarificationTracker.markSent(request.id, slackUser.id, result.channelId, result.ts);
      this.logActivity('clarification', `Sent clarification DM for "${data.ticket_title}" to ${data.ask_user}`);
      eventBus.emitDashboard({
        type: 'clarification:sent',
        data: { id: request.id, ticketTitle: data.ticket_title, askUser: data.ask_user },
      });
    } else {
      await clarificationTracker.markFailed(request.id);
      console.error(`[Orchestrator] Failed to send clarification DM to ${data.ask_user}`);
    }
  }

  private async handleStrategyPoll(data: {
    ticket_title: string;
    options: Array<{ label: string; description: string }>;
    ask_channel: string;
    context?: string;
  }): Promise<void> {
    if (!slackBot.isConnected) {
      console.warn('[Orchestrator] Cannot post strategy poll — Slack not connected');
      return;
    }

    const config = getConfig();
    const targetChannel = data.ask_channel === 'updates' ? config.slackUpdateChannel : data.ask_channel;
    if (!targetChannel) {
      console.warn('[Orchestrator] No channel configured for strategy poll');
      return;
    }

    const poll = await strategyPollTracker.createPoll({
      ticketTitle: data.ticket_title,
      options: data.options,
      askChannel: targetChannel,
      context: data.context,
    });

    const blocks = slackBot.buildStrategyPollBlocks(data.ticket_title, data.options, data.context);
    const result = await slackBot.postBlockMessage(
      targetChannel,
      `Strategy decision needed: ${data.ticket_title}`,
      blocks
    );

    if (result.ok && result.ts) {
      await strategyPollTracker.markPosted(poll.id, targetChannel, result.ts);
      this.logActivity('strategy', `Posted strategy poll for "${data.ticket_title}"`);
      eventBus.emitDashboard({
        type: 'strategy:posted',
        data: { id: poll.id, ticketTitle: data.ticket_title, channel: targetChannel },
      });
    } else {
      await strategyPollTracker.markFailed(poll.id);
      console.error(`[Orchestrator] Failed to post strategy poll: ${result.error}`);
    }
  }

  private async sendHistory(ws: WebSocket): Promise<void> {
    const threadId = this.getConnectionThread(ws);
    const history = await ctoSession.getConversationHistory(threadId);
    this.send(ws, { type: 'chat:history', payload: { messages: history } });
  }

  private async clearHistory(ws: WebSocket): Promise<void> {
    const threadId = this.getConnectionThread(ws);
    // Delete all messages in the thread subcollection
    const snap = await collections.chatThreads.doc(threadId).collection('messages').get();
    const batch = collections.chatThreads.firestore.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    this.send(ws, { type: 'chat:history', payload: { messages: [] } });
  }

  // ---- Threads ----

  /** Get the active thread for a specific WS connection */
  private getConnectionThread(ws: WebSocket): string {
    return this.connectionThreads.get(ws) || ctoSession.getActiveThread();
  }

  /** Set the active thread for a specific WS connection */
  private setConnectionThread(ws: WebSocket, threadId: string): void {
    this.connectionThreads.set(ws, threadId);
  }

  private async sendThreads(ws: WebSocket): Promise<void> {
    let threads = await ctoSession.getThreads();
    // Ensure at least one thread always exists
    if (threads.length === 0) {
      const newThread = await ctoSession.createThread();
      threads = [newThread];
    }
    // Use per-connection activeThreadId
    let activeId = this.getConnectionThread(ws);
    const activeExists = threads.some(t => t.id === activeId);
    if (!activeExists) {
      activeId = threads[0].id;
      this.setConnectionThread(ws, activeId);
    }
    this.send(ws, { type: 'thread:list', payload: { threads, activeThreadId: activeId } });
  }

  private async createThread(ws: WebSocket): Promise<void> {
    const thread = await ctoSession.createThread();
    this.setConnectionThread(ws, thread.id);
    this.send(ws, { type: 'thread:created', payload: { thread } });
    // Send empty history for the new thread
    this.send(ws, { type: 'chat:history', payload: { messages: [] } });
  }

  private async switchThread(ws: WebSocket, threadId: string): Promise<void> {
    if (!threadId) return;
    this.setConnectionThread(ws, threadId);
    const history = await ctoSession.getConversationHistory(threadId);
    this.send(ws, { type: 'thread:switched', payload: { threadId, messages: history } });
  }

  private async deleteThread(ws: WebSocket, threadId: string): Promise<void> {
    if (!threadId) return;
    await ctoSession.deleteThread(threadId);
    this.send(ws, { type: 'thread:deleted', payload: { threadId } });
    // If this connection was on the deleted thread, the server-side deleteThread
    // already switched to a valid thread — sync it
    this.setConnectionThread(ws, ctoSession.getActiveThread());
    // Send updated thread list
    await this.sendThreads(ws);
    // Send history for the now-active thread
    await this.sendHistory(ws);
  }

  // ---- Tasks ----

  private async approveTask(taskId: string, overrides?: Record<string, unknown>): Promise<void> {
    if (!taskId) return;
    const updates: Record<string, unknown> = { status: 'approved' };
    if (overrides?.priority) updates.priority = overrides.priority;
    if (overrides?.model) updates.model = overrides.model;
    if (overrides?.actionedBy) updates.actioned_by = overrides.actionedBy;
    if (overrides?.reason) updates.action_reason = overrides.reason;
    await taskQueue.updateTask(taskId, updates as Parameters<typeof taskQueue.updateTask>[1]);
    console.log(`[Orchestrator] approveTask: task ${taskId.slice(0, 8)} set to approved; triggering processQueue`);
    engineerPool.processQueue();
    const who = overrides?.actionedBy ? ` by ${overrides.actionedBy}` : '';
    this.logActivity('task', `Approved task ${taskId.slice(0, 8)}${who}`, { trigger: 'user_action', oldValue: 'suggested', newValue: 'approved' });
  }

  private async approveTaskByTitle(title: string, overrides?: Record<string, unknown>): Promise<void> {
    if (!title) return;
    const tasks = taskQueue.getTasksByStatus('suggested');
    const task = tasks.find(t => t.title === title);
    if (task) {
      await this.approveTask(task.id, overrides);
    }
  }

  private async rejectTask(taskId: string, actionedBy?: string, reason?: string): Promise<void> {
    if (!taskId) return;
    const updates: Record<string, unknown> = { status: 'cancelled' };
    if (actionedBy) updates.actioned_by = actionedBy;
    if (reason) updates.action_reason = reason;
    await taskQueue.updateTask(taskId, updates as Parameters<typeof taskQueue.updateTask>[1]);
    const who = actionedBy ? ` by ${actionedBy}` : '';
    this.logActivity('task', `Rejected task ${taskId.slice(0, 8)}${who}`, { trigger: 'user_action', newValue: 'cancelled' });
  }

  private async rejectTaskByTitle(title: string, actionedBy?: string, reason?: string): Promise<void> {
    if (!title) return;
    const tasks = taskQueue.getTasksByStatus('suggested');
    const task = tasks.find(t => t.title === title);
    if (task) {
      await this.rejectTask(task.id, actionedBy, reason);
    }
  }

  private async cancelTask(taskId: string): Promise<void> {
    if (!taskId) return;
    const task = taskQueue.getTask(taskId);
    if (task?.engineer_id) {
      engineerPool.kill(task.engineer_id);
    }
    await taskQueue.updateTask(taskId, { status: 'cancelled' });
    this.logActivity('task', `Cancelled task ${taskId.slice(0, 8)}`, { trigger: 'user_action', newValue: 'cancelled' });
  }

  private async retryTask(taskId: string): Promise<void> {
    if (!taskId) return;
    const task = taskQueue.getTask(taskId);
    if (task && (task.status === 'failed' || task.status === 'cancelled')) {
      // Build retry context from previous attempt
      try {
        const logs = await taskQueue.getLogsAsync(taskId);
        const contextParts: string[] = [];

        // Include error history
        if (task.errors && task.errors.length > 0) {
          contextParts.push(`Error history:\n${task.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`);
        } else if (task.error) {
          contextParts.push(`Error: ${task.error}`);
        }

        // Include verification warning history
        if (task.verification_warnings && task.verification_warnings.length > 0) {
          contextParts.push(`Verification warning history:\n${task.verification_warnings.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}`);
        } else if (task.verification_warning) {
          contextParts.push(`Verification warning: ${task.verification_warning}`);
        }

        // Include summary logs from previous attempt
        const summaryLogs = logs.filter(l => l.source === 'summary');
        if (summaryLogs.length > 0) {
          contextParts.push(`Previous attempt summary:\n${summaryLogs.map(l => l.content).join('\n')}`);
        }

        // Include system logs about verification failures or hallucinations
        const failureLogs = logs.filter(l =>
          l.source === 'system' &&
          (l.content.includes('Verification failed') || l.content.includes('hallucinated') || l.content.includes('never pushed'))
        );
        if (failureLogs.length > 0) {
          contextParts.push(`Failure details:\n${failureLogs.map(l => l.content).join('\n')}`);
        }

        // Include last 3000 chars of previous engineer output for context
        const engineerLogs = logs.filter(l => l.source === 'engineer');
        if (engineerLogs.length > 0) {
          const lastOutput = engineerLogs[0].content;
          const truncated = lastOutput.length > 3000 ? lastOutput.slice(-3000) : lastOutput;
          contextParts.push(`Previous engineer output (last 3000 chars):\n${truncated}`);
        }

        if (contextParts.length > 0) {
          taskQueue.setRetryContext(taskId, contextParts.join('\n\n'));
        }
      } catch (err) {
        console.warn(`[Orchestrator] Failed to build retry context for ${taskId}:`, err);
      }

      // Clear current error/warning display (history preserved in arrays)
      if (task.error) {
        taskQueue.addLog(taskId, `Previous error (cleared on retry): ${task.error}`, 'system');
        await taskQueue.clearCurrentError(taskId);
      }
      if (task.verification_warning) {
        taskQueue.addLog(taskId, `Previous verification warning (cleared on retry): ${task.verification_warning}`, 'system');
        await taskQueue.clearCurrentWarning(taskId);
      }

      await taskQueue.updateTask(taskId, { status: 'approved', engineer_id: undefined });
      taskQueue.addLog(taskId, 'Task retried by user', 'system');
      console.log(`[Orchestrator] retryTask: task ${taskId.slice(0, 8)} set to approved; triggering processQueue`);
      engineerPool.processQueue();
      this.logActivity('task', `Retried task ${taskId.slice(0, 8)}`, { trigger: 'user_action', oldValue: task.status, newValue: 'approved' });
    }
  }

  private async interactWithTask(taskId: string, instruction: string): Promise<void> {
    if (!taskId || !instruction?.trim()) return;
    const task = taskQueue.getTask(taskId);
    if (!task) return;

    const validStatuses = ['in_review', 'done', 'failed', 'cancelled'];
    if (!validStatuses.includes(task.status)) {
      console.warn(`[Orchestrator] interactWithTask: task ${taskId.slice(0, 8)} in status "${task.status}" — not interactable`);
      return;
    }

    // Build interaction context from previous attempt
    try {
      const logs = await taskQueue.getLogsAsync(taskId);
      const contextParts: string[] = [];

      contextParts.push(`Follow-up instruction from user:\n${instruction.trim()}`);

      // Include error history
      if (task.errors && task.errors.length > 0) {
        contextParts.push(`Error history:\n${task.errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`);
      } else if (task.error) {
        contextParts.push(`Previous error: ${task.error}`);
      }

      // Include verification warning history
      if (task.verification_warnings && task.verification_warnings.length > 0) {
        contextParts.push(`Verification warning history:\n${task.verification_warnings.map((w, i) => `  ${i + 1}. ${w}`).join('\n')}`);
      } else if (task.verification_warning) {
        contextParts.push(`Verification warning: ${task.verification_warning}`);
      }

      // Include summary logs from previous attempt
      const summaryLogs = logs.filter(l => l.source === 'summary');
      if (summaryLogs.length > 0) {
        contextParts.push(`Previous attempt summary:\n${summaryLogs.map(l => l.content).join('\n')}`);
      }

      // Include previous interaction logs
      const interactionLogs = logs.filter(l => l.source === 'interaction');
      if (interactionLogs.length > 0) {
        contextParts.push(`Previous follow-up instructions:\n${interactionLogs.map(l => l.content).join('\n')}`);
      }

      // Include failure details
      const failureLogs = logs.filter(l =>
        l.source === 'system' &&
        (l.content.includes('Verification failed') || l.content.includes('hallucinated') || l.content.includes('never pushed'))
      );
      if (failureLogs.length > 0) {
        contextParts.push(`Failure details:\n${failureLogs.map(l => l.content).join('\n')}`);
      }

      taskQueue.setInteractionContext(taskId, contextParts.join('\n\n'));
    } catch (err) {
      console.warn(`[Orchestrator] Failed to build interaction context for ${taskId}:`, err);
    }

    // Log the instruction
    taskQueue.addLog(taskId, instruction.trim(), 'interaction');

    // Clear current error/warning display (history preserved in arrays)
    if (task.error) {
      taskQueue.addLog(taskId, `Previous error (cleared on follow-up): ${task.error}`, 'system');
      await taskQueue.clearCurrentError(taskId);
    }
    if (task.verification_warning) {
      taskQueue.addLog(taskId, `Previous verification warning (cleared on follow-up): ${task.verification_warning}`, 'system');
      await taskQueue.clearCurrentWarning(taskId);
    }

    await taskQueue.updateTask(taskId, { status: 'approved', engineer_id: undefined });
    taskQueue.addLog(taskId, 'Follow-up instruction sent — respawning engineer', 'system');
    console.log(`[Orchestrator] interactWithTask: task ${taskId.slice(0, 8)} set to approved; triggering processQueue`);
    engineerPool.processQueue();
    this.logActivity('task', `Follow-up on task ${taskId.slice(0, 8)}: ${instruction.slice(0, 80)}`);
  }

  private async setTaskStatus(taskId: string, status: string, actionedBy?: string, reason?: string): Promise<void> {
    if (!taskId || !status) return;
    const validStatuses = ['suggested', 'approved', 'queued', 'in_progress', 'verifying', 'in_review', 'done', 'failed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      console.warn(`[Orchestrator] Invalid status: ${status}`);
      return;
    }
    const task = taskQueue.getTask(taskId);
    if (!task) return;
    const oldStatus = task.status;
    if (oldStatus === status) return;

    // Kill engineer if moving away from in_progress
    if (oldStatus === 'in_progress' && task.engineer_id) {
      engineerPool.kill(task.engineer_id);
    }

    const updates: Record<string, unknown> = { status };
    if (actionedBy) updates.actioned_by = actionedBy;
    if (reason) updates.action_reason = reason;
    // Clear error/engineer if moving to approved (for retry-like flows)
    if (status === 'approved') {
      await taskQueue.clearCurrentError(taskId);
      updates.engineer_id = undefined;
    }
    // Clear error and verification_warning when moving away from failed/cancelled
    // (history preserved in errors/verification_warnings arrays)
    if ((oldStatus === 'failed' || oldStatus === 'cancelled') && status !== 'failed' && status !== 'cancelled') {
      if (task.error) {
        taskQueue.addLog(taskId, `Previous error (cleared on status change): ${task.error}`, 'system');
        await taskQueue.clearCurrentError(taskId);
      }
      if (task.verification_warning) {
        taskQueue.addLog(taskId, `Previous verification warning (cleared on status change): ${task.verification_warning}`, 'system');
        await taskQueue.clearCurrentWarning(taskId);
      }
    }

    await taskQueue.updateTask(taskId, updates as Parameters<typeof taskQueue.updateTask>[1]);
    taskQueue.addLog(taskId, `Status manually changed: ${oldStatus} → ${status}${actionedBy ? ` by ${actionedBy}` : ''}${reason ? ` — "${reason}"` : ''}`, 'system');
    if (status === 'approved') {
      console.log(`[Orchestrator] setTaskStatus: task ${taskId.slice(0, 8)} set to approved; triggering processQueue`);
      engineerPool.processQueue();
    }

    // S14: Cap pendingTaskNotifications at 500 items
    if (this.pendingTaskNotifications.length >= 500) {
      this.pendingTaskNotifications.shift();
    }
    this.pendingTaskNotifications.push({
      taskId,
      title: task.title,
      oldStatus,
      newStatus: status,
      actionedBy,
      reason,
      timestamp: new Date().toISOString(),
    });

    this.logActivity('task', `Status changed: ${task.title.slice(0, 50)} ${oldStatus} → ${status}${actionedBy ? ` by ${actionedBy}` : ''}`, { trigger: 'user_action', oldValue: oldStatus, newValue: status });
  }

  /** Drain and return pending manual task-change notifications for CTO context injection */
  drainTaskNotifications(): typeof this.pendingTaskNotifications {
    const notifications = this.pendingTaskNotifications.slice();
    this.pendingTaskNotifications = [];
    return notifications;
  }

  private async approveAllSuggested(): Promise<void> {
    const suggested = taskQueue.getTasksByStatus('suggested');
    for (const task of suggested) {
      await taskQueue.updateTask(task.id, { status: 'approved' });
    }
    if (suggested.length > 0) {
      console.log(`[Orchestrator] approveAllSuggested: ${suggested.length} tasks approved; triggering processQueue`);
      engineerPool.processQueue();
    }
    this.logActivity('task', `Approved all ${suggested.length} suggested tasks`, { trigger: 'user_action' });
  }

  /** Compute estimated tokens for a task based on historical average for the same model */
  private modelAverageCache: Map<string, number> = new Map();
  private modelAverageCacheTime = 0;

  private async getModelAverage(model: string): Promise<number> {
    // Cache for 5 minutes
    if (Date.now() - this.modelAverageCacheTime > 5 * 60 * 1000) {
      this.modelAverageCache.clear();
      this.modelAverageCacheTime = Date.now();
    }
    if (this.modelAverageCache.has(model)) return this.modelAverageCache.get(model)!;

    try {
      const snap = await collections.tasks
        .where('model', '==', model)
        .where('tokens_used', '>', 0)
        .orderBy('tokens_used', 'desc')
        .limit(50)
        .get();
      if (snap.empty) return 0;
      const total = snap.docs.reduce((sum, doc) => sum + (doc.data().tokens_used || 0), 0);
      const avg = Math.round(total / snap.docs.length);
      this.modelAverageCache.set(model, avg);
      return avg;
    } catch {
      return 0;
    }
  }

  private sendTasks(ws: WebSocket): void {
    const tasks = taskQueue.getAllTasks();

    // Attach estimated tokens to suggested tasks asynchronously
    Promise.all(
      tasks.map(async (t) => {
        try {
          if (t.status === 'suggested' && t.tokens_used === 0) {
            const est = await this.getModelAverage(t.model);
            return { ...t, estimatedTokens: est > 0 ? est : undefined };
          }
          return t;
        } catch (err) {
          console.error(`[Orchestrator] sendTasks: Error enriching task ${t.id?.slice(0, 8)}:`, (err as Error).message);
          return t;
        }
      })
    ).then(enrichedTasks => {
      this.send(ws, { type: 'task:list', payload: { tasks: enrichedTasks } });
    }).catch(() => {
      this.send(ws, { type: 'task:list', payload: { tasks } });
    });
  }

  private async sendTaskDetail(ws: WebSocket, taskId: string): Promise<void> {
    if (!taskId) return;
    const task = await taskQueue.getTaskAsync(taskId);
    const logs = await taskQueue.getLogsAsync(taskId);
    this.send(ws, { type: 'task:detail', payload: { task, logs } });
  }

  private async sendTaskLogs(ws: WebSocket, taskId: string): Promise<void> {
    if (!taskId) return;
    const logs = await taskQueue.getLogsAsync(taskId);
    this.send(ws, { type: 'task:logs', payload: { taskId, logs } });
  }

  private async updateTaskPriority(taskId: string, priority: string): Promise<void> {
    if (!taskId || !priority) return;
    await taskQueue.updateTask(taskId, { priority: priority as 'P0' | 'P1' | 'P2' | 'P3' });
  }

  // ---- Engineers ----

  private sendEngineers(ws: WebSocket): void {
    const engineers = engineerPool.getActiveEngineers();
    this.send(ws, { type: 'engineer:list', payload: { engineers } });
  }

  // ---- Config ----

  private sendConfig(ws: WebSocket): void {
    const config = getConfig();
    const safe = maskSecrets(config);
    this.send(ws, { type: 'config:data', payload: { ...safe, isCloudRun: isCloudRun() } });
  }

  private async handleConfigUpdate(ws: WebSocket, updates: Partial<DashboardConfig>): Promise<void> {
    // Don't overwrite secrets with masked values
    const secretFields = ['notionApiKey', 'vantaApiKey', 'vantaClientSecret', 'githubToken', 'slackBotToken', 'slackAppToken', 'slackSigningSecret', 'twilioAccountSid', 'twilioAuthToken', 'sfPassword', 'sfSecurityToken', 'claudeOauthToken'] as const;
    for (const field of secretFields) {
      if ((updates as Record<string, unknown>)[field] === '***') {
        delete (updates as Record<string, unknown>)[field];
      }
    }

    const newConfig = await updateConfig(updates);
    const safe = maskSecrets(newConfig);
    this.send(ws, { type: 'config:data', payload: safe });
    this.logActivity('config', 'Settings updated', { trigger: 'user_action' });

    // Restart integrations if their config changed
    const slackFields = ['slackBotToken', 'slackAppToken', 'slackSigningSecret', 'slackUpdateChannel'] as const;
    if (slackFields.some(f => f in updates)) {
      console.log('[Orchestrator] Slack config changed — restarting Slack bot');
      slackBot.stop();
      slackBot.start();
    }

    const twilioFields = ['twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber'] as const;
    if (twilioFields.some(f => f in updates)) {
      console.log('[Orchestrator] Twilio config changed — restarting Twilio server');
      const { twilioServer } = require('./integrations/twilio');
      twilioServer.stop();
      twilioServer.start();
    }
  }

  private async sendConfigRevisions(ws: WebSocket): Promise<void> {
    try {
      const revisions = await getConfigRevisions();
      this.send(ws, { type: 'config:revisions', payload: { revisions } });
    } catch (err) {
      this.send(ws, { type: 'config:revisions', payload: { revisions: [], error: (err as Error).message } });
    }
  }

  private async handleConfigRollback(ws: WebSocket, revisionId: string): Promise<void> {
    if (!revisionId) {
      this.send(ws, { type: 'config:rollback', payload: { success: false, error: 'No revision ID' } });
      return;
    }
    try {
      const newConfig = await rollbackConfig(revisionId);
      const safe = maskSecrets(newConfig);
      this.send(ws, { type: 'config:data', payload: safe });
      this.send(ws, { type: 'config:rollback', payload: { success: true } });
      this.logActivity('config', `Config rolled back to revision ${revisionId.slice(0, 8)}`);
    } catch (err) {
      this.send(ws, { type: 'config:rollback', payload: { success: false, error: (err as Error).message } });
    }
  }

  // ---- Status ----

  private sendStatus(ws: WebSocket): void {
    const config = getConfig();
    this.send(ws, {
      type: 'system:status',
      payload: {
        engineers: engineerPool.activeCount,
        activeTasks: taskQueue.getTasksByStatus('in_progress', 'approved', 'queued').length,
        dailyTokens: taskQueue.getDailyTokens(),
        config: {
          maxEngineers: config.engineerMaxConcurrent,
          engineerTokenBudget: config.engineerTokenBudget || 500000,
          engineerTimeoutMinutes: config.engineerTimeoutMinutes || 30,
        },
        slackConnected: slackBot.isConnected,
        ctoStatus: 'idle',
      },
    });
  }

  private async sendHealthPings(ws: WebSocket): Promise<void> {
    try {
      const results = await gcpClient.pingAllServices();
      this.send(ws, { type: 'health:results', payload: { services: results } });
    } catch (err) {
      this.send(ws, { type: 'health:results', payload: { services: [], error: (err as Error).message } });
    }
  }

  // ---- Integrations ----

  private async sendNotionTickets(ws: WebSocket): Promise<void> {
    try {
      if (!notionClient.isConfigured) {
        this.send(ws, { type: 'setup:prompt', payload: { integration: 'notion' } });
        this.send(ws, { type: 'notion:tickets', payload: { tickets: [], error: 'Notion not configured' } });
        return;
      }
      const tickets = await notionClient.queryBoard();
      this.send(ws, { type: 'notion:tickets', payload: { tickets } });
    } catch (err) {
      this.send(ws, { type: 'notion:tickets', payload: { tickets: [], error: (err as Error).message } });
    }
  }

  private sendGitHubPRs(ws: WebSocket): void {
    try {
      const prs = githubClient.getOpenPRs();
      const repoStats = githubClient.getRepoStats();
      this.send(ws, { type: 'github:prs', payload: { prs, repoStats } });
    } catch (err) {
      this.send(ws, { type: 'github:prs', payload: { prs: [], error: (err as Error).message } });
    }
  }

  private sendPRDiff(ws: WebSocket, prNumber: number): void {
    if (!prNumber) return;
    try {
      const diff = githubClient.getPRDiff(prNumber);
      const pr = githubClient.getPRDetails(prNumber);
      this.send(ws, { type: 'github:pr_diff', payload: { prNumber, diff, pr } });
    } catch (err) {
      this.send(ws, { type: 'github:pr_diff', payload: { prNumber, diff: '', error: (err as Error).message } });
    }
  }

  private async sendGCPHealth(ws: WebSocket): Promise<void> {
    try {
      const services = await gcpClient.getServiceHealth();
      this.send(ws, { type: 'gcp:health', payload: { services } });
    } catch (err) {
      this.send(ws, { type: 'gcp:health', payload: { services: [], error: (err as Error).message } });
    }
  }

  private sendGCPLogs(ws: WebSocket, service: string, project: string): void {
    if (!service || !project) return;
    try {
      const logs = gcpClient.getRecentLogs(service, project);
      this.send(ws, { type: 'gcp:logs', payload: { service, logs } });
    } catch (err) {
      this.send(ws, { type: 'gcp:logs', payload: { service, logs: [], error: (err as Error).message } });
    }
  }

  // ---- Compliance ----

  private async sendComplianceOverview(ws: WebSocket): Promise<void> {
    try {
      const overview = await vantaClient.getComplianceOverview();
      this.send(ws, { type: 'compliance:overview', payload: overview });
    } catch (err) {
      this.send(ws, { type: 'compliance:overview', payload: { error: (err as Error).message } });
    }
  }

  private async sendFailingControls(ws: WebSocket): Promise<void> {
    try {
      const controls = await vantaClient.getFailingControls();
      this.send(ws, { type: 'compliance:failing', payload: { controls } });
    } catch (err) {
      this.send(ws, { type: 'compliance:failing', payload: { controls: [], error: (err as Error).message } });
    }
  }

  // ---- Analytics ----

  private async sendUsageAnalytics(ws: WebSocket): Promise<void> {
    // Query Firestore for daily tokens and task token usage
    const dailyTokensSnap = await collections.dailyTokens.orderBy('date', 'desc').limit(30).get();
    const dailyTokens = dailyTokensSnap.docs.map(doc => ({
      date: doc.id,
      total_tokens: doc.data().total_tokens || 0,
    }));

    const taskTokensSnap = await collections.tasks
      .where('tokens_used', '>', 0)
      .orderBy('tokens_used', 'desc')
      .limit(20)
      .get();
    const taskTokens = taskTokensSnap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title,
        tokens_used: d.tokens_used,
        model: d.model,
        status: d.status,
        repo: d.repo || undefined,
        project: d.project || undefined,
        created_at: d.created_at,
      };
    });

    // Project-level token aggregation
    const projectMap = new Map<string, { taskCount: number; totalTokens: number }>();
    const allTasksSnap = await collections.tasks.where('tokens_used', '>', 0).get();
    for (const doc of allTasksSnap.docs) {
      const d = doc.data();
      const key = d.project || d.repo || 'default';
      const entry = projectMap.get(key) || { taskCount: 0, totalTokens: 0 };
      entry.taskCount++;
      entry.totalTokens += d.tokens_used || 0;
      projectMap.set(key, entry);
    }
    const projectTokens = Array.from(projectMap.entries())
      .map(([project, data]) => ({ project, ...data }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    const totalAllTime = dailyTokens.reduce((sum, d) => sum + d.total_tokens, 0);

    this.send(ws, {
      type: 'analytics:usage',
      payload: {
        dailyTokens,
        taskTokens,
        totalAllTime,
        todayTokens: taskQueue.getDailyTokens(),
        projectTokens,
      },
    });
  }

  private async sendActivityLog(ws: WebSocket): Promise<void> {
    try {
      const snap = await collections.activityLog.orderBy('timestamp', 'desc').limit(200).get();
      const activities = snap.docs.map(doc => {
        const d = doc.data();
        return {
          timestamp: d.timestamp,
          type: d.type,
          message: d.message,
          trigger: d.trigger,
          oldValue: d.oldValue,
          newValue: d.newValue,
        };
      }).reverse(); // Most recent last (chronological)
      this.send(ws, { type: 'analytics:activity', payload: { activities } });
    } catch {
      // Fallback to in-memory
      this.send(ws, { type: 'analytics:activity', payload: { activities: this.activityLog.slice(-100) } });
    }
  }

  // ---- Codebase Analysis ----

  private async runCodebaseAnalysis(focus?: string): Promise<void> {
    const config = getConfig();
    this.logActivity('analysis', `Starting codebase analysis${focus ? `: ${focus}` : ''}`);

    const analysisPrompt = focus
      ? `Analyze the codebase with a focus on: ${focus}. Provide specific, actionable findings.`
      : `Perform a comprehensive analysis of the codebase. Check for:
1. Security vulnerabilities (OWASP top 10)
2. Test coverage gaps
3. Performance bottlenecks
4. Code quality issues (dead code, duplicated logic)
5. Dependency freshness and known vulnerabilities
6. SOC 2 compliance gaps (logging, access controls, encryption)

For each finding, suggest a specific task with clear acceptance criteria.`;

    // Send as a CTO message so findings appear in chat
    const fullText = await ctoSession.sendMessage(analysisPrompt);

    // Parse any task assignments from the response
    if (fullText) {
      await this.parseTaskAssignments(fullText);
    }
  }

  // ---- CTO Context Injection ----

  /** Gather fresh context from all integrations for the CTO prompt */
  async gatherContext(): Promise<{
    notionSummary?: string;
    prSummary?: string;
    gcpHealth?: string;
    complianceSummary?: string;
  }> {
    const results: Record<string, string> = {};

    // Run all integration queries in parallel
    const [notionResult, gcpResult, complianceResult] = await Promise.allSettled([
      notionClient.isConfigured ? notionClient.getTicketSummary() : Promise.resolve(undefined),
      gcpClient.getHealthSummary(),
      vantaClient.isConfigured ? vantaClient.getComplianceSummary() : Promise.resolve(undefined),
    ]);

    if (notionResult.status === 'fulfilled' && notionResult.value) {
      results.notionSummary = notionResult.value;
    }

    // GitHub is sync (uses execSync), so do it directly
    try {
      results.prSummary = githubClient.getPRSummary();
    } catch { /* ignore */ }

    if (gcpResult.status === 'fulfilled') {
      results.gcpHealth = gcpResult.value;
    }

    if (complianceResult.status === 'fulfilled' && complianceResult.value) {
      results.complianceSummary = complianceResult.value;
    }

    return results;
  }

  // ---- Dogfood Testing ----

  private async runDogfoodTest(ws: WebSocket, testType: string, options: Record<string, unknown>): Promise<void> {
    this.logActivity('dogfood', `Starting dogfood test: ${testType}`);
    this.send(ws, { type: 'dogfood:started', payload: { testType } });

    const onProgress: DogfoodProgressCallback = (event) => {
      this.send(ws, { type: 'dogfood:progress', payload: event });
    };

    try {
      // Wrap with a 2-minute overall timeout to prevent indefinite hangs
      const testPromise = runDogfoodTest(
        (testType || 'backend-latency') as DogfoodTestType,
        {
          message: options?.message as string,
          backendUrl: options?.backendUrl as string,
          headless: (options?.headless as boolean) ?? isCloudRun(),
          onProgress,
        },
      );
      const timeoutMs = testType === 'full-suite' ? 600_000 : 120_000;
      const results = await Promise.race([
        testPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Dogfood test timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        ),
      ]);

      const report = formatDogfoodReport(results);
      // Enrich with base64 screenshot data for frontend display
      const enriched = enrichScreenshots(results);
      const clientResults = enriched.map(r => ({
        ...r,
        screenshots: r.screenshotData,
      }));
      this.send(ws, { type: 'dogfood:results', payload: { results: clientResults, report } });
      this.logActivity('dogfood', `Dogfood test complete: ${results.map(r => `${r.testName}=${r.success ? 'PASS' : 'FAIL'}`).join(', ')}`);
    } catch (err) {
      const errMsg = (err as Error).message || 'Unknown dogfood error';
      console.error(`[Orchestrator] Dogfood test error: ${errMsg}`);
      this.send(ws, { type: 'dogfood:error', payload: { error: errMsg } });
      this.logActivity('dogfood', `Dogfood test failed: ${errMsg}`);
    }
  }

  private async runDogfoodWithAnalysis(ws: WebSocket, testType: string, options: Record<string, unknown>): Promise<void> {
    this.logActivity('dogfood', `Starting dogfood test with CTO analysis: ${testType}`);
    this.send(ws, { type: 'dogfood:started', payload: { testType, withAnalysis: true } });

    const onProgress: DogfoodProgressCallback = (event) => {
      this.send(ws, { type: 'dogfood:progress', payload: event });
    };

    try {
      const analysisPromise = dogfoodWithCTOAnalysis(
        (testType || 'backend-latency') as DogfoodTestType,
        {
          message: options?.message as string,
          backendUrl: options?.backendUrl as string,
          headless: (options?.headless as boolean) ?? isCloudRun(),
          onProgress,
        },
      );
      const { results, report } = await Promise.race([
        analysisPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Dogfood test with analysis timed out after 10 minutes')), 600_000)
        ),
      ]);
      // Also send results to the frontend
      const enriched = enrichScreenshots(results);
      const clientResults = enriched.map(r => ({
        ...r,
        screenshots: r.screenshotData,
      }));
      this.send(ws, { type: 'dogfood:results', payload: { results: clientResults, report } });
      this.logActivity('dogfood', 'Dogfood test with CTO analysis complete');
    } catch (err) {
      const errMsg = (err as Error).message || 'Unknown dogfood error';
      console.error(`[Orchestrator] Dogfood analysis error: ${errMsg}`);
      this.send(ws, { type: 'dogfood:error', payload: { error: errMsg } });
    }
  }

  // ---- Evals ----

  private async sendEvals(ws: WebSocket): Promise<void> {
    const evals = await evalStore.getAll();
    this.send(ws, { type: 'eval:list', payload: { evals } });
  }

  private async createEval(ws: WebSocket, payload: Record<string, unknown>): Promise<void> {
    const eval_ = await evalStore.create({
      name: payload.name as string,
      description: (payload.description as string) || '',
      category: (payload.category as 'functional') || 'functional',
      input: payload.input as string,
      expectedBehavior: payload.expectedBehavior as string | undefined,
      maxTtftMs: payload.maxTtftMs as number | undefined,
      maxResponseMs: payload.maxResponseMs as number | undefined,
      expectNoErrors: (payload.expectNoErrors as boolean) ?? true,
      createdBy: 'user',
    });
    this.send(ws, { type: 'eval:created', payload: { eval: eval_ } });
    this.logActivity('eval', `Created eval: ${eval_.name}`);
  }

  private async deleteEval(ws: WebSocket, evalId: string): Promise<void> {
    if (!evalId) return;
    await evalStore.delete(evalId);
    this.send(ws, { type: 'eval:deleted', payload: { evalId } });
  }

  private async runEvalSuite(ws: WebSocket, evalIds?: string[], durationMinutes?: number): Promise<void> {
    this.logActivity('eval', `Starting eval suite${evalIds ? ` (${evalIds.length} selected)` : ' (all)'}`);
    this.send(ws, { type: 'dogfood:started', payload: { testType: 'eval-suite' } });

    try {
      const result = await runEvals(evalIds, { durationMinutes: durationMinutes || 10 });
      const enriched = enrichScreenshots([result]);
      const clientResults = enriched.map(r => ({
        ...r,
        screenshots: r.screenshotData,
      }));
      this.send(ws, {
        type: 'dogfood:results',
        payload: { results: clientResults, report: formatDogfoodReport([result]) },
      });
      this.logActivity('eval', `Eval suite complete: ${result.metrics.evals_passed || 0} passed, ${result.metrics.evals_failed || 0} failed`);
    } catch (err) {
      this.send(ws, { type: 'dogfood:error', payload: { error: (err as Error).message } });
    }
  }

  private async generateEvals(ws: WebSocket): Promise<void> {
    this.logActivity('eval', 'Asking CTO to generate new eval scenarios');
    this.send(ws, { type: 'dogfood:started', payload: { testType: 'eval-generation', withAnalysis: true } });

    try {
      await generateCTOEvals();
      const evals = await evalStore.getAll();
      this.send(ws, { type: 'eval:list', payload: { evals } });
      this.logActivity('eval', 'CTO generated new eval scenarios');
    } catch (err) {
      this.send(ws, { type: 'dogfood:error', payload: { error: (err as Error).message } });
    }
  }

  private async sendEvalHistory(ws: WebSocket, evalId?: string): Promise<void> {
    const history = await evalStore.getRunHistory(evalId);
    this.send(ws, { type: 'eval:history', payload: { history } });
  }

  private async seedEvalDefaults(ws: WebSocket): Promise<void> {
    await evalStore.seedDefaults();
    const evals = await evalStore.getAll();
    this.send(ws, { type: 'eval:list', payload: { evals } });
    this.logActivity('eval', 'Seeded default eval definitions');
  }

  private async importEvals(ws: WebSocket, content: string): Promise<void> {
    if (!content?.trim()) {
      this.send(ws, { type: 'eval:import_done', payload: { created: 0, error: 'No content provided' } });
      return;
    }

    this.logActivity('eval', `Importing evals from pasted content (${content.length} chars)`);
    this.send(ws, { type: 'dogfood:started', payload: { testType: 'eval-import', withAnalysis: true } });

    try {
      const created = await importEvalsViaCTO(content);
      const evals = await evalStore.getAll();
      this.send(ws, { type: 'eval:list', payload: { evals } });
      this.send(ws, { type: 'eval:import_done', payload: { created } });
      this.logActivity('eval', `Imported ${created} evals from pasted content`);
    } catch (err) {
      this.send(ws, { type: 'eval:import_done', payload: { created: 0, error: (err as Error).message } });
      this.send(ws, { type: 'dogfood:error', payload: { error: (err as Error).message } });
    }
  }

  // ---- Error Monitoring ----

  private async handleErrorReport(payload: Record<string, unknown>): Promise<void> {
    const { id, taskCreated } = await errorCollector.record({
      source: (payload.source as string) || 'frontend',
      level: (payload.level as string) || 'error',
      message: (payload.message as string) || 'Unknown error',
      stack: payload.stack as string | undefined,
      context: payload.context ? JSON.stringify(payload.context) : undefined,
    });

    if (taskCreated) {
      this.logActivity('auto-fix', `Auto-created fix task for error ${id}: ${(payload.message as string || '').slice(0, 80)}`, { trigger: 'auto_fix' });
    }
  }

  private async sendErrors(ws: WebSocket): Promise<void> {
    const errors = await errorCollector.getRecent(50);
    const counts = await errorCollector.getCounts();
    this.send(ws, { type: 'error:list', payload: { errors, counts } });
  }

  private async resolveError(errorId: string): Promise<void> {
    if (!errorId) return;
    await errorCollector.resolve(errorId);
  }

  // ---- PR Reviews ----

  private sendPRList(ws: WebSocket): void {
    try {
      const prs = githubClient.getOpenPRs(30) as PullRequest[];

      // Merge in externally-added PRs (re-fetch fresh)
      for (const url of this.externalPRUrls) {
        try {
          const result = githubClient.getPRByUrl(url);
          if (result && !prs.some(p => p.url === result.pr.url)) {
            prs.unshift(result.pr);
          }
        } catch {
          // External PR may have been merged/closed or URL invalid — skip
        }
      }

      this.send(ws, { type: 'pr:list', payload: { prs } });
    } catch (err) {
      this.send(ws, { type: 'pr:list', payload: { prs: [], error: (err as Error).message } });
    }
  }

  private addPRByUrl(ws: WebSocket, url: string): void {
    if (!url?.trim()) {
      this.send(ws, { type: 'pr:added', payload: { error: 'No URL provided' } });
      return;
    }
    try {
      const result = githubClient.getPRByUrl(url.trim());
      if (!result) {
        this.send(ws, { type: 'pr:added', payload: { error: 'PR not found' } });
        return;
      }
      this.externalPRUrls.add(url.trim());
      this.send(ws, { type: 'pr:added', payload: { pr: result.pr } });
      this.logActivity('pr-review', `Added external PR: ${result.repoSlug}#${result.pr.number}`);
    } catch (err) {
      this.send(ws, { type: 'pr:added', payload: { error: (err as Error).message } });
    }
  }

  /** Resolve the repo slug for a PR, checking if it's an external PR */
  private resolveRepoSlug(prNumber: number, explicitSlug?: string): string | undefined {
    if (explicitSlug) return explicitSlug;
    // Check external PRs for a matching number
    for (const url of this.externalPRUrls) {
      const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
      if (match && parseInt(match[2]) === prNumber) {
        return match[1];
      }
    }
    return undefined;
  }

  private sendPRDetail(ws: WebSocket, prNumber: number, repoSlug?: string): void {
    if (!prNumber) return;
    const slug = this.resolveRepoSlug(prNumber, repoSlug);
    try {
      const pr = githubClient.getPRDetails(prNumber, slug) as PullRequest | null;
      const diff = githubClient.getPRDiff(prNumber, slug);
      const reviews = githubClient.getPRReviews(prNumber, slug);
      if (pr) {
        this.send(ws, { type: 'pr:detail', payload: { pr, diff, reviews } });
      }
    } catch (err) {
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'detail', success: false, error: (err as Error).message } });
    }
  }

  private async reviewPR(ws: WebSocket, prNumber: number, repoSlug?: string): Promise<void> {
    if (!prNumber) return;
    const slug = this.resolveRepoSlug(prNumber, repoSlug);
    this.send(ws, { type: 'pr:review_started', payload: { prNumber } });
    this.logActivity('pr-review', `CTO reviewing PR #${prNumber}${slug ? ` (${slug})` : ''}`);

    try {
      const pr = githubClient.getPRDetails(prNumber, slug);
      const diff = githubClient.getPRDiff(prNumber, slug);

      if (!pr) {
        this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'review', success: false, error: 'PR not found' } });
        return;
      }

      const reviewPrompt = `Please review this pull request:

**PR #${pr.number}: ${pr.title}**
Author: ${pr.author} | Branch: ${pr.branch} → ${pr.baseBranch}
Changes: +${pr.additions}/-${pr.deletions}

**Description:**
${(pr as PullRequest).body || 'No description provided.'}

**Diff:**
\`\`\`diff
${diff.slice(0, 50000)}
\`\`\`

Provide a thorough code review. End with your verdict: VERDICT: APPROVE, COMMENT, or REQUEST_CHANGES`;

      // Send to CTO for review
      const reviewText = await ctoSession.sendMessage(reviewPrompt);

      // Extract recommendation
      const recommendation = this.extractReviewRecommendation(reviewText);

      // Submit review to GitHub
      try {
        githubClient.submitPRReview(prNumber, reviewText, recommendation, slug);
      } catch (err) {
        console.error('[Orchestrator] Failed to submit review to GitHub:', (err as Error).message);
      }

      this.send(ws, { type: 'pr:review_complete', payload: { prNumber, reviewText, recommendation } });
      this.logActivity('pr-review', `CTO review of PR #${prNumber}: ${recommendation}`);
    } catch (err) {
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'review', success: false, error: (err as Error).message } });
    }
  }

  private extractReviewRecommendation(text: string): 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES' {
    const lower = text.toLowerCase();
    // Look for explicit VERDICT line
    const verdictMatch = lower.match(/verdict:\s*(approve|comment|request_changes)/);
    if (verdictMatch) {
      return verdictMatch[1].toUpperCase().replace(' ', '_') as 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
    }
    // Fallback heuristics
    if (lower.includes('request_changes') || lower.includes('request changes')) return 'REQUEST_CHANGES';
    if (lower.includes('approve')) return 'APPROVE';
    return 'COMMENT';
  }

  private approvePR(ws: WebSocket, prNumber: number, repoSlug?: string): void {
    if (!prNumber) return;
    const slug = this.resolveRepoSlug(prNumber, repoSlug);
    try {
      githubClient.submitPRReview(prNumber, 'Approved via CTO Dashboard', 'APPROVE', slug);
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'approve', success: true } });
      this.logActivity('pr-review', `Approved PR #${prNumber}`);
    } catch (err) {
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'approve', success: false, error: (err as Error).message } });
    }
  }

  private mergePR(ws: WebSocket, prNumber: number, method?: string, repoSlug?: string): void {
    if (!prNumber) return;
    const slug = this.resolveRepoSlug(prNumber, repoSlug);
    try {
      githubClient.mergePR(prNumber, (method as 'squash' | 'merge' | 'rebase') || 'squash', slug);
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'merge', success: true } });
      this.logActivity('pr-review', `Merged PR #${prNumber} (${method || 'squash'})`);
    } catch (err) {
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'merge', success: false, error: (err as Error).message } });
    }
  }

  private commentOnPR(ws: WebSocket, prNumber: number, body: string, repoSlug?: string): void {
    if (!prNumber || !body) return;
    const slug = this.resolveRepoSlug(prNumber, repoSlug);
    try {
      githubClient.addPRComment(prNumber, body, slug);
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'comment', success: true } });
      this.logActivity('pr-review', `Commented on PR #${prNumber}`);
    } catch (err) {
      this.send(ws, { type: 'pr:action_result', payload: { prNumber, action: 'comment', success: false, error: (err as Error).message } });
    }
  }

  // ---- Daily Check-in ----

  private async triggerCheckin(ws: WebSocket): Promise<void> {
    try {
      const report = await dailyCheckin.runDailyCheckin();
      this.send(ws, { type: 'checkin:complete', payload: { report } });
    } catch (err) {
      this.send(ws, { type: 'checkin:error', payload: { error: (err as Error).message } });
    }
  }

  private async getCheckinReport(ws: WebSocket, reportId: string): Promise<void> {
    if (!reportId) return;
    try {
      const doc = await collections.dailyReports.doc(reportId).get();
      if (doc.exists) {
        this.send(ws, { type: 'checkin:report', payload: { report: { id: doc.id, ...doc.data() } } });
      }
    } catch (err) {
      this.send(ws, { type: 'checkin:error', payload: { error: (err as Error).message } });
    }
  }

  private async listCheckinReports(ws: WebSocket): Promise<void> {
    try {
      const snap = await collections.dailyReports.orderBy('date', 'desc').limit(30).get();
      const reports = snap.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          date: d.date,
          tasksCompleted: d.stats?.tasksCompleted || 0,
          dailyTokens: d.stats?.dailyTokens || d.stats?.dailySpend || 0,
          createdAt: d.createdAt || d.created_at,
        };
      });
      this.send(ws, { type: 'checkin:reports', payload: { reports } });
    } catch (err) {
      this.send(ws, { type: 'checkin:error', payload: { error: (err as Error).message } });
    }
  }

  // ---- Projects ----

  private async parseProjectPlans(text: string): Promise<void> {
    const regex = /<project_plan>\s*(\{[\s\S]*?\})\s*<\/project_plan>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const plan = JSON.parse(match[1]);
        const phases = (plan.phases || []).map((p: Record<string, unknown>, idx: number) => ({
          id: `phase-${idx + 1}-${Date.now()}`,
          name: p.name,
          description: p.description || '',
          status: idx === 0 ? 'active' : 'pending',
          dependsOnPhases: p.dependsOnPhases || [],
          taskIds: [],
          requiresApproval: p.requiresApproval || false,
          created_at: new Date().toISOString(),
        }));

        const project = await projectManager.createProject({
          name: plan.name,
          description: plan.description || '',
          goal: plan.goal || plan.description || '',
          phases,
          autonomy: plan.autonomy || { level: 'supervised' },
          autoApprove: plan.autoApprove || false,
          autoMerge: plan.autoMerge || false,
          autoDeploy: plan.autoDeploy || false,
          repo: plan.repo,
          tokenBudget: plan.tokenBudget,
        });

        // Create tasks for the first (active) phase
        if (phases.length > 0 && plan.phases[0]?.tasks) {
          const firstPhase = phases[0];
          const createdTasks: { title: string; id: string }[] = [];

          for (const taskDef of plan.phases[0].tasks) {
            const task = await taskQueue.createTask({
              title: taskDef.title,
              description: taskDef.description,
              branch: taskDef.branch,
              repo: taskDef.repo || plan.repo,
              model: taskDef.model,
              priority: taskDef.priority,
              projectId: project.id,
              phaseId: firstPhase.id,
              skillProfile: taskDef.skillProfile,
              status: plan.autoApprove ? 'approved' : 'suggested',
            });
            createdTasks.push({ title: task.title, id: task.id });
            firstPhase.taskIds.push(task.id);
          }

          // Resolve dependsOn by title → id within the phase
          for (const created of createdTasks) {
            const task = taskQueue.getTask(created.id);
            const taskDef = plan.phases[0].tasks.find((t: Record<string, unknown>) => t.title === created.title);
            if (taskDef?.dependsOn && taskDef.dependsOn.length > 0) {
              const resolvedDeps = (taskDef.dependsOn as string[]).map((depTitle: string) => {
                const dep = createdTasks.find(c => c.title === depTitle);
                return dep?.id;
              }).filter(Boolean) as string[];

              if (resolvedDeps.length > 0 && task) {
                task.dependsOn = resolvedDeps;
                await collections.tasks.doc(created.id).update({ dependsOn: resolvedDeps });
              }
            }
          }

          await projectManager.updateProject(project.id, { phases });

          if (plan.autoApprove) {
            engineerPool.processQueue();
          }
        }

        this.logActivity('project', `Created project: ${project.name} (${phases.length} phases)`, { trigger: 'user_action' });
      } catch (err) {
        console.error('[Orchestrator] Failed to parse project plan:', err);
      }
    }
  }

  private async parseMemoryEntries(text: string): Promise<void> {
    const regex = /<memory>\s*(\{[\s\S]*?\})\s*<\/memory>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        await memoryStore.addEntry({
          type: data.type || 'learning',
          content: data.content,
          projectId: data.projectId,
          tags: data.tags || [],
        });
      } catch (err) {
        console.error('[Orchestrator] Failed to parse memory entry:', err);
      }
    }
  }

  private async parseDeployTriggers(text: string): Promise<void> {
    const regex = /<deploy_trigger>\s*(\{[\s\S]*?\})\s*<\/deploy_trigger>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        await deployManager.deploy({
          repoName: data.repoName,
          projectId: data.projectId,
        });
        this.logActivity('deploy', `Deploy triggered for ${data.repoName}`, { trigger: 'user_action' });
      } catch (err) {
        console.error('[Orchestrator] Failed to parse deploy trigger:', err);
      }
    }
  }

  private async parseRepoCreation(text: string): Promise<void> {
    const regex = /<create_repo>\s*(\{[\s\S]*?\})\s*<\/create_repo>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const data = JSON.parse(match[1]);
        const result = await deployManager.createRepo({
          name: data.name,
          description: data.description,
          isPrivate: data.isPrivate,
          template: data.template,
        });
        this.logActivity('repo', `Created repo: ${result.repoSlug}`, { trigger: 'user_action' });
      } catch (err) {
        console.error('[Orchestrator] Failed to parse repo creation:', err);
      }
    }
  }

  private async sendProjects(ws: WebSocket): Promise<void> {
    const projects = await projectManager.getAllProjectsAsync();
    this.send(ws, { type: 'project:list', payload: { projects } });
  }

  private async sendProjectDetail(ws: WebSocket, projectId: string): Promise<void> {
    if (!projectId) return;
    const project = await projectManager.getProjectAsync(projectId);
    if (project) {
      this.send(ws, { type: 'project:detail', payload: { project } });
    }
  }

  private async createProject(ws: WebSocket, payload: Record<string, unknown>): Promise<void> {
    const project = await projectManager.createProject({
      name: payload.name as string,
      description: (payload.description as string) || '',
      goal: (payload.goal as string) || '',
      repo: payload.repo as string | undefined,
      autonomy: payload.autonomy as AutonomySettings | undefined,
      autoApprove: payload.autoApprove as boolean | undefined,
      autoMerge: payload.autoMerge as boolean | undefined,
      autoDeploy: payload.autoDeploy as boolean | undefined,
    });
    this.send(ws, { type: 'project:created', payload: { project } });
  }

  private async updateProjectFromWs(ws: WebSocket, projectId: string, payload: Record<string, unknown>): Promise<void> {
    if (!projectId) return;
    const { projectId: _, ...updates } = payload;
    const project = await projectManager.updateProject(projectId, updates as Partial<Project>);
    if (project) {
      this.send(ws, { type: 'project:updated', payload: { project } });
    }
  }

  private async advanceProject(ws: WebSocket, projectId: string): Promise<void> {
    if (!projectId) return;
    await projectManager.advanceProject(projectId);
    const project = await projectManager.getProjectAsync(projectId);
    if (project) {
      this.send(ws, { type: 'project:updated', payload: { project } });
    }
  }

  private async archiveProject(ws: WebSocket, projectId: string): Promise<void> {
    if (!projectId) return;
    await projectManager.updateProject(projectId, { status: 'archived' });
    const project = projectManager.getProject(projectId);
    if (project) {
      this.send(ws, { type: 'project:updated', payload: { project } });
    }
  }

  private async pauseProject(ws: WebSocket, projectId: string): Promise<void> {
    if (!projectId) return;
    await projectManager.updateProject(projectId, { status: 'paused' });
    const project = projectManager.getProject(projectId);
    if (project) {
      this.send(ws, { type: 'project:updated', payload: { project } });
    }
  }

  private async resumeProject(ws: WebSocket, projectId: string): Promise<void> {
    if (!projectId) return;
    await projectManager.updateProject(projectId, { status: 'active' });
    await projectManager.advanceProject(projectId);
    const project = await projectManager.getProjectAsync(projectId);
    if (project) {
      this.send(ws, { type: 'project:updated', payload: { project } });
    }
  }

  // ---- Memory ----

  private async sendMemories(ws: WebSocket, projectId?: string): Promise<void> {
    const entries = memoryStore.getEntries({ projectId });
    this.send(ws, { type: 'memory:list', payload: { entries } });
  }

  private async addMemory(ws: WebSocket, payload: Record<string, unknown>): Promise<void> {
    const entry = await memoryStore.addEntry({
      type: (payload.type as string) as 'decision' | 'preference' | 'learning' | 'architecture' | 'constraint',
      content: payload.content as string,
      projectId: payload.projectId as string | undefined,
      tags: payload.tags as string[] | undefined,
    });
    this.send(ws, { type: 'memory:added', payload: { entry } });
  }

  private async deleteMemory(ws: WebSocket, id: string): Promise<void> {
    if (!id) return;
    await memoryStore.deleteEntry(id);
    this.send(ws, { type: 'memory:deleted', payload: { id } });
  }

  private searchMemories(ws: WebSocket, query: string): void {
    if (!query) return;
    const entries = memoryStore.search(query);
    this.send(ws, { type: 'memory:list', payload: { entries } });
  }

  // ---- Deploy ----

  private async triggerDeploy(ws: WebSocket, payload: Record<string, unknown>): Promise<void> {
    try {
      const deploy = await deployManager.deploy({
        repoName: payload.repoName as string,
        projectId: payload.projectId as string | undefined,
      });
      this.send(ws, { type: 'deploy:started', payload: { deploy } });
    } catch (err) {
      this.send(ws, { type: 'deploy:completed', payload: { deploy: { status: 'failed', error: (err as Error).message } } });
    }
  }

  private async sendDeployHistory(ws: WebSocket): Promise<void> {
    const deploys = await deployManager.getHistory();
    this.send(ws, { type: 'deploy:history', payload: { deploys } });
  }

  // ---- Helpers ----

  private logActivity(
    type: string,
    message: string,
    options?: { trigger?: string; oldValue?: string; newValue?: string },
  ): void {
    const entry = { timestamp: new Date().toISOString(), type, message };

    this.activityLog.push(entry);
    // Keep only last 500 entries in memory
    if (this.activityLog.length > 500) {
      this.activityLog = this.activityLog.slice(-500);
    }

    // Persist to Firestore — only include defined optional fields to avoid undefined value errors
    const firestoreEntry: Record<string, string> = { ...entry };
    if (options?.trigger) firestoreEntry.trigger = options.trigger;
    if (options?.oldValue) firestoreEntry.oldValue = options.oldValue;
    if (options?.newValue) firestoreEntry.newValue = options.newValue;
    collections.activityLog.add(firestoreEntry).catch(err =>
      console.error('[Activity] Failed to persist:', (err as Error).message)
    );

    // Broadcast to connected clients
    eventBus.emitDashboard({
      type: 'system:status',
      data: {
        engineers: engineerPool.activeCount,
        activeTasks: taskQueue.getTasksByStatus('in_progress', 'approved', 'queued').length,
        dailyTokens: taskQueue.getDailyTokens(),
      },
    });
  }

  // ---- Slack ----

  private async reconnectSlack(ws: WebSocket): Promise<void> {
    slackBot.stop();
    await slackBot.start();
    this.send(ws, {
      type: 'slack:status',
      payload: { configured: slackBot.isConfigured, connected: slackBot.isConnected },
    });
  }

  private async sendSlackConversations(ws: WebSocket): Promise<void> {
    try {
      const snap = await collections.slackMessageQueue.orderBy('created_at', 'desc').limit(100).get();
      const conversations = snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id,
          slackUserId: r.slack_user_id,
          slackChannelId: r.slack_channel_id,
          messageText: r.message_text,
          messageType: r.message_type,
          threadTs: r.thread_ts || undefined,
          userName: r.user_name || undefined,
          status: r.status,
          response: r.response || undefined,
          createdAt: r.created_at,
          processedAt: r.processed_at || undefined,
        };
      });
      this.send(ws, { type: 'slack:conversations', payload: { conversations } });
    } catch (err) {
      this.send(ws, { type: 'slack:conversations', payload: { conversations: [], error: (err as Error).message } });
    }
  }

  private async sendSlackQueue(ws: WebSocket): Promise<void> {
    try {
      const snap = await collections.slackMessageQueue
        .where('status', '==', 'pending')
        .orderBy('created_at', 'asc')
        .get();
      const queue = snap.docs.map(doc => {
        const r = doc.data();
        return {
          id: doc.id,
          slackUserId: r.slack_user_id,
          slackChannelId: r.slack_channel_id,
          messageText: r.message_text,
          messageType: r.message_type,
          threadTs: r.thread_ts || undefined,
          userName: r.user_name || undefined,
          status: r.status,
          response: r.response || undefined,
          createdAt: r.created_at,
          processedAt: r.processed_at || undefined,
        };
      });
      this.send(ws, { type: 'slack:queue', payload: { queue } });
    } catch (err) {
      this.send(ws, { type: 'slack:queue', payload: { queue: [], error: (err as Error).message } });
    }
  }

  private sendSlackStatus(ws: WebSocket): void {
    this.send(ws, {
      type: 'slack:status',
      payload: {
        configured: slackBot.isConfigured,
        connected: slackBot.isConnected,
      },
    });
  }

  private async postSlackUpdate(ws: WebSocket): Promise<void> {
    if (!slackBot.isConfigured) {
      this.send(ws, { type: 'slack:error', payload: { error: 'Slack not configured' } });
      return;
    }
    await slackBot.postStatusUpdate();
    this.send(ws, { type: 'slack:update_posted', payload: { success: true } });
  }

  private async sendSlackMessage(ws: WebSocket, channel: string, message: string): Promise<void> {
    if (!slackBot.isConfigured || !channel || !message) return;
    const ok = await slackBot.postMessage(channel, message);
    this.send(ws, { type: 'slack:message_sent', payload: { success: ok, channel } });
  }

  private send(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  shutdown(): void {
    engineerPool.stopPolling();
    engineerPool.killAll();
  }
}

export const orchestrator = new Orchestrator();
