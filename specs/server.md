# Server Modules

All server code lives under `src/server/`.

## Entry Points

### `index.ts`

Dev mode entry point. Creates a WebSocket server on port 3101, initializes the orchestrator, starts integrations (Slack, Twilio), and sets up graceful shutdown handlers.

### `production.ts`

Production (Cloud Run) entry point. Serves Next.js and WebSocket on a single port (8080). WebSocket connections upgrade on the `/ws` path. Exposes `/health` endpoint for Cloud Run health checks.

---

## Core Modules

### Orchestrator (`orchestrator.ts`)

Central message router. Handles 60+ WebSocket message types.

**Class**: `Orchestrator`

**Key Methods**:
- `init(wss)` — Hydrates task queue from Firestore, sets up WebSocket message handling, starts engineer polling
- `handleMessage(ws, msg)` — Main switch statement routing messages to handlers
- `gatherContext()` — Fetches live data from Notion, GitHub, GCP, Vanta in parallel
- `parseTaskAssignments(text)` — Extracts `<task_assignment>` JSON blocks from CTO responses. Passes through `notion_page_id` if present in the assignment.
- `parseClarificationRequests(text)` — Extracts `<clarification_request>` blocks
- `parseStrategyPolls(text)` — Extracts `<strategy_poll>` blocks
- `drainTaskNotifications()` — Returns and clears pending manual task-change notifications for CTO context injection
- `maskSecrets(config)` — Replaces secret field values with `***` before sending to frontend
- `shutdown()` — Stops engineer polling and kills all engineers

**Message Categories**:
- Chat: `chat:send`, `chat:abort`, `chat:history`, `chat:clear`
- Threads: `thread:list`, `thread:create`, `thread:switch`, `thread:delete`
- Tasks: `task:approve`, `task:approve_by_title`, `task:reject`, `task:reject_by_title`, `task:cancel`, `task:list`, `task:get`, `task:logs`, `task:update_priority`, `task:retry`, `task:approve_all`, `task:set_status`
- Engineers: `engineer:list`, `engineer:kill`, `engineer:kill_all`
- Config: `config:get`, `config:update`, `config:revisions`, `config:rollback`
- Status: `status:get`, `health:ping`
- Integrations: `notion:tickets`, `github:prs`, `github:pr_diff`, `gcp:health`, `gcp:logs`
- Compliance: `compliance:overview`, `compliance:failing`
- Analytics: `analytics:usage`, `analytics:activity`
- Errors: `error:report`, `error:list`, `error:resolve`
- Analysis: `analysis:run`
- Dogfood: `dogfood:run`, `dogfood:run_with_analysis`
- Evals: `eval:list`, `eval:create`, `eval:delete`, `eval:run`, `eval:generate`, `eval:history`, `eval:seed`, `eval:import`
- Slack: `slack:status`, `slack:get_conversations`, `slack:get_queue`, `slack:reconnect`, `slack:post_update`, `slack:send_message`
- PR Reviews: `pr:list`, `pr:detail`, `pr:review`, `pr:approve`, `pr:merge`, `pr:comment`
- Daily Check-in: `checkin:trigger`, `checkin:get_report`, `checkin:list_reports`
- Projects: `project:list`, `project:get`, `project:create`, `project:update`, `project:advance`, `project:archive`, `project:pause`, `project:resume`
- Memory: `memory:list`, `memory:add`, `memory:delete`, `memory:search`
- Deploy: `deploy:trigger`, `deploy:history`

**CTO Response Parsing**: After each CTO response, the orchestrator parses the full text for:
- `<task_assignment>` blocks — creates tasks (with autonomy-aware auto-approval)
- `<clarification_request>` blocks — sends Slack DMs
- `<strategy_poll>` blocks — posts channel polls
- `<project_plan>` blocks — creates projects with phases and tasks
- `<memory>` blocks — stores CTO memory entries
- `<deploy_trigger>` blocks — triggers deploy pipeline
- `<create_repo>` blocks — creates new GitHub repos

**Config Update Side Effects**: When Slack or Twilio config fields change, their respective services are restarted automatically.

**Config Revision History**: Each `config:update` saves a snapshot of the previous config to the `configRevisions` Firestore collection (last 20 kept). `config:rollback` loads a revision snapshot and applies it via `updateConfig()`, broadcasting the new config to all clients.

---

### CTO Session (`cto-session.ts`)

Manages the CTO Claude conversation.

**Class**: `CTOSession`

**Key Methods**:
- `sendMessage(userMessage, modelOverride?)` — Full CTO interaction lifecycle:
  1. Fetches prior conversation history from Firestore
  2. Stores user message
  3. Auto-titles thread from first message
  4. Gathers context from all integrations (parallel)
  5. Builds system prompt with live context
  6. Spawns `claude --print --verbose --output-format stream-json`
  7. Streams response chunks via EventBus
  8. Stores assistant response in Firestore
  9. Tracks token usage
- `abort()` — Kills the current CTO Claude process
- `getConversationHistory(threadId?)` — Reads message history from Firestore
- `getLastAssistantMessage(threadId?)` — Gets the most recent assistant message
- `getThreads()` / `createThread()` / `deleteThread(threadId)` — Thread CRUD

**Claude CLI Args**:
```
claude --print --verbose --output-format stream-json
  --model {ctoModel}
  --max-turns 300
  --system-prompt {systemPrompt}
  {messageWithHistory}
```

**CWD**: Configured primary app repo path (falls back to `process.cwd()`)

**Environment**: Injects `GH_TOKEN`/`GITHUB_TOKEN` and `DISABLE_INTERACTIVITY=1`.

**Conversation History**: Last 20 messages are prepended to the user's message for context continuity.

---

### Engineer Pool (`engineer-pool.ts`)

Manages parallel engineer Claude instances.

**Class**: `EngineerPool`

**Key Methods**:
- `startPolling(intervalMs=3000)` — Polls task queue every 3 seconds for approved tasks
- `processQueue()` — Fills available engineer slots:
  1. Dequeues approved tasks by priority
  2. Spawns engineers up to `engineerMaxConcurrent`
- `spawnEngineer(task)` — Full engineer lifecycle:
  1. Resolves repo path (local dev or GitHub clone for Cloud Run)
  2. Creates dedicated branch (`task/{taskId}`)
  3. Builds engineer prompt
  4. Spawns `claude --print --verbose --output-format stream-json --permission-mode bypassPermissions`
  5. Streams output chunks via EventBus
  6. On completion: runs AI verification, verifies work delivery, generates summary, posts Notion comment
- `verifyAndFinalize(params)` — Post-completion verification:
  1. Checks if branch was pushed to remote
  2. Verifies PR URL exists (catches hallucinated PR URLs)
  3. Searches for PR on the branch if none claimed
  4. Finalizes task status (in_review or failed)
- `verifyDiffWithAI(task, diff)` — Uses Haiku to review the engineer's diff against the task description. Sets task to `verifying` status during check. Returns a `verification_warning` string if issues are detected (e.g., incomplete work, unrelated changes).
- `retryTask(task)` — Retries a failed/cancelled task. Builds retry context from previous logs and error messages, injecting the last 3000 characters of previous engineer output via `retryContext` param in the engineer prompt so the engineer is aware of what went wrong previously.
- `addCompletionComment(task, summary)` — When an engineer completes a task that has a `notion_page_id`, posts the summary as a comment on the linked Notion page via the Notion API.
- `generateSummary(...)` — Spawns Haiku to summarize engineer output (3-8 bullet points)
- `kill(engineerId)` / `killAll()` — Terminate engineer processes

**Repo Resolution**: `resolveRepoPath(repo, config)`:
- No repo → primary app repo path
- `"cto-dashboard"` or `"Personal-CTO-v1"` → CTO Dashboard path
- Additional repos from config
- Absolute paths used directly
- Cloud Run: Clones from GitHub into temp dir

**Engineer Claude CLI Args**:
```
claude --print --verbose --output-format stream-json
  --model {model}
  --no-session-persistence
  --max-turns 100
  --permission-mode bypassPermissions
  {engineerPrompt}
```

**Token Budget Enforcement**: Each engineer is tracked against `engineerTokenBudget` (default 500K tokens). At 80% usage a warning is emitted via EventBus. At 100% the engineer process is killed and the task is failed with a budget-exceeded error.

**Timeout**: Configurable via `engineerTimeoutMinutes` (default 30 minutes).

---

### Task Queue (`task-queue.ts`)

Task CRUD with Firestore persistence and local cache.

**Class**: `TaskQueue`

**Key Methods**:
- `createTask(params)` — Creates task in Firestore + local cache, syncs to Notion
- `getTask(id)` / `getTaskAsync(id)` — Sync (cache) / async (Firestore) task lookup
- `getAllTasks()` / `getAllTasksAsync()` — All tasks sorted by creation date desc
- `getTasksByStatus(...statuses)` — Filter by status, sorted by priority then creation date
- `updateTask(id, updates)` — Updates cache + Firestore, emits event, syncs status to Notion
- `addLog(taskId, content, source)` — Adds log entry to Firestore subcollection
- `getLogsAsync(taskId, limit=200)` — Reads logs from Firestore
- `dequeue()` — Returns next approved/queued task by priority. Uses Firestore transactions (`atomicClaim`) to prevent duplicate dequeue across concurrent instances.
- `addTokens(amount)` — Tracks daily token usage (cache + Firestore `dailyTokens` collection via `FieldValue.increment`)
- `getDailyTokens()` — Returns total token usage for the current day
- `hydrate()` — Initializes cache from Firestore on startup

**Notion Sync**: Tasks are automatically created as Notion tickets. Status changes sync to Notion board.

**Status → Notion Mapping**:
| Dashboard Status | Notion Status |
|-----------------|---------------|
| suggested | Backlog |
| approved | To Do |
| queued | To Do |
| in_progress | In Progress |
| verifying | In Progress |
| in_review | In Review |
| done | Done |
| failed | Blocked |
| cancelled | Cancelled |

---

### Event Bus (`event-bus.ts`)

Node.js EventEmitter for real-time event broadcasting.

**Class**: `DashboardEventBus`

**Method**: `emitDashboard(event)` — Emits on both `'dashboard'` (for WebSocket broadcast) and the specific event type channel.

**Activity Persistence**: Activity log entries are now persisted to the `activityLog` Firestore collection with trigger categorization (`user_action`, `auto_fix`, `slack_message`, `daily_checkin`, `system`) and optional `oldValue`/`newValue` fields for change tracking.

**Event Types**: See `DashboardEvent` union type — covers CTO streaming, task lifecycle, engineer lifecycle, system status, clarifications, strategy polls, PR reviews, and daily check-ins.

---

### WebSocket Server (`ws-server.ts`)

Utility class that subscribes to EventBus `'dashboard'` events and broadcasts them to all connected WebSocket clients as JSON `{ type, payload }` messages.

---

### Config (`config.ts`)

Configuration management with file + environment variable layering.

See [configuration.md](./configuration.md) for full details.

---

### Claude Auth (`claude-auth.ts`)

Centralized Claude CLI authentication for subprocess spawning. Ensures all Claude CLI subprocesses use the Max subscription (OAuth) instead of per-token API billing.

**Exports**:
- `buildClaudeEnv(extra?)` — Builds a clean `env` object for `spawn()`. Strips `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` (which would override OAuth), injects `CLAUDE_CODE_OAUTH_TOKEN` if available, and sets `DISABLE_INTERACTIVITY=1`.
- `getOAuthToken()` — Resolves OAuth token with priority: config `claudeOauthToken` → `CLAUDE_OAUTH_TOKEN` env var → `CLAUDE_CODE_OAUTH_TOKEN` env var → macOS Keychain (dev only). Result is cached.
- `clearTokenCache()` — Clears the cached OAuth token.

**Auth Precedence**: Claude CLI checks auth in this order: `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` → interactive OAuth. By stripping `ANTHROPIC_API_KEY`, we force subscription OAuth.

**Local Dev**: OAuth token is read from macOS Keychain (`Claude Code-credentials`). No configuration needed.

**Cloud Run**: Set `CLAUDE_OAUTH_TOKEN` in GCP Secret Manager. Generate it locally with `claude /setup-token`, then store the token.

**Usage**: All Claude spawn sites (`cto-session.ts`, `engineer-pool.ts`, `daily-checkin.ts`) use `buildClaudeEnv()` instead of raw `process.env`.

---

### Error Collector (`error-collector.ts`)

Tracks uncaught errors from both frontend and backend.

**Features**:
- Records errors to Firestore `errorEvents` collection
- Auto-creates fix tasks for recurring errors
- Provides `getRecent(limit)` and `getCounts()` for the error monitoring UI

---

### Clarification Tracker (`clarification-tracker.ts`)

Tracks clarification requests sent to Slack users and strategy polls posted to channels.

**Exports**: `clarificationTracker`, `strategyPollTracker`

**Flow**: CTO outputs `<clarification_request>` → Orchestrator resolves Notion user to Slack user → Sends DM with questions → Tracks response.

---

### Periodic Check-in (`daily-checkin.ts`)

Periodic CTO check-in that runs every 2 hours and generates status reports.

**Schedule**:
- Runs every 2 hours via `setInterval`
- First check-in fires 30 seconds after startup (to let Slack connect)
- Manual trigger still available via `checkin:trigger` WS command

**Features**:
- Summarizes recent activity (last 2 hours): completed tasks, failures, in-progress work
- Stale task detection: flags active tasks (in_progress, queued, approved) with no update in 24+ hours; count included in report stats as `staleTasks`
- Task cost estimates: computes estimated token usage for suggested tasks based on historical model averages
- Suggests new tasks via `<task_assignment>` blocks
- Posts status update to configured `slackUpdateChannel` (`#ai-eric-updates`)
- Reports stored in Firestore `dailyReports` collection

**Production**: Started in `production.ts` after Slack boots. Stopped on graceful shutdown.

---

### Firestore (`firestore.ts`)

Firebase Admin SDK initialization and collection references.

**Collections**:
- `tasks` (with `logs` subcollection)
- `chatThreads` (with `messages` subcollection)
- `dailyTokens`
- `errorEvents`
- `clarificationRequests`
- `strategyPolls`
- `slackMessageQueue`
- `dogfoodEvals` (with `runs` subcollection)
- `dailyReports`
- `configRevisions`
- `activityLog`
- `projects`
- `memory`
- `deploys`

**Utilities**: `FieldValue.increment()`, `toISOString()` timestamp converter.

---

### Project Manager (`project-manager.ts`)

Manages multi-phase autonomous project execution.

**Class**: `ProjectManager`

**Key Methods**:
- `createProject(params)` — Creates project in Firestore + local cache, emits `project:created`
- `getProject(id)` / `getProjectAsync(id)` — Sync (cache) / async (Firestore) project lookup
- `getAllProjects()` / `getAllProjectsAsync()` — All projects sorted by `updated_at` desc
- `updateProject(id, updates)` — Updates cache + Firestore, emits `project:updated`
- `advanceProject(projectId)` — Checks if current phase is complete; advances to next phase. Includes safeguards:
  - Token budget check: pauses project if `totalTokensUsed >= tokenBudget`
  - Failure threshold: pauses project if `totalTasksFailed >= pauseOnFailureCount`
  - Autonomy expiry: reverts to supervised after `autonomousUntilPhase`
- `activateNextPhase(project)` — Finds next pending phase with satisfied dependencies, activates it. If no tasks exist for the phase, spawns CTO to plan them via `spawnCTOForPhasePlanning()`. Marks project as completed when all phases are done. Triggers auto-deploy if configured.
- `onTaskCompleted(taskId)` — Updates project stats (tokens, completed count), triggers phase advancement
- `onTaskFailed(taskId)` — Updates project failure count, triggers advancement check (may pause)
- `spawnCTOForPhasePlanning(project, phase)` — Spawns a CTO Claude subprocess to generate task assignments for a phase. Includes completed phase summaries as context. Created tasks respect project `autoApprove` setting.
- `getActiveProjectsSummary()` — Returns formatted text for CTO context injection (project names, phase progress, task counts, autonomy levels)
- `hydrate()` — Initializes cache from Firestore on startup
- `checkAutonomyTimeouts()` — Checks time-based autonomy expiry, reverts to supervised if expired
- `notifySlack(message)` — Posts project notifications to Slack update channel

**Singleton**: `projectManager`

---

### Memory Store (`memory-store.ts`)

CTO long-term memory with Firestore persistence.

**Class**: `MemoryStore`

**Key Methods**:
- `addEntry(params)` — Creates memory entry in Firestore + cache, emits `memory:added`
- `deleteEntry(id)` — Removes from cache + Firestore, emits `memory:deleted`
- `getEntries(filter?)` — Returns entries filtered by `projectId` and/or `type`, sorted by `created_at` desc. Global entries (no `projectId`) are always included.
- `getAllAsync()` — Fetches all entries from Firestore
- `search(query)` — Keyword search across content and tags (case-insensitive)
- `getRelevantMemories(projectId?, maxChars?)` — Returns formatted memory text for CTO prompt injection. Includes global entries and project-scoped entries. Truncated to `maxChars` (default 3000).
- `hydrate()` — Initializes cache from Firestore on startup

**Memory Types**: `decision`, `preference`, `learning`, `architecture`, `constraint`

**Singleton**: `memoryStore`

---

### Deploy Manager (`deploy-manager.ts`)

Automated deployment pipeline: Docker build, GCR push, Cloud Run deploy, health verification.

**Class**: `DeployManager`

**Key Methods**:
- `deploy(params)` — Triggers a full deploy pipeline for a repo. Looks up `DeployTarget` from config. Creates a `DeployRecord` in Firestore, emits `deploy:started`, runs pipeline async.
- `runDeployPipeline(deployId, target, projectId?)` — Executes the deploy steps:
  1. **Build**: `docker build -t gcr.io/{project}/{service}:latest` in the repo directory
  2. **Push**: `docker push` to Google Container Registry
  3. **Deploy**: `gcloud run deploy` to Cloud Run with managed platform
  4. **Verify**: `curl` health check against the deployed service URL
  - Each step emits `deploy:progress` with status updates
  - On success: emits `deploy:completed` with `succeeded` status
  - On failure: emits `deploy:completed` with `failed` status and error message
- `deployForProject(projectId, repoName?)` — Convenience method for project auto-deploy on completion
- `createRepo(params)` — Creates a new GitHub repo via `gh repo create` (public/private, optional template)
- `getHistory(limit?)` — Returns recent deploy records from Firestore (default 20)

**Deploy Status Flow**: `building` -> `pushing` -> `deploying` -> `verifying` -> `succeeded` | `failed`

**Singleton**: `deployManager`

---

## Dogfood Testing

### Extension Harness (`dogfood/extension-harness.ts`)

Puppeteer-based Chrome extension testing framework.

**Class**: `ExtensionHarness`

**Key Methods**:
- `launch(options)` — Launches Chrome with the extension loaded. Auto-detects Cloud Run and uses headless mode (`headless: 'new'`) with `--no-sandbox`, `--disable-gpu`, `--disable-dev-shm-usage` flags.
- `ensureExtension(options)` — Provisions the Chrome extension:
  - **Dev mode**: Uses local extension path from config
  - **Cloud Run**: Clones app repo via GH token, builds the extension, caches the built path for subsequent runs
- `testChatLatency(options)` — Sends a message through the extension and measures TTFT + full response time
- `testVisualInspection(url)` — Takes screenshots at multiple viewports
- `testBackendLatency(url)` — Pure HTTP health check + auth latency (no browser needed)
- `testProactiveExploration(options)` — Runs 12 chaos monkey edge-case scenarios (Unicode, XSS, rapid-fire, etc.)

**Cloud Run Support**: All 5 test suites (backend-latency, visual-inspection, chat-latency, proactive-exploration, full-suite) work on Cloud Run. The Docker image includes Chromium (`/usr/bin/chromium`) and the harness automatically uses headless mode with appropriate sandbox flags. Extension is cloned and built on first run, then cached.

**Environment Variables**:
- `PUPPETEER_EXECUTABLE_PATH` — Path to Chromium binary (set in Docker)
- `GH_TOKEN` / `GITHUB_TOKEN` — Required on Cloud Run for extension repo cloning
