# Phase 5: Viewport-Aware Smart Pagination Implementation

## Overview
Build a framework-managed pagination system for large datasets (millions of items) with:
- **Automatic viewport tracking** - Framework knows what's visible
- **Smart fetching** - Predictive data loading based on user scroll
- **Multi-client sync** - JSON Patch updates across concurrent clients
- **Minimal bandwidth** - Only fetch what's needed

## Architecture (4 Layers)

### Layer 1: ViewportManager (Frontend Service)
**File**: `src/auto-ui/frontend/services/viewport-manager.ts` (NEW)

```typescript
// Tracks visible viewport and triggers fetches
export class ViewportManager {
  constructor(element: HTMLElement, photonInstance: any) {
    // Use IntersectionObserver to track visibility
    // Calculate which item indices are visible
    // Maintain padding above/below visible area
  }

  getVisibleRange(): { start: number; end: number } {
    // Return [firstVisibleIndex, lastVisibleIndex]
  }

  getPaddingCushion(): { above: number; below: number } {
    // How much extra data to keep in memory beyond viewport
    // Default: 1 page above, 2 pages below
  }

  onViewportChange(callback: (range: Range) => void) {
    // Trigger when user scrolls and visible range changes
  }
}
```

**Responsibility**:
- Observe DOM element scroll position via IntersectionObserver
- Calculate visible item range (start, end indices)
- Determine padding cushion (extra items to keep loaded)
- Emit events when viewport changes
- Handle page size changes

### Layer 2: SmartFetcher (Client-Side Intelligence)
**File**: `src/auto-ui/frontend/services/smart-fetcher.ts` (NEW)

```typescript
// Decides what data to fetch based on patches
export class SmartFetcher {
  constructor(photonInstance: any, viewportManager: ViewportManager) {}

  onStateChanged(patches: JsonPatch[]) {
    // 1. Parse patches to find what changed
    // 2. Determine patch location relative to viewport
    // 3. Decide if fetching is needed
    // 4. Call photonInstance.list() with smart range
  }

  async fetchRange(start: number, limit: number) {
    // Make method call to fetch paginated data
    // Cache result
    // Update local state
  }

  getOptimalPageSize(): number {
    // Return page size based on:
    // - Device type (mobile: 10-15, desktop: 50-100)
    // - Network speed estimate
    // - Available memory
  }
}
```

**Responsibility**:
- Parse incoming JSON Patch updates
- Calculate which data ranges are affected
- Determine if new data needs to be fetched
- Make optimized fetch calls to server
- Cache strategies per client type

### Layer 3: PhotonInstanceManager (Frontend State)
**File**: `src/auto-ui/frontend/services/photon-instance-manager.ts` (ENHANCE)

Currently handles basic state sync. Extend to:
- Apply patches in correct order
- Maintain cache of fetched ranges
- Emit local events when state changes
- Track pagination metadata

```typescript
// Global instance with smart sync
window.boards = createPhotonInstance('boards-photon', {
  onStateChanged: (patches) => {
    // Apply patches
    // Trigger smart fetching if needed
  }
});

// User code
boards.items  // Always contains viewport data + padding
boards.on('state-changed', (patches) => {
  // Framework already applied patches
  // Just re-render
});
```

### Layer 4: Server-Side Broadcasting (Beam)
**File**: `src/auto-ui/beam.ts` (EXISTING - enhancements)

Already broadcasts state changes. Phase 5 adds:
- Track which clients are viewing which ranges
- Optimize patch granularity (don't send patches client won't use)
- Send pagination metadata with responses

```typescript
// Server knows: client A viewing items 0-20, client B viewing items 100-120
// When item 5 changes: only send patch to client A
// When item 110 changes: only send patch to client B
```

**Responsibility**:
- Broadcast JSON Patches to connected clients
- Include pagination metadata in responses
- Optimize which patches to send to which clients
- Handle client subscriptions to data ranges

## Implementation Phases

### Phase 5a: ViewportManager (Week 1)
- [ ] Create viewport-manager.ts with IntersectionObserver integration
- [ ] Implement visible range calculation
- [ ] Add padding cushion logic
- [ ] Test with scrolling scenarios

### Phase 5b: SmartFetcher (Week 1-2)
- [ ] Parse JSON Patch format
- [ ] Implement range-based fetch logic
- [ ] Add caching layer
- [ ] Optimize page size selection
- [ ] Test with various patch scenarios

### Phase 5c: Instance Manager Enhancement (Week 2)
- [ ] Add ViewportManager to instance lifecycle
- [ ] Integrate SmartFetcher
- [ ] Maintain visible data cache
- [ ] Apply patches in order
- [ ] Emit change events

### Phase 5d: Testing & Validation (Week 2-3)
- [ ] Multi-client scroll simulation
- [ ] Large dataset (1M items) performance tests
- [ ] Patch ordering verification
- [ ] Memory usage profiling
- [ ] Network efficiency measurement

### Phase 5e: Documentation & Examples (Week 3)
- [ ] API documentation
- [ ] Usage examples
- [ ] Performance optimization guide
- [ ] Troubleshooting guide

## Test Suite: `pagination-smart-fetch.test.ts`

```typescript
// Core functionality tests
✓ ViewportManager calculates visible range correctly
✓ SmartFetcher decides when to fetch new ranges
✓ Patches applied in correct order
✓ Cache prevents duplicate fetches
✓ Page size selection by device type
✓ Multi-client concurrent fetches
✓ Large dataset (1M items) performance
✓ Memory stays under limit during scroll
✓ Network requests optimized
```

## Acceptance Criteria

### Performance Targets
- [ ] Handle 1M+ item datasets smoothly
- [ ] Scroll latency < 50ms
- [ ] Memory usage < 50MB per client (10 pages cached)
- [ ] Network: 2-3 requests per 10 scrolls (smart batching)

### Correctness Targets
- [ ] No data gaps when scrolling
- [ ] No data duplication
- [ ] Patches applied in strict order
- [ ] Multi-client state stays consistent

### Scalability
- [ ] 100+ concurrent clients on same dataset
- [ ] Real-time sync latency < 500ms
- [ ] Server CPU stable (not O(n) with client count)

## Risk Mitigation

### Risk: Patch Ordering
**Mitigation**: Implement patch queue with sequence numbers
```typescript
interface PatchFrame {
  sequence: number;
  patches: JsonPatch[];
  timestamp: number;
}
// Only apply when sequence is monotonically increasing
```

### Risk: Memory Leaks
**Mitigation**: Strict cache size limits with LRU eviction
```typescript
class SmartFetcher {
  private maxCacheItems = 100_000;  // ~10MB at ~100 bytes/item
  private cache = new LRUCache(this.maxCacheItems);
}
```

### Risk: Network Storms
**Mitigation**: Request debouncing and batching
```typescript
// Wait 100ms after viewport change before fetching
// Batch multiple requests into single multi-range call
```

## Integration Points

1. **ViewportAwareProxy** (existing)
   - Uses ViewportManager for visible range
   - Returns paginated subset

2. **Beam UI** (existing)
   - Instantiates ViewportManager for each paginated list
   - Passes to SmartFetcher

3. **State-Changed Events** (existing)
   - Feed patches to SmartFetcher
   - SmartFetcher triggers fetches

4. **Method Calls** (existing)
   - ViewportManager informs range needed
   - SmartFetcher calls photon.list(start, limit)

## Success Metrics

- [ ] All 30+ tests passing
- [ ] Beam UI renders 1M item list without lag
- [ ] Multi-client demo shows real-time sync
- [ ] Memory profiling shows stable heap
- [ ] Network log shows smart batching

## Timeline
- **Week 1**: ViewportManager + SmartFetcher core
- **Week 2**: Integration + Enhancement
- **Week 3**: Testing + Documentation

## Post-Phase 5 Roadmap
- Phase 6: Offline sync with service workers
- Phase 7: Predictive prefetching (ML-based)
- Phase 8: Compression for mobile networks
