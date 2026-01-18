/**
 * Performance Utilities Tests
 */

import { PerformanceMonitor, memoize, debounce, throttle } from '../dist/shared/performance.js';

console.log('🧪 Running Performance Utilities Tests...\n');

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Test PerformanceMonitor
async function testPerformanceMonitor() {
  const monitor = new PerformanceMonitor();

  // Test basic timing
  monitor.start('test-operation');
  await sleep(50);
  const duration = monitor.end('test-operation');
  assert(
    duration !== undefined && duration >= 45,
    'PerformanceMonitor measures duration'
  );

  // Test measure sync
  const result = monitor.measure('sync-op', () => 42);
  assert(result === 42, 'measure() returns correct value');

  // Test measure async
  const asyncResult = await monitor.measureAsync('async-op', async () => {
    await sleep(10);
    return 'done';
  });
  assert(asyncResult === 'done', 'measureAsync() returns correct value');

  // Test summary
  const summary = monitor.getSummary();
  assert(summary.count === 3, 'Summary counts all operations');
  assert(summary.total > 0, 'Summary calculates total time');
  assert(summary.average > 0, 'Summary calculates average time');
  assert(summary.slowest?.name === 'test-operation', 'Summary finds slowest operation');
}

// Test memoization
function testMemoize() {
  let callCount = 0;
  const expensiveFn = memoize((x: number) => {
    callCount++;
    return x * 2;
  });

  const result1 = expensiveFn(5);
  const result2 = expensiveFn(5);
  const result3 = expensiveFn(10);

  assert(result1 === 10, 'Memoized function returns correct value');
  assert(result2 === 10, 'Memoized function returns cached value');
  assert(callCount === 2, 'Memoized function caches results (2 unique calls)');
  assert(result3 === 20, 'Memoized function handles different arguments');
}

// Test memoization with TTL
async function testMemoizeWithTTL() {
  let callCount = 0;
  const fnWithTTL = memoize(
    (x: number) => {
      callCount++;
      return x * 3;
    },
    { ttl: 100 }
  );

  fnWithTTL(5);
  await sleep(150);
  fnWithTTL(5);

  assert(callCount === 2, 'Memoized function respects TTL');
}

// Test debounce
async function testDebounce() {
  let callCount = 0;
  const debouncedFn = debounce(() => {
    callCount++;
  }, 50);

  debouncedFn();
  debouncedFn();
  debouncedFn();

  await sleep(20);
  assert(callCount === 0, 'Debounced function delays execution');

  await sleep(40);
  assert(callCount === 1, 'Debounced function executes once after delay');
}

// Test throttle
async function testThrottle() {
  let callCount = 0;
  const throttledFn = throttle(() => {
    callCount++;
  }, 100);

  throttledFn();
  throttledFn();
  throttledFn();

  assert(callCount === 1, 'Throttled function limits execution rate');

  await sleep(110);
  throttledFn();

  assert(callCount === 2, 'Throttled function allows execution after interval');
}

// Run all tests
await testPerformanceMonitor();
testMemoize();
await testMemoizeWithTTL();
await testDebounce();
await testThrottle();

console.log(`\n✅ Performance Utilities tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
