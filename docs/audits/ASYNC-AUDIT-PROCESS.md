# Async Safety Audit Process

A systematic methodology for identifying and fixing async state management bugs in Node.js/TypeScript codebases. Developed from the Photon runtime audit (Feb 2026), where this process found and fixed 10+ bugs in a single pass.

## The Core Problem

Node.js is single-threaded, but `async/await` creates interleaving points. Any `await` is a suspension point where other event handlers can run and mutate shared state. Code that looks sequential is actually concurrent when it contains `await`.

The most dangerous pattern:

```typescript
// UNSAFE
const index = array.findIndex(...);   // capture state
await someAsyncOperation();           // other handlers run here
array[index] = newValue;              // index may now be wrong
```

## Bug Taxonomy

### A. Stale Index After Await
**Pattern**: `findIndex` or `find` before an `await`, then mutating using the captured index/reference.

```typescript
// UNSAFE
const i = items.findIndex((x) => x.id === id);
await load(); // items may be modified here
items[i] = updated; // i may be wrong, or item may not exist anymore
```

**Fix**: Re-find immediately before every mutation.
```typescript
await load();
const i = items.findIndex((x) => x.id === id); // re-find AFTER await
if (i !== -1) items[i] = updated;
```

### B. Concurrent Entry Without Dedup Guard
**Pattern**: Two async paths both check a "not yet present" condition before either adds the entry.

```typescript
// UNSAFE — both callers see isNew=true, both push
if (!items.find((x) => x.id === id)) {
  await load(id); // both suspend here
  items.push(loaded); // both push → duplicates
}
```

**Fix**: Use a serialization primitive (Set, Map, or mutex).
```typescript
if (activeLoads.has(id)) { pendingAfterLoad.add(id); return; }
activeLoads.add(id);
try {
  await load(id);
  if (!items.find((x) => x.id === id)) items.push(loaded); // dedup check too
} finally {
  activeLoads.delete(id);
  if (pendingAfterLoad.has(id)) { pendingAfterLoad.delete(id); handleChange(id); }
}
```

### C. Live Map/Array Iterator + Await
**Pattern**: Iterating over a Map/Array with `await` inside the loop body. Other handlers can mutate the collection between iterations.

```typescript
// UNSAFE
for (const [key, val] of map.entries()) {
  await val.cleanup(); // map can change here
  map.delete(key); // mutating while iterating = undefined behavior
}
```

**Fix**: Snapshot keys first, then iterate the snapshot.
```typescript
const keys = Array.from(map.keys());
for (const key of keys) {
  const val = map.get(key);
  if (val) await val.cleanup();
  map.delete(key);
}
```

### D. Stale Closure Capture
**Pattern**: Variable captured (closed over) before an `await`; the underlying data changes during the await; stale value used afterward.

```typescript
// UNSAFE
const prevNames = new Set(this.items.map((x) => x.name)); // captured before await
const newData = await fetchData(); // this.items may be updated by SSE event here
const added = newData.filter((x) => !prevNames.has(x.name)); // prevNames is stale
```

**Fix**: Capture AFTER the await that may change the data.
```typescript
const newData = await fetchData();
const prevNames = new Set(this.items.map((x) => x.name)); // capture AFTER await
const added = newData.filter((x) => !prevNames.has(x.name));
```

### E. Untracked Timer/Resource
**Pattern**: `setTimeout`, `setInterval`, or other resource created inside async logic without storing the handle for later cleanup.

```typescript
// UNSAFE — handle not stored, cannot be cleared
clearTimeout(originalTimeout);
setTimeout(() => { reject(new Error('timeout')); }, 120000); // leaked
```

**Fix**: Always store handles and clear them on all exit paths.
```typescript
let currentTimeout: NodeJS.Timeout = originalTimeout;
// ...
clearTimeout(currentTimeout);
currentTimeout = setTimeout(() => { reject(new Error('timeout')); }, 120000);
// In result/error/cleanup: clearTimeout(currentTimeout);
```

### F. Incomplete Map Cleanup
**Pattern**: Multiple related Maps that must stay in sync. One path deletes from one Map but forgets the others, leaving orphaned entries.

```typescript
// UNSAFE — orphaned entries in sessionManagers and photonPaths
for (const [key, dir] of workingDirs) {
  if (dir === deletedDir) {
    await manager.clearInstances();
    // MISSING: sessionManagers.delete(key), photonPaths.delete(key), workingDirs.delete(key)
  }
}
```

**Fix**: Enumerate all related Maps and delete from all of them.
```typescript
const keysToDelete = Array.from(workingDirs.entries())
  .filter(([, dir]) => dir === deletedDir)
  .map(([key]) => key);
for (const key of keysToDelete) {
  sessionManagers.delete(key);
  photonPaths.delete(key);
  workingDirs.delete(key);
}
```

---

## The Audit Process

### Step 1: Enumerate All Shared Mutable State
List every variable that:
- Is declared outside a function (module-level or class-level)
- Is a Map, Set, or Array that gets modified
- Is accessed from multiple async paths

These are your **hot spots**.

### Step 2: For Each Hot Spot, Find All Writers
Search for every place this state is modified. Include:
- Direct assignment (`map.set(...)`, `array.push(...)`, `arr[i] = ...`)
- Deletion (`map.delete(...)`, `array.splice(...)`)
- Clear (`map.clear()`)

Ask: Can two of these writers run concurrently?

### Step 3: Check Each Writer for Await Gaps
For each writer, look backwards: is there an `await` between the "read state" and "write state" steps?

```
Read:  const i = array.findIndex(...)  ← is there an await between here?
Await: await something()               ← YES → this is a bug
Write: array[i] = updated              ← and here?
```

### Step 4: Validate Before Fixing
**Do not implement fixes based on audit reports alone.** Before fixing any reported bug:

1. Read the actual code at the reported line numbers
2. Confirm the pattern matches the taxonomy
3. Determine if there is actually an `await` between the check and the mutation
4. Check if JS single-threaded guarantees already make it safe

**False positive rule**: If the entire operation between "read state" and "write state" is synchronous (no `await`, no `.then()`), JavaScript's event loop guarantees it cannot be interrupted. This is NOT a bug.

### Step 5: Categorize by Severity
| Severity | Description |
|----------|-------------|
| Critical | Can cause data corruption, crashes, or unrecoverable state |
| High | Can cause incorrect behavior that affects users |
| Medium | Resource leaks or edge case failures that self-recover |
| Low | Rare edge cases with minimal impact |

Fix Critical and High first. Medium and Low can be batched.

### Step 6: Fix with Minimal Changes
Apply the fix pattern from the taxonomy. Avoid refactoring surrounding code — the goal is a targeted surgical fix that is easy to review and revert.

After each fix: build (`npm run build`) to verify no type errors.

### Step 7: Commit with Context
Each fix gets its own commit explaining:
1. What the bug was (the pattern)
2. Where it was (file + line)
3. Why it was a bug (what could go wrong)
4. What the fix does

---

## Checklist for Code Review

When reviewing async code involving shared state:

- [ ] Is `findIndex`/`find` result used after an `await`? → Re-find before mutation
- [ ] Is a condition checked before `await` and assumed to hold after? → Re-check after
- [ ] Is there a loop with `await` over a live Map/Array? → Snapshot first
- [ ] Is a variable captured in a closure before `await`? → Capture after if it can change
- [ ] Are related Maps always updated together? → Grep for all Maps in the cluster
- [ ] Are all timer/resource handles stored? → Every `setTimeout` needs a stored handle
- [ ] On ALL exit paths (result, error, timeout, close), are handles cleared?

---

## Applied Example: Photon beam.ts

The `photons[]` array in `beam.ts` is shared mutable state accessed from:
- `handleFileChange` (file watcher callback)
- `configurePhotonViaMCP` (HTTP request handler)
- `reloadPhotonViaMCP` (HTTP request handler)
- `updateMetadataViaMCP` (HTTP request handler)
- Initial batch load (startup)

All five paths contain `await` before writing to `photons[]`. The fix applied:
1. **Serialization**: `activeLoads: Set<string>` prevents concurrent loads of the same photon
2. **Queue-and-replay**: `pendingAfterLoad: Set<string>` replays changes that arrived during an active load
3. **Re-find before every mutation**: No path uses a stale index
4. **Dedup on every push**: No path can duplicate an entry

These four techniques, applied consistently, eliminated all race conditions in a single pass.
