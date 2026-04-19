/**
 * Integration test: Self-healing error detection
 *
 * 1. Starts the orchestrator
 * 2. Connects via WebSocket
 * 3. Sends a fake frontend error via error:report
 * 4. Verifies the error was recorded and an auto-fix task was created
 * 5. Checks the task appears in the task list
 *
 * Run: npx tsx scripts/test-self-heal.ts
 */
import { spawn } from 'child_process';
import WebSocket from 'ws';

const WS_PORT = 3101;
const TIMEOUT = 30_000;

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
  console.log('=== Self-Healing Integration Test ===\n');

  // 1. Start server
  console.log('[1/6] Starting orchestrator...');
  const server = spawn('npx', ['tsx', 'src/server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });

  let serverLog = '';
  server.stdout?.on('data', (d) => { serverLog += d.toString(); });
  server.stderr?.on('data', (d) => { serverLog += d.toString(); });

  try {
    await waitForPort(WS_PORT);
    console.log('[1/6] Server ready');
  } catch {
    console.error('FAIL: Server did not start.\n', serverLog);
    server.kill();
    process.exit(1);
  }

  // 2. Connect WebSocket
  console.log('[2/6] Connecting WebSocket...');
  const ws = new WebSocket(`ws://localhost:${WS_PORT}`);
  const received: Array<{ type: string; data?: unknown; payload?: unknown }> = [];

  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
  });
  console.log('[2/6] Connected');

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      received.push(msg);
    } catch { /* skip */ }
  });

  // Wait for initial state to load
  await sleep(1000);

  // 3. Send a simulated frontend error
  console.log('[3/6] Sending simulated frontend error...');
  ws.send(JSON.stringify({
    type: 'error:report',
    payload: {
      source: 'frontend',
      level: 'error',
      message: 'TypeError: Cannot read properties of undefined (reading "startedAt")',
      stack: `TypeError: Cannot read properties of undefined (reading 'startedAt')
    at EngineerCard (src/components/engineers/EngineerCard.tsx:13:55)
    at renderWithHooks (react-dom.development.js:16305:18)`,
      context: { component: 'EngineerCard', page: '/engineers' },
    },
  }));

  // 4. Wait for the system to process it and create a task
  console.log('[4/6] Waiting for auto-fix task creation...');
  await sleep(3000);

  // 5. Request task list to see the auto-created task
  console.log('[5/6] Requesting task list...');
  ws.send(JSON.stringify({ type: 'task:list' }));
  await sleep(1000);

  // 6. Check results
  console.log('[6/6] Checking results...\n');

  const taskListMsg = received.find(m => m.type === 'task:list');
  const tasks = (taskListMsg?.payload as { tasks?: Array<{ title: string; description: string; status: string; branch: string }> })?.tasks || [];

  const autoFixTask = tasks.find(t => t.title.startsWith('Auto-fix:'));

  console.log('--- Results ---');
  console.log(`Total messages received: ${received.length}`);
  console.log(`Message types: ${[...new Set(received.map(m => m.type))].join(', ')}`);
  console.log(`Total tasks: ${tasks.length}`);
  console.log(`Auto-fix task found: ${!!autoFixTask}`);

  if (autoFixTask) {
    console.log(`\nAuto-fix task:`);
    console.log(`  Title: ${autoFixTask.title}`);
    console.log(`  Status: ${autoFixTask.status}`);
    console.log(`  Branch: ${autoFixTask.branch}`);
    console.log(`  Description preview: ${autoFixTask.description.slice(0, 200)}...`);
  }

  // Also request error list
  ws.send(JSON.stringify({ type: 'error:list' }));
  await sleep(500);

  const errorListMsg = received.find(m => m.type === 'error:list');
  const errors = (errorListMsg?.payload as { errors?: Array<{ message: string; source: string; auto_task_id?: string }> })?.errors || [];
  const matchingError = errors.find(e => e.message.includes('startedAt'));

  console.log(`\nError events recorded: ${errors.length}`);
  if (matchingError) {
    console.log(`Matching error found: "${matchingError.message.slice(0, 80)}"`);
    console.log(`Linked task ID: ${matchingError.auto_task_id || 'none'}`);
  }

  // Cleanup
  ws.close();
  server.kill();

  const passed = !!autoFixTask && !!matchingError;
  console.log(`\n${passed ? 'PASS ✓' : 'FAIL ✗'} — Error detected and auto-fix task ${passed ? 'was' : 'was NOT'} created`);
  process.exit(passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
