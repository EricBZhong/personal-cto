// Centralized Claude CLI authentication for subprocess spawning.
// Ensures subscription OAuth is used instead of API key billing.

import { execSync } from 'child_process';
import { getConfig } from './config';

let cachedOAuthToken: string | null = null;

/** Extract OAuth token from macOS Keychain (dev only) */
function extractFromKeychain(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const creds = JSON.parse(raw);
    return creds?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

/** Get the OAuth token from config, env, or Keychain (cached) */
export function getOAuthToken(): string | null {
  if (cachedOAuthToken) return cachedOAuthToken;

  const config = getConfig();
  // Priority: config field → env var → Keychain
  const token = config.claudeOauthToken
    || process.env.CLAUDE_OAUTH_TOKEN
    || process.env.CLAUDE_CODE_OAUTH_TOKEN
    || extractFromKeychain();

  if (token) cachedOAuthToken = token;
  return token;
}

/** Clear cached token (call if token is refreshed) */
export function clearTokenCache(): void {
  cachedOAuthToken = null;
}

/**
 * Build a clean env for Claude CLI subprocesses.
 * - Strips ANTHROPIC_API_KEY to prevent API billing override
 * - Sets CLAUDE_CODE_OAUTH_TOKEN for subscription auth
 * - Merges any extra env vars (GH_TOKEN, etc.)
 */
export function buildClaudeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Strip API key — it overrides OAuth in the auth precedence chain
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  // Inject OAuth token if available
  const oauthToken = getOAuthToken();
  if (oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
  }

  // Always set for non-interactive spawning
  env.DISABLE_INTERACTIVITY = '1';

  return { ...env, ...extra };
}
