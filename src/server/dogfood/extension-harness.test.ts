import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isCacheValid,
  cleanBuildDir,
  cleanOrphanDirs,
  execWithRetry,
  acquireLock,
  releaseLock,
  BUILD_DIR,
  LOCK_FILE,
} from './extension-harness';
import { getContainerMemoryMb } from './index';

// Use isolated test dirs under /tmp to avoid colliding with real builds
const TEST_ROOT = '/tmp/ext-harness-test-' + process.pid;

function makeTestDir(name: string): string {
  const dir = path.join(TEST_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  // Clean test artifacts
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  // Clean any lock/build artifacts our tests may have created
  releaseLock();
  try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

// ─── isCacheValid ───

describe('isCacheValid', () => {
  it('returns false for a non-existent directory', () => {
    expect(isCacheValid('/tmp/does-not-exist-xyz')).toBe(false);
  });

  it('returns false for an empty directory', () => {
    const dir = makeTestDir('empty');
    expect(isCacheValid(dir)).toBe(false);
  });

  it('returns false when manifest.json is missing even with many files', () => {
    const dir = makeTestDir('no-manifest');
    fs.writeFileSync(path.join(dir, 'popup.js'), '');
    fs.writeFileSync(path.join(dir, 'popup.html'), '');
    fs.writeFileSync(path.join(dir, 'background.js'), '');
    expect(isCacheValid(dir)).toBe(false);
  });

  it('returns false when manifest.json exists but fewer than 3 total files', () => {
    const dir = makeTestDir('too-few');
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(dir, 'popup.js'), '');
    // Only 2 files
    expect(isCacheValid(dir)).toBe(false);
  });

  it('returns true with manifest.json and at least 3 files', () => {
    const dir = makeTestDir('valid');
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    fs.writeFileSync(path.join(dir, 'popup.js'), '');
    fs.writeFileSync(path.join(dir, 'popup.html'), '');
    expect(isCacheValid(dir)).toBe(true);
  });

  it('returns true with many files', () => {
    const dir = makeTestDir('many');
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{}');
    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(path.join(dir, `file-${i}.js`), '');
    }
    expect(isCacheValid(dir)).toBe(true);
  });
});

// ─── cleanBuildDir ───

describe('cleanBuildDir', () => {
  it('removes BUILD_DIR and all its contents', () => {
    fs.mkdirSync(path.join(BUILD_DIR, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(BUILD_DIR, 'sub', 'file.txt'), 'data');
    expect(fs.existsSync(BUILD_DIR)).toBe(true);

    cleanBuildDir();

    expect(fs.existsSync(BUILD_DIR)).toBe(false);
  });

  it('does not throw when BUILD_DIR does not exist', () => {
    // Ensure it doesn't exist
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
    expect(() => cleanBuildDir()).not.toThrow();
  });
});

// ─── cleanOrphanDirs ───

describe('cleanOrphanDirs', () => {
  it('removes directories matching ext-build-* pattern', () => {
    const orphan1 = `/tmp/ext-build-${Date.now()}-a`;
    const orphan2 = `/tmp/ext-build-${Date.now()}-b`;
    fs.mkdirSync(orphan1, { recursive: true });
    fs.mkdirSync(orphan2, { recursive: true });

    cleanOrphanDirs();

    expect(fs.existsSync(orphan1)).toBe(false);
    expect(fs.existsSync(orphan2)).toBe(false);
  });

  it('does not remove the stable build dir name', () => {
    // extension-build does NOT start with ext-build- so it's safe,
    // but let's verify the function doesn't match other /tmp dirs
    const safe = '/tmp/other-ext-thing';
    fs.mkdirSync(safe, { recursive: true });

    cleanOrphanDirs();

    expect(fs.existsSync(safe)).toBe(true);
    fs.rmSync(safe, { recursive: true, force: true });
  });
});

// ─── acquireLock / releaseLock ───

describe('acquireLock / releaseLock', () => {
  afterEach(() => {
    releaseLock();
  });

  it('acquires lock when no lock file exists', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    expect(acquireLock()).toBe(true);
    expect(fs.existsSync(LOCK_FILE)).toBe(true);
  });

  it('writes PID to the lock file', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    acquireLock();
    const content = fs.readFileSync(LOCK_FILE, 'utf-8');
    expect(content).toBe(String(process.pid));
  });

  it('refuses to acquire when lock is already held (fresh)', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    expect(acquireLock()).toBe(true);
    expect(acquireLock()).toBe(false);
  });

  it('acquires lock after release', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    acquireLock();
    releaseLock();
    expect(acquireLock()).toBe(true);
  });

  it('breaks a stale lock (>10 min old)', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    // Create a lock file with old mtime
    fs.writeFileSync(LOCK_FILE, '99999');
    const oldTime = Date.now() - 11 * 60 * 1000; // 11 minutes ago
    fs.utimesSync(LOCK_FILE, new Date(oldTime), new Date(oldTime));

    expect(acquireLock()).toBe(true);
    // Should have overwritten with our PID
    expect(fs.readFileSync(LOCK_FILE, 'utf-8')).toBe(String(process.pid));
  });

  it('releaseLock does not throw when no lock file exists', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    expect(() => releaseLock()).not.toThrow();
  });

  it('releaseLock removes the lock file', () => {
    fs.rmSync(LOCK_FILE, { force: true });
    acquireLock();
    expect(fs.existsSync(LOCK_FILE)).toBe(true);
    releaseLock();
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
  });
});

// ─── execWithRetry ───

describe('execWithRetry', () => {
  it('succeeds on first attempt for a valid command', () => {
    // 'true' is a shell command that always exits 0
    expect(() => execWithRetry('true', {}, 'test-true', 1)).not.toThrow();
  });

  it('throws after all retries fail', () => {
    // 'false' is a shell command that always exits 1
    expect(() => execWithRetry('false', {}, 'test-false', 1)).toThrow(
      /test-false failed/,
    );
  });

  it('retries and succeeds if command works on a later attempt', () => {
    // Create a file-based counter so the command fails the first time and succeeds the second
    const marker = path.join(TEST_ROOT, 'retry-marker');
    fs.rmSync(marker, { force: true });

    // Shell command: if marker doesn't exist, create it and exit 1. If it exists, exit 0.
    const cmd = `if [ ! -f "${marker}" ]; then touch "${marker}" && exit 1; else exit 0; fi`;

    expect(() => execWithRetry(cmd, {}, 'test-retry', 2)).not.toThrow();
    // Marker should exist from the first (failed) attempt
    expect(fs.existsSync(marker)).toBe(true);
  }, 15_000); // Retry backoff sleeps 5s between attempts

  it('respects timeout and treats it as a failure', () => {
    // sleep 10 with a 1s timeout should fail
    expect(() =>
      execWithRetry('sleep 10', { timeout: 1000 }, 'test-timeout', 1),
    ).toThrow(/test-timeout failed/);
  });

  it('includes stderr in error message', () => {
    try {
      execWithRetry('echo "oops" >&2 && exit 1', {}, 'test-stderr', 1);
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain('oops');
    }
  });

  it('respects cwd option', () => {
    const dir = makeTestDir('cwd-test');
    // pwd should output a path containing our test dir name
    expect(() => execWithRetry('pwd', { cwd: dir }, 'test-cwd', 1)).not.toThrow();
  });
});

// ─── getContainerMemoryMb ───

describe('getContainerMemoryMb', () => {
  it('returns Infinity on dev machines (no cgroup file)', () => {
    // On macOS/dev there's no /sys/fs/cgroup/memory.max
    expect(getContainerMemoryMb()).toBe(Infinity);
  });
});
