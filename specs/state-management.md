# State Management

All stores use [Zustand](https://github.com/pmndrs/zustand) v5. Stores live under `src/stores/`. Hooks live under `src/hooks/`.

## Architecture

```
WebSocket Message
       ↓
useWebSocket (hook)
       ↓ dispatches to
Zustand Stores ←→ Components (React)
```

The `useWebSocket` hook in `DashboardShell` receives all server messages and dispatches them to the appropriate store. Components subscribe to store slices and re-render on changes.

Some data (config, analytics, compliance) uses `window.dispatchEvent(CustomEvent)` instead of stores, because those pages manage local state with `useState`.

---

## Stores

### `useChatStore` (`stores/chat-store.ts`)

**State**:
- `messages: ChatMessage[]` — Messages in the active thread
- `isStreaming: boolean` — Whether CTO is currently responding
- `streamingMessageId: string | null` — ID of the message being streamed
- `threads: ChatThread[]` — All conversation threads
- `activeThreadId: string` — Currently selected thread

**Actions**:
- `addMessage(msg)` — Add user or assistant message
- `startStreaming(messageId)` — Create placeholder streaming message
- `appendChunk(messageId, text)` — Append streamed text
- `finishStreaming(messageId, fullText, tokensUsed?)` — Finalize streamed message
- `setError(messageId, error)` — Mark message as error
- `setHistory(messages)` — Replace all messages (thread switch)
- `clearMessages()` — Clear all messages
- `setThreads(threads, activeThreadId)` — Load thread list
- `addThread(thread)` — Create and switch to thread
- `switchToThread(threadId, messages)` — Switch thread + load messages
- `removeThread(threadId)` — Delete thread
- `setActiveThreadId(threadId)` — Set active thread

---

### `useTaskStore` (`stores/task-store.ts`)

**State**:
- `tasks: Task[]` — All tasks
- `selectedTaskId: string | null` — Currently selected task for sidebar
- `taskLogs: Record<string, TaskLog[]>` — Logs keyed by task ID
- `optimisticUpdates: Record<string, Partial<Task>>` — Pending optimistic updates keyed by task ID

**Actions**:
- `setTasks(tasks)` — Replace all tasks
- `addTask(task)` — Add (deduplicates by ID)
- `updateTask(task)` — Merge update into existing task
- `selectTask(id)` — Set selected task
- `setTaskLogs(taskId, logs)` — Store logs for a task
- `optimisticUpdate(taskId, updates)` — Apply an optimistic update immediately (e.g., change status to "approved" before server confirms)
- `confirmOptimistic(taskId)` — Clear the optimistic update after server confirms
- `revertOptimistic(taskId)` — Revert the optimistic update if the server action fails

---

### `useEngineerStore` (`stores/engineer-store.ts`)

**State**:
- `engineers: Engineer[]` — Active engineer instances
- `systemStatus: SystemStatus` — System metrics (engineer count, tasks, daily tokens)
- `engineerLogs: Record<string, string>` — Live output keyed by engineer ID
- `engineerProgress: Record<string, EngineerProgress>` — Progress state keyed by engineer ID

**Actions**:
- `setEngineers(engineers)` — Replace all
- `addEngineer(engineer)` — Add or replace by ID
- `removeEngineer(engineerId)` — Remove
- `appendEngineerLog(engineerId, text)` — Append to live output; also parses the text through `engineer-progress.ts` to update `engineerProgress`
- `setSystemStatus(status)` — Update system metrics

**EngineerProgress** (parsed by `src/lib/engineer-progress.ts`):
```typescript
interface EngineerProgress {
  milestones: string[];      // Completed steps (e.g., "Cloned repo", "Created branch")
  currentActivity: string;   // What the engineer is doing now
}
```

The `engineer-progress.ts` parser scans engineer output chunks for recognizable patterns (branch creation, file edits, test runs, PR creation, etc.) and extracts milestone and current activity information.

---

### `usePRStore` (`stores/pr-store.ts`)

**State**:
- `prs: PullRequest[]` — Open PRs
- `selectedPR: number | null` — Selected PR number
- `prDetail: { pr, diff, reviews } | null` — Full PR detail
- `reviewInProgress: number | null` — PR number being reviewed
- `lastReviewText: string | null` — Last CTO review text
- `lastReviewRecommendation: string | null` — APPROVE/COMMENT/REQUEST_CHANGES
- `error: string | null` — Error message

**Actions**:
- `setPRs(prs)` — Load PR list
- `selectPR(prNumber)` — Set selected
- `setPRDetail(detail)` — Load PR detail + diff + reviews
- `setReviewInProgress(prNumber)` — Mark review starting
- `setReviewComplete(prNumber, reviewText, recommendation)` — Show results
- `setError(error)` — Display error
- `handleActionResult(prNumber, action, success, error)` — Handle action result

---

### `useSlackStore` (`stores/slack-store.ts`)

**State**:
- `conversations: SlackConversation[]` — All conversations
- `queue: SlackConversation[]` — Pending queue
- `selectedId: number | null` — Selected conversation
- `filter: 'all' | 'pending' | 'processed' | 'failed'` — Active filter tab
- `slackConnected: boolean` — Connection status

**Actions**:
- `setConversations(conversations)` — Replace all
- `setQueue(queue)` — Replace queue
- `selectConversation(id)` — Set selected
- `setFilter(filter)` — Change filter tab
- `setSlackConnected(connected)` — Update connection status

---

### `useDogfoodStore` (`stores/dogfood-store.ts`)

**State**:
- `running: boolean` — Test in progress
- `testType: string | null` — Current test type
- `withAnalysis: boolean` — Whether CTO analysis is included
- `results: DogfoodResult[]` — Test results
- `report: string` — Formatted report text
- `error: string | null` — Error message
- `history: Array<{ timestamp, testType, results, report }>` — Last 10 runs
- `liveLogs: DogfoodLiveLog[]` — Real-time step/log entries during test execution
- `liveScreenshots: DogfoodLiveScreenshot[]` — Real-time screenshots streamed during test
- `currentStep: string | null` — Current step name shown in live progress header
- `evals: EvalDefinition[]` — Eval definitions
- `evalHistory: EvalRunResult[]` — Eval run history
- `importResult: { created, error? } | null` — Last import result

**Actions**:
- `setRunning(testType, withAnalysis?)` — Mark test as running, clear live state
- `setResults(results, report)` — Store results and add to history
- `setError(error)` — Set error state
- `addProgress(event)` — Append live progress event (step/log/screenshot)
- `reset()` — Clear running/results/error/importResult/live state
- `handleEvalEvent(type, payload)` — Route eval sub-events

---

### `useProjectStore` (`stores/project-store.ts`)

**State**:
- `projects: Project[]` — All projects
- `selectedProjectId: string | null` — Currently selected project
- `memories: MemoryEntry[]` — CTO memory entries
- `deploys: DeployRecord[]` — Deploy records

**Actions**:
- `setProjects(projects)` — Replace all projects
- `addProject(project)` — Add or replace by ID (upsert)
- `updateProject(project)` — Update existing project by ID
- `selectProject(id)` — Set selected project
- `setMemories(memories)` — Replace all memory entries
- `addMemory(entry)` — Prepend new memory entry
- `removeMemory(id)` — Remove memory entry by ID
- `setDeploys(deploys)` — Replace all deploy records
- `addDeploy(deploy)` — Prepend new deploy record
- `updateDeploy(deploy)` — Update existing deploy by ID

---

### `useToastStore` (`stores/toast-store.ts`)

**State**:
- `toasts: Toast[]` — Active toast notifications

**Actions**:
- `addToast(toast)` — Add a toast notification (type: `success` | `error` | `warning` | `info`, message, optional duration)
- `removeToast(id)` — Remove a specific toast
- `clearToasts()` — Remove all toasts

**Toast Shape**:
```typescript
interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number; // ms, default 5000
}
```

**Usage**: Import `useToastStore` and call `addToast()` from anywhere. The `ToastContainer` in `DashboardShell` subscribes to the store and renders active toasts.

---

### `useSetupStore` (`stores/setup-store.ts`)

**State**:
- `activeIntegration: string | null` — Integration being set up

**Actions**:
- `openSetup(integration)` — Open setup wizard
- `closeSetup()` — Close setup wizard

---

## Hooks

### `useWebSocket` (`hooks/useWebSocket.ts`)

Core WebSocket connection and message routing.

**Returns**: `{ send(type, payload), connected }`

**Connection**:
- Dev: `ws://localhost:3101`
- Production: `wss://{host}/ws`
- Auto-reconnect with exponential backoff (2s → 30s)

**On Connect**: Automatically requests `chat:history`, `task:list`, `thread:list`, `engineer:list`

**On Connect**: Automatically requests `thread:list`, `chat:history`, `task:list`, `engineer:list`, `status:get`, `slack:get_conversations`, `slack:status`, `pr:list`, `project:list`

**Message Routing**: Dispatches received messages to appropriate stores:
- `cto:*`, `chat:*`, `thread:*` → `useChatStore`
- `task:*` → `useTaskStore`
- `engineer:*`, `system:status` → `useEngineerStore`
- `dogfood:*`, `eval:*` → `useDogfoodStore`
- `slack:*` → `useSlackStore`
- `pr:*` → `usePRStore`
- `project:*` → `useProjectStore`
- `memory:*` → `useProjectStore` (memories stored in project store)
- `deploy:*` → `useProjectStore` (deploys stored in project store)
- `setup:prompt` → `useSetupStore`
- `config:data`, `analytics:*`, `compliance:*`, `checkin:*` → `window.dispatchEvent(CustomEvent)`

---

### `useCTOChat` (`hooks/useCTOChat.ts`)

Chat-specific logic layer on top of `useChatStore`.

**Returns**:
- `messages`, `isStreaming` — From store
- `sendMessage(text)` — Adds user message to store + sends `chat:send`
- `abort()` — Sends `chat:abort`
- `model`, `toggleModel` — Sonnet/Opus toggle
- `threads`, `activeThreadId` — Thread management
- `createThread`, `switchThread`, `deleteThread` — Thread CRUD

---

### `useTasks` (`hooks/useTasks.ts`)

Task action helpers. Applies optimistic updates from `useTaskStore` so the UI updates immediately before server confirmation.

**Returns**:
- `tasks` — From store, with optimistic updates merged in
- `selectedTaskId`, `taskLogs` — From store
- `approveTask(taskId, overrides?)` — `task:approve` (applies optimistic status change to `approved`)
- `rejectTask(taskId, actionedBy?, reason?)` — `task:reject`
- `cancelTask(taskId)` — `task:cancel`
- `retryTask(taskId)` — `task:retry`
- `updatePriority(taskId, priority)` — `task:update_priority`
- `fetchLogs(taskId)` — `task:logs`
- `refreshTasks()` — `task:list`
- `setTaskStatus(taskId, status, actionedBy?, reason?)` — `task:set_status`

---

### `useErrorReporter` (`hooks/useErrorReporter.ts`)

Captures frontend errors and reports them to the server.

**Hooks into**:
- `console.error` (wrapped)
- `window.onerror`
- `window.onunhandledrejection`

**Filters out**: React DevTools, HMR, Fast Refresh, `[WS]` logs

**Sends**: `error:report` WebSocket message with source, level, message, stack, context
