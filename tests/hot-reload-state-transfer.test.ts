/**
 * Unit tests for `transferHotReloadState` — the helper the daemon uses
 * to copy user-defined state from the old photon instance to the fresh
 * one during hot-reload.
 *
 * Regression: an earlier implementation copied every own property,
 * including the loader-injected `_settingsBacking` / `_settingsSchema`
 * fields. That kept the daemon serving the pre-reload settings shape
 * until a full restart — schema edits simply didn't take effect.
 */

import assert from 'node:assert/strict';
import { transferHotReloadState, LOADER_INJECTED_SKIP } from '../dist/daemon/hot-reload-state.js';

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

async function main() {
  console.log('transferHotReloadState:');

  await test('copies user-defined state (arrays, maps, primitives)', () => {
    const oldInstance: Record<string, unknown> = {
      items: [1, 2, 3],
      counter: 42,
      cache: new Map([['k', 'v']]),
    };
    const newInstance: Record<string, unknown> = { items: [], counter: 0 };
    transferHotReloadState(oldInstance, newInstance);
    assert.deepEqual(newInstance.items, [1, 2, 3]);
    assert.equal(newInstance.counter, 42);
    assert.ok(newInstance.cache instanceof Map);
    assert.equal((newInstance.cache as Map<string, string>).get('k'), 'v');
  });

  await test('skips functions (loader rewires them on new instance)', () => {
    const oldHandler = () => 'old';
    const newHandler = () => 'new';
    const oldInstance: Record<string, unknown> = { _callHandler: oldHandler };
    const newInstance: Record<string, unknown> = { _callHandler: newHandler };
    transferHotReloadState(oldInstance, newInstance);
    assert.equal((newInstance._callHandler as () => string)(), 'new');
  });

  await test('preserves fresh _settingsSchema — does NOT copy old schema', () => {
    // Regression: the previous loop copied _settingsSchema from the old
    // instance, so when a photon's schema changed, the daemon kept
    // serving the OLD settings shape until full restart.
    const oldInstance: Record<string, unknown> = {
      items: [1, 2, 3],
      _settingsSchema: { theme: { type: 'string' } },
      _settingsBacking: { theme: 'dark' },
      _settingsPhotonName: 'foo',
      _settingsInstanceName: 'default',
    };
    const newInstance: Record<string, unknown> = {
      items: [],
      _settingsSchema: { theme: { type: 'string' }, fontSize: { type: 'number' } },
      _settingsBacking: { theme: 'dark', fontSize: 14 },
      _settingsPhotonName: 'foo',
      _settingsInstanceName: 'default',
    };
    transferHotReloadState(oldInstance, newInstance);
    // User state carries over
    assert.deepEqual(newInstance.items, [1, 2, 3]);
    // Schema is the FRESH one with fontSize added
    const schema = newInstance._settingsSchema as Record<string, unknown>;
    assert.ok('fontSize' in schema, 'new schema must survive the transfer');
    // Backing reflects the fresh read from disk
    const backing = newInstance._settingsBacking as Record<string, unknown>;
    assert.equal(backing.fontSize, 14, 'fresh backing must survive the transfer');
  });

  await test('LOADER_INJECTED_SKIP names are exactly the four settings fields', () => {
    assert.ok(LOADER_INJECTED_SKIP.has('_settingsBacking'));
    assert.ok(LOADER_INJECTED_SKIP.has('_settingsSchema'));
    assert.ok(LOADER_INJECTED_SKIP.has('_settingsPhotonName'));
    assert.ok(LOADER_INJECTED_SKIP.has('_settingsInstanceName'));
    assert.equal(LOADER_INJECTED_SKIP.size, 4);
  });

  await test('read-only properties do not abort transfer', () => {
    // Simulates a settings proxy on the new instance that throws on write.
    const newInstance: Record<string, unknown> = { items: [] };
    Object.defineProperty(newInstance, 'settings', {
      get() {
        return { theme: 'new' };
      },
      enumerable: true,
      configurable: false,
    });
    const oldInstance: Record<string, unknown> = {
      items: [7, 8, 9],
      settings: { theme: 'old' },
    };
    // Should NOT throw — the read-only settings write is swallowed.
    transferHotReloadState(oldInstance, newInstance);
    assert.deepEqual(newInstance.items, [7, 8, 9]);
    // Fresh settings proxy still returns new value.
    assert.equal((newInstance.settings as { theme: string }).theme, 'new');
  });

  console.log('\nAll transferHotReloadState tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
