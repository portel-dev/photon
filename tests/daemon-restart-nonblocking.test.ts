/**
 * Regression: daemon restart must not freeze the Beam web server.
 *
 * A stale-binary recovery can happen from Beam request paths through
 * ensureDaemon() -> restart(). Restart used to wait for old daemon PIDs with
 * Atomics.wait, blocking the entire Node event loop for up to 4.5 seconds.
 *
 * Run: npx tsx tests/daemon-restart-nonblocking.test.ts
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DaemonManager, DaemonOrphanError } from '../src/daemon/manager.js';
import { getOwnerFilePath, writeOwnerRecord } from '../src/daemon/ownership.js';

async function withUnkillablePid<T>(pid: number, fn: () => Promise<T>): Promise<T> {
  const realKill = process.kill.bind(process);
  (process as any).kill = (targetPid: number, sig?: string | number) => {
    if (targetPid !== pid) return realKill(targetPid, sig as any);
    if (sig === 0 || sig === undefined) return true;
    return true;
  };
  try {
    return await fn();
  } finally {
    (process as any).kill = realKill;
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-restart-nonblocking-'));
const socketPath = path.join(tmpDir, 'daemon.sock');
const pidFile = path.join(tmpDir, 'daemon.pid');
const logFile = path.join(tmpDir, 'daemon.log');
const ownerFile = getOwnerFilePath(socketPath);
const fakePid = 987_654_322;

try {
  fs.writeFileSync(pidFile, String(fakePid));
  fs.writeFileSync(socketPath, '');
  writeOwnerRecord(ownerFile, { pid: fakePid, socketPath, claimedAt: Date.now() });

  let ticks = 0;
  const timer = setInterval(() => {
    ticks++;
  }, 25);

  let thrown: unknown;
  await withUnkillablePid(fakePid, async () => {
    const mgr = new DaemonManager({ baseDir: tmpDir, socketPath, pidFile, logFile } as any);
    try {
      await mgr.restart();
    } catch (err) {
      thrown = err;
    } finally {
      clearInterval(timer);
    }
  });

  assert(thrown instanceof DaemonOrphanError, 'restart should still report surviving daemon PIDs');
  assert.ok(
    ticks >= 20,
    `restart recovery must yield to the event loop; timer only ticked ${ticks} times`
  );
  assert.equal(fs.existsSync(pidFile), true, 'pid file must remain for surviving daemon');
  assert.equal(fs.existsSync(ownerFile), true, 'owner file must remain for surviving daemon');
  assert.equal(fs.existsSync(socketPath), true, 'socket file must remain for surviving daemon');

  console.log('✅ daemon restart yields to the event loop while waiting for old PIDs');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
