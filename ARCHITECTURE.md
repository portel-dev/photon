# Photon Architecture

> **This document defines architectural constraints learned from past mistakes.**
> Violations are caught by pre-commit hooks.

---

## Lessons Learned

These constraints exist because we made these mistakes and paid the price.

| Mistake | Consequence | Rule |
|---------|-------------|------|
| WebSocket for Beam real-time | Complex state, firewall issues | Use MCP Streamable HTTP (SSE) |
| In-memory cache for shared data | Cross-process sync failures | Use disk + daemon pub/sub |
| Swallowed errors (catch returning null) | Hidden bugs, silent failures | Log errors, never swallow |
| fetch() without timeout | Hung requests, blocked UI | Always use AbortSignal.timeout |
| Hardcoded localhost URLs | Broken in Docker/production | Use environment variables |
| Magic timeout numbers | Inconsistent behavior | Define named constants |
| Silent logger suppression | Hidden syntax errors | Use log levels, not null streams |
| TODOs returning undefined | Runtime crashes | Implement or throw explicitly |

---

## Communication Patterns

### Allowed Protocols

| Path | Protocol | Implementation |
|------|----------|----------------|
| Browser ↔ Beam | MCP Streamable HTTP | `POST /mcp` + SSE responses |
| Cross-process sync | Daemon Unix Socket | `~/.photon/daemons/*.sock` |
| Photon ↔ External MCP | stdio / SSE / HTTP | `@mcp` directive |
| CLI ↔ Photon | Direct method call | In-process |

### Architecture Diagram

```
┌─────────────────┐     POST /mcp         ┌─────────────────┐
│  Browser/Client │ ───────────────────► │   Beam Server   │
│                 │                       │                 │
│  MCP Client     │ ◄─────────────────── │  Streamable     │
│  (EventSource)  │   SSE notifications   │  HTTP Transport │
└────────┬────────┘                       └────────┬────────┘
         │                                         │
         │                               ┌─────────┴─────────┐
         │                               │   Daemon Broker   │
         │ ◄─────────────────────────────│   (Unix Socket)   │
         │   (via MCP notifications)     │                   │
         │                               │   Cross-process   │
         │                               │   pub/sub         │
         │                               └───────────────────┘
         │
┌────────┴────────┐
│  Custom UI      │  Uses window.photon.invoke()
│  (iframe)       │  Receives events via postMessage
└─────────────────┘
```

---

## Forbidden Patterns

These patterns cause real bugs. Pre-commit hook blocks errors, warns on others.

### 🚫 ERRORS (Commit Blocked)

#### 1. WebSocket in Beam
```typescript
// ❌ FORBIDDEN in src/auto-ui/
import { WebSocketServer } from 'ws';
new WebSocket('ws://...');
wss.on('connection', ...);

// ✅ USE INSTEAD
import { handleStreamableHTTP, broadcastNotification } from './streamable-http-transport.js';
```

**Why:** WebSocket is stateful, blocked by firewalls, not HTTP/2 friendly. MCP Streamable HTTP is standard.

### ⚠️ WARNINGS (Review Required)

#### 2. In-Memory Cache for Shared Data
```typescript
// ⚠️ WARNING - causes cross-process sync issues
const boardCache = new Map<string, Board>();

// ✅ USE INSTEAD
// Read from disk each time, use daemon pub/sub for real-time
async function loadBoard(name: string): Promise<Board> {
  return JSON.parse(await fs.readFile(boardPath, 'utf-8'));
}
```

**Why:** Different processes (Claude Code MCP, Beam server) have separate memory. Cache in one doesn't update the other.

#### 3. Swallowed Errors
```typescript
// ⚠️ WARNING - hides real bugs
try {
  return await loadConfig();
} catch {
  return null;  // Caller can't distinguish "no config" from "syntax error"
}

// ✅ USE INSTEAD
try {
  return await loadConfig();
} catch (error) {
  logger.error('Config load failed', { error });
  throw error;  // Or return with explicit error state
}
```

**Why:** Silent failures hide bugs for weeks. When discovered, hard to trace.

#### 4. fetch() Without Timeout
```typescript
// ⚠️ WARNING - can hang indefinitely
const response = await fetch(url);

// ✅ USE INSTEAD
const response = await fetch(url, {
  signal: AbortSignal.timeout(10000)  // 10 second timeout
});
```

**Why:** If endpoint is slow or dead, caller blocks forever. UI freezes, CLI hangs.

#### 5. Hardcoded localhost URLs
```typescript
// ⚠️ WARNING - breaks in production/Docker
const baseUrl = 'http://localhost:3000';

// ✅ USE INSTEAD
const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';  // dev-only

// Or mark for hook to skip:
const devUrl = 'http://localhost:3000';  // dev-only
```

**Why:** OpenAPI specs, redirect URLs break when deployed. Use env vars.

#### 6. Magic Timeout Numbers
```typescript
// ⚠️ WARNING - inconsistent behavior
setTimeout(cleanup, 30000);
setInterval(check, 60000);

// ✅ USE INSTEAD
const SESSION_TIMEOUT_MS = 30 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
setTimeout(cleanup, SESSION_TIMEOUT_MS);
```

**Why:** Timeouts scattered across files. Changing one doesn't change others. Named constants are searchable.

#### 7. Silent Logger Suppression
```typescript
// ⚠️ WARNING - hides syntax errors
const nullStream = new Writable({ write: (_, __, cb) => cb() });
const silentLogger = createLogger({ destination: nullStream });

// ✅ USE INSTEAD
const logger = createLogger({ level: 'warn' });  // Use log levels
```

**Why:** Beam silenced loader errors. Photons with syntax errors showed as "not configured" instead of "broken".

#### 8. TODOs That Return undefined
```typescript
// ⚠️ WARNING - runtime crash waiting to happen
async function getUserId(): string {
  return undefined;  // TODO: Get from session
}

// ✅ USE INSTEAD
async function getUserId(): string {
  throw new Error('getUserId not implemented');
}
```

**Why:** Caller expects string, gets undefined. Crashes later with confusing error.

---

## Required Patterns

### Real-Time Updates

**Server-side (photon methods):**
```typescript
// Emit events for real-time sync
this.emit({
  channel: `${this.photonId}:${itemId}`,
  event: 'data-changed',
  data: { ... }
});
```

**Client-side (Custom UI):**
```javascript
// Receive via postMessage from parent
window.addEventListener('message', (event) => {
  if (event.data.type === 'photon:channel-event') {
    handleUpdate(event.data);
  }
});
```

### Cross-Process Communication

Always use daemon pub/sub:
```typescript
import { subscribeChannel, publishChannel } from './daemon-client.js';

// Subscribe
subscribeChannel(photonName, channel, (message) => {
  // Handle cross-process event
});

// Publish
publishChannel(photonName, channel, event, data);
```

### Error Handling

```typescript
// Pattern: Log and rethrow or return explicit error state
try {
  const result = await riskyOperation();
  return { success: true, data: result };
} catch (error) {
  logger.error('Operation failed', { error, context: { ... } });
  return { success: false, error: error.message };
  // OR: throw error; if caller should handle
}
```

### Timeouts

```typescript
// Define at module level
const FETCH_TIMEOUT_MS = 10 * 1000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

// Use named constants
await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
```

---

## State Management

### What's OK

| Pattern | Use Case | Example |
|---------|----------|---------|
| Map for sessions | Per-connection state | `sessions: Map<string, SSESession>` |
| Map for subscriptions | Active listeners | `channelSubs: Map<string, Set<Socket>>` |
| Instance state | Per-photon config | `this.boardName` |

### What's Not OK

| Pattern | Problem | Solution |
|---------|---------|----------|
| Map for entity data | Cross-process sync | Read from disk |
| Global singleton state | Race conditions | Per-request state |
| In-memory cache for DB data | Stale reads | Query each time or use pub/sub invalidation |

---

## Pre-Commit Hook

The `.git/hooks/pre-commit` script enforces these constraints:

**Errors (Blocks Commit):**
- WebSocket in `src/auto-ui/`

**Warnings (Review Required):**
- In-memory caches for shared data
- Swallowed errors
- fetch() without timeout
- Hardcoded localhost
- Magic timeout numbers
- Silent logger suppression
- Critical TODOs

Run manually: `bash .git/hooks/pre-commit`

---

## Architectural Decisions

### Why SSE over WebSocket?

| Aspect | WebSocket | SSE (Chosen) |
|--------|-----------|--------------|
| Complexity | Bidirectional, stateful | Unidirectional, simple |
| Firewalls | Often blocked | HTTP, passes through |
| Reconnection | Manual | Built-in browser support |
| MCP Alignment | Custom | Standard Streamable HTTP |
| HTTP/2 | Not multiplexed | Native multiplexing |

### Why Daemon for Cross-Process?

| Aspect | Shared Files | Daemon (Chosen) |
|--------|--------------|-----------------|
| Real-time | Polling required | Push notifications |
| Consistency | Race conditions | Serialized via broker |
| Complexity | Simple but fragile | Robust pub/sub |

### Why No Cache for Shared Data?

| Aspect | In-Memory Cache | Disk + Pub/Sub (Chosen) |
|--------|-----------------|-------------------------|
| Cross-process | Fails silently | Works correctly |
| Consistency | Stale data | Always fresh |
| Complexity | Simple | Slightly more code |
| Debugging | "Why isn't it updating?" | Predictable behavior |

---

## Related Documentation

- [DAEMON-PUBSUB.md](DAEMON-PUBSUB.md) - Detailed pub/sub protocol
- [docs/core/AUTO-UI-ARCHITECTURE.md](docs/core/AUTO-UI-ARCHITECTURE.md) - UI system architecture
- [ADVANCED.md](ADVANCED.md) - Integration patterns (external services)

---

*Last updated: January 2026*
