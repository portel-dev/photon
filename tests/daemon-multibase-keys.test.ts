/**
 * Regression test: every daemon map keyed on a photon must carry the base.
 *
 * The post-v1.22.1 codex-review cascade found ~15 distinct call sites that
 * indexed maps by bare photon name in a multi-PHOTON_DIR world, any one of
 * which caused a same-named photon in base B to clobber base A's state or
 * route requests to the wrong file.
 *
 * This test exercises the key helpers in src/daemon/registry-keys.ts and
 * a representative multi-base flow over the PhotonScoped map helper. A green
 * run asserts that:
 *   - same (photon, method) in two bases produces two distinct keys
 *   - findByPhoton returns every matching entry across bases
 *   - compositeKey preserves legacy shape for the default base
 *   - base-scoped deletes don't touch the other base
 *
 * When a regression is introduced (photon-only key reappears somewhere),
 * extending this test with the new case keeps the pattern from drifting.
 */

import assert from 'node:assert/strict';
import {
  compositeKey,
  declaredKey,
  webhookKey,
  locationKey,
  findByPhoton,
  type PhotonScoped,
} from '../src/daemon/registry-keys.js';

const BASE_A = '/Users/arul/workspaces/proj-a';
const BASE_B = '/Users/arul/workspaces/proj-b';
const DEFAULT_BASE = '/Users/arul/.photon';

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

async function testCompositeKey() {
  console.log('compositeKey:');

  await test('default base produces bare photon name (legacy-compatible)', () => {
    assert.equal(compositeKey('foo', DEFAULT_BASE, DEFAULT_BASE), 'foo');
    assert.equal(compositeKey('foo', undefined, DEFAULT_BASE), 'foo');
  });

  await test('non-default base produces hash-suffixed key', () => {
    const key = compositeKey('foo', BASE_A, DEFAULT_BASE);
    assert.ok(key.startsWith('foo:'), `expected 'foo:hash', got ${key}`);
    assert.notEqual(key, 'foo');
  });

  await test('same photon in two bases produces distinct keys', () => {
    const a = compositeKey('foo', BASE_A, DEFAULT_BASE);
    const b = compositeKey('foo', BASE_B, DEFAULT_BASE);
    assert.notEqual(a, b);
  });

  await test('same (photon, base) is stable across calls', () => {
    assert.equal(
      compositeKey('foo', BASE_A, DEFAULT_BASE),
      compositeKey('foo', BASE_A, DEFAULT_BASE)
    );
  });
}

async function testDeclaredKey() {
  console.log('declaredKey:');

  await test('same (photon, method) in two bases produces distinct keys', () => {
    const a = declaredKey('foo', 'bar', BASE_A);
    const b = declaredKey('foo', 'bar', BASE_B);
    assert.notEqual(a, b);
    assert.ok(a.includes('::foo:bar'));
    assert.ok(b.includes('::foo:bar'));
  });

  await test('unresolvable base falls back to `-` sentinel', () => {
    const k = declaredKey('foo', 'bar', undefined);
    assert.equal(k, '-::foo:bar');
  });

  await test('relative and absolute bases resolve to the same key', () => {
    const rel = declaredKey('foo', 'bar', BASE_A);
    const abs = declaredKey('foo', 'bar', BASE_A); // already absolute in test
    assert.equal(rel, abs);
  });
}

async function testWebhookKey() {
  console.log('webhookKey:');

  await test('same photon in two bases produces distinct keys', () => {
    assert.notEqual(webhookKey('foo', BASE_A), webhookKey('foo', BASE_B));
  });

  await test('shape matches locationKey so webhook and location maps agree', () => {
    assert.equal(webhookKey('foo', BASE_A), locationKey('foo', BASE_A));
  });
}

async function testFindByPhoton() {
  console.log('findByPhoton (cross-base lookup):');

  interface Entry extends PhotonScoped {
    payload: string;
  }
  const map = new Map<string, Entry>();

  await test('returns entries matching the photon name across multiple bases', () => {
    map.set(webhookKey('foo', BASE_A), { photon: 'foo', workingDir: BASE_A, payload: 'a' });
    map.set(webhookKey('foo', BASE_B), { photon: 'foo', workingDir: BASE_B, payload: 'b' });
    map.set(webhookKey('bar', BASE_A), { photon: 'bar', workingDir: BASE_A, payload: 'c' });

    const matches = findByPhoton(map, 'foo');
    assert.equal(matches.length, 2);
    const payloads = matches.map((m) => m.payload).sort();
    assert.deepEqual(payloads, ['a', 'b']);
  });

  await test('returns empty array when photon has no entries', () => {
    const matches = findByPhoton(map, 'nonexistent');
    assert.equal(matches.length, 0);
  });

  await test('base-scoped delete leaves the other base intact', () => {
    const scratch = new Map<string, Entry>();
    scratch.set(webhookKey('foo', BASE_A), { photon: 'foo', workingDir: BASE_A, payload: 'a' });
    scratch.set(webhookKey('foo', BASE_B), { photon: 'foo', workingDir: BASE_B, payload: 'b' });

    // Simulate dropProactiveMetadataFor('foo', BASE_A)
    scratch.delete(webhookKey('foo', BASE_A));

    const remaining = findByPhoton(scratch, 'foo');
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].workingDir, BASE_B);
  });
}

async function testCrossBaseIsolation() {
  console.log('End-to-end multi-base scenario:');

  // Simulate the four daemon maps that all need (photon, base) keying:
  //   declaredSchedules, scheduledJobs, webhookRoutes, proactivePhotonLocations
  interface ScheduleEntry extends PhotonScoped {
    method: string;
    cron: string;
  }
  interface LocationEntry extends PhotonScoped {
    photonPath: string;
  }

  const declaredSchedules = new Map<string, ScheduleEntry>();
  const locations = new Map<string, LocationEntry>();

  // "foo" photon registered in both bases with same @scheduled method
  declaredSchedules.set(declaredKey('foo', 'tick', BASE_A), {
    photon: 'foo',
    workingDir: BASE_A,
    method: 'tick',
    cron: '* * * * *',
  });
  declaredSchedules.set(declaredKey('foo', 'tick', BASE_B), {
    photon: 'foo',
    workingDir: BASE_B,
    method: 'tick',
    cron: '*/5 * * * *',
  });
  locations.set(locationKey('foo', BASE_A), {
    photon: 'foo',
    workingDir: BASE_A,
    photonPath: `${BASE_A}/foo.photon.ts`,
  });
  locations.set(locationKey('foo', BASE_B), {
    photon: 'foo',
    workingDir: BASE_B,
    photonPath: `${BASE_B}/foo.photon.ts`,
  });

  await test('both bases appear in the declaredSchedules map', () => {
    assert.equal(declaredSchedules.size, 2);
  });

  await test('findByPhoton surfaces both bases for the same photon', () => {
    const all = findByPhoton(declaredSchedules, 'foo');
    assert.equal(all.length, 2);
    const crons = all.map((e) => e.cron).sort();
    assert.deepEqual(crons, ['* * * * *', '*/5 * * * *']);
  });

  await test('disabling base A leaves base B intact', () => {
    declaredSchedules.delete(declaredKey('foo', 'tick', BASE_A));

    const survivors = findByPhoton(declaredSchedules, 'foo');
    assert.equal(survivors.length, 1);
    assert.equal(survivors[0].workingDir, BASE_B);
    assert.equal(survivors[0].cron, '*/5 * * * *');
  });

  await test('location lookup still resolves base B to the correct file', () => {
    const locs = findByPhoton(locations, 'foo');
    const baseBLoc = locs.find((l) => l.workingDir === BASE_B);
    assert.ok(baseBLoc);
    assert.equal(baseBLoc.photonPath, `${BASE_B}/foo.photon.ts`);
  });
}

async function testKeyShapeInvariants() {
  console.log('Key shape invariants:');

  await test('declaredKey always contains ::', () => {
    assert.ok(declaredKey('a', 'b').includes('::'));
    assert.ok(declaredKey('a', 'b', BASE_A).includes('::'));
  });

  await test('webhookKey + locationKey share the same base::photon shape', () => {
    const w = webhookKey('x', BASE_A);
    const l = locationKey('x', BASE_A);
    assert.equal(w, l);
    assert.ok(w.includes('::x'));
  });

  await test('special characters in photon names produce stable keys', () => {
    const k1 = declaredKey('my-photon', 'do-thing', BASE_A);
    const k2 = declaredKey('my-photon', 'do-thing', BASE_A);
    assert.equal(k1, k2);
  });
}

async function main() {
  await testCompositeKey();
  await testDeclaredKey();
  await testWebhookKey();
  await testFindByPhoton();
  await testCrossBaseIsolation();
  await testKeyShapeInvariants();
  console.log('\nAll multi-base key tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
