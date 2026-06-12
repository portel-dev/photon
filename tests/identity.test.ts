/**
 * Unit tests for src/shared/identity.ts — the single owner of photon
 * identity string parsing. The rule under test: method/topic segments
 * never contain colons, the photon part may. So ps targets parse from
 * the LAST colon, channels from the FIRST.
 */

import assert from 'node:assert/strict';
import {
  parsePsTarget,
  parseChannel,
  qualifyChannel,
  circuitKey,
  instanceCacheKey,
  preloadedCacheKey,
} from '../dist/shared/identity.js';
import { photonFromCompositeKey } from '../dist/daemon/registry-keys.js';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

console.log('\nphoton identity module:\n');

check('parsePsTarget: plain photon:method', () => {
  assert.deepEqual(parsePsTarget('kith-sync:scheduled_sync'), {
    photon: 'kith-sync',
    method: 'scheduled_sync',
  });
});

check('parsePsTarget: instance-qualified id keeps hash on the photon (last colon)', () => {
  assert.deepEqual(parsePsTarget('kith-sync:7780a2a6:scheduled_freshness_scan'), {
    photon: 'kith-sync:7780a2a6',
    method: 'scheduled_freshness_scan',
  });
});

check('parsePsTarget: rejects bare name, leading and trailing colon', () => {
  assert.throws(() => parsePsTarget('kith-sync'));
  assert.throws(() => parsePsTarget(':method'));
  assert.throws(() => parsePsTarget('photon:'));
});

check('parseChannel: photon:topic splits on FIRST colon', () => {
  assert.deepEqual(parseChannel('boards:item-42'), { photon: 'boards', topic: 'item-42' });
});

check('parseChannel: topic keeps its own colons', () => {
  assert.deepEqual(parseChannel('boards:item:42'), { photon: 'boards', topic: 'item:42' });
});

check('parseChannel: wildcard topic', () => {
  assert.deepEqual(parseChannel('boards:*'), { photon: 'boards', topic: '*' });
});

check('parseChannel: unqualified name returns null', () => {
  assert.equal(parseChannel('boards'), null);
  assert.equal(parseChannel(':topic'), null);
  assert.equal(parseChannel('boards:'), null);
});

check('qualifyChannel: prefixes unqualified, passes qualified through', () => {
  assert.equal(qualifyChannel('boards', 'updates'), 'boards:updates');
  assert.equal(qualifyChannel('boards', 'other:updates'), 'other:updates');
});

check('circuitKey shape is stable', () => {
  assert.equal(circuitKey('boards', 'default', 'add'), 'boards:default:add');
});

check('cache keys: :: separator only with an instance', () => {
  assert.equal(instanceCacheKey('/a/b.photon.ts'), '/a/b.photon.ts');
  assert.equal(instanceCacheKey('/a/b.photon.ts', 'x'), '/a/b.photon.ts::x');
  assert.equal(preloadedCacheKey('boards'), 'preloaded:boards');
  assert.equal(preloadedCacheKey('boards', 'x'), 'preloaded:boards::x');
});

check('photonFromCompositeKey inverts compositeKey for both shapes', () => {
  assert.equal(photonFromCompositeKey('boards'), 'boards');
  assert.equal(photonFromCompositeKey('boards:7780a2a6'), 'boards');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
