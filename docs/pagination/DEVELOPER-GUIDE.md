# Pagination Developer Guide

## Overview

The Photon framework provides **zero-boilerplate pagination** for @stateful photons. Developers write simple array-slicing code; the framework handles all pagination logic, caching, and multi-client synchronization.

## Quick Start

### 1. Create a Stateful Photon with Items Array

```typescript
/**
 * @photon My Paginated List
 * @stateful
 */
export default class MyPhoton {
  items: Item[];

  constructor() {
    this.items = [];  // ✅ Constructor-level injection
  }

  async list(start: number = 0, limit: number = 20): Promise<Item[]> {
    // Just return the slice - framework handles pagination!
    return this.items.slice(start, limit);
  }

  async add(title: string): Promise<Item> {
    const item = { id: crypto.randomUUID(), title };
    this.items.unshift(item);  // Auto-broadcasts JSON Patch
    return item;
  }
}
```

### 2. That's It!

The framework automatically:
- ✅ Detects array returns from methods with `(start, limit)` parameters
- ✅ Wraps response with pagination metadata
- ✅ Creates ViewportAwareProxy for intelligent caching
- ✅ Detects viewport changes via IntersectionObserver
- ✅ Auto-fetches missing ranges with buffer
- ✅ Applies JSON Patches from other clients

## Critical: @Stateful Array Injection Pattern

**❌ WRONG** - Class property initialization:
```typescript
export default class TodoList {
  items: Item[] = [];  // ❌ Will NOT be reactive

  constructor() {
    this._generateItems();
  }
}
```

**✅ CORRECT** - Constructor-level injection:
```typescript
export default class TodoList {
  items: Item[];  // Type annotation only

  constructor() {
    this.items = [];  // ✅ Injected here with default value
    this._generateItems();
  }
}
```

**Why?** The @stateful decorator works by intercepting instance initialization. Array must be injected at constructor level for proper reactive tracking.

## How the Framework Works

### Phase 1: Method Call
```typescript
// User calls: list(start: 0, limit: 20)
// Framework detects this is a @stateful method returning an array
```

### Phase 2: Auto-Wrap Pagination
```typescript
// Framework intercepts the array result: [item0, item1, ..., item19]
// Wraps with metadata from GlobalInstanceManager
const response = {
  items: [item0, item1, ..., item19],
  _pagination: {
    totalCount: 100,      // Total items in this.items
    start: 0,             // Start index
    end: 20,              // End index (exclusive)
    hasMore: true         // More items exist beyond end
  }
};
```

### Phase 3: Client-Side ViewportAwareProxy
```typescript
// Browser creates ViewportAwareProxy for intelligent pagination:
const proxy = new ViewportAwareProxy(response._pagination, {
  fetch: (start, limit) => call('method', { start, limit }),
  onFetched: (items) => updateUI(items),
  onPatched: (patches) => applyPatches(items, patches)
});

// IntersectionObserver detects visible items
// ViewportManager calls: proxy.setViewport(30, 50)
// Proxy auto-fetches missing ranges with buffer [25, 55]
```

### Phase 4: Multi-Client Sync
```typescript
// Client A adds item: photon.add('New Task')
// Server broadcasts: { op: "add", path: "/items/0", value: {...} }
// All other clients receive patch
// ViewportAwareProxy.applyPatches() updates local cache
// UI re-renders if affected items are visible
```

## API Reference

### Method Signature

```typescript
async list(
  start: number = 0,      // Starting index (0-based)
  limit: number = 20      // Max items to return
): Promise<Item[]>        // Just return the slice!
```

### Pagination Metadata

```typescript
interface PaginationMetadata {
  totalCount: number;     // Total items across all pages
  start: number;          // Start index of this page
  end: number;            // End index (exclusive)
  hasMore: boolean;       // Whether more items exist
  hasMoreBefore?: boolean // Optional: items before start?
}
```

### Response Format

```typescript
interface PaginatedResponse<T> {
  items: T[];
  _pagination: PaginationMetadata;
}
```

## Common Patterns

### Filtered/Searched List

```typescript
export default class SearchPhoton {
  items: Item[];

  constructor() {
    this.items = [];
  }

  async search(
    query: string,
    start: number = 0,
    limit: number = 20
  ): Promise<Item[]> {
    const filtered = this.items.filter(item =>
      item.title.toLowerCase().includes(query.toLowerCase())
    );

    return filtered.slice(start, start + limit);
  }
}
```

### Sorted List

```typescript
async sorted(
  sortBy: 'date' | 'title' = 'date',
  start: number = 0,
  limit: number = 20
): Promise<Item[]> {
  let sorted = [...this.items];

  if (sortBy === 'date') {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  }

  return sorted.slice(start, start + limit);
}
```

### Filtered + Sorted

```typescript
async filteredAndSorted(
  status: 'done' | 'pending',
  sortBy: 'date' | 'priority',
  start: number = 0,
  limit: number = 20
): Promise<Item[]> {
  let items = this.items.filter(item => item.status === status);

  if (sortBy === 'date') {
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    items.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
  }

  return items.slice(start, start + limit);
}
```

### Mutations Auto-Broadcast

```typescript
// Add item - automatically broadcasts add patch
async add(title: string): Promise<Item> {
  const item = { id: uuid(), title, done: false };
  this.items.unshift(item);  // Patch: { op: "add", path: "/items/0", value: item }
  return item;
}

// Update item - automatically broadcasts replace patch
async update(id: string, title: string): Promise<Item | null> {
  const index = this.items.findIndex(i => i.id === id);
  if (index === -1) return null;

  this.items[index] = { ...this.items[index], title };
  // Patch: { op: "replace", path: "/items/N", value: updated }
  return this.items[index];
}

// Delete item - automatically broadcasts remove patch
async delete(id: string): Promise<boolean> {
  const index = this.items.findIndex(i => i.id === id);
  if (index === -1) return false;

  this.items.splice(index, 1);
  // Patch: { op: "remove", path: "/items/N" }
  return true;
}
```

## Performance Considerations

### Page Size by Device

The framework automatically adjusts page sizes:

| Device | Page Size | Buffer | Rationale |
|--------|-----------|--------|-----------|
| Mobile | 10 | 5 | Low bandwidth, small screens |
| Tablet | 50 | 7 | Medium bandwidth, medium screens |
| Desktop | 100 | 10 | High bandwidth, large screens |

### Buffer Calculation

```typescript
// If viewport shows items 30-50, buffer size is 5:
fetchStart = 30 - 5 = 25
fetchEnd = 50 + 5 = 55
// Fetch range [25, 55] = 30 items (5 + 20 + 5)
```

Benefits:
- ✅ Smoother scrolling (prefetched data)
- ✅ Fewer network requests (batched fetches)
- ✅ Reduced flicker (items ready when needed)

### Cache Management

ViewportAwareProxy uses **LRU (Least Recently Used)** cache eviction:

```typescript
// Cache size: 500 items by default
// When fetching new range exceeds cache:
// 1. Identify items furthest from viewport
// 2. Evict LRU items to make room
// 3. Keep items near viewport cached

// Example: Viewport at items 50-70, cache size 500
// - Items 0-30 are candidates for eviction (far from viewport)
// - Items 50-70 stay cached (in viewport)
// - Items 80-100 stay cached (near viewport, likely needed soon)
```

### Deduplication

Concurrent requests for same range are automatically deduplicated:

```typescript
// User scrolls rapidly, triggering fetches:
// - Request 1: fetch(30, 20) starts
// - Request 2: fetch(30, 20) queued (duplicate)
// - Request 1 completes, updates cache
// - Request 2 skipped (already cached)
// Result: 1 network request instead of 2
```

## Troubleshooting

### Items Not Loading

**Check:**
1. Is method named with (start, limit) parameters?
2. Does method return array (not object with items key)?
3. Is photon marked @stateful?

```typescript
// ✅ Correct
async list(start: number = 0, limit: number = 20): Promise<Item[]> {
  return this.items.slice(start, limit);
}

// ❌ Wrong - returns object instead of array
async list(start: number = 0, limit: number = 20) {
  return { items: this.items.slice(start, limit) };
}
```

### Scrolling Jumps

**Solutions:**
- Increase buffer size (prefetch more items)
- Increase page size (fewer requests, more data per request)
- Check for slow network (use Chrome DevTools)

### Memory Usage High

**Solutions:**
- Reduce page size (fewer items in cache)
- Reduce cache max size (smaller cache)
- Implement item cleanup (remove old items not in viewport)

### Multi-Client Sync Not Working

**Check:**
1. Is photon @stateful?
   ```typescript
   /**
    * @stateful
    */
   export default class MyPhoton { ... }
   ```

2. Are mutations modifying items array?
   ```typescript
   // ✅ Correct - mutates array
   this.items.unshift(item);

   // ❌ Wrong - assigns new array (doesn't emit patch)
   this.items = [item, ...this.items];
   ```

3. Is array injected at constructor level?
   ```typescript
   // ✅ Correct
   constructor() {
     this.items = [];
   }

   // ❌ Wrong - class property
   items: Item[] = [];
   ```

## Testing Pagination

### Unit Test Example

```typescript
import { describe, it, expect } from 'vitest';
import MyPhoton from './my-photon';

describe('Pagination', () => {
  it('returns correct page with metadata', async () => {
    const photon = new MyPhoton();
    const result = await photon.list(0, 20);

    expect(result).toHaveLength(20);
    expect(result[0]).toHaveProperty('id');
  });

  it('handles boundary cases', async () => {
    const photon = new MyPhoton();
    const result = await photon.list(95, 20);  // Request beyond dataset

    expect(result).toHaveLength(5);  // Only 5 items remaining
  });

  it('mutations trigger broadcasts', async () => {
    const photon = new MyPhoton();
    const added = await photon.add('New Item');

    expect(photon.count()).toBe(1);
    expect(added).toHaveProperty('id');
  });
});
```

### Integration Test Example

```typescript
// Simulate Beam UI behavior
const photon = new MyPhoton();

// 1. Initial page load
const firstPage = await photon.list(0, 20);
console.log('Initial:', firstPage.length);  // 20

// 2. Simulate scrolling (user sees items 30-50)
const nextPage = await photon.list(30, 20);
console.log('Scrolled:', nextPage.length);  // 20

// 3. Add item on another client
await photon.add('New Item');
console.log('Total count:', photon.count());  // 101 (was 100)

// 4. Verify patch would be broadcast to other clients
// In real app: global listener catches broadcast and applies patch
```

## See Also

- [Pagination API Reference](./PAGINATION-API.md)
- [Pagination Quick Start](./QUICK-START.md)
- [Implementation Guide](./PAGINATION-IMPLEMENTATION-GUIDE.md)
- [Example Photon](../../photons/paginated-list.ts)
- [Integration Tests](../../tests/pagination-integration.test.ts)
