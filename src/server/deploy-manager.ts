import { v4 as uuidv4 } from 'uuid';
import { exec as cpExec } from 'child_process';
import { collections, toISOString } from './firestore';
import { eventBus } from './event-bus';
import { getConfig } from './config';
import { slackBot } from './integrations/slack';
import type { DeployRecord, DeployTarget } from '../types';

function execAsync(cmd: string, opts?: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    cpExec(cmd, { timeout: 300_000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

function docToDeploy(id: string, data: FirebaseFirestore.DocumentData): DeployRecord {
  return {
    id,
    projectId: data.projectId || undefined,
    repoName: data.repoName || '',
    status: data.status || 'building',
    commitSha: data.commitSha || undefined,
    imageUrl: data.imageUrl || undefined,
    serviceUrl: data.serviceUrl || undefined,
    error: data.error || undefined,
    startedAt: toISOString(data.startedAt),
    completedAt: data.completedAt ? toISOString(data.completedAt) : undefined,
  };
}

export class DeployManager {
  /** Deploy a service to Cloud Run */
  async deploy(params: {
    repoName: string;
    projectId?: string;
    target?: DeployTarget;
  }): Promise<DeployRecord> {
    const config = getConfig();
    const target = params.target || config.deployTargets?.find(t => t.repoName === params.repoName);

    if (!target) {
      throw new Error(`No deploy target configured for repo "${params.repoName}"`);
    }

    const deployId = uuidv4();
    const now = new Date().toISOString();
    const deployData = {
      projectId: params.projectId || null,
      repoName: params.repoName,
      status: 'building' as const,
      startedAt: now,
    };

    const deploy = docToDeploy(deployId, deployData);
    await collections.deploys.doc(deployId).set(deployData);
    eventBus.emitDashboard({ type: 'deploy:started', data: { deploy } });
    this.notifySlack(`Deploy started for ${params.repoName} (${target.serviceName})`);

    // Run deploy pipeline async
    this.runDeployPipeline(deployId, target, params.projectId).catch(err => {
      console.error('[DeployManager] Deploy pipeline failed:', err);
    });

    return deploy;
  }

  private async runDeployPipeline(deployId: string, target: DeployTarget, projectId?: string): Promise<void> {
    const config = getConfig();
    const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
    const imageTag = `gcr.io/${target.gcpProject}/${target.serviceName}:latest`;

    try {
      // Step 1: Build Docker image
      await this.updateDeployStatus(deployId, 'building', 'Building Docker image...');
      const dockerfilePath = target.dockerfilePath || '.';

      // Resolve repo path for building
      const repo = config.repos?.find(r => r.name === target.repoName);
      const repoPath = repo?.localPath || config.colbyRepoPath;

      await execAsync(`docker build -t ${imageTag} ${dockerfilePath}`, { cwd: repoPath });

      // Step 2: Push to GCR
      await this.updateDeployStatus(deployId, 'pushing', 'Pushing to Container Registry...');
      await execAsync(`docker push ${imageTag}`);

      // Step 3: Deploy to Cloud Run
      await this.updateDeployStatus(deployId, 'deploying', 'Deploying to Cloud Run...');
      const deployOutput = await execAsync(
        `gcloud run deploy ${target.serviceName} ` +
        `--image ${imageTag} ` +
        `--platform managed ` +
        `--region ${target.gcpRegion} ` +
        `--project ${target.gcpProject} ` +
        `--allow-unauthenticated ` +
        `--format json`,
      );

      let serviceUrl: string | undefined;
      try {
        const result = JSON.parse(deployOutput);
        serviceUrl = result.status?.url || result.status?.address?.url;
      } catch { /* ignore parse error */ }

      // Step 4: Health check
      if (target.healthCheckUrl || serviceUrl) {
        await this.updateDeployStatus(deployId, 'verifying', 'Running health check...');
        const healthUrl = target.healthCheckUrl || serviceUrl;
        if (healthUrl) {
          try {
            await execAsync(`curl -sf --max-time 30 "${healthUrl}"`);
          } catch {
            console.warn(`[DeployManager] Health check failed for ${healthUrl}`);
          }
        }
      }

      // Success
      const successUpdate: Record<string, string> = {
        status: 'succeeded',
        imageUrl: imageTag,
        completedAt: new Date().toISOString(),
      };
      if (serviceUrl) successUpdate.serviceUrl = serviceUrl;
      await collections.deploys.doc(deployId).update(successUpdate);

      const finalDeploy = docToDeploy(deployId, {
        repoName: target.repoName,
        projectId,
        status: 'succeeded',
        imageUrl: imageTag,
        serviceUrl,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      eventBus.emitDashboard({ type: 'deploy:completed', data: { deploy: finalDeploy } });
      this.notifySlack(`Deploy succeeded for ${target.serviceName}${serviceUrl ? ` — ${serviceUrl}` : ''}`);

    } catch (err) {
      const errorMsg = (err as Error).message;
      await collections.deploys.doc(deployId).update({
        status: 'failed',
        error: errorMsg,
        completedAt: new Date().toISOString(),
      });

      const failedDeploy = docToDeploy(deployId, {
        repoName: target.repoName,
        projectId,
        status: 'failed',
        error: errorMsg,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      eventBus.emitDashboard({ type: 'deploy:completed', data: { deploy: failedDeploy } });
      this.notifySlack(`Deploy FAILED for ${target.serviceName}: ${errorMsg.slice(0, 200)}`);
    }
  }

  private async updateDeployStatus(deployId: string, status: string, message?: string): Promise<void> {
    await collections.deploys.doc(deployId).update({ status });
    eventBus.emitDashboard({ type: 'deploy:progress', data: { deployId, status, message } });
  }

  /** Deploy for a completed project */
  async deployForProject(projectId: string, repoName?: string): Promise<void> {
    const config = getConfig();
    const target = config.deployTargets?.find(t => t.repoName === (repoName || config.repos?.[0]?.name));
    if (!target) {
      console.warn(`[DeployManager] No deploy target for project ${projectId}`);
      return;
    }
    await this.deploy({ repoName: target.repoName, projectId, target });
  }

  /** Create a new GitHub repo */
  async createRepo(params: {
    name: string;
    description?: string;
    isPrivate?: boolean;
    template?: string;
  }): Promise<{ repoSlug: string; cloneUrl: string }> {
    const config = getConfig();
    const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
    const env = { ...process.env, ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}) };

    const visibility = params.isPrivate ? '--private' : '--public';
    const templateArg = params.template ? `--template ${params.template}` : '';
    const descArg = params.description ? `--description "${params.description.replace(/"/g, '\\"')}"` : '';

    const output = await execAsync(
      `gh repo create ${params.name} ${visibility} ${templateArg} ${descArg} --confirm --json nameWithOwner,sshUrl,url`,
      { env },
    );

    const result = JSON.parse(output);
    const repoSlug = result.nameWithOwner;
    const cloneUrl = result.url;

    console.log(`[DeployManager] Created repo: ${repoSlug}`);
    this.notifySlack(`Created new repo: ${repoSlug}`);

    return { repoSlug, cloneUrl };
  }

  /** Get deploy history */
  async getHistory(limit: number = 20): Promise<DeployRecord[]> {
    const snap = await collections.deploys.orderBy('startedAt', 'desc').limit(limit).get();
    return snap.docs.map(doc => docToDeploy(doc.id, doc.data()));
  }

  private notifySlack(message: string): void {
    const config = getConfig();
    if (slackBot.isConnected && config.slackUpdateChannel) {
      slackBot.postMessage(config.slackUpdateChannel, message).catch(() => {});
    }
  }
}

export const deployManager = new DeployManager();
