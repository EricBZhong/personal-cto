import { execSync } from 'child_process';
import { CircuitBreaker } from '../utils/reliability';

/** S25: Configurable timeout for GCP external calls (default 10s) */
const GCP_TIMEOUT_MS = parseInt(process.env.GCP_TIMEOUT_MS || '10000', 10);

interface ServiceHealth {
  name: string;
  project: string;
  region: string;
  url: string;
  status: 'healthy' | 'unhealthy' | 'unknown';
  latestRevision?: string;
  lastDeployed?: string;
}

interface LogEntry {
  timestamp: string;
  severity: string;
  message: string;
}

export class GCPClient {
  /** S25: Circuit breaker — 3 failures = 1min open */
  private breaker = new CircuitBreaker(3, 60_000, 'GCPClient');

  private exec(cmd: string, timeout: number = GCP_TIMEOUT_MS): string {
    // S25: Check circuit breaker before making external calls
    if (!this.breaker.canRequest()) {
      throw new Error(`GCP circuit breaker is open — skipping call (state: ${this.breaker.getState()})`);
    }

    try {
      const result = execSync(cmd, {
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      this.breaker.recordFailure();
      const msg = (err as { stderr?: string }).stderr || (err as Error).message;
      throw new Error(`GCP CLI error: ${msg}`);
    }
  }

  /** Check health of Cloud Run services */
  async getServiceHealth(): Promise<ServiceHealth[]> {
    const services = [
      { name: 'api-gateway-prod', project: 'my-gcp-project', region: 'us-central1' },
      { name: 'api-gateway-dev', project: 'my-gcp-project-dev', region: 'us-central1' },
      { name: 'observability-prod', project: 'my-gcp-project', region: 'us-central1' },
      { name: 'observability-dev', project: 'my-gcp-project-dev', region: 'us-central1' },
    ];

    const results: ServiceHealth[] = [];

    for (const svc of services) {
      try {
        const json = this.exec(
          `gcloud run services describe ${svc.name} --region=${svc.region} --project=${svc.project} --format=json`,
          GCP_TIMEOUT_MS
        );
        const data = JSON.parse(json);
        const url = data.status?.url || '';
        const revision = data.status?.latestReadyRevisionName || '';
        const conditions = data.status?.conditions || [];
        const ready = conditions.find((c: Record<string, string>) => c.type === 'Ready');

        results.push({
          name: svc.name,
          project: svc.project,
          region: svc.region,
          url,
          status: ready?.status === 'True' ? 'healthy' : 'unhealthy',
          latestRevision: revision,
          lastDeployed: data.metadata?.annotations?.['serving.knative.dev/creator'] ? undefined : undefined,
        });
      } catch {
        results.push({
          name: svc.name,
          project: svc.project,
          region: svc.region,
          url: '',
          status: 'unknown',
        });
      }
    }

    return results;
  }

  /** Get recent logs for a service */
  getRecentLogs(service: string, project: string, limit: number = 20): LogEntry[] {
    try {
      const output = this.exec(
        `gcloud run services logs read ${service} --region=us-central1 --project=${project} --limit=${limit} --format=json`,
        GCP_TIMEOUT_MS
      );
      const entries = JSON.parse(output);
      return entries.map((entry: Record<string, unknown>) => ({
        timestamp: entry.timestamp || '',
        severity: entry.severity || 'DEFAULT',
        message: (entry.textPayload || JSON.stringify(entry.jsonPayload) || '').toString().slice(0, 500),
      }));
    } catch {
      return [];
    }
  }

  /** Get health summary for CTO context */
  async getHealthSummary(): Promise<string> {
    try {
      const services = await this.getServiceHealth();
      return services.map(s =>
        `- ${s.name} (${s.project}): ${s.status}${s.latestRevision ? ` [${s.latestRevision}]` : ''}`
      ).join('\n');
    } catch (err) {
      return `GCP health check failed: ${(err as Error).message}`;
    }
  }

  /** Check if a health endpoint responds */
  async pingHealth(url: string): Promise<{ ok: boolean; latencyMs: number }> {
    if (!this.breaker.canRequest()) {
      return { ok: false, latencyMs: 0 };
    }

    const start = Date.now();
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(GCP_TIMEOUT_MS) });
      this.breaker.recordSuccess();
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch {
      this.breaker.recordFailure();
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  /** Quick health ping for dashboard header */
  async pingAllServices(): Promise<Array<{ name: string; ok: boolean; latencyMs: number }>> {
    const endpoints = [
      { name: 'Prod API', url: process.env.PROD_API_URL || 'https://api.example.com' },
      { name: 'Dev API', url: process.env.DEV_API_URL || 'https://api-dev.example.com' },
    ];

    return Promise.all(
      endpoints.map(async (ep) => {
        const result = await this.pingHealth(ep.url);
        return { name: ep.name, ...result };
      })
    );
  }
}

export const gcpClient = new GCPClient();
