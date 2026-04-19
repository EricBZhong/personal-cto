# Data Models

## Database: Google Firestore

Primary data store is Firestore (firebase-admin). SQLite (`data/cto-dashboard.db`) is archived/legacy.

---

## Firestore Collections

### `config`

Single document at `config/dashboard`. Stores config overrides that differ from hardcoded defaults. Merged with `getDefaults()` at load time.

| Field | Type | Description |
|-------|------|-------------|
| *(any DashboardConfig field)* | varies | Only non-default values are stored |

Updated via `updateConfig()` with `set(..., { merge: true })`. Listened to via `onSnapshot` for live cross-instance sync.

### `tasks`

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Task title |
| `description` | string | Detailed task description |
| `status` | string | `suggested` \| `approved` \| `queued` \| `in_progress` \| `verifying` \| `in_review` \| `done` \| `failed` \| `cancelled` |
| `priority` | string | `P0` \| `P1` \| `P2` \| `P3` |
| `branch` | string? | Git branch name (e.g., `task/abc12345`) |
| `repo` | string? | Target repo identifier |
| `project` | string? | Logical project grouping (may differ from repo) |
| `estimatedTokens` | number? | Computed cost estimate from historical model averages (not persisted) |
| `model` | string | Claude model (`sonnet`, `opus`, `haiku`) |
| `engineer_id` | string? | UUID of assigned engineer instance |
| `tokens_used` | number | Total tokens consumed by this task |
| `verification_warning` | string? | Latest warning from AI diff verification |
| `verification_warnings` | string[] | Full history of all verification warnings |
| `pr_url` | string? | GitHub PR URL |
| `error` | string? | Latest error message |
| `errors` | string[] | Full history of all errors |
| `notion_page_id` | string? | Linked Notion page ID |
| `actioned_by` | string? | Who approved/rejected (e.g., "CEO", "Slack") |
| `action_reason` | string? | Reason for approval/rejection |
| `slack_message_ts` | string? | Slack message timestamp |
| `slack_channel_id` | string? | Slack channel ID |
| `dependsOn` | string[]? | Task IDs this task depends on (upstream dependencies) |
| `completionSummary` | string? | Summary of work done (set on completion, injected into downstream tasks) |
| `phaseId` | string? | Phase ID within a project |
| `projectId` | string? | Parent project ID |
| `skillProfile` | string? | Engineer skill profile (`general`, `frontend`, `backend`, `infra`) |
| `created_at` | string (ISO) | Creation timestamp |
| `updated_at` | string (ISO) | Last update timestamp |

**Subcollection: `tasks/{taskId}/logs`**

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | Parent task ID |
| `source` | string | `system` \| `engineer` \| `stderr` \| `summary` \| `interaction` |
| `content` | string | Log content |
| `timestamp` | string (ISO) | Log timestamp |

### `chatThreads`

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Thread title (auto-set from first message) |
| `created_at` | string (ISO) | Creation timestamp |
| `updated_at` | string (ISO) | Last activity timestamp |

**Subcollection: `chatThreads/{threadId}/messages`**

| Field | Type | Description |
|-------|------|-------------|
| `thread_id` | string | Parent thread ID |
| `role` | string | `user` \| `assistant` |
| `content` | string | Message content |
| `message_id` | string | UUID |
| `tokens_used` | number | Tokens consumed for assistant messages |
| `timestamp` | string (ISO) | Message timestamp |

### `dailyTokens`

Document ID is the date string (e.g., `2026-03-30`).

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Date (YYYY-MM-DD) |
| `total_tokens` | number | Total tokens consumed for the day (uses `FieldValue.increment`) |

### `errorEvents`

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Error source (`frontend`, `cto-session`, `engineer`, etc.) |
| `level` | string | `error` \| `fatal` |
| `message` | string | Error message |
| `stack` | string? | Stack trace |
| `context` | string? | JSON context |
| `resolved` | boolean | Whether resolved |
| `created_at` | string (ISO) | Timestamp |

### `clarificationRequests`

| Field | Type | Description |
|-------|------|-------------|
| `notion_page_id` | string | Notion ticket page ID |
| `ticket_title` | string | Ticket title |
| `questions` | string[] | Clarification questions |
| `ask_user_name` | string | User to ask |
| `context` | string? | Context for the questions |
| `status` | string | `pending` \| `sent` \| `answered` \| `failed` |
| `slack_user_id` | string? | Resolved Slack user ID |
| `slack_channel_id` | string? | DM channel ID |
| `slack_ts` | string? | Message timestamp |
| `created_at` | string (ISO) | Timestamp |

### `strategyPolls`

| Field | Type | Description |
|-------|------|-------------|
| `ticket_title` | string | Related ticket title |
| `options` | `{ label, description }[]` | Poll options |
| `ask_channel` | string | Target Slack channel |
| `context` | string? | Poll context |
| `status` | string | `pending` \| `posted` \| `decided` \| `failed` |
| `chosen_option` | string? | Selected option label |
| `decided_by` | string? | Who decided |
| `slack_channel` | string? | Actual channel posted to |
| `slack_ts` | string? | Message timestamp |
| `created_at` | string (ISO) | Timestamp |

### `slackMessageQueue`

| Field | Type | Description |
|-------|------|-------------|
| `slack_user_id` | string | Slack user ID |
| `slack_channel_id` | string | Channel ID |
| `message_text` | string | Message content |
| `message_type` | string | `dm` \| `mention` \| `group` |
| `thread_ts` | string? | Thread timestamp |
| `user_name` | string? | User display name |
| `status` | string | `pending` \| `processed` \| `failed` |
| `response` | string? | CTO response |
| `created_at` | string (ISO) | Received timestamp |
| `processed_at` | string? (ISO) | Processing timestamp |

### `dogfoodEvals`

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Eval name |
| `description` | string | Eval description |
| `category` | string | `functional` \| `performance` \| `visual` |
| `input` | string | Test input/prompt |
| `expectedBehavior` | string? | Expected outcome |
| `maxTtftMs` | number? | Max time to first token (ms) |
| `maxResponseMs` | number? | Max total response time (ms) |
| `expectNoErrors` | boolean | Whether errors should fail |
| `createdBy` | string | `user` \| `cto` |
| `created_at` | string (ISO) | Timestamp |

**Subcollection: `dogfoodEvals/{evalId}/runs`**

Stores individual eval run results.

### `configRevisions`

Stores config snapshots before each `config:update`. Only the last 20 revisions are kept (older ones are pruned on write).

| Field | Type | Description |
|-------|------|-------------|
| `changedFields` | string[] | List of field names that were changed |
| `snapshot` | object | Full config snapshot before the change |
| `timestamp` | string (ISO) | When the revision was created |

### `activityLog`

Persisted activity entries with structured trigger/change metadata.

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Activity type (`chat`, `task`, `engineer`, `config`, etc.) |
| `message` | string | Human-readable description |
| `trigger` | string? | Source trigger (`user_action`, `auto_fix`, `slack_message`, `daily_checkin`, `system`, etc.) |
| `oldValue` | string? | Previous value (for config/status changes) |
| `newValue` | string? | New value (for config/status changes) |
| `timestamp` | string (ISO) | When the activity occurred |

### `dailyReports`

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Report date |
| `summary` | string | CTO-generated summary |
| `stats` | object | `{ tasksCompleted, dailyTokens, staleTasks?, ... }` |
| `suggestedTasks` | array | Suggested follow-up tasks |
| `slackPosted` | boolean | Whether posted to Slack |
| `createdAt` | string (ISO) | Timestamp |

### `projects`

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Project name |
| `description` | string | Project description |
| `goal` | string | Desired end state |
| `status` | string | `draft` \| `planning` \| `active` \| `paused` \| `completed` \| `archived` |
| `phases` | ProjectPhase[] | Ordered list of project phases |
| `autonomy` | AutonomySettings | Autonomy configuration |
| `autoApprove` | boolean | Auto-approve tasks (skip suggested status) |
| `autoMerge` | boolean | Auto-merge PRs when approved |
| `autoDeploy` | boolean | Auto-deploy when all phases complete |
| `repo` | string? | Target repo identifier |
| `tokenBudget` | number? | Max token spend before pausing |
| `created_at` | string (ISO) | Creation timestamp |
| `updated_at` | string (ISO) | Last update timestamp |
| `completed_at` | string? (ISO) | Completion timestamp |
| `totalTokensUsed` | number | Cumulative tokens across all tasks |
| `totalTasksCompleted` | number | Total completed tasks |
| `totalTasksFailed` | number | Total failed tasks |

### `memory`

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `decision` \| `preference` \| `learning` \| `architecture` \| `constraint` |
| `content` | string | Memory content text |
| `projectId` | string? | Scoped to a specific project (null = global) |
| `tags` | string[] | Searchable tags |
| `created_at` | string (ISO) | Creation timestamp |

### `deploys`

| Field | Type | Description |
|-------|------|-------------|
| `projectId` | string? | Associated project ID |
| `repoName` | string | Repository name |
| `status` | string | `building` \| `pushing` \| `deploying` \| `verifying` \| `succeeded` \| `failed` |
| `commitSha` | string? | Git commit SHA |
| `imageUrl` | string? | Docker image URL (e.g., `gcr.io/project/service:latest`) |
| `serviceUrl` | string? | Cloud Run service URL |
| `error` | string? | Error message (on failure) |
| `startedAt` | string (ISO) | Deploy start timestamp |
| `completedAt` | string? (ISO) | Deploy completion timestamp |

---

## Consistency Model

The task system uses a **cache-as-read-authority** pattern:

- **Writes are awaited**: `createTask()` and `updateTask()` are async and await their Firestore `.set()` / `.update()` calls. This ensures the cache and Firestore stay in sync, preventing stale reads after tab navigation.
- **Reads serve from cache**: `task:list` WebSocket messages return from the in-memory cache (`getAllTasks()`) rather than querying Firestore. This is fast, synchronous, and always reflects the latest writes.
- **`getAllTasksAsync()` merges**: When Firestore is queried (e.g., during hydration), results are merged into the cache using `updated_at` timestamps — whichever is newer wins. In-flight creates that haven't landed in Firestore yet are preserved.
- **Frontend preserves optimistic updates**: The Zustand `setTasks()` method checks for pending optimistic actions and preserves them during wholesale task list replacements.

---

## TypeScript Interfaces

Defined in `src/types.ts` and `src/server/task-queue.ts`.

### `ChatMessage`
```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tokensUsed?: number;
  isStreaming?: boolean;
  messageId?: string;
}
```

### `ChatThread`
```typescript
interface ChatThread {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
```

### `Task`
```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'suggested' | 'approved' | 'queued' | 'in_progress' | 'verifying' | 'in_review' | 'done' | 'failed' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  branch?: string;
  repo?: string;
  project?: string;
  estimatedTokens?: number;
  model: string;
  engineer_id?: string;
  tokens_used: number;
  verification_warning?: string;
  verification_warnings: string[];
  pr_url?: string;
  error?: string;
  errors: string[];
  notion_page_id?: string;
  actioned_by?: string;
  action_reason?: string;
  slack_message_ts?: string;
  slack_channel_id?: string;
  // Project execution engine fields
  dependsOn?: string[];
  completionSummary?: string;
  phaseId?: string;
  projectId?: string;
  skillProfile?: string;
  created_at: string;
  updated_at: string;
}
```

### `TaskLog`
```typescript
interface TaskLog {
  id: number;
  task_id: string;
  source: string;
  content: string;
  timestamp: string;
}
```

### `Engineer`
```typescript
interface Engineer {
  id: string;
  taskId: string;
  taskTitle: string;
  model: string;
  startedAt: string;
  tokensUsed: number;
}
```

### `SystemStatus`
```typescript
interface SystemStatus {
  engineers: number;
  activeTasks: number;
  dailyTokens: number;
  config?: { maxEngineers: number; engineerTokenBudget: number; engineerTimeoutMinutes: number };
  slackConnected?: boolean;
  ctoStatus?: string;
}
```

### `PullRequest`
```typescript
interface PullRequest {
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
```

### `PRReview`
```typescript
interface PRReview {
  id: number;
  author: string;
  state: string;
  body: string;
  submittedAt: string;
}
```

### `SlackConversation`
```typescript
interface SlackConversation {
  id: number | string;
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
```

### `DogfoodResult`
```typescript
interface DogfoodResult {
  success: boolean;
  testName: string;
  duration_ms: number;
  ttft_ms?: number;
  full_response_ms?: number;
  screenshots?: DogfoodScreenshot[];
  metrics?: Record<string, number>;
  errors?: string[];
  logs?: string[];
}
```

### `DailyReport`
```typescript
interface DailyReport {
  id: string;
  date: string;
  summary: string;
  stats: { tasksCompleted: number; dailyTokens: number; staleTasks?: number; ... };
  suggestedTasks: any[];
  slackPosted: boolean;
  createdAt: string;
}
```

### `RepoConfig`
```typescript
interface RepoConfig {
  name: string;         // Display name & CTO task identifier (e.g., "LeadGen")
  localPath: string;    // Local filesystem path for dev
  githubSlug: string;   // GitHub org/repo (e.g., "EricBZhong/leadgen")
  baseBranch: string;   // Per-repo base branch (e.g., "main" or "dev")
}
```

### `DashboardConfig`
```typescript
interface DashboardConfig {
  colbyRepoPath: string;
  ctoDashboardRepoPath: string;
  additionalRepoPaths: string[];
  repos: RepoConfig[];
  claudeCliPath: string;
  ctoModel: string;
  engineerDefaultModel: string;
  engineerMaxConcurrent: number;
  engineerTokenBudget: number;
  engineerTimeoutMinutes: number;
  defaultBaseBranch: string;
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
  claudeOauthToken?: string;
  extensionPath?: string;
  sfLoginUrl?: string;
  sfUsername?: string;
  sfPassword?: string;
  wsPort: number;
  nextPort: number;
  // Projects & Autonomous Execution
  skillProfiles?: SkillProfile[];
  toolRegistry?: ToolRegistryEntry[];
  deployTargets?: DeployTarget[];
  checkinIntervalMinutes?: number;
}
```

### `ProjectPhase`
```typescript
interface ProjectPhase {
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
```

### `AutonomySettings`
```typescript
interface AutonomySettings {
  level: 'supervised' | 'semi-autonomous' | 'autonomous';
  autonomousUntil?: string;        // ISO timestamp — auto-revert to supervised after this time
  autonomousUntilPhase?: string;   // Phase ID — revert to supervised after this phase completes
  pauseOnFailureCount?: number;    // Pause project after N task failures (default 3)
  requireApprovalForP0?: boolean;  // Always require human approval for P0 tasks
  notifyOnEveryTask?: boolean;     // Send Slack notification for every task
  notifyOnPhaseOnly?: boolean;     // Only notify on phase transitions
}
```

### `Project`
```typescript
interface Project {
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
}
```

### `MemoryEntry`
```typescript
interface MemoryEntry {
  id: string;
  type: 'decision' | 'preference' | 'learning' | 'architecture' | 'constraint';
  content: string;
  projectId?: string;
  tags: string[];
  created_at: string;
}
```

### `SkillProfile`
```typescript
interface SkillProfile {
  name: string;
  description: string;
  systemPromptAddition?: string;
  mcpServers?: string[];
  envVars?: Record<string, string>;
  modelOverride?: string;
}
```

### `ToolRegistryEntry`
```typescript
interface ToolRegistryEntry {
  name: string;
  description: string;
  envVar: string;
  value: string;
  skillProfiles?: string[];
}
```

### `DeployTarget`
```typescript
interface DeployTarget {
  repoName: string;
  gcpProject: string;
  gcpRegion: string;
  serviceName: string;
  dockerfilePath?: string;
  healthCheckUrl?: string;
}
```

### `DeployRecord`
```typescript
interface DeployRecord {
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
```

### `ServerEvent`

Discriminated union of 70+ event types. See `src/types.ts` for the full `ServerEvent` type definition. Key categories:

- CTO streaming: `cto:chunk`, `cto:done`, `cto:error`, `cto:thinking`
- Task lifecycle: `task:created`, `task:updated`, `task:logs_updated`
- Engineer activity: `engineer:spawned`, `engineer:chunk`, `engineer:done`, `engineer:error`
- System: `system:status`
- Integrations: `notion:tickets`, `github:prs`, `gcp:health`, `compliance:overview`, `analytics:usage`
- Chat threads: `thread:list`, `thread:created`, `thread:switched`, `thread:deleted`
- Slack: `slack:conversations`, `slack:queue`, `slack:status`
- PR Reviews: `pr:list`, `pr:detail`, `pr:review_started`, `pr:review_complete`, `pr:action_result`
- Dogfood/Evals: `dogfood:started`, `dogfood:results`, `eval:list`, `eval:created`, `eval:history`
- Daily check-in: `checkin:complete`, `checkin:reports`
- Projects: `project:list`, `project:detail`, `project:created`, `project:updated`, `project:advanced`, `project:completed`, `project:paused`
- Memory: `memory:list`, `memory:added`, `memory:deleted`
- Deploy: `deploy:started`, `deploy:progress`, `deploy:completed`, `deploy:history`
