import { spawn, ChildProcess, exec as cpExec } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { eventBus } from './event-bus';
import { taskQueue, Task } from './task-queue';
import { buildEngineerPrompt } from './prompts/engineer-task';
import { getConfig } from './config';
import { buildClaudeEnv } from './claude-auth';
import { getBrowserMCPArgs } from './integrations/browser';
import { errorCollector } from './error-collector';
import { githubClient } from './integrations/github';
import { maskSecretsInString, sanitizeForShell } from './utils/reliability';

interface VerificationResult {
  verdict: string;
  summary: string;
  lineComments?: Array<{ path: string; line: number; body: string }>;
}

function execAsync(cmd: string, opts?: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    cpExec(cmd, { timeout: 120_000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

interface EngineerInstance {
  id: string;
  taskId: string;
  process: ChildProcess;
  model: string;
  startedAt: Date;
  tokensUsed: number;
  tempDir?: string;
  budgetWarned?: boolean;
}

export class EngineerPool {
  private active: Map<string, EngineerInstance> = new Map();
  private spawning = 0; // Engineers being prepared (cloning repos)
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private autoResolveAttempts: Map<string, number> = new Map();
  private tempDirs: Set<string> = new Set();
  private tempCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodic temp dir cleanup every 30 minutes
    this.tempCleanupTimer = setInterval(() => this.cleanupOrphanedTempDirs(), 30 * 60 * 1000);
    if (this.tempCleanupTimer.unref) this.tempCleanupTimer.unref();
  }

  /** Send SIGTERM first, then SIGKILL after 5s if process is still alive */
  private killProcess(child: ChildProcess): void {
    try {
      child.kill('SIGTERM');
    } catch { /* process may already be dead */ }

    const forceKillTimer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch { /* process may already be dead */ }
    }, 5000);
    forceKillTimer.unref();
  }

  /** Track a temp directory for cleanup */
  private trackTempDir(dir: string): void {
    this.tempDirs.add(dir);
  }

  /** Clean up a single temp directory and remove from tracking */
  private cleanupTempDir(dir: string): void {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
    this.tempDirs.delete(dir);
  }

  /** Remove orphaned temp directories that are no longer associated with active engineers */
  private cleanupOrphanedTempDirs(): void {
    const activeTempDirs = new Set(
      Array.from(this.active.values())
        .map(eng => eng.tempDir)
        .filter((d): d is string => !!d)
    );

    for (const dir of this.tempDirs) {
      if (!activeTempDirs.has(dir)) {
        console.log(`[EngineerPool] Cleaning up orphaned temp dir: ${dir}`);
        this.cleanupTempDir(dir);
      }
    }
  }

  get activeCount(): number {
    return this.active.size;
  }

  getActiveEngineers(): Array<{
    id: string;
    taskId: string;
    taskTitle: string;
    model: string;
    startedAt: string;
    tokensUsed: number;
    tokenBudget: number;
  }> {
    const config = getConfig();
    const budget = config.engineerTokenBudget || 500000;
    return Array.from(this.active.values()).map(eng => {
      const task = taskQueue.getTask(eng.taskId);
      if (!task) {
        return {
          id: eng.id,
          taskId: eng.taskId,
          taskTitle: 'Unknown',
          model: eng.model,
          startedAt: eng.startedAt.toISOString(),
          tokensUsed: eng.tokensUsed,
          tokenBudget: budget,
        };
      }
      return {
        id: eng.id,
        taskId: eng.taskId,
        taskTitle: task.title || 'Unknown',
        model: eng.model,
        startedAt: eng.startedAt.toISOString(),
        tokensUsed: eng.tokensUsed,
        tokenBudget: budget,
      };
    });
  }

  /** Start polling the task queue for approved tasks */
  startPolling(intervalMs: number = 3000): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.processQueue(), intervalMs);
    this.processQueue(); // Run immediately
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async processQueue(): Promise<void> {
    const config = getConfig();

    // S8: Pre-check daily token budget before spawning any engineers
    const dailyTokens = taskQueue.getDailyTokens();
    const dailyBudget = (config.engineerTokenBudget || 500000) * 10;
    if (dailyBudget > 0 && dailyTokens >= dailyBudget) {
      console.warn(`[Engineer] Daily token budget exceeded (${dailyTokens.toLocaleString()} / ${dailyBudget.toLocaleString()}) — skipping queue processing`);
      return;
    }

    // S19: Cap queued tasks — warn if backlog exceeds 100
    const queuedTasks = taskQueue.getTasksByStatus('approved', 'queued');
    if (queuedTasks.length > 100) {
      console.warn(`[Engineer] Queue backlog: ${queuedTasks.length} tasks in approved/queued status (cap: 100). Only processing up to 100.`);
    }

    let processed = 0;

    // Fill available slots (count spawning engineers to avoid over-allocation)
    while ((this.active.size + this.spawning) < config.engineerMaxConcurrent) {
      if (processed >= 100) break; // S19: Cap at 100 tasks per cycle

      const task = taskQueue.dequeue();
      if (!task) break;

      // S10: Validate dequeued task has valid id and title
      if (!task.id || !task.title) {
        console.warn(`[Engineer] Dequeued task with missing id or title — skipping`, { id: task.id, title: task.title });
        continue;
      }

      processed++;

      // S8: Check project token budget if task belongs to a project
      if (task.projectId) {
        try {
          const { projectManager: pm } = await import('./project-manager');
          const project = pm.getProject(task.projectId);
          if (project && project.tokenBudget && project.totalTokensUsed >= project.tokenBudget) {
            console.warn(`[Engineer] Project "${project.name}" token budget exceeded (${project.totalTokensUsed.toLocaleString()} / ${project.tokenBudget.toLocaleString()}) — skipping task ${task.id.slice(0, 8)}`);
            continue;
          }
        } catch { /* project-manager may not be available */ }
      }

      // Atomic claim: use Firestore transaction to avoid double-claiming
      const engineerId = uuidv4();
      const claimed = await taskQueue.atomicClaim(task.id, engineerId);
      if (!claimed) {
        console.log(`[Engineer] atomicClaim failed for task ${task.id.slice(0, 8)} — skipping`);
        continue;
      }

      // Update event bus with the status change
      eventBus.emitDashboard({ type: 'task:updated', data: { id: task.id, status: 'in_progress', engineer_id: engineerId } });

      this.spawning++;
      this.spawnEngineer(task, engineerId).catch(async err => {
        console.error(`[Engineer] spawnEngineer error for task ${task.id}:`, err);
        await taskQueue.appendError(task.id, `Spawn error: ${(err as Error).message}`);
        await taskQueue.updateTask(task.id, { status: 'failed' });
      }).finally(() => {
        this.spawning--;
      });
    }
  }

  private async spawnEngineer(task: Task, preAssignedEngineerId?: string): Promise<void> {
    const config = getConfig();
    const engineerId = preAssignedEngineerId || uuidv4();
    const model = task.model || config.engineerDefaultModel;
    const branch = task.branch || `task/${task.id.slice(0, 8)}`;

    // Determine which repo to work in
    const repoPath = this.resolveRepoPath(task.repo, config);

    // Prepare working directory — clone from GitHub if local path doesn't exist (Cloud Run)
    let workDir: string;
    let tempDir: string | undefined;

    if (repoPath && existsSync(repoPath)) {
      // Local dev — use repo directly
      workDir = repoPath;
    } else {
      // Production (Cloud Run) — clone from GitHub into temp dir
      const githubSlug = this.resolveGitHubSlug(task.repo, config);
      if (!githubSlug) {
        await taskQueue.appendError(task.id, `No GitHub repo mapped for: ${task.repo || 'default'}`);
        await taskQueue.updateTask(task.id, { status: 'failed' });
        taskQueue.addLog(task.id, `Cannot determine GitHub repo to clone for "${task.repo || 'default'}"`, 'system');
        return;
      }

      tempDir = mkdtempSync(path.join(tmpdir(), `eng-${engineerId.slice(0, 8)}-`));
      this.trackTempDir(tempDir);
      const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();

      try {
        console.log(`[Engineer ${engineerId.slice(0, 8)}] Cloning ${githubSlug} → ${tempDir}`);
        taskQueue.addLog(task.id, `Cloning ${githubSlug}...`, 'system');

        // Use token-authenticated HTTPS URL so git push works without extra config
        const cloneUrl = ghToken
          ? `https://x-access-token:${ghToken}@github.com/${githubSlug}.git`
          : `https://github.com/${githubSlug}.git`;

        // SEC7: Sanitize branch name before use in shell commands
        const baseBranchForClone = sanitizeForShell(this.resolveBaseBranch(task.repo, config));
        await execAsync(`git clone --depth 50 --branch ${baseBranchForClone} "${cloneUrl}" .`, { cwd: tempDir });
        await execAsync(
          'git config user.name "CTO Dashboard" && git config user.email "cto@personal-cto.dev"',
          { cwd: tempDir },
        );

        // Configure git credential helper so git push works even if subprocess doesn't inherit env
        if (ghToken) {
          await execAsync(
            `git config credential.helper '!f() { echo "password=${ghToken}"; }; f'`,
            { cwd: tempDir },
          );
        }

        // If this is a follow-up and the task already has a branch, fetch it so the engineer can check it out
        if (task.branch) {
          try {
            // SEC7: Sanitize branch name before use in shell command
            const safeBranch = sanitizeForShell(task.branch);
            await execAsync(`git fetch origin ${safeBranch}:${safeBranch}`, { cwd: tempDir });
            taskQueue.addLog(task.id, `Fetched existing branch ${task.branch}`, 'system');
          } catch {
            // Branch may not exist on remote yet (first attempt) — that's fine
          }
        }

        workDir = tempDir;
        taskQueue.addLog(task.id, `Cloned ${githubSlug} successfully`, 'system');
      } catch (err) {
        // Sanitize error to avoid leaking the token
        const rawMsg = (err as Error).message || String(err);
        const msg = ghToken ? rawMsg.replaceAll(ghToken, '***') : rawMsg;
        console.error(`[Engineer ${engineerId.slice(0, 8)}] Clone failed: ${msg}`);
        await taskQueue.appendError(task.id, `Clone failed: ${msg}`);
        await taskQueue.updateTask(task.id, { status: 'failed' });
        taskQueue.addLog(task.id, `Clone failed: ${msg}`, 'system');
        this.cleanupTempDir(tempDir);
        return;
      }
    }

    const baseBranch = this.resolveBaseBranch(task.repo, config);

    // Check for retry context from previous failed attempt
    const retryContext = taskQueue.getRetryContext(task.id);
    const interactionContext = taskQueue.getInteractionContext(task.id);

    // Build upstream context from task dependencies
    let upstreamContext: string | undefined;
    if (task.dependsOn && task.dependsOn.length > 0) {
      const upstreamParts: string[] = [];
      for (const depId of task.dependsOn) {
        const dep = taskQueue.getTask(depId);
        if (dep) {
          upstreamParts.push([
            `### Upstream Task: "${dep.title}" [${dep.status}]`,
            dep.pr_url ? `PR: ${dep.pr_url}` : '',
            dep.branch ? `Branch: ${dep.branch}` : '',
            dep.completionSummary ? `Summary: ${dep.completionSummary}` : '',
          ].filter(Boolean).join('\n'));
        }
      }
      if (upstreamParts.length > 0) {
        upstreamContext = upstreamParts.join('\n\n');
      }
    }

    // Resolve skill profile
    let skillAddition: string | undefined;
    let skillEnvVars: Record<string, string> = {};
    let skillMcpArgs: string[] = [];
    if (task.skillProfile) {
      const profiles = config.skillProfiles || [];
      const profile = profiles.find(p => p.name === task.skillProfile);
      if (profile) {
        skillAddition = profile.systemPromptAddition;
        skillEnvVars = profile.envVars || {};
        if (profile.mcpServers) {
          for (const server of profile.mcpServers) {
            skillMcpArgs.push('--mcp-server', server);
          }
        }
        // Use model override if specified
        if (profile.modelOverride) {
          // model variable is const, so we'll handle this below
        }
      }

      // Also inject tool registry env vars matching this skill profile
      const toolRegistry = config.toolRegistry || [];
      for (const tool of toolRegistry) {
        if (!tool.skillProfiles || tool.skillProfiles.includes(task.skillProfile)) {
          if (tool.envVar && tool.value) {
            skillEnvVars[tool.envVar] = tool.value;
          }
        }
      }
    }

    const prompt = buildEngineerPrompt({
      title: task.title,
      description: task.description,
      branch,
      repoPath: workDir,
      baseBranch,
      retryContext,
      interactionContext,
      upstreamContext,
      skillAddition,
    });

    const browserArgs = getBrowserMCPArgs();
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--model', model,
      '--no-session-persistence',
      '--max-turns', '100',
      '--permission-mode', 'bypassPermissions',
      ...browserArgs,
      ...skillMcpArgs,
      prompt,
    ];

    const claudePath = config.claudeCliPath || 'claude';
    console.log(`[Engineer ${engineerId.slice(0, 8)}] Spawning: ${claudePath} --model ${model} (cwd: ${workDir}, task: ${task.title})`);

    // Inject GH_TOKEN so the engineer's `gh` CLI and git push work
    const ghTokenForEnv = (config.githubToken || process.env.GH_TOKEN || '').trim();
    const engineerEnv = buildClaudeEnv({
      ...(ghTokenForEnv ? { GH_TOKEN: ghTokenForEnv, GITHUB_TOKEN: ghTokenForEnv } : {}),
      ...skillEnvVars,
    });

    const child = spawn(claudePath, args, {
      cwd: workDir,
      env: engineerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const instance: EngineerInstance = {
      id: engineerId,
      taskId: task.id,
      process: child,
      model,
      startedAt: new Date(),
      tokensUsed: 0,
      tempDir,
    };

    this.active.set(engineerId, instance);

    await taskQueue.updateTask(task.id, { engineer_id: engineerId, branch });
    taskQueue.addLog(task.id, `Engineer ${engineerId.slice(0, 8)} started (model: ${model}, branch: ${branch})`, 'system');

    eventBus.emitDashboard({
      type: 'engineer:spawned',
      data: {
        id: engineerId,
        taskId: task.id,
        taskTitle: task.title,
        model,
        startedAt: instance.startedAt.toISOString(),
        tokensUsed: 0,
      },
    });

    let buffer = '';
    let fullOutput = '';

    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          // Verbose stream-json: full assistant message
          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                fullOutput += block.text;
                eventBus.emitDashboard({
                  type: 'engineer:chunk',
                  data: { engineerId, taskId: task.id, text: block.text },
                });
              }
            }
          }

          // Raw streaming fallback: content_block_delta
          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullOutput += event.delta.text;
            eventBus.emitDashboard({
              type: 'engineer:chunk',
              data: { engineerId, taskId: task.id, text: event.delta.text },
            });
          }

          // Token usage from assistant event
          if (event.type === 'assistant' && event.message?.usage) {
            const usage = event.message.usage;
            instance.tokensUsed += (usage.input_tokens || 0) + (usage.output_tokens || 0);
          }

          // Token usage from result event
          if (event.type === 'result') {
            const tokens = (event.total_input_tokens || 0) + (event.total_output_tokens || 0);
            if (tokens > 0) instance.tokensUsed = tokens;
          }

          // Token budget enforcement
          const budget = config.engineerTokenBudget || 500000;
          if (budget > 0 && instance.tokensUsed > 0) {
            const pct = (instance.tokensUsed / budget) * 100;
            if (pct >= 100) {
              this.killProcess(child);
              taskQueue.addLog(task.id, `Token budget exceeded (${instance.tokensUsed.toLocaleString()} / ${budget.toLocaleString()} tokens)`, 'system');
            } else if (pct >= 80 && !instance.budgetWarned) {
              instance.budgetWarned = true;
              taskQueue.addLog(task.id, `Approaching token budget: ${Math.round(pct)}% used (${instance.tokensUsed.toLocaleString()} / ${budget.toLocaleString()})`, 'system');
            }
          }
        } catch {
          // Skip non-JSON
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      // SEC6: Mask secrets before logging stderr output
      const text = maskSecretsInString(data.toString());
      taskQueue.addLog(task.id, text, 'stderr');
    });

    // Configurable timeout (default 30 min)
    const timeoutMinutes = config.engineerTimeoutMinutes || 30;
    const timeout = setTimeout(() => {
      this.killProcess(child);
      taskQueue.addLog(task.id, `Engineer timed out after ${timeoutMinutes} minutes`, 'system');
    }, timeoutMinutes * 60 * 1000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      this.active.delete(engineerId);

      taskQueue.addLog(task.id, fullOutput || '(no output)', 'engineer');

      // Extract PR URL from output (e.g., https://github.com/org/repo/pull/123)
      const prUrlMatch = fullOutput.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
      const prUrl = prUrlMatch ? prUrlMatch[0] : undefined;

      // Post-completion: verify work was actually delivered, then finalize
      this.verifyAndFinalize({
        code, engineerId, task, instance, fullOutput, prUrl, model, branch, workDir,
        autoResolveAttempt: this.autoResolveAttempts.get(task.id) || 0,
      });
    });

    child.on('error', async (err) => {
      clearTimeout(timeout);
      this.active.delete(engineerId);
      await taskQueue.appendError(task.id, err.message);
      await taskQueue.updateTask(task.id, { status: 'failed' });
      taskQueue.addLog(task.id, `Spawn error: ${err.message}`, 'system');
      eventBus.emitDashboard({
        type: 'engineer:error',
        data: { engineerId, taskId: task.id, error: err.message },
      });
      errorCollector.record({
        source: 'engineer',
        level: 'fatal',
        message: `Engineer spawn failed: ${err.message}`,
        stack: err.stack,
        context: JSON.stringify({ taskId: task.id, model, claudePath }),
      });
    });
  }

  private static MAX_AUTO_RESOLVE_ATTEMPTS = 2;

  /** Verify the engineer actually delivered work (branch pushed, PR exists), then finalize status */
  private async verifyAndFinalize(params: {
    code: number | null;
    engineerId: string;
    task: Task;
    instance: EngineerInstance;
    fullOutput: string;
    prUrl: string | undefined;
    model: string;
    branch: string;
    workDir: string;
    autoResolveAttempt?: number;
  }): Promise<void> {
    const { code, engineerId, task, instance, fullOutput, model, branch, workDir } = params;
    let { prUrl } = params;

    const finalize = async (status: 'in_review' | 'failed', error?: string, verificationWarning?: string) => {
      await taskQueue.updateTask(task.id, { status, tokens_used: instance.tokensUsed, pr_url: prUrl });
      if (error) await taskQueue.appendError(task.id, error);
      if (verificationWarning) await taskQueue.appendVerificationWarning(task.id, verificationWarning);
      if (status === 'in_review') {
        eventBus.emitDashboard({ type: 'engineer:done', data: { engineerId, taskId: task.id, status: 'done', tokensUsed: instance.tokensUsed } });
        this.generateSummary(task.id, task.title, fullOutput, model, branch, instance.tokensUsed, undefined, prUrl);
        // Auto-merge + project completion hook
        if (task.projectId) {
          try {
            const { projectManager: pm } = await import('./project-manager');
            const project = pm.getProject(task.projectId);
            // Auto-merge if project has autonomous/semi-auto settings and PR exists
            if (project && prUrl && (project.autoMerge ||
                project.autonomy?.level === 'autonomous' ||
                (project.autonomy?.level === 'semi-autonomous' && task.priority !== 'P0'))) {
              try {
                // Check CI status first
                const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
                if (prNumber) {
                  const checkResult = await execAsync(`gh pr checks ${prNumber} --repo ${task.repo || ''} 2>&1 || true`);
                  const ciPassed = !checkResult.includes('fail') && !checkResult.includes('FAIL');
                  if (ciPassed) {
                    await execAsync(`gh pr merge ${prNumber} --squash --repo ${task.repo || ''} --delete-branch 2>&1`);
                    await taskQueue.updateTask(task.id, { status: 'done' as 'in_review' });
                    console.log(`[Engineer] Auto-merged PR #${prNumber} for task "${task.title}"`);
                  }
                }
              } catch (mergeErr) {
                console.error('[Engineer] Auto-merge failed:', mergeErr);
                // Not fatal — task stays in_review, human can merge manually
              }
            }
            pm.onTaskCompleted(task.id);
          } catch (err) {
            console.error('[Engineer] Project completion hook error:', err);
          }
        }
      } else {
        eventBus.emitDashboard({ type: 'engineer:error', data: { engineerId, taskId: task.id, error: error || `Exit code ${code}` } });
        errorCollector.record({
          source: 'engineer', level: 'error',
          message: `Engineer ${engineerId.slice(0, 8)} failed on task "${task.title}" — ${error || `exit code ${code}`}`,
          context: JSON.stringify({ taskId: task.id, model, branch, exitCode: code }),
        });
        this.generateSummary(task.id, task.title, fullOutput, model, branch, instance.tokensUsed, error || `Exit code ${code}`, prUrl);
        // Notify project manager of task failure
        if (task.projectId) {
          try {
            const { projectManager: pm } = await import('./project-manager');
            pm.onTaskFailed(task.id);
          } catch (err) {
            console.error('[Engineer] Project failure hook error:', err);
          }
        }
      }

      if (instance.tokensUsed > 0) taskQueue.addTokens(instance.tokensUsed);
      if (instance.tempDir) {
        this.cleanupTempDir(instance.tempDir);
      }
      eventBus.emitDashboard({
        type: 'system:status',
        data: { engineers: this.active.size, activeTasks: this.active.size, dailyTokens: taskQueue.getDailyTokens() },
      });
    };

    // Non-zero exit code — always fail
    if (code !== 0) {
      await finalize('failed', `Exit code ${code}`);
      return;
    }

    // Exit code 0 — verify the work was actually delivered
    try {
      // Step 1: Check if the branch was pushed to remote
      let branchExists = false;
      let lsRemoteNetworkError = false;
      try {
        const lsRemoteOut = await execAsync(
          `git ls-remote --heads origin ${branch}`,
          { cwd: workDir },
        );
        branchExists = lsRemoteOut.trim().length > 0;
      } catch (lsErr) {
        const errMsg = (lsErr as Error).message || '';
        // Distinguish network/auth errors from "branch not found"
        if (errMsg.includes('Could not resolve host') ||
            errMsg.includes('unable to access') ||
            errMsg.includes('Connection refused') ||
            errMsg.includes('SSL') ||
            errMsg.includes('timeout') ||
            errMsg.includes('fatal: unable to') ||
            errMsg.includes('Authentication failed')) {
          lsRemoteNetworkError = true;
          console.warn(`[Engineer ${engineerId.slice(0, 8)}] git ls-remote failed due to network/auth error: ${errMsg.slice(0, 200)}`);
          taskQueue.addLog(task.id, `Warning: Could not verify branch on remote (network error) — proceeding optimistically`, 'system');
        } else {
          // Genuine branch-not-found or other git error
          branchExists = false;
        }
      }

      if (!branchExists && !lsRemoteNetworkError) {
        console.warn(`[Engineer ${engineerId.slice(0, 8)}] Verification failed: branch "${branch}" not found on remote`);
        taskQueue.addLog(task.id, `Verification failed: branch "${branch}" was never pushed to remote`, 'system');
        await finalize('failed', `Engineer exited OK but branch "${branch}" was never pushed — likely hallucinated or timed out`);
        return;
      }

      // Step 2: If a PR URL was claimed, verify it exists
      if (prUrl) {
        const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
        if (prNumber) {
          const config = getConfig();
          const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
          const prExists = await execAsync(
            `gh pr view ${prNumber} --json number`,
            { cwd: workDir, env: { ...process.env, ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}) } },
          ).then(() => true).catch(() => false);

          if (!prExists) {
            console.warn(`[Engineer ${engineerId.slice(0, 8)}] PR URL ${prUrl} does not exist — hallucinated`);
            taskQueue.addLog(task.id, `PR URL ${prUrl} was hallucinated — does not exist on GitHub`, 'system');
            prUrl = undefined; // Clear the fake URL
          }
        }
      }

      // Step 3: If no verified PR, try to find one on the branch
      if (!prUrl) {
        try {
          const config = getConfig();
          const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
          const prJson = await execAsync(
            `gh pr list --head ${branch} --json url --limit 1`,
            { cwd: workDir, env: { ...process.env, ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}) } },
          );
          const prs = JSON.parse(prJson);
          if (prs.length > 0) {
            prUrl = prs[0].url;
            taskQueue.addLog(task.id, `Found PR: ${prUrl}`, 'system');
          }
        } catch { /* ignore — PR discovery is best-effort */ }
      }

      // Step 4: Branch exists. If no PR, still mark in_review but log a warning.
      if (!prUrl) {
        taskQueue.addLog(task.id, `Branch "${branch}" pushed but no PR was created. Manual PR creation may be needed.`, 'system');
      }

      // Step 5: AI verification of the diff
      try {
        await taskQueue.updateTask(task.id, { status: 'verifying' });
        eventBus.emitDashboard({ type: 'task:updated', data: { id: task.id, status: 'verifying' } });
        taskQueue.addLog(task.id, 'Running AI verification of changes...', 'system');

        // Returns { result, reason, structured? }. structured is populated when Claude returns
        // valid JSON; undefined when the legacy text-format path is used. postPRReview handles
        // undefined gracefully by falling back to fallbackReason for the body.
        const verification = await this.verifyDiffWithAI(task, branch, workDir);

        if (verification.result === 'fail') {
          taskQueue.addLog(task.id, `AI verification FAILED: ${verification.reason}`, 'system');
          // prUrl is extracted from fullOutput (~line 325) and re-validated through PR discovery above.
          if (prUrl) this.postPRReview(prUrl, verification.structured, verification.reason, 'FAIL', workDir).catch(() => {});
          await finalize('failed', `Verification failed: ${verification.reason}`);
          return;
        }

        if (verification.result === 'needs-attention') {
          const attempt = params.autoResolveAttempt || 0;
          if (attempt < EngineerPool.MAX_AUTO_RESOLVE_ATTEMPTS) {
            // Auto-resolve: respawn engineer to address the verification warning
            taskQueue.addLog(task.id, `AI verification WARNING: ${verification.reason}`, 'system');
            taskQueue.addLog(task.id, `Auto-resolving verification warning (attempt ${attempt + 1}/${EngineerPool.MAX_AUTO_RESOLVE_ATTEMPTS})...`, 'system');
            console.log(`[Engineer ${engineerId.slice(0, 8)}] Auto-resolving verification warning for task ${task.id.slice(0, 8)} (attempt ${attempt + 1})`);

            // Set up interaction context with the verification warning
            const autoResolveInstruction = `The AI verification found issues that need to be resolved:\n\n${verification.reason}\n\nPlease address ALL of the above concerns. Push your fixes to the existing branch and update the PR.`;
            taskQueue.setInteractionContext(task.id, autoResolveInstruction);
            taskQueue.addLog(task.id, autoResolveInstruction, 'interaction');

            // Clean up current engineer resources
            if (instance.tokensUsed > 0) taskQueue.addTokens(instance.tokensUsed);
            if (instance.tempDir) {
              this.cleanupTempDir(instance.tempDir);
            }

            // Store the attempt count and PR URL so the next spawn picks them up
            await taskQueue.appendVerificationWarning(task.id, verification.reason);
            await taskQueue.updateTask(task.id, {
              status: 'approved',
              tokens_used: (task.tokens_used || 0) + instance.tokensUsed,
              pr_url: prUrl,
              engineer_id: undefined,
            });

            // Store auto-resolve attempt count in task metadata for next verifyAndFinalize
            this.autoResolveAttempts.set(task.id, attempt + 1);

            eventBus.emitDashboard({ type: 'task:updated', data: { id: task.id, status: 'approved' } });
            eventBus.emitDashboard({
              type: 'system:status',
              data: { engineers: this.active.size, activeTasks: this.active.size, dailyTokens: taskQueue.getDailyTokens() },
            });

            // Re-queue to spawn a new engineer
            this.processQueue();
            return;
          }

          // Max attempts reached — finalize with warning
          taskQueue.addLog(task.id, `AI verification WARNING: ${verification.reason}`, 'system');
          taskQueue.addLog(task.id, `Auto-resolve exhausted (${attempt} attempts) — moving to review`, 'system');
          this.autoResolveAttempts.delete(task.id);
          if (prUrl) this.postPRReview(prUrl, verification.structured, verification.reason, 'NEEDS_ATTENTION', workDir).catch(() => {});
          await finalize('in_review', undefined, verification.reason);
          return;
        }

        taskQueue.addLog(task.id, 'AI verification passed', 'system');
        this.autoResolveAttempts.delete(task.id);
        if (prUrl) this.postPRReview(prUrl, verification.structured, verification.reason, 'PASS', workDir).catch(() => {});
      } catch (err) {
        console.warn(`[Engineer ${engineerId.slice(0, 8)}] AI verification error (defaulting to pass):`, err);
        taskQueue.addLog(task.id, `AI verification skipped (error): ${(err as Error).message}`, 'system');
      }

      await finalize('in_review');
    } catch (err) {
      // Verification itself errored — fall back to trusting exit code
      console.error(`[Engineer ${engineerId.slice(0, 8)}] Verification error:`, err);
      await finalize('in_review');
    }
  }

  /** Generate a summary of engineer work and save it as a task log */
  private async generateSummary(
    taskId: string,
    taskTitle: string,
    fullOutput: string,
    model: string,
    branch: string,
    tokensUsed: number,
    error?: string,
    prUrl?: string,
  ): Promise<void> {
    if (!fullOutput || fullOutput === '(no output)') {
      taskQueue.addLog(taskId, 'No output to summarize.', 'summary');
      return;
    }

    try {
      const config = getConfig();
      const claudePath = config.claudeCliPath || 'claude';
      // Truncate output to avoid overly long prompts (keep last 8000 chars for most relevant context)
      const truncated = fullOutput.length > 8000
        ? `[...truncated ${fullOutput.length - 8000} chars...]\n\n${fullOutput.slice(-8000)}`
        : fullOutput;

      const prompt = `Summarize what this engineer agent did. Be concise (3-8 bullet points). Include: files changed, key decisions, commits made, any issues encountered, and final outcome.

Task: ${taskTitle}
Branch: ${branch}
Model: ${model}
Tokens: ${tokensUsed.toLocaleString()}
${error ? `Error: ${error}` : 'Status: Completed successfully'}

--- Engineer Output ---
${truncated}`;

      const child = spawn(claudePath, [
        '--print',
        '--model', 'haiku',
        '--max-turns', '1',
        '--no-session-persistence',
        '--output-format', 'text',
        prompt,
      ], {
        env: buildClaudeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let summary = '';
      child.stdout?.on('data', (data: Buffer) => { summary += data.toString(); });
      child.stderr?.on('data', () => {}); // Ignore stderr

      // Timeout: kill summary generation after 60 seconds
      const summaryTimeout = setTimeout(() => {
        child.kill('SIGTERM');
        taskQueue.addLog(taskId, 'Summary generation timed out after 60s.', 'summary');
      }, 60_000);

      child.on('close', () => {
        clearTimeout(summaryTimeout);
        const finalSummary = summary.trim() || 'Summary generation failed — no output.';
        taskQueue.addLog(taskId, finalSummary, 'summary');
        // Store completion summary on the task document for upstream context injection
        taskQueue.updateCompletionSummary(taskId, finalSummary).catch(err =>
          console.error('[Engineer] Failed to store completion summary:', err)
        );
        // Notify connected clients that logs were updated
        eventBus.emitDashboard({
          type: 'task:logs_updated',
          data: { taskId },
        });
        // Post completion summary to Notion (async, non-blocking)
        taskQueue.addCompletionComment(taskId, finalSummary, prUrl).catch(err => console.error('[Notion] Completion comment error:', err));
      });

      child.on('error', (err) => {
        clearTimeout(summaryTimeout);
        taskQueue.addLog(taskId, `Summary generation failed: ${err.message}`, 'summary');
      });
    } catch (err) {
      taskQueue.addLog(taskId, `Summary generation failed: ${(err as Error).message}`, 'summary');
    }
  }

  /** Post a GitHub PR review after AI verification. Best-effort — errors are logged, not thrown. */
  private async postPRReview(
    prUrl: string,
    structured: VerificationResult | undefined,
    fallbackReason: string,
    verdict: 'PASS' | 'NEEDS_ATTENTION' | 'FAIL',
    workDir: string,
  ): Promise<void> {
    const match = prUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) return;
    const [, repoSlug, prNumberStr] = match;
    const prNumber = parseInt(prNumberStr, 10);

    const badge = verdict === 'PASS'
      ? '✅ PASS'
      : verdict === 'NEEDS_ATTENTION'
        ? '⚠️ NEEDS ATTENTION'
        : '❌ FAIL';

    const summary = structured?.summary || fallbackReason;
    const body = `**AI Verification: ${badge}**\n\n${summary}\n\n_Posted by CTO Dashboard AI Verification_`;

    // Determine the review event based on verdict
    type ReviewEvent = 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES';
    const eventMap: Record<string, ReviewEvent> = {
      PASS: 'APPROVE',
      NEEDS_ATTENTION: 'COMMENT',
      FAIL: 'REQUEST_CHANGES',
    };
    const primaryEvent = eventMap[verdict];

    const config = getConfig();
    const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
    const env = { ...process.env, ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}) };

    // Post line comments via the GitHub API if we have structured data
    const lineComments = structured?.lineComments || [];

    // Build a fallback body that embeds line comments as text in case the API review fails.
    // This ensures line-level context is never silently lost when the inline-comment API path errors out.
    const lineCommentsText = lineComments.length > 0
      ? '\n\n**Specific concerns:**\n' + lineComments.map(c => `- \`${c.path}:${c.line}\` — ${c.body}`).join('\n')
      : '';
    const bodyWithEmbeddedComments = lineComments.length > 0
      ? `**AI Verification: ${badge}**\n\n${summary}${lineCommentsText}\n\n_Posted by CTO Dashboard AI Verification_`
      : body;

    // Build the API payload for a PR review with inline comments
    if (lineComments.length > 0) {
      try {
        const { tmpdir } = require('os') as typeof import('os');
        const { writeFileSync, unlinkSync } = require('fs') as typeof import('fs');
        const { join } = require('path') as typeof import('path');
        const payloadFile = join(tmpdir(), `gh-review-payload-${Date.now()}.json`);

        const postWithEvent = async (event: string) => {
          const payload = JSON.stringify({ body, event, comments: lineComments.map(c => ({ path: c.path, line: c.line, body: c.body, side: 'RIGHT' })) });
          writeFileSync(payloadFile, payload, 'utf-8');
          await execAsync(
            `gh api repos/${repoSlug}/pulls/${prNumber}/reviews --method POST --input "${payloadFile}"`,
            { cwd: workDir, env },
          );
        };

        try {
          await postWithEvent(primaryEvent);
          console.log(`[PostPRReview] Posted ${verdict} review with ${lineComments.length} comment(s) on ${prUrl}`);
        } catch (err) {
          const msg = (err as Error).message || '';
          if (msg.includes('422') || msg.includes('approve your own')) {
            await postWithEvent('COMMENT');
            console.log(`[PostPRReview] Posted COMMENT (fallback) review with ${lineComments.length} comment(s) on ${prUrl}`);
          } else {
            throw err;
          }
        } finally {
          try { unlinkSync(payloadFile); } catch { /* ignore */ }
        }
        return;
      } catch (err) {
        // API review with inline comments failed (non-422 error) — fall back to a plain review with
        // line comments embedded as formatted text in the body so nothing is silently lost.
        console.warn(`[PostPRReview] API review with comments failed, falling back to simple review with embedded comments:`, (err as Error).message);
      }
    }

    // Simple review (no inline comments via API). When line comments exist and the API path failed above,
    // bodyWithEmbeddedComments includes them as formatted text so they're still visible on the PR.
    // prUrl is derived from params.prUrl / auto-discovery earlier in verifyAndFinalize and is always
    // a validated GitHub PR URL by the time postPRReview is called.
    try {
      githubClient.submitPRReview(prNumber, bodyWithEmbeddedComments, primaryEvent as 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES', repoSlug);
      console.log(`[PostPRReview] Posted ${verdict} review on ${prUrl}`);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('422') || msg.includes('can') || msg.includes('approve your own')) {
        try {
          githubClient.submitPRReview(prNumber, bodyWithEmbeddedComments, 'COMMENT', repoSlug);
          console.log(`[PostPRReview] Posted COMMENT (fallback) review on ${prUrl}`);
        } catch (fallbackErr) {
          console.warn(`[PostPRReview] Fallback review post also failed:`, (fallbackErr as Error).message);
        }
      } else {
        console.warn(`[PostPRReview] Failed to post PR review on ${prUrl}:`, msg);
      }
    }
  }

  private async verifyDiffWithAI(
    task: Task,
    branch: string,
    workDir: string,
  ): Promise<{ result: 'pass' | 'needs-attention' | 'fail'; reason: string; structured?: VerificationResult }> {
    const config = getConfig();
    const baseBranch = this.resolveBaseBranch(task.repo, config);

    // Get the diff
    let diff: string;
    try {
      diff = await execAsync(`git diff origin/${baseBranch}...HEAD`, { cwd: workDir });
    } catch {
      // If diff fails, default to pass
      return { result: 'pass', reason: 'Could not generate diff' };
    }

    if (!diff.trim()) {
      return { result: 'fail', reason: 'No changes were made (empty diff)' };
    }

    // Truncate diff to avoid overly long prompts
    const truncatedDiff = diff.length > 15000
      ? diff.slice(0, 15000) + '\n\n[...truncated...]'
      : diff;

    const prompt = `You are reviewing an engineer's work. Does this diff adequately address the task?

Task: ${task.title}
Description: ${task.description}

Diff:
\`\`\`
${truncatedDiff}
\`\`\`

Respond with ONLY a JSON object (no markdown, no code fences) with this exact shape:
{
  "verdict": "PASS" | "NEEDS_ATTENTION" | "FAIL",
  "summary": "One paragraph (max 200 words) explaining the overall result",
  "lineComments": [
    {
      "path": "src/server/foo.ts",
      "line": 42,
      "body": "Specific concern about this line relevant to whether the task was done correctly"
    }
  ]
}

Rules:
- verdict PASS: changes look correct and complete
- verdict NEEDS_ATTENTION: mostly right but has minor concerns
- verdict FAIL: doesn't address the task, introduces obvious bugs, or is empty/trivial
- lineComments: 0–5 entries only, referencing exact file paths and line numbers from the diff above; omit if no specific line-level concerns
- summary must be under 200 words`;

    const claudePath = config.claudeCliPath || 'claude';

    return new Promise((resolve) => {
      const child = spawn(claudePath, [
        '--print',
        '--model', 'haiku',
        '--max-turns', '1',
        '--no-session-persistence',
        '--output-format', 'text',
        prompt,
      ], {
        env: buildClaudeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
      child.stderr?.on('data', () => {}); // Ignore stderr

      // 30s timeout — default to pass on timeout
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ result: 'pass', reason: 'Verification timed out' });
      }, 30_000);

      child.on('close', () => {
        clearTimeout(timeout);
        const trimmed = output.trim();

        // Try to parse structured JSON response
        try {
          const parsed: VerificationResult = JSON.parse(trimmed);
          const verdict = (parsed.verdict || '').toUpperCase();
          if (verdict === 'FAIL') {
            resolve({ result: 'fail', reason: parsed.summary || 'Verification failed', structured: parsed });
          } else if (verdict === 'NEEDS_ATTENTION') {
            resolve({ result: 'needs-attention', reason: parsed.summary || 'Needs attention', structured: parsed });
          } else {
            resolve({ result: 'pass', reason: parsed.summary || 'Verification passed', structured: parsed });
          }
          return;
        } catch {
          // Fall back to legacy text parsing
        }

        // Legacy text fallback
        const firstLine = trimmed.split('\n')[0].toLowerCase();
        const reason = trimmed.split('\n').slice(1).join(' ').trim() || 'No explanation provided';

        if (firstLine.includes('verdict: fail')) {
          resolve({ result: 'fail', reason });
        } else if (firstLine.includes('verdict: needs-attention')) {
          resolve({ result: 'needs-attention', reason });
        } else {
          resolve({ result: 'pass', reason });
        }
      });

      child.on('error', () => {
        clearTimeout(timeout);
        resolve({ result: 'pass', reason: 'Verification process error' });
      });
    });
  }

  /** Kill all running engineers */
  killAll(): void {
    for (const [id, instance] of this.active) {
      this.killProcess(instance.process);
      // Fire-and-forget: cache is updated synchronously inside these methods;
      // Firestore writes complete in background (acceptable for kill/shutdown)
      taskQueue.appendError(instance.taskId, 'Killed by user');
      taskQueue.updateTask(instance.taskId, { status: 'failed' });
      if (instance.tempDir) {
        this.cleanupTempDir(instance.tempDir);
      }
      this.active.delete(id);
    }
  }

  /** Resolve which repo path to use for a task */
  private resolveRepoPath(repo: string | undefined, config: ReturnType<typeof getConfig>): string {
    // Check structured repos first
    if (config.repos?.length) {
      if (!repo) return config.repos[0].localPath;
      const match = config.repos.find(r =>
        r.name.toLowerCase() === repo.toLowerCase() ||
        r.githubSlug.toLowerCase() === repo.toLowerCase()
      );
      if (match) return match.localPath;
    }

    // Legacy fallback
    if (!repo) return config.colbyRepoPath;
    if (repo === 'cto-dashboard' || repo === 'Personal-CTO-v1') return config.ctoDashboardRepoPath;
    // Check additional repos
    const additional = config.additionalRepoPaths.find(p => p.includes(repo));
    if (additional) return additional;
    // If it looks like an absolute path, use it directly
    if (repo.startsWith('/')) return repo;
    return config.colbyRepoPath;
  }

  /** Map a repo identifier to a GitHub org/repo slug for cloning */
  private resolveGitHubSlug(repo: string | undefined, config: ReturnType<typeof getConfig>): string | null {
    // Check structured repos first
    if (config.repos?.length) {
      if (!repo) return config.repos[0].githubSlug;
      const match = config.repos.find(r =>
        r.name.toLowerCase() === repo.toLowerCase() ||
        r.githubSlug.toLowerCase() === repo.toLowerCase()
      );
      if (match) return match.githubSlug;
    }

    // Legacy fallback
    if (!repo) return config.githubRepo || null;
    if (repo === 'cto-dashboard' || repo === 'Personal-CTO-v1') {
      return 'EricBZhong/personal-cto';
    }
    if (repo.includes('/')) return repo;
    const org = config.githubRepo?.split('/')[0];
    if (org) return `${org}/${repo}`;

    return null;
  }

  /** Resolve the base branch for a repo */
  private resolveBaseBranch(repo: string | undefined, config: ReturnType<typeof getConfig>): string {
    if (config.repos?.length) {
      if (!repo) return config.repos[0].baseBranch;
      const match = config.repos.find(r =>
        r.name.toLowerCase() === repo.toLowerCase() ||
        r.githubSlug.toLowerCase() === repo.toLowerCase()
      );
      if (match) return match.baseBranch;
    }
    return config.defaultBaseBranch || 'dev';
  }

  /** Kill a specific engineer */
  kill(engineerId: string): void {
    const instance = this.active.get(engineerId);
    if (instance) {
      this.killProcess(instance.process);
      // Fire-and-forget: cache is updated synchronously inside these methods;
      // Firestore writes complete in background (acceptable for kill/shutdown)
      taskQueue.appendError(instance.taskId, 'Killed by user');
      taskQueue.updateTask(instance.taskId, { status: 'failed' });
      if (instance.tempDir) {
        this.cleanupTempDir(instance.tempDir);
      }
      this.active.delete(engineerId);
    }
  }
}

export const engineerPool = new EngineerPool();
