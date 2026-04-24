/**
 * Missed-fire detection for scheduled jobs.
 *
 * When the daemon is down across a scheduled firing window, the next boot
 * should detect the missed occurrence and trigger one catch-up run. Only the
 * most recent missed occurrence fires; older ones are intentionally dropped
 * to avoid an invocation flood after a long outage.
 *
 * Run: npx tsx tests/schedule-missed-fire.test.ts
 */

import { strict as assert } from 'assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseCron, computeMissedRun } from '../dist/daemon/cron.js';
import {
  loadPersistedSchedulesFromDir,
  type PersistedScheduleJob,
} from '../dist/daemon/schedule-loader.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`  ❌ ${name}`);
    console.error(`     ${e?.message || e}`);
    failed++;
  }
}

console.log('\n🧪 computeMissedRun (pure cron math)\n');

await test('returns null when lastRunAt is in the future', () => {
  const now = Date.now();
  assert.equal(computeMissedRun('* * * * *', now + 60_000, now), null);
});

await test('returns null when lastRunAt equals now', () => {
  const now = Date.now();
  assert.equal(computeMissedRun('* * * * *', now, now), null);
});

await test('returns null for malformed cron', () => {
  const now = Date.now();
  assert.equal(computeMissedRun('not-a-cron', now - 3_600_000, now), null);
});

await test('returns null when no occurrence falls in the window', () => {
  // 3am daily cron, window is 1pm to 2pm same day: no 3am in that window.
  const base = new Date('2026-06-15T13:00:00');
  const now = new Date('2026-06-15T14:00:00').getTime();
  assert.equal(computeMissedRun('0 3 * * *', base.getTime(), now), null);
});

await test('finds the most recent of several missed occurrences', () => {
  // Every minute cron, lastRun 5 minutes ago, now is :00 seconds of current minute.
  const now = new Date();
  now.setSeconds(0);
  now.setMilliseconds(0);
  const lastRun = now.getTime() - 5 * 60_000;
  const missed = computeMissedRun('* * * * *', lastRun, now.getTime());
  assert.ok(missed !== null, 'expected a missed occurrence');
  // Most recent occurrence at-or-before `now` for `* * * * *` is `now` itself.
  assert.equal(missed, now.getTime(), 'expected most-recent missed to equal now');
});

await test('finds correct hourly occurrence after a gap', () => {
  // Cron fires at minute 0 every hour. lastRun was 3 hours ago at :00.
  // Expect the catch-up to be the most recent :00 before now.
  const now = new Date();
  now.setSeconds(0);
  now.setMilliseconds(0);
  const lastRun = new Date(now);
  lastRun.setHours(lastRun.getHours() - 3);
  lastRun.setMinutes(0);

  const missed = computeMissedRun('0 * * * *', lastRun.getTime(), now.getTime());

  // Expected: the most recent :00 at-or-before now — the current hour's :00
  // (since current hour :00 is always <= now and > lastRun, which was 3
  // hours earlier).
  const expected = new Date(now);
  expected.setMinutes(0);
  expected.setSeconds(0);
  expected.setMilliseconds(0);

  assert.equal(
    missed,
    expected.getTime(),
    `got ${missed ? new Date(missed).toISOString() : 'null'}, expected ${expected.toISOString()}`
  );
});

await test('parseCron still works with explicit fromTime', () => {
  // Snapshot behavior: given a fixed fromTime, nextRun is deterministic.
  const fromTime = new Date('2026-06-15T10:00:00').getTime();
  const { isValid, nextRun } = parseCron('*/5 * * * *', fromTime);
  assert.equal(isValid, true);
  // Next */5 after 10:00 is 10:05.
  assert.equal(new Date(nextRun).toISOString(), new Date('2026-06-15T10:05:00').toISOString());
});

console.log('\n🧪 schedule-loader carries lastRun from lastExecutionAt\n');

const workDir = mkdtempSync(join(tmpdir(), 'photon-sched-missed-'));
const schedulesDir = join(workDir, 'schedules');
mkdirSync(schedulesDir, { recursive: true });

await test('lastExecutionAt is parsed into lastRun on the job object', () => {
  const lastExec = new Date(Date.now() - 3_600_000).toISOString();
  writeFileSync(
    join(schedulesDir, 'task-a.json'),
    JSON.stringify({
      id: 'task-a',
      method: 'cleanup',
      params: {},
      cron: '0 * * * *',
      photonName: 'demo',
      status: 'active',
      createdAt: new Date().toISOString(),
      lastExecutionAt: lastExec,
      executionCount: 3,
    })
  );

  const registered: PersistedScheduleJob[] = [];
  const result = loadPersistedSchedulesFromDir(schedulesDir, 30 * 86_400_000, 'demo', workDir, {
    alreadyRegistered: () => false,
    register: (job) => {
      registered.push(job);
      return true;
    },
  });

  assert.equal(result.loaded, 1);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].lastRun, new Date(lastExec).getTime());
});

await test('lastRun is undefined when no lastExecutionAt has been persisted', () => {
  const freshDir = join(workDir, 'fresh');
  mkdirSync(freshDir, { recursive: true });
  writeFileSync(
    join(freshDir, 'task-b.json'),
    JSON.stringify({
      id: 'task-b',
      method: 'cleanup',
      params: {},
      cron: '0 * * * *',
      photonName: 'demo',
      status: 'active',
      createdAt: new Date().toISOString(),
      executionCount: 0,
    })
  );

  const registered: PersistedScheduleJob[] = [];
  loadPersistedSchedulesFromDir(freshDir, 30 * 86_400_000, 'demo', workDir, {
    alreadyRegistered: () => false,
    register: (job) => {
      registered.push(job);
      return true;
    },
  });

  assert.equal(registered.length, 1);
  assert.equal(registered[0].lastRun, undefined);
});

// Cleanup
try {
  rmSync(workDir, { recursive: true, force: true });
} catch {
  // ignore
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
