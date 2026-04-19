# ---- Build stage ----
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build Next.js
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:20-slim AS runner

WORKDIR /app

# Install system deps for git, gh CLI, Chromium (dogfood browser tests), and Claude CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates gnupg \
    chromium fonts-liberation fonts-noto-color-emoji && \
    # Install GitHub CLI
    mkdir -p -m 755 /etc/apt/keyrings && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    # Install Claude CLI + chrome-devtools-mcp for Claude MCP browser tools
    npm install -g @anthropic-ai/claude-code chrome-devtools-mcp && \
    # Verify Claude CLI is accessible
    claude --version && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built Next.js standalone output first (includes minimal node_modules)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Install tsx on top of standalone's node_modules (for running TypeScript server)
RUN npm install tsx typescript

# Copy server source (runs via tsx at runtime)
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./

# Create non-root user (Claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash appuser && chown -R appuser:appuser /app

# Configure chrome-devtools-mcp for Claude CLI agents (CTO + engineers get browser tools)
RUN mkdir -p /home/appuser/.claude && \
    echo '{"mcpServers":{"chrome-devtools":{"command":"chrome-devtools-mcp","args":["--headless","--no-sandbox"]}}}' \
    > /home/appuser/.claude/settings.json && \
    chown -R appuser:appuser /home/appuser/.claude

USER appuser

# Default port for Cloud Run
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start the production server (serves Next.js + WS on single port)
CMD ["npx", "tsx", "src/server/production.ts"]
