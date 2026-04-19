/**
 * Shared reliability utilities for server-side code.
 * Used across task-queue, engineer-pool, orchestrator, and integrations.
 */

/** Retry a Firestore write operation with exponential backoff */
export async function retryFirestoreWrite<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 500,
  label = 'FirestoreWrite',
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[${label}] Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms:`, (err as Error).message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

/** Wrap a promise with a timeout */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'Operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Sliding-window rate limiter keyed by a string identifier (e.g., IP or WS connection ID) */
export class SlidingWindowRateLimiter {
  private windows: Map<string, number[]> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {
    // Periodic cleanup of stale keys
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /** Returns true if the request is allowed, false if rate-limited */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }
}

/** Strip dangerous characters from strings used in shell commands */
export function sanitizeForShell(input: string): string {
  // Allow only alphanumeric, dash, underscore, dot, forward-slash
  return input.replace(/[^a-zA-Z0-9\-_./]/g, '');
}

/** Known WebSocket message types that the orchestrator handles */
const KNOWN_WS_TYPES = new Set([
  'chat:send', 'chat:abort', 'chat:history', 'chat:clear',
  'thread:list', 'thread:create', 'thread:switch', 'thread:delete',
  'task:approve', 'task:approve_by_title', 'task:reject', 'task:reject_by_title',
  'task:cancel', 'task:list', 'task:get', 'task:logs', 'task:update_priority',
  'task:retry', 'task:interact', 'task:approve_all', 'task:set_status',
  'engineer:list', 'engineer:kill', 'engineer:kill_all',
  'config:get', 'config:update', 'config:revisions', 'config:rollback',
  'status:get', 'health:ping',
  'notion:tickets', 'github:prs', 'github:pr_diff', 'gcp:health', 'gcp:logs',
  'compliance:overview', 'compliance:failing',
  'analytics:cost', 'analytics:usage', 'analytics:activity',
  'error:report', 'error:list', 'error:resolve',
  'analysis:run',
  'dogfood:run', 'dogfood:run_with_analysis',
  'eval:list', 'eval:create', 'eval:delete', 'eval:run', 'eval:generate', 'eval:history', 'eval:seed', 'eval:import',
  'slack:status', 'slack:get_conversations', 'slack:get_queue', 'slack:reconnect', 'slack:post_update', 'slack:send_message',
  'pr:list', 'pr:add', 'pr:detail', 'pr:review', 'pr:approve', 'pr:merge', 'pr:comment',
  'checkin:trigger', 'checkin:get_report', 'checkin:list_reports',
  'project:list', 'project:get', 'project:create', 'project:update', 'project:advance', 'project:archive', 'project:pause', 'project:resume',
  'memory:list', 'memory:add', 'memory:delete', 'memory:search',
  'deploy:trigger', 'deploy:history',
]);

/** Validate a WebSocket message has a known type and proper shape */
export function validateWsMessage(raw: string): { valid: boolean; type?: string; payload?: Record<string, unknown>; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, error: 'Invalid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'Message must be a JSON object' };
  }

  const msg = parsed as Record<string, unknown>;

  if (typeof msg.type !== 'string' || !msg.type) {
    return { valid: false, error: 'Missing or invalid "type" field' };
  }

  if (!KNOWN_WS_TYPES.has(msg.type)) {
    return { valid: false, type: msg.type, error: `Unknown message type: ${msg.type}` };
  }

  if (msg.payload !== undefined && (typeof msg.payload !== 'object' || msg.payload === null || Array.isArray(msg.payload))) {
    return { valid: false, type: msg.type, error: 'Payload must be a JSON object' };
  }

  return { valid: true, type: msg.type, payload: msg.payload as Record<string, unknown> | undefined };
}

/** Regex patterns that match common secret/token formats */
const SECRET_PATTERNS = [
  /xoxb-[a-zA-Z0-9\-]+/g,         // Slack bot token
  /xoxp-[a-zA-Z0-9\-]+/g,         // Slack user token
  /xapp-[a-zA-Z0-9\-]+/g,         // Slack app token
  /ghp_[a-zA-Z0-9]{36,}/g,        // GitHub personal access token
  /gho_[a-zA-Z0-9]{36,}/g,        // GitHub OAuth token
  /github_pat_[a-zA-Z0-9_]{82,}/g, // GitHub fine-grained PAT
  /sk-[a-zA-Z0-9]{20,}/g,         // OpenAI/Anthropic API key
  /ntn_[a-zA-Z0-9]{40,}/g,        // Notion API key
  /AC[a-f0-9]{32}/g,              // Twilio Account SID
  /SK[a-f0-9]{32}/g,              // Twilio Auth Token / API key
];

/** Mask secrets in a string to prevent accidental leaking in logs */
export function maskSecretsInString(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, '***');
  }
  return masked;
}

/** Circuit breaker for external service calls */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private failureThreshold: number = 3,
    private resetTimeMs: number = 60_000,
    private label: string = 'CircuitBreaker',
  ) {}

  /** Check if the circuit allows a request. Returns true if allowed. */
  canRequest(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    // half-open: allow one request to test
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      console.warn(`[${this.label}] Circuit breaker OPEN after ${this.failures} failures — pausing for ${this.resetTimeMs / 1000}s`);
    }
  }

  getState(): string {
    return this.state;
  }
}
