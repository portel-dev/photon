/**
 * Regression: daemon boot-time schedule loader must handle
 * ScheduleProvider-format files (written by `this.schedule.create()`
 * from photon code).
 *
 * Before this fix, the boot scanner only loaded files with
 * `source: 'ipc'`. Every schedule authored by `this.schedule.create()`
 * — which doesn't set that field — was silently skipped. Jobs stayed
 * dormant in the cron engine until the owning photon was invoked.
 *
 * Symptom in the field: schedule file on disk has `status: 'active'`
 * but `lastRunAt` / `executions.jsonl` entries never appear.
 *
 * Guarded assertions:
 *   - ScheduleProvider file with no `source` is loaded (not skipped).
 *   - IPC file with `source: 'ipc'` is loaded (regression guard).
 *   - `status: 'paused'` ScheduleProvider file is skipped.
 *   - The job handed to `register()` has the expected id shape,
 *     photonName, method, and args (params mapped to args).
 *   - Invalid cron / malformed files count as skipped.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  loadPersistedSchedulesFromDir,
  type PersistedScheduleJob,
} from '../dist/daemon/schedule-loader.js';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err?.message || err}`);
  }
}

function makeTempSchedulesDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `photon-schedule-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeScheduleProviderFile(
  dir: string,
  opts: {
    cron?: string;
    method?: string;
    status?: 'active' | 'paused' | 'completed';
    name?: string;
  } = {}
): string {
  const id = randomUUID();
  const task = {
    id,
    name: opts.name || `schedule-${id.slice(0, 8)}`,
    cron: opts.cron || '0 10 * * *',
    method: opts.method || 'scheduled_sync',
    params: { foo: 'bar' },
    fireOnce: false,
    maxExecutions: 0,
    status: opts.status || 'active',
    createdAt: new Date().toISOString(),
    executionCount: 0,
    photonId: 'kith-sync',
    // NOTE: deliberately no `source` field — this matches what photon-core writes.
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(task, null, 2));
  return id;
}

function writeIpcScheduleFile(dir: string, photonName: string): string {
  const id = `${photonName}:some-method`;
  const task = {
    id,
    source: 'ipc',
    photonName,
    method: 'some-method',
    cron: '*/5 * * * *',
    args: { apiKey: 'xyz' },
    createdAt: new Date().toISOString(),
    createdBy: 'cli',
  };
  fs.writeFileSync(
    path.join(dir, `${id.replace(/[:/]/g, '-')}.json`),
    JSON.stringify(task, null, 2)
  );
  return id;
}

/** Collect every job the loader tries to register. */
function collector() {
  const registered: PersistedScheduleJob[] = [];
  return {
    registered,
    cb: {
      alreadyRegistered: () => false,
      register: (job: PersistedScheduleJob) => {
        registered.push(job);
        return true;
      },
    },
  };
}

async function run(): Promise<void> {
  console.log('\nSchedule boot-time loader regression tests\n');

  await test('ScheduleProvider file (no `source` field) is loaded and mapped correctly', () => {
    const dir = makeTempSchedulesDir();
    try {
      const taskId = writeScheduleProviderFile(dir, { cron: '0 10 * * *' });

      const { registered, cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'kith-sync', '/workspace/kith', cb);
      assert.equal(result.loaded, 1, `expected 1 loaded, got ${result.loaded}`);
      assert.equal(result.skipped, 0);

      assert.equal(registered.length, 1);
      const job = registered[0];
      assert.equal(
        job.id,
        `kith-sync:sched:${taskId}`,
        'ScheduleProvider job must use namespaced `<photon>:sched:<uuid>` id'
      );
      assert.equal(job.photonName, 'kith-sync');
      assert.equal(job.cron, '0 10 * * *');
      assert.equal(job.method, 'scheduled_sync');
      assert.deepEqual(job.args, { foo: 'bar' }, 'params must be mapped to args');
      assert.equal(
        job.workingDir,
        '/workspace/kith',
        'workingDir must fall back to the hint when task has none'
      );
      assert.equal(
        job.createdBy,
        'schedule-provider',
        'createdBy should identify the origin for diagnostics'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('IPC file (source: ipc) is still loaded — regression guard', () => {
    const dir = makeTempSchedulesDir();
    try {
      const id = writeIpcScheduleFile(dir, 'legacy-photon');
      const { registered, cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'legacy-photon', undefined, cb);
      assert.equal(result.loaded, 1);
      const job = registered[0];
      assert.equal(job.id, id, 'IPC id must not be namespaced');
      assert.deepEqual(job.args, { apiKey: 'xyz' }, 'IPC `args` must pass through');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('paused ScheduleProvider file is skipped', () => {
    const dir = makeTempSchedulesDir();
    try {
      writeScheduleProviderFile(dir, { status: 'paused' });
      const { registered, cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'kith-sync', undefined, cb);
      assert.equal(result.loaded, 0, 'paused schedule must not be loaded');
      assert.equal(result.skipped, 1);
      assert.equal(registered.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('mixed directory: IPC and ScheduleProvider coexist', () => {
    const dir = makeTempSchedulesDir();
    try {
      writeScheduleProviderFile(dir, { name: 'sp-job' });
      writeIpcScheduleFile(dir, 'mixed-photon');
      const { registered, cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'mixed-photon', undefined, cb);
      assert.equal(result.loaded, 2, `expected both loaded, got ${result.loaded}`);
      assert.equal(registered.length, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('ScheduleProvider file whose dir hint matches photonId works', () => {
    // Simulates the real call site: scanBaseDataRoot reads photonName
    // from the dir entry and passes it as the hint. The task file
    // itself has `photonId` (same value, different key name).
    const dir = makeTempSchedulesDir();
    try {
      writeScheduleProviderFile(dir, { cron: '0 * * * *' });
      const { registered, cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'kith-sync', undefined, cb);
      assert.equal(result.loaded, 1);
      assert.equal(registered[0].photonName, 'kith-sync');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('alreadyRegistered=true prevents double-registration', () => {
    const dir = makeTempSchedulesDir();
    try {
      writeScheduleProviderFile(dir);
      const registered: PersistedScheduleJob[] = [];
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'kith-sync', undefined, {
        alreadyRegistered: () => true,
        register: (job) => {
          registered.push(job);
          return true;
        },
      });
      assert.equal(result.loaded, 0, 'already-registered jobs must not re-register');
      assert.equal(registered.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('missing photonName hint + no photonName on task → skipped', () => {
    const dir = makeTempSchedulesDir();
    try {
      writeScheduleProviderFile(dir);
      const { cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, null, undefined, cb);
      assert.equal(result.loaded, 0);
      assert.equal(result.skipped, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('corrupt JSON is counted as skipped, not fatal', () => {
    const dir = makeTempSchedulesDir();
    try {
      fs.writeFileSync(path.join(dir, 'corrupt.json'), '{not valid json');
      writeScheduleProviderFile(dir);
      const { registered, cb } = collector();
      const result = loadPersistedSchedulesFromDir(dir, TTL_MS, 'kith-sync', undefined, cb);
      assert.equal(result.loaded, 1, 'valid file still loads');
      assert.equal(result.skipped, 1, 'corrupt file counts as skip');
      assert.equal(registered.length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
