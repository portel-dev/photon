# Viewport-Based Infinite Scrolling Architecture

## Overview

A framework-managed pagination system where:
1. **Framework handles viewport attachment** - Users attach UI components to framework, not manage pagination manually
2. **Server broadcasts all state changes** - Simple `state-changed` events with JSON Patch format
3. **Client-side smart fetching** - Framework decides what data to fetch based on patches relative to viewport
4. **Global photon instances** - `window.boards` (or photon name) automatically keeps data synchronized
5. **Multiple pagination strategies** - Each client can implement different page sizes and fetching logic

## Architecture Layers

### Layer 1: Global Instance Injection (Frontend)
**Location:** `src/auto-ui/frontend/services/photon-instance-manager.ts` (NEW)

```typescript
// User code
const boards = window.boards;  // Global reference injected by framework

// Automatically synced with server via state-changed events
boards.items  // Array of items, always contains viewport data
boards.on('state-changed', (patches) => {
  // Framework already applied patches, user code just reacts
});
```

**Responsibility:**
- Create proxy objects that mirror server instances
- Apply `state-changed` patches to local state
- Emit local events when state changes
- Maintain viewport tracking info
- Manage pagination state (page, pageSize, hasMore)

### Layer 2: Viewport Management (Framework)
**Location:** `src/auto-ui/frontend/services/viewport-manager.ts` (NEW)

```typescript
// Framework API (internal, users don't call this directly)
framework.setViewport(boards, {
  element: uiElement,      // DOM element to track
  pageSize: 20,            // Items per page
  fetchStrategy: 'auto'    // auto | lazy | aggressive
});

// Framework handles:
// - Tracking which items are visible
// - Computing padding needed above/below
// - Calling framework.fetchRange() when viewport changes
```

**Responsibility:**
- Observe DOM element for scroll position
- Calculate visible viewport range
- Decide what data range to keep in memory
- Trigger smart fetching based on patches
- Handle page size changes

### Layer 3: Smart Fetching Logic (Client)
**Location:** `src/auto-ui/frontend/services/smart-fetcher.ts` (NEW)

When `state-changed` patches arrive:
1. Determine patch location relative to viewport
   - **Within viewport**: Already have data, apply patch
   - **Before viewport**: May need to fetch earlier items
   - **After viewport**: May need to fetch later items
2. Decide if fetching is needed
   - Padding cushion above/below determines threshold
   - If items added before viewport and padding depleted, fetch older items
   - If items added after viewport and padding depleted, fetch newer items
3. Fetch missing ranges via method call

**Responsibility:**
- Parse JSON Patch to determine what changed
- Calculate fetch ranges needed
- Make paginated method calls to server
- Cache strategy per client type (mobile 10, desktop 100, etc.)

### Layer 4: Server-Side Change Broadcasting
**Location:** `src/auto-ui/beam.ts` (EXISTING - refinements only)

```typescript
// Server broadcasts all changes as JSON Patch
broadcastNotification('state-changed', {
  instance: 'boards',
  patches: [
    { op: 'add', path: '/items/0', value: { id: 1, ... } },
    { op: 'remove', path: '/items/5' }
  ]
});
```

**Server doesn't need to know:**
- Viewport position
- Client page sizes
- Pagination strategy
- What data client is displaying

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  USER CODE (runs in iframe or custom UI)               │
│                                                         │
│  const boards = window.boards;                         │
│  boards.items.forEach(item => renderItem(item));       │
│  boards.on('state-changed', () => rerender());         │
└──────────────┬──────────────────────────────────────────┘
               │
               │ (users attach UI to framework)
               ▼
┌─────────────────────────────────────────────────────────┐
│  VIEWPORT MANAGER (Framework - internal)               │
│                                                         │
│  - Observes scroll position                            │
│  - Calculates visible range + padding                  │
│  - Emits fetchNeeded() when viewport changes           │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────┐
│  SMART FETCHER (Framework - internal)                  │
│                                                         │
│  - Listens to state-changed patches                    │
│  - Computes what's needed based on viewport            │
│  - Makes paginated method calls                        │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼ (HTTP/MCP POST)
    ┌──────────────────────────┐
    │  SERVER (Beam)           │
    │  boards.getRange(...)    │
    │  boards.getItem(...)     │
    └──────────────────────────┘
               │
               ▼ (SSE broadcast)
    state-changed event with JSON Patch
               │
               ▼
   ┌──────────────────────────────────────┐
   │ GLOBAL INSTANCE MANAGER (Framework)  │
   │ - Applies patches to window.boards   │
   │ - Emits local 'state-changed' event  │
   └──────────────────────────────────────┘
               │
               ▼
         (back to user code)
```

## Implementation Phases

### Phase 1: Global Instance Injection
**Goal:** Make photon instances available in window scope and keep them synced

**Files:**
- `src/auto-ui/frontend/services/photon-instance-manager.ts` (NEW)
  - `createProxyInstance()` - Create sync'able instance proxy
  - `applyPatches()` - Apply JSON Patch array to instance
  - `getGlobalInstanceName()` - Derive window property name from photon

**Server-side changes:**
- `src/auto-ui/frontend/services/mcp-client.ts` - Update handler for `state-changed` events to sync global instance
- `src/auto-ui/frontend/components/beam-app.ts` - Initialize global instances on startup

### Phase 2: Viewport Tracking
**Goal:** Framework can observe scroll positions and compute visible ranges

**Files:**
- `src/auto-ui/frontend/services/viewport-manager.ts` (NEW)
  - `setViewport()` - Attach framework to UI element
  - `getVisibleRange()` - Compute [startIndex, endIndex] of visible items
  - `getPaddingNeeded()` - Calculate how much buffer above/below

**Configuration:**
- Client type detection (mobile vs desktop vs analytics)
- Page size per client type
- Padding multiplier (how much extra to keep in memory)

### Phase 3: Smart Fetching
**Goal:** Framework automatically fetches data based on patches and viewport

**Files:**
- `src/auto-ui/frontend/services/smart-fetcher.ts` (NEW)
  - `analyzePatches()` - Determine op types and locations
  - `computeFetchRanges()` - Based on patches + viewport, what ranges needed
  - `fetchRange()` - Async method to load range of items

**Fetch strategies:**
- `auto` (default) - Fetch when padding threshold crossed
- `lazy` - Only fetch when user scrolls near boundary
- `aggressive` - Pre-fetch extra items in background

### Phase 4: UI Component Integration
**Goal:** Custom UI components can declare their pagination needs

**Locations:**
- Update `src/auto-ui/frontend/components/beam-app.ts` to initialize viewport manager
- Add helper utilities for custom UI code to use

## Key Design Decisions

### 1. Server doesn't know about viewport
✅ Simpler server code
✅ Each client type can have different pagination
✅ Easier to test (no viewport state to mock)
❌ Client must request data via separate paginated methods

### 2. All events use same `state-changed` channel
✅ Reduces transmission noise
✅ Client decides relevance based on viewport
✅ Simple event protocol
❌ Client does more work to filter patches

### 3. Framework manages viewport, users don't
✅ Less code for users to write
✅ Consistent pagination behavior across UIs
❌ Must support multiple pagination strategies somehow

### 4. Global instance = source of truth
✅ UI always uses latest synced data
✅ No local caching inconsistencies
✅ Reactive binding works automatically
❌ Can't use instance selectively (all or nothing)

## API Examples

### For Custom UI Developers

```typescript
// In your custom UI code (running in iframe or custom element)
const boards = window.boards;

// Attach UI to framework viewport tracking
if (window.__framework) {
  window.__framework.setViewport(boards, {
    element: document.getElementById('items-list'),
    pageSize: navigator.devicePixelRatio < 2 ? 100 : 20,  // Desktop vs mobile
    fetchStrategy: 'auto'
  });
}

// Listen to changes (framework already synced the data)
boards.on('state-changed', (patches) => {
  // Re-render list using boards.items (already patched)
  renderItems();
});

// Call server methods normally
async function createItem(text) {
  const item = await boards.add({ text });
  // framework auto-fetches if needed, syncs instance
  // boards.items automatically includes new item
}
```

### For Framework Developers

```typescript
// In beam-app.ts
const photonInstance = { ...boards };  // Server state
const proxiedInstance = new PhotonInstanceProxy(photonInstance);
window.boards = proxiedInstance;

// On state-changed event
const smartFetcher = new SmartFetcher(proxiedInstance, {
  strategy: 'auto',
  pageSize: 20
});

smartFetcher.onPatchesReceived((patches) => {
  // Applies patches, decides if fetch needed
  // Auto-fetches via photon method call if required
});

// When UI attaches
viewportManager.setViewport(proxiedInstance, {
  element: listElement,
  pageSize: 20,
  fetchStrategy: 'auto'
});
```

## Testing Strategy

### Unit Tests
- `tests/viewport-manager.test.ts`
  - Visible range calculation
  - Padding computation
  - Viewport change detection

- `tests/smart-fetcher.test.ts`
  - Patch location analysis
  - Fetch range computation
  - De-duplication of overlapping ranges

- `tests/photon-instance-manager.test.ts`
  - Patch application
  - Event emission
  - Instance proxy behavior

### Integration Tests
- `tests/viewport-pagination-e2e.test.ts`
  - Add items → patches arrive → smart fetcher fetches → UI renders
  - Scroll viewport → fetches new range
  - Multiple clients with different page sizes
  - Reset pagination

### Manual Testing
- Beam with large dataset (10k+ items)
- Mobile device (different viewport, smaller page size)
- Scroll performance (60fps?)
- Network lag simulation

## Future Enhancements

1. **Lazy loading state** - Show loading indicators in viewport
2. **Scroll position preservation** - Remember scroll position on navigation
3. **Bidirectional sync** - When user adds/removes locally, sync to server
4. **Range notifications** - Server can notify clients of data availability
5. **Persistence** - Cache fetched ranges to LocalStorage for offline
6. **Virtual scrolling** - Only render visible items, not entire list
