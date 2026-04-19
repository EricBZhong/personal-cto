# Components

All components live under `src/components/`.

## Layout

### DashboardShell (`layout/DashboardShell.tsx`)

Root layout wrapper. Provides WebSocket context to all children.

- Creates the WebSocket connection via `useWebSocket()`
- Exposes `useWs()` hook via React Context (returns `{ send, connected }`)
- Renders `Sidebar` + main content area
- Renders `SetupWizardModal` when an integration needs setup
- Renders `ToastContainer` for toast notifications
- Renders `CommandPalette` for Cmd+K quick actions
- Initializes `useErrorReporter()` for frontend error capture

### Sidebar (`layout/Sidebar.tsx`)

Navigation sidebar with status indicators.

**Props**: `{ connected: boolean }`

**Nav Items** (13):
- Chat, Tasks, Projects, PR Reviews, Engineers, Compliance, Dogfood, Analytics, Activity, Slack, Features, Docs, Settings

**Dynamic Badges**:
- Tasks: count of "suggested" tasks (purple)
- Projects: count of active/planning projects (emerald)
- PR Reviews: count of PRs needing review (orange)
- Engineers: active count (blue)
- Slack: pending queue count (yellow)

**Footer**: System status (engineers active, daily tokens, active tasks), `⌘K` command palette hint, user info with sign-out button.

### Features Page Inline Components (`features/page.tsx`)

The `/features` page defines all its sub-components inline (not exported):
- `FlowArrow`, `FlowNode`, `OrchestrationDiagram` — CSS-based orchestration flow diagram
- `StatusPill`, `TaskLifecycleDiagram` — task status pipeline visualization
- `CollapsibleSection` — expandable section with accent-colored left border
- `FeatureCard` — icon + title + description + optional tip
- `IntegrationCard` — integration name with capability bullet list

### Docs Page Inline Components (`docs/page.tsx`)

The `/docs` page defines all its sub-components inline (not exported):
- `DocSection` — collapsible section with accent-colored left border and scroll-margin
- `Table` — styled HTML table with header and rows
- `Code` — monospace code block with dark background
- `InlineCode` — inline code snippet
- `SubHeading`, `Paragraph`, `BulletList` — typography helpers
- `FadeIn` — intersection observer fade-in animation

### Projects Page Inline Components (`projects/page.tsx`)

The `/projects` page defines all its sub-components inline (not exported):
- `ProjectGroup` — Group header with title and count, renders a list of `ProjectCard`
- `ProjectCard` — Project card with status badge (color-coded), autonomy level badge, phase progress bar, active phase indicator, stats row (tasks done, failed, tokens, repo)

### Project Detail Page Inline Components (`projects/[id]/page.tsx`)

The `/projects/[id]` page defines all its sub-components inline (not exported):
- `StatCard` — Small stat card with label and value
- `PhaseCard` — Phase timeline entry with status dot (pending=zinc, active=blue pulsing, completed=green, failed=red), border color, phase description, task progress bar, "Needs Approval" badge

### SessionWrapper (`SessionWrapper.tsx`)

NextAuth `SessionProvider` wrapper used in the root layout.

---

## Chat

### CTOChat (`chat/CTOChat.tsx`)

Full chat interface with thread management.

**Props**: `{ send, connected }`

**Features**:
- Thread sidebar with create/switch/delete
- Message list with auto-scroll to bottom
- Parses `<task_assignment>` JSON blocks from assistant messages
- Renders `TaskSuggestionCard` inline for each parsed task
- Model toggle (Sonnet/Opus) in the input bar
- Streaming indicator during CTO response

**State**: `useCTOChat()` hook

### MessageBubble (`chat/MessageBubble.tsx`)

Individual message display.

**Props**: `{ message: ChatMessage }`

**Rendering**:
- User messages: right-aligned, blue background
- Assistant messages: left-aligned, dark background
- Timestamp display
- Token usage badge for CTO messages (if `tokensUsed > 0`)
- Pulsing cursor animation when `isStreaming` is true

### ChatInput (`chat/ChatInput.tsx`)

Message input with model toggle.

**Props**: `{ onSend, onAbort, isStreaming, disabled, model, onToggleModel }`

**Features**:
- Auto-expanding textarea
- Model toggle button (Sonnet ↔ Opus)
- Send button (→) or Stop button (■) based on streaming state
- Enter to send, Shift+Enter for newline

---

## Tasks

### TaskBoard (`tasks/TaskBoard.tsx`)

Kanban board with column-based task display, per-project filtering, auto-archiving, and collapsible closed columns.

**Props**: `{ tasks, onApprove, onReject, onCancel, onSelect, onUpdatePriority }`

**Columns**: Suggested, Queued, In Progress, Verifying, In Review, Done, Closed (failed + cancelled)

**Project Filter**:
- Dropdown selector shown when tasks span multiple projects/repos
- Uses `task.project || task.repo` for grouping (project takes precedence over repo)
- Options: "All Projects" (default) + one entry per unique project/repo value
- Each option shows task count in parentheses
- Tasks with no project or repo are grouped under "default"
- When a specific project is selected, only that project's tasks appear in the kanban columns
- When "All Projects" is selected, repo tags are shown on each `TaskCard`

**Auto-Archive** (7 days):
- Closed tasks (done, failed, cancelled) with `updated_at` older than 7 days are automatically hidden from the board
- Tasks remain in Firestore and are accessible via direct URL or search
- Archived count displayed above the board (e.g. "12 archived tasks hidden (7d+)")

**Collapsible Columns**:
- Done and Closed columns are collapsible when they have more than 5 tasks
- Initially collapsed: only the 5 most recent tasks shown (sorted by `updated_at` descending)
- "Show N more" button expands to show all; "Show less" collapses back
- Active columns (Suggested, Queued, In Progress, In Review) are never collapsed

Groups tasks by status and renders `TaskCard` for each.

### TaskCard (`tasks/TaskCard.tsx`)

Individual task card in the kanban board.

**Props**: `{ task, onApprove, onReject, onCancel, onClick, onUpdatePriority, showRepo? }`

**Displays**:
- Repo tag (monospace label, shown when `showRepo` is true and task has a `repo`)
- Project tag (purple badge, shown when task has a `project`)
- Stale badge (amber "Stale (24h+)" badge for active tasks with >24h since last `updated_at`)
- Cost estimate ("Est. ~150K") displayed on suggested-status cards when `estimatedTokens` is set
- Title + truncated description
- Priority badge (P0=red, P1=orange, P2=blue, P3=gray)
- Model badge (opus=purple, sonnet=sky, haiku=zinc)
- Token usage badge (if > 0)
- Branch name
- PR link + download patch button (if PR exists)
- Error display (if failed)

**Actions**:
- Approve/Reject buttons (suggested status only)
- Cancel button (in_progress/queued/approved)

### TaskSuggestionCard (`tasks/TaskSuggestionCard.tsx`)

Inline task suggestion rendered within chat messages.

**Props**: `{ task: TaskSuggestion, send }`

**Features**:
- Expandable description toggle
- Editable priority and model dropdowns
- Approve/Reject buttons with animated collapse
- Decision state display (pending → approved/rejected)
- Sends `task:approve_by_title` or `task:reject_by_title`

### TaskDetailSidebar (`tasks/TaskDetailSidebar.tsx`)

Detailed task view panel (shown alongside the kanban board).

**Props**: Full task detail props + action callbacks including `onInteract?: (instruction: string) => void`

**Sections**:
- Task metadata grid (ID, branch, repo, model, tokens used, engineer, timestamps)
- Verification warning display (if `verification_warning` is present)
- Status context descriptions (what each status means)
- Action buttons (approve, reject, cancel, retry)
- Send Follow-up: textarea + button visible for `in_review`/`done`/`failed`/`cancelled` tasks. Sends follow-up instruction that respawns an engineer on the same branch.
- Status override dropdown with reason input
- Follow-up History: cyan-styled cards showing previous `source === 'interaction'` logs with timestamps
- Engineer summary logs (filtered by source="summary")
- Live engineer output with pulsing indicator (when active)
- Raw engineer output (collapsed toggle)
- System logs with timestamp + source color-coding (system=blue, engineer=green, stderr=red, summary=purple)
- PR download buttons (patch, ZIP)
- `EngineerTerminal` subcomponent (scrollable monospace output)

### TaskLog (`tasks/TaskLog.tsx`)

Monospace log display.

**Props**: `{ logs: TaskLog[], streamingOutput?: string }`

Renders each log entry with timestamp and source-based color coding.

---

## Engineers

### EngineerCard (`engineers/EngineerCard.tsx`)

Individual engineer instance display.

**Props**: `{ engineer, log?, onKill }`

**Displays**:
- Task title + model badge
- Elapsed time counter (updates every second)
- Token usage badge
- Token budget progress bar: shows usage against `engineerTokenBudget`. Blue when <80%, red when >=80%.
- Progress milestones (parsed from engineer output, e.g., "Cloned repo", "Created branch", "Running tests")
- Current activity indicator (what the engineer is doing right now)
- Live output window (last 2000 chars, monospace, dark background)
- Running status indicator (pulsing amber dot)
- Kill button (red)

---

## Shared

### StatusBadge (`shared/StatusBadge.tsx`)

Exports multiple badge components:

- **StatusBadge**: Task status with color mapping
  - suggested=yellow, approved=blue, queued=indigo, in_progress=amber, verifying=cyan, in_review=purple, done=green, failed=red, cancelled=gray
- **PriorityBadge**: P0=red, P1=orange, P2=blue, P3=gray
- **TokenBadge**: Token count in monospace (replaces old CostBadge)
- **ModelBadge**: opus=purple, sonnet=sky, haiku=zinc

### SetupWizard (`shared/SetupWizard.tsx`)

Multi-step modal for integration setup.

**Props**: `{ setup: SetupPrompt, onClose }`

**Features**:
- Step indicator bar
- Input fields per step (defined in `INTEGRATION_SETUPS` map)
- Input validation (all required fields must be filled)
- Help links for each integration
- Back/Next navigation, Connect button on final step
- Keyboard: Escape to close, Enter to proceed
- On completion: sends `config:update` with all field values

**Supported Integrations**: notion, slack, vanta, twilio, github

### Toast (`shared/Toast.tsx`)

Toast notification component rendered via `ToastContainer`.

**Features**:
- Displays success, error, warning, and info toasts
- Auto-dismiss with configurable duration
- Stack multiple toasts vertically
- Animate in/out transitions
- Driven by `useToastStore` (see state-management.md)

**Rendered by**: `DashboardShell` via `ToastContainer`

### Spinner (`ui/Spinner.tsx`)

Animated border spinner.

**Props**: `{ size?: 'sm' | 'md' | 'lg' }`

**Styles**: `border-zinc-500/30 border-t-zinc-400 animate-spin`

### EmptyState (`ui/EmptyState.tsx`)

Centered empty state card with optional CTA link.

**Props**: `{ icon: string, title: string, description: string, action?: { label: string, href: string } }`

### PageHeader (`ui/PageHeader.tsx`)

Consistent page header bar with optional badge, subtitle, and action buttons.

**Props**: `{ title: string, subtitle?: string, badge?: ReactNode, actions?: ReactNode }`

**Styles**: `border-b border-zinc-800` bottom bar, flex layout.

### FilterBar (`ui/FilterBar.tsx`)

Reusable filter/search/sort bar.

**Props**: `{ filters?, activeFilter?, onFilterChange?, sortOptions?, activeSort?, onSortChange?, searchPlaceholder?, searchValue?, onSearchChange? }`

**Filter Chips**: `bg-blue-600 text-white` (active), `bg-zinc-800 text-zinc-400` (inactive).

### ErrorBanner (`ui/ErrorBanner.tsx`)

Dismissable red error banner with optional auto-close.

**Props**: `{ message: string, onDismiss?: () => void, autoClose?: number }` (default autoClose: 10000ms)

### CommandPalette (`shared/CommandPalette.tsx`)

Keyboard-driven command palette overlay.

**Trigger**: `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux)

**Features**:
- Search/filter across commands
- Quick navigation to any page
- Quick actions: approve all tasks, kill all engineers, trigger check-in, etc.
- Keyboard navigation (arrow keys, Enter to select, Escape to close)
- Fuzzy search matching

**Rendered by**: `DashboardShell`

---

## Slack

### SlackMessageList (`slack/SlackMessageList.tsx`)

Conversation list with filter tabs.

**Features**:
- Filter tabs: All, Queued, Processed, Failed (with counts)
- List of `SlackMessageCard` items
- Empty state message

### SlackConversationDetail (`slack/SlackConversationDetail.tsx`)

Detailed conversation view.

**Props**: `{ conversation: SlackConversation }`

**Displays**:
- User name + status badge
- Message type (DM, Mention, Group)
- Slack deep link
- User message
- CTO response or "pending" indicator
- Metadata grid (received, processed, channel, user ID)

### SlackMessageCard (`slack/SlackMessageCard.tsx`)

Conversation card in the list.

**Props**: `{ conversation, selected, onClick }`

**Displays**:
- Type icon (envelope=DM, megaphone=mention, people=group)
- User name (truncated)
- Status badge
- Message preview (2-line clamp)
- Message type + time ago
