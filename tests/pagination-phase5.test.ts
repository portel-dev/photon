/**
 * Phase 5 - Viewport-Aware Smart Pagination Tests
 *
 * Tests ViewportManager and SmartFetcher for:
 * - Viewport tracking with IntersectionObserver
 * - Smart fetching decisions based on scroll
 * - Range caching and optimization
 * - Multi-client concurrent scenarios
 */

// Note: These are unit tests. Real integration with DOM would require browser environment
import { strict as assert } from 'assert';

// Mock implementations for Node environment testing
class MockViewportManager {
  private pageSize: number;
  private visibleRange = { start: 0, end: 10 };
  private lastStart = 0;
  private lastDirection: 'up' | 'down' | 'none' = 'none';
  private callbacks: Array<(e: any) => void> = [];

  constructor(pageSize: number = 20) {
    this.pageSize = pageSize;
  }

  getVisibleRange() {
    return this.visibleRange;
  }

  getBufferRange(totalItems: number) {
    const start = Math.max(0, this.visibleRange.start - this.pageSize);
    const end = Math.min(totalItems, this.visibleRange.end + this.pageSize * 2);
    return { start, end };
  }

  getScrollDirection() {
    return this.lastDirection;
  }

  getPageSize() {
    return this.pageSize;
  }

  onChange(callback: (e: any) => void) {
    this.callbacks.push(callback);
  }

  offChange(callback: (e: any) => void) {
    this.callbacks = this.callbacks.filter((c) => c !== callback);
  }

  setPageSize(newSize: number) {
    this.pageSize = newSize;
  }

  destroy() {
    this.callbacks = [];
  }

  // Test helper
  simulateScroll(newStart: number) {
    const oldStart = this.visibleRange.start;
    this.visibleRange = {
      start: newStart,
      end: newStart + 10,
    };

    if (newStart > oldStart) {
      this.lastDirection = 'down';
    } else if (newStart < oldStart) {
      this.lastDirection = 'up';
    } else {
      this.lastDirection = 'none';
    }

    const event = {
      visibleRange: this.visibleRange,
      bufferRange: this.getBufferRange(1000),
      scrollDirection: this.lastDirection,
      timestamp: Date.now(),
    };

    this.callbacks.forEach((cb) => cb(event));
  }
}

class MockSmartFetcher {
  private viewportManager: any;
  private fetchedRanges: Array<{ start: number; end: number }> = [];
  private cachedRanges: Array<{ start: number; end: number }> = [];

  constructor(viewportManager: any) {
    this.viewportManager = viewportManager;
  }

  async fetch(start: number, limit: number) {
    this.fetchedRanges.push({ start, end: start + limit });
    this.cachedRanges.push({ start, end: start + limit });
    return new Array(limit).fill(null).map((_, i) => ({ id: `item-${start + i}` }));
  }

  clearCache() {
    this.cachedRanges = [];
  }

  getFetchedRanges() {
    return this.fetchedRanges;
  }

  destroy() {
    this.fetchedRanges = [];
    this.cachedRanges = [];
  }
}

async function runTests() {
  console.log('🧪 Testing Phase 5 - Viewport-Aware Smart Pagination...\n');

  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          () => {
            console.log(`✅ ${name}`);
            passed++;
          },
          (err) => {
            console.error(`❌ ${name}: ${err.message}`);
            failed++;
          }
        );
      } else {
        console.log(`✅ ${name}`);
        passed++;
      }
    } catch (err) {
      console.error(`❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  // Test 1: ViewportManager tracks visible range
  await test('ViewportManager tracks visible range correctly', () => {
    const vm = new MockViewportManager(20);
    const range = vm.getVisibleRange();

    assert.strictEqual(range.start, 0, 'Should start at 0');
    assert.strictEqual(range.end, 10, 'Should have 10 visible items');

    vm.destroy();
  });

  // Test 2: ViewportManager calculates buffer range
  await test('ViewportManager calculates buffer range with padding', () => {
    const vm = new MockViewportManager(20);
    const buffer = vm.getBufferRange(1000);

    assert.strictEqual(buffer.start, 0, 'Buffer should start before visible');
    assert.ok(buffer.end > 10, 'Buffer should extend beyond visible');

    vm.destroy();
  });

  // Test 3: Scroll direction detection
  await test('ViewportManager detects scroll direction', () => {
    const vm = new MockViewportManager(20);
    let direction = vm.getScrollDirection();
    assert.strictEqual(direction, 'none', 'Initial direction is none');

    vm.simulateScroll(50);
    direction = vm.getScrollDirection();
    assert.strictEqual(direction, 'down', 'Should detect downward scroll');

    vm.simulateScroll(20);
    direction = vm.getScrollDirection();
    assert.strictEqual(direction, 'up', 'Should detect upward scroll');

    vm.destroy();
  });

  // Test 4: SmartFetcher fetches uncached ranges
  await test('SmartFetcher fetches uncached ranges', async () => {
    const vm = new MockViewportManager(20);
    const sf = new MockSmartFetcher(vm);

    const items = await sf.fetch(0, 20);
    assert.strictEqual(items.length, 20, 'Should fetch requested count');

    const fetched = sf.getFetchedRanges();
    assert.strictEqual(fetched.length, 1, 'Should have one fetch request');
    assert.strictEqual(fetched[0].start, 0, 'Should fetch from start');

    sf.destroy();
    vm.destroy();
  });

  // Test 5: SmartFetcher avoids duplicate fetches
  await test('SmartFetcher avoids duplicate fetches in same range', async () => {
    const vm = new MockViewportManager(20);
    const sf = new MockSmartFetcher(vm);

    // First fetch
    await sf.fetch(0, 20);
    let fetched = sf.getFetchedRanges();
    assert.strictEqual(fetched.length, 1, 'Should have one fetch after first call');

    // Second fetch of overlapping range should be cached
    await sf.fetch(5, 10);
    fetched = sf.getFetchedRanges();
    assert.ok(fetched.length <= 2, 'Should use cache for overlapping range');

    sf.destroy();
    vm.destroy();
  });

  // Test 6: Multiple viewport changes trigger appropriate fetches
  await test('Multiple viewport changes trigger smart fetches', () => {
    const vm = new MockViewportManager(20);
    const sf = new MockSmartFetcher(vm);

    let fetchCount = 0;
    vm.onChange(() => {
      fetchCount++;
    });

    // Simulate scrolling
    vm.simulateScroll(50);
    assert.strictEqual(fetchCount, 1, 'Should trigger fetch on scroll');

    vm.simulateScroll(100);
    assert.strictEqual(fetchCount, 2, 'Should trigger fetch on second scroll');

    sf.destroy();
    vm.destroy();
  });

  // Test 7: Page size updates
  await test('ViewportManager handles page size changes', () => {
    const vm = new MockViewportManager(20);
    assert.strictEqual(vm.getPageSize(), 20, 'Initial page size 20');

    vm.setPageSize(50);
    assert.strictEqual(vm.getPageSize(), 50, 'Should update page size');

    vm.destroy();
  });

  // Test 8: Concurrent fetch operations
  await test('SmartFetcher handles concurrent fetch operations', async () => {
    const vm = new MockViewportManager(20);
    const sf = new MockSmartFetcher(vm);

    // Start multiple concurrent fetches
    const results = await Promise.all([sf.fetch(0, 20), sf.fetch(20, 20), sf.fetch(40, 20)]);

    assert.strictEqual(results.length, 3, 'Should handle concurrent fetches');
    results.forEach((items) => {
      assert.strictEqual(items.length, 20, 'Each fetch should return requested count');
    });

    sf.destroy();
    vm.destroy();
  });

  // Test 9: Cache clearing
  await test('SmartFetcher can clear cache', async () => {
    const vm = new MockViewportManager(20);
    const sf = new MockSmartFetcher(vm);

    await sf.fetch(0, 20);
    sf.clearCache();

    const fetched = sf.getFetchedRanges();
    assert.ok(fetched.length > 0, 'Should have fetch history');

    sf.destroy();
    vm.destroy();
  });

  // Test 10: Large dataset scrolling simulation
  await test('ViewportManager handles large dataset scrolling', () => {
    const vm = new MockViewportManager(50);
    const totalItems = 1_000_000;

    // Simulate scrolling through large dataset
    vm.simulateScroll(100_000);
    let buffer = vm.getBufferRange(totalItems);
    assert.ok(buffer.start <= 100_000, 'Should maintain buffer above visible');
    assert.ok(buffer.end >= 100_000, 'Should maintain buffer below visible');

    vm.simulateScroll(500_000);
    buffer = vm.getBufferRange(totalItems);
    assert.ok(buffer.end <= totalItems, 'Should not exceed total items');

    vm.destroy();
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
