# Configuration

Configuration is managed by `src/server/config.ts`.

## Layering

Config values are resolved in this order (later overrides earlier):
1. **Hardcoded defaults** (`getDefaults()`)
2. **Environment variables** (checked within `getDefaults()`)
3. **Firestore overrides** (`config/dashboard` document — empty strings are filtered out)

The merged config is cached in memory. `updateConfig()` writes to Firestore and eagerly refreshes the local cache. An `onSnapshot` listener keeps the cache in sync across instances.

## Lifecycle

- `initConfigFromFirestore()` — called at startup in both `index.ts` (dev) and `production.ts` (Cloud Run). Performs initial `get()` then sets up `onSnapshot` listener.
- `getConfig()` — synchronous, returns from in-memory cache. Falls back to defaults with a warning if called before init.
- `updateConfig(updates)` — async (`Promise<DashboardConfig>`), eagerly updates local cache then writes to Firestore with `set(..., { merge: true })`.
- `stopConfigListener()` — called in shutdown handlers to unsubscribe the `onSnapshot` listener.
- `isCloudRun()` — returns `true` when `K_SERVICE` env var is set (Cloud Run environment detection).

## Config Interface (`DashboardConfig`)

### Repos (Structured)
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `repos` | `RepoConfig[]` | 3 defaults (see below) | Structured repo registry |

Each `RepoConfig` has:
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name & CTO task identifier (e.g., "LeadGen") |
| `localPath` | string | Local filesystem path for dev |
| `githubSlug` | string | GitHub org/repo (e.g., "EricBZhong/leadgen") |
| `baseBranch` | string | Per-repo base branch (e.g., "main" or "dev") |

Default repos:
1. `my-app` — `~/repos/my-app` — `EricBZhong/my-app` — base: `dev`
2. `personal-cto` — `~/repos/personal-cto` — `EricBZhong/personal-cto` — base: `dev`
3. `leadgen` — `~/repos/leadgen` — `EricBZhong/leadgen` — base: `main`

### Paths (Legacy)
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `colbyRepoPath` | string | `~/repos/my-app` | `COLBY_REPO_PATH` | Main product repo (legacy, use `repos` instead) |
| `ctoDashboardRepoPath` | string | `~/repos/personal-cto` | `CTO_DASHBOARD_REPO_PATH` | This repo (legacy, use `repos` instead) |
| `additionalRepoPaths` | string[] | `[]` | `ADDITIONAL_REPO_PATHS` (comma-separated) | Extra repos (legacy) |
| `claudeCliPath` | string | `claude` | `CLAUDE_CLI_PATH` | Path to Claude CLI binary |

### Models
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `ctoModel` | string | `opus` | `CTO_MODEL` | CTO Claude model |
| `engineerDefaultModel` | string | `sonnet` | `ENGINEER_DEFAULT_MODEL` | Default engineer model |

### Resources
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `engineerMaxConcurrent` | number | `10` | `ENGINEER_MAX_CONCURRENT` | Max parallel engineers |
| `engineerTokenBudget` | number | `500000` | `ENGINEER_TOKEN_BUDGET` | Per-engineer token budget. Warning emitted at 80%, engineer killed at 100% |
| `engineerTimeoutMinutes` | number | `30` | `ENGINEER_TIMEOUT_MINUTES` | Per-engineer timeout in minutes (replaces hardcoded 10 min) |
| `defaultBaseBranch` | string | `dev` | `DEFAULT_BASE_BRANCH` | Base branch for PRs |

> **Removed fields**: `engineerDefaultBudget`, `ctoBudgetPerTurn`, and `dailyBudgetLimit` have been removed. Budget/cost gating is no longer used; token usage is tracked for analytics purposes only (see `dailyTokens` Firestore collection).

### Notion
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `notionApiKey` | string? | — | `NOTION_API_KEY` | Notion integration API key |
| `notionBoardId` | string? | `21707890...` | `NOTION_ENGINEERING_BOARD_ID` | Engineering board database ID |

### Vanta
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `vantaApiKey` | string? | — | `VANTA_API_KEY` | Vanta API key |
| `vantaClientId` | string? | — | `VANTA_CLIENT_ID` | OAuth client ID |
| `vantaClientSecret` | string? | — | `VANTA_CLIENT_SECRET` | OAuth client secret |

### GitHub
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `githubRepo` | string? | `EricBZhong/my-app` | `GITHUB_REPO` | Default repo slug |
| `githubToken` | string? | — | `GH_TOKEN` / `GITHUB_TOKEN` | Personal access token |

### Twilio
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `twilioAccountSid` | string? | — | `TWILIO_ACCOUNT_SID` | Account SID |
| `twilioAuthToken` | string? | — | `TWILIO_AUTH_TOKEN` | Auth token |
| `twilioPhoneNumber` | string? | — | `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `ceoPhoneNumber` | string? | — | `CEO_PHONE_NUMBER` | CEO's phone number |

### Slack
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `slackBotToken` | string? | — | `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-...`) |
| `slackAppToken` | string? | — | `SLACK_APP_TOKEN` | App-level token (`xapp-...`) |
| `slackSigningSecret` | string? | — | `SLACK_SIGNING_SECRET` | Request signing secret |
| `slackUpdateChannel` | string? | — | `SLACK_UPDATE_CHANNEL` | Status update channel |

### Browser Automation
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `browserAutomationEnabled` | boolean? | `false` | — | Enable browser automation |
| `browserHeadless` | boolean? | `true` | — | Run browser headless |

### Dogfood / Extension
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `extensionPath` | string? | — | `EXTENSION_PATH` | Chrome extension dist directory |
| `sfLoginUrl` | string? | `https://login.salesforce.com` | `SF_LOGIN_URL` | Salesforce login URL |
| `sfUsername` | string? | — | `SF_USERNAME` | Salesforce username |
| `sfPassword` | string? | — | `SF_PASSWORD` | Salesforce password |

### Authentication
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `claudeOauthToken` | string? | `''` | `CLAUDE_OAUTH_TOKEN` | OAuth token for Claude CLI subscription auth (Cloud Run) |

### Projects & Autonomous Execution
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `skillProfiles` | `SkillProfile[]` | 4 defaults (see below) | — | Engineer skill profiles that inject specialized system prompt additions |
| `toolRegistry` | `ToolRegistryEntry[]` | `[]` | — | External tool registry (env vars injected per skill profile) |
| `deployTargets` | `DeployTarget[]` | `[]` | — | Deployment targets for automated Cloud Run deploys |
| `checkinIntervalMinutes` | number | `120` | — | Interval in minutes for periodic CTO check-ins |

**Default Skill Profiles**:
1. `general` — General-purpose engineering (default profile, no system prompt addition)
2. `frontend` — Frontend/UI specialist (React, Next.js, Tailwind, accessibility, responsive design)
3. `backend` — Backend/API specialist (Node.js, Express, databases, REST APIs, security)
4. `infra` — Infrastructure/DevOps specialist (Docker, GCP Cloud Run, CI/CD, Terraform, monitoring)

Each `SkillProfile` has:
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Profile identifier (referenced in task `skillProfile` field) |
| `description` | string | Human-readable description |
| `systemPromptAddition` | string? | Text appended to engineer system prompt for specialization |
| `mcpServers` | string[]? | MCP server names to enable for this profile |
| `envVars` | Record<string, string>? | Environment variables to inject into engineer subprocess |
| `modelOverride` | string? | Override the default engineer model for this profile |

Each `ToolRegistryEntry` has:
| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Tool name |
| `description` | string | Tool description |
| `envVar` | string | Environment variable name |
| `value` | string | Environment variable value |
| `skillProfiles` | string[]? | Which skill profiles can use this tool |

Each `DeployTarget` has:
| Field | Type | Description |
|-------|------|-------------|
| `repoName` | string | Repo identifier (matches `RepoConfig.name`) |
| `gcpProject` | string | GCP project ID |
| `gcpRegion` | string | GCP region (e.g., `us-central1`) |
| `serviceName` | string | Cloud Run service name |
| `dockerfilePath` | string? | Path to Dockerfile directory (default: `.`) |
| `healthCheckUrl` | string? | URL to hit for post-deploy verification |

### Server
| Field | Type | Default | Env Var | Description |
|-------|------|---------|---------|-------------|
| `wsPort` | number | `3101` | `WS_PORT` | WebSocket server port |
| `nextPort` | number | `3100` | `NEXT_PORT` | Next.js dev server port |

## Secret Fields

These fields are masked as `***` when sent to the frontend via `config:data`:

```
notionApiKey, vantaApiKey, vantaClientSecret, githubToken,
slackBotToken, slackAppToken, slackSigningSecret,
twilioAccountSid, twilioAuthToken, sfPassword, claudeOauthToken
```

When the frontend submits `config:update` with `***` values, those fields are stripped to prevent overwriting the real secrets.

## Config Update Side Effects

When config is updated via `config:update`, certain field changes trigger automatic service restarts:

| Fields Changed | Effect |
|---------------|--------|
| `slackBotToken`, `slackAppToken`, `slackSigningSecret`, `slackUpdateChannel` | Slack bot stop + restart |
| `twilioAccountSid`, `twilioAuthToken`, `twilioPhoneNumber` | Twilio server stop + restart |
