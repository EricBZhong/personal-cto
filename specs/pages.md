# Pages

All pages live under `src/app/` using Next.js App Router.

## Route Map

| Route | File | Description |
|-------|------|-------------|
| `/` | `page.tsx` | Redirects to `/chat` |
| `/login` | `login/page.tsx` | Google OAuth sign-in |
| `/chat` | `chat/page.tsx` | CTO chat interface |
| `/tasks` | `tasks/page.tsx` | Kanban task board |
| `/tasks/[id]` | `tasks/[id]/page.tsx` | Task detail view |
| `/engineers` | `engineers/page.tsx` | Active engineer grid |
| `/pr-reviews` | `pr-reviews/page.tsx` | PR review interface |
| `/compliance` | `compliance/page.tsx` | SOC 2 compliance dashboard |
| `/analytics` | `analytics/page.tsx` | Token usage tracking & metrics |
| `/activity` | `activity/page.tsx` | Activity timeline |
| `/settings` | `settings/page.tsx` | Configuration panel |
| `/slack` | `slack/page.tsx` | Slack conversation queue |
| `/dogfood` | `dogfood/page.tsx` | Self-testing & benchmarks |
| `/features` | `features/page.tsx` | Features guidebook |
| `/docs` | `docs/page.tsx` | Technical documentation & API reference |
| `/projects` | `projects/page.tsx` | Projects list (autonomous execution) |
| `/projects/[id]` | `projects/[id]/page.tsx` | Project detail view |
| `/api/auth/[...nextauth]` | NextAuth handler | Google OAuth API route |
| `/api/health` | Health check | Returns 200 OK |

---

## `/projects`

**Purpose**: Multi-phase autonomous project management with status tracking and progress visualization.

**Components**: `ProjectGroup`, `ProjectCard` (all inline, not exported)

**State**: `useProjectStore()`

**Features**:
- Project list grouped by status: Active, Paused, Completed, Other (draft/archived)
- Project cards with status badges (color-coded: draft=zinc, planning=yellow, active=blue, paused=orange, completed=green, archived=zinc)
- Autonomy level badges (Supervised, Semi-Auto, Autonomous)
- Phase progress bar per project (completed/total phases, percentage)
- Active phase indicator (current phase name)
- Stats row: tasks completed, tasks failed, token usage, repo name
- Empty state with guidance ("Ask the CTO to Build me X")
- Refresh button sends `project:list`
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `project:list`
- Receives: `project:list`, `project:created`, `project:updated`, `project:advanced`, `project:completed`, `project:paused`

---

## `/projects/[id]`

**Purpose**: Detailed project view with phase timeline, task list, autonomy settings, and management actions.

**Components**: `StatCard`, `PhaseCard` (all inline, not exported)

**State**: `useProjectStore()`, `useTaskStore()`

**Features**:
- Back link to `/projects`
- Project header with name, goal/description
- Action buttons context-sensitive to project status:
  - Active: Pause, Advance Phase
  - Paused: Resume
  - Non-terminal: Archive (with confirmation dialog)
- Stats grid: status, autonomy level, tasks done, tokens used
- Autonomy settings panel: level, autonomous-until timestamp, pause-on-failure count, token budget
- Phase timeline: ordered list of phases with status dots (pending=zinc, active=blue pulsing, completed=green, failed=red)
  - Phase progress bar per phase (done tasks / total tasks)
  - "Needs Approval" badge for phases with `requiresApproval`
  - Phase description text
- Project tasks list: all tasks filtered by `projectId`, linked to `/tasks/[id]`
  - Phase label per task
  - Status badge, priority badge
- Empty states for no phases and no tasks
- Per-page `document.title` (project name)

**WebSocket Messages**:
- Sends: `project:get`, `project:pause`, `project:resume`, `project:advance`, `project:archive`, `project:list`
- Receives: `project:detail`, `project:updated`, `project:advanced`, `project:completed`, `project:paused`

---

## `/login`

**Purpose**: Google OAuth login. Domain restriction configurable via `AUTH_ALLOWED_DOMAIN` env var.

**UI**: Dark-themed card with Google logo and sign-in button.

**Auth**: Uses NextAuth `signIn('google')`.

---

## `/chat`

**Purpose**: Primary CTO interaction interface with streaming AI responses.

**Components**: `CTOChat`, `MessageBubble`, `ChatInput`

**State**: `useCTOChat()` hook (wraps `useChatStore`)

**Features**:
- Thread sidebar (ChatGPT-style conversation list)
- Create, switch, delete threads
- Model toggle (Sonnet/Opus) per message
- Streaming response with cursor animation
- Token usage badge per assistant message
- Inline `<task_assignment>` parsing — renders `TaskSuggestionCard` for each task
- Approve/reject tasks directly from chat

**WebSocket Messages**:
- Sends: `chat:send`, `chat:abort`, `chat:history`, `thread:create`, `thread:switch`, `thread:delete`
- Receives (via store): `cto:chunk`, `cto:done`, `cto:error`, `chat:history`, `thread:list`, `thread:created`, `thread:switched`, `thread:deleted`

---

## `/tasks`

**Purpose**: Kanban board for task lifecycle management.

**Components**: `TaskBoard`, `TaskCard`, `TaskDetailSidebar`

**State**: `useTaskStore()`, `useTasks()` hook

**Columns**: Suggested | Queued | In Progress | Verifying | In Review | Done | Closed (failed + cancelled)

**Features**:
- Project filter dropdown to view tasks per repo (shown when tasks span multiple repos)
- "All Projects" view with repo tags on each card; per-project view filters the board
- Auto-archive: closed tasks (done/failed/cancelled) older than 7 days are hidden from the board (still in Firestore)
- Collapsible columns: Done and Closed columns show only 5 most recent tasks with "Show more" / "Show less" toggle
- Archived task count displayed above the board when tasks are hidden
- Approve/reject suggested tasks
- Cancel in-progress/queued tasks
- Select task to open detail sidebar
- Priority badges (P0-P3, color-coded)
- Model badges, token usage badges
- PR link and download buttons

**WebSocket Messages**:
- Sends: `task:list`, `task:approve`, `task:reject`, `task:cancel`, `task:retry`, `task:interact`, `task:logs`, `task:update_priority`, `task:set_status`
- Receives: `task:created`, `task:updated`, `task:list`, `task:logs`, `task:logs_updated`

---

## `/tasks/[id]`

**Purpose**: Full task detail view with logs, metadata, and actions.

**Features**:
- All task metadata (ID, branch, repo, model, tokens used, engineer, timestamps)
- Status override dropdown (manual status change with reason)
- Action buttons (approve, reject, cancel, retry)
- PR patch/ZIP download
- Full system and engineer logs with source color-coding

**WebSocket Messages**:
- Sends: `task:get`, `task:logs`, `task:approve`, `task:reject`, `task:cancel`, `task:retry`, `task:interact`, `task:set_status`
- Receives: `task:detail`, `task:logs`

---

## `/engineers`

**Purpose**: Grid showing all active engineer Claude instances.

**Components**: `EngineerCard`

**State**: `useEngineerStore()`

**Features**:
- Loading spinner while engineer list loads
- Empty state with "Go to Chat" CTA
- Sort: newest (default), oldest, task name, tokens used
- Search: filter by task title
- Live output window per engineer (last 2000 chars, monospace)
- Elapsed time counter
- Token usage badge, model badge
- Progress indicators (milestones completed and current activity)
- Running indicator (pulsing amber dot)
- Kill individual engineer or kill all
- `PageHeader` with subtitle (active/max counts), Refresh and Kill All actions
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `engineer:list`, `engineer:kill`, `engineer:kill_all`
- Receives: `engineer:spawned`, `engineer:chunk`, `engineer:done`, `engineer:error`, `engineer:list`

---

## `/pr-reviews`

**Purpose**: Pull request review interface with CTO AI review.

**Components**: Two-panel layout (PR list + detail/diff)

**State**: `usePRStore()`

**Features**:
- Loading spinner in left panel while PR list loads
- Empty state in list ("Paste a PR URL above") and in detail panel ("No PR selected")
- Error banner (replaces inline error) with auto-dismiss
- Filter chips: all, needs review, approved, changes requested
- Sort: newest, oldest, needs review first
- Search: filter by PR title or author
- Responsive left panel: `w-64 lg:w-80`
- Responsive URL input: `flex-1 max-w-sm`
- List open PRs with author, branch, status badges, truncation tooltips
- **Add PR by URL**: paste any GitHub PR URL (any repo) to add it to the list
- Cross-repo support: externally-added PRs persist across refreshes and work with all actions
- View full diff with syntax highlighting
- Request CTO review (sends diff to CTO Claude)
- CTO review result display with recommendation (APPROVE/COMMENT/REQUEST_CHANGES)
- Review history
- Approve, merge (squash), comment actions
- Review is submitted to GitHub automatically
- `PageHeader` with Add/Refresh actions
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `pr:list`, `pr:add`, `pr:detail`, `pr:review`, `pr:approve`, `pr:merge`, `pr:comment`
- Receives: `pr:list`, `pr:added`, `pr:detail`, `pr:review_started`, `pr:review_complete`, `pr:action_result`

---

## `/compliance`

**Purpose**: SOC 2 compliance dashboard via Vanta integration.

**Features**:
- Loading spinner while waiting for compliance data
- Empty state when Vanta is not configured (CTA to Settings)
- Error banner with auto-dismiss
- Overall compliance score
- Category-level scores (Security, Availability, Confidentiality, etc.)
- Failing controls list with remediation notes, truncation tooltips
- Quick action buttons to ask CTO about compliance gaps (sends `chat:send`)
- `PageHeader` with subtitle, Refresh and Run Audit actions
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `compliance:overview`, `compliance:failing`
- Receives: via `window.dispatchEvent(CustomEvent)` for `compliance:overview` and `compliance:failing`

---

## `/analytics`

**Purpose**: Token usage tracking and task statistics.

**Features**:
- Loading spinner while waiting for data
- Empty state when no usage data exists
- Error banner with auto-dismiss on fetch failure
- Daily token usage summary
- Date range selector: 7d, 14d, 30d for daily chart
- **Cost by Project**: bar chart showing token usage grouped by `task.project || task.repo`, powered by `projectTokens` array from `analytics:usage`
- Task status breakdown (counts by status)
- Highest token-consuming tasks list with search filter; project/repo shown on each task row
- All-time token usage total
- `PageHeader` with Refresh action
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `analytics:usage`
- Receives: via `window.dispatchEvent(CustomEvent)` for `analytics:usage`

---

## `/activity`

**Purpose**: Chronological timeline of all system activities.

**Types**: chat, task, engineer, analysis, config, deploy, error

**Features**:
- Loading spinner while waiting for data
- Empty state with "Go to Chat" CTA
- Error banner with auto-dismiss on fetch failure
- Filter chips: all, chat, task, engineer, analysis, config, error
- Search bar: filters activity messages (case-insensitive)
- Sort: newest first (default) or oldest first
- Type icons and color-coding
- Trigger badges: colored chips showing activity source (`user_action`=blue, `auto_fix`=green, `slack_message`=purple, `daily_checkin`=amber, `system`=gray, etc.)
- Old/new value transitions: when `oldValue` and `newValue` are present, displayed as `oldValue` -> `newValue` inline
- Timestamps via shared `formatDateTime()` util
- `PageHeader` with Refresh action
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `analytics:activity`
- Receives: via `window.dispatchEvent(CustomEvent)` for `analytics:activity`

---

## `/settings`

**Purpose**: Full configuration form for all system settings.

**Sections**:
1. **Repositories**: Primary app repo path, CTO Dashboard path, additional repo paths, Claude CLI path
2. **Models**: CTO model, default engineer model
3. **Resources**: Max concurrent engineers, engineer token budget, engineer timeout minutes, default base branch
4. **Integrations**: Notion (API key, board ID), Vanta (API key), GitHub (repo, token), Twilio (SID, auth token, phone), Slack (bot token, app token, signing secret, update channel), Browser automation toggle
5. **Config History**: Collapsible section showing last 20 config revisions (timestamp, changed fields). Each revision has a "Rollback" button that sends `config:rollback` with the revision ID.

**WebSocket Messages**:
- Sends: `config:get`, `config:update`, `config:revisions`, `config:rollback`
- Receives: `config:data`, `config:revisions` (via `window.dispatchEvent(CustomEvent)`)

**Secret Masking**: Secret fields show `***` and won't overwrite server values if submitted as `***`.

**UX**: Spinner on save button during `config:update`, per-page `document.title`.

---

## `/slack`

**Purpose**: View and manage Slack conversations (DMs, mentions, group messages).

**Components**: `SlackMessageList`, `SlackConversationDetail`, `SlackMessageCard`

**State**: `useSlackStore()`

**Features**:
- Loading spinner while conversations load
- Empty state with "Configure Slack" CTA when not connected
- Filter tabs: All, Queued, Processed, Failed
- Two-panel layout (conversation list + detail)
- Responsive left panel: `w-72 lg:w-[360px]`
- User name, message type icon (DM/mention/group)
- CTO response display
- Slack deep link to original message
- Reconnect button
- `PageHeader` with connection status badge, Refresh and Reconnect actions
- Per-page `document.title`

**WebSocket Messages**:
- Sends: `slack:get_conversations`, `slack:reconnect`
- Receives: `slack:conversations`, `slack:queue`, `slack:status`

---

## `/dogfood`

**Purpose**: Self-testing and benchmarking framework.

**State**: `useDogfoodStore()`

**Features**:
- 5 test types: backend latency, visual, chat latency, proactive exploration, full suite
- Run with or without CTO analysis
- Live test visualization: real-time progress steps, logs, and screenshots stream to UI during test execution
- Screenshot gallery (base64 images)
- Custom eval creation (name, description, input, expected behavior, thresholds)
- Eval import (paste content for CTO to parse)
- Eval run history table
- Extension config panel (Chrome extension path, Salesforce credentials)
- Seed default evals

**WebSocket Messages**:
- Sends: `dogfood:run`, `dogfood:run_with_analysis`, `eval:list`, `eval:create`, `eval:delete`, `eval:run`, `eval:generate`, `eval:import`, `eval:seed`, `eval:history`
- Receives: `dogfood:started`, `dogfood:progress`, `dogfood:results`, `dogfood:error`, `eval:list`, `eval:created`, `eval:deleted`, `eval:history`, `eval:import_done`

---

## `/features`

**Purpose**: Static guidebook page documenting all CTO Dashboard capabilities.

**Components**: All inline (not exported) — `FlowArrow`, `FlowNode`, `OrchestrationDiagram`, `StatusPill`, `TaskLifecycleDiagram`, `CollapsibleSection`, `FeatureCard`, `IntegrationCard`

**State**: `useState` only (for collapsible section toggles)

**Sections**:
1. **Hero**: Title, subtitle, description, blue accent divider
2. **Orchestration Flow**: CSS-based horizontal diagram (You → CTO Agent → Engineer ×N → GitHub PR)
3. **AI Orchestration**: CTO Agent, Engineer Agents, Model Selection, Natural Language → Tasks
4. **Task Management**: Task lifecycle diagram + Kanban Board, Priority System, Auto-Archive, Retry with Context
5. **Agentic Verification**: AI Diff Review, Branch Verification, PR Existence Check, Verification Warnings
6. **Integrations**: Notion, GitHub, Slack, GCP, Vanta, Twilio (3-col grid)
7. **Real-Time Monitoring**: Live Output, Token Analytics, Activity Timeline, Error Collection, Daily Check-ins
8. **Self-Testing**: 5 Test Types, Custom Evals, Visual Regression, CTO-Generated Scenarios
9. **Developer Experience**: Command Palette, Toast Notifications, Thread Chat, Setup Wizard, Hot Config Reload
10. **Footer**: Tagline

**WebSocket Messages**: None (pure static page)

---

## `/docs`

**Purpose**: Technical documentation and API reference sourced from specs/.

**Components**: All inline (not exported) — `DocSection`, `Table`, `Code`, `InlineCode`, `SubHeading`, `Paragraph`, `BulletList`, `FadeIn`

**State**: `useState` for active section tracking, `IntersectionObserver` for scroll-based TOC highlighting

**Layout**: Left-anchored sticky TOC sidebar (hidden on small screens) + main scrollable content area

**Sections** (12, mapping to spec files):
1. **Getting Started** — Quick overview, setup, tech stack (architecture.md + configuration.md)
2. **Architecture** — System diagram, ports, data flow, directory structure (architecture.md)
3. **Pages & Routes** — Route table, page descriptions (pages.md)
4. **Components** — Component tables, props, shared components (components.md)
5. **WebSocket Protocol** — Client→Server and Server→Client message tables (websocket-protocol.md)
6. **Data Models** — Firestore collections, TypeScript interfaces, status flow (data-models.md)
7. **Server Modules** — Module overview, CTO session, engineer pool (server.md)
8. **State Management** — Stores, hooks, optimistic updates (state-management.md)
9. **Integrations** — Notion, GitHub, GCP, Vanta, Slack, Twilio (integrations.md)
10. **Prompts** — CTO and engineer prompt structure, priority levels (prompts.md)
11. **Configuration** — Config layering, fields, secrets, side effects (configuration.md)
12. **Deployment** — Docker, Cloud Run, CI/CD, secrets (deployment.md)

**WebSocket Messages**: None (pure static page)
