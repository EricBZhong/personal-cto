import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { getConfig, isCloudRun } from '../config';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Cached extension path from Cloud Run clone+build */
let cachedExtensionPath: string | null = null;

// --- Extension build constants & helpers (exported for testing) ---

export const BUILD_DIR = '/tmp/extension-build';
export const DIST_DIR = path.join(BUILD_DIR, 'chrome-extension', 'dist');
export const LOCK_FILE = BUILD_DIR + '.lock';
const LOCK_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const LOCK_POLL_INTERVAL_MS = 5000;
const LOCK_POLL_MAX_MS = 5 * 60 * 1000; // 5 minutes

/** Validate that a cached dist path contains a valid extension build */
export function isCacheValid(distPath: string): boolean {
  try {
    const manifest = path.join(distPath, 'manifest.json');
    if (!fs.existsSync(manifest)) return false;
    const files = fs.readdirSync(distPath);
    return files.length >= 3; // manifest + JS + HTML minimum
  } catch {
    return false;
  }
}

/** Remove the build directory (best effort) */
export function cleanBuildDir(): void {
  try {
    if (fs.existsSync(BUILD_DIR)) {
      fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    }
  } catch { /* best effort */ }
}

/** Remove orphan /tmp/ext-build-* dirs left by old timestamped code */
export function cleanOrphanDirs(): void {
  try {
    const entries = fs.readdirSync('/tmp');
    for (const e of entries) {
      if (e.startsWith('ext-build-') && e !== 'extension-build') {
        fs.rmSync(path.join('/tmp', e), { recursive: true, force: true });
      }
    }
  } catch { /* best effort */ }
}

/** Run a shell command with retries and exponential backoff */
export function execWithRetry(
  cmd: string,
  opts: { cwd?: string; timeout?: number },
  label: string,
  maxRetries = 3,
): void {
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[ExtensionHarness] ${label} (attempt ${attempt}/${maxRetries})...`);
      execSync(cmd, { cwd: opts.cwd, stdio: 'pipe', timeout: opts.timeout });
      return;
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString().slice(-2000) || '';
      const stdout = (err as { stdout?: Buffer }).stdout?.toString().slice(-2000) || '';
      const output = stdout ? `stdout: ${stdout}\nstderr: ${stderr}` : stderr;
      lastErr = new Error(`${label} failed (attempt ${attempt}): ${output}`);
      console.warn(`[ExtensionHarness] ${lastErr.message}`);
      if (attempt < maxRetries) {
        const delay = 5000 * Math.pow(3, attempt - 1); // 5s, 15s
        console.log(`[ExtensionHarness] Retrying in ${delay / 1000}s...`);
        execSync(`sleep ${delay / 1000}`);
      }
    }
  }
  throw lastErr!;
}

/** Acquire a file-based build lock. Returns true if lock acquired. */
export function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs < LOCK_MAX_AGE_MS) {
        return false; // Lock held by another build
      }
      // Stale lock — break it
      console.log('[ExtensionHarness] Breaking stale build lock');
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

/** Release the build lock */
export function releaseLock(): void {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* ok */ }
}

/** Wait for a concurrent build to finish, polling the lock and cache */
function waitForLock(): boolean {
  const start = Date.now();
  while (Date.now() - start < LOCK_POLL_MAX_MS) {
    execSync(`sleep ${LOCK_POLL_INTERVAL_MS / 1000}`);
    if (!fs.existsSync(LOCK_FILE)) return true; // Lock released
    if (isCacheValid(DIST_DIR)) return true; // Other build succeeded
  }
  return false; // Timed out
}

export interface DogfoodResult {
  success: boolean;
  testName: string;
  duration_ms: number;
  ttft_ms?: number; // Time to first token
  full_response_ms?: number;
  screenshots: string[];  // paths to saved screenshots
  metrics: Record<string, number | string>;
  errors: string[];
  logs: string[];
}

export interface DogfoodProgressEvent {
  type: 'step' | 'log' | 'screenshot';
  step?: string;
  log?: string;
  screenshot?: {
    label: string;
    base64: string;
  };
  timestamp: number;
}

export type DogfoodProgressCallback = (event: DogfoodProgressEvent) => void;

export interface DogfoodOptions {
  extensionPath?: string;
  message?: string;
  headless?: boolean;
  screenshotDir?: string;
  timeout?: number;
  backendUrl?: string;
  onProgress?: DogfoodProgressCallback;
}

const SELECTORS = {
  root: '#root',
  // Auth
  authGate: '.flex.flex-col.items-center.justify-center.h-full',
  connectButton: 'button',
  // Chat input
  textarea: 'textarea',
  // Messages
  messageContainer: '[class*="overflow-y-auto"]',
};

export class ExtensionHarness {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private extensionId: string | null = null;
  private screenshotDir: string;
  private onProgress?: DogfoodProgressCallback;

  constructor() {
    this.screenshotDir = path.join(process.cwd(), 'data', 'dogfood-screenshots');
    fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  /** Emit a progress event if a callback is set */
  private emitStep(step: string): void {
    this.onProgress?.({ type: 'step', step, timestamp: Date.now() });
  }

  private emitLog(log: string): void {
    this.onProgress?.({ type: 'log', log, timestamp: Date.now() });
  }

  /**
   * Ensure the Chrome extension is available.
   * - Dev mode: use local path directly
   * - Cloud Run: clone my-app repo and build the extension (cached across runs)
   *
   * Hardened for Cloud Run reliability:
   * - Deterministic build path (no orphan dirs on failure)
   * - Cache validation (manifest.json + file count)
   * - Retries with exponential backoff on git clone, npm install, npm run build
   * - File-based build lock to prevent concurrent build races
   * - Cleanup of partial builds and orphan dirs from old code
   */
  private async ensureExtension(options: DogfoodOptions): Promise<string> {
    const config = getConfig();
    const localPath = options.extensionPath ||
      config.extensionPath ||
      path.join(config.colbyRepoPath, 'chrome-extension', 'dist');

    // 1. Dev mode — local extension exists
    if (fs.existsSync(localPath)) {
      return localPath;
    }

    // 2. Check cached build with validation
    if (cachedExtensionPath && isCacheValid(cachedExtensionPath)) {
      console.log('[ExtensionHarness] Using cached extension at', cachedExtensionPath);
      return cachedExtensionPath;
    }

    // Also check the deterministic path (may have been built by a previous process)
    if (isCacheValid(DIST_DIR)) {
      cachedExtensionPath = DIST_DIR;
      console.log('[ExtensionHarness] Using previously built extension at', DIST_DIR);
      return DIST_DIR;
    }

    // 3. Clean orphan dirs from old timestamped code (best effort)
    cleanOrphanDirs();

    // 4. Acquire build lock
    if (!acquireLock()) {
      console.log('[ExtensionHarness] Build lock held by another process, waiting...');
      const lockReleased = waitForLock();

      // Check if the other build produced a valid cache
      if (isCacheValid(DIST_DIR)) {
        cachedExtensionPath = DIST_DIR;
        console.log('[ExtensionHarness] Using extension built by concurrent process at', DIST_DIR);
        return DIST_DIR;
      }

      if (!lockReleased) {
        // Force-break the lock and try ourselves
        console.warn('[ExtensionHarness] Lock wait timed out, breaking lock and building...');
        releaseLock();
      }

      if (!acquireLock()) {
        throw new Error('Failed to acquire extension build lock after waiting');
      }
    }

    // We hold the lock from here — ensure release on any exit path
    try {
      const ghToken = (config.githubToken || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
      if (!ghToken) {
        throw new Error('GH_TOKEN required to clone extension repo on Cloud Run');
      }

      // 5. Clean any partial previous build
      cleanBuildDir();

      const repoUrl = `https://x-access-token:${ghToken}@github.com/EricBZhong/my-app.git`;

      // 6. git clone with retries (60s timeout each)
      execWithRetry(
        `git clone --depth 1 ${repoUrl} ${BUILD_DIR}`,
        { timeout: 60_000 },
        'git clone',
        3,
      );

      // 7. npm install from repo root with retries (180s timeout each)
      // my-app uses npm workspaces — must install from root.
      // --include=dev ensures vite (a devDependency) is installed even when
      // NODE_ENV=production on Cloud Run.
      execWithRetry(
        'npm install --include=dev',
        { cwd: BUILD_DIR, timeout: 180_000 },
        'npm install',
        3,
      );

      // 8. Build extension with retries (120s timeout each)
      // Skip `tsc` type-check (noEmit) — it fails on Node 20 (Cloud Run) due to
      // type resolution differences. Vite handles TS compilation independently.
      // Use workspace root's vite binary since deps are hoisted to root node_modules.
      const extDir = path.join(BUILD_DIR, 'chrome-extension');
      execWithRetry(
        '../node_modules/.bin/vite build && node scripts/copy-static.js',
        { cwd: extDir, timeout: 120_000 },
        'extension build',
        3,
      );

      // 9. Validate the build
      if (!isCacheValid(DIST_DIR)) {
        throw new Error(`Extension build produced invalid dist/ at ${DIST_DIR}`);
      }

      // 10. Cache the path
      cachedExtensionPath = DIST_DIR;
      console.log('[ExtensionHarness] Extension built successfully at', DIST_DIR);
      return DIST_DIR;

    } catch (err) {
      // Clean up partial build on failure
      cleanBuildDir();
      throw err;
    } finally {
      // 11. Always release lock
      releaseLock();
    }
  }

  /** Launch Chrome with the extension loaded */
  async launch(options: DogfoodOptions = {}): Promise<void> {
    const extensionPath = await this.ensureExtension(options);
    const headless = options.headless ?? isCloudRun();

    this.browser = await puppeteer.launch({
      headless: headless ? true : false,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-popup-blocking',
        '--window-size=1400,900',
        ...(headless ? [
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-software-rasterizer',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-translate',
          '--single-process',
          '--js-flags=--max-old-space-size=256',
        ] : []),
      ],
      defaultViewport: { width: 1400, height: 900 },
    });

    // Get the extension's service worker target to find its ID
    let targets = this.browser.targets();
    let extensionTarget = targets.find(t =>
      t.type() === 'service_worker' && t.url().includes('chrome-extension://')
    );

    if (!extensionTarget) {
      // Wait a moment for the extension to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      targets = this.browser.targets();
      extensionTarget = targets.find(t =>
        t.type() === 'service_worker' && t.url().includes('chrome-extension://')
      );
    }

    // Extract the extension ID from the service worker URL
    if (extensionTarget) {
      const match = extensionTarget.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) {
        this.extensionId = match[1];
        console.log(`[ExtensionHarness] Extension ID: ${this.extensionId}`);
      }
    }

    // Open a regular page first
    const pages = await this.browser.pages();
    this.page = pages[0] || await this.browser.newPage();
  }

  /** Navigate to a URL, optionally log in to Salesforce, and open the sidebar */
  async openSidebar(url?: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');

    const config = getConfig();
    const targetUrl = url || config.sfLoginUrl || 'https://www.salesforce.com';

    // Use SOAP API session injection if credentials + security token are configured.
    // This bypasses MFA/email verification entirely (token only works with the API, not web forms).
    if (config.sfUsername && config.sfPassword && config.sfSecurityToken) {
      const session = await this.loginViaSoapApi(
        config.sfUsername,
        config.sfPassword + config.sfSecurityToken,
        targetUrl,
      );
      if (session) {
        // Extract domain from instance URL for the cookie
        const instanceHost = new URL(session.instanceUrl).hostname;
        await this.page.setCookie({
          name: 'sid',
          value: session.sessionId,
          domain: instanceHost,
          path: '/',
          httpOnly: true,
          secure: true,
        });
        // Navigate to the instance URL (already authenticated via cookie)
        await this.page.goto(session.instanceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(2000);
      } else {
        // SOAP login failed — fall back to navigating to the URL directly
        await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(1000);
      }
    } else if (config.sfUsername && config.sfPassword && targetUrl.includes('login.salesforce.com')) {
      // Fall back to web form login (works when no MFA/IP verification)
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(1000);
      await this.loginToSalesforce(config.sfUsername, config.sfPassword);
    } else {
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(1000);
    }

    // Open the extension page directly in a new tab.
    // The Cmd+E keyboard shortcut can't open side panels in headless Chrome,
    // so we navigate to the extension's HTML page directly.
    if (this.extensionId) {
      const extUrl = `chrome-extension://${this.extensionId}/src/app/index.html`;
      const extPage = await this.browser!.newPage();
      await extPage.goto(extUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      await sleep(2000);
    } else {
      // Fallback: try keyboard shortcut (works in non-headless mode)
      await this.page.keyboard.down('Meta');
      await this.page.keyboard.press('KeyE');
      await this.page.keyboard.up('Meta');
      await sleep(2000);
    }
  }

  /**
   * Authenticate via the Salesforce SOAP Login API.
   * The security token appended to the password bypasses IP-based verification.
   * Returns session ID + instance URL on success, null on failure.
   */
  private async loginViaSoapApi(
    username: string,
    passwordWithToken: string,
    loginUrl: string,
  ): Promise<{ sessionId: string; instanceUrl: string } | null> {
    // Determine SOAP endpoint from the login URL
    const loginHost = loginUrl.includes('login.salesforce.com')
      ? 'login.salesforce.com'
      : loginUrl.includes('test.salesforce.com')
        ? 'test.salesforce.com'
        : new URL(loginUrl).hostname;

    const soapUrl = `https://${loginHost}/services/Soap/u/59.0`;

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:urn="urn:partner.soap.sforce.com">
  <soapenv:Body>
    <urn:login>
      <urn:username>${this.escapeXml(username)}</urn:username>
      <urn:password>${this.escapeXml(passwordWithToken)}</urn:password>
    </urn:login>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const res = await fetch(soapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'login',
        },
        body: soapBody,
        signal: AbortSignal.timeout(15000),
      });

      const text = await res.text();

      // Extract sessionId and serverUrl from SOAP response
      const sessionMatch = text.match(/<sessionId>([^<]+)<\/sessionId>/);
      const serverMatch = text.match(/<serverUrl>([^<]+)<\/serverUrl>/);

      if (!sessionMatch || !serverMatch) {
        const faultMatch = text.match(/<faultstring>([^<]+)<\/faultstring>/);
        console.error(`[ExtensionHarness] SOAP login failed: ${faultMatch?.[1] || 'unknown error'}`);
        return null;
      }

      // serverUrl is like https://na1.salesforce.com/services/Soap/u/59.0/00D...
      // We need just the instance base URL
      const serverUrl = new URL(serverMatch[1]);
      const instanceUrl = `${serverUrl.protocol}//${serverUrl.hostname}`;

      console.log(`[ExtensionHarness] SOAP login successful, instance: ${instanceUrl}`);
      return { sessionId: sessionMatch[1], instanceUrl };
    } catch (err) {
      console.error(`[ExtensionHarness] SOAP login error: ${(err as Error).message}`);
      return null;
    }
  }

  /** Escape special characters for XML */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /** Fill in Salesforce login form and submit (fallback when no security token) */
  private async loginToSalesforce(username: string, password: string): Promise<void> {
    if (!this.page) return;

    try {
      // Wait for login form
      await this.page.waitForSelector('#username', { timeout: 5000 });
      await this.page.type('#username', username);
      await this.page.type('#password', password);
      await this.page.click('#Login');
      // Wait for navigation after login
      await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(2000);
    } catch {
      // Login form not found or login failed — continue anyway
    }
  }

  /** Take a timestamped screenshot and return the path */
  async screenshot(label: string): Promise<string> {
    if (!this.page) throw new Error('Browser not launched');

    const filename = `${Date.now()}-${label.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    await this.page.screenshot({ path: filepath, fullPage: true });

    // Stream screenshot to live progress callback
    if (this.onProgress) {
      try {
        const buffer = fs.readFileSync(filepath);
        const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
        this.onProgress({ type: 'screenshot', screenshot: { label, base64 }, timestamp: Date.now() });
      } catch { /* best effort — don't fail test if streaming fails */ }
    }

    return filepath;
  }

  /** Get all pages including extension pages */
  async getExtensionPage(): Promise<Page | null> {
    if (!this.browser) return null;

    const targets = this.browser.targets();
    for (const target of targets) {
      if (target.url().includes('chrome-extension://') && target.type() === 'page') {
        const page = await target.asPage();
        if (page) return page;
      }
    }
    return null;
  }

  /** Run the full chat latency test */
  async testChatLatency(options: DogfoodOptions = {}): Promise<DogfoodResult> {
    this.onProgress = options.onProgress;
    const startTime = Date.now();
    const result: DogfoodResult = {
      success: false,
      testName: 'chat-latency',
      duration_ms: 0,
      screenshots: [],
      metrics: {},
      errors: [],
      logs: [],
    };

    try {
      this.emitStep('Launching Chrome');
      result.logs.push('Launching Chrome with extension...');
      await this.launch(options);

      result.logs.push('Taking initial screenshot...');
      result.screenshots.push(await this.screenshot('01-launched'));

      // Navigate to a page and open sidebar (handles login + keyboard shortcut)
      this.emitStep('Navigating to Salesforce');
      result.logs.push('Navigating to Salesforce + opening sidebar...');
      await this.openSidebar();
      result.screenshots.push(await this.screenshot('02-navigated'));
      await sleep(1000);

      this.emitStep('Opening sidebar');
      result.screenshots.push(await this.screenshot('03-sidebar-opened'));

      // Try to find the extension side panel page
      const extensionPage = await this.getExtensionPage();
      if (extensionPage) {
        this.emitStep('Checking auth state');
        result.logs.push('Found extension page, checking auth state...');
        result.screenshots.push(await this.screenshot('04-extension-page'));

        // Check if we can find the textarea
        const hasTextarea = await extensionPage.$('textarea');
        if (hasTextarea) {
          result.logs.push('Chat input found — extension is authenticated');
          this.emitLog('Extension is authenticated');
          result.metrics.authState = 'authenticated';

          // Type a message and measure TTFT
          const message = options.message || 'What are my open opportunities?';
          this.emitStep('Sending message');
          result.logs.push(`Sending message: "${message}"`);

          const sendTime = Date.now();
          await extensionPage.type('textarea', message);
          await extensionPage.keyboard.press('Enter');

          result.screenshots.push(await this.screenshot('05-message-sent'));

          // Wait for first response content to appear
          try {
            this.emitStep('Waiting for first token');
            await extensionPage.waitForFunction(() => {
              const containers = document.querySelectorAll('[class*="overflow-y-auto"]');
              for (const container of containers) {
                if (container.children.length > 1) return true;
              }
              return false;
            }, { timeout: options.timeout || 30000 });

            const ttft = Date.now() - sendTime;
            result.ttft_ms = ttft;
            result.metrics.ttft_ms = ttft;
            result.logs.push(`First response appeared in ${ttft}ms`);
            this.emitLog(`TTFT: ${ttft}ms`);
            result.screenshots.push(await this.screenshot('06-first-response'));

            // Wait for streaming to complete (no more changes for 3 seconds)
            this.emitStep('Waiting for full response');
            let lastContentLength = 0;
            let stableCount = 0;
            const maxWait = 60000;
            const waitStart = Date.now();

            while (stableCount < 3 && (Date.now() - waitStart) < maxWait) {
              await sleep(1000);
              const currentLength = await extensionPage.evaluate(() => {
                const containers = document.querySelectorAll('[class*="overflow-y-auto"]');
                let total = 0;
                for (const c of containers) total += c.textContent?.length || 0;
                return total;
              });

              if (currentLength === lastContentLength) {
                stableCount++;
              } else {
                stableCount = 0;
                lastContentLength = currentLength;
              }
            }

            const fullResponseTime = Date.now() - sendTime;
            result.full_response_ms = fullResponseTime;
            result.metrics.full_response_ms = fullResponseTime;
            result.logs.push(`Full response in ${fullResponseTime}ms`);
            this.emitLog(`Full response: ${fullResponseTime}ms`);
            result.screenshots.push(await this.screenshot('07-full-response'));

            this.emitStep('Test complete');
            result.success = true;
          } catch (err) {
            result.errors.push(`Timeout waiting for response: ${(err as Error).message}`);
            result.screenshots.push(await this.screenshot('error-timeout'));
          }
        } else {
          result.logs.push('No textarea found — extension needs authentication');
          result.metrics.authState = 'not_authenticated';
          result.screenshots.push(await this.screenshot('04-needs-auth'));
        }
      } else {
        result.logs.push('Could not find extension page — sidebar may not have opened');
        result.errors.push('Extension side panel page not found');
      }
    } catch (err) {
      result.errors.push((err as Error).message);
      try {
        result.screenshots.push(await this.screenshot('error-crash'));
      } catch { /* ignore screenshot error */ }
    } finally {
      result.duration_ms = Date.now() - startTime;
      await this.close();
    }

    return result;
  }

  /** Run a visual inspection test — just take screenshots of the current state */
  async testVisualInspection(options: DogfoodOptions = {}): Promise<DogfoodResult> {
    this.onProgress = options.onProgress;
    const startTime = Date.now();
    const result: DogfoodResult = {
      success: false,
      testName: 'visual-inspection',
      duration_ms: 0,
      screenshots: [],
      metrics: {},
      errors: [],
      logs: [],
    };

    try {
      this.emitStep('Launching Chrome');
      await this.launch({ ...options, headless: options.headless ?? (isCloudRun() ? true : false) });
      const config = getConfig();
      const targetUrl = options.backendUrl || config.sfLoginUrl || 'https://login.salesforce.com';
      this.emitStep('Navigating to page');
      await this.openSidebar(targetUrl);
      result.screenshots.push(await this.screenshot('visual-01-page'));
      result.screenshots.push(await this.screenshot('visual-02-with-sidebar'));

      // Resize to mobile-like width
      this.emitStep('Testing mobile viewport');
      await this.page!.setViewport({ width: 375, height: 812 });
      await sleep(1000);
      result.screenshots.push(await this.screenshot('visual-03-mobile'));

      // Back to desktop
      await this.page!.setViewport({ width: 1400, height: 900 });

      this.emitStep('Test complete');
      result.success = true;
      result.logs.push('Visual inspection complete');
    } catch (err) {
      result.errors.push((err as Error).message);
    } finally {
      result.duration_ms = Date.now() - startTime;
      await this.close();
    }

    return result;
  }

  /** Run a backend health + response time test (no extension needed) */
  async testBackendLatency(options: DogfoodOptions = {}): Promise<DogfoodResult> {
    this.onProgress = options.onProgress;
    const startTime = Date.now();
    // Default to the current server's URL (Cloud Run or localhost)
    const port = process.env.PORT || '3100';
    const url = options.backendUrl || `http://localhost:${port}`;

    const result: DogfoodResult = {
      success: false,
      testName: 'backend-latency',
      duration_ms: 0,
      screenshots: [],
      metrics: {},
      errors: [],
      logs: [],
    };

    try {
      // Health check
      this.emitStep('Health check');
      const healthStart = Date.now();
      const healthRes = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10000) });
      const healthLatency = Date.now() - healthStart;
      result.metrics.health_latency_ms = healthLatency;
      result.metrics.health_status = healthRes.status;
      result.logs.push(`Health check: ${healthRes.status} in ${healthLatency}ms`);
      this.emitLog(`Health: ${healthRes.status} in ${healthLatency}ms`);

      // Auth status check
      this.emitStep('Auth status check');
      const authStart = Date.now();
      const authRes = await fetch(`${url}/auth/status`, { signal: AbortSignal.timeout(10000) });
      const authLatency = Date.now() - authStart;
      result.metrics.auth_latency_ms = authLatency;
      result.logs.push(`Auth status: ${authRes.status} in ${authLatency}ms`);
      this.emitLog(`Auth: ${authRes.status} in ${authLatency}ms`);

      // Cold start test (hit an endpoint that might trigger a cold start)
      this.emitStep('Cold start test');
      const coldStart = Date.now();
      const coldRes = await fetch(`${url}/health`, { signal: AbortSignal.timeout(30000) });
      const coldLatency = Date.now() - coldStart;
      result.metrics.cold_start_latency_ms = coldLatency;
      result.logs.push(`Cold start test: ${coldRes.status} in ${coldLatency}ms`);
      this.emitLog(`Cold start: ${coldRes.status} in ${coldLatency}ms`);

      this.emitStep('Test complete');
      result.success = true;
    } catch (err) {
      result.errors.push((err as Error).message);
    } finally {
      result.duration_ms = Date.now() - startTime;
    }

    return result;
  }

  /** Run proactive edge-case exploration — the "chaos monkey" for the extension */
  async testProactiveExploration(options: DogfoodOptions = {}): Promise<DogfoodResult> {
    this.onProgress = options.onProgress;
    const startTime = Date.now();
    const result: DogfoodResult = {
      success: false,
      testName: 'proactive-exploration',
      duration_ms: 0,
      screenshots: [],
      metrics: {},
      errors: [],
      logs: [],
    };

    // Edge case scenarios to try
    const EDGE_CASES: Array<{
      name: string;
      action: (extPage: Page) => Promise<void>;
      description: string;
    }> = [
      {
        name: 'unicode-chinese',
        description: 'Send message in Chinese characters',
        action: async (p) => {
          await p.type('textarea', '请告诉我我的销售机会有哪些？最近有什么更新？');
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'unicode-arabic',
        description: 'Send message in Arabic (RTL text)',
        action: async (p) => {
          await p.type('textarea', 'ما هي فرص المبيعات المفتوحة لدي؟');
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'emoji-heavy',
        description: 'Send emoji-heavy message',
        action: async (p) => {
          await p.type('textarea', '🚀🔥💰 Show me my top 🏆 opportunities! 📊📈 Need the 💵💵💵 numbers! 🎯');
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'very-long-input',
        description: 'Send an extremely long message (2000+ chars)',
        action: async (p) => {
          const longMsg = 'Please analyze all of my Salesforce data and provide a comprehensive report. '.repeat(30);
          await p.type('textarea', longMsg);
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'empty-submit',
        description: 'Try submitting empty message',
        action: async (p) => {
          await p.focus('textarea');
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'whitespace-only',
        description: 'Send whitespace-only message',
        action: async (p) => {
          await p.type('textarea', '   \t\n   ');
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'special-chars',
        description: 'Send special characters (quotes, backslashes, angle brackets)',
        action: async (p) => {
          await p.type('textarea', 'Test: <script>alert("xss")</script> AND 1=1; DROP TABLE users; -- O\'Brien\\nNewline');
          await p.keyboard.press('Enter');
        },
      },
      {
        name: 'rapid-fire',
        description: 'Send 5 messages in quick succession',
        action: async (p) => {
          for (let i = 0; i < 5; i++) {
            await p.type('textarea', `Rapid message ${i + 1}`);
            await p.keyboard.press('Enter');
            await sleep(200);
          }
        },
      },
      {
        name: 'identical-repeat',
        description: 'Send the same message 5 times consecutively',
        action: async (p) => {
          for (let i = 0; i < 5; i++) {
            await p.type('textarea', 'What are my open opportunities?');
            await p.keyboard.press('Enter');
            await sleep(500);
          }
        },
      },
      {
        name: 'viewport-resize-during-response',
        description: 'Resize viewport while response is streaming',
        action: async (p) => {
          await p.type('textarea', 'Give me a detailed summary of my pipeline');
          await p.keyboard.press('Enter');
          // Rapidly resize while waiting for response
          await sleep(500);
          const viewports = [
            { width: 375, height: 812 },  // iPhone
            { width: 768, height: 1024 },  // iPad
            { width: 1920, height: 1080 }, // Desktop
            { width: 320, height: 568 },   // iPhone SE
            { width: 1400, height: 900 },  // Original
          ];
          for (const vp of viewports) {
            await p.setViewport(vp);
            await sleep(300);
          }
        },
      },
      {
        name: 'console-error-injection',
        description: 'Trigger console errors and check extension resilience',
        action: async (p) => {
          await p.evaluate(() => {
            console.error('Simulated error: NetworkError when attempting to fetch');
            console.error('TypeError: Cannot read properties of null');
            (window as unknown as Record<string, unknown>).__test_error = undefined;
            // Try accessing something that would trigger an error
            try {
              JSON.parse('{{invalid json}}');
            } catch { /* expected */ }
          });
        },
      },
      {
        name: 'markdown-formatting',
        description: 'Send message with markdown that could break rendering',
        action: async (p) => {
          await p.type('textarea', '# Header\n```\ncode block\n```\n| col1 | col2 |\n|------|------|\n| **bold** | _italic_ |\n\n> blockquote\n\n- [ ] task\n- [x] done');
          await p.keyboard.press('Enter');
        },
      },
    ];

    let consoleErrors: string[] = [];

    try {
      this.emitStep('Launching Chrome');
      result.logs.push('Launching Chrome with extension...');
      await this.launch(options);

      this.emitStep('Navigating to Salesforce');
      result.logs.push('Navigating to Salesforce + opening sidebar...');
      await this.openSidebar();
      await sleep(1000);

      this.emitStep('Finding extension page');
      const extensionPage = await this.getExtensionPage();
      if (!extensionPage) {
        result.errors.push('Could not find extension page — sidebar may not have opened');
        result.screenshots.push(await this.screenshot('proactive-no-sidebar'));
        result.duration_ms = Date.now() - startTime;
        return result;
      }

      // Capture console errors from the extension page
      extensionPage.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      extensionPage.on('pageerror', (err: unknown) => {
        consoleErrors.push(`PAGE ERROR: ${(err as Error).message}`);
      });

      this.emitStep('Checking auth state');
      const hasTextarea = await extensionPage.$('textarea');
      if (!hasTextarea) {
        result.logs.push('Extension not authenticated — running limited edge case tests');
        result.metrics.authState = 'not_authenticated';
        result.screenshots.push(await this.screenshot('proactive-not-authenticated'));

        // Even without auth, test some UI behaviors
        // Resize tests
        for (const vp of [{ width: 375, height: 812 }, { width: 1400, height: 900 }]) {
          await this.page!.setViewport(vp);
          await sleep(500);
          result.screenshots.push(await this.screenshot(`proactive-resize-${vp.width}x${vp.height}`));
        }
      } else {
        result.metrics.authState = 'authenticated';
        result.logs.push('Extension authenticated — running full edge case battery');

        let passCount = 0;
        let failCount = 0;

        for (const edgeCase of EDGE_CASES) {
          const caseStart = Date.now();
          consoleErrors = [];
          this.emitStep(`Edge case: ${edgeCase.name}`);
          result.logs.push(`\n--- Edge Case: ${edgeCase.name} ---`);
          result.logs.push(`Description: ${edgeCase.description}`);

          try {
            // Clear any existing textarea content
            await extensionPage.evaluate(() => {
              const ta = document.querySelector('textarea');
              if (ta) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
            });

            await edgeCase.action(extensionPage);
            await sleep(2000); // Wait for any response / UI reaction

            result.screenshots.push(await this.screenshot(`proactive-${edgeCase.name}`));

            // Check for any new console errors
            if (consoleErrors.length > 0) {
              result.logs.push(`Console errors (${consoleErrors.length}):`);
              for (const err of consoleErrors) {
                result.logs.push(`  ! ${err.slice(0, 200)}`);
              }
              result.errors.push(`[${edgeCase.name}] ${consoleErrors.length} console error(s): ${consoleErrors[0].slice(0, 150)}`);
              failCount++;
            } else {
              result.logs.push('No errors detected');
              passCount++;
            }

            // Check if the page is still responsive
            const isResponsive = await extensionPage.evaluate(() => {
              return document.querySelector('textarea') !== null;
            }).catch(() => false);

            if (!isResponsive) {
              result.errors.push(`[${edgeCase.name}] Extension became unresponsive`);
              result.logs.push('WARNING: Extension became unresponsive');
              failCount++;
              result.screenshots.push(await this.screenshot(`proactive-${edgeCase.name}-unresponsive`));
              break; // Stop testing if UI is broken
            }

            const caseDuration = Date.now() - caseStart;
            result.logs.push(`Completed in ${caseDuration}ms`);
            result.metrics[`${edgeCase.name}_ms`] = caseDuration;

          } catch (err) {
            const errMsg = (err as Error).message;
            result.errors.push(`[${edgeCase.name}] ${errMsg}`);
            result.logs.push(`FAILED: ${errMsg}`);
            failCount++;
            try {
              result.screenshots.push(await this.screenshot(`proactive-${edgeCase.name}-error`));
            } catch { /* ignore */ }
          }

          // Brief pause between tests
          await sleep(1000);
        }

        result.metrics.edge_cases_passed = passCount;
        result.metrics.edge_cases_failed = failCount;
        result.metrics.edge_cases_total = EDGE_CASES.length;
        result.success = failCount === 0;
      }

      // Final screenshot
      result.screenshots.push(await this.screenshot('proactive-final'));
      result.logs.push(`\nProactive exploration complete: ${result.metrics.edge_cases_passed || 0} passed, ${result.metrics.edge_cases_failed || 0} failed`);

    } catch (err) {
      result.errors.push((err as Error).message);
      try {
        result.screenshots.push(await this.screenshot('proactive-crash'));
      } catch { /* ignore */ }
    } finally {
      result.duration_ms = Date.now() - startTime;
      await this.close();
    }

    return result;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}
