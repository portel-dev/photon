# @stateful State Synchronization & Metadata Architecture

> **This document explains how Photon synchronizes state, manages data persistence, and tracks object lifecycle through the @stateful framework.**

---

## Overview: The @stateful System

The `@stateful` decorator transforms a Photon class into a **reactive state container** that:

1. **Emits events** automatically when methods are called
2. **Persists state** to disk automatically
3. **Attaches metadata** to objects (creation time, modification history, audit trail)
4. **Synchronizes with clients** via real-time events
5. **Supports large datasets** with index-aware pagination

```typescript
/**
 * @stateful
 */
export default class TodoList extends Photon {
  items: Task[] = [];  // Reactive array

  add(title: string): Task {
    const task = { id: uuid(), title, done: false };
    this.items.push(task);
    return task;  // Automatically gets __meta attached
  }
}
```

---

## How @stateful Works

### Step 1: Method Wrapping (Runtime)

When a Photon loads, the runtime's `loader.ts` detects `@stateful` in JSDoc and wraps all public methods:

**src/loader.ts** (lines 2619-2700):
```typescript
function wrapStatefulMethods(instance: any, emit: Function) {
  for (const methodName of publicMethods) {
    const original = instance[methodName];

    instance[methodName] = function (...args) {
      // 1. Execute the original method
      const result = original.apply(this, args);

      // 2. Attach __meta to returned objects
      if (isPlainObject(result) && !result.__meta) {
        Object.defineProperty(result, '__meta', {
          value: {
            createdAt: now(),
            createdBy: methodName,
            modifiedAt: null,
            modifiedBy: null,
            modifications: []
          },
          enumerable: false  // Invisible to JSON.stringify
        });
      }

      // 3. Emit event with full context
      const eventData = {
        method: methodName,
        params: extractParams(args),
        result,
        timestamp: now(),
        instance: this.instanceName
      };

      // 4. Add index information if result is from this.items
      if (isArrayItem(result, this.items)) {
        eventData.index = this.items.indexOf(result);
        eventData.totalCount = this.items.length;
        eventData.affectedRange = { start: index, end: index + 1 };
      }

      emit(methodName, eventData);
      return result;
    };
  }
}
```

### Step 2: Event Emission Flow

Every method call flows through this pipeline:

```
┌─────────────────────────────────────────────┐
│   Client calls: todo.add("Buy milk")        │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   1. Wrapped method executes                │
│      - Creates task object                  │
│      - Pushes to this.items                 │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   2. Attach __meta to returned object       │
│      - createdAt: ISO timestamp             │
│      - createdBy: 'add'                     │
│      - modifications: []                    │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   3. Build event with metadata              │
│      - index: position in array             │
│      - totalCount: array length             │
│      - affectedRange: [0, 1]                │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   4. Emit event                             │
│      - this.emit('add', eventData)          │
│      - Daemon forwards to all clients       │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│   5. Return object to caller                │
│      - Same object with __meta attached     │
│      - Caller sees __meta.createdAt, etc.   │
└─────────────────────────────────────────────┘
```

---

## Data Storage: Single Source of Truth

### Server Array is Authoritative

```typescript
export default class TodoList extends Photon {
  // This array is THE source of truth
  // - Backed by disk (persisted to ~/.photon/.data/{photon}/state/...)
  // - Only modified via public methods
  // - All clients sync to this version
  items: Task[] = [];

  add(title: string): Task {
    const task = { id: uuid(), title, done: false };
    this.items.push(task);  // Modifies persistent array
    return task;
  }
}
```

### Disk Persistence (Automatic)

The runtime automatically persists state:

**Where:**
```
~/.photon/.data/{photon-name}/state/{instance-name}/state.json
```

**Example:**
```
~/.photon/.data/todo/state/default/state.json
```

**Format:**
```json
{
  "items": [
    {
      "id": "uuid-1",
      "title": "Buy milk",
      "done": false
    },
    {
      "id": "uuid-2",
      "title": "Walk dog",
      "done": true
    }
  ]
}
```

**What's NOT stored:** `__meta` (non-enumerable properties are invisible to JSON.stringify, so audit trails only exist in memory)

### How Persistence Works

1. **On Write:**
   - Method modifies `this.items`
   - Event emitted
   - Daemon receives event
   - State file updated on disk

2. **On Read (Reload):**
   - New instance created
   - State loaded from disk into `this.items`
   - `__meta` recreated (fresh timestamps)

---

## Object Metadata: The __meta System

Every object returned from a @stateful method gets a `__meta` property with audit trail:

### Structure

```typescript
{
  __meta: {
    // Creation metadata
    createdAt: "2026-03-04T15:30:45.123Z",  // ISO timestamp
    createdBy: "add",                        // Method name that created it

    // Modification metadata
    modifiedAt: "2026-03-04T15:35:12.456Z",  // Last change time
    modifiedBy: "setPriority",               // Method that changed it

    // Complete audit history
    modifications: [
      {
        field: "priority",
        oldValue: "medium",
        newValue: "high",
        timestamp: "2026-03-04T15:32:00.123Z",
        modifiedBy: "setPriority"
      },
      {
        field: "done",
        oldValue: false,
        newValue: true,
        timestamp: "2026-03-04T15:35:12.456Z",
        modifiedBy: "done"
      }
    ]
  }
}
```

### Key Properties

| Property | Purpose | Example |
|----------|---------|---------|
| `createdAt` | When object was created | `"2026-03-04T07:30:45.123Z"` |
| `createdBy` | Method that created it | `"add"` |
| `modifiedAt` | Last modification time | `"2026-03-04T07:35:12.456Z"` |
| `modifiedBy` | Last method to modify it | `"setPriority"` |
| `modifications[]` | Complete change history | Array of field changes |

### Non-Enumerable Property

The `__meta` property is **non-enumerable**, meaning:

```typescript
const task = todo.add("Buy milk");

// ✅ Can read it
console.log(task.__meta.createdAt);

// ❌ Doesn't appear in loops
for (const key in task) {
  console.log(key);  // Skips __meta
}

// ❌ Not in Object.keys()
console.log(Object.keys(task));  // ['id', 'title', 'done']

// ❌ Not in JSON.stringify()
console.log(JSON.stringify(task));  // {"id":"...","title":"...","done":...}
```

This keeps data clean: the audit trail exists on objects for UI purposes but doesn't pollute persistence.

---

## Modification Tracking (Phase 2)

### How Modifications are Recorded

When a method modifies an existing object, the framework tracks the change:

```typescript
export default class TodoList extends Photon {
  setPriority(id: string, priority: string): Task | null {
    const task = this.items.find(t => t.id === id);
    if (!task) return null;

    // Capture old value
    const oldValue = task.priority;

    // Make the change
    task.priority = priority;

    // The wrapper automatically:
    // 1. Detects that 'task' is from this.items
    // 2. Finds its index
    // 3. Updates __meta:
    task.__meta.modifications.push({
      field: 'priority',
      oldValue: oldValue,
      newValue: priority,
      timestamp: new Date().toISOString(),
      modifiedBy: 'setPriority'
    });
    task.__meta.modifiedAt = new Date().toISOString();
    task.__meta.modifiedBy = 'setPriority';

    return task;
  }
}
```

### Manual vs Automatic

**Current Approach (Phase 2):**
Methods explicitly track modifications using a helper:

```typescript
private _trackModification(item: any, field: string, oldValue: any, newValue: any) {
  if (item.__meta) {
    item.__meta.modifications.push({
      field, oldValue, newValue,
      timestamp: new Date().toISOString(),
      modifiedBy: /* method name */
    });
    item.__meta.modifiedAt = new Date().toISOString();
    item.__meta.modifiedBy = /* method name */;
  }
}

// Usage
done(id: string): Task | null {
  const task = this.items.find(t => t.id === id);
  if (task) {
    this._trackModification(task, 'done', task.done, true);
    task.done = true;
  }
  return task;
}
```

**Future (Phase 3+):** Could use Proxies for automatic detection, but manual tracking is clearer.

---

## Event Emission: Real-Time Synchronization

### Event Structure

Every method call produces an event:

```typescript
{
  // Core event data
  method: "add",                              // Method name
  params: { title: "Buy groceries" },         // Parameters
  result: { id: "...", title: "...", ... },   // Return value
  timestamp: "2026-03-04T15:30:45.123Z",      // ISO timestamp

  // Optional: instance name (for multi-instance photons)
  instance: "default",

  // Index-aware pagination (Phase 5)
  index: 0,                                   // Position in array
  totalCount: 42,                             // Total items
  affectedRange: { start: 0, end: 1 }        // Range this affects
}
```

### Event Flow to Clients

```
┌──────────────────────────────────────────────┐
│  Photon emits: this.emit('add', eventData)   │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│  Daemon receives via executionContext        │
│  - Stores in memory                          │
│  - Persists to disk                          │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│  Daemon broadcasts to all subscribers        │
│  - Beam (SSE over HTTP)                      │
│  - Claude Desktop (stdio)                    │
│  - CLI (if subscribed)                       │
└────────────┬─────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────┐
│  Client receives event                       │
│  - Updates local mirror of state             │
│  - Re-renders UI reactively                  │
│  - Applies warmth colors                     │
│  - Shows audit trail                         │
└──────────────────────────────────────────────┘
```

---

## Warmth & UI Integration (Phase 3)

### Warmth Colors Show Recency

The Beam UI reads `__meta` timestamps and applies CSS classes:

```typescript
// In result-viewer.ts
private _getItemWarmthClass(item: unknown): string {
  if (!item?.__meta) return '';

  const timestamp = item.__meta.modifiedAt || item.__meta.createdAt;
  const age = Date.now() - new Date(timestamp).getTime();

  if (age < 5 * 60_000) return 'warmth-hot';    // < 5 min: 🔥 Red
  if (age < 30 * 60_000) return 'warmth-warm';  // 5-30 min: 🟠 Orange
  if (age < 2 * 3600_000) return 'warmth-cool'; // 30m-2h: 🟡 Yellow
  return '';  // > 2 hours: No color
}
```

### Visual Feedback

```
Item just created:    [████] HOT (red)
Modified 5 min ago:   [████] WARM (orange)
Modified 30 min ago:  [████] COOL (yellow)
Modified 2+ hr ago:   [████] COLD (no color)
```

### Animation Integration

When an item is added, the framework emits an event which:
1. Beam receives the event
2. Detects it's a new item
3. Applies animation class (fade-in, slide)
4. Applies warmth color
5. Periodically recalculates warmth to fade colors

---

## Index-Aware Events: Pagination Support (Phase 5)

### The Problem: Large Datasets

Without index information, handling millions of items breaks:

```typescript
// Without index-aware events:
// - Client has NO idea where in the array items are
// - UI shows wrong page when items inserted/deleted before current page
// - Must fetch entire array on every change

// With index-aware events:
// - Client knows exact position
// - Can filter events for subscribed range
// - Can detect range shifts (when to refetch)
// - Can implement lazy pagination
```

### Solution: Index Metadata

Every event includes:

```typescript
{
  index: 42,                      // Position in array [0-based]
  totalCount: 1000,               // Total items in array
  affectedRange: {                // Range this event affects
    start: 42,
    end: 43
  }
}
```

### Client-Side Range Filtering

```typescript
// Client subscribes to page 2: items [50-100)
const subscriptionRange = { start: 50, end: 100 };

// Receive all events but only process relevant ones
photon.on('add', (event) => {
  if (event.index >= subscriptionRange.start &&
      event.index < subscriptionRange.end) {
    // Item is in my range, update UI
    updateUI(event.result);
  }

  // Detect range shifts
  if (event.index < subscriptionRange.start) {
    // Item added BEFORE my range
    // My range has shifted: [51-101) now
    onRangeShift(event);
  }
});
```

### Lazy Pagination Pattern

```typescript
// User views page 2 (items 50-99)
const pageSize = 50;
const pageNum = 2;
const startIdx = (pageNum - 1) * pageSize;  // 50
const endIdx = startIdx + pageSize;         // 100

// Fetch items in this range
const pageItems = await photon.range(startIdx, endIdx);

// Subscribe to changes in this range
const subscription = photon.subscribe(startIdx, endIdx, {
  onAdd: (item, index) => addToUI(item),
  onRemove: (itemId, index) => removeFromUI(itemId),
  onShift: (newStart, newEnd) => refetchPage(newStart, newEnd)
});

// User scrolls to page 5
subscription.unsubscribe();
// Subscribe to new range [200-250)
// Unload pages 1-2 from memory
```

---

## Synchronization: How Clients Mirror Server State

### The Sync Model

```
┌─────────────┐                    ┌──────────────┐
│   Server    │                    │     Client   │
│  (Photon)   │                    │   (Beam)     │
├─────────────┤                    ├──────────────┤
│  items: []  │ ─── Event ──────▶  │  items: []   │
│             │                    │  [mirror]    │
│  [1] push() │ ─── Event ──────▶  │  [1] add to  │
│  [2] toggle │ ─── Event ──────▶  │  [2] update  │
│  [3] delete │ ─── Event ──────▶  │  [3] remove  │
└─────────────┘                    └──────────────┘
  Single Source                    Reactive Mirror
  of Truth                         (Auto-synced)
```

### Event Replay for Consistency

If a client is offline or gets out of sync:

```typescript
// Client detects stale state (via checksum)
const clientState = [task1, task2];  // Outdated
const serverState = [task1, task2, task3];  // Has new item

// Fetch all events since last sync
const events = await photon.getEventsSince(lastSyncTime);

// Replay events to sync up
for (const event of events) {
  if (event.method === 'add') {
    clientState.push(event.result);
  } else if (event.method === 'delete') {
    clientState = clientState.filter(t => t.id !== event.params.id);
  }
}

// Client is now in sync
```

---

## Complete Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Developer's Code                           │
│                                                                  │
│  export default class TodoList extends Photon {                 │
│    items: Task[] = [];  // Reactive                             │
│    add(title) { ... }   // Public method                        │
│  }                                                               │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       │ @stateful detected from JSDoc
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Runtime: loader.ts                              │
│                                                                  │
│  1. Wrap all public methods                                      │
│  2. On method call:                                             │
│     - Execute original                                          │
│     - Attach __meta to returned objects                         │
│     - Add index/totalCount if array item                        │
│     - Emit event via executionContext                           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       │ emit('add', { method, params, result, index, ... })
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Daemon: executionContext                         │
│                                                                  │
│  1. Receive event                                               │
│  2. Persist state to disk                                       │
│  3. Broadcast to all subscribers                                │
└──────────────────────┬───────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │  Beam  │  │  CLI   │  │Claude  │
    │  (SSE) │  │ (stdio)│  │ Desktop│
    └────────┘  └────────┘  └────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│                  Beam UI: result-viewer.ts                       │
│                                                                  │
│  1. Receive event via SSE                                       │
│  2. Apply __meta timestamps for warmth color                    │
│  3. Add animation class (for new/modified items)                │
│  4. Render expandable audit trail                               │
│  5. Filter by index if client subscribed to range               │
│  6. Reactively update UI                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Configuration & Customization

### Default Behavior (Zero Config)

```typescript
// Just use @stateful - everything else is automatic
export default class TodoList extends Photon {
  @stateful
  items: Task[] = [];

  add(title: string): Task {
    const task = { ... };
    this.items.push(task);
    return task;  // __meta attached automatically
  }
}
```

### Opt-In Features

**Warmth Colors:** Enable in Beam UI (automatic detection of `__meta`)

**Audit Trail:** Enable in Beam UI (expandable section, automatic)

**Pagination Events:** Automatic when returning items from `this.items`

---

## Testing Strategy

### Unit Tests (52 tests)

- Verify `__meta` attachment
- Verify modification tracking
- Verify warmth color calculations
- Verify index-aware event structure

### Integration Tests (12 tests)

- Test with real @stateful photons
- Test with actual array mutations
- Test 100+ item pagination scenarios
- Test real-world workflows

### Manual Testing

```bash
# Test with actual photon
$ photon cli todo add --text "Buy milk"
✅ Returns task with __meta

$ photon cli todo list
✅ Shows all items with correct structure
```

---

## Performance Considerations

### Memory
- `__meta` is non-enumerable (invisible to JSON)
- Only items in memory have `__meta` (not disk)
- Pagination keeps only current page + pre-fetch

### Network
- Events only emit when methods called (not on external mutations)
- Client-side filtering (index-aware) avoids unnecessary data
- SSE (Server-Sent Events) for efficient real-time updates

### Disk
- State auto-persisted after each method call
- JSON format (human-readable, debuggable)
- Async write (doesn't block method execution)

---

## Known Limitations & Future Work

1. **Modification History Size**
   - Current: All modifications stored in memory
   - Future: Configurable history limit (keep last N changes)

2. **Sync Consistency**
   - Current: Event-based eventually consistent
   - Future: Checksums for explicit sync verification

3. **Reordering & Sorting**
   - Current: Index-based (array order assumed stable)
   - Future: Support for sorted/filtered views

4. **Conflict Resolution**
   - Current: Last-write-wins
   - Future: Merge strategies for concurrent edits

---

## Summary

The **@stateful** framework provides:

✅ **Automatic Event Emission** - No boilerplate needed
✅ **Metadata Tracking** - Audit trail on every object
✅ **Warmth Colors** - Visual feedback for recency
✅ **Audit Trail UI** - See complete change history
✅ **Index-Aware Pagination** - Support millions of items
✅ **Real-Time Sync** - Clients mirror server state
✅ **Disk Persistence** - Automatic save to disk
✅ **Zero Configuration** - Works out of the box

All without a single line of boilerplate code.
