import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import { orchestrator } from './orchestrator';
import { getConfig, initConfigFromFirestore, stopConfigListener } from './config';
import { engineerPool } from './engineer-pool';
import { eventBus } from './event-bus';
import { twilioServer } from './integrations/twilio';
import { slackBot } from './integrations/slack';
import { dailyCheckin } from './daily-checkin';
import { errorCollector } from './error-collector';

/** Kill any process holding the given port, returns true if something was killed */
function freePort(port: number): boolean {
  try {
    const pid = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (pid) {
      console.log(`[Server] Port ${port} in use by PID ${pid} — killing stale process`);
      execSync(`kill -9 ${pid} 2>/dev/null`);
      // Brief pause to let the OS release the port
      execSync('sleep 0.3');
      return true;
    }
  } catch {
    // No process found or kill failed — that's fine
  }
  return false;
}

function createWebSocketServer(port: number, attempt = 1): WebSocketServer {
  const MAX_ATTEMPTS = 3;
  try {
    // SEC3: Limit max payload size to prevent memory exhaustion attacks
    return new WebSocketServer({ port, maxPayload: 64 * 1024 });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EADDRINUSE' && attempt <= MAX_ATTEMPTS) {
      console.warn(`[Server] Port ${port} in use (attempt ${attempt}/${MAX_ATTEMPTS})`);
      freePort(port);
      return createWebSocketServer(port, attempt + 1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  await initConfigFromFirestore();
  const config = getConfig();
  const port = config.wsPort;

  console.log('[Server] CTO Dashboard Orchestrator starting...');
  console.log(`[Server] Colby repo: ${config.colbyRepoPath}`);
  console.log(`[Server] Claude CLI: ${config.claudeCliPath}`);
  console.log(`[Server] CTO model: ${config.ctoModel}`);
  console.log(`[Server] Max engineers: ${config.engineerMaxConcurrent}`);
  console.log(`[Server] Max concurrent: ${config.engineerMaxConcurrent}`);

  // Start WebSocket server (with port recovery)
  const wss = createWebSocketServer(port);
  console.log(`[Server] WebSocket server on port ${port}`);

  // Forward events to all connected clients
  eventBus.on('dashboard', (event: unknown) => {
    const msg = JSON.stringify(event);
    const ev = event as { type?: string };
    console.log(`[EventBus] Broadcasting: ${ev.type} to ${wss.clients.size} clients (${msg.length} bytes)`);
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

  // Initialize orchestrator (waits for Firestore hydration)
  await orchestrator.init(wss);
  console.log('[Server] Orchestrator initialized');

  // Start Twilio webhook server (if configured)
  twilioServer.start();

  // Start Slack bot (if configured)
  slackBot.start();

  // Start daily check-in scheduler
  dailyCheckin.start();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Server] Shutting down...');
    stopConfigListener();
    orchestrator.shutdown();
    dailyCheckin.stop();
    twilioServer.stop();
    slackBot.stop();
    wss.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Capture uncaught errors for self-diagnosis
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err.message);
    errorCollector.record({
      source: 'backend',
      level: 'fatal',
      message: err.message,
      stack: err.stack,
    });
    // Fatal exceptions leave the process in an unknown state — exit and let
    // the process manager (nodemon/pm2/systemd) restart us cleanly.
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

  console.log('[Server] Ready. Waiting for connections...');
}

main().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
