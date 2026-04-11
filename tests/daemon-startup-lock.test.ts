/**
 * Tests for daemon startup lock — prevents multiple daemon instances.
 *
 * Verifies that the cross-process filesystem lock in DaemonManager
 * correctly serializes daemon startup to prevent the race condition
 * where multiple processes each spawn their own daemon.
 */

import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DaemonManager } from '../src/daemon/manager.js';
import { getOwnerFilePath } from '../src/daemon/ownership.js';

(async () => {
  console.log('🧪 Daemon startup lock tests...\n');

  // Create isolated temp context for testing
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-lock-test-'));
  const socketPath = path.join(tmpDir, 'daemon.sock');
  const pidFile = path.join(tmpDir, 'daemon.pid');
  const logFile = path.join(tmpDir, 'daemon.log');
  const lockFile = path.join(tmpDir, 'daemon.lock');
  const ownerFile = getOwnerFilePath(socketPath);

  const ctx = {
    baseDir: tmpDir,
    socketPath,
    pidFile,
    logFile,
  };

  // Test 1: Lock file created and cleaned up
  {
    // Access private method via bracket notation for testing
    const mgr = new DaemonManager(ctx as any);
    const acquired = await (mgr as any).acquireStartupLock();
    assert.equal(acquired, true, 'First lock acquisition should succeed');
    assert(fs.existsSync(lockFile), 'Lock file should exist after acquisition');

    const lockContent = fs.readFileSync(lockFile, 'utf-8').trim();
    assert.equal(lockContent, process.pid.toString(), 'Lock file should contain our PID');

    (mgr as any).releaseStartupLock();
    assert(!fs.existsSync(lockFile), 'Lock file should be removed after release');
    console.log('  ✅ Lock acquisition and release works');
  }

  // Test 2: Second acquisition fails when lock is held by live process
  {
    const mgr1 = new DaemonManager(ctx as any);
    const mgr2 = new DaemonManager(ctx as any);

    const acquired1 = await (mgr1 as any).acquireStartupLock();
    assert.equal(acquired1, true, 'First manager should acquire lock');

    const acquired2 = await (mgr2 as any).acquireStartupLock();
    assert.equal(acquired2, false, 'Second manager should fail to acquire lock');

    (mgr1 as any).releaseStartupLock();
    console.log('  ✅ Concurrent lock acquisition blocked');
  }

  // Test 3: Stale lock from dead process is cleaned up
  {
    // Write a lock file with a PID that doesn't exist
    fs.writeFileSync(lockFile, '999999999');

    const mgr = new DaemonManager(ctx as any);
    const acquired = await (mgr as any).acquireStartupLock();
    assert.equal(acquired, true, 'Should acquire lock after cleaning stale lock');

    (mgr as any).releaseStartupLock();
    console.log('  ✅ Stale lock from dead process cleaned up');
  }

  // Test 4: Release only removes lock if we own it
  {
    // Write a lock file with a different PID (simulating another process)
    fs.writeFileSync(lockFile, '1'); // PID 1 (launchd/init, always alive)

    const mgr = new DaemonManager(ctx as any);
    (mgr as any).releaseStartupLock();
    assert(fs.existsSync(lockFile), 'Lock file should NOT be removed if we dont own it');

    fs.unlinkSync(lockFile);
    console.log('  ✅ Release respects lock ownership');
  }

  // Cleanup
  assert.equal(fs.existsSync(ownerFile), false, 'owner file should not exist in lock-only tests');
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log('\n✅ All daemon startup lock tests passed!\n');
})();
