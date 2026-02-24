/**
 * Tests for async discipline primitives: LoadingGate and DedupMap
 */

import assert from 'node:assert/strict';
import { LoadingGate, DedupMap } from '../src/async/index.js';

async function testLoadingGate() {
  console.log('🧪 LoadingGate tests...\n');

  // Basic: runs init once
  {
    let callCount = 0;
    const gate = new LoadingGate<number>();
    const result = await gate.ensure(async () => {
      callCount++;
      return 42;
    });
    assert.equal(result, 42);
    assert.equal(callCount, 1);

    // Second call returns cached value without calling init again
    const result2 = await gate.ensure(async () => {
      callCount++;
      return 99;
    });
    assert.equal(result2, 42);
    assert.equal(callCount, 1);
    assert(gate.isReady);
    console.log('  ✅ Basic single init');
  }

  // Concurrent: multiple callers coalesce into one init
  {
    let callCount = 0;
    const gate = new LoadingGate<string>();
    const results = await Promise.all([
      gate.ensure(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return 'hello';
      }),
      gate.ensure(async () => {
        callCount++;
        return 'world';
      }),
      gate.ensure(async () => {
        callCount++;
        return 'foo';
      }),
    ]);
    assert.equal(callCount, 1, 'Init should run exactly once');
    assert.deepEqual(results, ['hello', 'hello', 'hello']);
    console.log('  ✅ Concurrent callers coalesce');
  }

  // Failure: allows retry
  {
    let attempt = 0;
    const gate = new LoadingGate<string>();

    try {
      await gate.ensure(async () => {
        attempt++;
        throw new Error('fail');
      });
      assert.fail('Should have thrown');
    } catch (e: any) {
      assert.equal(e.message, 'fail');
    }
    assert(!gate.isReady);

    // Retry succeeds
    const result = await gate.ensure(async () => {
      attempt++;
      return 'recovered';
    });
    assert.equal(result, 'recovered');
    assert.equal(attempt, 2);
    assert(gate.isReady);
    console.log('  ✅ Retry after failure');
  }

  // Reset: allows re-init
  {
    const gate = new LoadingGate<number>();
    await gate.ensure(async () => 1);
    assert(gate.isReady);

    gate.reset();
    assert(!gate.isReady);

    const result = await gate.ensure(async () => 2);
    assert.equal(result, 2);
    console.log('  ✅ Reset allows re-init');
  }
}

async function testDedupMap() {
  console.log('\n🧪 DedupMap tests...\n');

  // Basic: creates and caches
  {
    const map = new DedupMap<string, number>();
    const result = await map.getOrCreate('a', async () => 42);
    assert.equal(result, 42);
    assert.equal(map.size, 1);
    assert(map.has('a'));
    assert.equal(map.get('a'), 42);
    console.log('  ✅ Basic create and cache');
  }

  // Concurrent: deduplicates factory calls
  {
    let factoryCalls = 0;
    const map = new DedupMap<string, string>();

    const results = await Promise.all([
      map.getOrCreate('key', async () => {
        factoryCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return 'value';
      }),
      map.getOrCreate('key', async () => {
        factoryCalls++;
        return 'other';
      }),
      map.getOrCreate('key', async () => {
        factoryCalls++;
        return 'another';
      }),
    ]);

    assert.equal(factoryCalls, 1, 'Factory should run exactly once');
    assert.deepEqual(results, ['value', 'value', 'value']);
    console.log('  ✅ Concurrent getOrCreate deduplicates');
  }

  // Different keys: independent factories
  {
    let calls = 0;
    const map = new DedupMap<string, number>();

    await Promise.all([
      map.getOrCreate('a', async () => {
        calls++;
        return 1;
      }),
      map.getOrCreate('b', async () => {
        calls++;
        return 2;
      }),
    ]);

    assert.equal(calls, 2);
    assert.equal(map.get('a'), 1);
    assert.equal(map.get('b'), 2);
    console.log('  ✅ Different keys run independently');
  }

  // Factory failure: cleans up, allows retry
  {
    let attempt = 0;
    const map = new DedupMap<string, string>();

    try {
      await map.getOrCreate('x', async () => {
        attempt++;
        throw new Error('boom');
      });
      assert.fail('Should have thrown');
    } catch (e: any) {
      assert.equal(e.message, 'boom');
    }

    assert(!map.has('x'));

    // Retry succeeds
    const result = await map.getOrCreate('x', async () => {
      attempt++;
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(attempt, 2);
    console.log('  ✅ Factory failure allows retry');
  }

  // set() bypasses factory
  {
    const map = new DedupMap<string, number>();
    map.set('direct', 99);
    assert.equal(map.get('direct'), 99);

    const result = await map.getOrCreate('direct', async () => 0);
    assert.equal(result, 99, 'Should use existing value, not factory');
    console.log('  ✅ Direct set() works');
  }

  // Snapshot iteration (safe across await)
  {
    const map = new DedupMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    const entries = map.entries();
    assert.equal(entries.length, 3);

    const keys = map.keys();
    assert.deepEqual(keys, ['a', 'b', 'c']);

    const values = map.values();
    assert.deepEqual(values, [1, 2, 3]);
    console.log('  ✅ Snapshot iteration');
  }

  // delete and clear
  {
    const map = new DedupMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);

    assert(map.delete('a'));
    assert.equal(map.size, 1);
    assert(!map.has('a'));

    map.clear();
    assert.equal(map.size, 0);
    console.log('  ✅ Delete and clear');
  }
}

// Run all tests
(async () => {
  try {
    await testLoadingGate();
    await testDedupMap();
    console.log('\n✅ All async primitive tests passed!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
})();
