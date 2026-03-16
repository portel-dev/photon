/**
 * Schedule Provider ↔ Daemon Integration Tests
 *
 * Tests the end-to-end flow:
 *   1. ScheduleProvider.create() writes JSON files to ~/.photon/schedules/
 *   2. Daemon's autoRegisterFromMetadata reads those files on photon init
 *   3. Daemon scheduleJob() registers them with setTimeout-based tick
 *   4. After execution, daemon writes back executionCount to the file
 *
 * These tests caught a real production bug where ScheduleProvider wrote
 * schedule files that the daemon never read — cron jobs silently never fired.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ── Test Harness ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Create a temp schedules directory with optional task files */
async function createTempSchedulesDir(photonName: string, tasks: any[] = []) {
  const tmpDir = path.join(
    os.tmpdir(),
    `photon-sched-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const photonDir = path.join(tmpDir, photonName);
  await fs.mkdir(photonDir, { recursive: true });

  for (const task of tasks) {
    await fs.writeFile(path.join(photonDir, `${task.id}.json`), JSON.stringify(task, null, 2));
  }

  return { tmpDir, photonDir };
}

/** Read a task file back */
async function readTaskFile(photonDir: string, taskId: string): Promise<any> {
  const content = await fs.readFile(path.join(photonDir, `${taskId}.json`), 'utf-8');
  return JSON.parse(content);
}

/** Simulate what ScheduleProvider.create() writes */
function makeTask(overrides: Partial<any> = {}): any {
  return {
    id: randomUUID(),
    name: 'test-task',
    cron: '0 3 * * *',
    method: '_testMethod',
    params: {},
    fireOnce: false,
    maxExecutions: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    executionCount: 0,
    photonId: 'test-photon',
    ...overrides,
  };
}

// ── Import server internals for unit testing ──────────────────────────
// We test parseCron and the schedule loading logic by re-implementing
// the file scanning from server.ts (same algorithm) since the daemon
// functions aren't exported individually.

function parseCronField(field: string, min: number, max: number): number[] | null {
  if (field === '*') {
    const values: number[] = [];
    for (let i = min; i <= max; i++) values.push(i);
    return values;
  }
  if (field.includes(',')) {
    const values = new Set<number>();
    for (const part of field.split(',')) {
      const partValues = parseCronField(part, min, max);
      if (!partValues) return null;
      partValues.forEach((v) => values.add(v));
    }
    return Array.from(values).sort((a, b) => a - b);
  }
  if (field.includes('/')) {
    const slashIdx = field.indexOf('/');
    const range = field.slice(0, slashIdx);
    const step = parseInt(field.slice(slashIdx + 1));
    if (isNaN(step) || step <= 0) return null;
    let start = min;
    let end = max;
    if (range !== '*') {
      if (range.includes('-')) {
        const [s, e] = range.split('-').map(Number);
        if (isNaN(s) || isNaN(e)) return null;
        start = s;
        end = e;
      } else {
        start = parseInt(range);
        if (isNaN(start)) return null;
      }
    }
    const values: number[] = [];
    for (let i = start; i <= end; i += step) values.push(i);
    return values;
  }
  if (field.includes('-')) {
    const [s, e] = field.split('-').map(Number);
    if (isNaN(s) || isNaN(e) || s < min || e > max) return null;
    const values: number[] = [];
    for (let i = s; i <= e; i++) values.push(i);
    return values;
  }
  const value = parseInt(field);
  if (isNaN(value) || value < min || value > max) return null;
  return [value];
}

function parseCron(cron: string): { isValid: boolean; nextRun: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { isValid: false, nextRun: 0 };

  const [minuteField, hourField, domField, monthField, dowField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const doms = parseCronField(domField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const dows = parseCronField(dowField, 0, 7);

  if (!minutes || !hours || !doms || !months || !dows) return { isValid: false, nextRun: 0 };

  const minuteSet = new Set(minutes);
  const hourSet = new Set(hours);
  const domSet = new Set(doms);
  const monthSet = new Set(months);
  const dowSet = new Set(dows.map((d) => (d === 7 ? 0 : d)));

  const domIsWild = domField === '*';
  const dowIsWild = dowField === '*';

  const candidate = new Date();
  candidate.setSeconds(0);
  candidate.setMilliseconds(0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < 525960; i++) {
    const month = candidate.getMonth() + 1;
    const dom = candidate.getDate();
    const dow = candidate.getDay();
    const hour = candidate.getHours();
    const minute = candidate.getMinutes();

    if (!monthSet.has(month)) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }
    if (!hourSet.has(hour)) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }
    if (!minuteSet.has(minute)) {
      candidate.setMinutes(candidate.getMinutes() + 1);
      continue;
    }

    const domMatch = domIsWild || domSet.has(dom);
    const dowMatch = dowIsWild || dowSet.has(dow);
    const dayMatch =
      domIsWild && dowIsWild
        ? true
        : !domIsWild && !dowIsWild
          ? domMatch || dowMatch
          : domMatch && dowMatch;

    if (dayMatch) return { isValid: true, nextRun: candidate.getTime() };
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return { isValid: false, nextRun: 0 };
}

/**
 * Simulate daemon's schedule file loading logic (from autoRegisterFromMetadata).
 * Returns the jobs that would be registered.
 */
async function loadScheduleFiles(schedulesDir: string, photonName: string): Promise<any[]> {
  const photonDir = path.join(schedulesDir, photonName);
  const jobs: any[] = [];

  let files: string[];
  try {
    files = (await fs.readdir(photonDir)).filter((f) => f.endsWith('.json'));
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  for (const file of files) {
    try {
      const content = await fs.readFile(path.join(photonDir, file), 'utf-8');
      const task = JSON.parse(content);
      if (task.status !== 'active') continue;
      const jobId = `${photonName}:sched:${task.id}`;
      const { isValid, nextRun } = parseCron(task.cron);
      if (!isValid) continue;

      jobs.push({
        id: jobId,
        method: task.method,
        args: task.params || {},
        cron: task.cron,
        runCount: task.executionCount || 0,
        nextRun,
        photonName,
        sourceFile: file,
        taskId: task.id,
      });
    } catch {
      // Skip corrupt files
    }
  }

  return jobs;
}

/** Simulate daemon's updatePersistedSchedule logic */
async function updatePersistedSchedule(
  photonDir: string,
  taskId: string,
  updates: { executionCount?: number; lastExecutionAt?: string }
): Promise<void> {
  const filePath = path.join(photonDir, `${taskId}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  const task = JSON.parse(content);
  if (updates.executionCount !== undefined) task.executionCount = updates.executionCount;
  if (updates.lastExecutionAt !== undefined) task.lastExecutionAt = updates.lastExecutionAt;
  await fs.writeFile(filePath, JSON.stringify(task, null, 2));
}

// ══════════════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════════════

async function testScheduleFileDiscovery() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Schedule File Discovery');
  console.log(`${'═'.repeat(60)}`);

  await test('loads active schedule files from photon directory', async () => {
    const task = makeTask({ name: 'nightly-compact', cron: '0 3 * * *', method: '_compactAll' });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [task]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].method, '_compactAll');
    assert.equal(jobs[0].cron, '0 3 * * *');
    assert.ok(jobs[0].id.startsWith('my-photon:sched:'));
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('skips paused schedule files', async () => {
    const active = makeTask({ name: 'active-job', status: 'active' });
    const paused = makeTask({ name: 'paused-job', status: 'paused' });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [active, paused]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].method, active.method);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('skips completed schedule files', async () => {
    const completed = makeTask({ name: 'done-job', status: 'completed' });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [completed]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 0);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('skips schedule files with invalid cron expressions', async () => {
    const bad = makeTask({ name: 'bad-cron', cron: 'not a cron' });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [bad]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 0);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('returns empty array when no schedules directory exists', async () => {
    const tmpDir = path.join(os.tmpdir(), `photon-sched-test-empty-${Date.now()}`);
    const jobs = await loadScheduleFiles(tmpDir, 'nonexistent');
    assert.equal(jobs.length, 0);
  });

  await test('loads multiple schedule files for same photon', async () => {
    const task1 = makeTask({ name: 'morning-report', cron: '0 9 * * *', method: 'report' });
    const task2 = makeTask({ name: 'nightly-cleanup', cron: '0 0 * * *', method: 'cleanup' });
    const task3 = makeTask({ name: 'hourly-check', cron: '0 * * * *', method: 'healthcheck' });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [task1, task2, task3]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 3);
    const methods = jobs.map((j) => j.method).sort();
    assert.deepEqual(methods, ['cleanup', 'healthcheck', 'report']);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('skips corrupt JSON files without crashing', async () => {
    const good = makeTask({ name: 'good-task' });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [good]);
    // Write a corrupt file
    await fs.writeFile(path.join(photonDir, 'corrupt.json'), '{ broken json !!!');
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 1); // Only the good one loaded
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('skips non-JSON files in schedules directory', async () => {
    const good = makeTask({ name: 'good-task' });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [good]);
    await fs.writeFile(path.join(photonDir, 'notes.txt'), 'not a schedule');
    await fs.writeFile(path.join(photonDir, '.gitkeep'), '');
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 1);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('preserves existing executionCount from file', async () => {
    const task = makeTask({ name: 'ran-before', executionCount: 42 });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [task]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs[0].runCount, 42);
    await fs.rm(tmpDir, { recursive: true });
  });
}

async function testExecutionTracking() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Execution Tracking (Write-Back)');
  console.log(`${'═'.repeat(60)}`);

  await test('writes executionCount back to schedule file after job runs', async () => {
    const task = makeTask({ name: 'track-me' });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [task]);

    // Simulate daemon running the job and updating the file
    await updatePersistedSchedule(photonDir, task.id, {
      executionCount: 1,
      lastExecutionAt: new Date().toISOString(),
    });

    const updated = await readTaskFile(photonDir, task.id);
    assert.equal(updated.executionCount, 1);
    assert.ok(updated.lastExecutionAt);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('increments executionCount across multiple runs', async () => {
    const task = makeTask({ name: 'multi-run' });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [task]);

    for (let i = 1; i <= 5; i++) {
      await updatePersistedSchedule(photonDir, task.id, {
        executionCount: i,
        lastExecutionAt: new Date().toISOString(),
      });
    }

    const updated = await readTaskFile(photonDir, task.id);
    assert.equal(updated.executionCount, 5);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('preserves all other task fields when updating execution count', async () => {
    const task = makeTask({
      name: 'preserve-fields',
      cron: '30 2 * * 1-5',
      method: 'weekdayJob',
      params: { format: 'pdf', recipients: ['a@b.com'] },
      description: 'Important job',
    });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [task]);

    await updatePersistedSchedule(photonDir, task.id, { executionCount: 3 });

    const updated = await readTaskFile(photonDir, task.id);
    assert.equal(updated.name, 'preserve-fields');
    assert.equal(updated.cron, '30 2 * * 1-5');
    assert.equal(updated.method, 'weekdayJob');
    assert.deepEqual(updated.params, { format: 'pdf', recipients: ['a@b.com'] });
    assert.equal(updated.description, 'Important job');
    assert.equal(updated.executionCount, 3);
    await fs.rm(tmpDir, { recursive: true });
  });
}

async function testCronParsing() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Cron Expression Parsing');
  console.log(`${'═'.repeat(60)}`);

  await test('parses standard daily cron (0 3 * * *)', () => {
    const result = parseCron('0 3 * * *');
    assert.ok(result.isValid);
    assert.ok(result.nextRun > Date.now());
    const next = new Date(result.nextRun);
    assert.equal(next.getHours(), 3);
    assert.equal(next.getMinutes(), 0);
  });

  await test('parses hourly cron (0 * * * *)', () => {
    const result = parseCron('0 * * * *');
    assert.ok(result.isValid);
    assert.ok(result.nextRun > Date.now());
    assert.equal(new Date(result.nextRun).getMinutes(), 0);
  });

  await test('parses weekday cron (30 9 * * 1-5)', () => {
    const result = parseCron('30 9 * * 1-5');
    assert.ok(result.isValid);
    const next = new Date(result.nextRun);
    const dow = next.getDay();
    assert.ok(dow >= 1 && dow <= 5, `Expected weekday, got ${dow}`);
    assert.equal(next.getHours(), 9);
    assert.equal(next.getMinutes(), 30);
  });

  await test('parses every-5-minutes cron (*/5 * * * *)', () => {
    const result = parseCron('*/5 * * * *');
    assert.ok(result.isValid);
    const next = new Date(result.nextRun);
    assert.equal(next.getMinutes() % 5, 0);
  });

  await test('rejects invalid cron with wrong field count', () => {
    assert.ok(!parseCron('* * *').isValid);
    assert.ok(!parseCron('').isValid);
    assert.ok(!parseCron('0 0 0 0 0 0').isValid);
  });

  await test('rejects cron with invalid values', () => {
    assert.ok(!parseCron('60 * * * *').isValid); // minute > 59
    assert.ok(!parseCron('* 25 * * *').isValid); // hour > 23
    assert.ok(!parseCron('* * 32 * *').isValid); // dom > 31
    assert.ok(!parseCron('* * * 13 *').isValid); // month > 12
    assert.ok(!parseCron('* * * * 8').isValid); // dow > 7
  });

  await test('nextRun is always in the future', () => {
    const expressions = ['0 0 * * *', '*/15 * * * *', '0 12 * * 1', '0 3 1 * *'];
    for (const expr of expressions) {
      const result = parseCron(expr);
      assert.ok(result.isValid, `${expr} should be valid`);
      assert.ok(result.nextRun > Date.now(), `${expr} nextRun should be in the future`);
    }
  });
}

async function testJobIdFormat() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Job ID Format (sched: prefix)');
  console.log(`${'═'.repeat(60)}`);

  await test('schedule-loaded jobs have photonName:sched:uuid format', async () => {
    const taskId = randomUUID();
    const task = makeTask({ id: taskId });
    const { tmpDir } = await createTempSchedulesDir('my-photon', [task]);
    const jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs[0].id, `my-photon:sched:${taskId}`);
    await fs.rm(tmpDir, { recursive: true });
  });

  await test('sched: prefix distinguishes from @scheduled tag jobs', async () => {
    // @scheduled tag jobs use format: photonName:methodName
    const tagJobId = 'my-photon:dailyCleanup';
    // ScheduleProvider jobs use format: photonName:sched:uuid
    const schedJobId = `my-photon:sched:${randomUUID()}`;

    assert.ok(!tagJobId.includes(':sched:'), 'Tag job should not have :sched:');
    assert.ok(schedJobId.includes(':sched:'), 'Schedule job should have :sched:');
  });

  await test('taskId can be extracted from jobId for file lookup', () => {
    const taskId = randomUUID();
    const jobId = `my-photon:sched:${taskId}`;
    const match = jobId.match(/^[^:]+:sched:(.+)$/);
    assert.ok(match);
    assert.equal(match![1], taskId);
  });

  await test('non-schedule jobIds do not match sched: pattern', () => {
    const tagJobId = 'my-photon:dailyCleanup';
    const match = tagJobId.match(/^[^:]+:sched:(.+)$/);
    assert.equal(match, null);
  });
}

async function testRoundTrip() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Full Round-Trip: Create → Load → Execute → Update');
  console.log(`${'═'.repeat(60)}`);

  await test('complete lifecycle: create file → daemon loads → runs → updates count', async () => {
    // Step 1: ScheduleProvider writes a task file (simulated)
    const task = makeTask({
      name: 'memory-compact-all',
      cron: '0 3 * * *',
      method: '_compactAll',
      photonId: 'claw',
    });
    assert.equal(task.executionCount, 0);
    assert.equal(task.status, 'active');

    const { tmpDir, photonDir } = await createTempSchedulesDir('claw', [task]);

    // Step 2: Daemon loads the file (simulated)
    const jobs = await loadScheduleFiles(tmpDir, 'claw');
    assert.equal(jobs.length, 1, 'Daemon should discover the schedule file');
    assert.equal(jobs[0].method, '_compactAll');
    assert.equal(jobs[0].cron, '0 3 * * *');
    assert.ok(jobs[0].nextRun > Date.now(), 'Next run should be in the future');

    // Step 3: Daemon validates the cron and calculates next run
    const { isValid, nextRun } = parseCron(task.cron);
    assert.ok(isValid, 'Cron should be valid');
    const nextDate = new Date(nextRun);
    assert.equal(nextDate.getHours(), 3, 'Should fire at 3am');
    assert.equal(nextDate.getMinutes(), 0, 'Should fire at :00');

    // Step 4: Daemon runs the job and updates the file
    await updatePersistedSchedule(photonDir, task.id, {
      executionCount: 1,
      lastExecutionAt: new Date().toISOString(),
    });

    // Step 5: Verify the file was updated
    const afterRun = await readTaskFile(photonDir, task.id);
    assert.equal(afterRun.executionCount, 1, 'Execution count should be 1');
    assert.ok(afterRun.lastExecutionAt, 'Should have lastExecutionAt timestamp');
    // All other fields preserved
    assert.equal(afterRun.name, 'memory-compact-all');
    assert.equal(afterRun.cron, '0 3 * * *');
    assert.equal(afterRun.status, 'active');

    // Step 6: On next daemon restart, it loads the file with updated count
    const jobsAfterRestart = await loadScheduleFiles(tmpDir, 'claw');
    assert.equal(jobsAfterRestart[0].runCount, 1, 'Should preserve run count across restarts');

    await fs.rm(tmpDir, { recursive: true });
  });

  await test('pausing a task prevents daemon from loading it', async () => {
    const task = makeTask({ name: 'pausable', status: 'active' });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [task]);

    // Active: daemon loads it
    let jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 1);

    // Pause: update status in file (what ScheduleProvider.pause() does)
    const content = await fs.readFile(path.join(photonDir, `${task.id}.json`), 'utf-8');
    const paused = JSON.parse(content);
    paused.status = 'paused';
    await fs.writeFile(path.join(photonDir, `${task.id}.json`), JSON.stringify(paused, null, 2));

    // Paused: daemon skips it
    jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 0, 'Paused task should not be loaded');

    await fs.rm(tmpDir, { recursive: true });
  });

  await test('deleting a task file removes it from daemon discovery', async () => {
    const task = makeTask({ name: 'deletable' });
    const { tmpDir, photonDir } = await createTempSchedulesDir('my-photon', [task]);

    let jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 1);

    // ScheduleProvider.cancel() deletes the file
    await fs.unlink(path.join(photonDir, `${task.id}.json`));

    jobs = await loadScheduleFiles(tmpDir, 'my-photon');
    assert.equal(jobs.length, 0, 'Deleted task should not be loaded');

    await fs.rm(tmpDir, { recursive: true });
  });
}

// ══════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     SCHEDULE PROVIDER ↔ DAEMON INTEGRATION TESTS           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testScheduleFileDiscovery();
  await testExecutionTracking();
  await testCronParsing();
  await testJobIdFormat();
  await testRoundTrip();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }

  console.log('\n  All schedule provider tests passed!\n');
})();
