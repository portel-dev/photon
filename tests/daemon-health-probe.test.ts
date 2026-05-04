/**
 * Daemon health probe + stale-binary self-check.
 *
 * Two regression assertions for the gaps we found while investigating
 * the runaway-daemon class of bugs (PID 67959, 100% CPU on a leaked
 * test socket):
 *
 *   1. The DaemonManager's `isSocketAlive` probe must do a real `ping`
 *      RPC, not just a TCP connect. A wedged daemon — accept thread
 *      alive, request handler stuck in user code — would have passed
 *      the old TCP-only probe and silently failed every subsequent
 *      command. The fix sends `{type:'ping'}` and waits up to 2s for
 *      `{type:'pong'}`. This test stands up a fake socket that accepts
 *      and never replies, then asserts `isReachable()` returns false.
 *
 *   2. The daemon must log a warning when its on-disk script is newer
 *      than its boot time. The DaemonManager.isBinaryStale path already
 *      restarts the daemon when a CLI command runs post-upgrade, but a
 *      developer who installs a new version and walks away leaving only
 *      schedules running has no signal. The daemon polls every 60s
 *      (PHOTON_STALE_CHECK_INTERVAL_MS overrides for tests) and logs
 *      once when staleness is first detected.
 *
 * What this file does NOT cover:
 *   - End-to-end "ensure() restarts the wedged daemon" — `cleanupStale`
 *     is heavy machinery exercised by every other manager test.
 *   - Production launchd respawn — that's a deployment concern, not
 *     code under test.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { type ChildProcess } from 'node:child_process';
import { DaemonManager } from '../dist/daemon/manager.js';
import { spawnDaemonPG, stopDaemonPG } from './helpers/daemon-pg.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-health-test-'));
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
  throw new Error('socket did not appear');
}

async function tailLog(
  file: string,
  timeoutMs: number,
  predicate: (line: string) => boolean
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let lastSize = 0;
  while (Date.now() < deadline) {
    try {
      const stat = fs.statSync(file);
      if (stat.size > lastSize) {
        const content = fs.readFileSync(file, 'utf-8');
        for (const line of content.slice(lastSize ? lastSize : 0).split('\n')) {
          if (line && predicate(line)) return line;
        }
        lastSize = stat.size;
      }
    } catch {
      /* file not yet written */
    }
    await wait(100);
  }
  return null;
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

/**
 * Build a fake daemon: a Unix socket server that accepts every
 * connection but never writes a byte. The old TCP-only probe passed
 * against this; the new ping-based probe must time out.
 */
function startSilentDaemon(socketPath: string): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => {
      // Accept and hold the connection. Don't read, don't write.
      sock.on('error', () => {
        /* drop ECONNRESET on probe disconnect */
      });
    });
    server.on('error', reject);
    server.listen(socketPath, () => resolve(server));
  });
}

async function main(): Promise<void> {
  console.log('\ndaemon health probe + stale-binary warning:\n');

  await test('isReachable() returns FALSE against a silent (wedged) daemon', async () => {
    // The probe must distinguish "listening but not servicing" from
    // "healthy". The old TCP-only probe would have returned true here.
    const sock = path.join(tmpDir, 'silent.sock');
    const server = await startSilentDaemon(sock);
    try {
      const ctx = {
        baseDir: tmpDir,
        socketPath: sock,
        pidFile: path.join(tmpDir, 'silent.pid'),
        logFile: path.join(tmpDir, 'silent.log'),
        ownerFile: path.join(tmpDir, 'silent.owner.json'),
      };
      const mgr = new DaemonManager(ctx as any);
      const t0 = Date.now();
      const reachable = await mgr.isReachable();
      const elapsed = Date.now() - t0;
      assert.equal(
        reachable,
        false,
        'silent socket must NOT be reported reachable — old TCP probe was the bug shape that masked PID 67959'
      );
      // Should time out around 2s, not hang indefinitely.
      assert.ok(elapsed < 4_000, `probe should give up within 2s budget, took ${elapsed}ms`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      try {
        fs.unlinkSync(sock);
      } catch {
        /* ignore */
      }
    }
  });

  await test('isReachable() returns TRUE against a real daemon answering ping', async () => {
    // Sanity check: the new ping-based probe must NOT regress healthy
    // detection. The companion test would catch a typo that always
    // returned false.
    const sock = path.join(tmpDir, 'real.sock');
    let daemon: ChildProcess | null = null;
    try {
      daemon = spawnDaemonPG([serverPath, sock], {
        cwd: tmpDir,
        env: { ...process.env, PHOTON_DIR: tmpDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      await waitForSocket(sock);
      const ctx = {
        baseDir: tmpDir,
        socketPath: sock,
        pidFile: path.join(tmpDir, 'real.pid'),
        logFile: path.join(tmpDir, 'real.log'),
        ownerFile: path.join(tmpDir, 'real.owner.json'),
      };
      const mgr = new DaemonManager(ctx as any);
      const reachable = await mgr.isReachable();
      assert.equal(reachable, true, 'real daemon must answer ping within 2s');
    } finally {
      if (daemon) await stopDaemonPG(daemon);
    }
  });

  await test('daemon logs stale-binary warning when its script is touched forward', async () => {
    // Stand up a real daemon with a 200ms self-check interval so we
    // don't have to wait the production 60s. Touch the script to push
    // its mtime past the daemon's boot time. Within a few intervals
    // the warning line must land in the daemon log.
    const sock = path.join(tmpDir, 'stale.sock');
    const logFile = path.join(tmpDir, 'stale.log');
    let daemon: ChildProcess | null = null;
    try {
      daemon = spawnDaemonPG([serverPath, sock], {
        cwd: tmpDir,
        env: {
          ...process.env,
          PHOTON_DIR: tmpDir,
          PHOTON_STALE_CHECK_INTERVAL_MS: '200',
        },
        stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
      });
      await waitForSocket(sock);

      // Push the script mtime forward — bigger than any clock skew margin.
      const futureTime = new Date(Date.now() + 5_000);
      fs.utimesSync(serverPath, futureTime, futureTime);

      const line = await tailLog(logFile, 5_000, (l) =>
        l.includes('Daemon binary on disk is newer')
      );
      assert.ok(
        line,
        `expected stale-binary warning in daemon log within 5s. log:\n${fs.readFileSync(logFile, 'utf-8').slice(-1000)}`
      );
    } finally {
      if (daemon) await stopDaemonPG(daemon);
      // Restore script mtime to "now" so we don't leave the dist tree
      // in a state where every subsequent test sees a stale binary.
      try {
        const now = new Date();
        fs.utimesSync(serverPath, now, now);
      } catch {
        /* ignore */
      }
    }
  });

  await test('stale warning is NOT logged when the script is older than boot', async () => {
    // Negative case: ensure the warning is gated on mtime > startedAt.
    // If we drop the gate the log fills with false positives every
    // 60s for a normally-running daemon.
    const sock = path.join(tmpDir, 'fresh.sock');
    const logFile = path.join(tmpDir, 'fresh.log');
    let daemon: ChildProcess | null = null;
    try {
      // Set the script mtime to now BEFORE spawning so the daemon's
      // boot time is later than the script mtime.
      const now = new Date();
      fs.utimesSync(serverPath, now, now);
      // Sleep briefly so daemonStartedAtMs > script mtime (1ms resolution).
      await wait(50);

      daemon = spawnDaemonPG([serverPath, sock], {
        cwd: tmpDir,
        env: {
          ...process.env,
          PHOTON_DIR: tmpDir,
          PHOTON_STALE_CHECK_INTERVAL_MS: '200',
        },
        stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
      });
      await waitForSocket(sock);

      // Wait through several check intervals to give a buggy gate
      // time to misfire. 1.5s = ~7 intervals at 200ms.
      await wait(1_500);
      const log = fs.readFileSync(logFile, 'utf-8');
      assert.ok(
        !log.includes('Daemon binary on disk is newer'),
        `stale warning fired when binary was NOT actually stale. log:\n${log.slice(-500)}`
      );
    } finally {
      if (daemon) await stopDaemonPG(daemon);
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
