/**
 * Async Primitives Tests
 *
 * Tests for DedupMap, LoadingGate, and withTimeout — the three async
 * building blocks used throughout the daemon and loader infrastructure.
 *
 * These primitives prevent duplicate work, coordinate initialization,
 * and enforce timeouts. Bugs here cause subtle concurrency issues.
 */

import assert from 'node:assert/strict';
import { LoadingGate, DedupMap } from '../src/async/index.js';
import { withTimeout } from '../src/async/with-timeout.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ══════════════════════════════════════════════════════════════════════
// LoadingGate
// ══════════════════════════════════════════════════════════════════════

async function testLoadingGate() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  LoadingGate');
  console.log(`${'═'.repeat(60)}`);

  await test('starts not ready', () => {
    const gate = new LoadingGate();
    assert.equal(gate.isReady, false);
  });

  await test('runs init once and caches result', async () => {
    let callCount = 0;
    const gate = new LoadingGate<number>();
    const result = await gate.ensure(async () => {
      callCount++;
      return 42;
    });
    assert.equal(result, 42);
    assert.equal(callCount, 1);

    const result2 = await gate.ensure(async () => {
      callCount++;
      return 99;
    });
    assert.equal(result2, 42);
    assert.equal(callCount, 1);
    assert(gate.isReady);
  });

  await test('concurrent callers coalesce into one init', async () => {
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
  });

  await test('failure allows retry', async () => {
    let attempt = 0;
    const gate = new LoadingGate<string>();

    await assert.rejects(
      () =>
        gate.ensure(async () => {
          attempt++;
          throw new Error('fail');
        }),
      /fail/
    );
    assert(!gate.isReady);

    const result = await gate.ensure(async () => {
      attempt++;
      return 'recovered';
    });
    assert.equal(result, 'recovered');
    assert.equal(attempt, 2);
    assert(gate.isReady);
  });

  await test('reset allows re-initialization', async () => {
    const gate = new LoadingGate<number>();
    await gate.ensure(async () => 1);
    assert(gate.isReady);

    gate.reset();
    assert(!gate.isReady);

    const result = await gate.ensure(async () => 2);
    assert.equal(result, 2);
  });

  await test('void gate works without return value', async () => {
    const gate = new LoadingGate();
    let ran = false;
    await gate.ensure(async () => {
      ran = true;
    });
    assert.equal(ran, true);
    assert(gate.isReady);
  });
}

// ══════════════════════════════════════════════════════════════════════
// DedupMap
// ══════════════════════════════════════════════════════════════════════

async function testDedupMap() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  DedupMap');
  console.log(`${'═'.repeat(60)}`);

  await test('starts empty', () => {
    const map = new DedupMap<string, number>();
    assert.equal(map.size, 0);
    assert.equal(map.has('x'), false);
    assert.equal(map.get('x'), undefined);
  });

  await test('getOrCreate runs factory and stores result', async () => {
    const map = new DedupMap<string, number>();
    const result = await map.getOrCreate('a', async () => 42);
    assert.equal(result, 42);
    assert.equal(map.size, 1);
    assert(map.has('a'));
    assert.equal(map.get('a'), 42);
  });

  await test('getOrCreate returns cached value without calling factory again', async () => {
    const map = new DedupMap<string, number>();
    let callCount = 0;
    await map.getOrCreate('k', async () => {
      callCount++;
      return 42;
    });
    await map.getOrCreate('k', async () => {
      callCount++;
      return 99;
    });
    assert.equal(callCount, 1);
    assert.equal(map.get('k'), 42);
  });

  await test('concurrent callers share the same inflight promise', async () => {
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
  });

  await test('different keys run independently', async () => {
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
  });

  await test('factory failure allows retry', async () => {
    let attempt = 0;
    const map = new DedupMap<string, string>();

    await assert.rejects(
      () =>
        map.getOrCreate('x', async () => {
          attempt++;
          throw new Error('boom');
        }),
      /boom/
    );
    assert(!map.has('x'));

    const result = await map.getOrCreate('x', async () => {
      attempt++;
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(attempt, 2);
  });

  await test('set() bypasses factory', async () => {
    const map = new DedupMap<string, number>();
    map.set('direct', 99);
    assert.equal(map.get('direct'), 99);

    const result = await map.getOrCreate('direct', async () => 0);
    assert.equal(result, 99, 'Should use existing value, not factory');
  });

  await test('snapshot iteration is safe', () => {
    const map = new DedupMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.set('c', 3);

    assert.equal(map.entries().length, 3);
    assert.deepEqual(map.keys(), ['a', 'b', 'c']);
    assert.deepEqual(map.values(), [1, 2, 3]);
  });

  await test('delete removes entry', () => {
    const map = new DedupMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);

    assert(map.delete('a'));
    assert.equal(map.size, 1);
    assert(!map.has('a'));
    assert(!map.delete('nonexistent'));
  });

  await test('clear removes all entries', () => {
    const map = new DedupMap<string, number>();
    map.set('a', 1);
    map.set('b', 2);
    map.clear();
    assert.equal(map.size, 0);
  });

  await test('Symbol.iterator works', () => {
    const map = new DedupMap<string, number>();
    map.set('a', 1);
    const collected = [];
    for (const entry of map) collected.push(entry);
    assert.deepEqual(collected, [['a', 1]]);
  });
}

// ══════════════════════════════════════════════════════════════════════
// withTimeout
// ══════════════════════════════════════════════════════════════════════

async function testWithTimeout() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  withTimeout');
  console.log(`${'═'.repeat(60)}`);

  await test('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(Promise.resolve('fast'), 1000, 'should not timeout');
    assert.equal(result, 'fast');
  });

  await test('rejects with timeout message when promise is too slow', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500));
    await assert.rejects(() => withTimeout(slow, 10, 'timed out!'), { message: 'timed out!' });
  });

  await test('propagates original rejection', async () => {
    const failing = Promise.reject(new Error('original error'));
    await assert.rejects(() => withTimeout(failing, 1000, 'timeout'), {
      message: 'original error',
    });
  });

  await test('clears timer on success (no leaked timers)', async () => {
    const result = await withTimeout(Promise.resolve(123), 60000, 'leak test');
    assert.equal(result, 123);
  });

  await test('works with zero-delay resolved promise', async () => {
    const result = await withTimeout(
      new Promise<string>((resolve) => setTimeout(() => resolve('immediate'), 0)),
      1000,
      'timeout'
    );
    assert.equal(result, 'immediate');
  });
}

// ══════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              ASYNC PRIMITIVES TESTS                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testLoadingGate();
  await testDedupMap();
  await testWithTimeout();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All async primitives tests passed!\n');
})();
