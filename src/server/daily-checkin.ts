import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from './config';
import { buildClaudeEnv } from './claude-auth';
import { taskQueue } from './task-queue';
import { engineerPool } from './engineer-pool';
import { githubClient } from './integrations/github';
import { slackBot } from './integrations/slack';
import { collections, FieldValue } from './firestore';
import { buildCTOSystemPrompt } from './prompts/cto-system';
import { projectManager } from './project-manager';
import { memoryStore } from './memory-store';
import type { DailyReport } from '../types';

const STARTUP_DELAY_MS = 30_000; // 30 seconds after start

export class DailyCheckin {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private startupTimeoutId: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.intervalId) return;
    const config = getConfig();
    const intervalMinutes = config.checkinIntervalMinutes || 120;
    const intervalMs = intervalMinutes * 60 * 1000;
    console.log(`[PeriodicCheckin] Started — will run every ${intervalMinutes} minutes`);

    // Run first check-in after a short delay to let Slack connect
    this.startupTimeoutId = setTimeout(() => {
      this.runPeriodicCheckin().catch(err => {
        console.error('[PeriodicCheckin] Startup check-in error:', err);
      });
    }, STARTUP_DELAY_MS);

    // Then run at configured interval
    this.intervalId = setInterval(() => {
      this.runPeriodicCheckin().catch(err => {
        console.error('[PeriodicCheckin] Error:', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.startupTimeoutId) {
      clearTimeout(this.startupTimeoutId);
      this.startupTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Periodic status check-in — runs at configured interval automatically. */
  async runPeriodicCheckin(): Promise<DailyReport> {
    console.log('[PeriodicCheckin] Running periodic check-in...');

    const config = getConfig();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const intervalMs = (config.checkinIntervalMinutes || 120) * 60 * 1000;

    // Check autonomy timeouts for all projects
    await projectManager.checkAutonomyTimeouts();

    // Advance any active projects that may have completed phases
    const activeProjects = projectManager.getAllProjects().filter(p => p.status === 'active');
    for (const project of activeProjects) {
      await projectManager.advanceProject(project.id);
    }

    // 1. Gather stats
    const allTasks = await taskQueue.getAllTasksAsync();
    const twoHoursAgo = now.getTime() - intervalMs;
    const todayStart = new Date(today + 'T00:00:00Z').getTime();

    const recentCompleted = allTasks.filter(t =>
      t.status === 'done' && new Date(t.updated_at).getTime() >= twoHoursAgo
    );
    const recentFailed = allTasks.filter(t =>
      t.status === 'failed' && new Date(t.updated_at).getTime() >= twoHoursAgo
    );
    const inProgress = allTasks.filter(t =>
      t.status === 'in_progress' || t.status === 'verifying'
    );
    const dailyTokens = await taskQueue.getDailyTokensAsync();
    const activeEngineers = engineerPool.activeCount;

    let openPRCount = 0;
    try {
      openPRCount = githubClient.getOpenPRs().length;
    } catch { /* ignore */ }

    // Detect stale tasks (in_progress/in_review with no update in >24h)
    const staleThreshold = now.getTime() - 24 * 60 * 60 * 1000;
    const staleTasks = allTasks.filter(t =>
      (t.status === 'in_progress' || t.status === 'in_review' || t.status === 'verifying') &&
      new Date(t.updated_at).getTime() < staleThreshold
    );

    const stats = {
      tasksCompleted: recentCompleted.length,
      tasksFailed: recentFailed.length,
      staleTasks: staleTasks.length,
      dailyTokens,
      activeEngineers,
      openPRs: openPRCount,
    };

    // 2. Build prompt for CTO
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const prompt = `Periodic status check-in (${timeStr}). Please provide a brief update:

1. **Recent activity**: What happened in the last 2 hours — completed tasks, failures, notable events
2. **Current state**: What's in progress right now
3. **Recommendations**: 1-2 specific tasks to queue up next based on priorities

Stats (last 2 hours):
- Tasks completed: ${stats.tasksCompleted}
- Tasks failed: ${stats.tasksFailed}
- Currently in progress: ${inProgress.length}
- Tokens used today: ${stats.dailyTokens.toLocaleString()}
- Active engineers: ${stats.activeEngineers}
- Open PRs: ${stats.openPRs}
- Stale tasks (no update in 24h): ${stats.staleTasks}

Recently completed: ${recentCompleted.map(t => `"${t.title}" (${t.priority})`).join(', ') || 'None'}
Recently failed: ${recentFailed.map(t => `"${t.title}": ${t.error || 'unknown error'}`).join(', ') || 'None'}
In progress: ${inProgress.map(t => `"${t.title}"`).join(', ') || 'None'}
${staleTasks.length > 0 ? `Stale tasks: ${staleTasks.map(t => `"${t.title}" (${t.status}, last update: ${new Date(t.updated_at).toLocaleString()})`).join(', ')}` : ''}

Keep it concise. You can suggest new tasks using <task_assignment> blocks.`;

    // 3. Spawn CTO for the check-in
    let summary = '';
    try {
      summary = await this.spawnCTOForCheckin(prompt);
    } catch (err) {
      const errorMsg = (err as Error).message;
      console.error('[PeriodicCheckin] CTO spawn failed:', errorMsg);
      summary = `Periodic check-in failed: ${errorMsg}`;
    }

    // 4. Parse task assignments from the response
    const suggestedTasks: string[] = [];
    const taskRegex = /<task_assignment>\s*(\{[\s\S]*?\})\s*<\/task_assignment>/g;
    let match;
    while ((match = taskRegex.exec(summary)) !== null) {
      try {
        const assignment = JSON.parse(match[1]);
        await taskQueue.createTask({
          title: assignment.title,
          description: assignment.description,
          branch: assignment.branch,
          repo: assignment.repo,
          model: assignment.model,
          priority: assignment.priority,
        });
        suggestedTasks.push(assignment.title);
      } catch { /* ignore parse errors */ }
    }

    // 5. Store report in Firestore
    const reportId = uuidv4();
    const report: DailyReport = {
      id: reportId,
      date: today,
      summary,
      stats,
      suggestedTasks,
      slackPosted: false,
      createdAt: new Date().toISOString(),
    };

    await collections.dailyReports.doc(reportId).set({
      ...report,
      created_at: FieldValue.serverTimestamp(),
    });

    // 6. Post to Slack
    if (slackBot.isConnected && config.slackUpdateChannel) {
      const slackMsg = this.formatSlackSummary(report);
      const posted = await slackBot.postMessage(config.slackUpdateChannel, slackMsg);
      if (posted) {
        report.slackPosted = true;
        await collections.dailyReports.doc(reportId).update({ slackPosted: true });
      }
    }

    console.log('[PeriodicCheckin] Complete. Tasks suggested:', suggestedTasks.length);

    return report;
  }

  /** Manual check-in trigger (backward compat for checkin:trigger WS command). */
  async runDailyCheckin(): Promise<DailyReport> {
    console.log('[PeriodicCheckin] Manual check-in triggered');
    return this.runPeriodicCheckin();
  }

  private formatSlackSummary(report: DailyReport): string {
    const { stats } = report;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    let msg = `*CTO Status Update — ${report.date} ${timeStr}*\n\n`;
    msg += `*Stats:* ${stats.tasksCompleted} completed, ${stats.tasksFailed} failed, ${stats.dailyTokens.toLocaleString()} tokens today, ${stats.openPRs} open PRs`;
    if ((stats.staleTasks || 0) > 0) msg += `, ${stats.staleTasks} stale`;
    msg += `\n\n`;

    // Clean summary (strip task_assignment blocks)
    const cleanSummary = report.summary
      .replace(/<task_assignment>[\s\S]*?<\/task_assignment>/g, '')
      .trim()
      .slice(0, 2000);
    msg += cleanSummary;

    if (report.suggestedTasks.length > 0) {
      msg += `\n\n*Suggested tasks:*\n`;
      for (const t of report.suggestedTasks) {
        msg += `  • ${t}\n`;
      }
    }

    return msg;
  }

  private spawnCTOForCheckin(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const config = getConfig();
      const claudePath = config.claudeCliPath || 'claude';
      const fs = require('fs');
      const cwd = config.colbyRepoPath && fs.existsSync(config.colbyRepoPath)
        ? config.colbyRepoPath
        : process.cwd();

      const systemPrompt = buildCTOSystemPrompt({
        repoPath: config.colbyRepoPath,
        ctoDashboardPath: config.ctoDashboardRepoPath,
        dailyTokens: taskQueue.getDailyTokens(),
        engineerCount: engineerPool.activeCount,
        maxEngineers: config.engineerMaxConcurrent,
      });

      const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
      const child = spawn(claudePath, [
        '--print',
        '--output-format', 'stream-json',
        '--model', config.ctoModel,
        '--max-turns', '10',
        '--system-prompt', systemPrompt,
        prompt,
      ], {
        cwd,
        env: buildClaudeEnv({
          ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let fullText = '';
      let buffer = '';

      child.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'assistant' && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  fullText += block.text;
                }
              }
            } else if (event.type === 'content_block_delta' && event.delta?.text) {
              fullText += event.delta.text;
            }
          } catch { /* ignore parse errors */ }
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        console.error('[PeriodicCheckin] stderr:', data.toString().slice(0, 500));
      });

      child.on('close', (code) => {
        if (code !== 0 && !fullText) {
          reject(new Error(`CTO process exited with code ${code}`));
        } else {
          resolve(fullText);
        }
      });

      child.on('error', reject);
    });
  }
}

export const dailyCheckin = new DailyCheckin();
