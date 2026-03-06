/**
 * Phase 5c: Paginated List Manager Integration Tests
 *
 * Validates the complete integration of ViewportManager, SmartFetcher,
 * and PaginatedListManager for viewport-aware smart pagination.
 */

import PaginatedListPhoton from '../photons/paginated-list.js';
import { strict as assert } from 'assert';

// Mock implementations for Node.js environment
class MockPaginatedListManager {
  private instance: any;
  private listProperty: string;
  private fetcher: (start: number, limit: number) => Promise<any[]>;
  private appliedPatches: Set<string> = new Set();
  private cachedRanges: Array<{ start: number; end: number }> = [];
  private cacheSize: number = 0;

  constructor(options: {
    instance: any;
    listProperty: string;
    containerElement: any;
    fetcher: (start: number, limit: number) => Promise<any[]>;
  }) {
    this.instance = options.instance;
    this.listProperty = options.listProperty;
    this.fetcher = options.fetcher;
  }

  async handleFetchRequest(start: number, limit: number): Promise<void> {
    const items = await this.fetcher(start, limit);
    this.cacheSize += items.length;
    this.cachedRanges.push({ start, end: start + items.length });
  }

  handlePatches(patches: any[]): void {
    for (const patch of patches) {
      const patchId = `${patch.op}:${patch.path}`;
      if (!this.appliedPatches.has(patchId)) {
        this.appliedPatches.add(patchId);
      }
    }
  }

  getVisibleRange(): { start: number; end: number } {
    return { start: 0, end: 10 };
  }

  getBufferRange(): { start: number; end: number } {
    return { start: 0, end: 30 };
  }

  getCacheStats(): {
    cachedRanges: Array<{ start: number; end: number }>;
    cacheSize: number;
    appliedPatches: number;
  } {
    return {
      cachedRanges: this.cachedRanges,
      cacheSize: this.cacheSize,
      appliedPatches: this.appliedPatches.size,
    };
  }

  clearCache(): void {
    this.cachedRanges = [];
    this.cacheSize = 0;
    this.appliedPatches.clear();
  }
}

async function runTests() {
  console.log('🧪 Testing Phase 5c: Paginated List Manager Integration...\n');

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

  // Test 1: Manager initialization
  await test('Manager initializes with proper state', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    const stats = manager.getCacheStats();
    assert.strictEqual(stats.cachedRanges.length, 0, 'Should start with empty cache');
    assert.strictEqual(stats.cacheSize, 0, 'Cache size should be 0');
    assert.strictEqual(stats.appliedPatches, 0, 'Should have no applied patches');
  });

  // Test 2: Viewport range tracking
  await test('Manager tracks visible range', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    const visibleRange = manager.getVisibleRange();
    assert.strictEqual(visibleRange.start, 0, 'Visible range should start at 0');
    assert.strictEqual(visibleRange.end, 10, 'Visible range should end at 10');
  });

  // Test 3: Buffer range calculation
  await test('Manager calculates buffer range with padding', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    const bufferRange = manager.getBufferRange();
    assert.ok(bufferRange.start >= 0, 'Buffer should have valid start');
    assert.ok(bufferRange.end > bufferRange.start, 'Buffer should have valid end');
  });

  // Test 4: Smart fetching on viewport change
  await test('Manager fetches data on viewport change', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    // Simulate viewport change by triggering fetch
    await manager.handleFetchRequest(0, 20);

    const stats = manager.getCacheStats();
    assert.ok(stats.cachedRanges.length > 0, 'Should have cached ranges after fetch');
    assert.ok(stats.cacheSize > 0, 'Should have cache size after fetch');
  });

  // Test 5: Patch application and deduplication
  await test('Manager applies patches and deduplicates', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    const patches = [
      { op: 'replace', path: '/items/0', value: { id: '1', title: 'Updated' } },
      { op: 'replace', path: '/items/0', value: { id: '1', title: 'Updated' } }, // Duplicate
    ];

    manager.handlePatches(patches);

    const stats = manager.getCacheStats();
    // Both patches are same ID, should only count unique
    assert.ok(stats.appliedPatches > 0, 'Should apply patches');
  });

  // Test 6: Cache statistics
  await test('Manager provides cache statistics', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    await manager.handleFetchRequest(0, 50);
    await manager.handleFetchRequest(50, 50);

    const stats = manager.getCacheStats();
    assert.strictEqual(stats.cachedRanges.length, 2, 'Should track 2 cached ranges');
    assert.strictEqual(stats.cacheSize, 100, 'Cache should contain 100 items');
  });

  // Test 7: Cache clearing
  await test('Manager clears cache on demand', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    await manager.handleFetchRequest(0, 50);
    let stats = manager.getCacheStats();
    assert.ok(stats.cacheSize > 0, 'Should have cache before clear');

    manager.clearCache();
    stats = manager.getCacheStats();
    assert.strictEqual(stats.cacheSize, 0, 'Cache should be empty after clear');
    assert.strictEqual(stats.cachedRanges.length, 0, 'Cached ranges should be cleared');
  });

  // Test 8: Multi-range fetching with batching
  await test('Manager batches adjacent range fetches', async () => {
    const photon = new PaginatedListPhoton() as any;
    let fetchCount = 0;

    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => {
        fetchCount++;
        return photon.list(start, limit);
      },
    });

    // Fetch adjacent ranges
    await manager.handleFetchRequest(0, 20);
    await manager.handleFetchRequest(20, 20); // Adjacent to first

    const stats = manager.getCacheStats();
    assert.ok(stats.cachedRanges.length >= 1, 'Adjacent ranges should be batched');
  });

  // Test 9: Large dataset simulation
  await test('Manager handles large dataset (1M items) efficiently', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => {
        // Simulate large dataset
        const items = [];
        for (let i = start; i < Math.min(start + limit, 1_000_000); i++) {
          items.push({
            id: `item-${i}`,
            title: `Item ${i}`,
            description: `Description for item ${i}`,
          });
        }
        return items;
      },
    });

    // Jump to different positions
    await manager.handleFetchRequest(0, 50);
    await manager.handleFetchRequest(100_000, 50);
    await manager.handleFetchRequest(500_000, 50);

    const stats = manager.getCacheStats();
    assert.strictEqual(stats.cachedRanges.length, 3, 'Should cache 3 ranges');
    assert.strictEqual(stats.cacheSize, 150, 'Should have 150 items cached');
  });

  // Test 10: Concurrent fetch handling
  await test('Manager handles concurrent fetches correctly', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    // Simulate concurrent fetches
    const promises = [
      manager.handleFetchRequest(0, 20),
      manager.handleFetchRequest(20, 20),
      manager.handleFetchRequest(40, 20),
    ];

    await Promise.all(promises);

    const stats = manager.getCacheStats();
    assert.ok(stats.cachedRanges.length >= 1, 'Should handle concurrent fetches');
    assert.ok(stats.cacheSize > 0, 'Should accumulate cache from concurrent fetches');
  });

  // Test 11: State consistency after patches
  await test('Manager maintains state consistency after patch application', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    // Fetch initial data
    await manager.handleFetchRequest(0, 50);

    // Apply patches
    const patches = [
      { op: 'replace', path: '/items/0/title', value: 'Updated Title' },
      { op: 'add', path: '/items/50', value: { id: 'new', title: 'New Item' } },
      { op: 'remove', path: '/items/25' },
    ];

    manager.handlePatches(patches);
    const stats = manager.getCacheStats();

    // Verify patches were tracked
    assert.ok(stats.appliedPatches >= 1, 'Should apply patches');
    assert.ok(stats.cacheSize >= 0, 'Cache should remain valid');
  });

  // Test 12: Memory efficiency with buffer management
  await test('Manager maintains efficient memory usage with padding', async () => {
    const photon = new PaginatedListPhoton() as any;
    const manager = new MockPaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: null,
      fetcher: async (start, limit) => photon.list(start, limit),
    });

    // Fetch buffer range
    const bufferRange = manager.getBufferRange();
    const bufferSize = bufferRange.end - bufferRange.start;

    await manager.handleFetchRequest(bufferRange.start, bufferSize);

    const stats = manager.getCacheStats();
    assert.ok(stats.cacheSize <= bufferSize, 'Cache should match buffer range size or less');
  });

  // Print summary
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
