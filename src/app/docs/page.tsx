'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';

// ─── Sections ────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
  { id: 'architecture', label: 'Architecture', icon: '🏗️' },
  { id: 'pages', label: 'Pages & Routes', icon: '📄' },
  { id: 'components', label: 'Components', icon: '🧩' },
  { id: 'websocket', label: 'WebSocket Protocol', icon: '🔌' },
  { id: 'data-models', label: 'Data Models', icon: '💾' },
  { id: 'server', label: 'Server Modules', icon: '⚙️' },
  { id: 'state', label: 'State Management', icon: '🔄' },
  { id: 'integrations', label: 'Integrations', icon: '🔗' },
  { id: 'prompts', label: 'Prompts', icon: '🧠' },
  { id: 'configuration', label: 'Configuration', icon: '⚡' },
  { id: 'deployment', label: 'Deployment', icon: '☁️' },
] as const;

// ─── Utility Components ──────────────────────────────────────────────

function FadeIn({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.unobserve(entry.target); } },
      { threshold: 0.05 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}
    >
      {children}
    </div>
  );
}

function DocSection({
  id,
  title,
  icon,
  accentColor,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  icon: string;
  accentColor: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <FadeIn className="mb-5">
      <div id={id} className={`border-l-2 ${accentColor} rounded-r-xl bg-zinc-900/40 scroll-mt-6`}>
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-800/40 transition-colors group"
        >
          <span className="text-xl group-hover:scale-110 transition-transform">{icon}</span>
          <span className="text-lg font-semibold text-white flex-1">{title}</span>
          <span className={`text-zinc-500 text-sm transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        </button>
        <div
          className="grid transition-[grid-template-rows] duration-500 ease-in-out"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-5 pb-5 text-sm text-zinc-300 leading-relaxed">{children}</div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="text-left px-3 py-2 bg-zinc-800 text-zinc-300 font-medium border border-zinc-700 first:rounded-tl-lg last:rounded-tr-lg">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-zinc-800/40">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 border border-zinc-800 text-zinc-400 font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-zinc-950 ring-1 ring-zinc-800 rounded-xl px-4 py-3 my-3 overflow-x-auto text-xs font-mono text-zinc-300 leading-relaxed">
      {children}
    </pre>
  );
}

function InlineCode({ children }: { children: string }) {
  return <code className="bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>;
}

function SubHeading({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold text-white mt-5 mb-2">{children}</h3>;
}

function Paragraph({ children }: { children: ReactNode }) {
  return <p className="text-zinc-400 text-xs leading-relaxed mb-3">{children}</p>;
}

function BulletList({ items }: { items: (string | ReactNode)[] }) {
  return (
    <ul className="space-y-1.5 my-2 ml-1">
      {items.map((item, i) => (
        <li key={i} className="text-xs text-zinc-400 flex items-start gap-2">
          <span className="text-zinc-600 mt-0.5 flex-shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Section Content ─────────────────────────────────────────────────

function GettingStartedContent() {
  return (
    <>
      <Paragraph>
        The CTO Dashboard is an AI-powered engineering orchestrator. A CEO interacts with a &quot;CTO&quot; Claude agent
        that has full context on codebases, Notion, GitHub, GCP, and Vanta. The CTO breaks work into tasks,
        delegates to parallel &quot;Engineer&quot; Claude instances, and reports results through a real-time dashboard.
      </Paragraph>

      <SubHeading>Quick Start</SubHeading>
      <Code>{`# Install dependencies
npm install

# Start development (Next.js + Orchestrator)
npm run dev

# Or start individually
npm run dev:next     # Next.js on port 3100
npm run dev:server   # Orchestrator on port 3101`}</Code>

      <SubHeading>Tech Stack</SubHeading>
      <Table
        headers={['Layer', 'Technology']}
        rows={[
          ['Frontend', 'Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand'],
          ['Server', 'Node.js, WebSocket (ws), firebase-admin'],
          ['AI', 'Claude CLI (claude --print --output-format stream-json)'],
          ['Auth', 'NextAuth v5 (Google OAuth, configurable domain)'],
          ['Database', 'Google Firestore'],
          ['Deployment', 'Google Cloud Run, Docker'],
        ]}
      />

      <SubHeading>Key Concepts</SubHeading>
      <BulletList items={[
        'The CTO agent gathers live context from all integrations before every response',
        'Engineers are parallel Claude instances that clone repos, write code, and open PRs',
        'Tasks flow through a pipeline: suggested → approved → in_progress → in_review → done',
        'All communication between frontend and server happens over WebSocket',
        'Configuration is hot-reloadable — no server restart needed for most changes',
      ]} />
    </>
  );
}

function ArchitectureContent() {
  return (
    <>
      <SubHeading>System Overview</SubHeading>
      <Code>{`┌─────────────┐     WebSocket      ┌──────────────────┐     Claude CLI     ┌─────────────┐
│  Frontend    │ ◄──────────────► │   Orchestrator   │ ◄───────────────► │  CTO Agent  │
│  Next.js     │     (JSON)       │   (Node.js)      │   (stream-json)   │  (Claude)   │
│  Port 3100   │                  │   Port 3101      │                   └─────────────┘
└─────────────┘                  │                  │
                                  │   EventBus       │     Claude CLI     ┌─────────────┐
                                  │   ──────────►    │ ◄───────────────► │  Engineers   │
                                  │                  │   (×N parallel)    │  (Claude)   │
                                  └──────────────────┘                   └─────────────┘
                                          │
                                          ▼
                                  ┌──────────────────┐
                                  │    Firestore      │
                                  │    (Database)     │
                                  └──────────────────┘`}</Code>

      <SubHeading>Ports</SubHeading>
      <Table
        headers={['Service', 'Development', 'Production']}
        rows={[
          ['Next.js', '3100', '8080 (shared)'],
          ['WebSocket', '3101', '8080 on /ws path'],
          ['Twilio Webhooks', '3102', '3102'],
        ]}
      />

      <SubHeading>Data Flow: Chat Message</SubHeading>
      <BulletList items={[
        <>Frontend sends <InlineCode>chat:send</InlineCode> via WebSocket</>,
        'Orchestrator receives message, forwards to CTO session',
        'CTO session gathers context (Notion, GitHub, GCP, Vanta) in parallel via Promise.allSettled',
        'Spawns Claude CLI with context-enriched system prompt + last 20 messages',
        <>Streams response back via EventBus → WebSocket as <InlineCode>cto:chunk</InlineCode> events</>,
        <>On completion, emits <InlineCode>cto:done</InlineCode> with full text and token count</>,
      ]} />

      <SubHeading>Data Flow: Task Execution</SubHeading>
      <BulletList items={[
        <>CTO response contains <InlineCode>{'<task_assignment>'}</InlineCode> XML blocks</>,
        'Tasks appear as "suggested" on the kanban board',
        'User approves → task enters queue → engineer pool picks it up',
        'Engineer clones repo, creates branch, writes code, pushes, opens PR',
        'Verification step checks branch, diff, and PR existence',
        'Task moves to in_review (success) or failed (verification failed)',
      ]} />

      <SubHeading>Directory Structure</SubHeading>
      <Code>{`src/
├── app/            # Next.js pages (13 routes)
├── components/     # React components (layout, chat, tasks, engineers, shared)
├── hooks/          # Custom hooks (WebSocket, chat, tasks, error reporting)
├── stores/         # Zustand state stores
├── server/         # Orchestrator, CTO session, engineer pool, integrations
│   └── integrations/  # Notion, GitHub, GCP, Vanta, Slack, Twilio, Browser
└── types.ts        # Shared TypeScript interfaces`}</Code>
    </>
  );
}

function PagesContent() {
  return (
    <>
      <SubHeading>Route Map</SubHeading>
      <Table
        headers={['Route', 'File', 'Description']}
        rows={[
          ['/', 'page.tsx', 'Redirects to /chat'],
          ['/login', 'login/page.tsx', 'Google OAuth sign-in'],
          ['/chat', 'chat/page.tsx', 'CTO chat interface with streaming responses'],
          ['/tasks', 'tasks/page.tsx', 'Kanban task board with auto-archive'],
          ['/tasks/[id]', 'tasks/[id]/page.tsx', 'Task detail with engineer logs'],
          ['/engineers', 'engineers/page.tsx', 'Active engineer grid with live output'],
          ['/pr-reviews', 'pr-reviews/page.tsx', 'PR review interface with CTO AI review'],
          ['/compliance', 'compliance/page.tsx', 'SOC 2 compliance dashboard (Vanta)'],
          ['/analytics', 'analytics/page.tsx', 'Token usage tracking & metrics'],
          ['/activity', 'activity/page.tsx', 'Chronological activity timeline'],
          ['/settings', 'settings/page.tsx', 'Configuration panel'],
          ['/slack', 'slack/page.tsx', 'Slack conversation queue'],
          ['/dogfood', 'dogfood/page.tsx', 'Self-testing & benchmarks'],
          ['/features', 'features/page.tsx', 'Features guidebook'],
          ['/docs', 'docs/page.tsx', 'Technical documentation'],
        ]}
      />

      <SubHeading>Chat (/chat)</SubHeading>
      <Paragraph>
        Primary CTO interaction interface. Features thread management (create, switch, delete),
        model toggle (Sonnet/Opus) per message, streaming responses with cursor animation,
        and inline task suggestion cards parsed from CTO responses.
      </Paragraph>

      <SubHeading>Task Board (/tasks)</SubHeading>
      <Paragraph>
        Kanban board with columns: Suggested, Queued, In Progress, Verifying, In Review, Done, Closed (failed + cancelled).
        Supports per-project filtering, auto-archive (7 days), collapsible Done/Closed columns,
        priority badges, model badges, and direct approve/reject/cancel actions.
      </Paragraph>

      <SubHeading>Engineers (/engineers)</SubHeading>
      <Paragraph>
        Grid showing all active engineer Claude instances. Each card shows live terminal output (last 2000 chars),
        elapsed time, token usage, progress milestones, and a kill button.
      </Paragraph>

      <SubHeading>PR Reviews (/pr-reviews)</SubHeading>
      <Paragraph>
        Two-panel layout: PR list on the left, full diff with syntax highlighting on the right.
        Request CTO AI review, view structured verdicts (APPROVE/COMMENT/REQUEST_CHANGES),
        and take action (approve, merge via squash, comment) — all submitted to GitHub.
      </Paragraph>

      <SubHeading>Other Pages</SubHeading>
      <BulletList items={[
        <><strong className="text-white">Compliance</strong> — SOC 2 scoring, category breakdowns, failing controls, one-click audits</>,
        <><strong className="text-white">Analytics</strong> — Daily/30-day token usage, task status breakdown, top token consumers</>,
        <><strong className="text-white">Activity</strong> — Chronological feed of all system events (last 100)</>,
        <><strong className="text-white">Slack</strong> — DMs, mentions, group messages with filter tabs and CTO responses</>,
        <><strong className="text-white">Dogfood</strong> — 5 test suites, custom evals, visual regression, chaos monkey</>,
        <><strong className="text-white">Settings</strong> — All config fields with secret masking and hot reload</>,
      ]} />
    </>
  );
}

function ComponentsContent() {
  return (
    <>
      <SubHeading>Layout Components</SubHeading>
      <Table
        headers={['Component', 'File', 'Purpose']}
        rows={[
          ['DashboardShell', 'layout/DashboardShell.tsx', 'Root wrapper: WebSocket context, Sidebar, SetupWizard, Toasts, CommandPalette'],
          ['Sidebar', 'layout/Sidebar.tsx', 'Navigation with dynamic badges (tasks, PRs, engineers, Slack queue)'],
          ['SessionWrapper', 'SessionWrapper.tsx', 'NextAuth SessionProvider wrapper'],
        ]}
      />

      <SubHeading>Chat Components</SubHeading>
      <Table
        headers={['Component', 'Props', 'Purpose']}
        rows={[
          ['CTOChat', '{ send, connected }', 'Full chat UI with threading and inline task suggestions'],
          ['MessageBubble', '{ message: ChatMessage }', 'Individual message with token badge, streaming cursor'],
          ['ChatInput', '{ onSend, onAbort, isStreaming, model, ... }', 'Auto-expanding textarea with model toggle'],
        ]}
      />

      <SubHeading>Task Components</SubHeading>
      <Table
        headers={['Component', 'Props', 'Purpose']}
        rows={[
          ['TaskBoard', '{ tasks, onApprove, onReject, ... }', 'Kanban board with project filtering and auto-archive'],
          ['TaskCard', '{ task, onApprove, onReject, ... }', 'Individual card with priority/model/token badges'],
          ['TaskSuggestionCard', '{ task, send }', 'Inline chat task suggestion with approve/reject'],
          ['TaskDetailSidebar', '{ task, logs, onApprove, ... }', 'Full task detail with logs, follow-up, status override'],
        ]}
      />

      <SubHeading>Shared Components</SubHeading>
      <BulletList items={[
        <><strong className="text-white">StatusBadge</strong> — Task status, priority (P0-P3), token count, model badges with color coding</>,
        <><strong className="text-white">SetupWizard</strong> — Multi-step modal for Notion, Slack, Vanta, Twilio, GitHub integration setup</>,
        <><strong className="text-white">Toast</strong> — Auto-dismiss notifications (success, error, warning, info) stacked vertically</>,
        <><strong className="text-white">CommandPalette</strong> — Cmd+K overlay: fuzzy search, page navigation, bulk actions</>,
      ]} />
    </>
  );
}

function WebSocketContent() {
  return (
    <>
      <SubHeading>Connection</SubHeading>
      <Table
        headers={['Environment', 'URL']}
        rows={[
          ['Development', 'ws://localhost:3101'],
          ['Production', 'wss://{host}/ws'],
        ]}
      />
      <Paragraph>
        Auto-reconnect with exponential backoff: 2s initial delay, doubling up to 30s max.
        On reconnect, requests initial state (threads, chat history, tasks, engineers, status).
      </Paragraph>

      <SubHeading>Client → Server Messages</SubHeading>
      <Table
        headers={['Category', 'Message Types']}
        rows={[
          ['Chat', 'chat:send, chat:abort, chat:history, chat:clear'],
          ['Threads', 'thread:list, thread:create, thread:switch, thread:delete'],
          ['Tasks', 'task:approve, task:reject, task:cancel, task:retry, task:interact, task:list, task:get, task:logs, task:update_priority, task:set_status'],
          ['Engineers', 'engineer:list, engineer:kill, engineer:kill_all'],
          ['Config', 'config:get, config:update'],
          ['Notion', 'notion:tickets'],
          ['GitHub', 'github:prs, github:pr_diff'],
          ['GCP', 'gcp:health, gcp:logs'],
          ['Compliance', 'compliance:overview, compliance:failing'],
          ['Analytics', 'analytics:usage, analytics:activity'],
          ['Dogfood', 'dogfood:run, eval:list, eval:create, eval:run, eval:history, eval:seed, eval:import'],
          ['Slack', 'slack:status, slack:get_conversations, slack:reconnect'],
          ['PR Reviews', 'pr:list, pr:detail, pr:review, pr:approve, pr:merge, pr:comment'],
          ['Check-in', 'checkin:trigger, checkin:get_report, checkin:list_reports'],
        ]}
      />

      <SubHeading>Server → Client Messages</SubHeading>
      <Table
        headers={['Category', 'Message Types']}
        rows={[
          ['Chat', 'cto:chunk, cto:done, cto:error, cto:thinking, chat:history'],
          ['Tasks', 'task:created, task:updated, task:list, task:detail, task:logs, task:logs_updated'],
          ['Engineers', 'engineer:spawned, engineer:chunk, engineer:done, engineer:error, engineer:list'],
          ['System', 'system:status, setup:prompt, error'],
          ['Threads', 'thread:list, thread:created, thread:switched, thread:deleted'],
          ['Integrations', 'notion:tickets, github:prs, gcp:health, gcp:logs, compliance:overview, compliance:failing'],
          ['Analytics', 'analytics:usage, analytics:activity'],
          ['Slack', 'slack:conversations, slack:queue, slack:status, slack:task_action'],
          ['PR Reviews', 'pr:list, pr:detail, pr:review_started, pr:review_complete, pr:action_result'],
          ['Check-in', 'checkin:started, checkin:complete, checkin:error, checkin:report, checkin:reports'],
          ['Autonomous', 'clarification:sent, clarification:answered, strategy:posted, strategy:decided'],
        ]}
      />

      <SubHeading>Message Format</SubHeading>
      <Code>{`// Client → Server
{ "type": "chat:send", "payload": { "message": "Build a login page", "model": "sonnet" } }

// Server → Client (event data)
{ "type": "cto:chunk", "data": { "text": "I'll create...", "messageId": "abc-123" } }

// Server → Client (response data)
{ "type": "task:list", "payload": { "tasks": [...] } }`}</Code>
    </>
  );
}

function DataModelsContent() {
  return (
    <>
      <SubHeading>Firestore Collections</SubHeading>
      <Table
        headers={['Collection', 'Purpose', 'Key Fields']}
        rows={[
          ['tasks', 'Task CRUD + lifecycle', 'title, description, status, priority, branch, repo, model, engineer_id, tokens_used, pr_url, error'],
          ['tasks/{id}/logs', 'Engineer & system logs', 'source (system/engineer/stderr/summary/interaction), content, timestamp'],
          ['chatThreads', 'Conversation threads', 'title, created_at, updated_at'],
          ['chatThreads/{id}/messages', 'Thread messages', 'role, content, message_id, tokens_used, timestamp'],
          ['dailyTokens', 'Daily token tracking', 'date, total_tokens (FieldValue.increment)'],
          ['errorEvents', 'Error collection', 'source, level, message, stack, context, resolved'],
          ['clarificationRequests', 'CTO clarifications', 'ticket_title, questions, slack_user_id, status'],
          ['strategyPolls', 'Strategy decision polls', 'ticket_title, options, chosen_option, slack_ts'],
          ['slackMessageQueue', 'Offline Slack messages', 'slack_user_id, message_text, message_type, status'],
          ['dogfoodEvals', 'Test eval definitions', 'name, description, input, expectedBehavior, thresholds'],
          ['dailyReports', 'Daily check-in reports', 'date, summary, stats, suggestedTasks'],
        ]}
      />

      <SubHeading>Task Interface</SubHeading>
      <Code>{`interface Task {
  id: string;
  title: string;
  description: string;
  status: 'suggested' | 'approved' | 'queued' | 'in_progress'
        | 'verifying' | 'in_review' | 'done' | 'failed' | 'cancelled';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  branch?: string;
  repo?: string;
  model: string;
  engineer_id?: string;
  tokens_used: number;
  pr_url?: string;
  error?: string;
  verification_warning?: string;
  errors: string[];
  verification_warnings: string[];
  actioned_by?: string;
  action_reason?: string;
  notion_page_id?: string;
  created_at: string;
  updated_at: string;
}`}</Code>

      <SubHeading>Task Status Flow</SubHeading>
      <div className="flex flex-wrap items-center gap-1.5 my-3">
        {['suggested', 'approved', 'queued', 'in_progress', 'verifying', 'in_review', 'done'].map((s, i, arr) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`px-2 py-1 rounded-full text-[10px] font-medium ${
              s === 'suggested' ? 'bg-purple-500/20 text-purple-300' :
              s === 'approved' ? 'bg-blue-500/20 text-blue-300' :
              s === 'queued' ? 'bg-indigo-500/20 text-indigo-300' :
              s === 'in_progress' ? 'bg-amber-500/20 text-amber-300' :
              s === 'verifying' ? 'bg-cyan-500/20 text-cyan-300' :
              s === 'in_review' ? 'bg-purple-500/20 text-purple-300' :
              'bg-green-500/20 text-green-300'
            }`}>{s}</span>
            {i < arr.length - 1 && <span className="text-zinc-700 text-xs">→</span>}
          </span>
        ))}
      </div>

      <SubHeading>Other Key Interfaces</SubHeading>
      <Code>{`interface Engineer {
  id: string;
  taskId: string;
  taskTitle: string;
  model: string;
  startedAt: string;
  tokensUsed: number;
}

interface DashboardConfig {
  colbyRepoPath: string;
  ctoDashboardRepoPath: string;
  additionalRepoPaths: string[];
  claudeCliPath: string;
  ctoModel: string;
  engineerDefaultModel: string;
  engineerMaxConcurrent: number;
  // ... 16 more integration fields
}`}</Code>
    </>
  );
}

function ServerContent() {
  return (
    <>
      <SubHeading>Module Overview</SubHeading>
      <Table
        headers={['Module', 'File', 'Purpose']}
        rows={[
          ['Entry (Dev)', 'index.ts', 'Starts WS server on 3101, orchestrator, Slack/Twilio integration'],
          ['Entry (Prod)', 'production.ts', 'Single-port server: Next.js + WS on /ws, /health endpoint'],
          ['Orchestrator', 'orchestrator.ts', 'Central message router for 60+ WebSocket message types'],
          ['CTO Session', 'cto-session.ts', 'CTO Claude conversation lifecycle and context injection'],
          ['Engineer Pool', 'engineer-pool.ts', 'Parallel engineer spawning, queue processing, verification'],
          ['Task Queue', 'task-queue.ts', 'Task CRUD with Firestore + local cache, Notion sync'],
          ['Event Bus', 'event-bus.ts', 'Node.js EventEmitter for real-time broadcasting'],
          ['WS Server', 'ws-server.ts', 'Subscribes to EventBus, broadcasts JSON to all clients'],
          ['Config', 'config.ts', 'Layered config: defaults → env vars → config.json'],
          ['Claude Auth', 'claude-auth.ts', 'OAuth token extraction for subscription billing'],
          ['Error Collector', 'error-collector.ts', 'Frontend + backend error tracking to Firestore'],
          ['Daily Check-in', 'daily-checkin.ts', 'Scheduled CTO summary reports'],
        ]}
      />

      <SubHeading>CTO Session</SubHeading>
      <Paragraph>
        Manages the CTO Claude conversation. On each message: fetches thread history → stores user message →
        auto-titles new threads → gathers context from all integrations in parallel → spawns Claude CLI →
        streams response back → stores assistant message → tracks tokens.
      </Paragraph>
      <Code>{`// Claude CLI invocation
claude --print --verbose --output-format stream-json \\
  --model {ctoModel} --max-turns 300`}</Code>

      <SubHeading>Engineer Pool</SubHeading>
      <Paragraph>
        Polls every 3 seconds for approved/queued tasks. For each available slot: resolves repo path →
        creates branch → builds engineer prompt → spawns Claude CLI → streams output → verifies work →
        generates summary → posts to Notion.
      </Paragraph>
      <Code>{`// Engineer CLI invocation
claude --print --output-format stream-json \\
  --model {model} --no-session-persistence \\
  --max-turns 100 --permission-mode bypassPermissions \\
  --max-budget-usd {maxBudget}`}</Code>
      <Paragraph>
        Verification checks: branch pushed, PR exists, diff reviewed by Haiku.
        Engineers auto-timeout after 10 minutes.
      </Paragraph>

      <SubHeading>Orchestrator Message Routing</SubHeading>
      <Paragraph>
        The orchestrator handles 60+ message types across: chat, threads, tasks, engineers, config,
        integrations (Notion, GitHub, GCP), compliance, analytics, dogfood/evals, Slack, PR reviews,
        and daily check-ins.
      </Paragraph>
    </>
  );
}

function StateContent() {
  return (
    <>
      <SubHeading>Architecture</SubHeading>
      <Code>{`WebSocket Message → useWebSocket hook → Zustand Stores ↔ React Components`}</Code>

      <SubHeading>Stores</SubHeading>
      <Table
        headers={['Store', 'Key State', 'Key Actions']}
        rows={[
          ['useChatStore', 'messages, isStreaming, threads, activeThreadId', 'addMessage, startStreaming, appendChunk, finishStreaming, setThreads, switchToThread'],
          ['useTaskStore', 'tasks, selectedTaskId, taskLogs, optimisticUpdates', 'setTasks, addTask, updateTask, optimisticUpdate, confirmOptimistic, revertOptimistic'],
          ['useEngineerStore', 'engineers, systemStatus, engineerLogs, engineerProgress', 'setEngineers, addEngineer, removeEngineer, appendEngineerLog, setSystemStatus'],
          ['usePRStore', 'prs, selectedPR, prDetail, reviewInProgress', 'setPRs, setPRDetail, setReviewInProgress, setReviewComplete, handleActionResult'],
          ['useSlackStore', 'conversations, queue, filter, slackConnected', 'setConversations, setQueue, setSlackConnected'],
          ['useDogfoodStore', 'running, results, report, evals, evalHistory', 'setRunning, setResults, setError, handleEvalEvent'],
          ['useToastStore', 'toasts', 'addToast (auto-dismiss)'],
          ['useSetupStore', 'activeIntegration', 'openSetup, closeSetup'],
        ]}
      />

      <SubHeading>Hooks</SubHeading>
      <Table
        headers={['Hook', 'Returns', 'Purpose']}
        rows={[
          ['useWebSocket', '{ send, connected }', 'WebSocket connection, message routing to stores'],
          ['useCTOChat', '{ sendMessage, abort, model, ... }', 'Chat logic: send, abort, model toggle, thread CRUD'],
          ['useTasks', '{ approveTask, rejectTask, ... }', 'Task actions with optimistic updates'],
          ['useErrorReporter', '(void)', 'Captures console.error, window.onerror, unhandledrejection'],
        ]}
      />

      <SubHeading>Optimistic Updates</SubHeading>
      <Paragraph>
        Task actions (approve, reject, cancel) apply optimistic updates immediately in the store.
        When the server confirms via <InlineCode>task:updated</InlineCode>, the optimistic state is confirmed.
        If no confirmation arrives, the update auto-reverts after a timeout.
      </Paragraph>
    </>
  );
}

function IntegrationsContent() {
  return (
    <>
      <SubHeading>Integration Summary</SubHeading>
      <Table
        headers={['Integration', 'Module', 'Key Methods']}
        rows={[
          ['Notion', 'integrations/notion.ts', 'queryBoard(), createTicket(), updateTicketStatus(), appendToPage()'],
          ['GitHub', 'integrations/github.ts', 'getOpenPRs(), getPRDetails(), getPRDiff(), submitPRReview(), mergePR()'],
          ['GCP', 'integrations/gcp.ts', 'getServiceHealth(), getRecentLogs(), pingAllServices()'],
          ['Vanta', 'integrations/vanta.ts', 'getComplianceOverview(), getFailingControls()'],
          ['Slack', 'integrations/slack.ts', 'start(), stop(), sendDM(), postMessage(), buildStrategyPollBlocks()'],
          ['Twilio', 'integrations/twilio.ts', 'HTTP webhook on port 3102, TwiML voice/SMS responses'],
          ['Browser', 'integrations/browser.ts', 'getBrowserMCPArgs(), buildBrowserInstructions()'],
        ]}
      />

      <SubHeading>Notion (Bidirectional)</SubHeading>
      <BulletList items={[
        'Query engineering board tickets for CTO context',
        'Auto-create Notion tickets when tasks are created',
        'Schema-resilient sync — auto-retries without Status/Priority on schema mismatch',
        'Sync status changes back to Notion as tasks progress',
        'Post engineer completion summaries as page comments',
      ]} />

      <SubHeading>Slack</SubHeading>
      <BulletList items={[
        'Socket Mode for DMs, mentions, and group messages',
        'CTO auto-responds to incoming messages',
        'Block Kit approval buttons for task management from Slack',
        'Strategy polls with vote aggregation from thread replies',
        'Offline message queue — no messages lost during server restart',
        '2-hour periodic status updates to configured channel',
      ]} />

      <SubHeading>Configuration</SubHeading>
      <Paragraph>
        All integrations are optional and configured via the Settings page or environment variables.
        Unconfigured integrations trigger a setup wizard prompt. Slack and Twilio config changes
        automatically restart their respective services.
      </Paragraph>
    </>
  );
}

function PromptsContent() {
  return (
    <>
      <SubHeading>CTO System Prompt</SubHeading>
      <Paragraph>
        Built dynamically by <InlineCode>buildCTOSystemPrompt(context)</InlineCode> with live data from all integrations.
        The CTO receives full engineering context before every response.
      </Paragraph>
      <Table
        headers={['Context Parameter', 'Source']}
        rows={[
          ['activeTasks, recentTaskChanges', 'Task Queue'],
          ['recentPRs', 'GitHub integration'],
          ['notionSummary, detailedTicketContent', 'Notion integration'],
          ['gcpHealth', 'GCP integration'],
          ['complianceSummary', 'Vanta integration'],
          ['dailySpend, dailyBudget', 'Token tracking'],
          ['engineerCount, maxEngineers', 'Engineer pool'],
          ['pendingClarifications, pendingPolls', 'Clarification/Strategy trackers'],
        ]}
      />

      <SubHeading>Task Delegation Format</SubHeading>
      <Code>{`<task_assignment>
{
  "title": "Build user authentication",
  "description": "Add Google OAuth login...",
  "branch": "feature/user-auth",
  "model": "sonnet",
  "maxBudget": 1.50,
  "priority": "P1",
  "repo": "my-app"
}
</task_assignment>`}</Code>

      <SubHeading>Priority Levels</SubHeading>
      <Table
        headers={['Priority', 'Urgency', 'Default Model', 'Default Budget']}
        rows={[
          ['P0', 'Immediate — skip queue', 'Opus', 'Custom'],
          ['P1', 'Next in queue', 'Sonnet', '$2.00'],
          ['P2', 'Standard', 'Sonnet', '$1.50'],
          ['P3', 'Best effort', 'Haiku/Sonnet', '$1.00'],
        ]}
      />

      <SubHeading>Engineer Task Prompt</SubHeading>
      <Paragraph>
        Built by <InlineCode>buildEngineerPrompt(params)</InlineCode>. Engineers receive a 10-step instruction set:
      </Paragraph>
      <BulletList items={[
        'Set working directory and bootstrap GitHub auth',
        'Create branch from base (task/{taskId})',
        'Read relevant files before making changes',
        'Make focused, minimal changes',
        'Run tests and verify',
        'Commit with clear message',
        'Push branch and create PR',
        'Output PR URL in final message',
      ]} />
      <Paragraph>
        Strict rules: NEVER push to main, use --force, delete branches, or make out-of-scope changes.
      </Paragraph>

      <SubHeading>Post-Completion Pipeline</SubHeading>
      <BulletList items={[
        'Verification: branch pushed? PR exists? Diff reviewed by Haiku',
        'Summary: Haiku generates 3-8 bullet human-readable summary',
        'Status: in_review (success) or failed (verification issues)',
        'Notion: Completion comment posted to linked ticket',
      ]} />
    </>
  );
}

function ConfigurationContent() {
  return (
    <>
      <SubHeading>Config Layering</SubHeading>
      <Paragraph>
        Configuration is resolved in layers (later overrides earlier):
      </Paragraph>
      <BulletList items={[
        <><strong className="text-white">1. Hardcoded defaults</strong> — in <InlineCode>getDefaults()</InlineCode></>,
        <><strong className="text-white">2. Environment variables</strong> — standard env var mapping</>,
        <><strong className="text-white">3. data/config.json</strong> — persistent file overrides (empty strings filtered out)</>,
      ]} />

      <SubHeading>Config Fields</SubHeading>
      <Table
        headers={['Category', 'Fields']}
        rows={[
          ['Paths', 'colbyRepoPath, ctoDashboardRepoPath, additionalRepoPaths, claudeCliPath'],
          ['Models', 'ctoModel, engineerDefaultModel'],
          ['Resources', 'engineerMaxConcurrent, defaultBaseBranch'],
          ['Notion', 'notionApiKey*, notionBoardId'],
          ['Vanta', 'vantaApiKey*'],
          ['GitHub', 'githubRepo, githubToken*'],
          ['Twilio', 'twilioAccountSid*, twilioAuthToken*, twilioPhoneNumber, ceoPhoneNumber'],
          ['Slack', 'slackBotToken*, slackAppToken*, slackSigningSecret*, slackUpdateChannel'],
          ['Browser', 'browserAutomationEnabled, browserHeadless'],
          ['Auth', 'claudeOauthToken*'],
          ['Server', 'wsPort, nextPort'],
        ]}
      />
      <Paragraph>
        Fields marked with * are secret and display as <InlineCode>***</InlineCode> in the Settings UI.
        Submitting masked values does not overwrite the real secrets on the server.
      </Paragraph>

      <SubHeading>Side Effects</SubHeading>
      <BulletList items={[
        'Slack config changes → Slack bot automatically restarts',
        'Twilio config changes → Twilio webhook server restarts',
        'Most other changes take effect immediately without server restart',
      ]} />
    </>
  );
}

function DeploymentContent() {
  return (
    <>
      <SubHeading>Local Development</SubHeading>
      <Code>{`npm run dev          # Next.js (3100) + Orchestrator (3101) concurrently
npm run dev:next     # Next.js only
npm run dev:server   # Orchestrator only`}</Code>

      <SubHeading>Production Architecture</SubHeading>
      <Paragraph>
        In production, Next.js and WebSocket run on the same HTTP server and port (8080).
        WebSocket upgrades happen on the <InlineCode>/ws</InlineCode> path; everything else goes to Next.js.
        No reverse proxy needed — one container, one port.
      </Paragraph>

      <SubHeading>Docker</SubHeading>
      <BulletList items={[
        <>Base image: <InlineCode>node:20-slim</InlineCode></>,
        'Multi-stage build: builder (npm ci + build) → runner (slim)',
        'Installs git, curl, gh CLI, Claude CLI, tsx, typescript',
        <>Non-root user: <InlineCode>appuser</InlineCode></>,
        'Health check: curl -f http://localhost:8080/health',
      ]} />

      <SubHeading>Cloud Run Configuration</SubHeading>
      <Table
        headers={['Setting', 'Value']}
        rows={[
          ['Region', 'us-central1'],
          ['Memory', '4Gi'],
          ['CPU', '2'],
          ['Min instances', '1'],
          ['Max instances', '5'],
          ['Timeout', '900s (15 min)'],
          ['Session affinity', 'Enabled (WebSocket sticky sessions)'],
          ['Next.js output', 'standalone'],
        ]}
      />

      <SubHeading>CI/CD Pipeline</SubHeading>
      <Paragraph>
        GitHub Actions workflow with 4 stages:
      </Paragraph>
      <BulletList items={[
        <><strong className="text-white">build</strong> — Docker image → Artifact Registry</>,
        <><strong className="text-white">smoke-test</strong> — Verify /health, frontend HTML, Claude CLI</>,
        <><strong className="text-white">deploy</strong> — Cloud Run deployment</>,
        <><strong className="text-white">post-deploy</strong> — Verify deployed service is healthy</>,
      ]} />

      <SubHeading>Secrets (GCP Secret Manager)</SubHeading>
      <Paragraph>
        CLAUDE_OAUTH_TOKEN, GH_TOKEN, NOTION_API_KEY, VANTA_API_KEY, SLACK_BOT_TOKEN, SLACK_APP_TOKEN,
        TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SF_PASSWORD, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
      </Paragraph>

      <SubHeading>Engineer Behavior in Production</SubHeading>
      <Paragraph>
        Engineers cannot access local repo paths in Cloud Run. They clone via token-authenticated HTTPS URLs
        (<InlineCode>x-access-token</InlineCode>) into temporary directories. Temp dirs are cleaned up after
        task completion.
      </Paragraph>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, string> = {
  'getting-started': 'border-l-green-500',
  'architecture': 'border-l-blue-500',
  'pages': 'border-l-indigo-500',
  'components': 'border-l-violet-500',
  'websocket': 'border-l-purple-500',
  'data-models': 'border-l-pink-500',
  'server': 'border-l-amber-500',
  'state': 'border-l-cyan-500',
  'integrations': 'border-l-emerald-500',
  'prompts': 'border-l-orange-500',
  'configuration': 'border-l-yellow-500',
  'deployment': 'border-l-slate-500',
};

const SECTION_CONTENT: Record<string, () => ReactNode> = {
  'getting-started': GettingStartedContent,
  'architecture': ArchitectureContent,
  'pages': PagesContent,
  'components': ComponentsContent,
  'websocket': WebSocketContent,
  'data-models': DataModelsContent,
  'server': ServerContent,
  'state': StateContent,
  'integrations': IntegrationsContent,
  'prompts': PromptsContent,
  'configuration': ConfigurationContent,
  'deployment': DeploymentContent,
};

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState<string>('getting-started');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* TOC Sidebar */}
      <nav className="w-56 flex-shrink-0 border-r border-zinc-800 bg-zinc-950/50 overflow-y-auto py-6 px-3 hidden lg:block">
        <h2 className="text-[10px] font-medium text-zinc-500 uppercase tracking-[0.2em] mb-4 px-2">
          Documentation
        </h2>
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => scrollTo(section.id)}
            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors mb-0.5 flex items-center gap-2 ${
              activeSection === section.id
                ? 'bg-zinc-800 text-white font-medium'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
            }`}
          >
            <span className="text-sm">{section.icon}</span>
            {section.label}
          </button>
        ))}
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-10">
          {/* Header */}
          <FadeIn>
            <div className="mb-10">
              <h1 className="text-3xl font-bold text-white">Documentation</h1>
              <p className="text-sm text-zinc-400 mt-2">
                Technical reference for the CTO Dashboard — architecture, APIs, data models, and deployment.
              </p>
              <div className="mt-4 h-px w-24" style={{
                background: 'linear-gradient(90deg, #3b82f6, transparent)',
              }} />
            </div>
          </FadeIn>

          {/* Sections */}
          {SECTIONS.map((section) => {
            const Content = SECTION_CONTENT[section.id];
            return (
              <DocSection
                key={section.id}
                id={section.id}
                title={section.label}
                icon={section.icon}
                accentColor={SECTION_COLORS[section.id]}
                defaultOpen={section.id === 'getting-started'}
              >
                <Content />
              </DocSection>
            );
          })}

          {/* Footer */}
          <FadeIn>
            <div className="mt-10 text-center">
              <div className="mx-auto mb-3 h-px w-32" style={{
                background: 'linear-gradient(90deg, transparent, rgba(161, 161, 170, 0.2), transparent)',
              }} />
              <p className="text-xs text-zinc-600">
                Generated from specs/ &middot; CTO Dashboard
              </p>
            </div>
          </FadeIn>
        </div>
      </main>
    </div>
  );
}
