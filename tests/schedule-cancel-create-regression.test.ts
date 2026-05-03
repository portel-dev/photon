/**
 * Regression test for Bug 4 in v1.27.0:
 *   "Silent failure of legacy this.schedule.create() in 1.26.1".
 *
 * The shape of the bug: an `enable_schedule` method calling
 *   await this.schedule.cancelByName('foo');
 *   const task = await this.schedule.create({ name: 'foo', schedule: '15 * * * *', method: 'sync' });
 *   return `Scheduled (task ${task.id})`;
 * returned a successful task ID, but the daemon's boot scan never
 * picked up the new schedule. A previously-healthy schedule with a
 * non-zero runCount was silently destroyed.
 *
 * The original fix (commit 3bdc02e) routes `cancel()`'s in-process
 * hook directly to the daemon's eviction helper instead of round-
 * tripping through its own Unix socket — which fails with ENOENT
 * during the recovery window when the socket is briefly missing.
 *
 * What this test asserts (the contract callers actually depend on):
 *
 *   1. After cancelByName + create, the new ScheduleProvider file
 *      exists on disk with a fresh UUID and the requested cron.
 *   2. The unschedule hook fires exactly once on cancel, with the
 *      namespaced job id the daemon's evictor expects.
 *   3. The boot-time scan (`loadPersistedSchedulesFromDir`) finds
 *      the NEW schedule and offers it to the engine — the failure
 *      mode in v1.26.1 was the new file being missing or filtered.
 *   4. The daemon-side job id matches the namespaced shape the
 *      cancel hook would later use to evict it. If those two
 *      shapes ever drift, cancel becomes a no-op and the bug
 *      resurrects.
 *
 * Failure mode this guards against: a silent regression where the
 * call returns a task id but the boot loader cannot enroll it.
 * The bug was indistinguishable from success at the API surface,
 * so an integration assertion is the only way to catch it cheaply.
 */

import { strict as assert } from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ScheduleProvider } from '../node_modules/@portel/photon-core/dist/schedule.js';
import {
  loadPersistedSchedulesFromDir,
  type PersistedScheduleJob,
} from '../dist/daemon/schedule-loader.js';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    if (err instanceof Error) {
      console.log(`    ${err.message}`);
    } else {
      console.log(`    ${String(err)}`);
    }
  }
}

function freshBaseDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'photon-cancel-create-'));
}

function schedulesDir(baseDir: string, photon: string): string {
  return path.join(baseDir, '.data', photon, 'schedules');
}

function captureHook(): {
  hook: (jobId: string) => Promise<boolean>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    hook: async (jobId: string): Promise<boolean> => {
      calls.push(jobId);
      return true;
    },
  };
}

async function main(): Promise<void> {
  console.log('schedule cancel-then-create regression (Bug 4):');

  await test('cancelByName + create writes a fresh file the boot loader can enroll', async () => {
    const baseDir = freshBaseDir();
    try {
      const photon = 'cancel-create-probe';
      const { hook, calls } = captureHook();
      const provider = new ScheduleProvider(photon, baseDir, hook);

      // Step 1: initial create — pretend a previous boot enrolled this.
      const first = await provider.create({
        name: 'foo',
        schedule: '15 * * * *',
        method: 'sync',
      });
      const dir = schedulesDir(baseDir, photon);
      assert.equal(
        fs.existsSync(path.join(dir, `${first.id}.json`)),
        true,
        'first create must land a JSON file the boot loader will scan'
      );

      // Step 2: cancel the prior registration.
      const removed = await provider.cancelByName('foo');
      assert.equal(removed, true, 'cancelByName should report the file was removed');
      assert.equal(
        calls.length,
        1,
        `unschedule hook must fire exactly once per cancel, got ${calls.length}`
      );
      assert.equal(
        calls[0],
        `${photon}:sched:${first.id}`,
        'hook must receive the namespaced job id the daemon evictor uses'
      );
      assert.equal(
        fs.existsSync(path.join(dir, `${first.id}.json`)),
        false,
        'cancel must unlink the backing file — leaving it would resurrect on restart'
      );

      // Step 3: re-create with a different cron.
      const second = await provider.create({
        name: 'foo',
        schedule: '30 * * * *',
        method: 'sync',
      });
      assert.notEqual(
        second.id,
        first.id,
        'the second create must mint a fresh UUID, not reuse the cancelled id'
      );
      assert.equal(
        fs.existsSync(path.join(dir, `${second.id}.json`)),
        true,
        'second create must land a fresh JSON file — Bug 4 was this file going missing'
      );

      // Step 4: simulate the daemon boot scan — exactly the path that was
      // failing to register the new schedule in v1.26.1.
      const enrolled: PersistedScheduleJob[] = [];
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, photon, baseDir, {
        register: (job) => {
          enrolled.push(job);
          return true;
        },
        alreadyRegistered: () => false,
      });

      assert.equal(
        result.loaded,
        1,
        `boot scan should load exactly the new schedule, got ${result.loaded}`
      );
      assert.equal(result.skipped, 0, 'no files should be skipped — old file is unlinked');
      assert.equal(enrolled.length, 1, 'register callback must fire for the new schedule');

      const job = enrolled[0];
      assert.equal(
        job.id,
        `${photon}:sched:${second.id}`,
        'job id must match the namespaced shape the cancel hook later evicts on'
      );
      assert.equal(
        job.cron,
        '30 * * * *',
        'job cron must reflect the second create, not the cancelled first'
      );
      assert.equal(job.method, 'sync', 'job method must be preserved through cancel + create');
      assert.equal(job.photonName, photon, 'photonName must be inferred when not on the task');
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  await test('repeated cancel + create cycles do not leak stale files into boot scan', async () => {
    // Rapid enable/disable cycles in real photons produced ghost files
    // that re-armed cancelled schedules at the next boot. Walk three
    // cycles and assert the loader only ever sees the latest schedule.
    const baseDir = freshBaseDir();
    try {
      const photon = 'cycle-probe';
      const { hook } = captureHook();
      const provider = new ScheduleProvider(photon, baseDir, hook);

      let lastId = '';
      for (let i = 0; i < 3; i++) {
        const task = await provider.create({
          name: 'tick',
          schedule: `${i} * * * *`,
          method: 'tick',
        });
        lastId = task.id;
        // Cancel immediately on the first two cycles, leave the third.
        if (i < 2) {
          await provider.cancelByName('tick');
        }
      }

      const dir = schedulesDir(baseDir, photon);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      assert.equal(
        files.length,
        1,
        `only the surviving schedule should remain on disk, found ${files.length} files`
      );

      const enrolled: PersistedScheduleJob[] = [];
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, photon, baseDir, {
        register: (job) => {
          enrolled.push(job);
          return true;
        },
        alreadyRegistered: () => false,
      });

      assert.equal(result.loaded, 1, 'boot scan must load exactly one job');
      assert.equal(
        enrolled[0].id,
        `${photon}:sched:${lastId}`,
        'enrolled id must match the last surviving create'
      );
      assert.equal(enrolled[0].cron, '2 * * * *', 'enrolled cron must reflect the last create');
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  console.log(`\n  passed: ${passed}, failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
