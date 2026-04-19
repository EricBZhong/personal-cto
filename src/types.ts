export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tokensUsed?: number;
  isStreaming?: boolean;
}

export interface ChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'suggested' | 'approved' | 'queued' | 'in_progress' | 'verifying' | 'in_review' | 'done' | 'failed' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  branch?: string;
  repo?: string;
  project?: string;
  model: string;
  engineer_id?: string;
  tokens_used: number;
  pr_url?: string;
  error?: string;
  verification_warning?: string;
  errors?: string[];
  verification_warnings?: string[];
  actioned_by?: string;
  action_reason?: string;
  notion_page_id?: string;
  slack_message_ts?: string;
  slack_channel_id?: string;
  estimatedTokens?: number;
  // Project execution engine fields
  dependsOn?: string[];
  completionSummary?: string;
  phaseId?: string;
  projectId?: string;
  skillProfile?: string;
  created_at: string;
  updated_at: string;
}

export interface TaskLog {
  id: number;
  task_id: string;
  source: string;
  content: string;
  timestamp: string;
}

export interface Engineer {
  id: string;
  taskId: string;
  taskTitle: string;
  model: string;
  startedAt: string;
  tokensUsed: number;
  tokenBudget: number;
}

export interface RepoConfig {
  name: string;         // Display name & CTO task identifier (e.g., "LeadGen")
  localPath: string;    // Local filesystem path for dev
  githubSlug: string;   // GitHub org/repo (e.g., "EricBZhong/leadgen")
  baseBranch: string;   // Per-repo base branch (e.g., "main" or "dev")
}

// ---- Projects & Autonomous Execution ----

export interface ProjectPhase {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  dependsOnPhases: string[];
  taskIds: string[];
  requiresApproval?: boolean;
  created_at: string;
  completed_at?: string;
}

export interface AutonomySettings {
  level: 'supervised' | 'semi-autonomous' | 'autonomous';
  autonomousUntil?: string;
  autonomousUntilPhase?: string;
  pauseOnFailureCount?: number;
  requireApprovalForP0?: boolean;
  notifyOnEveryTask?: boolean;
  notifyOnPhaseOnly?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  goal: string;
  status: 'draft' | 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  phases: ProjectPhase[];
  autonomy: AutonomySettings;
  autoApprove: boolean;
  autoMerge: boolean;
  autoDeploy: boolean;
  repo?: string;
  tokenBudget?: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  totalTokensUsed: number;
  totalTasksCompleted: number;
  totalTasksFailed: number;
  consecutiveFailures: number;
}

// ---- CTO Memory ----

export interface MemoryEntry {
  id: string;
  type: 'decision' | 'preference' | 'learning' | 'architecture' | 'constraint';
  content: string;
  projectId?: string;
  tags: string[];
  created_at: string;
}

// ---- Skill Profiles & Tool Registry ----

export interface SkillProfile {
  name: string;
  description: string;
  systemPromptAddition?: string;
  mcpServers?: string[];
  envVars?: Record<string, string>;
  modelOverride?: string;
}

export interface ToolRegistryEntry {
  name: string;
  description: string;
  envVar: string;
  value: string;
  skillProfiles?: string[];
}

// ---- Deploy Automation ----

export interface DeployTarget {
  repoName: string;
  gcpProject: string;
  gcpRegion: string;
  serviceName: string;
  dockerfilePath?: string;
  healthCheckUrl?: string;
}

export interface DeployRecord {
  id: string;
  projectId?: string;
  repoName: string;
  status: 'building' | 'pushing' | 'deploying' | 'verifying' | 'succeeded' | 'failed';
  commitSha?: string;
  imageUrl?: string;
  serviceUrl?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface DashboardConfig {
  colbyRepoPath: string;
  ctoDashboardRepoPath: string;
  additionalRepoPaths: string[];
  repos: RepoConfig[];
  claudeCliPath: string;
  ctoModel: string;
  engineerDefaultModel: string;
  engineerMaxConcurrent: number;
  defaultBaseBranch: string;
  notionApiKey?: string;
  notionBoardId?: string;
  vantaApiKey?: string;
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
  claudeOauthToken?: string;
  engineerTokenBudget: number;
  engineerTimeoutMinutes: number;
  wsPort: number;
  nextPort: number;
  // Projects & Autonomous Execution
  skillProfiles?: SkillProfile[];
  toolRegistry?: ToolRegistryEntry[];
  deployTargets?: DeployTarget[];
  checkinIntervalMinutes?: number;
}

export interface SystemStatus {
  engineers: number;
  activeTasks: number;
  dailyTokens: number;
  config?: {
    maxEngineers: number;
    engineerTokenBudget: number;
    engineerTimeoutMinutes: number;
  };
  slackConnected?: boolean;
  ctoStatus?: string;
}

export type ServerEvent =
  | { type: 'cto:chunk'; data: { text: string; messageId: string } }
  | { type: 'cto:done'; data: { messageId: string; fullText: string; tokensUsed?: number } }
  | { type: 'cto:error'; data: { error: string; messageId: string } }
  | { type: 'cto:thinking'; data: { text: string; messageId: string } }
  | { type: 'task:created'; data: Task }
  | { type: 'task:updated'; data: Partial<Task> & { id: string } }
  | { type: 'task:logs_updated'; data: { taskId: string } }
  | { type: 'engineer:spawned'; data: Engineer }
  | { type: 'engineer:chunk'; data: { engineerId: string; taskId: string; text: string } }
  | { type: 'engineer:done'; data: { engineerId: string; taskId: string; status: string; tokensUsed?: number } }
  | { type: 'engineer:error'; data: { engineerId: string; taskId: string; error: string } }
  | { type: 'system:status'; data: SystemStatus }
  | { type: 'chat:history'; payload: { messages: Array<{ role: string; content: string; timestamp: string }> } }
  | { type: 'task:list'; payload: { tasks: Task[] } }
  | { type: 'task:detail'; payload: { task: Task; logs: TaskLog[] } }
  | { type: 'task:logs'; payload: { taskId: string; logs: TaskLog[] } }
  | { type: 'engineer:list'; payload: { engineers: Engineer[] } }
  | { type: 'config:data'; payload: DashboardConfig }
  | { type: 'health:results'; payload: { services: Array<{ name: string; ok: boolean; latencyMs: number }> } }
  | { type: 'notion:tickets'; payload: { tickets: unknown[]; error?: string } }
  | { type: 'github:prs'; payload: { prs: unknown[]; repoStats?: unknown; error?: string } }
  | { type: 'github:pr_diff'; payload: { prNumber: number; diff: string; pr?: unknown; error?: string } }
  | { type: 'gcp:health'; payload: { services: unknown[]; error?: string } }
  | { type: 'gcp:logs'; payload: { service: string; logs: unknown[]; error?: string } }
  | { type: 'compliance:overview'; payload: { categories?: unknown[]; overallScore?: number; error?: string } }
  | { type: 'compliance:failing'; payload: { controls: unknown[]; error?: string } }
  | { type: 'analytics:usage'; payload: { dailyTokens: unknown[]; taskTokens: unknown[]; totalAllTime: number; todayTokens: number; projectTokens?: unknown[] } }
  | { type: 'analytics:activity'; payload: { activities: Array<{ timestamp: string; type: string; message: string }> } }
  | { type: 'thread:list'; payload: { threads: ChatThread[]; activeThreadId: string } }
  | { type: 'thread:created'; payload: { thread: ChatThread } }
  | { type: 'thread:switched'; payload: { threadId: string; messages: Array<{ role: string; content: string; timestamp: string }> } }
  | { type: 'thread:deleted'; payload: { threadId: string } }
  | { type: 'dogfood:started'; payload: { testType: string; withAnalysis?: boolean } }
  | { type: 'dogfood:progress'; payload: { type: string; step?: string; log?: string; screenshot?: { label: string; base64: string }; timestamp: number } }
  | { type: 'dogfood:results'; payload: { results: DogfoodResult[]; report: string } }
  | { type: 'dogfood:error'; payload: { error: string } }
  | { type: 'eval:list'; payload: { evals: unknown[] } }
  | { type: 'eval:created'; payload: { eval: unknown } }
  | { type: 'eval:deleted'; payload: { evalId: string } }
  | { type: 'eval:history'; payload: { history: unknown[] } }
  | { type: 'eval:import_done'; payload: { created: number; error?: string } }
  | { type: 'setup:prompt'; payload: { integration: string } }
  | { type: 'clarification:sent'; data: { id: string; ticketTitle: string; askUser: string } }
  | { type: 'clarification:answered'; data: { id: string; ticketTitle: string; answeredBy: string; answers: string } }
  | { type: 'strategy:posted'; data: { id: string; ticketTitle: string; channel: string } }
  | { type: 'strategy:decided'; data: { id: string; ticketTitle: string; chosenOption: string; decidedBy: string } }
  | { type: 'slack:task_action'; data: { taskId: string; action: string; userName: string } }
  | { type: 'slack:conversations'; payload: { conversations: SlackConversation[] } }
  | { type: 'slack:queue'; payload: { queue: SlackConversation[] } }
  | { type: 'slack:status'; payload: { configured: boolean; connected: boolean } }
  // PR Reviews
  | { type: 'pr:list'; payload: { prs: PullRequest[] } }
  | { type: 'pr:detail'; payload: { pr: PullRequest; diff: string; reviews: PRReview[] } }
  | { type: 'pr:review_started'; payload: { prNumber: number } }
  | { type: 'pr:review_complete'; payload: { prNumber: number; reviewText: string; recommendation: string } }
  | { type: 'pr:action_result'; payload: { prNumber: number; action: string; success: boolean; error?: string } }
  | { type: 'pr:added'; payload: { pr?: PullRequest; error?: string } }
  // Daily Check-in
  | { type: 'checkin:started'; payload: Record<string, never> }
  | { type: 'checkin:complete'; payload: { report: DailyReport } }
  | { type: 'checkin:error'; payload: { error: string } }
  | { type: 'checkin:report'; payload: { report: DailyReport } }
  | { type: 'checkin:reports'; payload: { reports: DailyReportSummary[] } }
  // Config Revisions
  | { type: 'config:revisions'; payload: { revisions: ConfigRevision[] } }
  | { type: 'config:rollback'; payload: { success: boolean; error?: string } }
  // Projects
  | { type: 'project:list'; payload: { projects: Project[] } }
  | { type: 'project:detail'; payload: { project: Project } }
  | { type: 'project:created'; payload: { project: Project } }
  | { type: 'project:updated'; payload: { project: Project } }
  | { type: 'project:advanced'; payload: { projectId: string; phaseId: string; phaseName: string } }
  | { type: 'project:completed'; payload: { projectId: string } }
  | { type: 'project:paused'; payload: { projectId: string; reason: string } }
  // Memory
  | { type: 'memory:list'; payload: { entries: MemoryEntry[] } }
  | { type: 'memory:added'; payload: { entry: MemoryEntry } }
  | { type: 'memory:deleted'; payload: { id: string } }
  // Deploy
  | { type: 'deploy:started'; payload: { deploy: DeployRecord } }
  | { type: 'deploy:progress'; payload: { deployId: string; status: string; message?: string } }
  | { type: 'deploy:completed'; payload: { deploy: DeployRecord } }
  | { type: 'deploy:history'; payload: { deploys: DeployRecord[] } }
  // Generic server error (rate limit, validation, etc.)
  | { type: 'error'; payload: { error: string } };

export interface SlackConversation {
  id: number;
  slackUserId: string;
  slackChannelId: string;
  messageText: string;
  messageType: 'dm' | 'mention' | 'group';
  threadTs?: string;
  userName?: string;
  status: 'pending' | 'processed' | 'failed';
  response?: string;
  createdAt: string;
  processedAt?: string;
}

// ---- PR Reviews ----

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  author: string;
  branch: string;
  baseBranch: string;
  url: string;
  body?: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  checksStatus?: string;
  reviewDecision?: string;
}

export interface PRReview {
  id: number;
  author: string;
  state: string;
  body: string;
  submittedAt: string;
}

// ---- Daily Check-in ----

export interface DailyReport {
  id: string;
  date: string;
  summary: string;
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    staleTasks?: number;
    dailyTokens: number;
    activeEngineers: number;
    openPRs: number;
  };
  suggestedTasks: string[];
  slackPosted: boolean;
  createdAt: string;
}

export interface DailyReportSummary {
  id: string;
  date: string;
  tasksCompleted: number;
  dailyTokens: number;
  createdAt: string;
}

export interface ConfigRevision {
  id: string;
  changedFields: string[];
  timestamp: string;
}

export interface DogfoodScreenshot {
  label: string;
  path: string;
  base64: string;  // data URL for inline display
}

export interface DogfoodResult {
  success: boolean;
  testName: string;
  duration_ms: number;
  ttft_ms?: number;
  full_response_ms?: number;
  screenshots: DogfoodScreenshot[];
  metrics: Record<string, number | string>;
  errors: string[];
  logs: string[];
}
