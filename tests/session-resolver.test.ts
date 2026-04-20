/**
 * Regression tests for `resolveWithGlobalFallback`.
 *
 * Named bug (Apr 20): `this.call('lookout.ensure_browser')` from inside
 * kith-sync (installed in marketplace `/workspace/kith/`) failed because
 * the daemon looked up lookout under `compositeKey('lookout', kithBase)`
 * and missed — lookout was only registered globally, under
 * `compositeKey('lookout', undefined)`.
 *
 * The regression was introduced by `da19f05` (sessionManagers keyed by
 * (photon, base)). Before that commit `sessionManagers.get('lookout')`
 * always found it; after, cross-marketplace calls to globally-installed
 * peers broke. This helper restores the CLI's resolution semantics
 * (marketplace first, then `~/.photon`) to the daemon dispatch path.
 */

import assert from 'node:assert/strict';
import { resolveWithGlobalFallback } from '../dist/daemon/session-resolver.js';
import { compositeKey, type PhotonCompositeKey } from '../dist/daemon/registry-keys.js';

async function test(name: string, fn: () => void): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

const HOME = '/home/user/.photon';
const KITH = '/workspace/kith';
const FORPROFIT = '/workspace/for-profit';

async function main() {
  console.log('resolveWithGlobalFallback:');

  await test('returns local match when peer lives in caller marketplace', () => {
    const map = new Map<PhotonCompositeKey, string>();
    map.set(compositeKey('lookout', KITH, HOME), 'kith-lookout-manager');
    const result = resolveWithGlobalFallback('lookout', KITH, HOME, (k) => map.get(k));
    assert.ok(result, 'must resolve');
    assert.equal(result.value, 'kith-lookout-manager');
  });

  await test('falls back to global when peer only exists in ~/.photon', () => {
    // The exact shape of the kith-sync → lookout regression.
    const map = new Map<PhotonCompositeKey, string>();
    map.set(compositeKey('lookout', undefined, HOME), 'global-lookout-manager');
    const result = resolveWithGlobalFallback('lookout', KITH, HOME, (k) => map.get(k));
    assert.ok(result, 'global fallback must resolve');
    assert.equal(result.value, 'global-lookout-manager');
    assert.equal(result.key, compositeKey('lookout', undefined, HOME));
  });

  await test('local shadows global when both exist', () => {
    const map = new Map<PhotonCompositeKey, string>();
    map.set(compositeKey('lookout', undefined, HOME), 'global');
    map.set(compositeKey('lookout', KITH, HOME), 'kith-local');
    const result = resolveWithGlobalFallback('lookout', KITH, HOME, (k) => map.get(k));
    assert.equal(result?.value, 'kith-local');
  });

  await test('returns null when peer lives in a different marketplace', () => {
    // lookout registered only in for-profit; kith caller must NOT reach it.
    const map = new Map<PhotonCompositeKey, string>();
    map.set(compositeKey('lookout', FORPROFIT, HOME), 'for-profit-lookout');
    const result = resolveWithGlobalFallback('lookout', KITH, HOME, (k) => map.get(k));
    assert.equal(result, null, 'must not leak between sibling marketplaces');
  });

  await test('returns null when peer is not registered anywhere', () => {
    const map = new Map<PhotonCompositeKey, string>();
    const result = resolveWithGlobalFallback('ghost', KITH, HOME, (k) => map.get(k));
    assert.equal(result, null);
  });

  await test('global caller (workingDir undefined) does not re-walk', () => {
    // When the caller is already global, the fallback branch must not run
    // — local lookup = global lookup.
    const map = new Map<PhotonCompositeKey, string>();
    map.set(compositeKey('lookout', undefined, HOME), 'global');
    const result = resolveWithGlobalFallback('lookout', undefined, HOME, (k) => map.get(k));
    assert.equal(result?.value, 'global');
  });

  await test('caller at default base resolves as global without fallback', () => {
    // workingDir === HOME means the composite key IS the global key,
    // compositeKey returns the bare photon name for both. No extra walk.
    const map = new Map<PhotonCompositeKey, string>();
    map.set(compositeKey('lookout', undefined, HOME), 'global');
    const result = resolveWithGlobalFallback('lookout', HOME, HOME, (k) => map.get(k));
    assert.equal(result?.value, 'global');
  });

  console.log('\nAll resolveWithGlobalFallback tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
