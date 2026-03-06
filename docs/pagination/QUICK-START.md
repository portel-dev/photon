# Pagination Quick Start Guide

## What You Need to Know

When a `@stateful` photon method returns paginated data with `_pagination` metadata, the framework **automatically**:

1. ✅ Creates ViewportAwareProxy for smart client-side pagination
2. ✅ Detects visible items via IntersectionObserver
3. ✅ Auto-fetches missing data ranges with buffer
4. ✅ Applies JSON Patches from other clients
5. ✅ Syncs state across all connected clients

**No client-side code needed.** It just works.

## Making a Photon Pagination-Eligible

### Required Changes

1. **Add `@stateful` decorator**
   ```typescript
   /**
    * @photon My Photon Name
    * @stateful
    */
   export default class MyPhoton { ... }
   ```

2. **Return `_pagination` metadata**
   ```typescript
   async items(start: number = 0, limit: number = 20) {
     const end = Math.min(start + limit, totalCount);
     return {
       items: items.slice(start, end),
       _pagination: {
         totalCount,      // Total items available
         start,           // Start index of returned items
         end,             // End index (exclusive)
         hasMore: end < totalCount
       }
     };
   }
   ```

3. **Use `data-index` attribute in results**
   - Framework needs to match items with cache indices
   - Auto-UI renderer should add: `data-index="${i}"`

That's it! The framework handles everything else.

## How It Works (User Perspective)

1. **User calls photon method**
   ```
   call photon/items with {start: 0, limit: 20}
   ```

2. **Framework receives response**
   - Detects `_pagination` metadata
   - Creates ViewportAwareProxy
   - Initializes IntersectionObserver

3. **User scrolls through results**
   - IntersectionObserver detects visible items
   - ViewportManager calculates fetch range with buffer
   - Auto-fetches: `items(15, 40)` ← items 5-40 (with buffer)
   - Updates cache, re-renders if in viewport

4. **Another client adds an item**
   - Server broadcasts JSON Patch: `{ op: "add", path: "/items/0", value: {...} }`
   - First client's ViewportAwareProxy receives patch
   - Applies to local state, UI updates automatically

## Example: Simple Todo List

```typescript
/**
 * @photon Todo List
 * @stateful
 */
export default class TodoPhoton {
  todos: Todo[] = [];

  async list(start: number = 0, limit: number = 20) {
    const end = Math.min(start + limit, this.todos.length);

    return {
      items: this.todos.slice(start, end),
      _pagination: {
        totalCount: this.todos.length,
        start,
        end,
        hasMore: end < this.todos.length,
      }
    };
  }

  async add(title: string) {
    const todo = { id: uuid(), title, done: false };
    this.todos.unshift(todo);
    // Framework broadcasts patch automatically!
    return todo;
  }

  async toggle(id: string) {
    const todo = this.todos.find(t => t.id === id);
    if (todo) todo.done = !todo.done;
    // Update patch broadcast automatically!
    return todo;
  }

  async delete(id: string) {
    const index = this.todos.findIndex(t => t.id === id);
    if (index !== -1) {
      this.todos.splice(index, 1);
      // Remove patch broadcast automatically!
      return true;
    }
    return false;
  }
}
```

**That's all you need!** No pagination code at all. The framework handles:
- ✅ Viewport tracking
- ✅ Smart fetching
- ✅ Patch broadcasting
- ✅ Cache management
- ✅ Multi-client sync

## Auto-UI Rendering

The framework automatically provides:

```html
<div data-index="0">Item 0</div>
<div data-index="1">Item 1</div>
<div data-index="2">Item 2</div>
...
```

- Each item has `data-index` matching cache position
- Items are rendered in order
- IntersectionObserver watches these divs
- Scrolling triggers fetches automatically

## Configuration

Framework auto-detects device type:

| Device | Page Size | Buffer |
|--------|-----------|--------|
| Mobile | 10 | 5 |
| Tablet | 50 | 7 |
| Desktop | 100 | 10 |

To override, edit `src/auto-ui/frontend/services/viewport-manager.ts`:

```typescript
export function getPageSizeForClient(): number {
  // Customize page sizes here
  if (navigator.devicePixelRatio < 2 && window.innerWidth < 768) {
    return 15; // Changed from 10
  }
  // ... etc
}
```

## Testing Pagination

See `tests/pagination-integration.test.ts` for comprehensive tests:

1. **Auto-UI Detection** - Verify `_pagination` detection
2. **Large Dataset Stress** - Test 10,000+ items
3. **Viewport Simulation** - Simulate scrolling
4. **JSON Patches** - Concurrent updates
5. **Cache Management** - LRU eviction
6. **Multi-Client Sync** - Cross-client consistency

Run tests:
```bash
npm run test:pagination-integration
```

## Common Patterns

### Filtered/Searched List
```typescript
async search(query: string, start: number = 0, limit: number = 20) {
  const results = this.todos.filter(t =>
    t.title.toLowerCase().includes(query.toLowerCase())
  );

  const end = Math.min(start + limit, results.length);
  return {
    items: results.slice(start, end),
    _pagination: {
      totalCount: results.length,
      start,
      end,
      hasMore: end < results.length,
    }
  };
}
```

### With Database
```typescript
async items(start: number = 0, limit: number = 20) {
  const totalCount = await db.count();
  const items = await db
    .skip(start)
    .take(limit)
    .all();

  return {
    items,
    _pagination: {
      totalCount,
      start,
      end: start + items.length,
      hasMore: start + items.length < totalCount,
    }
  };
}
```

### Sorted/Filtered with Database
```typescript
async items(
  query: string = '',
  sort: 'title' | 'date' = 'date',
  start: number = 0,
  limit: number = 20
) {
  let query_builder = db.todos;

  if (query) {
    query_builder = query_builder.where('title', 'like', `%${query}%`);
  }

  query_builder = query_builder.orderBy(sort, 'desc');

  const totalCount = await query_builder.count();
  const items = await query_builder.skip(start).take(limit).all();

  return {
    items,
    _pagination: {
      totalCount,
      start,
      end: start + items.length,
      hasMore: start + items.length < totalCount,
    }
  };
}
```

## Performance Tips

1. **Keep page size reasonable** (20-50 items)
2. **Use database LIMIT/OFFSET** (not in-memory slicing)
3. **Index for sorting/filtering** columns
4. **Return only needed fields** (don't over-hydrate)
5. **Handle boundary cases** (start >= totalCount)

## Troubleshooting

**Items not loading?**
- ✅ Check: Is `_pagination` included in response?
- ✅ Check: Are items in correct order?
- ✅ Check: Is `data-index` in DOM?

**Scrolling jumpy?**
- ✅ Increase `bufferSize` (prefetch more items)
- ✅ Increase `pageSize` (fewer requests)

**Memory usage high?**
- ✅ Reduce `pageSize` (fewer items per fetch)
- ✅ Reduce `maxCacheSize` (smaller cache)

**Not syncing across clients?**
- ✅ Check: Is photon `@stateful`?
- ✅ Check: Are CRUD methods being called?
- ✅ Check: Is patch applied correctly?

## What's Happening Behind the Scenes

```
┌─────────────────────────────────────────────────────┐
│  User scrolls                                       │
└──────────────────────┬──────────────────────────────┘
                       ↓
        ┌──────────────────────────┐
        │  IntersectionObserver    │
        │  detects visibility      │
        │  ViewportManager         │
        │  calculates fetch range  │
        └──────────────┬───────────┘
                       ↓
        ┌──────────────────────────┐
        │  ViewportAwareProxy      │
        │  auto-fetches missing    │
        │  ranges (with buffer)    │
        └──────────────┬───────────┘
                       ↓
        ┌──────────────────────────┐
        │  MCP callTool            │
        │  photon/items(start...)  │
        └──────────────┬───────────┘
                       ↓
        ┌──────────────────────────┐
        │  Server returns items    │
        │  + _pagination metadata  │
        └──────────────┬───────────┘
                       ↓
        ┌──────────────────────────┐
        │  ViewportAwareProxy      │
        │  updates cache           │
        │  emits 'fetched' event   │
        └──────────────┬───────────┘
                       ↓
        ┌──────────────────────────┐
        │  Auto-UI re-renders      │
        │  only viewport items     │
        └──────────────────────────┘
```

## See Also

- [Pagination API Reference](./PAGINATION-API.md)
- [Implementation Guide](../pagination/PAGINATION-IMPLEMENTATION-GUIDE.md)
- [Example Photon](../../photons/paginated-list.ts)
- [Integration Tests](../../tests/pagination-integration.test.ts)
