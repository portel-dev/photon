# Pagination API Reference

## Response Format

All paginated methods must return a response with `items` and `_pagination` fields.

### PaginationMetadata Type

```typescript
interface PaginationMetadata {
  /**
   * Total number of items available across all pages
   * Used by ViewportAwareProxy to determine cache sizing
   * Used by UI to show "Showing 20 of 1000"
   */
  totalCount: number;

  /**
   * Start index of returned items (inclusive, 0-based)
   * Example: if start=20, first returned item is at index 20
   */
  start: number;

  /**
   * End index of returned items (exclusive, 0-based)
   * Example: if end=40, last returned item is at index 39
   * Always: start ≤ end ≤ totalCount
   */
  end: number;

  /**
   * Whether more items exist after the current end
   * If true: user can scroll/paginate for more data
   * If false: end of dataset reached
   * Invariant: hasMore = (end < totalCount)
   */
  hasMore: boolean;

  /**
   * Optional: Whether items exist before the current start
   * Useful for bi-directional pagination
   * If true: user can scroll up for earlier items
   * Default: false (assume backwards pagination not needed)
   */
  hasMoreBefore?: boolean;
}
```

### Response Structure

```typescript
interface PaginatedResponse<T> {
  /**
   * Array of items for this page
   * Length must equal (end - start)
   * Items must be in order by their index
   */
  items: T[];

  /**
   * Pagination metadata (REQUIRED)
   * IMPORTANT: This field name is case-sensitive: _pagination
   * The framework looks for this exact field name
   */
  _pagination: PaginationMetadata;
}
```

## Method Signature

Paginated methods should follow this pattern:

```typescript
async list(
  /**
   * Start index (0-based, inclusive)
   * Default: 0 (start of dataset)
   * Can be greater than dataset for boundary testing
   * Server should return empty items array if start >= totalCount
   */
  start: number = 0,

  /**
   * Maximum number of items to return
   * Default: 20 (can vary by device in framework)
   * Server can return fewer items if fewer available
   * Example: if limit=20 but only 5 items remain, return 5
   */
  limit: number = 20
): Promise<PaginatedResponse<T>>
```

## Implementation Example

### Minimal Implementation

```typescript
export default class Articles {
  private items: Article[] = [...];

  async list(start: number = 0, limit: number = 20) {
    const end = Math.min(start + limit, this.items.length);
    return {
      items: this.items.slice(start, end),
      _pagination: {
        totalCount: this.items.length,
        start,
        end,
        hasMore: end < this.items.length,
      },
    };
  }
}
```

### With Database

```typescript
import { db } from './database';

export default class Posts {
  async list(start: number = 0, limit: number = 20) {
    const totalCount = await db.posts.count();
    const items = await db.posts
      .skip(start)
      .take(limit)
      .select();

    return {
      items,
      _pagination: {
        totalCount,
        start,
        end: start + items.length,
        hasMore: (start + items.length) < totalCount,
      },
    };
  }
}
```

### With Search/Filter

```typescript
export default class SearchPhoton {
  async search(
    query: string,
    start: number = 0,
    limit: number = 20
  ) {
    const results = this.performSearch(query);
    const totalCount = results.length;
    const end = Math.min(start + limit, totalCount);

    return {
      items: results.slice(start, end),
      _pagination: {
        totalCount,
        start,
        end,
        hasMore: end < totalCount,
      },
    };
  }
}
```

## ViewportAwareProxy Integration

The framework automatically manages pagination when:

1. **Method returns `_pagination` metadata**
   - Detected during initial response
   - Creates ViewportAwareProxy for the items array

2. **IntersectionObserver detects viewport change**
   - ViewportManager calls `proxy.setViewport(start, end)`
   - Proxy calculates missing ranges with buffer
   - Auto-fetches gaps: `list(start - buffer, limit)`

3. **Patch updates arrive from other clients**
   - GlobalInstanceManager applies patches
   - ViewportAwareProxy updates local cache
   - UI re-renders if affected items visible

## Client Configuration

Framework auto-configures based on device:

```typescript
// Mobile (width < 768px)
{ pageSize: 10, bufferSize: 5 }

// Tablet (width < 1024px)
{ pageSize: 50, bufferSize: 7 }

// Desktop (width ≥ 1024px)
{ pageSize: 100, bufferSize: 10 }

// Override with custom container config
new ViewportManager(proxy, {
  container: element,
  itemSelector: '[data-index]',
  pageSize: 25,
  bufferSize: 5
})
```

## Event Flow

```
Client.list(0, 20)
  ↓ MCP call
Server.list(start=0, limit=20)
  ↓ returns with _pagination metadata
ViewportAwareProxy.initializeWithResponse()
  ↓
ViewportManager.start()
  ↓ (user scrolls)
IntersectionObserver detects change
  ↓
ViewportManager.getVisibleRange()
  ↓
ViewportAwareProxy.setViewport(30, 50)
  ↓ missing range detected [20-30] and [50-55]
Client.list(20, 20) in parallel
Client.list(50, 15) in parallel
  ↓
Server.list(start=20, limit=20) + list(start=50, limit=15)
  ↓
ViewportAwareProxy updates cache
  ↓
GlobalInstanceManager receives state-changed patch
  ↓
ViewportAwareProxy.applyPatches()
  ↓
UI re-renders with new/updated items
```

## Error Handling

### Boundary Conditions

```typescript
// If start >= totalCount (beyond dataset)
// Return empty items, but valid metadata
return {
  items: [],
  _pagination: {
    totalCount: 100,
    start: 150,      // Beyond end
    end: 150,        // No items
    hasMore: false,
  }
}

// If limit > remaining items
// Return fewer items than requested (OK)
return {
  items: [item98, item99],  // Only 2 items, not 20
  _pagination: {
    totalCount: 100,
    start: 98,
    end: 100,        // end = start + items.length
    hasMore: false,
  }
}
```

### Server Errors

If server error occurs during fetch:
```typescript
// ViewportAwareProxy catches errors, logs them
try {
  const result = await mcpClient.callTool(toolName, { start, limit });
} catch (error) {
  console.error(`Failed to fetch range [${start}, ${end}]`, error);
  // Cache remains valid, user sees last-known good data
}
```

## JSON Patch Operations (Automatic)

When using @stateful decorator:

```typescript
export default class MyPhoton {
  items: Item[] = [];

  // Automatically broadcasts patch to all clients
  async add(title: string) {
    const item = { id: uuid(), title };
    this.items.unshift(item);

    // Broadcasts:
    // { op: "add", path: "/items/0", value: item }
    return item;
  }

  async update(index: number, title: string) {
    this.items[index].title = title;

    // Broadcasts:
    // { op: "replace", path: "/items/${index}", value: updated }
    return this.items[index];
  }

  async delete(index: number) {
    this.items.splice(index, 1);

    // Broadcasts:
    // { op: "remove", path: "/items/${index}" }
  }
}
```

## Testing Pagination

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import MyPhoton from './my-photon';

describe('Pagination', () => {
  it('returns first page with metadata', async () => {
    const photon = new MyPhoton();
    const response = await photon.list(0, 20);

    expect(response._pagination).toEqual({
      totalCount: expect.any(Number),
      start: 0,
      end: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    expect(response.items).toHaveLength(response._pagination.end);
  });

  it('clamps to dataset boundaries', async () => {
    const photon = new MyPhoton();
    const response = await photon.list(9999, 20);

    expect(response.items).toHaveLength(0);
    expect(response._pagination.start).toBe(9999);
    expect(response._pagination.end).toBe(9999);
    expect(response._pagination.hasMore).toBe(false);
  });
});
```

## Performance Tips

1. **Database Indexing**
   - Index columns used for sorting/filtering
   - Index creation timestamp for temporal queries

2. **Query Optimization**
   - Use LIMIT/OFFSET in SQL (not in-memory slicing)
   - Use skip()/take() in ORMs
   - Consider pagination-friendly queries

3. **Cache Sizing**
   - More cache = fewer requests but more memory
   - Less cache = more requests but lighter memory
   - Typical: 500-5000 items depending on device

4. **Buffer Size**
   - Larger buffer = smoother scrolling but more memory
   - Smaller buffer = less memory but more visible loading
   - Typical: 5-15 items depending on item size

## Compatibility

- Framework version: ≥1.6.0
- Browser APIs: IntersectionObserver (IE not supported)
- Transport: Works with all MCP transports (stdio, SSE, WebSocket)
- Multiple clients: Full synchronization via state-changed patches

## See Also

- [Pagination Implementation Guide](../pagination/PAGINATION-IMPLEMENTATION-GUIDE.md)
- [ViewportAwareProxy API](./VIEWPORT-AWARE-PROXY.md)
- [ViewportManager API](./VIEWPORT-MANAGER.md)
