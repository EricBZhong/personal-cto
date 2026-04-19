/**
 * Production entry point for Cloud Run.
 * Serves both the Next.js app and the WebSocket orchestrator on a single port.
 *
 * - HTTP requests → Next.js standalone server handler
 * - WebSocket upgrades on /ws → Orchestrator WS server
 */
import http from 'http';
import { execSync } from 'child_process';
import { WebSocketServer } from 'ws';
import { orchestrator } from './orchestrator';
import { getConfig, updateConfig, initConfigFromFirestore, stopConfigListener } from './config';
import { engineerPool } from './engineer-pool';
import { eventBus } from './event-bus';
import { twilioServer } from './integrations/twilio';
import { slackBot } from './integrations/slack';
import { errorCollector } from './error-collector';
import { dailyCheckin } from './daily-checkin';

const PORT = parseInt(process.env.PORT || '8080', 10);

async function main(): Promise<void> {
  await initConfigFromFirestore();
  const config = getConfig();

  console.log('[Production] CTO Dashboard starting...');
  console.log(`[Production] Port: ${PORT}`);
  console.log(`[Production] CTO model: ${config.ctoModel}`);
  console.log(`[Production] Max engineers: ${config.engineerMaxConcurrent}`);

  // Resolve Claude CLI path — find the absolute path to avoid ENOENT errors
  const claudeBin = config.claudeCliPath || 'claude';
  try {
    const resolvedPath = execSync(`which ${claudeBin}`, { encoding: 'utf-8' }).trim();
    if (resolvedPath) {
      console.log(`[Production] Claude CLI found at: ${resolvedPath}`);
      // Update config with the absolute path so spawn() always finds it
      await updateConfig({ claudeCliPath: resolvedPath });
    }
  } catch {
    console.warn(`[Production] WARNING: Claude CLI '${claudeBin}' not found in PATH. Engineer/CTO spawning will fail.`);
  }

  // Load the Next.js standalone server handler
  let nextHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
  try {
    process.env.PORT = String(PORT);
    process.env.HOSTNAME = '0.0.0.0';

    // In standalone mode, Next.js build output is at .next/ in cwd
    const nextModule = await import('next');
    // Handle both ESM default export and CJS module.exports
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = nextModule as any;
    const createNext = mod.default?.default ?? mod.default ?? mod;
    const app = createNext({
      dir: process.cwd(),
      dev: false,
      customServer: true,
      port: PORT,
      hostname: '0.0.0.0',
    });
    await app.prepare();
    nextHandler = app.getRequestHandler();
    console.log('[Production] Next.js handler ready');
  } catch (err) {
    console.error('[Production] Failed to load Next.js handler, falling back to static:', err);
    nextHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('CTO Dashboard API (frontend not available)');
    };
  }

  // Create the HTTP server
  const server = http.createServer((req, res) => {
    // SEC5: CORS headers — allow same-host and localhost origins
    const requestOrigin = req.headers.origin || '';
    const host = req.headers.host || '';
    const allowedOrigins = [
      `http://localhost:3100`,
      `https://${host}`,
      `http://${host}`,
    ];
    if (allowedOrigins.includes(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        engineers: engineerPool.activeCount,
        uptime: process.uptime(),
      }));
      return;
    }

    // Forward everything else to Next.js
    nextHandler(req, res);
  });

  // Create WebSocket server (no dedicated port — attaches to the HTTP server)
  // SEC3: Limit max payload size to prevent memory exhaustion attacks
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  // Handle WebSocket upgrades on /ws path
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;

    if (pathname === '/ws') {
      // SEC1: Validate auth cookie on WS upgrade in production (non-localhost).
      // NextAuth v5 (Auth.js) uses authjs.* cookies; v4 uses next-auth.* cookies.
      const host = request.headers.host || '';
      const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('0.0.0.0');
      if (!isLocalhost) {
        const cookies = request.headers.cookie || '';
        const hasSessionToken =
          cookies.includes('authjs.session-token') ||
          cookies.includes('__Secure-authjs.session-token') ||
          cookies.includes('next-auth.session-token') ||
          cookies.includes('__Secure-next-auth.session-token');
        if (!hasSessionToken) {
          console.warn('[Production] WS upgrade rejected — no session cookie found');
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // Forward events to all connected WS clients
  eventBus.on('dashboard', (event: unknown) => {
    const msg = JSON.stringify(event);
    const ev = event as { type?: string };
    console.log(`[EventBus] Broadcasting: ${ev.type} to ${wss.clients.size} clients`);
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        try {
          client.send(msg);
        } catch (err) {
          console.error('[EventBus] Failed to send to client:', (err as Error).message);
        }
      }
    }
  });

  // Initialize orchestrator with the WS server (waits for Firestore hydration)
  await orchestrator.init(wss);
  console.log('[Production] Orchestrator initialized');

  // Start integrations
  twilioServer.start();
  slackBot.start();
  dailyCheckin.start();

  // Start listening
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Production] Server listening on port ${PORT}`);
    console.log('[Production] Ready.');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Production] Shutting down...');
    stopConfigListener();
    orchestrator.shutdown();
    dailyCheckin.stop();
    twilioServer.stop();
    slackBot.stop();
    wss.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err.message);
    errorCollector.record({
      source: 'backend',
      level: 'fatal',
      message: err.message,
      stack: err.stack,
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[FATAL] Unhandled rejection:', err.message);
    errorCollector.record({
      source: 'backend',
      level: 'error',
      message: err.message,
      stack: err.stack,
    });
  });
}

main().catch((err) => {
  console.error('[Production] Fatal startup error:', err);
  process.exit(1);
});
