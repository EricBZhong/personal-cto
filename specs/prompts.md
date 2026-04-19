# Prompts

System prompts for the CTO and Engineer Claude instances. Defined in `src/server/prompts/`.

## CTO System Prompt (`prompts/cto-system.ts`)

### Function: `buildCTOSystemPrompt(context)`

Builds a dynamic system prompt with live context injected on every message.

### Context Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `repoPath` | Config | Primary app repo path |
| `ctoDashboardPath` | Config | CTO Dashboard repo path |
| `repos` | Config | Structured repo registry |
| `activeTasks` | TaskQueue | Formatted list of non-terminal tasks |
| `recentPRs` | GitHub | Open PR summary |
| `dailyTokens` | TaskQueue | Today's token usage |
| `engineerCount` | EngineerPool | Active engineer count |
| `maxEngineers` | Config | Max concurrent engineers |
| `notionSummary` | Notion | Board ticket summary |
| `gcpHealth` | GCP | Cloud Run service status |
| `complianceSummary` | Vanta | SOC 2 compliance overview |
| `currentModel` | Message | Model being used (sonnet/opus) |
| `slackConnected` | Slack | Whether Slack is connected |
| `pendingClarifications` | ClarificationTracker | Outstanding clarification requests |
| `pendingPolls` | StrategyPollTracker | Outstanding strategy polls |
| `detailedTicketContent` | Notion | Full ticket content (when requested) |
| `recentTaskChanges` | Orchestrator | Manual task status changes since last message |
| `activeProjects` | ProjectManager | Summary of active/planning projects with phase progress |
| `memories` | MemoryStore | Relevant CTO memory entries (formatted text, max 3000 chars) |
| `skillProfiles` | Config | Available skill profile names and descriptions |

### Prompt Structure

1. **Role Definition**: AI CTO, reports to CEO
2. **Capabilities**: Has live context, cannot run commands directly, delegates to engineers
3. **Repos Managed**: Primary app repo, CTO Dashboard, configurable additional repos
4. **Self-Configuration**: Can assign engineer to edit `data/config.json`
5. **Integration Setup**: Dashboard has guided wizard, no manual config needed

6. **Task Delegation**: Output `<task_assignment>` JSON blocks:
   ```xml
   <task_assignment>
   {
     "title": "Short task title",
     "description": "Detailed description...",
     "branch": "fix/descriptive-branch-name",
     "model": "sonnet",
     "maxBudget": 1.50,
     "priority": "P2",
     "repo": "my-app"
   }
   </task_assignment>
   ```

7. **Clarification Requests**: Output `<clarification_request>` blocks to DM Slack users
8. **Strategy Polls**: Output `<strategy_poll>` blocks to post channel polls
9. **Current State**: Live-injected context sections (tasks, PRs, Notion, GCP, compliance, tokens, Slack, pending clarifications, pending polls, recent task changes)
10. **Project Planning (Autonomous Execution)**: `<project_plan>` blocks for creating structured multi-phase projects with phases, tasks, dependencies, autonomy settings. Guidelines for breaking goals into 2-7 phases, setting dependencies, and interpreting CEO autonomy preferences.
11. **CTO Memory**: `<memory>` blocks for storing long-term memories. Types: decision, preference, learning, architecture, constraint. Injected as "Your Memories" section when entries exist.
12. **Skill Profiles**: Available engineer specializations injected as context. Guides CTO to set `skillProfile` in task assignments.
13. **Deploy Automation**: `<deploy_trigger>` blocks for triggering deployments, `<create_repo>` blocks for creating new GitHub repos. Injected "Active Projects" section shows project progress.
14. **PR Code Reviews**: Review format with VERDICT line
15. **Guidelines**: 10 rules for task management (reasoning, dependencies, sizing, branch naming, etc.)
16. **Model Selection**: When to recommend Opus vs stay on Sonnet

### Priority Levels

| Priority | Execution | Model | Budget |
|----------|-----------|-------|--------|
| P0 (Critical) | Immediate | Opus | Custom |
| P1 (High) | Next in queue | Sonnet | $2.00 |
| P2 (Medium) | Standard queue | Sonnet | $1.50 |
| P3 (Low) | Best effort | Haiku/Sonnet | $1.00 |

---

## Engineer Task Prompt (`prompts/engineer-task.ts`)

### Function: `buildEngineerPrompt(params)`

Builds the task prompt given to each engineer Claude instance.

### Parameters

| Parameter | Description |
|-----------|-------------|
| `title` | Task title |
| `description` | Detailed task description |
| `branch` | Target git branch |
| `repoPath` | Working directory |
| `baseBranch` | Base branch (default: `dev`) |
| `retryContext` | Previous attempt failure context (last 3000 chars of output) |
| `interactionContext` | Follow-up instructions from user (for task re-engagement) |
| `upstreamContext` | Completion summaries from upstream dependency tasks |
| `skillAddition` | Skill profile system prompt addition (e.g., frontend specialization) |

### Prompt Structure

1. **Specialization** (conditional): Skill profile system prompt addition, if `skillAddition` is provided (e.g., "You specialize in frontend development...")
1. **Role**: "You are a senior software engineer"
2. **Task**: Title and description
3. **Previous Attempt** (conditional): Retry context from failed attempts, if `retryContext` is provided
4. **Follow-Up Instructions** (conditional): Interaction context for re-engagement, if `interactionContext` is provided
5. **Upstream Dependencies** (conditional): Completion summaries from dependency tasks, if `upstreamContext` is provided. Instructs engineer to build on upstream work.
6. **Instructions** (10 steps):
   1. Working directory location
   2. Bootstrap GitHub auth (`$GH_TOKEN`)
   3. Create branch from base (`git fetch origin && git checkout -b {branch}`)
   4. Read relevant files first
   5. Make minimal, focused changes
   6. Run relevant tests
   7. Commit with clear message
   8. Push branch (`git push -u origin {branch}`)
   9. Create PR to base branch (`gh pr create --base {base}`)
   10. Output PR URL

4. **Strict Rules**:
   - NEVER push to main
   - NEVER use `git push --force` or `git reset --hard`
   - NEVER delete branches or rewrite history
   - No out-of-scope changes
   - Stash uncommitted changes
   - Prefer editing over creating files
   - Follow existing code style
   - Always create a PR

5. **Browser Instructions**: Appended if browser automation is enabled

### Claude CLI Args (set by EngineerPool)

```
claude --print --verbose --output-format stream-json
  --model {model}
  --no-session-persistence
  --max-turns 100
  --permission-mode bypassPermissions
  --max-budget-usd {maxBudget}
```

### Post-Completion

After the engineer process exits:
1. **Verification**: Branch pushed? PR exists? (catches hallucinated PRs)
2. **Summary**: Haiku generates 3-8 bullet point summary of work done
3. **Status**: Set to `in_review` (success) or `failed` (verification failed)
