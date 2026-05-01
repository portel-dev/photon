/**
 * Regression test: only one daemon may bind a given socket. When a second
 * daemon process is launched against the same socket — by any runtime
 * (node, bun, etc.) and through any path (DaemonManager, direct `node
 * server.js`, leftover from a test or worktree) — the imposter must be
 * SIGTERM'd before the new daemon starts listening.
 *
 * Before this fix, the only sibling-detection path was the owner-record
 * check in `claimExclusiveOwnership`. If that record was absent (stale
 * delete, manual stop, never written by a non-DaemonManager launch), a
 * second daemon could create a brand-new socket and listen on it while
 * the previous daemon stayed alive in the background. Multiple daemons
 * would then run concurrently, each holding their own copy of the cron
 * map and firing duplicate jobs.
 *
 * The fix scans the OS process table for argv matching
 * `daemon/server.js <socketPath>` and SIGTERMs everything that isn't us.
 * This test:
 *   1. Starts daemon A on a tmp socket and waits for it to be reachable.
 *   2. Wipes the owner record + pid file (simulating the "no owner trace"
 *      failure mode the imposter-scan defends).
 *   3. Starts daemon B against the same socket.
 *   4. Asserts daemon A is dead and daemon B is the sole survivor.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-imposter-test-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const ownerFile = `${socketPath}.owner.json`;
const pidFile = path.join(tmpDir, 'daemon.pid');
const serverPath = path.join(process.cwd(), 'dist', 'daemon', 'server.js');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForSocket(target: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(target)) {
      const connected = await new Promise<boolean>((resolve) => {
        const client = net.createConnection(target);
        client.on('connect', () => {
          client.destroy();
          resolve(true);
        });
        client.on('error', () => resolve(false));
      });
      if (connected) return;
    }
    await wait(50);
  }
  throw new Error('Timed out waiting for daemon socket');
}

async function waitForExit(pid: number, timeoutMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await wait(50);
  }
  return false;
}

function startDaemon(): ChildProcess {
  const isolatedRegistry = path.join(tmpDir, '.bases-test.json');
  return spawn(process.execPath, [serverPath, socketPath], {
    cwd: tmpDir,
    env: {
      ...process.env,
      PHOTON_DIR: tmpDir,
      PHOTON_BASES_REGISTRY: isolatedRegistry,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err?.message || String(err)}`);
  }
}

async function main(): Promise<void> {
  console.log('\ndaemon imposter eviction regression:\n');

  let daemonA: ChildProcess | null = null;
  let daemonB: ChildProcess | null = null;

  try {
    await test('daemon A starts and binds the socket', async () => {
      daemonA = startDaemon();
      await waitForSocket(socketPath, 10_000);
      assert.ok(daemonA.pid, 'daemonA must have a pid');
      assert.ok(isPidAlive(daemonA.pid), 'daemonA must be alive after socket up');
    });

    await test('wiping owner record + pid file simulates the lost-trace failure mode', async () => {
      // The owner-record path is the only sibling guard in pre-imposter-scan
      // builds. Erase it so daemon B has no DaemonManager-level evidence
      // that daemon A exists.
      try {
        fs.unlinkSync(ownerFile);
      } catch {
        /* may not exist */
      }
      try {
        fs.unlinkSync(pidFile);
      } catch {
        /* may not exist */
      }
      assert.ok(daemonA?.pid && isPidAlive(daemonA.pid), 'daemonA must still be alive');
    });

    await test('daemon B evicts daemon A via argv scan even with no owner trace', async () => {
      const aPid = daemonA!.pid!;
      daemonB = startDaemon();
      // Daemon B must claim the socket (which means daemon A was evicted).
      await waitForSocket(socketPath, 15_000);

      const aExited = await waitForExit(aPid, 8_000);
      assert.equal(
        aExited,
        true,
        `daemon A (${aPid}) must be terminated by daemon B's imposter scan`
      );
      assert.ok(daemonB!.pid && isPidAlive(daemonB!.pid), 'daemon B must be the sole survivor');
    });
  } finally {
    for (const child of [daemonA, daemonB]) {
      if (!child) continue;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      if (child.pid) {
        const exited = await waitForExit(child.pid, 5_000);
        if (!exited) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
