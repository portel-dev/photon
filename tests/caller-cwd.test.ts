/**
 * `this.callerCwd` propagation.
 *
 * The originating CLI cwd is stamped into `_meta.callerCwd` and read back
 * inside the photon as `this.callerCwd`. Inside a daemon worker thread
 * `process.cwd()` is the daemon's cwd, which silently breaks photons that
 * default project paths against `cwd`. The request-context-backed accessor
 * lets photons resolve relative paths against the user's invocation dir
 * regardless of which process actually executes the method.
 *
 * Run: npx tsx tests/caller-cwd.test.ts
 */

import { strict as assert } from 'assert';
import { PhotonLoader } from '../src/loader.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
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

console.log('\n🧪 this.callerCwd propagation\n');

const loader = new PhotonLoader(false);
const photon = await loader.loadFile('./tests/fixtures/caller-cwd.photon.ts');

await test('callerCwd reflects _meta.callerCwd from inbound args', async () => {
  const result = await loader.executeTool(photon, 'whereAmI', {
    _meta: { callerCwd: '/tmp/some/user/dir' },
  });
  assert.equal(result.cwd, '/tmp/some/user/dir');
});

await test('callerCwd falls back to process.cwd() when no _meta', async () => {
  const result = await loader.executeTool(photon, 'whereAmI', {});
  assert.equal(result.cwd, process.cwd());
});

await test('two concurrent calls each see their own callerCwd', async () => {
  const [a, b] = await Promise.all([
    loader.executeTool(photon, 'whereAmI', { _meta: { callerCwd: '/path/a' } }),
    loader.executeTool(photon, 'whereAmI', { _meta: { callerCwd: '/path/b' } }),
  ]);
  // Calls serialize through the per-instance gate, so each sees its own ctx.
  assert.equal(a.cwd, '/path/a');
  assert.equal(b.cwd, '/path/b');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
