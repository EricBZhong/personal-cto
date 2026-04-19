# Architecture

## System Overview

AI-powered engineering orchestrator. The CEO interacts with a "CTO" Claude agent that has live context from Notion, GitHub, GCP, Vanta, and Slack. The CTO breaks work into tasks, delegates to parallel "Engineer" Claude instances, and reports results through a real-time dashboard.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand |
| Server | Node.js, WebSocket (ws), tsx runtime |
| Database | Google Firestore (firebase-admin) |
| AI | Claude CLI (`claude --print --output-format stream-json`) |
| Auth | NextAuth v5 (Google OAuth, configurable domain via `AUTH_ALLOWED_DOMAIN`) |
| Deployment | Google Cloud Run, Docker (node:20-slim) |

## Process Architecture

```
                     +-----------+
                     |  Browser  |
                     +-----+-----+
                           | WebSocket
           +---------------+----------------+
           |                                 |
     [Dev Mode]                      [Production Mode]
           |                                 |
  ws://localhost:3101              wss://{host}/ws
           |                          (same port)
           v                                 v
  +--------+--------+         +-------------+-------------+
  | WS Server :3101 |         | production.ts :8080        |
  +---------+-------+         | (Next.js + WS on one port) |
            |                  +-------------+-------------+
            v                                |
  +---------+-------+                        v
  |  Orchestrator   |<-----------------------+
  +--+---------+----+
     |         |
     v         v
  +--+---+  +--+---+
  |  CTO |  | Eng  |  (Claude CLI subprocesses)
  +------+  +--+---+
               |
               v
         GitHub PRs
```

### Ports

| Service | Dev Port | Prod Port |
|---------|----------|-----------|
| Next.js frontend | 3100 | 8080 (shared) |
| WebSocket server | 3101 | 8080 (shared, `/ws` path) |
| Twilio webhooks | 3102 | 3102 |

### Dev Mode
- `npm run dev` runs Next.js and the WS orchestrator concurrently via `concurrently`
- Frontend connects to `ws://localhost:3101`

### Production Mode (Cloud Run)
- `src/server/production.ts` serves Next.js and WebSocket on a single port (8080)
- WebSocket connections upgrade on the `/ws` path
- Health check at `/health`
- Session affinity enabled for sticky WebSocket connections

## Key Data Flow

### Chat Message Flow
1. User types message in `/chat` page
2. Frontend sends `chat:send` via WebSocket
3. Orchestrator calls `ctoSession.sendMessage()`
4. CTO Session gathers context from all integrations (Notion, GitHub, GCP, Vanta)
5. CTO Session builds system prompt with live context
6. CTO Session spawns `claude --print --output-format stream-json`
7. Stream events flow back as `cto:chunk` events via EventBus -> WebSocket -> Frontend
8. On completion, CTO response is parsed for `<task_assignment>` blocks
9. Parsed tasks are created as "suggested" in Firestore and synced to Notion

### Task Execution Flow
1. CTO suggests tasks via `<task_assignment>` XML blocks
2. Tasks appear in "Suggested" column on the task board
3. User approves task (from task board or inline chat card)
4. Task status changes to "approved"
5. EngineerPool.processQueue() picks up approved tasks
6. Engineer spawns in the task's target repo with a dedicated branch
7. Engineer works: reads code, makes changes, commits, pushes, creates PR
8. On completion, work is verified (branch exists on remote, PR exists)
9. Task moves to "in_review" with PR URL
10. Haiku generates a summary of the engineer's work

### Event Broadcasting
- All state changes emit events via `EventBus` (Node.js EventEmitter)
- `ws-server.ts` subscribes to EventBus and broadcasts to all connected WebSocket clients
- Frontend `useWebSocket` hook dispatches events to appropriate Zustand stores
- Some events (config, analytics, compliance) use `window.dispatchEvent(CustomEvent)` for pages that don't use stores

## Project Lifecycle

Projects enable multi-phase autonomous execution. The CTO creates projects from `<project_plan>` blocks or via `project:create`.

### Status Flow

```
draft → planning → active → paused → completed → archived
                     ↑         |
                     +---------+  (resume)
```

- **draft**: Initial creation, no phases defined
- **planning**: Phases defined but not yet started
- **active**: At least one phase is active; tasks are being executed
- **paused**: Manually paused, or auto-paused due to token budget or failure threshold
- **completed**: All phases completed successfully
- **archived**: Soft-deleted, hidden from active views

### Phase Hierarchy

Projects contain an ordered list of phases. Each phase contains tasks.

```
Project
  └── Phase 1 (completed)
  │     ├── Task A (done)
  │     └── Task B (done)
  └── Phase 2 (active)
  │     ├── Task C (in_progress) — depends on Task D
  │     └── Task D (done)
  └── Phase 3 (pending) — depends on Phase 2
        └── (tasks not yet created)
```

Phase status flow: `pending` → `active` → `completed` | `failed`

Phases advance automatically when all tasks in the active phase reach `done` status. The next pending phase is activated if its `dependsOnPhases` are all completed.

When a phase has no tasks, the CTO is spawned to plan tasks for it via `spawnCTOForPhasePlanning()`.

### Autonomy Model

Three levels of autonomy control how much human oversight is required:

| Level | Task Approval | Behavior |
|-------|---------------|----------|
| `supervised` | All tasks require human approval | Default. Tasks created as `suggested`. |
| `semi-autonomous` | P2/P3 auto-approved, P0/P1 require approval | Middle ground for routine work. |
| `autonomous` | All tasks auto-approved | Full hands-off execution. |

**Time-bounded autonomy**: `autonomousUntil` (ISO timestamp) auto-reverts to supervised after the specified time. `autonomousUntilPhase` (phase ID) reverts after that phase completes.

**Safeguards**:
- `pauseOnFailureCount` (default 3): Pauses the project after N task failures
- `tokenBudget`: Pauses the project when cumulative token usage exceeds the budget
- `requireApprovalForP0`: Even in autonomous mode, P0 tasks need human sign-off

### Task Dependency Graph

Tasks can declare dependencies via `dependsOn` (array of task IDs). When a dependency task completes:
1. Its `completionSummary` is generated (Haiku summarizes engineer output)
2. Downstream tasks receive the summary as `upstreamContext` in their engineer prompt
3. Engineers are instructed to build on top of upstream work

Within a phase, the CTO generates task assignments with `dependsOn` referencing task titles, which are resolved to task IDs after creation.

---

## Directory Structure

```
src/
  app/                    # Next.js pages (App Router)
    chat/page.tsx
    tasks/page.tsx
    tasks/[id]/page.tsx
    projects/page.tsx
    projects/[id]/page.tsx
    engineers/page.tsx
    pr-reviews/page.tsx
    compliance/page.tsx
    analytics/page.tsx
    activity/page.tsx
    settings/page.tsx
    slack/page.tsx
    dogfood/page.tsx
    login/page.tsx
    api/auth/[...nextauth]/
    api/health/
  components/             # React components
    layout/               # DashboardShell, Sidebar
    chat/                 # CTOChat, MessageBubble, ChatInput
    tasks/                # TaskBoard, TaskCard, TaskDetailSidebar
    engineers/            # EngineerCard
    slack/                # SlackMessageList, SlackConversationDetail
    shared/               # StatusBadge, SetupWizard
  hooks/                  # useWebSocket, useCTOChat, useTasks, useErrorReporter
  stores/                 # Zustand stores (chat, task, engineer, PR, slack, dogfood, setup, project)
  server/                 # Backend
    index.ts              # Entry point (WS server + Twilio)
    production.ts         # Single-port production server
    orchestrator.ts       # Message router (70+ message types)
    cto-session.ts        # CTO Claude spawning + context injection
    engineer-pool.ts      # Engineer spawning, queue, verification
    task-queue.ts         # Task CRUD (Firestore + local cache)
    project-manager.ts    # Project lifecycle, phase advancement, autonomy
    memory-store.ts       # CTO long-term memory (Firestore + cache)
    deploy-manager.ts     # Docker build, GCR push, Cloud Run deploy
    config.ts             # Configuration (file + env)
    event-bus.ts          # Event emitter for real-time broadcasting
    firestore.ts          # Firebase Admin SDK setup
    ws-server.ts          # WebSocket broadcast utility
    error-collector.ts    # Error tracking + auto-fix task creation
    clarification-tracker.ts  # User clarification + strategy poll tracking
    daily-checkin.ts      # Scheduled daily CTO check-ins
    prompts/              # System prompts
      cto-system.ts
      engineer-task.ts
    integrations/         # External service clients
      notion.ts
      github.ts
      gcp.ts
      vanta.ts
      slack.ts
      twilio.ts
      browser.ts
    dogfood/              # Self-testing framework
  types.ts                # Shared TypeScript types
data/
  config.json             # Persistent configuration
  cto-dashboard.db        # Legacy SQLite (archived, Firestore is primary)
```
