import { db, collections } from './firestore';

export interface RepoConfig {
  name: string;         // Display name & CTO task identifier (e.g., "LeadGen")
  localPath: string;    // Local filesystem path for dev
  githubSlug: string;   // GitHub org/repo (e.g., "EricBZhong/leadgen")
  baseBranch: string;   // Per-repo base branch (e.g., "main" or "dev")
}

export interface DashboardConfig {
  // Paths
  colbyRepoPath: string;
  ctoDashboardRepoPath: string;
  additionalRepoPaths: string[];
  repos: RepoConfig[];
  claudeCliPath: string;

  // Models
  ctoModel: string;
  engineerDefaultModel: string;

  // Concurrency
  engineerMaxConcurrent: number;

  // Branches
  defaultBaseBranch: string;

  // Integrations (optional)
  notionApiKey?: string;
  notionBoardId?: string;
  vantaApiKey?: string;
  vantaClientId?: string;
  vantaClientSecret?: string;
  githubRepo?: string;
  githubToken?: string;
  browserAutomationEnabled?: boolean;
  browserHeadless?: boolean;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  ceoPhoneNumber?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  slackSigningSecret?: string;
  slackUpdateChannel?: string;

  // Authentication
  claudeOauthToken?: string;      // OAuth token for Claude CLI subscription auth

  // Dogfood / Extension
  extensionPath?: string;         // Path to Chrome extension dist dir for Load Unpacked
  sfLoginUrl?: string;            // Salesforce login URL
  sfUsername?: string;             // Salesforce username for CTO auth
  sfPassword?: string;            // Salesforce password for CTO auth
  sfSecurityToken?: string;       // Salesforce security token (appended to password to bypass MFA)

  // Resources
  engineerTokenBudget: number;
  engineerTimeoutMinutes: number;

  // Server
  wsPort: number;
  nextPort: number;

  // Projects & Autonomous Execution
  skillProfiles?: import('../types').SkillProfile[];
  toolRegistry?: import('../types').ToolRegistryEntry[];
  deployTargets?: import('../types').DeployTarget[];
  checkinIntervalMinutes?: number;
}

const CONFIG_DOC = 'config/dashboard';

let cachedConfig: DashboardConfig | null = null;
let unsubscribeSnapshot: (() => void) | null = null;
let configInitialized = false;

function getDefaults(): DashboardConfig {
  return {
    colbyRepoPath: process.env.COLBY_REPO_PATH || '~/repos/my-app',
    ctoDashboardRepoPath: process.env.CTO_DASHBOARD_REPO_PATH || '~/repos/personal-cto',
    additionalRepoPaths: (process.env.ADDITIONAL_REPO_PATHS || '').split(',').filter(Boolean),
    repos: [
      {
        name: 'my-app',
        localPath: process.env.COLBY_REPO_PATH || '~/repos/my-app',
        githubSlug: 'EricBZhong/my-app',
        baseBranch: 'dev',
      },
      {
        name: 'personal-cto',
        localPath: process.env.CTO_DASHBOARD_REPO_PATH || '~/repos/personal-cto',
        githubSlug: 'EricBZhong/personal-cto',
        baseBranch: 'dev',
      },
      {
        name: 'leadgen',
        localPath: process.env.LEADGEN_REPO_PATH || '~/repos/leadgen',
        githubSlug: 'EricBZhong/leadgen',
        baseBranch: 'main',
      },
    ],
    claudeCliPath: process.env.CLAUDE_CLI_PATH || 'claude',
    ctoModel: process.env.CTO_MODEL || 'opus',
    engineerDefaultModel: process.env.ENGINEER_DEFAULT_MODEL || 'opus',
    engineerMaxConcurrent: parseInt(process.env.ENGINEER_MAX_CONCURRENT || '10', 10),
    defaultBaseBranch: process.env.DEFAULT_BASE_BRANCH || 'dev',
    notionApiKey: process.env.NOTION_API_KEY,
    notionBoardId: process.env.NOTION_ENGINEERING_BOARD_ID || '21707890f5328016a01ff4f7d58eebee',
    vantaApiKey: process.env.VANTA_API_KEY,
    vantaClientId: process.env.VANTA_CLIENT_ID,
    vantaClientSecret: process.env.VANTA_CLIENT_SECRET,
    githubRepo: process.env.GITHUB_REPO || 'EricBZhong/my-app',
    githubToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    browserAutomationEnabled: false,
    browserHeadless: true,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
    twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
    ceoPhoneNumber: process.env.CEO_PHONE_NUMBER,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackUpdateChannel: process.env.SLACK_UPDATE_CHANNEL,
    claudeOauthToken: process.env.CLAUDE_OAUTH_TOKEN || '',
    extensionPath: process.env.EXTENSION_PATH,
    sfLoginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
    sfUsername: process.env.SF_USERNAME,
    sfPassword: process.env.SF_PASSWORD,
    sfSecurityToken: process.env.SF_SECURITY_TOKEN,
    engineerTokenBudget: parseInt(process.env.ENGINEER_TOKEN_BUDGET || '500000', 10),
    engineerTimeoutMinutes: parseInt(process.env.ENGINEER_TIMEOUT_MINUTES || '30', 10),
    wsPort: parseInt(process.env.WS_PORT || '3101', 10),
    nextPort: parseInt(process.env.NEXT_PORT || '3100', 10),
    skillProfiles: [
      { name: 'general', description: 'General-purpose engineering — default profile' },
      { name: 'frontend', description: 'Frontend/UI specialist', systemPromptAddition: 'You specialize in frontend development: React, Next.js, Tailwind CSS, accessibility, responsive design. Prioritize clean component architecture, pixel-perfect implementation, and great UX.' },
      { name: 'backend', description: 'Backend/API specialist', systemPromptAddition: 'You specialize in backend development: Node.js, Express, databases, REST APIs, authentication, security. Prioritize robust error handling, input validation, and clean API design.' },
      { name: 'infra', description: 'Infrastructure/DevOps specialist', systemPromptAddition: 'You specialize in infrastructure: Docker, GCP Cloud Run, CI/CD, Terraform, monitoring, logging. Prioritize reliability, security best practices, and infrastructure-as-code.' },
    ],
    toolRegistry: [],
    deployTargets: [],
    checkinIntervalMinutes: 120,
  };
}

/** Filter out empty/null/undefined values so defaults aren't clobbered */
function filterEmpty(data: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== '' && value !== null && value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Check if running on Cloud Run */
export function isCloudRun(): boolean {
  return !!process.env.K_SERVICE;
}

/** Load config from Firestore and set up live listener */
export async function initConfigFromFirestore(): Promise<void> {
  // S22: Guard against multiple calls
  if (configInitialized) {
    console.warn('[Config] initConfigFromFirestore() called more than once — skipping');
    return;
  }
  configInitialized = true;

  const defaults = getDefaults();

  // Initial load
  try {
    const snap = await db.doc(CONFIG_DOC).get();
    if (snap.exists) {
      const data = snap.data() || {};
      cachedConfig = { ...defaults, ...filterEmpty(data) };
      console.log('[Config] Loaded from Firestore');
    } else {
      cachedConfig = defaults;
      console.log('[Config] No Firestore doc found, using defaults');
    }
  } catch (err) {
    console.error('[Config] Failed to load from Firestore, using defaults:', (err as Error).message);
    cachedConfig = defaults;
  }

  // Set up live listener for cross-instance sync
  unsubscribeSnapshot = db.doc(CONFIG_DOC).onSnapshot(
    (snap) => {
      if (snap.exists) {
        const data = snap.data() || {};
        cachedConfig = { ...getDefaults(), ...filterEmpty(data) };
        console.log('[Config] Updated from Firestore snapshot');
      }
    },
    (err) => {
      console.error('[Config] onSnapshot error (keeping existing cache):', err.message);
    },
  );
}

/** Stop the Firestore listener (for graceful shutdown) */
export function stopConfigListener(): void {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
    console.log('[Config] Firestore listener stopped');
  }
}

export function getConfig(): DashboardConfig {
  if (cachedConfig) return cachedConfig;

  // Fallback if called before init (shouldn't happen normally)
  console.warn('[Config] getConfig() called before initConfigFromFirestore() — using defaults');
  cachedConfig = getDefaults();
  return cachedConfig;
}

/** S17: Clamp a numeric value to a range, logging a warning if out of bounds */
function clampNumeric(value: number, min: number, max: number, label: string): number {
  if (value < min) {
    console.warn(`[Config] ${label} value ${value} below minimum ${min} — clamped`);
    return min;
  }
  if (value > max) {
    console.warn(`[Config] ${label} value ${value} above maximum ${max} — clamped`);
    return max;
  }
  return value;
}

export async function updateConfig(updates: Partial<DashboardConfig>): Promise<DashboardConfig> {
  const current = getConfig();

  // S17: Validate numeric ranges for critical fields before write
  if (updates.engineerMaxConcurrent !== undefined) {
    updates.engineerMaxConcurrent = clampNumeric(updates.engineerMaxConcurrent, 1, 50, 'engineerMaxConcurrent');
  }
  if (updates.engineerTokenBudget !== undefined) {
    updates.engineerTokenBudget = clampNumeric(updates.engineerTokenBudget, 10000, 10000000, 'engineerTokenBudget');
  }
  if (updates.engineerTimeoutMinutes !== undefined) {
    updates.engineerTimeoutMinutes = clampNumeric(updates.engineerTimeoutMinutes, 1, 120, 'engineerTimeoutMinutes');
  }
  if (updates.wsPort !== undefined) {
    updates.wsPort = clampNumeric(updates.wsPort, 1024, 65535, 'wsPort');
  }
  if (updates.nextPort !== undefined) {
    updates.nextPort = clampNumeric(updates.nextPort, 1024, 65535, 'nextPort');
  }

  // Diff: find which fields actually changed
  const changedFields: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const oldVal = (current as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(value)) {
      changedFields.push(key);
    }
  }

  // Save revision before applying (fire-and-forget)
  if (changedFields.length > 0) {
    saveConfigRevision(current, changedFields).catch(err =>
      console.error('[Config] Failed to save revision:', (err as Error).message)
    );
  }

  const newConfig = { ...current, ...updates };

  // Eagerly update local cache
  cachedConfig = newConfig;

  // Persist to Firestore
  try {
    await db.doc(CONFIG_DOC).set(newConfig, { merge: true });
  } catch (err) {
    console.error('[Config] Failed to write to Firestore:', (err as Error).message);
  }

  return newConfig;
}

/** Save a config revision snapshot before changes are applied */
async function saveConfigRevision(config: DashboardConfig, changedFields: string[]): Promise<void> {
  const revisionData = {
    config: { ...(config as unknown as Record<string, unknown>) },
    changedFields,
    timestamp: new Date().toISOString(),
  };

  await collections.configRevisions.add(revisionData);

  // Prune: keep only last 20 revisions
  const snap = await collections.configRevisions.orderBy('timestamp', 'desc').offset(20).get();
  const batch = db.batch();
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
  }
  if (snap.docs.length > 0) await batch.commit();
}

/** Get recent config revisions */
export async function getConfigRevisions(limit = 20): Promise<Array<{ id: string; changedFields: string[]; timestamp: string }>> {
  const snap = await collections.configRevisions.orderBy('timestamp', 'desc').limit(limit).get();
  return snap.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      changedFields: d.changedFields || [],
      timestamp: d.timestamp || '',
    };
  });
}

/** Load and apply a config revision (rollback) */
export async function rollbackConfig(revisionId: string): Promise<DashboardConfig> {
  const doc = await collections.configRevisions.doc(revisionId).get();
  if (!doc.exists) throw new Error(`Revision ${revisionId} not found`);
  const revisionData = doc.data()!;
  const restoredConfig = revisionData.config as DashboardConfig;
  return updateConfig(restoredConfig);
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
