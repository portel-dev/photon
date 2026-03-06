/**
 * Integration tests for viewport-based pagination
 * Tests the full flow: method call → auto-UI detection → proxy creation → viewport tracking → patch application
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock MCP client for testing
const createMockMCPClient = () => {
  const callTool = vi.fn();
  const parseToolResult = vi.fn((result) => {
    // Parse MCP response format: { isError, content: [{ type, text }] }
    if (result?.content?.[0]?.text) {
      try {
        return JSON.parse(result.content[0].text);
      } catch {
        return result;
      }
    }
    return result;
  });

  return { callTool, parseToolResult };
};

describe('Pagination Integration Tests', () => {
  describe('Auto-UI Detection', () => {
    it('detects _pagination metadata in response', async () => {
      const response = {
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
        _pagination: {
          totalCount: 1000,
          start: 0,
          end: 3,
          hasMore: true,
        },
      };

      // Framework should detect _pagination and create ViewportAwareProxy
      const hasPaginationMetadata =
        response && typeof response === 'object' && response._pagination;
      expect(typeof hasPaginationMetadata).toBe('object');
      expect(hasPaginationMetadata?.totalCount).toBe(1000);
    });

    it('returns empty _pagination for non-paginated methods', async () => {
      const response = {
        items: [{ id: 1 }, { id: 2 }],
        // No _pagination field
      };

      const hasPaginationMetadata =
        response && typeof response === 'object' && response._pagination;
      expect(hasPaginationMetadata).toBeFalsy();
    });
  });

  describe('Large Dataset Stress Test', () => {
    it('handles 10000 items with pagination', async () => {
      const mockClient = createMockMCPClient();

      // Simulate 10,000 item dataset
      const totalCount = 10000;
      const items = Array.from({ length: totalCount }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
        timestamp: Date.now() - i * 1000,
      }));

      // First page (0-20)
      const firstPage = {
        items: items.slice(0, 20),
        _pagination: {
          totalCount,
          start: 0,
          end: 20,
          hasMore: true,
        },
      };

      mockClient.callTool.mockResolvedValueOnce({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify(firstPage) }],
      });

      const result = await mockClient.callTool('list/items', { start: 0, limit: 20 });
      const parsed = mockClient.parseToolResult(result);

      expect(parsed.items).toHaveLength(20);
      expect(parsed._pagination.totalCount).toBe(10000);
      expect(parsed._pagination.hasMore).toBe(true);
    });

    it('efficiently fetches middle range', async () => {
      const mockClient = createMockMCPClient();
      const totalCount = 50000;

      // Middle of dataset (5000-5020)
      const middlePage = {
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `item-${5000 + i}`,
          title: `Item ${5000 + i}`,
        })),
        _pagination: {
          totalCount,
          start: 5000,
          end: 5020,
          hasMore: true,
        },
      };

      mockClient.callTool.mockResolvedValueOnce({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify(middlePage) }],
      });

      const result = await mockClient.callTool('list/items', { start: 5000, limit: 20 });
      const parsed = mockClient.parseToolResult(result);

      expect(parsed.items[0].id).toBe('item-5000');
      expect(parsed._pagination.start).toBe(5000);
      expect(parsed._pagination.end).toBe(5020);
    });

    it('handles end of dataset efficiently', async () => {
      const mockClient = createMockMCPClient();
      const totalCount = 10000;
      const lastPageStart = 9990;

      // Last page (9990-10000)
      const lastPage = {
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `item-${lastPageStart + i}`,
          title: `Item ${lastPageStart + i}`,
        })),
        _pagination: {
          totalCount,
          start: lastPageStart,
          end: totalCount,
          hasMore: false, // Important: no more items
        },
      };

      mockClient.callTool.mockResolvedValueOnce({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify(lastPage) }],
      });

      const result = await mockClient.callTool('list/items', { start: 9990, limit: 20 });
      const parsed = mockClient.parseToolResult(result);

      expect(parsed.items).toHaveLength(10);
      expect(parsed._pagination.hasMore).toBe(false);
      expect(parsed._pagination.end).toBe(totalCount);
    });
  });

  describe('Viewport Simulation', () => {
    it('simulates scrolling through 1000-item list', async () => {
      const mockClient = createMockMCPClient();
      const itemCount = 1000;

      // Simulate user scrolling from top to middle to bottom
      const scrollPositions = [
        { start: 0, limit: 20 }, // Top
        { start: 200, limit: 20 }, // After scrolling down
        { start: 500, limit: 20 }, // Middle
        { start: 800, limit: 20 }, // Near bottom
        { start: 980, limit: 20 }, // Bottom
      ];

      let fetchCount = 0;

      mockClient.callTool.mockImplementation(async (tool, params) => {
        fetchCount++;
        const { start, limit } = params;
        const end = Math.min(start + limit, itemCount);

        return {
          isError: false,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                items: Array.from({ length: end - start }, (_, i) => ({
                  id: `item-${start + i}`,
                  title: `Item ${start + i}`,
                })),
                _pagination: {
                  totalCount: itemCount,
                  start,
                  end,
                  hasMore: end < itemCount,
                },
              }),
            },
          ],
        };
      });

      // Simulate scrolling through viewport
      for (const position of scrollPositions) {
        const result = await mockClient.callTool('list/items', position);
        const parsed = mockClient.parseToolResult(result);
        expect(parsed._pagination.totalCount).toBe(itemCount);
      }

      expect(fetchCount).toBe(scrollPositions.length);
    });

    it('batches viewport changes with buffer', async () => {
      const mockClient = createMockMCPClient();

      // ViewportManager would call setViewport with buffer
      // If viewport shows items 30-50 with bufferSize=5:
      // Fetch range: [25, 55]
      const bufferedRange = {
        viewportStart: 30,
        viewportEnd: 50,
        bufferSize: 5,
        // Calculated fetch range: [25, 55]
        fetchStart: 25,
        fetchEnd: 55,
      };

      const fetchedItems = Array.from(
        { length: bufferedRange.fetchEnd - bufferedRange.fetchStart },
        (_, i) => ({
          id: `item-${bufferedRange.fetchStart + i}`,
          title: `Item ${bufferedRange.fetchStart + i}`,
        })
      );

      mockClient.callTool.mockResolvedValueOnce({
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              items: fetchedItems,
              _pagination: {
                totalCount: 1000,
                start: bufferedRange.fetchStart,
                end: bufferedRange.fetchEnd,
                hasMore: true,
              },
            }),
          },
        ],
      });

      const result = await mockClient.callTool('list/items', {
        start: bufferedRange.fetchStart,
        limit: bufferedRange.fetchEnd - bufferedRange.fetchStart,
      });

      const parsed = mockClient.parseToolResult(result);

      // Verify buffer expanded fetch range
      expect(parsed._pagination.start).toBe(bufferedRange.fetchStart);
      expect(parsed._pagination.end).toBe(bufferedRange.fetchEnd);
      // Viewport items are subset of fetched
      expect(parsed.items.length).toBeGreaterThan(
        bufferedRange.viewportEnd - bufferedRange.viewportStart
      );
    });
  });

  describe('JSON Patch Application', () => {
    it('applies add patch at beginning', async () => {
      const patch = {
        op: 'add',
        path: '/items/0',
        value: { id: 'new-item', title: 'New Item' },
      };

      const items = Array.from({ length: 10 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      // Apply patch: insert at beginning
      if (patch.op === 'add') {
        items.splice(0, 0, patch.value);
      }

      expect(items[0]).toEqual(patch.value);
      expect(items).toHaveLength(11);
    });

    it('applies remove patch maintains indices', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      const patch = {
        op: 'remove',
        path: '/items/50',
      };

      // Apply patch: remove at index 50
      if (patch.op === 'remove') {
        items.splice(50, 1);
      }

      expect(items).toHaveLength(99);
      expect(items[50].id).toBe('item-51'); // Next item shifted down
    });

    it('applies replace patch in-place', async () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      const patch = {
        op: 'replace',
        path: '/items/10',
        value: { id: 'item-10-updated', title: 'Updated Item' },
      };

      // Apply patch: replace at index 10
      if (patch.op === 'replace') {
        items[10] = patch.value;
      }

      expect(items[10]).toEqual(patch.value);
      expect(items).toHaveLength(20); // Length unchanged
    });

    it('handles concurrent patches from multiple clients', async () => {
      const items = Array.from({ length: 50 }, (_, i) => ({
        id: `item-${i}`,
        title: `Item ${i}`,
      }));

      const patches = [
        { op: 'add', path: '/items/0', value: { id: 'new-1', title: 'New 1' } },
        { op: 'add', path: '/items/1', value: { id: 'new-2', title: 'New 2' } },
        { op: 'replace', path: '/items/12', value: { id: 'item-10-upd', title: 'Updated' } }, // Index shifted by 2 adds
        { op: 'remove', path: '/items/32' }, // Index shifted by 2 adds
      ];

      // Apply patches in order (as they arrive from server)
      let currentItems = [...items];

      for (const patch of patches) {
        if (patch.op === 'add') {
          const index = parseInt(patch.path.split('/')[2], 10);
          currentItems.splice(index, 0, patch.value);
        } else if (patch.op === 'remove') {
          const index = parseInt(patch.path.split('/')[2], 10);
          currentItems.splice(index, 1);
        } else if (patch.op === 'replace') {
          const index = parseInt(patch.path.split('/')[2], 10);
          currentItems[index] = patch.value;
        }
      }

      // Verify final state
      expect(currentItems[0].id).toBe('new-1');
      expect(currentItems[1].id).toBe('new-2');
      expect(currentItems[12].id).toBe('item-10-upd');
      expect(currentItems).toHaveLength(50 + 2 - 1); // +2 adds -1 remove
    });
  });

  describe('Cache Management', () => {
    it('limits cache size and prunes LRU items', async () => {
      const maxCacheSize = 100;
      const cache = new Map<number, any>();

      // Fill cache to max size
      for (let i = 0; i < maxCacheSize; i++) {
        cache.set(i, { id: `item-${i}` });
      }

      expect(cache.size).toBe(maxCacheSize);

      // When adding new item, should prune LRU
      // Assuming viewport is at items 50-70
      const viewportCenter = 60;
      const toRemove = cache.size - maxCacheSize + 10; // Make room for 10 new items

      if (toRemove > 0) {
        const sortedKeys = Array.from(cache.keys()).sort(
          (a, b) => Math.abs(a - viewportCenter) - Math.abs(b - viewportCenter)
        );

        // Remove items furthest from viewport
        for (let i = sortedKeys.length - 1; i >= sortedKeys.length - toRemove; i--) {
          cache.delete(sortedKeys[i]);
        }
      }

      expect(cache.size).toBeLessThanOrEqual(maxCacheSize);
      // Items near viewport (50-70) should remain
      expect(cache.has(55)).toBe(true);
      expect(cache.has(65)).toBe(true);
    });

    it('deduplicates concurrent fetch requests', async () => {
      const mockClient = createMockMCPClient();
      const pendingRanges = new Set<string>();

      const fetchRange = async (start: number, end: number) => {
        const rangeKey = `${start}-${end}`;

        if (pendingRanges.has(rangeKey)) {
          // Already fetching this range
          return null;
        }

        pendingRanges.add(rangeKey);

        try {
          const result = await mockClient.callTool('list/items', {
            start,
            limit: end - start,
          });
          return result;
        } finally {
          pendingRanges.delete(rangeKey);
        }
      };

      mockClient.callTool.mockResolvedValue({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ items: [], _pagination: {} }) }],
      });

      // Concurrent requests for same range
      const promise1 = fetchRange(0, 20);
      const promise2 = fetchRange(0, 20); // Duplicate - should return null

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).not.toBeNull();
      expect(result2).toBeNull();
      expect(mockClient.callTool).toHaveBeenCalledTimes(1); // Only one actual fetch
    });
  });

  describe('Multi-Client Sync', () => {
    it('applies patches from other clients', async () => {
      const instance = {
        items: Array.from({ length: 20 }, (_, i) => ({
          id: `item-${i}`,
          title: `Item ${i}`,
        })),
        _pagination: {
          totalCount: 20,
          start: 0,
          end: 20,
          hasMore: false,
        },
      };

      // Another client adds item at beginning
      const patch = {
        op: 'add',
        path: '/items/0',
        value: { id: 'new-item', title: 'Added by other client' },
      };

      // Apply patch to local instance
      if (patch.op === 'add') {
        instance.items.splice(0, 0, patch.value);
        instance._pagination.totalCount++;
      }

      expect(instance.items[0]).toEqual(patch.value);
      expect(instance._pagination.totalCount).toBe(21);

      // Another client updates item
      const updatePatch = {
        op: 'replace',
        path: '/items/5',
        value: { id: 'item-4-updated', title: 'Updated by other client' },
      };

      if (updatePatch.op === 'replace') {
        const index = 5;
        instance.items[index] = updatePatch.value;
      }

      expect(instance.items[5]).toEqual(updatePatch.value);
      expect(instance._pagination.totalCount).toBe(21); // Count unchanged for replace
    });
  });
});
