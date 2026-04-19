import { ExtensionHarness, DogfoodResult, DogfoodOptions } from './extension-harness';
import { ctoSession } from '../cto-session';
import { collections, evalRuns } from '../firestore';

/**
 * Configurable eval definition — can be created by users or the CTO agent.
 * Stored in Firestore so they persist across sessions.
 */
export interface EvalDefinition {
  id: string;
  name: string;
  description: string;
  category: 'functional' | 'edge-case' | 'performance' | 'accessibility' | 'security';
  /** The message to send to the extension chat */
  input: string;
  /** What to check for in the response (substring match) */
  expectedBehavior?: string;
  /** Max acceptable TTFT in ms */
  maxTtftMs?: number;
  /** Max acceptable total response time in ms */
  maxResponseMs?: number;
  /** Should the page remain error-free after this input? */
  expectNoErrors: boolean;
  /** Created by 'user' or 'cto' */
  createdBy: 'user' | 'cto';
  created_at: string;
}

export interface EvalResult {
  evalId: string;
  evalName: string;
  passed: boolean;
  ttft_ms?: number;
  response_ms?: number;
  responseSnippet?: string;
  consoleErrors: string[];
  screenshotPath?: string;
  notes: string[];
}

/** CRUD operations for eval definitions */
export const evalStore = {
  async create(eval_: Omit<EvalDefinition, 'id' | 'created_at'>): Promise<EvalDefinition> {
    const id = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const data = {
      name: eval_.name,
      description: eval_.description,
      category: eval_.category,
      input: eval_.input,
      expected_behavior: eval_.expectedBehavior || null,
      max_ttft_ms: eval_.maxTtftMs || null,
      max_response_ms: eval_.maxResponseMs || null,
      expect_no_errors: eval_.expectNoErrors,
      created_by: eval_.createdBy,
      created_at: now,
    };

    await collections.dogfoodEvals.doc(id).set(data);

    return { ...eval_, id, created_at: now };
  },

  async getAll(): Promise<EvalDefinition[]> {
    const snap = await collections.dogfoodEvals.orderBy('created_at', 'desc').get();
    return snap.docs.map(doc => {
      const r = doc.data();
      return {
        id: doc.id,
        name: r.name as string,
        description: r.description as string,
        category: r.category as EvalDefinition['category'],
        input: r.input as string,
        expectedBehavior: r.expected_behavior as string | undefined,
        maxTtftMs: r.max_ttft_ms as number | undefined,
        maxResponseMs: r.max_response_ms as number | undefined,
        expectNoErrors: !!(r.expect_no_errors),
        createdBy: r.created_by as 'user' | 'cto',
        created_at: r.created_at as string,
      };
    });
  },

  async getById(id: string): Promise<EvalDefinition | undefined> {
    const doc = await collections.dogfoodEvals.doc(id).get();
    if (!doc.exists) return undefined;
    const r = doc.data()!;
    return {
      id: doc.id,
      name: r.name as string,
      description: r.description as string,
      category: r.category as EvalDefinition['category'],
      input: r.input as string,
      expectedBehavior: r.expected_behavior as string | undefined,
      maxTtftMs: r.max_ttft_ms as number | undefined,
      maxResponseMs: r.max_response_ms as number | undefined,
      expectNoErrors: !!(r.expect_no_errors),
      createdBy: r.created_by as 'user' | 'cto',
      created_at: r.created_at as string,
    };
  },

  async delete(id: string): Promise<void> {
    await collections.dogfoodEvals.doc(id).delete();
  },

  async recordRun(result: EvalResult): Promise<void> {
    await evalRuns(result.evalId).add({
      eval_id: result.evalId,
      passed: result.passed,
      ttft_ms: result.ttft_ms || null,
      response_ms: result.response_ms || null,
      response_snippet: result.responseSnippet || null,
      console_errors: result.consoleErrors,
      screenshot_path: result.screenshotPath || null,
      notes: result.notes,
      run_at: new Date().toISOString(),
    });
  },

  async getRunHistory(evalId?: string, limit = 50): Promise<Array<EvalResult & { run_at: string }>> {
    if (evalId) {
      const snap = await evalRuns(evalId).orderBy('run_at', 'desc').limit(limit).get();
      // Get eval name
      const evalDoc = await collections.dogfoodEvals.doc(evalId).get();
      const evalName = evalDoc.exists ? (evalDoc.data()!.name as string) : '';

      return snap.docs.map(doc => {
        const r = doc.data();
        return {
          evalId: r.eval_id as string,
          evalName,
          passed: !!(r.passed),
          ttft_ms: r.ttft_ms as number | undefined,
          response_ms: r.response_ms as number | undefined,
          responseSnippet: r.response_snippet as string | undefined,
          consoleErrors: (r.console_errors as string[]) || [],
          screenshotPath: r.screenshot_path as string | undefined,
          notes: (r.notes as string[]) || [],
          run_at: r.run_at as string,
        };
      });
    }

    // Without evalId, query each eval's runs subcollection individually
    // (collectionGroup queries require a manually-created Firestore index)
    const allEvals = await collections.dogfoodEvals.get();
    const allRuns: Array<EvalResult & { run_at: string }> = [];

    for (const evalDoc of allEvals.docs) {
      const evalName = (evalDoc.data().name as string) || '';
      const runsSnap = await evalRuns(evalDoc.id).orderBy('run_at', 'desc').limit(limit).get();
      for (const doc of runsSnap.docs) {
        const r = doc.data();
        allRuns.push({
          evalId: r.eval_id as string || evalDoc.id,
          evalName,
          passed: !!(r.passed),
          ttft_ms: r.ttft_ms as number | undefined,
          response_ms: r.response_ms as number | undefined,
          responseSnippet: r.response_snippet as string | undefined,
          consoleErrors: (r.console_errors as string[]) || [],
          screenshotPath: r.screenshot_path as string | undefined,
          notes: (r.notes as string[]) || [],
          run_at: r.run_at as string,
        });
      }
    }

    // Sort all runs by run_at desc and take the limit
    allRuns.sort((a, b) => (b.run_at || '').localeCompare(a.run_at || ''));
    return allRuns.slice(0, limit);
  },

  /** Seed default evals if none exist */
  async seedDefaults(): Promise<void> {
    const snap = await collections.dogfoodEvals.limit(1).get();
    if (!snap.empty) return;

    const defaults: Array<Omit<EvalDefinition, 'id' | 'created_at'>> = [
      {
        name: 'Basic opportunity query',
        description: 'Ask about open opportunities — the most common user action',
        category: 'functional',
        input: 'What are my open opportunities?',
        expectedBehavior: 'opportunity',
        maxTtftMs: 5000,
        maxResponseMs: 30000,
        expectNoErrors: true,
        createdBy: 'user',
      },
      {
        name: 'Data loading with query',
        description: 'Ask to load and query data — tests the DuckDB pipeline',
        category: 'functional',
        input: 'Load my recent contacts and show me the top 10 by last activity date',
        maxTtftMs: 8000,
        maxResponseMs: 60000,
        expectNoErrors: true,
        createdBy: 'user',
      },
      {
        name: 'Chinese language input',
        description: 'Test multilingual support with Chinese characters',
        category: 'edge-case',
        input: '显示我的销售管道概览',
        expectNoErrors: true,
        createdBy: 'user',
      },
      {
        name: 'XSS attempt',
        description: 'Ensure special characters are sanitized',
        category: 'security',
        input: '<img src=x onerror=alert(1)> Show me opportunities',
        expectNoErrors: true,
        createdBy: 'user',
      },
      {
        name: 'SQL injection attempt',
        description: 'Ensure SQL injection is handled safely',
        category: 'security',
        input: "Show opportunities WHERE 1=1; DROP TABLE salesforce_data; --",
        expectNoErrors: true,
        createdBy: 'user',
      },
    ];

    for (const d of defaults) {
      await evalStore.create(d);
    }
  },
};

/**
 * Run a set of evals against the live extension.
 * Time-boxed: stops after `durationMinutes` even if not all evals are done.
 */
export async function runEvals(
  evalIds?: string[],
  options: DogfoodOptions & { durationMinutes?: number } = {},
): Promise<DogfoodResult> {
  const startTime = Date.now();
  const maxDuration = (options.durationMinutes || 10) * 60 * 1000;

  const allEvals = evalIds
    ? await Promise.all(evalIds.map(id => evalStore.getById(id)))
    : await evalStore.getAll();
  const evals = allEvals.filter(Boolean) as EvalDefinition[];

  const result: DogfoodResult = {
    success: false,
    testName: 'eval-suite',
    duration_ms: 0,
    screenshots: [],
    metrics: {},
    errors: [],
    logs: [],
  };

  if (evals.length === 0) {
    result.errors.push('No evals defined. Create some in the Dogfood page.');
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const harness = new ExtensionHarness();
  let passCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  try {
    result.logs.push(`Starting eval suite: ${evals.length} evals, ${options.durationMinutes || 10} min time limit`);
    await harness.launch(options);

    // Navigate and open sidebar
    await harness.openSidebar('https://login.salesforce.com');
    const extPage = await harness.getExtensionPage();

    if (!extPage) {
      result.errors.push('Could not open extension sidebar');
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    const hasTextarea = await extPage.$('textarea');
    if (!hasTextarea) {
      result.errors.push('Extension not authenticated — cannot run evals');
      result.screenshots.push(await harness.screenshot('eval-not-auth'));
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // Capture console errors
    let currentErrors: string[] = [];
    extPage.on('console', (msg) => {
      if (msg.type() === 'error') currentErrors.push(msg.text());
    });
    extPage.on('pageerror', (err: unknown) => {
      currentErrors.push(`PAGE ERROR: ${(err as Error).message}`);
    });

    for (const eval_ of evals) {
      // Time box check
      if (Date.now() - startTime > maxDuration) {
        skippedCount += evals.length - passCount - failCount;
        result.logs.push(`\nTime limit reached (${options.durationMinutes || 10} min). Stopping.`);
        break;
      }

      currentErrors = [];
      const evalStart = Date.now();
      result.logs.push(`\n--- Eval: ${eval_.name} [${eval_.category}] ---`);
      result.logs.push(`Input: "${eval_.input.slice(0, 100)}${eval_.input.length > 100 ? '...' : ''}"`);

      const evalResult: EvalResult = {
        evalId: eval_.id,
        evalName: eval_.name,
        passed: true,
        consoleErrors: [],
        notes: [],
      };

      try {
        // Clear textarea
        await extPage.evaluate(() => {
          const ta = document.querySelector('textarea');
          if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
        });

        // Type and send
        await extPage.type('textarea', eval_.input);
        const sendTime = Date.now();
        await extPage.keyboard.press('Enter');

        // Wait for response
        try {
          await extPage.waitForFunction(() => {
            const containers = document.querySelectorAll('[class*="overflow-y-auto"]');
            for (const c of containers) {
              if (c.children.length > 1) return true;
            }
            return false;
          }, { timeout: eval_.maxResponseMs || 30000 });

          const ttft = Date.now() - sendTime;
          evalResult.ttft_ms = ttft;
          result.logs.push(`TTFT: ${ttft}ms`);

          // Check TTFT threshold
          if (eval_.maxTtftMs && ttft > eval_.maxTtftMs) {
            evalResult.passed = false;
            evalResult.notes.push(`TTFT ${ttft}ms exceeded max ${eval_.maxTtftMs}ms`);
            result.logs.push(`FAIL: TTFT exceeded (${ttft}ms > ${eval_.maxTtftMs}ms)`);
          }

          // Wait for response to complete (stable for 2 seconds)
          let lastLen = 0;
          let stable = 0;
          while (stable < 2 && (Date.now() - sendTime) < (eval_.maxResponseMs || 60000)) {
            await new Promise(r => setTimeout(r, 1000));
            const curLen = await extPage.evaluate(() => {
              const containers = document.querySelectorAll('[class*="overflow-y-auto"]');
              let total = 0;
              for (const c of containers) total += c.textContent?.length || 0;
              return total;
            });
            if (curLen === lastLen) stable++;
            else { stable = 0; lastLen = curLen; }
          }

          const totalMs = Date.now() - sendTime;
          evalResult.response_ms = totalMs;

          // Get response text
          const responseText = await extPage.evaluate(() => {
            const containers = document.querySelectorAll('[class*="overflow-y-auto"]');
            const last = containers[containers.length - 1];
            return last?.textContent?.slice(-500) || '';
          });
          evalResult.responseSnippet = responseText.slice(0, 200);

          // Check expected behavior
          if (eval_.expectedBehavior && !responseText.toLowerCase().includes(eval_.expectedBehavior.toLowerCase())) {
            evalResult.passed = false;
            evalResult.notes.push(`Expected "${eval_.expectedBehavior}" not found in response`);
            result.logs.push(`FAIL: Expected behavior not found`);
          }

        } catch {
          evalResult.passed = false;
          evalResult.notes.push('Timeout waiting for response');
          result.logs.push('FAIL: Timeout');
        }

        // Check console errors
        if (eval_.expectNoErrors && currentErrors.length > 0) {
          evalResult.passed = false;
          evalResult.consoleErrors = [...currentErrors];
          evalResult.notes.push(`${currentErrors.length} console error(s)`);
          result.logs.push(`FAIL: ${currentErrors.length} console error(s)`);
        }

        // Screenshot
        const ssPath = await harness.screenshot(`eval-${eval_.id.slice(0, 12)}`);
        evalResult.screenshotPath = ssPath;
        result.screenshots.push(ssPath);

      } catch (err) {
        evalResult.passed = false;
        evalResult.notes.push(`Error: ${(err as Error).message}`);
        result.logs.push(`ERROR: ${(err as Error).message}`);
      }

      // Record result
      await evalStore.recordRun(evalResult);

      if (evalResult.passed) {
        passCount++;
        result.logs.push('PASS');
      } else {
        failCount++;
        result.errors.push(`[${eval_.name}] ${evalResult.notes.join('; ')}`);
      }

      const evalDuration = Date.now() - evalStart;
      result.metrics[`eval_${eval_.name.replace(/\s+/g, '_')}_ms`] = evalDuration;

      // Pause between evals
      await new Promise(r => setTimeout(r, 1500));
    }

    result.metrics.evals_passed = passCount;
    result.metrics.evals_failed = failCount;
    result.metrics.evals_skipped = skippedCount;
    result.metrics.evals_total = evals.length;
    result.success = failCount === 0 && skippedCount === 0;

  } catch (err) {
    result.errors.push((err as Error).message);
  } finally {
    result.duration_ms = Date.now() - startTime;
    await harness.close();
  }

  return result;
}

/**
 * Have the CTO generate new eval scenarios based on the codebase and past failures.
 */
export async function generateCTOEvals(): Promise<void> {
  const existingEvals = await evalStore.getAll();
  const recentFailures = (await evalStore.getRunHistory(undefined, 20))
    .filter(r => !r.passed);

  const prompt = `You are reviewing the Chrome extension's test coverage.

Current eval count: ${existingEvals.length}
Existing eval names: ${existingEvals.map(e => e.name).join(', ')}
Recent failures: ${recentFailures.length > 0 ? recentFailures.map(f => `${f.evalId}: ${f.notes.join(', ')}`).join('\n') : 'None'}

Generate 3-5 NEW eval scenarios that would find bugs we haven't caught yet. Think creatively about:
- Real-world usage patterns (salespeople switching between accounts, mobile usage)
- Localization edge cases
- Network reliability (what happens if the response is very slow?)
- Complex Salesforce queries that test agent routing
- Interactions that could cause state corruption

For each eval, output a <eval_definition> block:

<eval_definition>
{
  "name": "Short descriptive name",
  "description": "What this tests and why",
  "category": "functional|edge-case|performance|accessibility|security",
  "input": "The exact message to send to the extension",
  "expectedBehavior": "optional substring to check for in response",
  "maxTtftMs": 5000,
  "maxResponseMs": 30000,
  "expectNoErrors": true
}
</eval_definition>`;

  await ctoSession.sendMessage(prompt);

  // Parse eval definitions from CTO response
  const lastMsg = await ctoSession.getLastAssistantMessage();

  if (lastMsg) {
    const regex = /<eval_definition>\s*(\{[\s\S]*?\})\s*<\/eval_definition>/g;
    let match;
    let created = 0;

    while ((match = regex.exec(lastMsg)) !== null) {
      try {
        const def = JSON.parse(match[1]);
        await evalStore.create({
          name: def.name,
          description: def.description,
          category: def.category || 'functional',
          input: def.input,
          expectedBehavior: def.expectedBehavior,
          maxTtftMs: def.maxTtftMs,
          maxResponseMs: def.maxResponseMs,
          expectNoErrors: def.expectNoErrors ?? true,
          createdBy: 'cto',
        });
        created++;
      } catch { /* skip malformed */ }
    }

    if (created > 0) {
      console.log(`[EvalRunner] CTO generated ${created} new eval definitions`);
    }
  }
}

/**
 * Import evals from arbitrary text/file content.
 */
export async function importEvalsViaCTO(rawContent: string): Promise<number> {
  const existingEvals = await evalStore.getAll();

  const prompt = `I'm importing test eval scenarios from an external source. Parse the content below and convert each test case into structured eval definitions.

The content may be in ANY format — CSV, JSON, plain text list, spreadsheet paste, markdown table, YAML, or free-form notes. Extract whatever test scenarios you can find.

For each eval you extract, output a <eval_definition> block:

<eval_definition>
{
  "name": "Short descriptive name",
  "description": "What this tests and why",
  "category": "functional|edge-case|performance|accessibility|security",
  "input": "The exact message to send to the Chrome extension",
  "expectedBehavior": "optional substring to check for in response",
  "maxTtftMs": 5000,
  "maxResponseMs": 30000,
  "expectNoErrors": true
}
</eval_definition>

Rules:
- "input" is REQUIRED — it's what gets typed into the extension chat. Infer a reasonable input if the source doesn't specify one explicitly.
- "category" should be inferred from context (security tests → "security", i18n → "edge-case", speed tests → "performance", etc.)
- Skip duplicates — these evals already exist: ${existingEvals.map(e => e.name).join(', ')}
- If the content is ambiguous or you can't extract any test cases, output zero blocks and explain why.

Here is the content to parse:

---
${rawContent}
---`;

  await ctoSession.sendMessage(prompt);

  // Parse eval definitions from CTO response
  const lastMsg = await ctoSession.getLastAssistantMessage();

  let created = 0;

  if (lastMsg) {
    const regex = /<eval_definition>\s*(\{[\s\S]*?\})\s*<\/eval_definition>/g;
    let match;

    while ((match = regex.exec(lastMsg)) !== null) {
      try {
        const def = JSON.parse(match[1]);
        if (!def.input) continue; // skip if no input
        await evalStore.create({
          name: def.name || 'Imported eval',
          description: def.description || '',
          category: def.category || 'functional',
          input: def.input,
          expectedBehavior: def.expectedBehavior,
          maxTtftMs: def.maxTtftMs,
          maxResponseMs: def.maxResponseMs,
          expectNoErrors: def.expectNoErrors ?? true,
          createdBy: 'cto',
        });
        created++;
      } catch { /* skip malformed */ }
    }
  }

  console.log(`[EvalRunner] Imported ${created} evals from pasted content`);
  return created;
}
