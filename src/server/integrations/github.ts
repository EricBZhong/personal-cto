import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getConfig } from '../config';
import type { PullRequest, PRReview } from '../../types';

// Re-export for local use — the canonical interface lives in types.ts

interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export class GitHubClient {
  /** Build env with explicit GH_TOKEN/GITHUB_TOKEN for gh CLI commands */
  private buildEnv(): NodeJS.ProcessEnv {
    const config = getConfig();
    const ghToken = (config.githubToken || process.env.GH_TOKEN || '').trim();
    return {
      ...process.env,
      ...(ghToken ? { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken } : {}),
    };
  }

  private exec(cmd: string): string {
    try {
      const config = getConfig();
      // Use repo path as cwd only if it exists, otherwise use process.cwd()
      const fs = require('fs');
      const cwd = config.colbyRepoPath && fs.existsSync(config.colbyRepoPath)
        ? config.colbyRepoPath
        : process.cwd();
      return execSync(cmd, {
        cwd,
        env: this.buildEnv(),
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      const msg = (err as { stderr?: string }).stderr || (err as Error).message;
      throw new Error(`GitHub CLI error: ${msg}`);
    }
  }

  /** List open PRs */
  getOpenPRs(limit: number = 10): PullRequest[] {
    try {
      const json = this.exec(
        `gh pr list --state open --limit ${limit} --json number,title,state,author,headRefName,baseRefName,url,createdAt,updatedAt,additions,deletions,statusCheckRollup,reviewDecision`
      );
      const prs = JSON.parse(json);
      return prs.map((pr: Record<string, unknown>) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: (pr.author as Record<string, string>)?.login || 'unknown',
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        url: pr.url,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        checksStatus: this.summarizeChecks(pr.statusCheckRollup as unknown[]),
        reviewDecision: pr.reviewDecision || 'REVIEW_REQUIRED',
      }));
    } catch {
      return [];
    }
  }

  /** Get recent commits on a branch */
  getRecentCommits(branch: string = 'dev', limit: number = 10): CommitInfo[] {
    try {
      const json = this.exec(
        `gh api repos/{owner}/{repo}/commits?sha=${branch}&per_page=${limit} --jq '[.[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}]'`
      );
      return JSON.parse(json);
    } catch {
      return [];
    }
  }

  /** Get PR details (optionally from a specific repo) */
  getPRDetails(prNumber: number, repoSlug?: string): PullRequest | null {
    try {
      const repoFlag = repoSlug ? ` --repo ${repoSlug}` : '';
      const json = this.exec(
        `gh pr view ${prNumber}${repoFlag} --json number,title,state,author,headRefName,baseRefName,url,createdAt,updatedAt,additions,deletions,body,statusCheckRollup,reviewDecision`
      );
      const pr = JSON.parse(json);
      return {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.author?.login || 'unknown',
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        url: pr.url,
        body: pr.body || '',
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        checksStatus: this.summarizeChecks(pr.statusCheckRollup),
        reviewDecision: pr.reviewDecision,
      };
    } catch {
      return null;
    }
  }

  /** Get CI status for a branch */
  getCIStatus(branch: string = 'dev'): string {
    try {
      return this.exec(`gh run list --branch ${branch} --limit 3 --json status,conclusion,name,createdAt --jq '[.[] | "\\(.name): \\(.conclusion // .status)"] | join("\\n")'`);
    } catch {
      return 'Unable to fetch CI status';
    }
  }

  /** Get PR diff for review (optionally from a specific repo) */
  getPRDiff(prNumber: number, repoSlug?: string): string {
    try {
      const repoFlag = repoSlug ? ` --repo ${repoSlug}` : '';
      return this.exec(`gh pr diff ${prNumber}${repoFlag}`);
    } catch {
      return '';
    }
  }

  /** Summary for CTO context */
  getPRSummary(): string {
    const prs = this.getOpenPRs();
    if (prs.length === 0) return 'No open PRs.';

    return prs.map(pr =>
      `- #${pr.number}: ${pr.title} (${pr.branch} → ${pr.baseBranch}) by ${pr.author} [+${pr.additions}/-${pr.deletions}] ${pr.checksStatus || ''} ${pr.reviewDecision || ''}`
    ).join('\n');
  }

  /** Get repo stats */
  getRepoStats(): { branches: string[]; lastCommit: string } {
    try {
      const branches = this.exec('git branch -r --format="%(refname:short)"').split('\n').filter(Boolean);
      const lastCommit = this.exec('git log -1 --format="%h %s (%cr)"');
      return { branches, lastCommit };
    } catch {
      return { branches: [], lastCommit: 'unknown' };
    }
  }

  /** Submit a review on a PR (optionally on a specific repo) */
  submitPRReview(prNumber: number, body: string, event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES', repoSlug?: string): void {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gh-review-'));
    const bodyFile = join(tmpDir, 'body.md');
    const repoFlag = repoSlug ? ` --repo ${repoSlug}` : '';
    try {
      writeFileSync(bodyFile, body, 'utf-8');
      this.exec(`gh pr review ${prNumber}${repoFlag} --${event.toLowerCase().replace('_', '-')} --body-file "${bodyFile}"`);
    } finally {
      try { unlinkSync(bodyFile); } catch { /* ignore */ }
    }
  }

  /** Add a comment on a PR (optionally on a specific repo) */
  addPRComment(prNumber: number, body: string, repoSlug?: string): void {
    const tmpDir = mkdtempSync(join(tmpdir(), 'gh-comment-'));
    const bodyFile = join(tmpDir, 'body.md');
    const repoFlag = repoSlug ? ` --repo ${repoSlug}` : '';
    try {
      writeFileSync(bodyFile, body, 'utf-8');
      this.exec(`gh pr comment ${prNumber}${repoFlag} --body-file "${bodyFile}"`);
    } finally {
      try { unlinkSync(bodyFile); } catch { /* ignore */ }
    }
  }

  /** Merge a PR (squash by default, optionally on a specific repo) */
  mergePR(prNumber: number, method: 'squash' | 'merge' | 'rebase' = 'squash', repoSlug?: string): void {
    const repoFlag = repoSlug ? ` --repo ${repoSlug}` : '';
    this.exec(`gh pr merge ${prNumber}${repoFlag} --${method} --delete-branch`);
  }

  /** Get reviews for a PR (optionally from a specific repo) */
  getPRReviews(prNumber: number, repoSlug?: string): PRReview[] {
    try {
      const repoFlag = repoSlug ? ` --repo ${repoSlug}` : '';
      const json = this.exec(
        `gh pr view ${prNumber}${repoFlag} --json reviews --jq '.reviews'`
      );
      const reviews = JSON.parse(json);
      return (reviews || []).map((r: Record<string, unknown>) => ({
        id: r.id || 0,
        author: (r.author as Record<string, string>)?.login || 'unknown',
        state: r.state || 'COMMENTED',
        body: r.body || '',
        submittedAt: r.submittedAt || '',
      }));
    } catch {
      return [];
    }
  }

  /** Fetch a PR from any repo by full GitHub URL */
  getPRByUrl(url: string): { pr: PullRequest; repoSlug: string } | null {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error('Invalid GitHub PR URL');
    const [, repoSlug, prNumber] = match;

    const json = this.exec(
      `gh pr view ${prNumber} --repo ${repoSlug} --json number,title,state,author,headRefName,baseRefName,url,createdAt,updatedAt,additions,deletions,body,statusCheckRollup,reviewDecision`
    );
    const pr = JSON.parse(json);
    return {
      pr: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.author?.login || 'unknown',
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        url: pr.url,
        body: pr.body || '',
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        checksStatus: this.summarizeChecks(pr.statusCheckRollup),
        reviewDecision: pr.reviewDecision,
      },
      repoSlug,
    };
  }

  /** Extract repo slug from a GitHub PR URL (e.g. "owner/repo") */
  static extractRepoSlug(url: string): string | null {
    const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/);
    return match ? match[1] : null;
  }

  private summarizeChecks(checks: unknown[] | null): string {
    if (!checks || !Array.isArray(checks) || checks.length === 0) return 'no checks';
    const statuses = checks.map((c: unknown) => (c as Record<string, unknown>).conclusion || (c as Record<string, unknown>).status);
    if (statuses.every(s => s === 'SUCCESS')) return 'checks passing';
    if (statuses.some(s => s === 'FAILURE')) return 'checks failing';
    if (statuses.some(s => s === 'PENDING' || s === 'IN_PROGRESS')) return 'checks running';
    return 'checks unknown';
  }
}

export const githubClient = new GitHubClient();
