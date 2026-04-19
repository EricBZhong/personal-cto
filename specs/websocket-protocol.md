# WebSocket Protocol

All messages are JSON objects with `{ type: string, payload?: object }`.

Connection: `ws://localhost:3101` (dev) or `wss://{host}/ws` (production).

Auto-reconnect with exponential backoff: 2s → 30s.

## Client → Server Messages

### Chat
| Type | Payload | Description |
|------|---------|-------------|
| `chat:send` | `{ message: string, model?: string }` | Send message to CTO |
| `chat:abort` | — | Cancel CTO streaming response |
| `chat:history` | — | Request conversation history |
| `chat:clear` | — | Clear conversation history |

### Threads
| Type | Payload | Description |
|------|---------|-------------|
| `thread:list` | — | List all threads |
| `thread:create` | — | Create new thread |
| `thread:switch` | `{ threadId: string }` | Switch to thread |
| `thread:delete` | `{ threadId: string }` | Delete thread |

### Tasks
| Type | Payload | Description |
|------|---------|-------------|
| `task:approve` | `{ taskId, priority?, model?, actionedBy?, reason? }` | Approve task |
| `task:approve_by_title` | `{ title, priority?, model?, actionedBy?, reason? }` | Approve by title (from chat) |
| `task:reject` | `{ taskId, actionedBy?, reason? }` | Reject task |
| `task:reject_by_title` | `{ title, actionedBy?, reason? }` | Reject by title |
| `task:cancel` | `{ taskId }` | Cancel task (kills engineer if running) |
| `task:list` | — | Request all tasks |
| `task:get` | `{ taskId }` | Request single task detail |
| `task:logs` | `{ taskId }` | Request task logs |
| `task:update_priority` | `{ taskId, priority }` | Change priority |
| `task:retry` | `{ taskId }` | Retry failed/cancelled task |
| `task:interact` | `{ taskId, instruction }` | Send follow-up instruction to task (respawns engineer on same branch) |
| `task:approve_all` | — | Approve all suggested tasks |
| `task:set_status` | `{ taskId, status, actionedBy?, reason? }` | Manual status override |

### Engineers
| Type | Payload | Description |
|------|---------|-------------|
| `engineer:list` | — | Request active engineers |
| `engineer:kill` | `{ engineerId }` | Kill specific engineer |
| `engineer:kill_all` | — | Kill all engineers |

### Config
| Type | Payload | Description |
|------|---------|-------------|
| `config:get` | — | Request current config |
| `config:update` | `{ ...configFields }` | Update config fields |
| `config:revisions` | — | Request last 20 config revisions |
| `config:rollback` | `{ revisionId: string }` | Load and apply a previous config snapshot, broadcasts `config:data` |

### Status
| Type | Payload | Description |
|------|---------|-------------|
| `status:get` | — | Request system status |
| `health:ping` | — | Ping all GCP services |

### Integrations
| Type | Payload | Description |
|------|---------|-------------|
| `notion:tickets` | — | Fetch Notion board tickets |
| `github:prs` | — | Fetch open PRs |
| `github:pr_diff` | `{ prNumber }` | Fetch PR diff |
| `gcp:health` | — | Fetch GCP service health |
| `gcp:logs` | `{ service, project }` | Fetch GCP logs |

### Compliance
| Type | Payload | Description |
|------|---------|-------------|
| `compliance:overview` | — | Fetch compliance overview |
| `compliance:failing` | — | Fetch failing controls |

### Analytics
| Type | Payload | Description |
|------|---------|-------------|
| `analytics:usage` | — | Fetch token usage analytics |
| `analytics:activity` | — | Fetch activity log |

### Errors
| Type | Payload | Description |
|------|---------|-------------|
| `error:report` | `{ source, level, message, stack?, context? }` | Report frontend error |
| `error:list` | — | List recent errors |
| `error:resolve` | `{ errorId }` | Mark error resolved |

### Codebase Analysis
| Type | Payload | Description |
|------|---------|-------------|
| `analysis:run` | `{ focus?: string }` | Run codebase analysis via CTO |

### Dogfood Testing
| Type | Payload | Description |
|------|---------|-------------|
| `dogfood:run` | `{ testType, message?, backendUrl?, headless? }` | Run dogfood test |
| `dogfood:run_with_analysis` | `{ testType, message?, backendUrl?, headless? }` | Run with CTO analysis |

### Evals
| Type | Payload | Description |
|------|---------|-------------|
| `eval:list` | — | List all evals |
| `eval:create` | `{ name, description?, category?, input, expectedBehavior?, maxTtftMs?, maxResponseMs?, expectNoErrors? }` | Create eval |
| `eval:delete` | `{ evalId }` | Delete eval |
| `eval:run` | `{ evalIds?: string[], durationMinutes?: number }` | Run eval suite |
| `eval:generate` | — | Ask CTO to generate evals |
| `eval:history` | `{ evalId?: string }` | Fetch eval run history |
| `eval:seed` | — | Seed default evals |
| `eval:import` | `{ content: string }` | Import evals from pasted text |

### Slack
| Type | Payload | Description |
|------|---------|-------------|
| `slack:status` | — | Get Slack connection status |
| `slack:get_conversations` | — | Fetch conversations |
| `slack:get_queue` | — | Fetch pending queue |
| `slack:reconnect` | — | Reconnect Slack bot |
| `slack:post_update` | — | Post status update to channel |
| `slack:send_message` | `{ channel, message }` | Send message to channel |

### PR Reviews
| Type | Payload | Description |
|------|---------|-------------|
| `pr:list` | — | List open PRs (includes externally-added PRs) |
| `pr:add` | `{ url: string }` | Add PR by GitHub URL (any repo) |
| `pr:detail` | `{ prNumber, repoSlug?: string }` | Get PR detail + diff |
| `pr:review` | `{ prNumber, repoSlug?: string }` | Request CTO review |
| `pr:approve` | `{ prNumber, repoSlug?: string }` | Approve PR |
| `pr:merge` | `{ prNumber, method?: string, repoSlug?: string }` | Merge PR (default: squash) |
| `pr:comment` | `{ prNumber, body, repoSlug?: string }` | Add comment |

### Daily Check-in
| Type | Payload | Description |
|------|---------|-------------|
| `checkin:trigger` | — | Trigger daily check-in |
| `checkin:get_report` | `{ reportId }` | Get specific report |
| `checkin:list_reports` | — | List recent reports |

### Projects
| Type | Payload | Description |
|------|---------|-------------|
| `project:list` | — | List all projects |
| `project:get` | `{ projectId }` | Get project detail |
| `project:create` | `{ name, description, goal, phases?, autonomy?, autoApprove?, autoMerge?, autoDeploy?, repo?, tokenBudget? }` | Create project |
| `project:update` | `{ projectId, ...fields }` | Update project fields |
| `project:advance` | `{ projectId }` | Force advance to next phase |
| `project:archive` | `{ projectId }` | Archive project |
| `project:pause` | `{ projectId }` | Pause project |
| `project:resume` | `{ projectId }` | Resume paused project |

### Memory
| Type | Payload | Description |
|------|---------|-------------|
| `memory:list` | `{ projectId? }` | List memory entries (optionally filtered by project) |
| `memory:add` | `{ type, content, projectId?, tags? }` | Add memory entry |
| `memory:delete` | `{ id }` | Delete memory entry |
| `memory:search` | `{ query }` | Search memories by keyword |

### Deploy
| Type | Payload | Description |
|------|---------|-------------|
| `deploy:trigger` | `{ repoName, projectId?, target? }` | Trigger deployment |
| `deploy:history` | — | Get recent deploy history |

---

## Server → Client Messages

### Chat
| Type | Payload | Description |
|------|---------|-------------|
| `cto:chunk` | `{ text, messageId }` | Streaming text chunk |
| `cto:done` | `{ messageId, fullText, tokensUsed? }` | Streaming complete |
| `cto:error` | `{ error, messageId }` | CTO error |
| `chat:history` | `{ messages: ChatMessage[] }` | Conversation history |

### Threads
| Type | Payload | Description |
|------|---------|-------------|
| `thread:list` | `{ threads, activeThreadId }` | Thread list |
| `thread:created` | `{ thread }` | New thread created |
| `thread:switched` | `{ threadId, messages }` | Switched to thread |
| `thread:deleted` | `{ threadId }` | Thread deleted |

### Tasks
| Type | Payload | Description |
|------|---------|-------------|
| `task:created` | `{ id, title, status, priority, branch?, engineerId? }` | Task created (broadcast) |
| `task:updated` | `{ id, title, status, priority, branch?, engineerId? }` | Task updated (broadcast) |
| `task:list` | `{ tasks: Task[] }` | Full task list |
| `task:detail` | `{ task, logs }` | Single task with logs |
| `task:logs` | `{ taskId, logs }` | Task logs |
| `task:logs_updated` | `{ taskId }` | Logs changed (broadcast) |

### Engineers
| Type | Payload | Description |
|------|---------|-------------|
| `engineer:spawned` | `{ id, taskId, taskTitle, model, startedAt, tokensUsed }` | Engineer started (broadcast) |
| `engineer:chunk` | `{ engineerId, taskId, text }` | Live output chunk (broadcast) |
| `engineer:done` | `{ engineerId, taskId, status, tokensUsed }` | Engineer finished (broadcast) |
| `engineer:error` | `{ engineerId, taskId, error }` | Engineer error (broadcast) |
| `engineer:list` | `{ engineers }` | Active engineer list |

### System
| Type | Payload | Description |
|------|---------|-------------|
| `system:status` | `{ engineers, activeTasks, dailyTokens, config?, slackConnected?, ctoStatus? }` | System metrics (broadcast). `config` now includes `engineerTokenBudget` and `engineerTimeoutMinutes`. |
| `setup:prompt` | `{ integration: string }` | Integration needs setup |
| `error` | `{ error: string }` | Generic error |

### Config
| Type | Payload | Description |
|------|---------|-------------|
| `config:data` | `{ ...configFields }` | Current config (secrets masked) |
| `config:revisions` | `{ revisions: { id, changedFields, timestamp }[] }` | Last 20 config revision entries |

### Integrations
| Type | Payload | Description |
|------|---------|-------------|
| `notion:tickets` | `{ tickets, error? }` | Notion tickets |
| `github:prs` | `{ prs, repoStats?, error? }` | GitHub PRs |
| `github:pr_diff` | `{ prNumber, diff, pr?, error? }` | PR diff |
| `gcp:health` | `{ services, error? }` | GCP health |
| `gcp:logs` | `{ service, logs, error? }` | GCP logs |
| `health:results` | `{ services, error? }` | Health ping results |

### Compliance
| Type | Payload | Description |
|------|---------|-------------|
| `compliance:overview` | `{ categories?, score?, error? }` | Compliance overview |
| `compliance:failing` | `{ controls, error? }` | Failing controls |

### Analytics
| Type | Payload | Description |
|------|---------|-------------|
| `analytics:usage` | `{ dailyTokens, taskTokens, totalAllTime, todayTokens, projectTokens }` | Token usage data (includes per-project token breakdown) |
| `analytics:activity` | `{ activities }` | Activity log |

### Errors
| Type | Payload | Description |
|------|---------|-------------|
| `error:list` | `{ errors, counts }` | Error list |

### Dogfood
| Type | Payload | Description |
|------|---------|-------------|
| `dogfood:started` | `{ testType, withAnalysis? }` | Test started |
| `dogfood:progress` | `{ type: 'step' \| 'log' \| 'screenshot', step?, log?, screenshot?: { label, base64 }, timestamp }` | Real-time progress during test execution |
| `dogfood:results` | `{ results, report }` | Test results |
| `dogfood:error` | `{ error }` | Test error |

### Evals
| Type | Payload | Description |
|------|---------|-------------|
| `eval:list` | `{ evals }` | Eval definitions |
| `eval:created` | `{ eval }` | Eval created |
| `eval:deleted` | `{ evalId }` | Eval deleted |
| `eval:history` | `{ history }` | Eval run history |
| `eval:import_done` | `{ created, error? }` | Import complete |

### Slack
| Type | Payload | Description |
|------|---------|-------------|
| `slack:conversations` | `{ conversations, error? }` | Conversation list |
| `slack:queue` | `{ queue, error? }` | Pending queue |
| `slack:status` | `{ configured, connected }` | Connection status |
| `slack:update_posted` | `{ success }` | Status update posted |
| `slack:message_sent` | `{ success, channel }` | Message sent |

### PR Reviews
| Type | Payload | Description |
|------|---------|-------------|
| `pr:list` | `{ prs, error? }` | PR list (includes externally-added PRs) |
| `pr:added` | `{ pr?: PullRequest, error?: string }` | Result of pr:add — PR object on success, error on failure |
| `pr:detail` | `{ pr, diff, reviews }` | PR detail |
| `pr:review_started` | `{ prNumber }` | Review in progress |
| `pr:review_complete` | `{ prNumber, reviewText, recommendation }` | Review done |
| `pr:action_result` | `{ prNumber, action, success, error? }` | Action result |

### Daily Check-in
| Type | Payload | Description |
|------|---------|-------------|
| `checkin:complete` | `{ report }` | Check-in report |
| `checkin:report` | `{ report }` | Specific report |
| `checkin:reports` | `{ reports }` | Report list |
| `checkin:error` | `{ error }` | Check-in error |

### Projects
| Type | Payload | Description |
|------|---------|-------------|
| `project:list` | `{ projects: Project[] }` | Project list |
| `project:detail` | `{ project: Project }` | Single project detail |
| `project:created` | `{ project: Project }` | New project created (broadcast) |
| `project:updated` | `{ project: Project }` | Project updated (broadcast) |
| `project:advanced` | `{ projectId, phaseId, phaseName }` | Phase completed, project advancing (broadcast) |
| `project:completed` | `{ projectId }` | All phases done (broadcast) |
| `project:paused` | `{ projectId, reason }` | Project paused (broadcast) |

### Memory
| Type | Payload | Description |
|------|---------|-------------|
| `memory:list` | `{ entries: MemoryEntry[] }` | Memory entries |
| `memory:added` | `{ entry: MemoryEntry }` | New memory added (broadcast) |
| `memory:deleted` | `{ id }` | Memory deleted (broadcast) |

### Deploy
| Type | Payload | Description |
|------|---------|-------------|
| `deploy:started` | `{ deploy: DeployRecord }` | Deploy started (broadcast) |
| `deploy:progress` | `{ deployId, status, message? }` | Deploy step progress (broadcast) |
| `deploy:completed` | `{ deploy: DeployRecord }` | Deploy finished (broadcast) |
| `deploy:history` | `{ deploys: DeployRecord[] }` | Deploy history |

### Clarification / Strategy (broadcast only)
| Type | Payload | Description |
|------|---------|-------------|
| `clarification:sent` | `{ id, ticketTitle, askUser }` | Clarification DM sent |
| `clarification:answered` | `{ id, ticketTitle, answeredBy, answers }` | Clarification answered |
| `strategy:posted` | `{ id, ticketTitle, channel }` | Strategy poll posted |
| `strategy:decided` | `{ id, ticketTitle, chosenOption, decidedBy }` | Strategy decided |
