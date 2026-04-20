/**
 * this.schedule baseDir Regression Test
 *
 * Mirrors tests/memory-baseDir-regression.test.ts but for ScheduleProvider.
 *
 * Before the fix: ScheduleProvider resolved its directory via
 * `getPhotonSchedulesDir(ns, photonId)` without a baseDir, falling
 * through to PHOTON_DIR env or ~/.photon. Same symptom as the memory
 * bug — schedules created from a marketplace-aware process wrote to
 * <repo>/.data, but a daemon reading them back from a different cwd
 * looked in ~/.photon/.data and came up empty.
 *
 * After the fix: ScheduleProvider holds a pinned baseDir, passed by the
 * base.ts/mixins.ts memory-and-schedule getters from instance._baseDir.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PhotonLoader } from '../src/loader.js';

const TMP_PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-sched-regression-'));
const WORKING_DIR = path.join(TMP_PARENT, 'workspace');
fs.mkdirSync(path.join(WORKING_DIR, '.marketplace'), { recursive: true });

const PHOTON_NAME = 'sched-regression';
const PHOTON_PATH = path.join(WORKING_DIR, `${PHOTON_NAME}.photon.ts`);
// Route schedule access through a helper so capability detection doesn't
// trigger a loader-level getter injection (there isn't one for schedule
// today, but this mirrors the memory test's escape pattern and makes the
// test resilient to a future injection that might mask the bug).
// ScheduleProvider is only attached to classes that extend Photon base,
// so the fixture must extend it. pickSchedule() keeps the regex-based
// capability scanner blind to this.schedule in case a future loader tries
// to inject a lookalike provider.
fs.writeFileSync(
  PHOTON_PATH,
  `
import { Photon } from '@portel/photon-core';

/**
 * @stateful
 */
export default class SchedRegression extends Photon {
  async start(): Promise<{ id: string }> {
    const s = pickSchedule(this);
    const task = await s.create({
      name: 'daily-cleanup',
      schedule: '0 10 * * *',
      method: 'tick',
    });
    return { id: task.id };
  }
  async list(): Promise<Array<{ id: string; name: string }>> {
    const s = pickSchedule(this);
    const tasks = await s.list();
    return tasks.map((t: any) => ({ id: t.id, name: t.name }));
  }
  async tick(): Promise<{ ok: true }> {
    return { ok: true };
  }
}

function pickSchedule(self: any): any {
  return self['sche' + 'dule'];
}
`,
  'utf-8'
);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ❌ ${name}\n     ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log('\n🧪 Schedule baseDir Regression\n');

  await test('schedule file lands under {workingDir}/.data, not under ~/.photon', async () => {
    const loader = new PhotonLoader(false, undefined, WORKING_DIR);
    const photon = await loader.loadFile(PHOTON_PATH);
    const inst = photon.instance as { start: () => Promise<{ id: string }> };
    const { id } = await inst.start();

    // getPhotonSchedulesDir with namespace='local' resolves to
    // {base}/.data/{photonName}/schedules/ — that's where the file
    // must land, NOT at ~/.photon/.data/...
    const expected = path.join(WORKING_DIR, '.data', PHOTON_NAME, 'schedules', `${id}.json`);
    assert.ok(
      fs.existsSync(expected),
      `expected schedule file at ${expected} — actual contents under ${WORKING_DIR}/.data:\n` +
        listTree(path.join(WORKING_DIR, '.data'))
    );
  });

  await test('schedule created by loader A is listable by loader B with the same workingDir', async () => {
    const writerLoader = new PhotonLoader(false, undefined, WORKING_DIR);
    const writer = await writerLoader.loadFile(PHOTON_PATH);
    const writerInst = writer.instance as {
      start: () => Promise<{ id: string }>;
      list: () => Promise<Array<{ id: string; name: string }>>;
    };
    // Clear any prior schedule for determinism
    const existing = await writerInst.list();
    if (existing.find((t) => t.name === 'daily-cleanup') == null) {
      await writerInst.start();
    }

    const previousCwd = process.cwd();
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-sched-decoy-'));
    process.chdir(decoyDir);
    try {
      const previousEnv = process.env.PHOTON_DIR;
      delete process.env.PHOTON_DIR;
      try {
        const readerLoader = new PhotonLoader(false, undefined, WORKING_DIR);
        const reader = await readerLoader.loadFile(PHOTON_PATH);
        const readerInst = reader.instance as {
          list: () => Promise<Array<{ id: string; name: string }>>;
        };
        const tasks = await readerInst.list();
        const found = tasks.find((t) => t.name === 'daily-cleanup');
        assert.ok(
          found,
          'reader should see the schedule created by writer — drift means baseDir was not pinned'
        );
      } finally {
        if (previousEnv !== undefined) process.env.PHOTON_DIR = previousEnv;
      }
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(decoyDir, { recursive: true, force: true });
    }
  });

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function listTree(root: string, depth = 0): string {
  if (!fs.existsSync(root)) return '(missing)';
  const out: string[] = [];
  const indent = '  '.repeat(depth);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    out.push(`${indent}${entry.name}${entry.isDirectory() ? '/' : ''}`);
    if (entry.isDirectory() && depth < 4) out.push(listTree(child, depth + 1));
  }
  return out.join('\n');
}

void main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
