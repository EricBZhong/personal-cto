/**
 * End-to-end test: starts the orchestrator, opens the chat page,
 * sends a message, and verifies a CTO response appears.
 *
 * Run: npx tsx scripts/test-chat.ts
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import WebSocket from 'ws';

const WS_PORT = 3101;
const TIMEOUT = 90_000; // 90s total

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForPort(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ws = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => { ws.close(); resolve(); });
        ws.on('error', reject);
      });
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Port ${port} not ready after ${timeoutMs}ms`);
}

async function main() {
  console.log('=== CTO Chat E2E Test ===\n');

  // 1. Start the server
  console.log('[1/5] Starting orchestrator server...');
  const server = spawn('npx', ['tsx', 'src/server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });

  let serverLog = '';
  server.stdout?.on('data', (d) => { serverLog += d.toString(); });
  server.stderr?.on('data', (d) => { serverLog += d.toString(); });

  // Wait for WS port to be ready
  try {
    await waitForPort(WS_PORT);
    console.log('[1/5] Server is ready on port', WS_PORT);
  } catch {
    console.error('FAIL: Server did not start.\n\nServer log:\n', serverLog);
    server.kill();
    process.exit(1);
  }

  // 2. Connect via WebSocket
  console.log('[2/5] Connecting WebSocket...');
  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  const received: Array<{ type: string; data?: any; payload?: any }> = [];

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
  console.log('[2/5] WebSocket connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      received.push(msg);
      if (msg.type === 'cto:chunk') {
        process.stdout.write(msg.data?.text || '');
      }
    } catch { /* skip */ }
  });

  // 3. Send a short test message
  const testMessage = 'Say hello in exactly one sentence.';
  console.log(`[3/5] Sending: "${testMessage}"`);
  ws.send(JSON.stringify({ type: 'chat:send', payload: { message: testMessage } }));

  // 4. Wait for cto:done or cto:error
  console.log('[4/5] Waiting for CTO response...\n---');

  const startTime = Date.now();
  let gotResponse = false;
  let error: string | null = null;

  while (Date.now() - startTime < TIMEOUT) {
    await sleep(500);

    const done = received.find(m => m.type === 'cto:done');
    const err = received.find(m => m.type === 'cto:error');

    if (done) {
      gotResponse = true;
      console.log('\n---');
      console.log(`[4/5] CTO responded: "${(done.data?.fullText || '').slice(0, 200)}"`);
      console.log(`      Cost: $${done.data?.costUsd || 0}`);
      break;
    }

    if (err) {
      error = err.data?.error || 'Unknown error';
      console.log('\n---');
      console.log(`[4/5] CTO error: ${error}`);
      break;
    }
  }

  if (!gotResponse && !error) {
    console.log('\n---');
    console.log('[4/5] TIMEOUT: No response received');
    console.log('Received message types:', received.map(m => m.type));
  }

  // 5. Report
  console.log('\n[5/5] Results:');
  console.log('  Response received:', gotResponse);
  console.log('  Error:', error || 'none');
  console.log('  Total messages received:', received.length);
  console.log('  Message types:', [...new Set(received.map(m => m.type))].join(', '));
  console.log('  Duration:', ((Date.now() - startTime) / 1000).toFixed(1) + 's');

  if (!gotResponse && !error) {
    console.log('\n  Server log (last 30 lines):');
    console.log(serverLog.split('\n').slice(-30).map(l => '    ' + l).join('\n'));
  }

  // Cleanup
  ws.close();
  server.kill();

  console.log('\n' + (gotResponse ? 'PASS ✓' : 'FAIL ✗'));
  process.exit(gotResponse ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
