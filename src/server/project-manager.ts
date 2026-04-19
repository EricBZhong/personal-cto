import { v4 as uuidv4 } from 'uuid';
import { collections, toISOString } from './firestore';
import { eventBus } from './event-bus';
import { taskQueue } from './task-queue';
import { getConfig } from './config';
import { buildClaudeEnv } from './claude-auth';
import { buildCTOSystemPrompt } from './prompts/cto-system';
import { engineerPool } from './engineer-pool';
import { slackBot } from './integrations/slack';
import { spawn } from 'child_process';
import type { Project, ProjectPhase, AutonomySettings } from '../types';

function docToProject(id: string, data: FirebaseFirestore.DocumentData): Project {
  return {
    id,
    name: data.name || '',
    description: data.description || '',
    goal: data.goal || '',
    status: data.status || 'draft',
    phases: Array.isArray(data.phases) ? data.phases : [],
    autonomy: data.autonomy || { level: 'supervised' },
    autoApprove: data.autoApprove ?? false,
    autoMerge: data.autoMerge ?? false,
    autoDeploy: data.autoDeploy ?? false,
    repo: data.repo || undefined,
    tokenBudget: data.tokenBudget || undefined,
    created_at: toISOString(data.created_at),
    updated_at: toISOString(data.updated_at),
    completed_at: data.completed_at ? toISOString(data.completed_at) : undefined,
    totalTokensUsed: data.totalTokensUsed || 0,
    totalTasksCompleted: data.totalTasksCompleted || 0,
    totalTasksFailed: data.totalTasksFailed || 0,
    consecutiveFailures: data.consecutiveFailures || 0,
  };
}

export class ProjectManager {
  private _cache: Map<string, Project> = new Map();

  async createProject(params: {
    name: string;
    description: string;
    goal: string;
    phases?: ProjectPhase[];
    autonomy?: AutonomySettings;
    autoApprove?: boolean;
    autoMerge?: boolean;
    autoDeploy?: boolean;
    repo?: string;
    tokenBudget?: number;
  }): Promise<Project> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const projectData = {
      name: params.name,
      description: params.description,
      goal: params.goal,
      status: params.phases?.length ? 'active' : 'planning',
      phases: params.phases || [],
      autonomy: params.autonomy || { level: 'supervised' },
      autoApprove: params.autoApprove ?? false,
      autoMerge: params.autoMerge ?? false,
      autoDeploy: params.autoDeploy ?? false,
      repo: params.repo || null,
      tokenBudget: params.tokenBudget || null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      totalTokensUsed: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      consecutiveFailures: 0,
    };

    const project = docToProject(id, projectData);
    this._cache.set(id, project);

    try {
      await collections.projects.doc(id).set(projectData);
    } catch (err) {
      console.error('[ProjectManager] Failed to write project to Firestore:', err);
    }

    eventBus.emitDashboard({ type: 'project:created', data: { project } });
    console.log(`[ProjectManager] Created project "${params.name}" (${id.slice(0, 8)})`);

    return project;
  }

  getProject(id: string): Project | null {
    return this._cache.get(id) || null;
  }

  async getProjectAsync(id: string): Promise<Project | null> {
    const doc = await collections.projects.doc(id).get();
    if (!doc.exists) return null;
    const project = docToProject(doc.id, doc.data()!);
    this._cache.set(id, project);
    return project;
  }

  getAllProjects(): Project[] {
    return Array.from(this._cache.values())
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  async getAllProjectsAsync(): Promise<Project[]> {
    const snap = await collections.projects.orderBy('updated_at', 'desc').get();
    const projects = snap.docs.map(doc => docToProject(doc.id, doc.data()));
    for (const p of projects) this._cache.set(p.id, p);
    return projects;
  }

  async updateProject(id: string, updates: Partial<Project>): Promise<Project | null> {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) fields[key] = value;
    }
    fields.updated_at = new Date().toISOString();

    const cached = this._cache.get(id);
    if (cached) {
      Object.assign(cached, fields);
      this._cache.set(id, cached);
    }

    try {
      await collections.projects.doc(id).update(fields);
    } catch (err) {
      console.error('[ProjectManager] Failed to update project:', err);
    }

    const project = this.getProject(id);
    if (project) {
      eventBus.emitDashboard({ type: 'project:updated', data: { project } });
    }
    return project;
  }

  /** Check if current phase is complete; advance to next phase if so */
  async advanceProject(projectId: string): Promise<void> {
    const project = await this.getProjectAsync(projectId);
    if (!project || project.status !== 'active') return;

    // Check token budget safeguard
    if (project.tokenBudget && project.totalTokensUsed >= project.tokenBudget) {
      console.log(`[ProjectManager] Project "${project.name}" exceeded token budget — pausing`);
      await this.updateProject(projectId, { status: 'paused' });
      eventBus.emitDashboard({ type: 'project:paused', data: { projectId, reason: 'Token budget exceeded' } });
      this.notifySlack(`Project "${project.name}" paused: Token budget exceeded (${project.totalTokensUsed.toLocaleString()} / ${project.tokenBudget.toLocaleString()})`);
      return;
    }

    // Check consecutive failure threshold safeguard
    const failureThreshold = project.autonomy.pauseOnFailureCount ?? 3;
    if (failureThreshold > 0 && project.consecutiveFailures >= failureThreshold) {
      console.log(`[ProjectManager] Project "${project.name}" hit ${project.consecutiveFailures} consecutive failures — pausing`);
      await this.updateProject(projectId, { status: 'paused' });
      eventBus.emitDashboard({ type: 'project:paused', data: { projectId, reason: `${project.consecutiveFailures} consecutive failures` } });
      this.notifySlack(`Project "${project.name}" paused: ${project.consecutiveFailures} consecutive task failures. Awaiting input.`);
      return;
    }

    // Find the current active phase
    const activePhase = project.phases.find(p => p.status === 'active');
    if (!activePhase) {
      // No active phase — check if we can activate the next pending phase
      await this.activateNextPhase(project);
      return;
    }

    // Check if all tasks in the active phase are done
    const phaseTasks = taskQueue.getTasksByPhase(projectId, activePhase.id);
    if (phaseTasks.length === 0) return; // Phase has no tasks yet

    const allDone = phaseTasks.every(t => t.status === 'done');
    const anyFailed = phaseTasks.some(t => t.status === 'failed');

    if (anyFailed) {
      // Don't advance if there are failures — they need to be resolved
      return;
    }

    if (!allDone) return; // Still in progress

    // Mark current phase as completed
    activePhase.status = 'completed';
    activePhase.completed_at = new Date().toISOString();

    await this.updateProject(projectId, {
      phases: project.phases,
    });

    console.log(`[ProjectManager] Phase "${activePhase.name}" completed for project "${project.name}"`);
    eventBus.emitDashboard({ type: 'project:advanced', data: { projectId, phaseId: activePhase.id, phaseName: activePhase.name } });

    // Notify
    this.notifySlack(`Project "${project.name}": Phase "${activePhase.name}" completed.`);

    // Check autonomousUntilPhase safeguard
    if (project.autonomy.autonomousUntilPhase === activePhase.id) {
      console.log(`[ProjectManager] Autonomy expired after phase "${activePhase.name}" — reverting to supervised`);
      await this.updateProject(projectId, {
        autonomy: { ...project.autonomy, level: 'supervised', autonomousUntilPhase: undefined },
      });
      this.notifySlack(`Project "${project.name}": Autonomy expired after phase "${activePhase.name}". Reverting to supervised mode.`);
    }

    // Try to activate next phase
    await this.activateNextPhase(project);
  }

  private async activateNextPhase(project: Project): Promise<void> {
    const nextPhase = project.phases.find(p => {
      if (p.status !== 'pending') return false;
      // Check phase dependencies
      if (p.dependsOnPhases.length > 0) {
        return p.dependsOnPhases.every(depId => {
          const dep = project.phases.find(pp => pp.id === depId);
          return dep?.status === 'completed';
        });
      }
      return true;
    });

    if (!nextPhase) {
      // All phases done — project is complete
      const allComplete = project.phases.every(p => p.status === 'completed');
      if (allComplete && project.phases.length > 0) {
        await this.updateProject(project.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
        eventBus.emitDashboard({ type: 'project:completed', data: { projectId: project.id } });
        this.notifySlack(`Project "${project.name}" is complete! All ${project.phases.length} phases done.`);

        // Auto-deploy if configured
        if (project.autoDeploy) {
          try {
            const { deployManager } = require('./deploy-manager');
            deployManager.deployForProject(project.id, project.repo);
          } catch (err) {
            console.error('[ProjectManager] Auto-deploy failed:', err);
          }
        }
      }
      return;
    }

    // Check if phase requires human approval
    if (nextPhase.requiresApproval && project.autonomy.level !== 'autonomous') {
      this.notifySlack(`Project "${project.name}": Phase "${nextPhase.name}" requires approval before starting. Reply to approve.`);
      return;
    }

    // Activate the next phase
    nextPhase.status = 'active';
    await this.updateProject(project.id, { phases: project.phases });

    console.log(`[ProjectManager] Activating phase "${nextPhase.name}" for project "${project.name}"`);
    this.notifySlack(`Project "${project.name}": Starting Phase "${nextPhase.name}" (${nextPhase.taskIds.length || 0} tasks).`);

    // If the phase has no tasks yet, spawn CTO to plan them
    const phaseTasks = taskQueue.getTasksByPhase(project.id, nextPhase.id);
    if (phaseTasks.length === 0) {
      this.spawnCTOForPhasePlanning(project, nextPhase);
    }
  }

  /** Called when a task is completed — updates project stats and triggers phase advancement */
  async onTaskCompleted(taskId: string): Promise<void> {
    // S16: Read fresh task data from Firestore instead of relying solely on cache
    const task = await taskQueue.getTaskAsync(taskId);
    if (!task?.projectId) return;

    // S16: Read fresh project data from Firestore for accurate counters
    const project = await this.getProjectAsync(task.projectId);
    if (!project) return;

    await this.updateProject(task.projectId, {
      totalTasksCompleted: project.totalTasksCompleted + 1,
      totalTokensUsed: project.totalTokensUsed + (task.tokens_used || 0),
      consecutiveFailures: 0, // Reset on success
    });

    // Per-task Slack notification if configured
    if (project.autonomy.notifyOnEveryTask) {
      this.notifySlack(`Project "${project.name}": Task "${task.title}" completed.`);
    }

    // Trigger phase advancement check
    await this.advanceProject(task.projectId);
  }

  /** Called when a task fails — updates project stats */
  async onTaskFailed(taskId: string): Promise<void> {
    // S16: Read fresh task data from Firestore instead of relying solely on cache
    const task = await taskQueue.getTaskAsync(taskId);
    if (!task?.projectId) return;

    // S16: Read fresh project data from Firestore for accurate counters
    const project = await this.getProjectAsync(task.projectId);
    if (!project) return;

    await this.updateProject(task.projectId, {
      totalTasksFailed: project.totalTasksFailed + 1,
      consecutiveFailures: project.consecutiveFailures + 1,
    });

    // Per-task Slack notification if configured
    if (project.autonomy.notifyOnEveryTask) {
      this.notifySlack(`Project "${project.name}": Task "${task.title}" failed.`);
    }

    // Check if we should pause due to failure threshold
    await this.advanceProject(task.projectId);
  }

  /** Spawn CTO to plan tasks for a new phase */
  private spawnCTOForPhasePlanning(project: Project, phase: ProjectPhase): void {
    const config = getConfig();
    const claudePath = config.claudeCliPath || 'claude';
    const fs = require('fs');
    const cwd = config.colbyRepoPath && fs.existsSync(config.colbyRepoPath)
      ? config.colbyRepoPath
      : process.cwd();

    const completedPhaseSummaries = project.phases
      .filter(p => p.status === 'completed')
      .map(p => {
        const tasks = taskQueue.getTasksByPhase(project.id, p.id);
        const summaries = tasks
          .filter(t => t.completionSummary)
          .map(t => `  - "${t.title}": ${t.completionSummary}`)
          .join('\n');
        return `Phase "${p.name}": Completed\n${summaries || '  (no summaries available)'}`;
      })
      .join('\n\n');

    const prompt = `You are planning the next phase of an autonomous project.

## Project: ${project.name}
Goal: ${project.goal}
Description: ${project.description}
Repo: ${project.repo || 'default'}

## Current Phase: ${phase.name}
Description: ${phase.description}

## Completed Phases
${completedPhaseSummaries || 'None yet — this is the first phase.'}

## Instructions
Create specific, actionable task assignments for this phase. Each task should be independently executable by an engineer agent. Consider dependencies between tasks within this phase — use the "dependsOn" field with task titles of upstream tasks.

For each task, output a <task_assignment> block with these fields:
- title, description, branch, model, priority, repo
- projectId: "${project.id}"
- phaseId: "${phase.id}"
- dependsOn: [] (array of task titles this task depends on, within this phase)
- skillProfile: "general" | "frontend" | "backend" | "infra" (optional)

Create 2-5 tasks for this phase. Be specific about what each engineer should do.`;

    const systemPrompt = buildCTOSystemPrompt({
      repoPath: config.colbyRepoPath,
      ctoDashboardPath: config.ctoDashboardRepoPath,
      repos: config.repos,
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
              if (block.type === 'text' && block.text) fullText += block.text;
            }
          } else if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text;
          }
        } catch { /* ignore */ }
      }
    });

    child.stderr?.on('data', () => {}); // Ignore

    child.on('close', async () => {
      if (!fullText) return;

      // Parse task assignments and create them
      const regex = /<task_assignment>\s*(\{[\s\S]*?\})\s*<\/task_assignment>/g;
      let match;
      const createdTasks: { title: string; id: string }[] = [];

      while ((match = regex.exec(fullText)) !== null) {
        try {
          const assignment = JSON.parse(match[1]);
          const task = await taskQueue.createTask({
            title: assignment.title,
            description: assignment.description,
            branch: assignment.branch,
            repo: assignment.repo || project.repo,
            model: assignment.model,
            priority: assignment.priority,
            projectId: project.id,
            phaseId: phase.id,
            skillProfile: assignment.skillProfile,
            status: project.autoApprove ? 'approved' : 'suggested',
          });

          createdTasks.push({ title: task.title, id: task.id });

          // Add to phase taskIds
          if (!phase.taskIds.includes(task.id)) {
            phase.taskIds.push(task.id);
          }
        } catch (err) {
          console.error('[ProjectManager] Failed to parse phase task:', err);
        }
      }

      // Resolve dependsOn by title → id
      for (const created of createdTasks) {
        const task = taskQueue.getTask(created.id);
        if (task?.dependsOn) {
          // dependsOn was parsed as titles — resolve to IDs
          const resolvedDeps = (task.dependsOn as string[]).map(depTitle => {
            const dep = createdTasks.find(c => c.title === depTitle);
            return dep?.id || depTitle;
          }).filter(Boolean);
          if (resolvedDeps.length > 0) {
            await taskQueue.updateTask(created.id, {} as Parameters<typeof taskQueue.updateTask>[1]);
            // Directly update dependsOn in Firestore since it's not in the standard updateTask signature
            const cached = taskQueue.getTask(created.id);
            if (cached) {
              cached.dependsOn = resolvedDeps;
            }
            await collections.tasks.doc(created.id).update({ dependsOn: resolvedDeps });
          }
        }
      }

      // Update project with new phase taskIds
      await this.updateProject(project.id, { phases: project.phases });

      console.log(`[ProjectManager] Phase "${phase.name}" planned: ${createdTasks.length} tasks created`);

      // If auto-approve, trigger queue processing
      if (project.autoApprove) {
        engineerPool.processQueue();
      }
    });
  }

  /** Post a notification to Slack */
  private notifySlack(message: string): void {
    const config = getConfig();
    if (slackBot.isConnected && config.slackUpdateChannel) {
      slackBot.postMessage(config.slackUpdateChannel, message).catch(() => {});
    }
  }

  /** Get project stats summary for CTO context injection */
  getActiveProjectsSummary(): string | undefined {
    const active = Array.from(this._cache.values())
      .filter(p => p.status === 'active' || p.status === 'planning');

    if (active.length === 0) return undefined;

    return active.map(p => {
      const activePhase = p.phases.find(ph => ph.status === 'active');
      const completedPhases = p.phases.filter(ph => ph.status === 'completed').length;
      const totalPhases = p.phases.length;
      const tasks = taskQueue.getTasksByProject(p.id);
      const doneTasks = tasks.filter(t => t.status === 'done').length;
      const failedTasks = tasks.filter(t => t.status === 'failed').length;
      const inProgressTasks = tasks.filter(t => ['in_progress', 'verifying', 'approved'].includes(t.status)).length;

      return `- **${p.name}** [${p.status}] — ${completedPhases}/${totalPhases} phases, ${doneTasks} done, ${inProgressTasks} active, ${failedTasks} failed${activePhase ? ` — Current: "${activePhase.name}"` : ''} — Autonomy: ${p.autonomy.level}`;
    }).join('\n');
  }

  /** Hydrate cache from Firestore */
  async hydrate(): Promise<void> {
    try {
      const projects = await this.getAllProjectsAsync();
      console.log(`[ProjectManager] Hydrated ${projects.length} projects`);
    } catch (err) {
      console.error('[ProjectManager] Failed to hydrate:', err);
    }
  }

  /** Check autonomy timeouts — call from periodic check-in */
  async checkAutonomyTimeouts(): Promise<void> {
    const now = new Date().getTime();
    for (const project of this._cache.values()) {
      if (project.autonomy.autonomousUntil) {
        const until = new Date(project.autonomy.autonomousUntil).getTime();
        if (now >= until) {
          console.log(`[ProjectManager] Autonomy timeout for project "${project.name}" — reverting to supervised`);
          await this.updateProject(project.id, {
            autonomy: { ...project.autonomy, level: 'supervised', autonomousUntil: undefined },
          });
          this.notifySlack(`Autonomous mode expired for project "${project.name}". Reverting to supervised.`);
        }
      }
    }
  }
}

export const projectManager = new ProjectManager();
