import { ExtensionHarness, DogfoodResult, DogfoodOptions, DogfoodProgressEvent, DogfoodProgressCallback } from './extension-harness';
import { eventBus } from '../event-bus';
import { ctoSession } from '../cto-session';
import { isCloudRun } from '../config';
import fs from 'fs';
import path from 'path';

export type DogfoodTestType = 'chat-latency' | 'visual-inspection' | 'backend-latency' | 'full-suite' | 'proactive-exploration';

/** Test types that require a browser (Puppeteer/Chromium) */
const BROWSER_TESTS: ReadonlySet<DogfoodTestType> = new Set([
  'chat-latency',
  'visual-inspection',
  'proactive-exploration',
  'full-suite',
]);

/** Minimum memory (MB) required to run browser tests without OOM risk */
const BROWSER_MIN_MEMORY_MB = 3072;

/**
 * Read the container's memory limit from cgroup v2.
 * Returns Infinity on dev machines or when the limit can't be determined.
 */
export function getContainerMemoryMb(): number {
  try {
    const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf-8').trim();
    if (raw === 'max') return Infinity; // No limit set
    const bytes = parseInt(raw, 10);
    if (isNaN(bytes)) return Infinity;
    return Math.floor(bytes / (1024 * 1024));
  } catch {
    return Infinity; // Not in a cgroup — dev machine
  }
}

/** Convert screenshot file paths to base64 data URLs for frontend display */
function enrichScreenshots(results: DogfoodResult[]): Array<DogfoodResult & { screenshotData: Array<{ label: string; path: string; base64: string }> }> {
  return results.map(result => {
    const screenshotData = result.screenshots.map(ssPath => {
      try {
        const buffer = fs.readFileSync(ssPath);
        const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
        const label = path.basename(ssPath, '.png').replace(/^\d+-/, '');
        return { label, path: ssPath, base64 };
      } catch {
        return { label: path.basename(ssPath), path: ssPath, base64: '' };
      }
    });
    return { ...result, screenshotData };
  });
}

export async function runDogfoodTest(
  testType: DogfoodTestType,
  options: DogfoodOptions = {},
): Promise<DogfoodResult[]> {
  // Guard: block browser tests on Cloud Run when memory is insufficient
  if (isCloudRun() && BROWSER_TESTS.has(testType)) {
    const memoryMb = getContainerMemoryMb();
    if (memoryMb < BROWSER_MIN_MEMORY_MB) {
      const skipResult: DogfoodResult = {
        success: false,
        testName: `${testType} (skipped — insufficient memory)`,
        duration_ms: 0,
        screenshots: [],
        metrics: { containerMemoryMb: memoryMb, requiredMemoryMb: BROWSER_MIN_MEMORY_MB },
        errors: [
          `Browser tests require at least ${BROWSER_MIN_MEMORY_MB}MB memory. ` +
          `This instance has ${memoryMb}MB. ` +
          `Run backend-latency instead, or increase --memory in deploy-dev.yml.`,
        ],
        logs: [],
      };

      if (testType === 'full-suite') {
        // Still run backend-latency (no browser needed), then append skip info
        const harness = new ExtensionHarness();
        const results: DogfoodResult[] = [];
        results.push(await harness.testBackendLatency(options));
        results.push(skipResult);
        return results;
      }

      return [skipResult];
    }
  }

  const harness = new ExtensionHarness();
  const results: DogfoodResult[] = [];

  switch (testType) {
    case 'chat-latency':
      results.push(await harness.testChatLatency(options));
      break;

    case 'visual-inspection':
      results.push(await harness.testVisualInspection(options));
      break;

    case 'backend-latency':
      results.push(await harness.testBackendLatency(options));
      break;

    case 'proactive-exploration':
      results.push(await harness.testProactiveExploration(options));
      break;

    case 'full-suite':
      // Run all tests sequentially
      results.push(await harness.testBackendLatency(options));
      results.push(await harness.testVisualInspection(options));
      results.push(await harness.testChatLatency(options));
      results.push(await harness.testProactiveExploration(options));
      break;
  }

  return results;
}

export { enrichScreenshots };

/** Format dogfood results into a summary for the CTO */
export function formatDogfoodReport(results: DogfoodResult[]): string {
  let report = '## Dogfood Test Report\n\n';

  for (const result of results) {
    const status = result.success ? 'PASS' : 'FAIL';
    report += `### ${result.testName} — ${status}\n`;
    report += `Duration: ${result.duration_ms}ms\n\n`;

    if (result.ttft_ms) {
      report += `- **Time to First Token**: ${result.ttft_ms}ms\n`;
    }
    if (result.full_response_ms) {
      report += `- **Full Response Time**: ${result.full_response_ms}ms\n`;
    }

    if (Object.keys(result.metrics).length > 0) {
      report += '\n**Metrics:**\n';
      for (const [key, value] of Object.entries(result.metrics)) {
        report += `- ${key}: ${value}\n`;
      }
    }

    if (result.logs.length > 0) {
      report += '\n**Log:**\n';
      for (const log of result.logs) {
        report += `- ${log}\n`;
      }
    }

    if (result.errors.length > 0) {
      report += '\n**Errors:**\n';
      for (const err of result.errors) {
        report += `- ${err}\n`;
      }
    }

    if (result.screenshots.length > 0) {
      report += `\n**Screenshots:** ${result.screenshots.length} captured\n`;
      for (const ss of result.screenshots) {
        report += `- ${ss}\n`;
      }
    }

    report += '\n---\n\n';
  }

  return report;
}

/** Run dogfood test and feed results to the CTO for analysis */
export async function dogfoodWithCTOAnalysis(
  testType: DogfoodTestType,
  options: DogfoodOptions = {},
): Promise<{ results: DogfoodResult[]; report: string }> {
  const results = await runDogfoodTest(testType, options);
  const report = formatDogfoodReport(results);

  // Build analysis message with screenshot references
  const screenshotPaths = results.flatMap(r => r.screenshots);
  const screenshotNote = screenshotPaths.length > 0
    ? `\n\n**Screenshots captured** (${screenshotPaths.length} total):\n${screenshotPaths.map(p => `- ${p}`).join('\n')}\n\nThese screenshots show the extension at each step of the test. Review the logs and metrics above for any issues.`
    : '';

  const message = `I just ran a dogfood test on the extension. Here are the results:\n\n${report}${screenshotNote}\n\nPlease analyze these results and suggest improvements. If there are critical issues (failures, high latency >5s for TTFT, errors), create tasks to fix them.`;

  await ctoSession.sendMessage(message);
  return { results, report };
}

export { ExtensionHarness };
export { evalStore, runEvals, generateCTOEvals, importEvalsViaCTO } from './eval-runner';
export type { EvalDefinition, EvalResult } from './eval-runner';
export type { DogfoodResult, DogfoodOptions, DogfoodProgressEvent, DogfoodProgressCallback };
