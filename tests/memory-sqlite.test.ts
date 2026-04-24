/**
 * SqliteMemoryBackend: contract tests against the MemoryBackend interface.
 *
 * The backend is exercised directly (not through a photon), so the tests
 * focus on get/set/delete/has/keys/clear/update/list semantics and on
 * correctness under concurrent update() contention on the same key.
 *
 * Run: npx tsx tests/memory-sqlite.test.ts
 */

import { strict as assert } from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteMemoryBackend } from '../dist/shared/memory-sqlite.js';

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

const workDir = mkdtempSync(join(tmpdir(), 'photon-memory-sqlite-'));
const ns1 = join(workDir, 'ns1');
const ns2 = join(workDir, 'ns2');

console.log('\n🧪 SqliteMemoryBackend contract\n');

const backend = new SqliteMemoryBackend();

await test('set + get round-trips a value', async () => {
  await backend.set(ns1, 'foo', { hello: 'world', count: 42 });
  const got = await backend.get(ns1, 'foo');
  assert.deepEqual(got, { hello: 'world', count: 42 });
});

await test('get returns null for a missing key', async () => {
  const got = await backend.get(ns1, 'nope');
  assert.equal(got, null);
});

await test('has is true for existing, false for missing', async () => {
  assert.equal(await backend.has(ns1, 'foo'), true);
  assert.equal(await backend.has(ns1, 'nope'), false);
});

await test('set overwrites existing value', async () => {
  await backend.set(ns1, 'foo', { v: 2 });
  const got = await backend.get(ns1, 'foo');
  assert.deepEqual(got, { v: 2 });
});

await test('delete removes and reports change', async () => {
  await backend.set(ns1, 'tmp', 1);
  assert.equal(await backend.delete(ns1, 'tmp'), true);
  assert.equal(await backend.delete(ns1, 'tmp'), false);
  assert.equal(await backend.get(ns1, 'tmp'), null);
});

await test('keys lists all keys in the namespace', async () => {
  await backend.set(ns1, 'a', 1);
  await backend.set(ns1, 'b', 2);
  await backend.set(ns1, 'c', 3);
  const keys = await backend.keys(ns1);
  assert.deepEqual(keys.slice().sort(), ['a', 'b', 'c', 'foo'].sort());
});

await test('namespaces are isolated', async () => {
  await backend.set(ns2, 'a', 'from-ns2');
  assert.equal(await backend.get(ns2, 'a'), 'from-ns2');
  assert.equal(await backend.get(ns1, 'a'), 1);
});

await test('list with prefix filters keys', async () => {
  await backend.set(ns1, 'user:1', { name: 'alice' });
  await backend.set(ns1, 'user:2', { name: 'bob' });
  await backend.set(ns1, 'post:1', { title: 'hi' });
  const users = await backend.list(ns1, 'user:');
  assert.equal(users.length, 2);
  assert.deepEqual(users.map((u) => u.key).sort(), ['user:1', 'user:2']);
});

await test('list with no prefix returns everything', async () => {
  const all = await backend.list(ns1);
  assert.ok(all.length >= 5);
});

await test('update applies updater atomically', async () => {
  await backend.set(ns1, 'counter', 0);
  const result = await backend.update(ns1, 'counter', (c: number | null) => (c ?? 0) + 1);
  assert.equal(result, 1);
  assert.equal(await backend.get(ns1, 'counter'), 1);
});

await test('update serializes concurrent writers (no lost updates)', async () => {
  await backend.set(ns1, 'race', 0);
  const N = 50;
  await Promise.all(
    Array.from({ length: N }, () => backend.update(ns1, 'race', (c: number | null) => (c ?? 0) + 1))
  );
  assert.equal(await backend.get(ns1, 'race'), N);
});

await test('clear wipes the namespace', async () => {
  await backend.clear(ns2);
  assert.deepEqual(await backend.keys(ns2), []);
  // Other namespace untouched
  assert.ok((await backend.keys(ns1)).length > 0);
});

await test('list with LIKE-special prefix treats chars literally', async () => {
  await backend.set(ns1, 'x%y', 'percent');
  await backend.set(ns1, 'xay', 'letter a');
  const hits = await backend.list(ns1, 'x%');
  assert.equal(
    hits.length,
    1,
    `expected only literal x% match, got ${JSON.stringify(hits.map((h) => h.key))}`
  );
  assert.equal(hits[0].key, 'x%y');
});

await test('data persists across backend instances (same file)', async () => {
  await backend.set(ns1, 'persisted', { v: 'hello' });
  await backend.close();

  const reopened = new SqliteMemoryBackend();
  const got = await reopened.get(ns1, 'persisted');
  assert.deepEqual(got, { v: 'hello' });
  await reopened.close();
});

// Cleanup
try {
  rmSync(workDir, { recursive: true, force: true });
} catch {
  // ignore
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
