/**
 * this.memory baseDir Regression Test
 *
 * Reproduces the cross-process drift the kith developer hit on 1.22.0:
 * a photon that wrote memory under one process's resolved baseDir would
 * read empty from another process whose cwd resolved differently.
 *
 * Root cause was photon-core's base.ts memory getter constructing
 * MemoryProvider without baseDir. Fix: loader pins instance._baseDir,
 * memory getter passes it through.
 *
 * What this test pins down:
 *   1. After loader.loadFile(path), instance._baseDir === loader.baseDir.
 *   2. Memory writes from process A and reads from process B (different
 *      cwd, both passing the same workingDir to PhotonLoader) resolve to
 *      the same .data path.
 *   3. The .data path lives under the workingDir, not under the cwd or
 *      ~/.photon, regardless of who reads.
 *
 * If this test fails, the symptom in production is "writes go to <repo>,
 * reads return null after daemon restart."
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PhotonLoader } from '../src/loader.js';

const TMP_PARENT = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-mem-regression-'));
const WORKING_DIR = path.join(TMP_PARENT, 'workspace');
fs.mkdirSync(path.join(WORKING_DIR, '.marketplace'), { recursive: true });

const PHOTON_NAME = 'mem-regression';
const PHOTON_PATH = path.join(WORKING_DIR, `${PHOTON_NAME}.photon.ts`);
// Photon source that ROUTES memory access through a helper, so the
// `/this\.memory\b/` capability-detection regex MISSES and the photon
// falls back to the base-class lazy getter — the exact path that
// silently dropped baseDir before this fix. If we wrote the obvious
// `this.memory.set(...)`, the loader would inject a baseDir-aware
// MemoryProvider regardless and we'd never exercise the bug.
fs.writeFileSync(
  PHOTON_PATH,
  `
/**
 * Stateful photon that hides this.memory behind a helper so capability
 * detection doesn't see it. Forces the base.ts memory getter path.
 * @stateful
 */
export default class MemRegression {
  async write({ value }: { value: string }): Promise<{ ok: true }> {
    const m = pickMemory(this);
    await m.set('s', { value });
    return { ok: true };
  }
  async read(): Promise<{ value: string } | null> {
    const m = pickMemory(this);
    return await m.get<{ value: string }>('s');
  }
}

function pickMemory(self: any): any {
  return self['memo' + 'ry'];
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
  console.log('\n🧪 Memory baseDir Regression\n');

  // ── 1. Loader pins _baseDir on the instance ───────────────────

  await test('loader sets instance._baseDir = loader.baseDir', async () => {
    const loader = new PhotonLoader(false, undefined, WORKING_DIR);
    const photon = await loader.loadFile(PHOTON_PATH);
    assert.equal(
      (photon.instance as { _baseDir?: string })._baseDir,
      WORKING_DIR,
      'instance._baseDir should match the workingDir the loader was given'
    );
  });

  // ── 2. Cross-process consistency ──────────────────────────────
  // Simulate two processes by creating two PhotonLoader instances. The
  // second one runs from a different cwd to mimic a daemon restart from
  // an unrelated directory; both pass the same workingDir explicitly.

  await test('write from loader A is read by loader B with the same workingDir', async () => {
    const writerLoader = new PhotonLoader(false, undefined, WORKING_DIR);
    const writer = await writerLoader.loadFile(PHOTON_PATH);

    // Drop any earlier value so re-runs are deterministic
    const writerInstance = writer.instance as { write: (a: { value: string }) => Promise<unknown> };
    await writerInstance.write({ value: 'persisted-via-loader-A' });

    // Switch cwd to somewhere that has no .marketplace marker, mimicking
    // a daemon process whose cwd doesn't carry the workspace context.
    const previousCwd = process.cwd();
    const decoyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-mem-decoy-'));
    process.chdir(decoyDir);
    try {
      // Force getDefaultContext() to recompute by clearing PHOTON_DIR.
      const previousEnv = process.env.PHOTON_DIR;
      delete process.env.PHOTON_DIR;
      try {
        const readerLoader = new PhotonLoader(false, undefined, WORKING_DIR);
        const reader = await readerLoader.loadFile(PHOTON_PATH);
        const readerInstance = reader.instance as {
          read: () => Promise<{ value: string } | null>;
        };
        const got = await readerInstance.read();
        assert.deepEqual(
          got,
          { value: 'persisted-via-loader-A' },
          'reader should see what writer wrote — drift means baseDir was not pinned'
        );
      } finally {
        if (previousEnv !== undefined) process.env.PHOTON_DIR = previousEnv;
      }
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(decoyDir, { recursive: true, force: true });
    }
  });

  // ── 3. The data file actually lives under the workingDir ──────

  await test('memory file lands under {workingDir}/.data, not under ~/.photon', async () => {
    const loader = new PhotonLoader(false, undefined, WORKING_DIR);
    const photon = await loader.loadFile(PHOTON_PATH);
    const inst = photon.instance as { write: (a: { value: string }) => Promise<unknown> };
    await inst.write({ value: 'on-disk-check' });

    // Photon loader derives namespace from the photon's file position;
    // for our fixture under WORKING_DIR (with .marketplace marker, no
    // owner subdir) the namespace is 'local' so the file lands at
    // {workingDir}/.data/{photonName}/memory/s.json.
    const expected = path.join(WORKING_DIR, '.data', PHOTON_NAME, 'memory', 's.json');
    assert.ok(
      fs.existsSync(expected),
      `expected memory file at ${expected} — actual contents under ${WORKING_DIR}/.data:\n` +
        listTree(path.join(WORKING_DIR, '.data'))
    );
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
