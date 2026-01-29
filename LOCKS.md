# Distributed Locks

Photon provides distributed locking for concurrent access control. Locks are coordinated through the daemon and available to any photon method.

## API

```typescript
async moveTask(params: { taskId: string; column: string }) {
  return this.withLock(`task:${params.taskId}`, async () => {
    const task = await this.loadTask(params.taskId);
    task.column = params.column;
    await this.saveTask(task);
    return task;
  });
}
```

### `this.withLock(name, fn, timeout?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Lock name. Use dynamic names for per-resource locking. |
| `fn` | `() => Promise<T>` | Function to execute while holding the lock. |
| `timeout` | `number?` | Lock timeout in ms. Default: 30000 (30s). |

Returns the result of `fn()`.

### JSDoc Declaration

Use the `@locked` tag for method-level locking:

```typescript
/**
 * Process payment
 * @locked payment:{orderId}
 */
async processPayment(params: { orderId: string }) {
  // Automatically wrapped in withLock('payment:{orderId}')
}
```

## Behavior

### No Lock Manager

When no lock manager is configured (e.g., local development without daemon), `withLock` executes `fn` directly without acquiring a lock. This is a no-op passthrough.

### With Lock Manager

1. **Acquire** — Requests the named lock from the daemon
2. **Execute** — Runs `fn()` while holding the lock
3. **Release** — Always releases the lock in a `finally` block, even if `fn` throws

### Error Handling

- If the lock **cannot be acquired** (another holder, timeout), throws `Error: Could not acquire lock: <name>`
- If `fn` **throws**, the lock is released and the error propagates
- The caller never needs to manually release locks

## Daemon Lock Protocol

The daemon manages locks via its Unix socket:

| Operation | Behavior |
|-----------|----------|
| `acquire(name, timeout?)` | Grants exclusive lock or returns `false` |
| `release(name)` | Releases the lock |
| Default timeout | 30 seconds |
| Auto-cleanup | Every 10 seconds, stale locks are released |

Locks are process-scoped. If a photon process dies, the daemon detects the disconnect and releases its locks.

## Examples

### Connect Four — Column Locking

```typescript
async dropPiece(params: { column: number }) {
  return this.withLock(`board:column:${params.column}`, async () => {
    const board = await this.loadBoard();
    const row = board.findEmptyRow(params.column);
    board.place(row, params.column, this.currentPlayer);
    await this.saveBoard(board);
    return { row, column: params.column };
  });
}
```

### Kanban — Task Move

```typescript
/**
 * Move task to column
 * @locked task:{taskId}
 */
async moveTask(params: { taskId: string; column: string }) {
  const task = await this.loadTask(params.taskId);
  task.column = params.column;
  task.updatedAt = new Date();
  await this.saveTask(task);
  return task;
}
```
