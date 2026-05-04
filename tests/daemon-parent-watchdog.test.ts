/**
 * Regression test: daemon exits when its watchdog parent dies.
 *
 * Why this exists:
 *   On 2026-05-03 we found a leaked test daemon (PID 67959) that had
 *   been spinning at 100% CPU for 5+ hours. Root cause: the original
 *   tests/daemon-watcher.test.ts spawned the daemon with raw `spawn()`
 *   and no parent-death cleanup. When the test parent gets killed by
 *   anything that bypasses `finally` (Ctrl-C twice, IDE kill, OOM, a
 *   pre-release hook timeout), the daemon orphans and the OS keeps it
 *   running indefinitely.
 *
 *   The fix is two-layer:
 *     (A) tests/helpers/daemon-pg.ts now passes
 *         PHOTON_DAEMON_WATCHDOG_PID=process.pid to every spawned daemon.
 *     (B) src/daemon/server.ts polls that pid every 2s and exits cleanly
 *         when the parent is gone (ESRCH on `process.kill(pid, 0)`).
 *
 *   This test pins layer B: spawn a daemon with the watchdog pointing at
 *   a sentinel sleep process, kill the sentinel, and assert the daemon
 *   exits within the next polling interval.
 *
 * What this test does NOT cover:
 *   - The reaper in `daemon-pg.ts` (covered by every other test that
 *     uses `spawnDaemonPG` and runs cleanup in `finally`).
 *   - SIGKILL on the daemon parent in production (only watchdog mode
 *     activates on opt-in env var; production launches don't set it).
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { spawnDaemonPG } from './helpers/daemon-pg.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-watchdog-test-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSocket(target: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) {
      const ok = await new Promise<boolean>((resolve) => {
        const c = net.createConnection(target);
        c.on('connect', () => {
          c.destroy();
          resolve(true);
        });
        c.on('error', () => resolve(false));
      });
      if (ok) return;
    }
    await wait(50);
  }
  throw new Error('daemon did not start in time');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await wait(100);
  }
  return false;
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log('\ndaemon parent-watchdog:\n');

  await test('daemon exits within 5s when its watchdog parent dies', async () => {
    // Spin up a sentinel: a sleep process whose only job is to die when
    // we want it to. We CANNOT use this test process as the watchdog
    // target — the daemon would survive every other test in the suite.
    const sentinel: ChildProcess = spawn('sleep', ['60'], { stdio: 'ignore', detached: true });
    if (!sentinel.pid) throw new Error('failed to spawn sentinel');
    const sentinelPid = sentinel.pid;
    // Detach sentinel from this process so killing it later doesn't
    // also signal us. Belt-and-braces with `detached: true` above.
    sentinel.unref();

    let daemon: ChildProcess | null = null;
    let daemonPid = -1;
    try {
      // spawnDaemonPG normally sets PHOTON_DAEMON_WATCHDOG_PID to the
      // current process pid. Override to point at the sentinel so we
      // can kill the "parent" without killing this test runner.
      daemon = spawnDaemonPG([serverPath, socketPath], {
        env: {
          ...process.env,
          PHOTON_DIR: tmpDir,
          PHOTON_DAEMON_WATCHDOG_PID: String(sentinelPid),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (!daemon.pid) throw new Error('failed to spawn daemon');
      daemonPid = daemon.pid;

      await waitForSocket(socketPath);

      // Daemon must be alive while sentinel is alive. Wait through one
      // full poll interval (2s) plus a margin so we know the watchdog
      // has run at least once and decided to do nothing.
      await wait(2_500);
      assert.equal(
        isAlive(daemonPid),
        true,
        'daemon must stay alive while watchdog parent is alive'
      );

      // Kill the sentinel. Watchdog's next poll will see ESRCH and shutdown().
      try {
        process.kill(sentinelPid, 'SIGKILL');
      } catch {
        /* sentinel already exited — fine, watchdog will still see it gone */
      }

      // Daemon should exit within one poll interval (2s) plus shutdown
      // grace (~500ms for socket flush). Allow 5s headroom for slow CI.
      const exited = await waitForExit(daemonPid, 5_000);
      assert.equal(
        exited,
        true,
        `daemon (pid ${daemonPid}) must exit within 5s of watchdog parent death — leaked daemon would burn CPU indefinitely`
      );
    } finally {
      // Cleanup if assertions failed midway.
      if (isAlive(sentinelPid)) {
        try {
          process.kill(sentinelPid, 'SIGKILL');
        } catch {
          /* ignored */
        }
      }
      if (daemonPid > 0 && isAlive(daemonPid)) {
        try {
          process.kill(-daemonPid, 'SIGKILL');
        } catch {
          /* ignored */
        }
      }
    }
  });

  await test('daemon ignores invalid PHOTON_DAEMON_WATCHDOG_PID', async () => {
    // A malformed env var must not crash the daemon at boot — the
    // production code path should leave the var unset entirely, so a
    // stray junk value (from a misconfigured wrapper) should be a no-op.
    const sock2 = path.join(tmpDir, 'daemon-bogus.sock');
    let daemon: ChildProcess | null = null;
    try {
      daemon = spawnDaemonPG([serverPath, sock2], {
        env: {
          ...process.env,
          PHOTON_DIR: tmpDir,
          PHOTON_DAEMON_WATCHDOG_PID: 'not-a-number',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await waitForSocket(sock2);
      // If we got here, the daemon booted normally. Wait briefly to make
      // sure no async crash trips it.
      await wait(1_000);
      assert.equal(isAlive(daemon.pid!), true, 'daemon must boot with malformed watchdog pid');
    } finally {
      if (daemon?.pid && isAlive(daemon.pid)) {
        try {
          process.kill(-daemon.pid, 'SIGTERM');
        } catch {
          /* ignored */
        }
      }
    }
  });

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignored */
  }

  console.log(`\n  passed: ${passed}, failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
