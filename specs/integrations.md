# Integrations

All integration clients live under `src/server/integrations/`.

Each integration is optional and configured via the Settings page or environment variables. When an unconfigured integration is accessed, the server sends a `setup:prompt` message to trigger the frontend Setup Wizard.

---

## Notion (`notion.ts`)

**Purpose**: Sync tasks with the Notion engineering board.

**Configuration**:
- `notionApiKey` — Notion integration API key
- `notionBoardId` — Notion database ID for the engineering board

**Capabilities**:
- `queryBoard()` — Query all tickets from the board
- `getTicketSummary()` — Text summary for CTO context injection
- `createTicket({ title, description, status, priority })` — Create ticket on the board
- `updateTicketStatus(pageId, status)` — Sync status changes
- `getPageCreator(pageId)` — Get ticket creator (for clarification DMs)

**Auto-Sync**: Tasks created in the dashboard are automatically mirrored to Notion. Status changes sync bidirectionally.

**Status Mapping**: See [server.md](./server.md#task-queue) for the status mapping table.

---

## GitHub (`github.ts`)

**Purpose**: PR management, CI status, diffs via `gh` CLI.

**Configuration**:
- `githubRepo` — Default repo (e.g., `EricBZhong/my-app`)
- `githubToken` — GitHub personal access token (also `GH_TOKEN` env var)

**Capabilities**:
- `getOpenPRs(limit?)` — List open PRs with metadata
- `getPRDetails(prNumber)` — Full PR info (additions, deletions, checks, reviews)
- `getPRDiff(prNumber)` — Full diff text
- `getPRReviews(prNumber)` — Review history
- `getPRSummary()` — Text summary for CTO context injection
- `getRepoStats()` — Repository statistics
- `submitPRReview(prNumber, body, event)` — Submit review (APPROVE/COMMENT/REQUEST_CHANGES)
- `mergePR(prNumber, method)` — Merge PR (squash/merge/rebase)
- `addPRComment(prNumber, body)` — Add comment

**Implementation**: Uses `execSync`/`exec` to call `gh` CLI. Token injected via `GH_TOKEN` environment variable.

---

## GCP (`gcp.ts`)

**Purpose**: Cloud Run service health and logs.

**Capabilities**:
- `getServiceHealth()` — List Cloud Run services with status
- `getHealthSummary()` — Text summary for CTO context injection
- `getRecentLogs(service, project)` — Recent logs for a service
- `pingAllServices()` — Health check all services

**Implementation**: Uses `gcloud` CLI via `exec`.

---

## Vanta (`vanta.ts`)

**Purpose**: SOC 2 compliance monitoring.

**Configuration**:
- `vantaApiKey` — Vanta API key
- `vantaClientId` — OAuth client ID
- `vantaClientSecret` — OAuth client secret

**Capabilities**:
- `getComplianceOverview()` — Category scores and overall compliance
- `getFailingControls()` — List of failing controls with remediation
- `getComplianceSummary()` — Text summary for CTO context injection
- `isConfigured` — Check if Vanta credentials are present

---

## Slack (`slack.ts`)

**Purpose**: Bot messaging, DMs, channel mentions, status updates, task actions.

**Configuration**:
- `slackBotToken` — Bot OAuth token (`xoxb-...`)
- `slackAppToken` — App-level token (`xapp-...`) for Socket Mode
- `slackSigningSecret` — Request signing secret
- `slackUpdateChannel` — Channel for status updates (e.g., `#ai-eric-updates`)

**Capabilities**:
- `start()` / `stop()` — Start/stop Socket Mode connection
- `isConnected` / `isConfigured` — Connection status
- `sendDM(userId, message)` — Send direct message
- `postMessage(channel, message)` — Post to channel
- `postBlockMessage(channel, text, blocks)` — Post with Block Kit
- `postStatusUpdate()` — Post system status to update channel
- `lookupUserByEmail(email)` — Find Slack user by email
- `lookupUserByName(name)` — Find Slack user by display name
- `buildStrategyPollBlocks(...)` — Build Block Kit poll message

**Message Handling**: Incoming DMs, mentions, and group messages are queued in Firestore `slackMessageQueue`. The CTO processes them and replies in-thread.

**Task Actions**: Slack messages can trigger task approval/rejection via button interactions.

**Restart**: Config changes to Slack fields trigger automatic bot restart.

---

## Twilio (`twilio.ts`)

**Purpose**: Voice calls and SMS to/from the CTO.

**Configuration**:
- `twilioAccountSid` — Account SID
- `twilioAuthToken` — Auth token
- `twilioPhoneNumber` — Twilio phone number
- `ceoPhoneNumber` — CEO's phone number

**Capabilities**:
- HTTP webhook server on port 3102
- Voice call handling (TwiML responses)
- SMS message handling
- Routes voice/SMS to CTO for response

**Restart**: Config changes to Twilio fields trigger automatic server restart.

---

## Browser Automation (`browser.ts`)

**Purpose**: Puppeteer-based web UI interaction for dogfood testing.

**Configuration**:
- `browserAutomationEnabled` — Toggle
- `browserHeadless` — Headless mode toggle

**Capabilities**:
- `getBrowserMCPArgs()` — Returns Claude CLI MCP args for Playwright
- `buildBrowserInstructions()` — Returns instructions for engineer prompts
- Used by dogfood testing framework for UI interaction tests

**Implementation**: Uses Puppeteer (`puppeteer@^24.40.0`).

---

## Skill Profile System (Integration Injection)

The skill profile system enables arbitrary integration injection into engineer environments without code changes.

**Mechanism**: Each `SkillProfile` in the config can specify:
- `systemPromptAddition` — Custom text appended to the engineer system prompt (e.g., domain-specific instructions)
- `mcpServers` — MCP server names to enable for the engineer subprocess
- `envVars` — Environment variables injected into the engineer's process environment
- `modelOverride` — Override the default model for tasks using this profile

**Tool Registry**: The `toolRegistry` config field maps external tools (API keys, service credentials) to skill profiles. When an engineer is spawned with a matching skill profile, the tool's environment variables are injected automatically.

**Use Case**: This enables adding new integrations (e.g., ElevenLabs for voice, TikTok for social media, Stripe for payments) by configuring a skill profile with the appropriate API keys and instructions, without modifying any server code. The CTO assigns tasks with `"skillProfile": "voice"` and the engineer automatically gets the right context and credentials.
