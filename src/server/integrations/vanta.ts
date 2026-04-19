import { getConfig } from '../config';

interface VantaControl {
  id: string;
  name: string;
  category: string;
  status: 'passing' | 'failing' | 'not_started' | 'in_progress';
  description?: string;
  lastTested?: string;
  remediationNote?: string;
}

interface VantaEvidence {
  id: string;
  controlId: string;
  title: string;
  type: string;
  uploadedAt: string;
  status: 'valid' | 'expired' | 'pending';
}

// SOC 2 Trust Service Criteria categories
const TSC_CATEGORIES = [
  'Security',
  'Availability',
  'Confidentiality',
  'Processing Integrity',
  'Privacy',
] as const;

export class VantaClient {
  private get apiKey(): string | undefined {
    return getConfig().vantaApiKey;
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    if (!this.apiKey) throw new Error('Vanta API key not configured');

    const res = await fetch(`https://api.vanta.com/v1${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vanta API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  /** Get compliance overview */
  async getComplianceOverview(): Promise<{
    categories: Array<{
      name: string;
      passing: number;
      failing: number;
      total: number;
      pct: number;
    }>;
    overallScore: number;
  }> {
    if (!this.isConfigured) {
      // Return mock data structure for UI development
      return {
        categories: TSC_CATEGORIES.map(name => ({
          name,
          passing: 0,
          failing: 0,
          total: 0,
          pct: 0,
        })),
        overallScore: 0,
      };
    }

    try {
      const data = await this.request('/controls') as { data: Array<Record<string, unknown>> };
      const controls = data.data || [];

      const byCategory: Record<string, { passing: number; failing: number; total: number }> = {};
      for (const cat of TSC_CATEGORIES) {
        byCategory[cat] = { passing: 0, failing: 0, total: 0 };
      }

      for (const control of controls) {
        const cat = (control.category as string) || 'Security';
        if (!byCategory[cat]) byCategory[cat] = { passing: 0, failing: 0, total: 0 };
        byCategory[cat].total++;
        if (control.status === 'passing') byCategory[cat].passing++;
        else byCategory[cat].failing++;
      }

      const categories = Object.entries(byCategory).map(([name, stats]) => ({
        name,
        ...stats,
        pct: stats.total > 0 ? Math.round((stats.passing / stats.total) * 100) : 0,
      }));

      const totalPassing = categories.reduce((sum, c) => sum + c.passing, 0);
      const totalControls = categories.reduce((sum, c) => sum + c.total, 0);

      return {
        categories,
        overallScore: totalControls > 0 ? Math.round((totalPassing / totalControls) * 100) : 0,
      };
    } catch (err) {
      throw new Error(`Failed to get compliance overview: ${(err as Error).message}`);
    }
  }

  /** Get failing controls for CTO context */
  async getFailingControls(): Promise<VantaControl[]> {
    if (!this.isConfigured) return [];

    try {
      const data = await this.request('/controls?status=failing') as { data: Array<Record<string, unknown>> };
      return (data.data || []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        category: (c.category as string) || 'Security',
        status: 'failing' as const,
        description: c.description as string | undefined,
        lastTested: c.lastTested as string | undefined,
        remediationNote: c.remediationNote as string | undefined,
      }));
    } catch {
      return [];
    }
  }

  /** Get compliance summary for CTO system prompt */
  async getComplianceSummary(): Promise<string> {
    if (!this.isConfigured) return 'Vanta not configured. Set API key in Settings.';

    try {
      const overview = await this.getComplianceOverview();
      const failing = await this.getFailingControls();

      let summary = `SOC 2 Compliance Score: ${overview.overallScore}%\n`;
      summary += overview.categories
        .map(c => `  ${c.name}: ${c.pct}% (${c.passing}/${c.total})`)
        .join('\n');

      if (failing.length > 0) {
        summary += `\n\nFailing Controls (${failing.length}):\n`;
        summary += failing.slice(0, 10)
          .map(c => `  - [${c.category}] ${c.name}${c.remediationNote ? `: ${c.remediationNote}` : ''}`)
          .join('\n');
        if (failing.length > 10) {
          summary += `\n  ... and ${failing.length - 10} more`;
        }
      }

      return summary;
    } catch (err) {
      return `Vanta error: ${(err as Error).message}`;
    }
  }

  /** Upload evidence document */
  async uploadEvidence(controlId: string, title: string, content: string): Promise<VantaEvidence | null> {
    if (!this.isConfigured) return null;

    try {
      const data = await this.request('/evidence', {
        method: 'POST',
        body: JSON.stringify({
          controlId,
          title,
          content,
          type: 'document',
        }),
      }) as { data: Record<string, unknown> };

      return {
        id: data.data.id as string,
        controlId,
        title,
        type: 'document',
        uploadedAt: new Date().toISOString(),
        status: 'pending',
      };
    } catch {
      return null;
    }
  }
}

export const vantaClient = new VantaClient();
