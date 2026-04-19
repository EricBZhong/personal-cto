import { collections } from './firestore';
import { eventBus } from './event-bus';
import { taskQueue } from './task-queue';

export interface ErrorEvent {
  id?: string;
  source: string;       // 'frontend' | 'backend' | 'engineer' | 'cto-session'
  level: string;        // 'error' | 'warn' | 'fatal'
  message: string;
  stack?: string;
  context?: string;     // JSON stringified extra info (url, component, taskId, etc.)
  resolved?: boolean;
  auto_task_id?: string;
  created_at?: string;
}

/** Patterns that are noise or infra issues — don't auto-fix these */
const IGNORE_PATTERNS = [
  'React DevTools',
  'Download the React DevTools',
  '[HMR]',
  'Fast Refresh',
  'hydration',
  'Each child in a list should have a unique "key" prop',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'Auto-fix:',        // Prevent cascading auto-fix tasks
  'spawn',            // spawn ENOENT is an infra issue, not a code bug
  'ENOENT',
];

/** Dedup window: don't create tasks for the same error within this window */
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

class ErrorCollector {
  private recentErrors: Map<string, number> = new Map(); // fingerprint → timestamp

  /** Record an error event and optionally trigger auto-diagnosis */
  async record(error: ErrorEvent): Promise<{ id: string; taskCreated: boolean }> {
    // Skip noise
    if (IGNORE_PATTERNS.some(p => error.message.includes(p))) {
      return { id: '', taskCreated: false };
    }

    const now = new Date().toISOString();
    const docRef = collections.errorEvents.doc();
    const errorData = {
      source: error.source,
      level: error.level,
      message: error.message,
      stack: error.stack || null,
      context: error.context || null,
      resolved: false,
      auto_task_id: null,
      created_at: now,
    };

    docRef.set(errorData).catch(err =>
      console.error('[ErrorCollector] Failed to write to Firestore:', err)
    );

    const errorId = docRef.id;

    // Broadcast to dashboard
    eventBus.emitDashboard({
      type: 'system:status',
      data: {
        engineers: 0, // will be overridden by orchestrator
        activeTasks: 0,
        dailyTokens: taskQueue.getDailyTokens(),
      },
    });

    console.log(`[ErrorCollector] Recorded: [${error.source}] ${error.message.slice(0, 120)}`);

    // Auto-diagnose if it's actionable
    const taskCreated = await this.maybeAutoFix(error, errorId);

    return { id: errorId, taskCreated };
  }

  /** Check if we should auto-create a fix task for this error */
  private async maybeAutoFix(error: ErrorEvent, errorId: string): Promise<boolean> {
    // Only auto-fix actual errors, not warnings
    if (error.level === 'warn') return false;

    // Don't auto-fix errors from engineers (they're task failures, not code bugs)
    if (error.source === 'engineer') return false;

    // Dedup by error message prefix (first 60 chars) — prevents cascading retries
    const errorPrefix = error.message.slice(0, 60);
    const prefixFingerprint = `prefix:${error.source}:${errorPrefix}`;
    const lastPrefixSeen = this.recentErrors.get(prefixFingerprint);
    if (lastPrefixSeen && Date.now() - lastPrefixSeen < DEDUP_WINDOW_MS) {
      return false;
    }

    // Dedup: don't create multiple tasks for the same error
    const fingerprint = this.fingerprint(error);
    const lastSeen = this.recentErrors.get(fingerprint);
    if (lastSeen && Date.now() - lastSeen < DEDUP_WINDOW_MS) {
      return false;
    }
    this.recentErrors.set(fingerprint, Date.now());
    this.recentErrors.set(prefixFingerprint, Date.now());

    // Clean old fingerprints
    for (const [key, ts] of this.recentErrors) {
      if (Date.now() - ts > DEDUP_WINDOW_MS) this.recentErrors.delete(key);
    }

    // Create a diagnostic task
    const task = await taskQueue.createTask({
      title: `Auto-fix: ${error.message.slice(0, 60)}`,
      description: this.buildDiagnosticPrompt(error),
      branch: `fix/auto-${errorId.slice(0, 8)}`,
      model: 'sonnet',
      priority: 'P1',
      repo: error.source === 'frontend' ? 'cto-dashboard' : 'cto-dashboard',
    });

    // Link error to task
    collections.errorEvents.doc(errorId).update({ auto_task_id: task.id }).catch(() => {});

    console.log(`[ErrorCollector] Auto-created fix task: ${task.id.slice(0, 8)} for error ${errorId.slice(0, 8)}`);

    return true;
  }

  private buildDiagnosticPrompt(error: ErrorEvent): string {
    let prompt = `## Auto-Diagnosis Task

An error was detected in the CTO Dashboard and needs to be fixed.

### Error Details
- **Source**: ${error.source}
- **Level**: ${error.level}
- **Message**: ${error.message}
`;

    if (error.stack) {
      prompt += `\n### Stack Trace\n\`\`\`\n${error.stack}\n\`\`\`\n`;
    }

    if (error.context) {
      try {
        const ctx = JSON.parse(error.context);
        prompt += `\n### Context\n\`\`\`json\n${JSON.stringify(ctx, null, 2)}\n\`\`\`\n`;
      } catch {
        prompt += `\n### Context\n${error.context}\n`;
      }
    }

    prompt += `
### Instructions
1. Read the relevant source files based on the stack trace
2. Identify the root cause
3. Fix the bug
4. If there are related issues nearby (e.g., similar patterns that could break), fix those too
5. Run \`npx tsc --noEmit\` to verify no type errors
6. Commit with message: "fix: [description of what was fixed]"

### Known Patterns (from previous fixes)
- Claude CLI \`--print --output-format stream-json\` requires \`--verbose\` flag
- The correct budget flag is \`--max-budget-usd\`, NOT \`--max-cost-per-turn\`
- \`stdin\` for spawned Claude processes must be \`'ignore'\`, not \`'pipe'\`
- Stream events use \`type: 'assistant'\` with \`message.content[]\`, not \`content_block_delta\`
- Cost is at \`event.total_cost_usd\`, not \`event.result.cost_usd\`
- Config merge must filter empty strings to avoid overriding defaults
- \`engineer:spawned\` events must include all fields the frontend Engineer type expects
`;

    return prompt;
  }

  /** Create a fingerprint for deduplication */
  private fingerprint(error: ErrorEvent): string {
    // Use first line of stack or message
    const key = error.stack?.split('\n')[1]?.trim() || error.message;
    return `${error.source}:${key.slice(0, 100)}`;
  }

  /** Get all errors */
  async getRecent(limit = 50): Promise<ErrorEvent[]> {
    const snap = await collections.errorEvents.orderBy('created_at', 'desc').limit(limit).get();
    return snap.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        source: data.source || 'unknown',
        level: data.level || 'error',
        message: data.message || '',
        stack: data.stack || undefined,
        context: data.context || undefined,
        resolved: data.resolved || false,
        auto_task_id: data.auto_task_id || undefined,
        created_at: data.created_at || '',
      };
    });
  }

  /** Mark an error as resolved */
  async resolve(errorId: string): Promise<void> {
    await collections.errorEvents.doc(errorId).update({ resolved: true });
  }

  /** Get error counts by source */
  async getCounts(): Promise<Record<string, number>> {
    const snap = await collections.errorEvents.where('resolved', '==', false).get();
    const counts: Record<string, number> = {};
    for (const doc of snap.docs) {
      const data = doc.data();
      const source = data?.source || 'unknown';
      counts[source] = (counts[source] || 0) + 1;
    }
    return counts;
  }
}

export const errorCollector = new ErrorCollector();
