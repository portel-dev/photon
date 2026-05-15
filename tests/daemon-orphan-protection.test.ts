/**
 * Tests for daemon orphan-socket protection.
 *
 * Regression for the "Daemon marked running but socket is unreachable" bug:
 * cleanupStale and killProcess used to delete the socket/pid/owner files
 * unconditionally, even when SIGTERM and SIGKILL didn't actually terminate
 * the daemon process. The surviving daemon then kept its socket bound but
 * the file was gone — every subsequent client hit ENOENT until manual
 * intervention.
 *
 * The fix: file deletion is now conditional on `process.kill(pid, 0)`
 * confirming the tracked PIDs are actually dead. If any survives, both
 * helpers throw `DaemonOrphanError` and leave the state files intact so
 * the running daemon stays reachable.
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { DaemonManager, DaemonOrphanError } from '../src/daemon/manager.js';
import { getOwnerFilePath, writeOwnerRecord } from '../src/daemon/ownership.js';

(async () => {
  console.log('🧪 Daemon orphan-protection tests...\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-orphan-test-'));
  const socketPath = path.join(tmpDir, 'daemon.sock');
  const pidFile = path.join(tmpDir, 'daemon.pid');
  const logFile = path.join(tmpDir, 'daemon.log');
  const ownerFile = getOwnerFilePath(socketPath);

  const ctx = {
    baseDir: tmpDir,
    socketPath,
    pidFile,
    logFile,
  };

  // Helper: lay down all three state files pointing at `pid` plus a
  // placeholder socket file so unlink would visibly succeed if cleanup
  // proceeded.
  function seedDaemonState(pid: number): void {
    fs.writeFileSync(pidFile, pid.toString());
    writeOwnerRecord(ownerFile, { pid, socketPath, claimedAt: Date.now() });
    fs.writeFileSync(socketPath, ''); // placeholder so existsSync returns true
  }

  function clearDaemonState(): void {
    for (const f of [pidFile, ownerFile, socketPath]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ok */
      }
    }
  }

  // Stub process.kill: any non-zero signal is a no-op (the "process"
  // ignores SIGTERM and SIGKILL); signal 0 reports `unkillablePid` as
  // alive forever, while real PIDs are checked for real.
  async function withUnkillablePid<T>(unkillablePid: number, fn: () => Promise<T>): Promise<T> {
    const realKill = process.kill.bind(process);
    (process as any).kill = (pid: number, sig?: string | number) => {
      if (sig === 0 || sig === undefined) {
        if (pid === unkillablePid) return true;
        return realKill(pid, 0);
      }
      // Pretend SIGTERM/SIGKILL succeeded but the process kept running.
      if (pid === unkillablePid) return true;
      return realKill(pid, sig);
    };
    try {
      return await fn();
    } finally {
      (process as any).kill = realKill;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 1: cleanupStale on a dead PID removes all state files.
  // (Happy path — confirms the cleanup *can* still happen when safe.)
  // ─────────────────────────────────────────────────────────────────
  {
    clearDaemonState();
    seedDaemonState(999_999_999); // PID that doesn't exist on this system
    const mgr = new DaemonManager(ctx as any);

    await (mgr as any).cleanupStaleAsync();

    assert.equal(fs.existsSync(pidFile), false, 'pid file removed');
    assert.equal(fs.existsSync(ownerFile), false, 'owner file removed');
    assert.equal(fs.existsSync(socketPath), false, 'socket file removed');
    console.log('  ✅ Dead PID: cleanupStale removes state files');
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 2: cleanupStale REFUSES to delete socket when PID survives.
  // This is the bug regression: previously the socket was unlinked
  // even though the daemon was still bound to it, leaving every
  // subsequent client to hit ENOENT.
  // ─────────────────────────────────────────────────────────────────
  {
    clearDaemonState();
    const fakePid = 987_654_321;
    seedDaemonState(fakePid);

    let threw: unknown;
    await withUnkillablePid(fakePid, async () => {
      const mgr = new DaemonManager(ctx as any);
      try {
        await (mgr as any).cleanupStaleAsync();
      } catch (err) {
        threw = err;
      }
    });

    assert(threw instanceof DaemonOrphanError, 'cleanupStale should throw DaemonOrphanError');
    assert.deepEqual(
      (threw as DaemonOrphanError).survivorPids,
      [fakePid],
      'survivorPids should list the unkillable pid'
    );
    assert.equal(fs.existsSync(pidFile), true, 'pid file MUST NOT be deleted');
    assert.equal(fs.existsSync(ownerFile), true, 'owner file MUST NOT be deleted');
    assert.equal(fs.existsSync(socketPath), true, 'socket file MUST NOT be deleted');
    console.log('  ✅ Surviving PID: cleanupStale leaves state files intact and throws');
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 3: killProcess refuses cleanup the same way (called from
  // stop() and restart() — same protection invariant must hold).
  // ─────────────────────────────────────────────────────────────────
  {
    clearDaemonState();
    const fakePid = 876_543_210;
    seedDaemonState(fakePid);

    let threw: unknown;
    await withUnkillablePid(fakePid, async () => {
      const mgr = new DaemonManager(ctx as any);
      try {
        (mgr as any).killProcess();
      } catch (err) {
        threw = err;
      }
    });

    assert(threw instanceof DaemonOrphanError, 'killProcess should throw DaemonOrphanError');
    assert.equal(fs.existsSync(pidFile), true, 'pid file MUST NOT be deleted');
    assert.equal(fs.existsSync(ownerFile), true, 'owner file MUST NOT be deleted');
    assert.equal(fs.existsSync(socketPath), true, 'socket file MUST NOT be deleted');
    console.log('  ✅ Surviving PID: killProcess leaves state files intact and throws');
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 4: PID reuse — a tracked PID belonging to an unrelated process
  // (kernel recycled the slot) must NOT receive SIGTERM/SIGKILL, and
  // cleanupStale must treat the slot as dead and remove state files.
  // POSIX-only: skipped on Windows because process start time isn't
  // available there.
  // ─────────────────────────────────────────────────────────────────
  if (process.platform !== 'win32') {
    clearDaemonState();
    // Spawn a real long-running child whose PID we'll claim falsely.
    // sleep is universally available on macOS and Linux.
    const child = spawn('sleep', ['30'], { detached: false, stdio: 'ignore' });
    if (typeof child.pid !== 'number') {
      throw new Error('Failed to spawn sleep for PID-reuse test');
    }
    const childPid = child.pid;

    try {
      // Wait briefly for the process to register in ps.
      await new Promise((r) => setTimeout(r, 200));

      // Seed a daemon owner record that claims this PID was claimed
      // 60 seconds ago — far outside the 5-second drift window — so
      // isPidOurDaemon will return false (recycled).
      fs.writeFileSync(pidFile, String(childPid));
      writeOwnerRecord(ownerFile, {
        pid: childPid,
        socketPath,
        claimedAt: Date.now() - 60_000,
      });
      fs.writeFileSync(socketPath, '');

      const mgr = new DaemonManager(ctx as any);
      await (mgr as any).cleanupStaleAsync(); // must not throw

      // Critical: the unrelated process MUST still be alive — we must
      // not have signaled it.
      let stillAlive = false;
      try {
        process.kill(childPid, 0);
        stillAlive = true;
      } catch {
        stillAlive = false;
      }
      assert.equal(stillAlive, true, 'recycled-PID process must NOT be signaled');

      // State files should be cleaned (slot treated as dead).
      assert.equal(fs.existsSync(pidFile), false, 'pid file removed for recycled slot');
      assert.equal(fs.existsSync(ownerFile), false, 'owner file removed for recycled slot');
      assert.equal(fs.existsSync(socketPath), false, 'socket file removed for recycled slot');
      console.log('  ✅ PID reuse: cleanupStale skips signaling and cleans state');
    } finally {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        /* ok */
      }
    }
  } else {
    console.log('  ⊘ PID reuse test skipped on Windows');
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 5: log rotation kicks in when the file exceeds the cap.
  // Backstop against the 558 MB daemon.log seen in the wild.
  // ─────────────────────────────────────────────────────────────────
  {
    clearDaemonState();
    // Write a 60 MB log to trigger rotation (cap is 50 MB).
    const padding = Buffer.alloc(60 * 1024 * 1024, 0x61); // 60 MB of 'a'
    fs.writeFileSync(logFile, padding);
    const rotated = `${logFile}.1`;
    try {
      fs.unlinkSync(rotated);
    } catch {
      /* ok */
    }

    const mgr = new DaemonManager(ctx as any);
    (mgr as any).rotateLogIfTooLarge();

    assert.equal(fs.existsSync(logFile), false, 'oversized log should be rotated away');
    assert.equal(fs.existsSync(rotated), true, 'rotated copy should exist as .1');
    fs.unlinkSync(rotated);
    console.log('  ✅ Log rotation triggers above 50 MB');
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 6: parent closes daemon log fd after spawn.
  // The daemon inherits stdout/stderr handles, but the Beam/CLI parent must
  // not keep its own copy or every restart leaks daemon.log descriptors.
  // ─────────────────────────────────────────────────────────────────
  {
    const managerSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'daemon', 'manager.ts'),
      'utf-8'
    );
    const spawnBlock = managerSource.slice(
      managerSource.indexOf('private async spawnDaemon'),
      managerSource.indexOf('    const childPid = child.pid;')
    );
    assert.match(spawnBlock, /fs\.closeSync\(logStream\)/);
    console.log('  ✅ Parent closes daemon log fd after spawn');
  }

  // ─────────────────────────────────────────────────────────────────
  // Test 7: Zombie process regression — a process that has been killed
  // (SIGKILL) but not yet reaped by its parent appears alive to
  // kill(pid, 0) on POSIX. cleanupStale must detect the zombie via
  // ps state='Z' and treat it as dead so cleanup proceeds without
  // manual intervention.
  //
  // Root cause of the bug: isPidStillAlive returned true for zombies
  // because kill(pid,0) succeeds on a zombie. The fix adds a ps state
  // check and treats 'Z' as dead.
  //
  // The async cleanup path must also classify zombies as dead so recovery
  // can proceed without manual intervention.
  // ─────────────────────────────────────────────────────────────────
  if (process.platform !== 'win32') {
    clearDaemonState();

    // Spawn a real process. We'll kill it and immediately run cleanupStale
    // before libuv gets to reap the zombie on the next event loop tick.
    const zombie = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    zombie.unref(); // do not auto-reap via libuv
    if (typeof zombie.pid !== 'number') {
      throw new Error('Failed to spawn sleep for zombie test');
    }
    const zombiePid = zombie.pid;

    // Let the process register in the kernel's process table.
    await new Promise((r) => setTimeout(r, 150));

    // Seed state as if this were our daemon.
    seedDaemonState(zombiePid);

    // Kill it — process dies immediately but may remain as a zombie in the
    // process table until waitpid is called.
    process.kill(zombiePid, 'SIGKILL');

    // cleanupStale must succeed — the zombie must be treated as dead.
    const mgr = new DaemonManager(ctx as any);
    let zombieThrew: unknown;
    try {
      await (mgr as any).cleanupStaleAsync();
    } catch (err) {
      zombieThrew = err;
    }

    assert.equal(zombieThrew, undefined, 'cleanupStale must NOT throw for a zombie process');
    assert.equal(fs.existsSync(pidFile), false, 'pid file removed for zombie');
    assert.equal(fs.existsSync(ownerFile), false, 'owner file removed for zombie');
    assert.equal(fs.existsSync(socketPath), false, 'socket file removed for zombie');
    console.log('  ✅ Zombie PID: cleanupStale treats zombie as dead and cleans state');
  } else {
    console.log('  ⊘ Zombie test skipped on Windows');
  }

  // Cleanup
  clearDaemonState();
  try {
    fs.unlinkSync(logFile);
  } catch {
    /* ok */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n✅ All daemon orphan-protection tests passed!\n');
})();
