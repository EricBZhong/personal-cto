import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from './event-bus';
import { buildCTOSystemPrompt } from './prompts/cto-system';
import { taskQueue } from './task-queue';
import { getConfig } from './config';
import { buildClaudeEnv } from './claude-auth';
import { engineerPool } from './engineer-pool';
import { notionClient } from './integrations/notion';
import { githubClient } from './integrations/github';
import { gcpClient } from './integrations/gcp';
import { vantaClient } from './integrations/vanta';
import { slackBot } from './integrations/slack';
import { clarificationTracker, strategyPollTracker } from './clarification-tracker';
import { collections, chatMessages } from './firestore';
import { orchestrator } from './orchestrator';
import { memoryStore } from './memory-store';
import { projectManager } from './project-manager';
import { maskSecretsInString } from './utils/reliability';

interface StreamJsonEvent {
  type: string;
  subtype?: string;
  message?: {
    id: string;
    role: string;
    content: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };
  index?: number;
  content_block?: { type: string; text?: string };
  delta?: { type: string; text?: string };
  usage?: { output_tokens: number };
  result?: {
    cost_usd?: number;
    duration_ms?: number;
    is_error?: boolean;
    session_id?: string;
  };
}

export class CTOSession {
  private currentProcess: ChildProcess | null = null;
  private activeThreadId: string = 'default';

  setThread(threadId: string): void {
    this.activeThreadId = threadId;
  }

  getActiveThread(): string {
    return this.activeThreadId;
  }

  async sendMessage(userMessage: string, modelOverride?: string, explicitThreadId?: string): Promise<string> {
    const messageId = uuidv4();
    const config = getConfig();
    const threadId = explicitThreadId || this.activeThreadId;

    // Fetch conversation history BEFORE storing current message so we get prior context only
    const priorHistory = await this.getConversationHistory(threadId);

    // Store user message in Firestore
    await chatMessages(threadId).add({
      thread_id: threadId,
      role: 'user',
      content: userMessage,
      message_id: messageId,
      cost_usd: 0,
      timestamp: new Date().toISOString(),
    });

    // Auto-title the thread from the first message
    const threadDoc = await collections.chatThreads.doc(threadId).get();
    if (threadDoc.exists && threadDoc.data()?.title === 'New Chat') {
      const title = userMessage.slice(0, 60) + (userMessage.length > 60 ? '...' : '');
      await collections.chatThreads.doc(threadId).update({
        title,
        updated_at: new Date().toISOString(),
      });
    } else if (threadDoc.exists) {
      await collections.chatThreads.doc(threadId).update({
        updated_at: new Date().toISOString(),
      });
    }

    // Gather context from all integrations (parallel)
    const context = await this.gatherContext();

    const tasks = taskQueue.getAllTasks();
    const activeTasks = tasks
      .filter(t => !['done', 'cancelled'].includes(t.status))
      .map(t => `- [${t.status}] ${t.title} (${t.priority})${t.engineer_id ? ` — Engineer ${t.engineer_id.slice(0, 8)}` : ''}`)
      .join('\n');

    // Drain any pending manual task-change notifications for CTO context
    const taskNotifications = orchestrator.drainTaskNotifications();
    const recentTaskChanges = taskNotifications.length > 0
      ? taskNotifications.map(n =>
        `- "${n.title}": ${n.oldStatus} → ${n.newStatus}${n.actionedBy ? ` (by ${n.actionedBy})` : ''}${n.reason ? ` — reason: "${n.reason}"` : ''}`
      ).join('\n')
      : undefined;

    // Gather clarification/poll summaries
    const pendingClarifications = await clarificationTracker.getPendingAsync();
    const pendingPolls = await strategyPollTracker.getPendingAsync();

    const clarificationSummary = pendingClarifications.length > 0
      ? pendingClarifications.map(c =>
        `- "${c.ticket_title}" → ${c.ask_user_name} (${c.status}): ${c.questions.length} questions`
      ).join('\n')
      : undefined;

    const pollSummary = pendingPolls.length > 0
      ? pendingPolls.map(p =>
        `- "${p.ticket_title}" (${p.status}): ${p.options.map(o => o.label).join(' vs ')}`
      ).join('\n')
      : undefined;

    // Gather memories and active projects for CTO context
    const memories = memoryStore.getRelevantMemories();
    const activeProjects = projectManager.getActiveProjectsSummary();

    // Build skill profiles listing
    const skillProfilesList = (config.skillProfiles || [])
      .map(p => `- **${p.name}**: ${p.description}`)
      .join('\n');

    const systemPrompt = buildCTOSystemPrompt({
      repoPath: config.colbyRepoPath,
      ctoDashboardPath: config.ctoDashboardRepoPath,
      repos: config.repos,
      activeTasks: activeTasks || undefined,
      recentPRs: context.prSummary,
      dailyTokens: taskQueue.getDailyTokens(),
      engineerCount: engineerPool.activeCount,
      maxEngineers: config.engineerMaxConcurrent,
      notionSummary: context.notionSummary,
      gcpHealth: context.gcpHealth,
      complianceSummary: context.complianceSummary,
      currentModel: modelOverride || config.ctoModel,
      slackConnected: slackBot.isConnected,
      pendingClarifications: clarificationSummary,
      pendingPolls: pollSummary,
      recentTaskChanges,
      activeProjects,
      memories,
      skillProfiles: skillProfilesList || undefined,
    });

    // Build conversation context from prior messages (last 20 exchanges)
    let messageForCTO = userMessage;
    if (priorHistory.length > 0) {
      const recent = priorHistory.slice(-20);
      const historyText = recent
        .map(m => `${m.role === 'user' ? 'User' : 'You (CTO)'}: ${m.content.length > 2000 ? m.content.slice(0, 2000) + '...' : m.content}`)
        .join('\n\n');
      messageForCTO = `[Conversation history in this chat thread:\n${historyText}\n]\n\nUser's latest message: ${userMessage}`;
    }

    const claudePath = config.claudeCliPath || 'claude';
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', modelOverride || config.ctoModel,
      '--max-turns', '300',
      '--system-prompt', systemPrompt,
      messageForCTO,
    ];

    console.log(`[CTO] Spawning: ${claudePath} ${args.slice(0, 6).join(' ')} ... (cwd: ${config.colbyRepoPath})`);
    console.log(`[CTO] Model: ${config.ctoModel} | Thread: ${threadId}`);

    // Use configured repo path if it exists, otherwise fall back to cwd
    const fs = await import('fs');
    const cwd = config.colbyRepoPath && fs.existsSync(config.colbyRepoPath)
      ? config.colbyRepoPath
      : process.cwd();

    // Explicitly inject GH_TOKEN so CTO's tool subprocesses can use gh/git
    const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
    const child = spawn(claudePath, args, {
      cwd,
      env: buildClaudeEnv({
        ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    console.log(`[CTO] Process spawned, PID: ${child.pid}`);

    this.currentProcess = child;

    let fullText = '';
    let buffer = '';
    let tokensUsed = 0;

    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          this.handleStreamEvent(event, messageId, (text) => {
            fullText += text;
          }, (tokens) => {
            tokensUsed += tokens;
          });
        } catch {
          // Non-JSON line — log it for debugging
          console.log(`[CTO stdout] ${line.slice(0, 200)}`);
        }
      }
    });

    child.stdout?.on('error', (err) => {
      console.error(`[CTO] stdout stream error:`, err.message);
    });

    let stderrOutput = '';
    child.stderr?.on('data', (data: Buffer) => {
      // SEC6: Mask secrets before logging stderr output
      const text = maskSecretsInString(data.toString());
      stderrOutput += text;
      if (text.trim()) console.log(`[CTO stderr] ${text.trim().slice(0, 300)}`);
    });

    child.stderr?.on('error', (err) => {
      console.error(`[CTO] stderr stream error:`, err.message);
    });

    return new Promise<string>((resolve, reject) => {
      child.on('close', async (code) => {
        this.currentProcess = null;

        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as Record<string, unknown>;
            this.handleStreamEvent(event, messageId, (text) => {
              fullText += text;
            }, (tokens) => {
              tokensUsed += tokens;
            });
          } catch { /* skip */ }
        }

        console.log(`[CTO] Process exited with code ${code} | Text: ${fullText.length} chars | Tokens: ${tokensUsed}`);

        if (code !== 0 && !fullText) {
          const errorMsg = stderrOutput || `Claude CLI exited with code ${code}`;
          console.error(`[CTO] Error: ${errorMsg.slice(0, 300)}`);
          eventBus.emitDashboard({ type: 'cto:error', data: { error: errorMsg, messageId } });
          reject(new Error(errorMsg));
          return;
        }

        // Store assistant message in Firestore (awaited to ensure persistence before task parsing)
        try {
          await chatMessages(threadId).add({
            thread_id: threadId,
            role: 'assistant',
            content: fullText,
            message_id: messageId,
            tokens_used: tokensUsed,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          console.error('[CTO] Failed to store response:', err);
        }

        if (tokensUsed > 0) {
          taskQueue.addTokens(tokensUsed);
        }

        eventBus.emitDashboard({ type: 'cto:done', data: { messageId, fullText, tokensUsed } });
        resolve(fullText);
      });

      child.on('error', (err) => {
        this.currentProcess = null;
        eventBus.emitDashboard({ type: 'cto:error', data: { error: err.message, messageId } });
        reject(err);
      });
    });
  }

  /** Gather fresh context from all integrations */
  private async gatherContext(): Promise<{
    notionSummary?: string;
    prSummary?: string;
    gcpHealth?: string;
    complianceSummary?: string;
  }> {
    const results: Record<string, string | undefined> = {};

    const [notionResult, gcpResult, complianceResult] = await Promise.allSettled([
      notionClient.isConfigured ? notionClient.getTicketSummary() : Promise.resolve(undefined),
      gcpClient.getHealthSummary().catch(() => undefined),
      vantaClient.isConfigured ? vantaClient.getComplianceSummary() : Promise.resolve(undefined),
    ]);

    if (notionResult.status === 'fulfilled') results.notionSummary = notionResult.value;
    if (gcpResult.status === 'fulfilled') results.gcpHealth = gcpResult.value;
    if (complianceResult.status === 'fulfilled') results.complianceSummary = complianceResult.value;

    try {
      results.prSummary = githubClient.getPRSummary();
    } catch { /* ignore */ }

    return results;
  }

  private handleStreamEvent(
    event: Record<string, unknown>,
    messageId: string,
    appendText: (text: string) => void,
    addTokens: (tokens: number) => void,
  ): void {
    switch (event.type) {
      // Claude CLI verbose stream-json: full assistant message
      case 'assistant': {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.content && Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              appendText(block.text);
              eventBus.emitDashboard({ type: 'cto:chunk', data: { text: block.text, messageId } });
            }
          }
        }
        // Extract token usage from assistant message
        const usage = msg?.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          addTokens((usage.input_tokens || 0) + (usage.output_tokens || 0));
        }
        break;
      }

      // Anthropic raw streaming: content_block_delta
      case 'content_block_delta': {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === 'text_delta' && delta.text) {
          appendText(delta.text as string);
          eventBus.emitDashboard({ type: 'cto:chunk', data: { text: delta.text as string, messageId } });
        }
        break;
      }

      // Result event — extract token count
      case 'result': {
        const totalTokens = (event.total_input_tokens as number || 0) + (event.total_output_tokens as number || 0);
        if (totalTokens > 0) addTokens(totalTokens);
        break;
      }
    }
  }

  abort(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM');
      this.currentProcess = null;
    }
  }

  async getConversationHistory(threadId?: string): Promise<Array<{ role: string; content: string; timestamp: string }>> {
    const tid = threadId || this.activeThreadId;
    const snap = await chatMessages(tid).orderBy('timestamp', 'asc').get();
    return snap.docs.map(doc => ({
      role: doc.data().role,
      content: doc.data().content,
      timestamp: doc.data().timestamp || '',
    }));
  }

  async getThreads(): Promise<Array<{ id: string; title: string; created_at: string; updated_at: string }>> {
    const snap = await collections.chatThreads.orderBy('updated_at', 'desc').get();
    return snap.docs.map(doc => ({
      id: doc.id,
      title: doc.data().title || 'New Chat',
      created_at: doc.data().created_at || '',
      updated_at: doc.data().updated_at || '',
    }));
  }

  async createThread(): Promise<{ id: string; title: string; created_at: string; updated_at: string }> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const threadData = { title: 'New Chat', created_at: now, updated_at: now };
    await collections.chatThreads.doc(id).set(threadData);
    this.activeThreadId = id;
    return { id, ...threadData };
  }

  async deleteThread(threadId: string): Promise<void> {
    // Delete all messages in the thread, paginated in chunks of 450 (Firestore limit is 500)
    const snap = await chatMessages(threadId).get();
    const CHUNK_SIZE = 450;
    const docs = snap.docs;

    for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
      const chunk = docs.slice(i, i + CHUNK_SIZE);
      const batch = collections.chatThreads.firestore.batch();
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      // Include the thread doc deletion in the last chunk
      if (i + CHUNK_SIZE >= docs.length) {
        batch.delete(collections.chatThreads.doc(threadId));
      }
      await batch.commit();
    }

    // If there were no messages, still delete the thread doc
    if (docs.length === 0) {
      await collections.chatThreads.doc(threadId).delete();
    }

    if (this.activeThreadId === threadId) {
      // Switch to the most recent remaining thread, or create a new one
      const remaining = await this.getThreads();
      if (remaining.length > 0) {
        this.activeThreadId = remaining[0].id;
      } else {
        const newThread = await this.createThread();
        this.activeThreadId = newThread.id;
      }
    }
  }

  /** Get the last assistant message for the active thread */
  async getLastAssistantMessage(threadId?: string): Promise<string | undefined> {
    const tid = threadId || this.activeThreadId;
    try {
      const snap = await chatMessages(tid)
        .where('role', '==', 'assistant')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      if (snap.empty) return undefined;
      return snap.docs[0]?.data()?.content;
    } catch (err) {
      // Fallback if composite index (role + timestamp) doesn't exist
      console.warn('[CTO] getLastAssistantMessage index error, using fallback:', (err as Error).message?.slice(0, 100));
      const snap = await chatMessages(tid).orderBy('timestamp', 'desc').limit(10).get();
      const assistantDoc = snap.docs.find(d => d.data()?.role === 'assistant');
      return assistantDoc?.data()?.content;
    }
  }
}

export const ctoSession = new CTOSession();
