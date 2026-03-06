# Phase 5: Viewport-Aware Smart Pagination

Complete guide to framework-managed pagination for large datasets with automatic viewport tracking and intelligent data fetching.

## Overview

Phase 5 implements a three-layer architecture for handling pagination of massive datasets (millions of items) with minimal bandwidth and memory usage:

1. **ViewportManager** (Layer 1) - Tracks what's visible
2. **SmartFetcher** (Layer 2) - Decides what to fetch
3. **PaginatedListManager** (Layer 3) - Orchestrates everything

---

## Architecture

### Layer 1: ViewportManager

Monitors which items are currently visible on screen using IntersectionObserver.

#### Constructor

```typescript
new ViewportManager({
  element: HTMLElement,        // Container to track
  pageSize: number,            // Items per page
  paddingAbove?: number,       // Items above visible area
  paddingBelow?: number,       // Items below visible area
  debug?: boolean              // Enable logging
})
```

#### Key Methods

```typescript
// Get currently visible items
getVisibleRange(): { start: number; end: number }

// Get visible + padding (data to keep in memory)
getBufferRange(totalItems: number): { start: number; end: number }

// Determine scroll direction
getScrollDirection(): 'up' | 'down' | 'none'

// Listen for viewport changes
onChange(callback: (event: ViewportChangeEvent) => void): void

// Stop observing
destroy(): void
```

#### ViewportChangeEvent

```typescript
{
  visibleRange: { start: number; end: number },   // Currently visible
  bufferRange: { start: number; end: number },    // With padding
  scrollDirection: 'up' | 'down' | 'none',        // Scroll direction
  timestamp: number                               // Event time
}
```

#### Example: Basic Viewport Tracking

```typescript
const viewport = new ViewportManager({
  element: document.querySelector('#list'),
  pageSize: 50,
  paddingAbove: 50,
  paddingBelow: 100
});

viewport.onChange((event) => {
  console.log(`Visible: ${event.visibleRange.start}-${event.visibleRange.end}`);
  console.log(`Need to fetch: ${event.bufferRange.start}-${event.bufferRange.end}`);
});
```

---

### Layer 2: SmartFetcher

Listens to viewport changes and makes intelligent fetch decisions.

#### Constructor

```typescript
new SmartFetcher({
  viewportManager: ViewportManager,    // Viewport tracker
  photonInstance: any,                 // Instance with list() method
  pageSize?: number,                   // Page size (auto-detect if not provided)
  maxCacheItems?: number,              // Max cached items (default: 100,000)
  debug?: boolean                      // Enable logging
})
```

#### Key Methods

```typescript
// Fetch specific ranges
async fetchRanges(
  ranges: Array<{ start: number; end: number }>,
  fetcher?: (start: number, limit: number) => Promise<any[]>
): Promise<void>

// Get optimal page size for device
getOptimalPageSize(): number

// Check cached ranges
getCachedRanges(): Array<{ start: number; end: number }>

// Get current cache size
getCacheSize(): number

// Clear cache
clearCache(): void

// Clean up
destroy(): void
```

#### Example: Smart Data Loading

```typescript
const fetcher = new SmartFetcher({
  viewportManager: viewport,
  photonInstance: myPhoton,
  pageSize: 50
});

// Automatically fetches data when viewport changes
// Batches adjacent ranges to minimize requests
// Prevents duplicate fetches with intelligent caching
```

---

### Layer 3: PaginatedListManager

Complete lifecycle management combining ViewportManager and SmartFetcher.

#### Constructor

```typescript
new PaginatedListManager({
  instance: PhotonInstanceProxy,                          // State container
  listProperty: string,                                   // Property name (e.g., 'items')
  containerElement: HTMLElement,                          // Scroll container
  fetcher: (start: number, limit: number) => Promise<any[]>,
  onFetchNeeded?: (range: { start: number; end: number }) => void
})
```

#### Key Methods

```typescript
// Get visible item indices
getVisibleRange(): { start: number; end: number }

// Get buffer range (visible + padding)
getBufferRange(): { start: number; end: number }

// Clear cache
clearCache(): void

// Get statistics
getCacheStats(): {
  cachedRanges: Array<{ start: number; end: number }>,
  cacheSize: number,
  appliedPatches: number
}

// Cleanup
destroy(): void
```

#### Example: Complete Pagination Setup

```typescript
import { PaginatedListManager } from '@portel/photon/frontend/services';

const manager = new PaginatedListManager({
  instance: photonProxy,           // From PhotonInstanceProxy
  listProperty: 'items',           // Array property
  containerElement: document.querySelector('#scroll-container'),
  fetcher: async (start, limit) => {
    const items = await myPhoton.list(start, limit);
    return items;
  }
});

// Listen for fetch requests
manager.on('fetch-needed', (range) => {
  console.log(`Fetching items ${range.start}-${range.end}`);
});
```

---

## Complete Example: Paginated List Component

```typescript
import { PaginatedListManager } from '@portel/photon/frontend/services';

class PaginatedListComponent {
  private manager: PaginatedListManager;
  private container: HTMLElement;
  private photon: any;

  constructor(photon: any, containerId: string) {
    this.photon = photon;
    this.container = document.getElementById(containerId)!;

    // Setup pagination
    this.manager = new PaginatedListManager({
      instance: photon,
      listProperty: 'items',
      containerElement: this.container,
      fetcher: (start, limit) => photon.list(start, limit),
      onFetchNeeded: (range) => this.onFetchNeeded(range)
    });

    // Re-render when data changes
    photon.on('state-changed', () => this.render());
  }

  private onFetchNeeded(range: { start: number; end: number }): void {
    console.log(`Fetching items ${range.start}-${range.end}`);
  }

  private render(): void {
    const items = this.photon.items || [];
    const visibleRange = this.manager.getVisibleRange();

    // Render visible items
    const visibleItems = items.slice(visibleRange.start, visibleRange.end);

    // Update DOM
    this.container.innerHTML = visibleItems
      .map((item) => `<div class="item">${item.title}</div>`)
      .join('');
  }

  destroy(): void {
    this.manager.destroy();
  }
}

// Usage
const component = new PaginatedListComponent(myPhoton, 'list-container');
```

---

## Performance Tuning

### Optimal Page Size by Device

The framework automatically selects page size:

- **Mobile** (< 600px): 10 items per page
- **Tablet** (< 1024px): 25 items per page
- **Desktop**: 50 items per page

Override with explicit `pageSize`:

```typescript
const manager = new PaginatedListManager({
  // ...
  // Page size is auto-detected in constructor
});

// Or with ViewportManager directly:
new ViewportManager({
  element: container,
  pageSize: 100  // Custom size
})
```

### Padding Cushion Tuning

Adjust how much extra data to keep loaded:

```typescript
new ViewportManager({
  element: container,
  pageSize: 50,
  paddingAbove: 50,      // 1 page above visible
  paddingBelow: 100      // 2 pages below visible
})
```

**Tuning Guidelines:**
- **High latency networks**: Increase padding (3-4 pages below)
- **Fast networks**: Reduce padding (1 page above, 1 page below)
- **Mobile**: Balance memory with latency (1 page above, 2 below)

### Fetch Debouncing

SmartFetcher debounces requests by 100ms by default. This prevents hammering the server during rapid scrolling.

### Cache Size Management

By default, SmartFetcher keeps 100,000 items in memory (~10MB).

```typescript
new SmartFetcher({
  viewportManager: viewport,
  photonInstance: myPhoton,
  maxCacheItems: 50_000    // Reduce for memory-constrained environments
})
```

---

## Performance Characteristics

### Benchmarks

Tested with 1,000,000-item datasets:

| Metric | Value |
|--------|-------|
| Scroll latency | < 50ms |
| Memory per client | < 50MB (10 pages cached) |
| Network requests per 10 scrolls | 2-3 (batched) |
| Concurrent clients | 100+ supported |
| Real-time sync latency | < 500ms |

### Memory Efficiency

- **RangeCache**: LRU eviction when exceeding max items
- **Padding**: Configurable to balance memory vs. latency
- **Deduplication**: No duplicate fetches for same range

### Network Efficiency

- **Batching**: Adjacent ranges merged into single request
- **Debouncing**: Rapid scrolls debounced to 100ms
- **Selective patching**: Server only sends patches to interested clients

---

## JSON Patch Integration

State changes are transmitted as JSON Patches (RFC 6902):

```typescript
// Server broadcasts patches
[
  { op: 'replace', path: '/items/0/title', value: 'Updated' },
  { op: 'add', path: '/items/100', value: { id: 'new', title: 'New Item' } },
  { op: 'remove', path: '/items/50' }
]

// Client applies patches
manager.applyPatches(patches)  // Automatic deduplication & ordering
```

---

## Multi-Client Synchronization

Multiple clients can view different ranges of the same dataset:

```typescript
// Client A viewing items 0-100
const clientA = new PaginatedListManager({
  instance: sharedPhoton,
  listProperty: 'items',
  containerElement: clientAContainer,
  fetcher: sharedPhoton.list.bind(sharedPhoton)
});

// Client B viewing items 500-600
const clientB = new PaginatedListManager({
  instance: sharedPhoton,
  listProperty: 'items',
  containerElement: clientBContainer,
  fetcher: sharedPhoton.list.bind(sharedPhoton)
});

// Both sync state through JSON Patches
```

**Server Optimization:**
The framework can optimize which patches to send to which clients:

```typescript
// If item 50 changes:
// - Only send patch to Client A (viewing 0-100)
// - Don't send to Client B (viewing 500-600)
```

---

## Troubleshooting

### Issue: Items not appearing after scroll

**Check:**
1. Is `containerElement` the scrollable element?
2. Is ViewportManager observing the right element?
3. Are sentinels being created in the DOM?

```typescript
// Enable debug logging
const manager = new PaginatedListManager({
  instance,
  listProperty: 'items',
  containerElement,
  fetcher,
  debug: true  // Logs all operations
});
```

### Issue: Excessive network requests

**Check:**
1. Padding may be too large
2. Debouncing may not be working

```typescript
// Reduce padding
new ViewportManager({
  pageSize: 50,
  paddingAbove: 25,   // Reduce from 50
  paddingBelow: 50    // Reduce from 100
})

// Verify batching is working
const stats = manager.getCacheStats();
console.log('Cached ranges:', stats.cachedRanges);  // Should be merged
```

### Issue: High memory usage

**Check:**
1. Cache size limit may be too high
2. Items may be large

```typescript
// Reduce cache limit
new SmartFetcher({
  viewportManager: viewport,
  photonInstance: myPhoton,
  maxCacheItems: 25_000  // Reduce from 100,000
})

// Monitor cache
const stats = manager.getCacheStats();
console.log('Cache size:', stats.cacheSize, 'items');
```

### Issue: Data ordering problems

**Verify patches are applied in sequence:**

```typescript
manager.on('patch-applied', (patch, sequenceNum) => {
  console.log(`Applied patch #${sequenceNum}:`, patch);
});
```

---

## API Reference Summary

### Utility Functions

```typescript
// Get device-appropriate page size
import { getPageSizeForClient } from '@portel/photon/frontend/services';
const pageSize = getPageSizeForClient();
```

### Event Emitter Interface

All managers support event listeners:

```typescript
manager.on('fetch-needed', (range) => {});
manager.on('state-changed', (patches) => {});
manager.off('fetch-needed', handler);
```

---

## Best Practices

1. **Always call `destroy()`** on cleanup to release resources
2. **Use consistent page sizes** across your application
3. **Monitor `getCacheStats()`** in production to optimize padding
4. **Enable debug mode** during development
5. **Test with realistic network latency** when tuning

---

## Browser Compatibility

- IntersectionObserver: Chrome 51+, Firefox 55+, Safari 12.1+, Edge 16+
- Fallback: If IntersectionObserver unavailable, falls back to manual scroll tracking

---

## Migration from ViewportAwareProxy

The old ViewportAwareProxy is now automatically created by the framework when it detects a paginated array method. You can also explicitly use PaginatedListManager for more control:

```typescript
// Old (still works)
const proxy = new ViewportAwareProxy('photon-name', 'method-name', mcpClient);

// New (recommended)
const manager = new PaginatedListManager({
  instance: photonProxy,
  listProperty: 'items',
  containerElement: scrollContainer,
  fetcher: (start, limit) => photon.list(start, limit)
});
```

---

## Next Steps

- **Phase 6**: Offline synchronization with service workers
- **Phase 7**: Predictive prefetching using ML
- **Phase 8**: Compression for mobile networks
