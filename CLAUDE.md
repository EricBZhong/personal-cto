# CLAUDE.md — CTO Dashboard (Personal-CTO-v1)

> **Priority order:** Principles override Workflow defaults. When in doubt, simpler and more correct beats faster and clever.

---

## Project Overview
AI-powered engineering orchestrator. CEO interacts with a "CTO" Claude agent that has full context on codebases, Notion, GitHub, GCP, and Vanta. The CTO breaks work into tasks, delegates to parallel "Engineer" Claude instances, and reports results through a real-time dashboard.

---

## Session Start Protocol

Before doing anything else at the start of every session:
1. Read `tasks/todo.md` and `tasks/lessons.md` in full
2. Identify which lessons are relevant to the current task
3. Resume incomplete tasks from where they left off — do not restart from scratch
4. Run `git status` and `git log --oneline -5` before touching anything
5. If the task touches a spec area, open the relevant spec from the table below *before* writing any code

---

## Specs & Features Page — MANDATORY Checklist
Comprehensive specs live in `specs/`. Every code change that modifies behavior **MUST** follow this checklist before the task is considered complete:

1. **Read** the relevant spec(s) from the table below *before* modifying any feature
2. **Update the spec** after making changes — the spec must always match current behavior
3. **Update `/features`** (`src/app/features/page.tsx`) — add a new `FeatureCard` or update an existing one so the guidebook stays current
4. **Update `docs/personal-cto-deck.html`** if the change is user-facing or architecturally notable

**Skipping steps 2–4 is a bug.** If you modified server behavior, the spec and features page must reflect it in the same PR. Never mark a task complete without proving it works — passing build is not done.

| Spec | What to read before... |
|------|----------------------|
| `specs/pages.md` | Adding/modifying a page |
| `specs/components.md` | Adding/modifying a component |
| `specs/server.md` | Changing server modules |
| `specs/websocket-protocol.md` | Adding a WS message type |
| `specs/data-models.md` | Changing data models or Firestore collections |
| `specs/integrations.md` | Working with external services |
| `specs/state-management.md` | Modifying stores or hooks |
| `specs/configuration.md` | Adding config fields |
| `specs/prompts.md` | Modifying CTO/engineer prompts |
| `specs/deployment.md` | Changing deployment or Docker |
| `specs/architecture.md` | Understanding system design |

---

## Workflow Guidelines

### Planning
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Write detailed specs upfront for anything touching the WebSocket protocol, orchestrator routing, or engineer spawning — these are high-blast-radius areas
- When unsure between two approaches, state both with a concrete trade-off. Don't silently pick one.

### Self-Improvement Loop
- After ANY correction: update `tasks/lessons.md` with the pattern
- If the same class of mistake happens twice, the lesson entry is insufficient — rewrite it
- Review lessons at session start
- When the CTO assigns work to `"repo": "cto-dashboard"`, treat it as a real engineering task with the same rigor — self-improvement tasks are not exempt from this checklist

### Scope Creep Guard
- If a fix requires touching more than ~3 files unexpectedly, stop and flag it before proceeding
- Changes to `orchestrator.ts`, `cto-session.ts`, or `engineer-pool.ts` have outsized blast radius — they affect every active engineer and every task in flight
- WebSocket protocol changes (`specs/websocket-protocol.md`) affect both frontend and server simultaneously — always assess both sides before starting
- Never silently expand scope. Surface it and let the user decide.

### Rollback Readiness
- Always verify git is clean before destructive operations
- Never push directly to `dev` or `main` — feature branches are the rollback unit
- Flag irreversible actions explicitly: Firestore collection changes, prompt changes that affect in-flight sessions, Docker config changes
- When modifying prompts (`specs/prompts.md`), the old prompt behavior is gone immediately — draft and review before applying

### Dependency Awareness
- Before modifying shared server modules (`config.ts`, `task-queue.ts`), check all callers first
- Engineer pool and CTO session share config — a config field rename breaks both silently
- Multi-repo task assignments route through `engineer-pool.ts`; changing resolution logic affects all configured repos, not just the one being tested
- Zustand store changes cascade to every component that subscribes — check all consumers before renaming or removing state

### Testing
- Always write unit tests based on expected behavior, not implementation details
- Validate tests yourself — run them and confirm they pass for the right reasons
- Never write throwaway tests or rewrite tests just to make them pass. If a test fails, fix the code or fix the test expectation — don't delete the assertion.
- Tests must verify the actual behavior changed/added. A test that can't fail is useless.

### Assumption Logging
- When a spec is ambiguous, state the assumption being made and why before coding it
- Append assumptions to `tasks/todo.md` so they're reviewable
- Unlogged assumptions in prompt or orchestrator logic become invisible technical debt

---

## Communication Style

### When to speak up
- When genuinely unsure between two approaches — state the trade-off, don't silently pick one
- When a fix touches the WebSocket protocol, CTO/engineer prompts, or Firestore data models
- When scope expands unexpectedly beyond the agreed plan
- When investigation stalls — state what you found and what remains unknown
- When a change is investor-deck-notable — flag it so `docs/personal-cto-deck.html` doesn't get missed

### When to stay silent
- Don't ask for permission to do what was already asked
- Don't narrate reasoning unless asked
- Don't recap context the user already knows

### Output Confidence Markers
- Distinguish "I know this" from "I'm inferring this" from "this needs verification"
- Never present uncertain outputs with the same tone as verified ones — especially for prompt changes and orchestrator logic where errors are hard to detect mid-session

---

## Architecture
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS 4, Zustand — port 3100
- **Orchestrator**: Node.js process with WebSocket server — port 3101
- **Twilio Webhooks**: HTTP server for voice/SMS — port 3102
- **Database**: Google Firestore (firebase-admin)
- **AI**: Claude CLI (`claude --print --output-format stream-json`)
- **Auth**: NextAuth v5 (Google OAuth, configurable domain via `AUTH_ALLOWED_DOMAIN`)

---

## Git Workflow
- **Always create a feature branch** — never push directly to `dev` or `main`.
- Branch naming: `feature/<name>`, `fix/<name>`, or `chore/<name>`.
- **Create a PR targeting `dev`** when changes are ready. Use `gh pr create --base dev`.
- `main` is production — only merge from `dev` via reviewed PRs.

---

## Development
```bash
npm run dev          # Starts Next.js (3100) + orchestrator (3101) concurrently
npm run dev:next     # Next.js only
npm run dev:server   # Orchestrator only
```

---

## Pages
| Route | Description |
|-------|-------------|
| `/chat` | CTO chat interface with streaming responses |
| `/tasks` | Kanban task board with auto-archive (7d) and collapsible closed columns |
| `/tasks/[id]` | Task detail with engineer logs |
| `/engineers` | Active engineer grid with live output |
| `/pr-reviews` | PR review interface with CTO AI review |
| `/compliance` | SOC 2 compliance dashboard (Vanta integration) |
| `/analytics` | Token usage tracking, task stats |
| `/activity` | Chronological activity timeline |
| `/slack` | Slack conversation queue |
| `/dogfood` | Self-testing and benchmarks |
| `/features` | Features guidebook — comprehensive capability reference |
| `/docs` | Technical documentation & API reference |
| `/settings` | All config — repos, models, integrations |
| `/login` | Google OAuth sign-in |

---

## Key Server Files
- `src/server/index.ts` — Entry point (WS + Twilio servers)
- `src/server/orchestrator.ts` — Message routing, task parsing, integration queries
- `src/server/cto-session.ts` — CTO Claude spawning with context injection
- `src/server/engineer-pool.ts` — Engineer spawning, queue, multi-repo resolution
- `src/server/task-queue.ts` — Task CRUD (Firestore + local cache)
- `src/server/config.ts` — Persistent configuration (file + env)
- `src/server/integrations/` — Notion, GitHub, GCP, Vanta, Twilio, Browser

---

## Multi-Repo Support
The CTO can assign tasks to any configured repo by setting `"repo"` in task assignments.
- Default: my-app (first configured repo)
- Self-improvement: `"repo": "cto-dashboard"` targets this repo
- Additional repos configurable in Settings

---

## Integrations
All configurable from the Settings page — no code changes needed.
- **Notion**: Query engineering board, sync tickets
- **GitHub**: PRs, CI status, diffs, reviews via `gh` CLI
- **GCP**: Cloud Run health checks, logs
- **Vanta**: SOC 2 compliance status, failing controls
- **Slack**: DMs, channel mentions, status updates, task actions
- **Twilio**: Call/text the CTO via phone number
- **Browser**: Puppeteer for web UI interaction (dogfood testing)

---

## Investor Deck
Whenever a notable change is made that could affect the perception of the tool (new features, UX improvements, architecture changes, integrations), update `docs/personal-cto-deck.html` to reflect the change. If flagging a change during a task, call it out explicitly so this step doesn't get dropped.

---

## Communication Protocol
- Frontend ↔ Orchestrator: WebSocket (JSON `{type, payload}`)
- Orchestrator → Claude: `claude --print --output-format stream-json`
- CTO delegates via `<task_assignment>` XML blocks in response text

---

## Auto Mode Context

*For Claude Code auto mode classifier — trusted infrastructure for this project:*

- Source control: github.com — feature branches are trusted for push; `dev` and `main` always require a PR
- Trusted services: Google Firestore, GCP Cloud Run, GitHub CLI (`gh`), Twilio
- Safe to run without confirmation: `npm run dev`, `git status`, `git log`, `git diff`, `git add`, `git commit`, `gh pr create`
- Always require confirmation: direct push to `dev` or `main`, Firestore collection deletes or schema migrations, prompt file changes in `specs/prompts.md`, Docker config changes, any operation touching production engineer pool while tasks are in flight

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Only touch what's necessary. No side effects, no new bugs.
- **Specs are truth**: If behavior changed and the spec wasn't updated, the task isn't done.