/**
 * Regression test for ghost schedule registrations after cancel.
 *
 * Before the unschedule-hook fix, `this.schedule.cancel(id)` only
 * unlinked the disk file; the daemon's in-memory cron registration
 * survived. A subsequent `this.schedule.create({ name, ... })` under
 * the same name added a second registration, and both fired on
 * schedule until the next daemon restart. User-visible symptom was
 * two execution records per interval with the same method+params.
 *
 * The fix threads an `unscheduleHook` callback through the
 * ScheduleProvider constructor. When `cancel()` unlinks the file it
 * now also calls the hook, which IPCs the daemon to evict the
 * in-memory registration synchronously.
 *
 * This test exercises the behavior at the photon-core boundary — the
 * unit where the bug actually lived — with a fake hook, so failures
 * point at the wiring rather than the daemon's IPC path.
 *
 * A daemon-level end-to-end test would also be nice but needs a
 * ~2-minute wait (two cron boundaries) to distinguish "ghost fired"
 * from "ghost evicted by the fire-time prune". The photon-core
 * contract check here runs in milliseconds and fails deterministically
 * if the hook wiring regresses.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScheduleProvider } from '../node_modules/@portel/photon-core/dist/schedule.js';

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

function freshBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'photon-ghost-test-'));
}

async function main(): Promise<void> {
  console.log('schedule ghost-cancel regression:');

  await test('cancel(id) invokes the unschedule hook after unlinking the file', async () => {
    const baseDir = freshBaseDir();
    try {
      const hookCalls: string[] = [];
      const hook = async (jobId: string): Promise<boolean> => {
        hookCalls.push(jobId);
        return true;
      };
      const provider = new ScheduleProvider('ghost-probe', baseDir, hook);

      const task = await provider.create({
        name: 'test-schedule',
        schedule: '* * * * *',
        method: 'tick',
      });

      // Sanity: the disk file exists right after create.
      const dir = path.join(baseDir, '.data', 'ghost-probe', 'schedules');
      assert.ok(fs.existsSync(path.join(dir, `${task.id}.json`)));

      const removed = await provider.cancel(task.id);
      assert.equal(removed, true, 'cancel should report the file was removed');
      assert.equal(
        hookCalls.length,
        1,
        `hook must fire exactly once per cancel, got ${hookCalls.length} call(s)`
      );
      assert.equal(
        hookCalls[0],
        `ghost-probe:sched:${task.id}`,
        `hook must receive the namespaced job id the daemon keys cron jobs under, got ${JSON.stringify(hookCalls[0])}`
      );
      assert.equal(
        fs.existsSync(path.join(dir, `${task.id}.json`)),
        false,
        'the disk file should also be removed — cancel is file + memory together'
      );
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('cancelByName routes through cancel and still invokes the hook', async () => {
    const baseDir = freshBaseDir();
    try {
      const hookCalls: string[] = [];
      const hook = async (jobId: string): Promise<boolean> => {
        hookCalls.push(jobId);
        return true;
      };
      const provider = new ScheduleProvider('ghost-probe', baseDir, hook);
      const task = await provider.create({
        name: 'named',
        schedule: '* * * * *',
        method: 'tick',
      });
      const removed = await provider.cancelByName('named');
      assert.equal(removed, true);
      assert.equal(
        hookCalls.length,
        1,
        'cancelByName is a thin wrapper over cancel — hook fires once, not twice'
      );
      assert.equal(hookCalls[0], `ghost-probe:sched:${task.id}`);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('cancel(id) without a hook is safe — hook absence does not break the fs.unlink path', async () => {
    const baseDir = freshBaseDir();
    try {
      const provider = new ScheduleProvider('ghost-probe', baseDir); // no hook
      const task = await provider.create({
        name: 'noop-hook',
        schedule: '* * * * *',
        method: 'tick',
      });
      const removed = await provider.cancel(task.id);
      assert.equal(removed, true, 'cancel without a hook still unlinks the file');
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('cancel still fires the hook even when the file was already gone', async () => {
    // Guards the phantom scenario: a previous session unlinked the
    // file but the in-memory registration survived. A subsequent
    // cancel of the now-missing id must still evict the registration
    // rather than silently no-oping on the fs.unlink ENOENT.
    const baseDir = freshBaseDir();
    try {
      const hookCalls: string[] = [];
      const hook = async (jobId: string): Promise<boolean> => {
        hookCalls.push(jobId);
        return true;
      };
      const provider = new ScheduleProvider('ghost-probe', baseDir, hook);
      const removed = await provider.cancel('nonexistent-uuid');
      assert.equal(removed, false, 'no file to remove, so returns false');
      assert.equal(
        hookCalls.length,
        1,
        'hook still fires — the in-memory registration might still exist even when the file is gone'
      );
      assert.equal(hookCalls[0], 'ghost-probe:sched:nonexistent-uuid');
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('hook throwing does not break cancel — unlink already succeeded, daemon is best-effort', async () => {
    const baseDir = freshBaseDir();
    try {
      const hook = async (): Promise<boolean> => {
        throw new Error('daemon unreachable');
      };
      const provider = new ScheduleProvider('ghost-probe', baseDir, hook);
      const task = await provider.create({
        name: 'throwing-hook',
        schedule: '* * * * *',
        method: 'tick',
      });
      // Must not throw — fire-time phantom-prune in the daemon is
      // the fallback when the hook fails.
      const removed = await provider.cancel(task.id);
      assert.equal(removed, true);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  console.log('\nSchedule ghost-cancel regression passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
