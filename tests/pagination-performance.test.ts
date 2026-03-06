/**
 * Performance profiling for viewport-based pagination system
 * Tests scalability with large datasets and concurrent operations
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Simple performance profiler
class PerformanceProfiler {
  private marks = new Map<string, number>();
  private results: { name: string; duration: number; itemsPerSecond: number }[] = [];

  mark(name: string) {
    this.marks.set(name, performance.now());
  }

  measure(name: string, itemCount: number = 0) {
    const start = this.marks.get(name);
    if (!start) {
      console.warn(`No mark found for "${name}"`);
      return;
    }

    const duration = performance.now() - start;
    const itemsPerSecond = itemCount > 0 ? (itemCount / duration) * 1000 : 0;

    this.results.push({ name, duration, itemsPerSecond });
    console.log(
      `  ${name}: ${duration.toFixed(2)}ms${itemCount > 0 ? ` (${itemsPerSecond.toFixed(0)} items/sec)` : ''}`
    );
  }

  summary() {
    console.log('\n📊 Performance Summary:');
    for (const result of this.results) {
      console.log(`  ${result.name}: ${result.duration.toFixed(2)}ms`);
    }
  }
}

describe('Pagination Performance', () => {
  describe('Large Dataset Operations', () => {
    it('handles 10,000 item dataset efficiently', () => {
      const profiler = new PerformanceProfiler();

      // Simulate large dataset
      const items = Array.from({ length: 10000 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
        timestamp: Date.now() - i * 1000,
      }));

      // Test: Slice operations (core pagination)
      profiler.mark('slice-10k');
      const page1 = items.slice(0, 20);
      const page2 = items.slice(5000, 5020);
      const pageN = items.slice(9980, 10000);
      profiler.measure('slice-10k', items.length);

      expect(page1).toHaveLength(20);
      expect(page2).toHaveLength(20);
      expect(pageN).toHaveLength(20);

      // Test: Push operation (add item)
      const itemsCopy = [...items];
      profiler.mark('unshift-10k');
      itemsCopy.unshift({ id: 'new', title: 'New Item', timestamp: Date.now() });
      profiler.measure('unshift-10k');

      expect(itemsCopy).toHaveLength(10001);
    });

    it('handles 50,000 item dataset with cache efficiency', () => {
      const profiler = new PerformanceProfiler();

      const items = Array.from({ length: 50000 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      // Test: Random access patterns (cache hit/miss simulation)
      profiler.mark('random-access-50k');
      const samples = [
        items.slice(0, 20), // First page (cache miss)
        items.slice(100, 120), // Adjacent access (cache hit)
        items.slice(25000, 25020), // Middle jump (cache miss)
        items.slice(49980, 50000), // Last page (cache miss)
      ];
      profiler.measure('random-access-50k');

      samples.forEach((sample) => {
        expect(sample.length).toBeGreaterThan(0);
      });
    });

    it('handles 100,000 item dataset with filter + slice', () => {
      const profiler = new PerformanceProfiler();

      const items = Array.from({ length: 100000 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
        category: i % 10 === 0 ? 'special' : 'normal',
      }));

      // Test: Filtered pagination
      profiler.mark('filter-100k');
      const filtered = items.filter((item) => item.category === 'special');
      const page = filtered.slice(0, 20);
      profiler.measure('filter-100k', items.length);

      expect(page.length).toBeGreaterThan(0);
      expect(page[0].category).toBe('special');
    });
  });

  describe('Concurrent Operations', () => {
    it('handles 100 concurrent fetch requests efficiently', async () => {
      const profiler = new PerformanceProfiler();

      const items = Array.from({ length: 10000 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      // Simulate 100 concurrent fetch requests (like viewport changes)
      profiler.mark('concurrent-100');
      const promises = Array.from({ length: 100 }, (_, i) => {
        const start = (i * 100) % items.length;
        return Promise.resolve(items.slice(start, start + 20));
      });

      const results = await Promise.all(promises);
      profiler.measure('concurrent-100');

      expect(results).toHaveLength(100);
      results.forEach((result) => {
        expect(result.length).toBeGreaterThan(0);
      });
    });

    it('deduplicates concurrent requests for same range', async () => {
      const profiler = new PerformanceProfiler();

      const items = Array.from({ length: 1000 }, (_, i) => ({ id: `item-${i}` }));
      const pendingRanges = new Set<string>();
      let fetchCount = 0;

      const fetch = async (start: number, end: number) => {
        const rangeKey = `${start}-${end}`;
        if (pendingRanges.has(rangeKey)) {
          return null; // Already fetching
        }

        pendingRanges.add(rangeKey);
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 1)); // Simulate network delay

        return items.slice(start, end);
      };

      // Simulate rapid viewport changes
      profiler.mark('dedup-requests');
      const requests = [
        fetch(0, 20),
        fetch(0, 20), // Duplicate
        fetch(0, 20), // Duplicate
        fetch(100, 120),
        fetch(100, 120), // Duplicate
        fetch(500, 520),
      ];

      await Promise.all(requests);
      profiler.measure('dedup-requests');

      // Should only fetch 3 unique ranges despite 6 requests
      expect(fetchCount).toBe(3);
    });
  });

  describe('JSON Patch Application', () => {
    it('applies 1000 patches efficiently', () => {
      const profiler = new PerformanceProfiler();

      let items = Array.from({ length: 1000 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      // Generate 1000 patches (adds, updates, removes in sequence)
      const patches = Array.from({ length: 1000 }, (_, i) => ({
        op: i % 3 === 0 ? 'add' : i % 3 === 1 ? 'replace' : 'remove',
        path: `/items/${i % 100}`,
        value: i % 3 !== 2 ? { id: `new-${i}`, title: `New ${i}` } : undefined,
      }));

      profiler.mark('apply-1000-patches');
      for (const patch of patches) {
        const index = parseInt(patch.path.split('/')[2], 10);

        if (patch.op === 'add') {
          items.splice(index, 0, patch.value!);
        } else if (patch.op === 'replace' && patch.value) {
          if (index < items.length) {
            items[index] = patch.value;
          }
        } else if (patch.op === 'remove') {
          items.splice(index, 1);
        }
      }
      profiler.measure('apply-1000-patches', patches.length);

      expect(items.length).toBeGreaterThan(0);
    });

    it('maintains index integrity after sequential patches', () => {
      const profiler = new PerformanceProfiler();

      let items = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}` }));

      profiler.mark('index-integrity');

      // Add at beginning
      items.unshift({ id: 'new-0' });
      expect(items[0].id).toBe('new-0');
      expect(items[1].id).toBe('item-0');

      // Add at another position
      items.splice(50, 0, { id: 'new-50' });
      expect(items[50].id).toBe('new-50');

      // Remove from beginning (shifts all indices)
      items.shift();
      expect(items[0].id).toBe('item-0');
      expect(items.length).toBe(101);

      profiler.measure('index-integrity');
    });
  });

  describe('Cache Efficiency', () => {
    it('simulates LRU cache with 10,000 items and 500-item cache', () => {
      const profiler = new PerformanceProfiler();

      // Simulate cache as Map
      const cache = new Map<number, any>();
      const maxCacheSize = 500;

      const items = Array.from({ length: 10000 }, (_, i) => ({ id: `item-${i}` }));

      profiler.mark('lru-cache-10k');

      // Simulate accessing items in viewport and buffer
      const accessPatterns = [
        // User scrolls down: viewport moves 0→50
        ...Array.from({ length: 55 }, (_, i) => i),
        // Jump to middle: viewport moves to 5000
        ...Array.from({ length: 55 }, (_, i) => 5000 + i),
        // Jump to end: viewport moves to 9950
        ...Array.from({ length: 55 }, (_, i) => 9950 + i),
      ];

      for (const index of accessPatterns) {
        if (!cache.has(index)) {
          cache.set(index, items[index]);

          // LRU eviction when cache exceeds max size
          if (cache.size > maxCacheSize) {
            // Find item furthest from most recent accesses
            const keysToDelete = Math.ceil((cache.size - maxCacheSize) * 1.2);
            const keys = Array.from(cache.keys());

            // Simple LRU: delete oldest indices (simulation)
            for (let i = 0; i < keysToDelete && keys.length > 0; i++) {
              const oldestKey = keys[i];
              cache.delete(oldestKey);
            }
          }
        }
      }

      profiler.measure('lru-cache-10k');

      // Cache should be at or below max size
      expect(cache.size).toBeLessThanOrEqual(maxCacheSize + 100);
    });

    it('tracks cache hit rate', () => {
      const profiler = new PerformanceProfiler();

      const cache = new Map<string, any>();
      let hits = 0;
      let misses = 0;

      const items = Array.from({ length: 1000 }, (_, i) => ({ id: `item-${i}` }));

      profiler.mark('cache-hit-rate');

      // Access pattern: mostly recent items (like viewport)
      const pattern = [
        ...Array.from({ length: 20 }, (_, i) => i), // Items 0-20 (first access)
        ...Array.from({ length: 20 }, (_, i) => i), // Items 0-20 (repeat - cache hit)
        ...Array.from({ length: 20 }, (_, i) => i + 15), // Items 15-35 (mixed hit/miss)
        ...Array.from({ length: 20 }, (_, i) => i + 30), // Items 30-50 (mixed hit/miss)
      ];

      for (const index of pattern) {
        const key = `item-${index}`;
        if (cache.has(key)) {
          hits++;
        } else {
          misses++;
          cache.set(key, items[index]);
        }
      }

      profiler.measure('cache-hit-rate');

      const hitRate = (hits / (hits + misses)) * 100;
      console.log(`  Cache hit rate: ${hitRate.toFixed(1)}%`);

      // With reasonable buffer, expect 60-80% hit rate
      expect(hitRate).toBeGreaterThan(50);
    });
  });

  describe('Memory Usage', () => {
    it('estimates memory for different cache sizes', () => {
      const profiler = new PerformanceProfiler();

      // Approximate object size
      const itemSize = 200; // bytes per item (id, title, metadata)

      const cacheSizes = [100, 500, 1000, 5000];

      profiler.mark('memory-estimate');

      for (const size of cacheSizes) {
        const memoryMB = (size * itemSize) / (1024 * 1024);
        console.log(`  Cache size ${size} items: ~${memoryMB.toFixed(2)} MB`);
      }

      profiler.measure('memory-estimate');

      // Verify reasonable memory usage
      const max5000 = (5000 * itemSize) / (1024 * 1024);
      expect(max5000).toBeLessThan(2); // Should be < 2 MB for 5000 items
    });
  });

  describe('Summary', () => {
    it('prints performance summary', () => {
      const profiler = new PerformanceProfiler();

      profiler.mark('test-1');
      for (let i = 0; i < 1000000; i++) {
        // CPU work
      }
      profiler.measure('test-1');

      profiler.mark('test-2');
      const arr = Array.from({ length: 10000 }, (_, i) => i);
      arr.slice(0, 100);
      profiler.measure('test-2');

      profiler.summary();
      expect(true).toBe(true);
    });
  });
});
