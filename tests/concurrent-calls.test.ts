/**
 * Per-instance call serialization.
 *
 * Two tool invocations targeting the same photon instance must not interleave
 * their await points. Without the queue, concurrent `increment` calls lose
 * updates (both read 0, both write 1). With the queue, calls run end-to-end
 * in sequence (read 0 → write 1 → read 1 → write 2).
 *
 * Run: npx tsx tests/concurrent-calls.test.ts
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

console.log('\n🧪 Per-instance call serialization\n');

const loader = new PhotonLoader(false);
const photon = await loader.loadFile('./tests/fixtures/concurrent-calls.photon.ts');

await test('two concurrent increments produce counter=2 (no lost update)', async () => {
  const [a, b] = await Promise.all([
    loader.executeTool(photon, 'increment', { label: 'a' }),
    loader.executeTool(photon, 'increment', { label: 'b' }),
  ]);

  const counters = [a.counter, b.counter].sort();
  assert.deepEqual(counters, [1, 2], `expected {1,2}, got {${counters.join(',')}}`);
});

await test('timeline shows end-to-end ordering (no start/start/end/end)', async () => {
  const result = await loader.executeTool(photon, 'getTimeline', {});
  const tl: string[] = result.timeline;

  // First two entries should be a start then its end (not two starts in a row).
  const starts = tl.filter((s) => s.startsWith('start:'));
  const ends = tl.filter((s) => s.startsWith('end:'));
  assert.equal(starts.length, 2, 'expected exactly 2 start entries');
  assert.equal(ends.length, 2, 'expected exactly 2 end entries');

  for (let i = 0; i < tl.length - 1; i++) {
    if (tl[i].startsWith('start:')) {
      assert.ok(tl[i + 1].startsWith('end:'), `interleaved timeline: ${tl.join(' | ')}`);
    }
  }

  assert.equal(result.counter, 2, 'final counter should be 2');
});

await test('many concurrent calls all apply (no lost updates under contention)', async () => {
  const fresh = await loader.loadFile('./tests/fixtures/concurrent-calls.photon.ts');
  const N = 20;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => loader.executeTool(fresh, 'increment', { label: `c${i}` }))
  );
  const max = Math.max(...results.map((r: any) => r.counter));
  assert.equal(max, N, `expected max counter=${N}, got ${max}`);

  const seen = new Set(results.map((r: any) => r.counter));
  assert.equal(seen.size, N, `expected ${N} distinct counter values, got ${seen.size}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
