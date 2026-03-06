# Viewport-Based Pagination Implementation Guide

## Overview

The Photon framework provides automatic viewport-aware pagination for @stateful photons that return paginated data. The framework handles:

- **Client-side viewport tracking** via IntersectionObserver API
- **Smart data fetching** based on visible range with configurable buffer
- **Intelligent caching** with LRU eviction and micro-task batching
- **JSON Patch synchronization** across multiple clients
- **Multi-client state consistency** without full refresh

## Quick Start

### 1. Define Pagination Metadata Format

All paginated responses must include the `_pagination` field:

```typescript
interface PaginationMetadata {
  totalCount: number;      // Total items available
  start: number;           // Start index (inclusive)
  end: number;             // End index (exclusive)
  hasMore: boolean;        // Whether more items exist beyond current end
  hasMoreBefore?: boolean; // Optional: whether items exist before start
}

interface PaginatedResponse<T> {
  items: T[];
  _pagination: PaginationMetadata;
}
```

### 2. Implement Paginated Method

```typescript
import type { PhotonRequest } from '@portel/photon-core';

export default class MyPhoton {
  private _allItems: MyItem[] = [];

  /**
   * Return paginated items with metadata
   *
   * The framework calls this when viewport changes
   * ViewportAwareProxy manages caching and fetching
   */
  async items(start: number = 0, limit: number = 20): Promise<PaginatedResponse<MyItem>> {
    const end = Math.min(start + limit, this._allItems.length);
    const items = this._allItems.slice(start, end);

    return {
      items,
      _pagination: {
        totalCount: this._allItems.length,
        start,
        end,
        hasMore: end < this._allItems.length,
      },
    };
  }

  /**
   * CRUD operations automatically emit JSON Patches
   * The @stateful decorator handles this
   */
  async add(title: string): Promise<MyItem> {
    const item = { id: crypto.randomUUID(), title };
    this._allItems.unshift(item); // Add at beginning

    // Framework automatically broadcasts:
    // {
    //   instance: "myPhoton",
    //   patches: [{ op: "add", path: "/items/0", value: item }]
    // }
    return item;
  }
}
```

## Architecture

### Three-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│                    Beam UI (Browser)                        │
├─────────────────────────────────────────────────────────────┤
│  ViewportManager (IntersectionObserver)                     │
│  └─ Detects visible items and calls setViewport()         │
├─────────────────────────────────────────────────────────────┤
│  ViewportAwareProxy (Client-side Facade)                    │
│  └─ Tracks viewport, caches items, applies patches        │
├─────────────────────────────────────────────────────────────┤
│  MCP Client (WebSocket/SSE)                                 │
│  └─ Receives state-changed events with patches             │
└─────────────────────────────────────────────────────────────┘
         ↓ state-changed event ↑
┌─────────────────────────────────────────────────────────────┐
│             Photon Server (Daemon)                          │
├─────────────────────────────────────────────────────────────┤
│  @stateful decorator wraps methods                          │
│  └─ Emits JSON Patches on state changes                    │
├─────────────────────────────────────────────────────────────┤
│  Daemon pub/sub (Unix socket)                               │
│  └─ Routes instance-scoped channels to all clients         │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Initial Load**
   - Client requests: `call tool 'photon/items' with {start: 0, limit: 20}`
   - Server returns: `{ items: [...], _pagination: {...} }`
   - Framework creates ViewportAwareProxy, initializes cache

2. **Viewport Change** (user scrolls)
   - IntersectionObserver detects change
   - ViewportManager calls `proxy.setViewport(30, 50)`
   - ViewportAwareProxy calculates buffer: `[25, 55]`
   - Auto-fetches missing ranges: `[20, 25]` and `[50, 55]`
   - Updates cache, emits 'fetched' event

3. **Remote Update** (another client calls `add()`)
   - Server broadcasts via daemon: `state-changed` event
   - MCP client receives: `{ instance: "photon", patches: [{ op: "add", path: "/items/0", ... }] }`
   - GlobalInstanceManager applies patch
   - ViewportAwareProxy receives patch event
   - Updates cache, emits 'patched' event
   - UI re-renders if item is in viewport

4. **Cache Pruning**
   - When cache exceeds `maxCacheSize`, LRU items are removed
   - Priority given to items near viewport center
   - Oldest items furthest from viewport removed first

## ViewportAwareProxy Configuration

```typescript
interface FetchOptions {
  pageSize?: number;      // Default: 20 (items per fetch request)
  bufferSize?: number;    // Default: 5 (items above/below viewport to prefetch)
  maxCacheSize?: number;  // Default: 1000 (max items to cache)
}

// Framework auto-detects device type:
// - Mobile (width < 768px): pageSize = 10
// - Tablet (width < 1024px): pageSize = 50
// - Desktop: pageSize = 100
```

## ViewportManager Options

```typescript
interface ViewportManagerOptions {
  container: HTMLElement;      // Scrollable container
  itemSelector: string;        // CSS selector for items (must have data-index)
  pageSize?: number;           // Items per page (from device detection)
  bufferSize?: number;         // Buffer size in items
  threshold?: number | number[]; // IntersectionObserver threshold
  rootMargin?: string;         // IntersectionObserver rootMargin
}

// HTML items must have data-index attribute:
// <div data-index="0">Item 0</div>
// <div data-index="1">Item 1</div>
// ...
```

## JSON Patch Operations

The framework uses RFC 6902 JSON Patch format for all state changes:

### Add Operation
```json
{
  "op": "add",
  "path": "/items/0",
  "value": { "id": "new-id", "title": "New Item" }
}
```
Effect: Inserts item at index 0, shifts others down. `totalCount++`

### Remove Operation
```json
{
  "op": "remove",
  "path": "/items/5"
}
```
Effect: Deletes item at index 5, shifts others up. `totalCount--`

### Replace Operation
```json
{
  "op": "replace",
  "path": "/items/3",
  "value": { "id": "id-3", "title": "Updated Item" }
}
```
Effect: Updates item at index 3 in-place. `totalCount` unchanged

### Move Operation (optional)
```json
{
  "op": "move",
  "from": "/items/0",
  "path": "/items/10"
}
```
Effect: Moves item from index 0 to index 10

### Copy Operation (optional)
```json
{
  "op": "copy",
  "from": "/items/0",
  "path": "/items/5"
}
```
Effect: Duplicates item at index 0 to index 5

## Event System

### ViewportAwareProxy Events

```typescript
// Initialize - when data is first loaded
proxy.on('initialized', (data) => {
  console.log('Total items:', data.pagination.totalCount);
});

// Fetch - when a range is fetched from server
proxy.on('fetched', (data) => {
  console.log(`Fetched items ${data.start}-${data.end}`);
});

// Patch - when a patch is applied
proxy.on('patched', (data) => {
  console.log('Applied patches:', data.patches);
});

// Cache cleared
proxy.on('cache-cleared', () => {
  console.log('Cache cleared');
});
```

### GlobalInstanceManager Events

```typescript
// Listen to photon instance changes
const manager = getGlobalInstanceManager();

manager.on('state-changed', (data) => {
  console.log(`Photon ${data.instance} changed:`, data.patches);
});
```

## Intelligent Caching Strategy

### When to Fetch
- Item is requested but not in cache
- Viewport moves beyond cached range
- Cache exceeds max size (prune LRU)

### Cache Eviction
When cache exceeds `maxCacheSize`:
1. Calculate viewport center position
2. Sort cached items by distance from center
3. Remove items furthest from viewport

### Deduplication
- Prevent duplicate fetch requests for same range
- Pending requests tracked by `${start}-${end}` key
- Concurrent requests to same range resolved with single fetch

## Handling Patches Intelligently

### Client-side Patch Application

ViewportAwareProxy applies patches with these rules:

1. **Add operation** at index N
   - All cached items at index ≥ N shift right by 1
   - New item inserted at index N
   - `totalCount++`

2. **Remove operation** at index N
   - All cached items at index > N shift left by 1
   - Item at index N deleted
   - `totalCount--`

3. **Replace operation** at index N
   - Item at index N replaced in-place
   - No index shifting
   - `totalCount` unchanged

4. **Move/Copy operations**
   - Full cache re-index operation
   - Maintains consistency across clients

### Patch Batching
Multiple patches are batched into single event:
```typescript
proxy.applyPatches([
  { op: "add", path: "/items/0", value: {...} },
  { op: "add", path: "/items/1", value: {...} },
  { op: "replace", path: "/items/2", value: {...} }
]);
// Single 'patched' event emitted
```

## Multi-Client Synchronization

### Event Transmission Format

Server broadcasts to all clients:
```typescript
{
  instance: "photonName",      // Which photon changed
  patches: [                   // RFC 6902 patches
    { op: "add", path: "/items/0", value: {...} }
  ]
}
```

### Daemon-level Routing

Internally, daemon uses instance-scoped channels:
```
photon:instance:state-changed
```

This ensures:
- Each instance routes independently
- Changes to one photon don't affect others
- Efficient filtering for interested clients

## Best Practices

### 1. Always Include Pagination Metadata
```typescript
// ❌ Wrong - no metadata
return { items: [...] };

// ✅ Correct - includes _pagination
return {
  items: [...],
  _pagination: { totalCount, start, end, hasMore }
};
```

### 2. Use Data-Index for Items
```html
<!-- ❌ Wrong - no data-index -->
<div>Item Title</div>

<!-- ✅ Correct - data-index matches cache key -->
<div data-index="5">Item Title</div>
```

### 3. Handle Pagination Edge Cases
```typescript
// Clamp to valid range
const start = Math.max(0, start);
const end = Math.min(start + limit, totalCount);

// Always provide correct hasMore
const hasMore = end < totalCount;
```

### 4. Use Appropriate Buffer Size
```typescript
// Small lists: buffer = 2-3 items
{ container, itemSelector, bufferSize: 3 }

// Medium lists: buffer = 5-10 items
{ container, itemSelector, bufferSize: 7 }

// Large lists: buffer = 10-20 items
{ container, itemSelector, bufferSize: 15 }
```

### 5. Monitor Cache Size
```typescript
// For datasets < 10,000 items: maxCacheSize = 500-1000
// For datasets 10,000-100,000: maxCacheSize = 1000-5000
// For datasets > 100,000: maxCacheSize = 5000-10000

// Larger cache = less fetching but more memory
// Smaller cache = more fetching but lighter memory
```

## Example: Todo List with Pagination

See `../photons/paginated-list.ts` for a complete working example with:
- 100 sample items
- `list(start, limit)` paginated fetch
- `add(title, description)` creates new item
- `update(id, title, description)` modifies existing
- `delete(id)` removes item
- All operations emit JSON Patches automatically

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Initial fetch | O(1) | MCP call, server returns slice |
| Viewport change | O(cache size) | Find missing ranges, initiate fetches |
| Patch application | O(n) | n = items from patch position to end |
| Cache lookup | O(1) | Map-based cache |
| Cache eviction | O(n log n) | n = cache size, once per max size threshold |

## Troubleshooting

### Issue: Items not loading
- **Check**: Is `_pagination` metadata included?
- **Check**: Are items in viewport correctly detected (data-index)?
- **Check**: Is ViewportManager active (`manager.start()` called)?

### Issue: Old items showing when new items added
- **Check**: Are patches being applied correctly?
- **Check**: Is `maxCacheSize` too large?
- **Solution**: Clear cache on major state change: `proxy.clearCache()`

### Issue: Excessive API calls
- **Check**: Is `bufferSize` too small? Increase to 10+
- **Check**: Is `pageSize` appropriate for device type?
- **Solution**: Use `getPageSizeForClient()` for auto-detection

### Issue: Memory usage too high
- **Check**: Is `maxCacheSize` too large?
- **Solution**: Reduce cache size or clear periodic: `setInterval(() => proxy.clearCache(), 60000)`

### Issue: Patches not applied to UI
- **Check**: Are you listening to 'patched' event?
- **Check**: Is GlobalInstanceManager initialized?
- **Solution**: Verify event handler is attached: `proxy.on('patched', handler)`

## See Also

- `src/auto-ui/frontend/services/viewport-aware-proxy.ts` - Client-side pagination proxy
- `src/auto-ui/frontend/services/viewport-manager.ts` - IntersectionObserver integration
- `tests/viewport-aware-proxy.test.ts` - Comprehensive test examples
- `tests/viewport-manager.test.ts` - Viewport tracking tests
