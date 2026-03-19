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

---

## Identity-Aware Locks

When a photon uses `@auth`, locks become identity-aware. Instead of a binary mutex, locks are assigned to specific caller IDs. Only the holder can call `@locked` methods.

### API

```typescript
// Assign lock to a specific caller
await this.acquireLock('turn', callerId, timeout?);

// Transfer lock to another caller
await this.transferLock('turn', toCallerId, fromCallerId?);

// Release lock (open to anyone)
await this.releaseLock('turn', callerId?);

// Query who holds the lock
const lock = await this.getLock('turn');
// → { holder: 'user_abc' | null, acquiredAt?, expiresAt? }
```

| Method | Description |
|--------|-------------|
| `acquireLock(name, callerId, timeout?)` | Assign lock to a caller. Fails if held by another. |
| `transferLock(name, toCallerId, from?)` | Move lock atomically. `from` defaults to `this.caller.id`. |
| `releaseLock(name, callerId?)` | Release. Defaults to `this.caller.id`. |
| `getLock(name)` | Query current holder. |

### `@locked` with `@auth`

When both `@auth` and `@locked` are present, the middleware checks `this.caller.id` against the lock holder instead of using a binary mutex:

```typescript
/**
 * @stateful
 * @auth required
 */
class Chess {
  /** @locked turn */
  async move(params: { from: string; to: string }) {
    // If this.caller.id !== lock holder → error: "Not your turn"
    // If lock not assigned → call allowed (lock not yet in play)
    await this.transferLock('turn', this.nextPlayer);
    return this.board;
  }
}
```

Without `@auth`, `@locked` falls back to the standard binary mutex behavior.

### Chess — Full Example

```typescript
/**
 * @stateful
 * @auth required
 */
class Chess {
  players: Record<string, string> = {};
  turn = 'white';

  async join() {
    const slot = !this.players.white ? 'white' :
                 !this.players.black ? 'black' : null;
    if (!slot) return { error: 'Game full' };

    this.players[slot] = this.caller.id;

    if (slot === 'black') {
      await this.acquireLock('turn', this.players.white);
    }
    return { color: slot };
  }

  /** @locked turn */
  async move(params: { from: string; to: string }) {
    // Execute move...
    this.turn = this.turn === 'white' ? 'black' : 'white';
    const nextPlayer = this.players[this.turn];
    await this.transferLock('turn', nextPlayer);
    return { board: this.board, turn: this.turn };
  }

  // No @locked — anyone can call (spectators too)
  async board() {
    return { board: this.board, players: this.players, turn: this.turn };
  }
}
```

### Presentation — Lock Release

```typescript
/**
 * @stateful
 * @auth required
 */
class Slides {
  /** @locked navigation */
  async next() { this.currentSlide++; return this.slide; }

  /** @locked navigation */
  async previous() { this.currentSlide--; return this.slide; }

  async present() {
    // Presenter takes control
    await this.acquireLock('navigation', this.caller.id);
    return { mode: 'presenting', presenter: this.caller.name };
  }

  async release() {
    // Release navigation to audience
    await this.releaseLock('navigation');
    return { mode: 'free' };
  }
}
```
