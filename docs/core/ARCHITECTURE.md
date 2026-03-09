# Photon Architecture

> **This document defines the vision, architecture, and constraints of Photon.**

---

## Vision: Co-Exploration and Co-Creation

The future is not humans OR AI using tools separately. It's humans AND AI **working together** - co-exploring problems, co-creating solutions, using the same tools through the same protocol.

**Photon is the infrastructure that makes this possible.**

```
┌─────────────────┐                   ┌─────────────────┐
│     Human       │                   │       AI        │
│                 │                   │    (Claude)     │
└────────┬────────┘                   └────────┬────────┘
         │                                     │
         │         Same Protocol (MCP)         │
         │         Same Tools (Photons)        │
         │         Same Real-Time State        │
         │                                     │
         └──────────────┬──────────────────────┘
                        │
                ┌───────▼───────┐
                │    Photon     │
                │   Ecosystem   │
                └───────────────┘
```

---

## What is Photon?

### The Smallest Unit

A **photon** (in physics) is the smallest unit of light.

A `.photon.ts` file is the smallest unit of an MCP server - just a TypeScript class:

```typescript
// This IS a complete MCP server
export default class Calculator {
  add(params: { a: number; b: number }) {
    return params.a + params.b;
  }
}
```

No boilerplate. No protocol handling. No server setup.

### The Ecosystem

Photon is an **ecosystem for MCPs and more**:

| Component | Purpose |
|-----------|---------|
| `.photon.ts` | The tool definition (a TypeScript class) |
| **Beam** | MCP client for humans (web UI) |
| **CLI** | MCP client for terminal |
| **Daemon** | Central orchestrator (pub/sub, locks, jobs, webhooks) |
| **Marketplace** | Share and discover photons |
| **PWA Export** | Package as standalone desktop apps |

### What Photon is NOT

To avoid confusion, here is what does **not** exist in the Photon runtime:

- **No configuration file.** There is no `.photonrc.json`, `.photonrc`, or similar. All configuration comes from constructor parameters (mapped to environment variables), JSDoc tags, and file structure.
- **No `MiddlewareRegistry` class.** Middleware is declared via JSDoc `@use` tags and `defineMiddleware()` exports. There is no programmatic registry.
- **No `FormGenerator` or `ResultRenderer` class.** UI generation is internal to the Beam runtime and not exposed as a public API.
- **No subpath exports.** The npm package `@portel/photon` exports a CLI binary only. There are no importable subpath modules like `@portel/photon/server`, `@portel/photon/security`, `@portel/photon/cache`, or `@portel/photon/monitoring`.
- **No `PhotonServer` class.** The MCP server is managed internally by the runtime. Use `photon mcp <name>` to start it.
- **No WebSocket.** Beam uses MCP Streamable HTTP (SSE) exclusively. WebSocket is architecturally forbidden in both the server and frontend.
- **No Jest.** Tests use **vitest** and **tsx**.

---

## What is Beam?

**Beam is an MCP client for humans.**

Just as Claude Desktop is an MCP client for AI, Beam gives humans the same interface to MCPs. The aggregation of photons and the web UI exist to serve this purpose.

```
┌─────────────────────────────────────────────────────────┐
│                         BEAM                            │
│              (MCP Client for Humans)                    │
├─────────────────────────────────────────────────────────┤
│  • Interact with photons via web UI                     │
│  • See real-time updates from AI actions                │
│  • Configure photons (env vars, settings)               │
│  • Test and develop (hot reload)                        │
│  • Export as PWA desktop apps                           │
└─────────────────────────────────────────────────────────┘
```

### The Four Interfaces to Photons

| Interface | For | Protocol |
|-----------|-----|----------|
| **MCP (stdio)** | AI clients (Claude Desktop, Cursor) | MCP over stdio |
| **CLI** | Humans in terminal | Direct method calls |
| **Beam** | Humans in browser | MCP Streamable HTTP |
| **PWA** | End users | Standalone app (MCP + UI bundled) |

---

## Design Philosophy: Simplest Path to Best Practice

**Photon's goal: Find the simplest way to get something working. That becomes the best practice.**

The runtime layer (Beam) between MCPs and UIs is Photon's key advantage. It can transform, simplify, and standardize what other platforms pass through raw.

### The Runtime Layer Advantage

```
Standard MCP Apps:
┌──────────┐     Raw MCP Format      ┌──────────┐
│   MCP    │ ───────────────────────▸│    UI    │
│  Server  │  {content: [{text}]}    │   (App)  │
└──────────┘                         └──────────┘
                                     Must parse & handle

Photon Apps:
┌──────────┐     MCP Format     ┌──────────┐    Clean Data    ┌──────────┐
│   MCP    │ ──────────────────▸│   Beam   │ ────────────────▸│    UI    │
│  Server  │                    │ (Runtime)│   {repos: [...]} │   (App)  │
└──────────┘                    └──────────┘                  └──────────┘
                                Transforms &                  Just use it
                                simplifies
```

### Data Handling: Clean Data, Standard Patterns

| Aspect | Standard MCP Apps | Photon Apps |
|--------|-------------------|-------------|
| **Success** | Check `structuredContent` or parse `content[].text` | Get clean data directly |
| **Errors** | Check `isError` flag, extract message from content | Standard try/catch |
| **Boilerplate** | Parse, validate, transform in every app | Zero - runtime handles it |

**Photon App:**
```typescript
try {
  const repos = await callTool('repos', {});
  updateUI(repos);  // Already parsed!
} catch (error) {
  showError(error.message);  // Standard JS error
}
```

**Standard MCP App:**
```typescript
const result = await app.callServerTool({ name: 'repos', arguments: {} });
if (result.isError) {
  const errorText = result.content.find(c => c.type === 'text')?.text;
  showError(errorText);
  return;
}
const repos = result.structuredContent ?? JSON.parse(result.content[0].text);
updateUI(repos);
```

### Principle: Absorb Complexity in the Runtime

When designing Photon features:

1. **Find the simplest developer experience** - What would a developer ideally write?
2. **Make the runtime do the work** - Transform, validate, simplify in Beam
3. **That simplest path becomes the standard** - Document it, enforce it
4. **Keep apps portable** - Photon apps should still work in standard MCP clients

The runtime layer is not overhead - it's where Photon adds value by making best practices the only path.

---

## The Daemon: Central Orchestrator

Photon comes **batteries included** with a daemon that provides infrastructure for real-world applications:

### Capabilities

| Feature | Purpose | Example |
|---------|---------|---------|
| **Pub/Sub Channels** | Real-time cross-process messaging | AI moves a task → Human sees it instantly |
| **Distributed Locks** | Coordinate exclusive access | Only one process writes to a file at a time |
| **Scheduled Jobs** | Cron-like background execution | Archive old tasks daily at midnight |
| **Webhooks** | HTTP endpoints for external services | GitHub issue → Kanban task |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         DAEMON                                  │
│                  ~/.photon/daemon.sock                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐│
│  │   Pub/Sub   │  │    Locks    │  │  Scheduled  │  │Webhooks ││
│  │  Channels   │  │ Distributed │  │    Jobs     │  │  HTTP   ││
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬────┘│
│         │                │                │               │     │
│         └────────────────┴────────────────┴───────────────┘     │
│                              │                                   │
│                    Unix Socket Protocol                          │
└─────────────────────────────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Claude MCP  │      │    Beam      │      │   Another    │
│   Session    │      │   Server     │      │   Process    │
└──────────────┘      └──────────────┘      └──────────────┘
```

### Pub/Sub: Real-Time Sync

```typescript
// Photon emits an event (two-argument form)
this.emit('task-moved', { taskId, column });

// All subscribers receive it instantly
// - Other browser tabs (via Beam SSE)
// - AI sessions (via MCP notifications)
// - Other processes (via daemon socket)
```

### Distributed Locks: Coordinate Access

```typescript
import { acquireLock, releaseLock } from './daemon-client.js';

// Only one holder at a time
if (await acquireLock('kanban', 'board-write')) {
  try {
    await updateBoard(changes);
  } finally {
    await releaseLock('kanban', 'board-write');
  }
}
```

### Scheduled Jobs: Background Tasks

```typescript
import { scheduleJob } from './daemon-client.js';

// Run daily at midnight
await scheduleJob('kanban', 'archive-old-tasks', {
  method: 'scheduledArchiveOldTasks',
  cron: '0 0 * * *'  // minute hour day month weekday
});
```

### Webhooks: External Integration

```bash
# GitHub webhook → Photon method
curl -X POST http://localhost:3458/webhook/handleGithubIssue \
  -H "X-Webhook-Secret: $SECRET" \
  -d '{"action": "opened", "issue": {...}}'
```

---

## Stateful Photons: Cross-Client Persistence

Photons marked with `@stateful` have their state persisted to disk and shared across all clients (CLI, Beam, Claude Desktop). This enables scenarios like: add items via CLI → Beam auto-updates → Claude Desktop sees the same data.

### Architecture

```
                        State on Disk
                    ~/.photon/state/{name}.json
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                          DAEMON                                  │
│                   (Single shared instance)                        │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Photon Instance  │  │  Event Buffer (in-memory, 30 events) │  │
│  │  (shared session) │  │  Per-channel circular buffer          │  │
│  └────────┬─────────┘  │  Supports replay via lastEventId      │  │
│           │             └──────────────────────────────────────┘  │
│           │                                                      │
│   Tool execution                                                 │
│   → mutates state                                                │
│   → persists to disk                                             │
│   → publishes {name}:state-changed                               │
└──────────────────────┬───────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
   ┌─────────┐   ┌──────────┐   ┌──────────────┐
   │   CLI   │   │   Beam   │   │ Claude Desktop│
   │         │   │ (MCP srv)│   │  (MCP stdio)  │
   └─────────┘   └────┬─────┘   └──────────────┘
                       │
                  SSE broadcast
                  photon/state-changed
                       │
                       ▼
                 ┌───────────┐
                 │  Browser  │
                 │ (MCP cli) │
                 │ auto-     │
                 │ refreshes │
                 └───────────┘
```

### Consistency Model: Eventually Consistent

**State is durable. Notifications are best-effort.**

| What | Durability | Mechanism |
|------|-----------|-----------|
| **State data** | Durable | Persisted to disk on every mutation |
| **Change notifications** | Best-effort | In-memory event buffers, lost on daemon restart |
| **Recovery** | Guaranteed | Any client can re-execute a method to get current state |

This is an **eventually-consistent** model: if a notification is missed, the client's view is stale until the next explicit request. The `_silentRefresh()` mechanism in Beam auto-re-executes on notification, but if that notification is lost, a manual re-execute always works.

### Sync Protocol: Delta Sync vs Full Sync

Events are identified by **timestamps** (`Date.now()`) — no sequential ID generation needed. Each layer maintains a time-based buffer (5-minute retention window).

When a client reconnects, it sends its **last seen timestamp**. The server responds with one of:

| Scenario | Response | Client Action |
|----------|----------|---------------|
| Timestamp within buffer window | **Delta sync**: replay missed events | Apply events incrementally |
| Timestamp older than buffer | **Full sync signal** (`refresh-needed`) | Re-fetch entire state |
| No timestamp (fresh client) | No replay | Fetch state on demand |

### Reliability at Each Layer

```
Layer 1: Client → Daemon (Unix Socket)
├── CLI: retry once + auto-restart daemon, then fail
├── Beam: retry once + auto-restart daemon, then fail
└── Recovery: re-execute the command

Layer 2: Daemon → Subscribers (Pub/Sub)
├── Time-based buffer: 5-minute retention window per channel
├── Delta sync on reconnect via lastTimestamp
├── Auto-reconnect with exponential backoff (subscribeChannel)
├── Full sync signal when client is stale (beyond buffer window)
└── Gap: buffer lost on daemon restart (in-memory only)

Layer 3: Beam → Browser (SSE)
├── Beam-side event buffer: 5-minute retention window per channel
├── Delta sync on SSE reconnect via lastTimestamp
├── SSE keepalive every 30s, stale detection at 60s
├── Full sync signal when client is stale
└── Gap: events during SSE disconnect are lost

Layer 4: Browser → Beam (HTTP POST)
├── Operation queue with 30s expiry
├── Auto-process on SSE reconnect
├── Connection error detection and queuing
└── Gap: queue lost on page reload (in-memory)
```

### Recovery Strategy

When a notification is missed at any layer, the system self-heals:

1. **Delta sync** (Layer 2): `subscribeChannel({ reconnect: true })` auto-reconnects with exponential backoff, restarts daemon if needed, replays events missed during the outage via `lastTimestamp`
2. **Full sync** (Layer 2/3): When client's timestamp is older than the 5-minute buffer, server sends `refresh-needed` signal — client re-fetches entire state
3. **SSE reconnect** (Layer 3): Browser's `EventSource` auto-reconnects, Beam replays buffered events
4. **Silent refresh** (Layer 3→4): On `state-changed` notification, Beam UI re-executes the displayed method without spinner
5. **Manual re-execute** (any layer): User can always click Execute to get current state — disk is the source of truth

### Daemon Lifecycle

| Event | Behavior |
|-------|----------|
| Beam starts with `@stateful` photons | `ensureDaemon()` auto-starts daemon |
| CLI runs `photon cli <stateful> <method>` | Auto-starts daemon if not running |
| Daemon crashes | `subscribeChannel(reconnect: true)` detects drop, restarts daemon, resubscribes |
| All clients disconnect | Daemon stays running (detached process) |
| Machine reboot | Daemon restarts on next client interaction, state restored from disk |

### Shared Session Model

All clients use the same daemon session ID (`shared-{photonName}`) for stateful photons. This means:
- One photon instance in memory, shared across CLI, Beam, and MCP
- Mutations from any client are immediately visible to all others (via state-changed notifications)
- State constructor params are restored from disk on daemon restart

---

## Communication Patterns

### Allowed Protocols

| Path | Protocol | Implementation |
|------|----------|----------------|
| Browser ↔ Beam | MCP Streamable HTTP | `POST /mcp` + SSE responses |
| Cross-process sync | Daemon Unix Socket | `~/.photon/daemon.sock` |
| Photon ↔ External MCP | stdio / SSE / HTTP | `@mcp` directive |
| CLI ↔ Photon (stateless) | Direct method call | In-process |
| CLI ↔ Photon (`@stateful`) | Daemon Unix Socket | Shared session via daemon |
| Beam ↔ Photon (`@stateful`) | Daemon Unix Socket | Routed through daemon for shared instance |

### Real-Time Flow

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

---

## Forbidden Patterns

These patterns cause real bugs. Pre-commit hook blocks errors, warns on others.

### ERRORS (Commit Blocked)

#### WebSocket in Beam
```typescript
// FORBIDDEN in src/auto-ui/
import { WebSocketServer } from 'ws';
new WebSocket('ws://...');

// USE INSTEAD
import { handleStreamableHTTP, broadcastNotification } from './streamable-http-transport.js';
```

**Why:** Beam is a pure MCP interface. WebSocket breaks that model.

### WARNINGS (Review Required)

#### In-Memory Cache for Shared Data
```typescript
// WARNING - causes cross-process sync issues
const boardCache = new Map<string, Board>();

// USE INSTEAD - disk + daemon pub/sub
async function loadBoard(name: string): Promise<Board> {
  return JSON.parse(await fs.readFile(boardPath, 'utf-8'));
}
```

#### fetch() Without Timeout
```typescript
// WARNING - can hang indefinitely
const response = await fetch(url);

// USE INSTEAD
const response = await fetch(url, {
  signal: AbortSignal.timeout(10000)
});
```

---

## Required Patterns

### Real-Time Updates (Cross-Client Sync)

Photon uses **standard MCP protocol** for real-time sync, enabling events to flow between Beam, Claude Desktop, and any MCP Apps-compatible client.

```
SERVER: Photon Class                    CLIENT: Mirrored API
┌─────────────────────────┐            ┌─────────────────────────┐
│ class Kanban {          │            │ kanban.onTaskMove(cb)   │
│   taskMove(params) {    │            │ kanban.onTaskCreate(cb) │
│     this.emit('taskMove'│ ─────────► │ kanban.taskMove(params) │
│       , data);          │            │                         │
│   }                     │            │                         │
│ }                       │            │                         │
└─────────────────────────┘            └─────────────────────────┘
           │                                      ▲
           ▼                                      │
┌──────────────────────────────────────────────────────────────┐
│ WIRE: Standard MCP notification                              │
│ {                                                            │
│   method: 'ui/notifications/host-context-changed',          │
│   params: { _photon: { event: 'taskMove', data: {...} } }   │
│ }                                                            │
│                                                              │
│ Claude Desktop forwards this (standard notification)         │
│ Photon bridge extracts _photon and routes to onTaskMove()   │
└──────────────────────────────────────────────────────────────┘
```

**Server-side: emit events**
```typescript
// Simple event emission
this.emit('taskMove', { taskId, column });

// Or with explicit channel
this.emit({
  channel: `${this.photonId}:${boardName}`,
  event: 'taskMove',
  data: { taskId, column }
});
```

**Client-side: direct window API**
```javascript
// Subscribe to specific events (recommended)
kanban.onTaskMove((data) => {
  moveTaskInUI(data.taskId, data.column);
});

// Or use generic event subscription
photon.on('taskMove', (data) => {
  moveTaskInUI(data.taskId, data.column);
});

// Call server methods
await kanban.taskMove({ id: 'task-1', column: 'Done' });
```

**Why standard protocol?**
- Claude Desktop and other MCP Apps hosts forward standard notifications
- No custom protocol support required from hosts
- Events work cross-client (Beam ↔ Claude Desktop)

### Error Handling

```typescript
try {
  const result = await riskyOperation();
  return { success: true, data: result };
} catch (error) {
  logger.error('Operation failed', { error, context: { ... } });
  return { success: false, error: error.message };
}
```

---

## Pre-Commit Hook

The `.git/hooks/pre-commit` script enforces architectural constraints:

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

## Related Documentation

- [DAEMON-PUBSUB.md](./DAEMON-PUBSUB.md) - Detailed pub/sub protocol
- [AUTO-UI-ARCHITECTURE.md](./AUTO-UI-ARCHITECTURE.md) - UI system architecture
- [ADVANCED.md](../guides/ADVANCED.md) - Integration patterns (external services)

---

*Last updated: February 2026*
