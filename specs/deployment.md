# Deployment

## Local Development

```bash
npm run dev          # Starts Next.js (3100) + orchestrator (3101) concurrently
npm run dev:next     # Next.js only
npm run dev:server   # Orchestrator only
```

Uses `concurrently` to run both processes. Next.js serves the frontend, the orchestrator handles WebSocket connections and Claude spawning.

## Production (Cloud Run)

### Entry Point

`src/server/production.ts` — Single-port server that combines Next.js and WebSocket on port 8080.

- Next.js serves all HTTP requests
- WebSocket connections upgrade on the `/ws` path
- Health check endpoint at `/health` (returns `{ status: 'ok', uptime, timestamp }`)
- Start command: `npx tsx src/server/production.ts`

### Docker

**Dockerfile** — Multi-stage build using `node:20-slim`.

**Builder Stage**:
- `npm ci` for dependencies
- `npm run build` for Next.js compilation

**Runner Stage**:
- Installs: `git`, `curl`, `ca-certificates`, `gnupg`
- Installs GitHub CLI (`gh`) from official repo
- Installs Claude CLI globally: `npm install -g @anthropic-ai/claude-code`
- Installs `tsx` and `typescript` for runtime TypeScript execution
- Copies Next.js standalone output + static files
- Copies `src/` and `tsconfig.json` for server code
- Creates non-root `appuser` (required for Claude CLI `--dangerously-skip-permissions`)
- Exposes port 8080
- Health check: `curl -f http://localhost:8080/health`

### CI/CD

**GitHub Actions** — `.github/workflows/deploy.yml`

**Trigger**: Push to `main`

**Jobs**:
1. **build** — Build Docker image, push to Artifact Registry (`us-docker.pkg.dev`)
2. **smoke-test** — Run container locally, verify:
   - `/health` endpoint responds
   - Frontend HTML is served
   - Claude CLI is available
3. **deploy** — Deploy to Cloud Run
4. **post-deploy** — Verify the deployed service responds

### Cloud Run Configuration

| Setting | Value |
|---------|-------|
| Region | us-central1 |
| Memory | 4Gi |
| CPU | 2 |
| Min instances | 1 |
| Max instances | 5 |
| Timeout | 900s (15 min) |
| Session affinity | Enabled (WebSocket sticky sessions) |
| Concurrency | Default |

### GCP Project

- **Project**: `cto-dashboard-prod`
- **Service Account**: `cto-dashboard-sa@YOUR_GCP_PROJECT.iam.gserviceaccount.com`
- **Artifact Registry**: `us-docker.pkg.dev/{project}/cto-dashboard`
- **Auth**: Workload Identity Federation for GitHub Actions

### Secrets (GCP Secret Manager)

Secrets are mounted as environment variables in the Cloud Run service:

| Secret Name | Maps To |
|-------------|---------|
| `CLAUDE_OAUTH_TOKEN` | Claude CLI OAuth token (subscription auth — run `claude /setup-token` to generate) |
| `GH_TOKEN` | GitHub personal access token |
| `NOTION_API_KEY` | Notion integration key |
| `VANTA_API_KEY` | Vanta API key |
| `VANTA_CLIENT_ID` | Vanta OAuth client ID |
| `VANTA_CLIENT_SECRET` | Vanta OAuth client secret |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `SLACK_APP_TOKEN` | Slack app token |
| `SLACK_SIGNING_SECRET` | Slack signing secret |
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `SF_PASSWORD` | Salesforce password |
| `NEXTAUTH_SECRET` | NextAuth session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Cloud Run Engineer Behavior

In production (Cloud Run), engineers don't have local repo access. Instead:
1. `resolveGitHubSlug()` maps repo identifiers to GitHub slugs
2. Repo is cloned into a temp directory (`mkdtemp`)
3. Git credential helper is configured with `GH_TOKEN`
4. Engineer works in the cloned repo
5. Temp directory is cleaned up after completion

### Automated Deploy via DeployManager

The `DeployManager` class (`src/server/deploy-manager.ts`) provides programmatic deployment triggered from the dashboard or CTO. This is separate from the CI/CD pipeline above (which deploys on push to `main`).

**Use Case**: When a project completes all phases with `autoDeploy: true`, or when the CTO outputs a `<deploy_trigger>` block, or when manually triggered via `deploy:trigger` WebSocket message.

**Deploy Flow**:
1. **Docker Build**: `docker build -t gcr.io/{gcpProject}/{serviceName}:latest {dockerfilePath}` — builds in the repo's local directory
2. **GCR Push**: `docker push` to Google Container Registry
3. **Cloud Run Deploy**: `gcloud run deploy` with managed platform, `--allow-unauthenticated`, JSON output
4. **Health Check Verification**: `curl -sf --max-time 30` against the health check URL or service URL

**Configuration**: Deploy targets are configured via `deployTargets` in Settings (see configuration.md). Each target maps a repo name to a GCP project, region, service name, Dockerfile path, and health check URL.

**Status Events**: The deploy emits `deploy:started`, `deploy:progress` (for each step), and `deploy:completed` (success or failure) via the EventBus, which are broadcast to all connected WebSocket clients.

**Repo Creation**: The DeployManager can also create new GitHub repos via `gh repo create` (public/private, with optional template), triggered by CTO `<create_repo>` blocks.

---

### Next.js Production Config

`next.config.ts`:
```typescript
output: "standalone"  // Required for Docker/Cloud Run deployment
```

The `standalone` output creates a self-contained server that doesn't need `node_modules`.
