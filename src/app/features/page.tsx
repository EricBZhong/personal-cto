'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';

// ─── CSS Animations ─────────────────────────────────────────────────

function AnimationStyles() {
  return (
    <style>{`
      @keyframes gradient-shift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      @keyframes flow-dot {
        0% { left: 0; opacity: 0; }
        15% { opacity: 1; }
        85% { opacity: 1; }
        100% { left: calc(100% - 6px); opacity: 0; }
      }
      @keyframes glow-pulse {
        0%, 100% { box-shadow: 0 0 8px rgba(var(--glow-rgb), 0.15); }
        50% { box-shadow: 0 0 24px rgba(var(--glow-rgb), 0.35); }
      }
      @keyframes fade-in-up {
        from { opacity: 0; transform: translateY(24px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes pulse-ring {
        0% { transform: scale(0.95); opacity: 0.7; }
        50% { transform: scale(1.05); opacity: 0.3; }
        100% { transform: scale(0.95); opacity: 0.7; }
      }
      @keyframes loop-dash {
        to { stroke-dashoffset: -20; }
      }
      .gradient-text {
        background: linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899, #3b82f6);
        background-size: 300% 300%;
        animation: gradient-shift 6s ease infinite;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
      .feature-card {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .feature-card:hover {
        transform: translateY(-3px);
        border-color: rgba(var(--accent-rgb, 161, 161, 170), 0.35);
        box-shadow: 0 12px 40px rgba(var(--accent-rgb, 0, 0, 0), 0.12),
                    0 0 0 1px rgba(var(--accent-rgb, 0, 0, 0), 0.06);
      }
      .integration-card {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .integration-card:hover {
        transform: translateY(-3px) scale(1.01);
        border-color: rgba(34, 197, 94, 0.3);
        box-shadow: 0 12px 40px rgba(34, 197, 94, 0.08);
      }
      .flow-node {
        transition: all 0.3s ease;
      }
      .flow-node:hover {
        transform: scale(1.08);
      }
      .section-enter {
        animation: fade-in-up 0.4s ease-out forwards;
      }
      .dot-bg {
        background-image: radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px);
        background-size: 24px 24px;
      }
      .chaos-pill {
        transition: all 0.2s ease;
      }
      .chaos-pill:hover {
        transform: scale(1.08);
        filter: brightness(1.3);
      }
    `}</style>
  );
}

// ─── Scroll Animation Hook ──────────────────────────────────────────

function FadeIn({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.unobserve(entry.target); } },
      { threshold: 0.08 }
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
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.7s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, transform 0.7s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ─── Flow Diagram ───────────────────────────────────────────────────

function FlowArrow() {
  return (
    <div className="flex items-center mx-1 sm:mx-3 flex-shrink-0 relative" style={{ width: '48px' }}>
      <div className="w-full h-0.5 bg-zinc-700" />
      <div
        className="absolute w-1.5 h-1.5 rounded-full bg-blue-400"
        style={{ animation: 'flow-dot 2s ease-in-out infinite' }}
      />
      <div className="absolute right-0 w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] border-l-zinc-600" />
    </div>
  );
}

function FlowNode({ label, sublabel, emoji, glowRgb }: { label: string; sublabel: string; emoji: string; glowRgb: string }) {
  return (
    <div className="relative group">
      <div
        className="absolute -inset-1 rounded-xl opacity-0 group-hover:opacity-100 blur-lg transition-opacity duration-500"
        style={{ background: `rgba(${glowRgb}, 0.2)` }}
      />
      <div
        className="flow-node relative bg-zinc-900 border border-zinc-800 rounded-xl p-3 sm:p-4 min-w-[110px] text-center"
        style={{ borderTopWidth: '2px', borderTopColor: `rgba(${glowRgb}, 0.8)`, '--glow-rgb': glowRgb } as React.CSSProperties}
      >
        <div className="text-2xl mb-1">{emoji}</div>
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-[11px] text-zinc-500 mt-0.5">{sublabel}</div>
      </div>
    </div>
  );
}

function OrchestrationDiagram() {
  return (
    <FadeIn delay={200}>
      <div className="overflow-x-auto py-6 px-2">
        <div className="flex items-center justify-center min-w-[560px]">
          <FlowNode emoji="👤" label="You" sublabel="CEO / User" glowRgb="59, 130, 246" />
          <FlowArrow />
          <FlowNode emoji="🧠" label="CTO Agent" sublabel="Context & Routing" glowRgb="168, 85, 247" />
          <FlowArrow />
          <FlowNode emoji="👷" label="Engineer ×N" sublabel="Parallel Execution" glowRgb="245, 158, 11" />
          <FlowArrow />
          <FlowNode emoji="🚀" label="GitHub PR" sublabel="Code Delivered" glowRgb="34, 197, 94" />
        </div>
      </div>
    </FadeIn>
  );
}

// ─── Clarification Loop Diagram ─────────────────────────────────────

function ClarificationLoopDiagram() {
  return (
    <div className="relative bg-zinc-950 rounded-xl border border-zinc-800 p-5 my-4 overflow-hidden">
      <div className="absolute inset-0 dot-bg opacity-50" />
      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-3 relative">Autonomous Clarification Loop</p>
      <div className="relative flex items-center justify-center gap-2 flex-wrap text-xs">
        {[
          { label: 'CTO detects ambiguity', bg: 'bg-purple-500/20', text: 'text-purple-300' },
          { label: 'Slack DM to creator', bg: 'bg-indigo-500/20', text: 'text-indigo-300' },
          { label: 'Creator replies in thread', bg: 'bg-blue-500/20', text: 'text-blue-300' },
          { label: 'Comment posted to Notion', bg: 'bg-green-500/20', text: 'text-green-300' },
        ].map((step, i, arr) => (
          <div key={step.label} className="flex items-center gap-2">
            <span className={`${step.bg} ${step.text} px-2.5 py-1.5 rounded-lg font-medium`}>{step.label}</span>
            {i < arr.length - 1 && <span className="text-zinc-600">→</span>}
          </div>
        ))}
        <span className="text-zinc-600">↩</span>
      </div>
      <p className="text-[10px] text-zinc-600 text-center mt-3 relative italic">
        No human orchestration — CTO autonomously seeks missing context and routes it back
      </p>
    </div>
  );
}

// ─── Task Lifecycle Diagram ─────────────────────────────────────────

function StatusPill({ label, color, index }: { label: string; color: string; index: number }) {
  return (
    <span
      className={`px-2.5 py-1.5 rounded-full text-xs font-medium ${color} transition-all duration-300 hover:scale-110 cursor-default`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      {label}
    </span>
  );
}

function TaskLifecycleDiagram() {
  const statuses = [
    { label: 'suggested', color: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' },
    { label: 'approved', color: 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' },
    { label: 'queued', color: 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30' },
    { label: 'in_progress', color: 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' },
    { label: 'verifying', color: 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30' },
    { label: 'in_review', color: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30' },
    { label: 'done', color: 'bg-green-500/20 text-green-300 hover:bg-green-500/30' },
  ];

  return (
    <div className="bg-zinc-950 rounded-xl border border-zinc-800 p-4 my-3">
      <div className="overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-[620px] justify-center">
          {statuses.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <StatusPill label={s.label} color={s.color} index={i} />
              {i < statuses.length - 1 && (
                <span className="text-zinc-700 text-xs">→</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Chaos Monkey Scenario Grid ─────────────────────────────────────

function ChaosMonkeyGrid() {
  const scenarios = [
    { label: 'Unicode 中文', color: 'bg-purple-500/15 text-purple-300' },
    { label: 'Emoji Flood 😈', color: 'bg-pink-500/15 text-pink-300' },
    { label: '10K+ Chars', color: 'bg-blue-500/15 text-blue-300' },
    { label: 'Empty Input', color: 'bg-zinc-500/15 text-zinc-300' },
    { label: 'XSS Inject', color: 'bg-red-500/15 text-red-300' },
    { label: 'SQL Inject', color: 'bg-orange-500/15 text-orange-300' },
    { label: 'Rapid Fire ×5', color: 'bg-amber-500/15 text-amber-300' },
    { label: 'Viewport Resize', color: 'bg-cyan-500/15 text-cyan-300' },
    { label: 'Console Errors', color: 'bg-yellow-500/15 text-yellow-300' },
    { label: 'Markdown Stress', color: 'bg-green-500/15 text-green-300' },
    { label: 'Arabic عربي', color: 'bg-indigo-500/15 text-indigo-300' },
    { label: 'Network Failure', color: 'bg-rose-500/15 text-rose-300' },
  ];
  return (
    <div className="flex flex-wrap gap-2 my-3">
      {scenarios.map(s => (
        <span key={s.label} className={`chaos-pill ${s.color} px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-default`}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

// ─── Section Components ─────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  accentColor,
  accentRgb,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  accentColor: string;
  accentRgb: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <FadeIn className="mb-5">
      <div
        className={`border-l-2 ${accentColor} rounded-r-xl bg-zinc-900/40 backdrop-blur-sm overflow-hidden`}
        style={{ '--accent-rgb': accentRgb } as React.CSSProperties}
      >
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-zinc-800/40 transition-all duration-300 group"
        >
          <span className="text-xl group-hover:scale-110 transition-transform duration-300">{icon}</span>
          <span className="text-lg font-semibold text-white flex-1">{title}</span>
          <span
            className={`text-zinc-500 text-sm transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
        </button>
        <div
          className="grid transition-[grid-template-rows] duration-500 ease-in-out"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-5 pb-5">{children}</div>
          </div>
        </div>
      </div>
    </FadeIn>
  );
}

function FeatureCard({ icon, title, description, tip }: { icon: string; title: string; description: string; tip?: string }) {
  return (
    <div className="feature-card bg-zinc-900 rounded-xl border border-zinc-800 p-4 cursor-default">
      <div className="flex items-start gap-3">
        <span className="text-xl mt-0.5 flex-shrink-0">{icon}</span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white">{title}</h4>
          <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{description}</p>
          {tip && <p className="text-xs text-blue-400/80 italic mt-2">{tip}</p>}
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({ icon, name, capabilities }: { icon: string; name: string; capabilities: string[] }) {
  return (
    <div className="integration-card bg-zinc-900 rounded-xl border border-zinc-800 p-4 cursor-default">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-2xl">{icon}</span>
        <h4 className="text-sm font-semibold text-white">{name}</h4>
      </div>
      <ul className="space-y-1.5">
        {capabilities.map((cap) => (
          <li key={cap} className="text-xs text-zinc-400 flex items-start gap-2">
            <span className="text-zinc-600 mt-0.5 flex-shrink-0">•</span>
            <span>{cap}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="text-center px-4 py-3">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-zinc-500 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function FeaturesPage() {
  return (
    <div className="h-full overflow-y-auto dot-bg">
      <AnimationStyles />
      <div className="max-w-5xl mx-auto px-6 py-12">

        {/* ════════ Hero ════════ */}
        <FadeIn>
          <div className="mb-12 text-center">
            <h1 className="text-4xl sm:text-5xl font-bold gradient-text pb-1">
              CTO Dashboard
            </h1>
            <p className="text-lg text-zinc-400 mt-3">AI-Powered Engineering Orchestrator</p>
            <p className="text-sm text-zinc-500 mt-4 max-w-2xl mx-auto leading-relaxed">
              A CEO-facing interface to a &quot;CTO&quot; Claude agent with full context on your
              codebases, Notion, GitHub, GCP, and Vanta. The CTO breaks work into tasks,
              delegates to parallel Engineer Claude instances, verifies output, and delivers
              production-ready pull requests — autonomously.
            </p>
            <div className="mx-auto mt-6 h-px w-32" style={{
              background: 'linear-gradient(90deg, transparent, #3b82f6, #8b5cf6, transparent)',
            }} />
          </div>
        </FadeIn>

        {/* ════════ Stats Bar ════════ */}
        <FadeIn delay={100}>
          <div className="flex justify-center flex-wrap gap-2 mb-10 bg-zinc-900/60 rounded-2xl border border-zinc-800 py-2 backdrop-blur-sm">
            <StatCard value="7" label="Integrations" color="text-green-400" />
            <StatCard value="∞" label="Parallel Agents" color="text-amber-400" />
            <StatCard value="12" label="Resilience Tests" color="text-red-400" />
            <StatCard value="7" label="Status Pipeline" color="text-blue-400" />
            <StatCard value="24/7" label="Autonomous" color="text-purple-400" />
          </div>
        </FadeIn>

        {/* ════════ Orchestration Flow ════════ */}
        <div className="mb-12">
          <FadeIn>
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-[0.2em] mb-2 text-center">
              How It Works
            </h2>
          </FadeIn>
          <OrchestrationDiagram />
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 1: AI Orchestration
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="AI Orchestration" icon="🧠" accentColor="border-l-purple-500" accentRgb="168, 85, 247">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🤖"
              title="CTO Agent with Full Context Injection"
              description="Gathers live context from Notion, GitHub, GCP, and Vanta in parallel (Promise.allSettled) at startup. The CTO sees your entire engineering landscape — board tickets, open PRs, deploy health, and compliance gaps — before answering."
              tip={'Try: "What\'s the status of our engineering board?"'}
            />
            <FeatureCard
              icon="👷"
              title="Parallel Engineer Agents"
              description="The CTO spawns multiple Engineer Claude instances simultaneously. Each clones a repo, creates a branch, writes code, runs tests, and opens a PR. A spawning counter prevents over-allocation race conditions."
            />
            <FeatureCard
              icon="🎛️"
              title="Intelligent Model Selection"
              description="Choose Sonnet (fast), Opus (max capability), or Haiku (lightweight) per message or per engineer. The CTO proactively suggests upgrading to Opus when it detects task complexity warrants it."
            />
            <FeatureCard
              icon="💬"
              title="Natural Language → Structured Tasks"
              description="Describe work in plain English. The CTO parses intent into structured assignments with titles, descriptions, priorities, repo targets, and model recommendations via XML task blocks."
              tip={'Try: "Build a login page with Google OAuth on the main repo"'}
            />
            <FeatureCard
              icon="🧵"
              title="Conversation History Injection"
              description="The CTO receives the last 20 messages from the current thread injected into its system prompt, giving full conversational context — not just the latest message."
            />
            <FeatureCard
              icon="💰"
              title="Subscription Auth Optimization"
              description="Extracts OAuth tokens from macOS Keychain to route all Claude usage through subscription billing instead of per-token API charges. Strips ANTHROPIC_API_KEY from engineer environments to enforce this."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 2: Autonomous Operations
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Autonomous Operations" icon="🔮" accentColor="border-l-violet-500" accentRgb="139, 92, 246">
          <ClarificationLoopDiagram />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="❓"
              title="Autonomous Clarification Requests"
              description="When the CTO encounters an ambiguous Notion ticket, it emits a <clarification_request>, DMs the ticket creator on Slack, tracks the thread, and posts the reply back as a Notion comment. Fully autonomous — no human routing needed."
            />
            <FeatureCard
              icon="🗳️"
              title="Strategy Polls"
              description="The CTO posts architecture and strategy decision polls to Slack channels via <strategy_poll> blocks. Thread replies are matched to options, and the CTO receives aggregated results for decision-making."
            />
            <FeatureCard
              icon="🔧"
              title="Auto-Fix from Error Collection"
              description="Collected errors automatically generate P1 fix tasks with diagnostic context. 5-minute dedup fingerprinting prevents duplicates. Cascading prevention blocks auto-fix tasks from spawning more auto-fix tasks."
            />
            <FeatureCard
              icon="📄"
              title="AI Work Summaries"
              description="After each engineer completes, a Haiku instance generates a human-readable summary — files changed, approach taken, PR created. Posted to the dashboard, the Notion ticket, and linked in the PR."
            />
            <FeatureCard
              icon="🔄"
              title="Self-Improvement"
              description='The CTO can assign tasks targeting its own codebase with "repo": "cto-dashboard". When it identifies needed improvements — better prompts, new features, bug fixes — it creates tasks for engineers to implement them.'
            />
            <FeatureCard
              icon="⏰"
              title="Periodic Status Updates"
              description="Every 2 hours, the system automatically posts a status update to Slack with current task counts, active engineers, and system health. Keeps the team informed without anyone checking the dashboard."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 3: Task Management
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Task Management" icon="📋" accentColor="border-l-blue-500" accentRgb="59, 130, 246">
          <div className="mb-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Task Lifecycle Pipeline</p>
            <TaskLifecycleDiagram />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="📊"
              title="Kanban Board with Project Filtering"
              description="Visual task board with columns for each status. Filter by project when tasks span multiple repos. Each project shows task count. 'All Projects' view displays repo tags on every card."
            />
            <FeatureCard
              icon="🎯"
              title="Priority-Ordered Dequeue"
              description="Tasks aren't FIFO — they dequeue in priority order: P0 (critical) first, then P1, P2, P3. Within the same priority, insertion order is preserved. Critical work always gets picked up first."
            />
            <FeatureCard
              icon="📦"
              title="Auto-Archive (7 Days)"
              description="Completed and closed tasks auto-archive after 7 days, keeping the board clean. Archived count shown above the board. Tasks remain in Firestore and are accessible via direct URL."
            />
            <FeatureCard
              icon="🔄"
              title="Retry with Error Context"
              description="Failed tasks can be retried with the original error injected into the new engineer's prompt. The system includes known fix patterns (common CLI gotchas, environment issues) so the retry learns from failure."
            />
            <FeatureCard
              icon="💬"
              title="Follow-Up Instructions"
              description='Send follow-up instructions to completed, failed, or in-review tasks. A new engineer spawns on the same branch with full context from the previous attempt plus your new instruction. Works like "fix the merge conflict" or "add tests for the new endpoint".'
              tip="Available in the task detail sidebar and task detail page for in_review, done, failed, or cancelled tasks."
            />
            <FeatureCard
              icon="⚡"
              title="Bulk Actions"
              description="Approve all suggested tasks at once or kill all running engineers with a single action. Available via the Command Palette (Cmd+K) or WebSocket commands."
            />
            <FeatureCard
              icon="📝"
              title="Task Attribution & Audit Trail"
              description="Every task card shows who took action (actioned_by), when, and why (action_reason). Full audit trail of approvals, rejections, cancellations, and status changes."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 4: Agentic Verification
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Agentic Verification" icon="✅" accentColor="border-l-cyan-500" accentRgb="34, 211, 238">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🔍"
              title="AI Diff Review"
              description="After an engineer finishes, the system reviews the git diff to verify changes match the task requirements. Catches off-target implementations before they reach review."
            />
            <FeatureCard
              icon="🌿"
              title="Branch Verification"
              description="Checks that the engineer created and pushed the correct branch with meaningful commits — not empty, placeholder, or misnamed branches."
            />
            <FeatureCard
              icon="🔗"
              title="PR Existence Check"
              description="Verifies a pull request was actually created on GitHub and links it to the task. Detects cases where the engineer claimed to open a PR but didn't."
            />
            <FeatureCard
              icon="⚠️"
              title="Verification Warnings"
              description="When verification detects issues — missing PR, empty diff, wrong branch, failed tests — warnings surface on the task card with actionable context for investigation."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 5: Slack Intelligence
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Slack Intelligence" icon="💬" accentColor="border-l-indigo-500" accentRgb="99, 102, 241" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="✅"
              title="Interactive Approval Buttons"
              description="When the CTO suggests tasks, Slack notifications include Block Kit buttons for Approve and Reject. Manage the entire task queue from Slack without opening the dashboard."
            />
            <FeatureCard
              icon="📨"
              title="Offline Message Queue"
              description='When the CTO is unavailable (restart, crash), incoming Slack messages queue up. When the CTO recovers, queued messages drain with a "Sorry for the delay" prefix — no messages are ever lost.'
            />
            <FeatureCard
              icon="🔔"
              title="2-Hour Status Updates"
              description="Automatic status broadcasts every 2 hours to your configured Slack channel: task counts, active engineers, system health. The team stays informed passively."
            />
            <FeatureCard
              icon="🔀"
              title="Clarification Thread Routing"
              description="Slack thread replies to clarification DMs are automatically routed back to the CTO and posted as comments on the original Notion page. Context flows between tools seamlessly."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 6: Integrations
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Integrations" icon="🔌" accentColor="border-l-green-500" accentRgb="34, 197, 94" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <IntegrationCard
              icon="📝"
              name="Notion (Bidirectional)"
              capabilities={[
                'Query engineering board tickets',
                'Auto-create Notion tickets for dashboard tasks',
                'Schema-resilient sync — auto-retries without Status/Priority on schema mismatch',
                'Sync status changes back to Notion',
                'Post engineer summaries as comments',
                'Look up ticket creators for clarification routing',
              ]}
            />
            <IntegrationCard
              icon="🐙"
              name="GitHub"
              capabilities={[
                'Create & review pull requests',
                'Check CI/CD status',
                'View diffs and commit history',
                'Merge via squash',
                'Token-authenticated cloning for Cloud Run',
              ]}
            />
            <IntegrationCard
              icon="💬"
              name="Slack"
              capabilities={[
                'DMs, mentions, and group messages',
                'Auto-respond via CTO agent',
                'Block Kit approval buttons',
                'Strategy polls with vote aggregation',
                'Offline message queue with recovery',
              ]}
            />
            <IntegrationCard
              icon="☁️"
              name="GCP"
              capabilities={[
                'Cloud Run health checks',
                'View service logs',
                'Monitor deployment status',
                'Production environment management',
              ]}
            />
            <IntegrationCard
              icon="🛡️"
              name="Vanta"
              capabilities={[
                'SOC 2 compliance scoring',
                'Failing control alerts',
                'One-click audit actions (access, encryption, logging)',
                'Per-control "Ask CTO to fix" buttons',
              ]}
            />
            <IntegrationCard
              icon="📞"
              name="Twilio"
              capabilities={[
                'Call the CTO by phone',
                'Text commands via SMS',
                'Voice-to-task pipeline',
              ]}
            />
            <IntegrationCard
              icon="🌐"
              name="Browser (Playwright MCP)"
              capabilities={[
                'Navigate web pages, click, fill forms',
                'Capture screenshots and console output',
                'Engineers get browser automation for web UI tasks',
                'Used in dogfood testing and extension testing',
              ]}
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 7: Real-Time Monitoring
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Real-Time Monitoring" icon="📡" accentColor="border-l-amber-500" accentRgb="245, 158, 11" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🖥️"
              title="Live Engineer Terminal"
              description="Watch each engineer's output in real time — files being edited, tests running, commits being made. Last 2000 chars displayed in a monospace terminal view with elapsed time counter."
            />
            <FeatureCard
              icon="📊"
              title="Token Analytics"
              description="Daily and all-time token tracking, 30-day usage history, task-level breakdown. See which tasks consumed the most tokens and break down by model type."
            />
            <FeatureCard
              icon="📜"
              title="Activity Timeline"
              description="Chronological feed of all system events — chats, task updates, engineer actions, errors, deployments, config changes. Last 100 activities with type icons and color coding."
            />
            <FeatureCard
              icon="🐛"
              title="Error Collection with Auto-Fix"
              description="Frontend and backend errors captured automatically. Noise filtering ignores HMR, DevTools, and network errors. Critical errors trigger auto-fix task creation with diagnostic context."
            />
            <FeatureCard
              icon="⏰"
              title="2-Hour Periodic Check-ins"
              description="Automated CTO status reports every 2 hours: recent task completions, failures, in-progress work, and recommendations for what to queue next. Posted to Slack and stored in Firestore. First check-in runs 30s after startup."
            />
            <FeatureCard
              icon="📈"
              title="Engineer Progress Milestones"
              description='Live progress parsing from engineer output — "Cloned repo", "Created branch", "Running tests", "Opened PR". See exactly where each engineer is in the workflow.'
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 8: Code Review & Compliance
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Code Review & Compliance" icon="🔍" accentColor="border-l-orange-500" accentRgb="249, 115, 22" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🤖"
              title="AI-Powered PR Review"
              description="Send any PR's diff to the CTO for review. Receives structured verdicts: APPROVE, COMMENT, or REQUEST_CHANGES with detailed reasoning. Review is submitted directly to GitHub."
            />
            <FeatureCard
              icon="📑"
              title="Split-Panel Diff Viewer"
              description="PR list on the left, full diff with syntax highlighting on the right. One-click approve, merge (squash), or add comments. Full review history tracking."
            />
            <FeatureCard
              icon="🛡️"
              title="SOC 2 Dashboard"
              description="Overall compliance score, category-level breakdowns (Security, Availability, Confidentiality), and a failing controls list with remediation notes."
            />
            <FeatureCard
              icon="🎯"
              title="One-Click Compliance Audits"
              description='5 audit types available: full compliance audit, access controls, encryption standards, logging completeness, and change management. Plus per-control "Ask CTO to fix" buttons.'
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 9: Resilience Testing
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Resilience Testing" icon="🐕" accentColor="border-l-red-500" accentRgb="239, 68, 68" defaultOpen={false}>
          <div className="mb-4">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">12 Chaos Monkey Scenarios</p>
            <ChaosMonkeyGrid />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🧪"
              title="5 Test Suites + Chaos Monkey"
              description="Backend latency, visual regression, chat latency, proactive exploration, and full suite — all runnable on both local dev and Cloud Run. The chaos monkey runs 12 edge-case scenarios including XSS, SQL injection, Unicode, rapid-fire, and extreme input."
            />
            <FeatureCard
              icon="📥"
              title="Eval Import from Any Format"
              description="Paste evals in CSV, JSON, Markdown, YAML, or free-form text — the CTO agent parses them into structured eval definitions. No need to format anything manually."
            />
            <FeatureCard
              icon="📸"
              title="Visual Regression & Screenshots"
              description="Capture screenshots of every page, compare against baselines, and detect UI regressions. Each chaos scenario also captures screenshots and console errors for analysis."
            />
            <FeatureCard
              icon="🔌"
              title="Chrome Extension Harness"
              description="Full Puppeteer-based Chrome extension testing with headless support and live visualization. Streams real-time progress steps, logs, and screenshots to the UI as tests execute. Loads extensions, auto-logins to Salesforce, navigates pages, captures output, and runs timed scenarios. On Cloud Run, the extension is auto-cloned and built from GitHub with results cached."
            />
            <FeatureCard
              icon="🤖"
              title="CTO-Generated Test Scenarios"
              description="The CTO agent generates test scenarios based on recent changes, ensuring new features are covered. Tests are structured with names, descriptions, inputs, expected behaviors, and thresholds."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 10: Production Infrastructure
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Production Infrastructure" icon="🏗️" accentColor="border-l-slate-500" accentRgb="148, 163, 184" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🔀"
              title="Single-Port Production Server"
              description="Next.js and WebSocket run on the same HTTP server and port. WebSocket upgrades on /ws, everything else goes to Next.js. No reverse proxy needed — one container, one port."
            />
            <FeatureCard
              icon="☁️"
              title="Cloud Run with Token-Auth Cloning"
              description="In production, engineers can't access local paths. They clone via token-authenticated HTTPS URLs (x-access-token). Repo identifiers auto-resolve to GitHub slugs with temp directory cleanup."
            />
            <FeatureCard
              icon="🛑"
              title="Graceful Shutdown"
              description="On SIGTERM (Cloud Run rolling deploy), the server stops accepting connections, lets in-flight requests complete, cleanly kills active engineers, then exits. Zero dropped requests."
            />
            <FeatureCard
              icon="🔌"
              title="Port Recovery on Startup"
              description="If the WebSocket port is occupied by a stale process from a crash, the server kills it and retries. Eliminates the 'port already in use' problem in development."
            />
            <FeatureCard
              icon="⏱️"
              title="10-Minute Engineer Timeout"
              description="Engineers are automatically killed after 10 minutes to prevent runaway processes. Triggers a 'timed out' failure status. The task can be retried with context from the timeout."
            />
            <FeatureCard
              icon="🔐"
              title="Multi-Repo Resolution"
              description='The CTO targets any configured repo via "repo" field. Default repo, self-targeting (cto-dashboard), and additional repos all resolved dynamically via resolveRepoPath().'
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION 11: Developer Experience
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Developer Experience" icon="✨" accentColor="border-l-pink-500" accentRgb="236, 72, 153" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="⌘"
              title="Command Palette (Cmd+K)"
              description="Fuzzy-search command palette for power users. Navigate pages, approve all tasks, kill engineers, trigger check-ins, run dogfood tests — all keyboard-driven with arrow key navigation."
            />
            <FeatureCard
              icon="🔔"
              title="Toast Notifications"
              description="Non-intrusive stacking notifications for task completions, engineer events, errors, and system updates. Auto-dismiss with configurable duration. Success, error, warning, and info variants."
            />
            <FeatureCard
              icon="🧵"
              title="Thread Chat"
              description="ChatGPT-style conversation threads. Create, switch, and delete threads to organize CTO interactions. Thread titles auto-generate from the first message."
            />
            <FeatureCard
              icon="🧙"
              title="Setup Wizard"
              description="Step-by-step guided setup for each integration — Notion, Slack, Vanta, Twilio, GitHub. Input validation, help links, keyboard navigation (Escape/Enter). No config files needed."
            />
            <FeatureCard
              icon="⚡"
              title="Hot Config Reload"
              description="Change model selection, repo paths, integration tokens, and resource limits on the fly. Settings persist to config.json and take effect immediately — no server restart."
            />
            <FeatureCard
              icon="🔒"
              title="Secret Masking"
              description="API keys, tokens, and passwords display as *** in the Settings UI. Submitting masked values doesn't overwrite the real secrets on the server. Safe for screen sharing."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION: Operational Guardrails & Cost Controls
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Operational Guardrails" icon="🛡️" accentColor="border-l-rose-500" accentRgb="244, 63, 94" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="💰"
              title="Per-Engineer Token Budgets"
              description="Configurable token budget per engineer (default 500K). Warning logged at 80% usage, engineer killed at 100%. Prevents runaway costs from long-running or stuck tasks."
            />
            <FeatureCard
              icon="⏱️"
              title="Configurable Timeout"
              description="Engineer timeout configurable from 1–120 minutes (default 30, up from hardcoded 10). Set via Settings page — no code changes needed."
            />
            <FeatureCard
              icon="📊"
              title="Cost by Project Analytics"
              description="Analytics page now shows per-project token usage breakdown. Each task row displays its repo/project. Filter the task board by project or repo."
            />
            <FeatureCard
              icon="🔖"
              title="Project Hierarchy"
              description='CTO can assign tasks to named projects via the "project" field. Tasks display purple project badges. Board filter prefers project over repo for grouping.'
            />
            <FeatureCard
              icon="⚠️"
              title="Stale Task Detection"
              description="Tasks in active states (in_progress, in_review) with no update for 24+ hours get an amber 'Stale' badge. Periodic check-ins include stale counts and report them to Slack."
            />
            <FeatureCard
              icon="🔄"
              title="Config Revision History"
              description="Every settings change saves a revision snapshot. View last 20 revisions with changed fields and timestamps. One-click rollback to any previous configuration."
            />
            <FeatureCard
              icon="📝"
              title="Persistent Audit Trail"
              description="Activity log persists to Firestore — survives restarts. Each entry tagged with trigger source (user_action, auto_fix, slack_message, periodic_checkin) with colored badges."
            />
            <FeatureCard
              icon="🔮"
              title="Task Cost Estimates"
              description="Suggested tasks show estimated token usage based on historical averages for the same model. Helps prioritize and budget before approving."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION: Autonomous Project Execution
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Autonomous Project Execution" icon="🚀" accentColor="border-l-violet-500" accentRgb="139, 92, 246" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="📋"
              title="Project Lifecycle"
              description="Create multi-phase projects with a single prompt. Projects flow through draft → planning → active → paused → completed → archived. Each phase contains tasks with dependency ordering."
            />
            <FeatureCard
              icon="🤖"
              title="Autonomy Levels"
              description="Three autonomy modes: supervised (all tasks need approval), semi-autonomous (P2/P3 auto-approve), and autonomous (everything auto-approved). Time-bounded autonomy with automatic expiration."
            />
            <FeatureCard
              icon="🔗"
              title="Task Dependencies"
              description="Tasks can declare dependencies via dependsOn. The queue respects dependency order — blocked tasks wait for upstream completions. Completion summaries flow downstream as context."
            />
            <FeatureCard
              icon="📊"
              title="Phase Advancement"
              description="Phases auto-advance when all tasks complete. Configurable approval gates between phases. Phase completion triggers next phase task creation via CTO replanning."
            />
            <FeatureCard
              icon="🔀"
              title="Auto-Merge & Deploy"
              description="Projects can enable auto-merge (squash + delete branch) for PRs that pass CI. Combined with auto-deploy, code goes from CTO chat to production without human intervention."
            />
            <FeatureCard
              icon="⏸️"
              title="Failure Safeguards"
              description="Configurable pause-on-failure count. After N consecutive task failures, the project pauses and notifies via Slack. P0 tasks always require human approval regardless of autonomy level."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION: CTO Memory & Skill Profiles
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="CTO Memory & Skill Profiles" icon="🧠" accentColor="border-l-cyan-500" accentRgb="6, 182, 212" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="💾"
              title="Persistent CTO Memory"
              description="The CTO remembers decisions, preferences, learnings, architecture choices, and constraints across conversations. Memories persist in Firestore and are injected into every CTO prompt."
            />
            <FeatureCard
              icon="🏷️"
              title="Tagged Memory System"
              description="Memories are typed (decision, preference, learning, architecture, constraint) and tagged for searchable retrieval. Project-scoped memories provide per-project context."
            />
            <FeatureCard
              icon="🎯"
              title="Skill Profiles"
              description="Assign engineer specializations: frontend, backend, infra, or custom profiles. Each profile injects domain-specific system prompts, MCP servers, and env vars for focused expertise."
            />
            <FeatureCard
              icon="🧰"
              title="Tool Registry"
              description="Configure external tools with API keys that are injected based on skill profile. Tools like ElevenLabs, Stripe, or custom APIs automatically available to the right engineers."
            />
          </div>
        </CollapsibleSection>

        {/* ═══════════════════════════════════════════════════════════════
            SECTION: Deploy Automation
            ═══════════════════════════════════════════════════════════════ */}
        <CollapsibleSection title="Deploy Automation" icon="🚢" accentColor="border-l-emerald-500" accentRgb="16, 185, 129" defaultOpen={false}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeatureCard
              icon="🐳"
              title="Docker Build Pipeline"
              description="DeployManager builds Docker images from repo Dockerfiles, tags with commit SHA and timestamp, and pushes to Google Container Registry. Build logs streamed to dashboard in real-time."
            />
            <FeatureCard
              icon="☁️"
              title="Cloud Run Deployment"
              description="One-click deploy to GCP Cloud Run. Configurable per-repo deploy targets with project, region, service name, and Dockerfile path. Automatic rollback on health check failure."
            />
            <FeatureCard
              icon="❤️"
              title="Health Check Verification"
              description="Post-deploy health checks verify the service is responding. Configurable health check URLs per deploy target. Failed verification triggers automatic rollback to previous revision."
            />
            <FeatureCard
              icon="📜"
              title="Deploy History"
              description="Full deploy audit trail: build → push → deploy → verify stages with timestamps, commit SHAs, image URLs, and service URLs. View history from the dashboard or via WS API."
            />
          </div>
        </CollapsibleSection>

        {/* ════════ Footer ════════ */}
        <FadeIn delay={100}>
          <div className="mt-14 text-center">
            <div className="mx-auto mb-4 h-px w-48" style={{
              background: 'linear-gradient(90deg, transparent, rgba(161, 161, 170, 0.2), transparent)',
            }} />
            <p className="text-xs text-zinc-600">
              Built with Claude &middot; Powered by Anthropic
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
