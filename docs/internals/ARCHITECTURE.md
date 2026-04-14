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
│              ~/.photon/.data/daemon.sock                        │
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

#### Single-Node Constraint

The built-in lock implementation uses the daemon's Unix socket (`~/.photon/.data/daemon.sock`) and is scoped to a **single machine**. It ensures exclusive access within one node/process group but does not work in multi-node deployments.

**For multi-node setups:**
- Implement a custom lock backend (Redis Redlock, etcd leases, Consul, etc.)
- Override the lock manager in `applyMiddleware` to use your distributed backend
- The lock interface is minimal: `acquire(name, timeout)` and `release(name)`

**Identity-aware locking:** Photon extends standard lock protocols by checking `this.caller.id`. In `@locked` methods, only the lock holder's caller can proceed - attempts by other callers return an error. This Photon-specific feature is not found in standard lock implementations.

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
                ~/.photon/.data/{name}/state/{instance}/state.json
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

### Worker Thread Isolation

Photons that manage long-running runtime resources (WebSocket connections, auth sessions, polling loops) run in dedicated **worker threads** for crash isolation.

```
┌─────────────────────────────────────────────────┐
│ Daemon Process (main thread)                    │
│                                                 │
│  ┌──────────────┐  ┌──────────────┐            │
│  │ todo (in-    │  │ calculator   │  Simple    │
│  │  process)    │  │ (in-process) │  photons   │
│  └──────────────┘  └──────────────┘            │
│                                                 │
│  WorkerManager ─── routes calls via IPC ──────  │
│       │                    │                    │
├───────┼────────────────────┼────────────────────┤
│  ┌────▼─────┐         ┌───▼──────┐             │
│  │ Worker 1 │         │ Worker 2 │  Isolated   │
│  │ whatsapp │         │ telegram │  photons    │
│  │ (socket) │         │ (poll)   │             │
│  └──────────┘         └──────────┘             │
└─────────────────────────────────────────────────┘
```

**Detection logic** (in priority order):
1. `@noworker` tag → in-process (explicit opt-out)
2. `@worker` tag → worker thread (explicit opt-in)
3. Has both `onShutdown()` + `onInitialize()` → worker thread (auto-detected)
4. None → in-process (default)

**Cross-worker communication:**
- Tool calls: main thread routes via `WorkerManager.call()` (IPC)
- `@photon` deps: resolved via RPC proxy through main thread
- Pub/sub: `WorkerBroker` bridges events between workers and main `InProcessBroker`
- Hot-reload: main thread sends reload message; worker handles lifecycle hooks internally

See [`docs/reference/DOCBLOCK-TAGS.md`](../reference/DOCBLOCK-TAGS.md#worker-isolation) for usage details.

### Shared Session Model

All clients use the same daemon session ID (`shared-{photonName}`) for stateful photons. This means:
- One photon instance in memory, shared across CLI, Beam, and MCP
- Mutations from any client are immediately visible to all others (via state-changed notifications)
- State constructor params are restored from disk on daemon restart

---

## Photon Discovery & State Persistence

### Discovery Priority

When resolving a photon by name, the runtime searches multiple sources in priority order:

```
1. PHOTON_DIR (env var)    — explicit override, always wins
2. cwd (process.cwd())     — if the directory contains .photon.ts files
3. ~/.photon               — global installed photons (always included)
```

For **listing** (Beam sidebar, CLI): results from all applicable sources are merged. Higher-priority sources win on name collision — a photon named `list` in your local workspace shadows the global `list` in `~/.photon`.

For **resolution** (`photon mcp list`, `photon cli list`): the first match in priority order is used. Bundled photons (maker, marketplace, tunnel) are checked before all user sources.

### State Persistence: Always Canonical

State (`@stateful` memory, settings, instance context, event logs) **always** persists to `~/.photon/.data/` regardless of how the process was launched:

```
~/.photon/.data/{namespace}/{photonName}/state/{instance}/state.json
```

This is a hard rule. The `PHOTON_DIR` env var and `cwd` workspace detection affect **discovery only** (which photons are available to run). They never affect where state is stored.

**Why:** Without this, the same photon would have split-brain state depending on the launcher. CLI and Beam share state because they run from the same terminal. Claude Desktop would see different data because its `cwd` differs. Anchoring state to `~/.photon` eliminates this class of bugs entirely.

### Local Workspace Development

When you `cd` into a marketplace folder (or set `PHOTON_DIR`), the runtime overlays those photons on top of `~/.photon`:

```bash
# Global photons only
cd ~
photon beam   # discovers ~/.photon/*.photon.ts

# Global + local workspace (local wins on name collision)
cd ~/Projects/photons
photon beam   # discovers ./**.photon.ts + ~/.photon/*.photon.ts

# Explicit override (highest priority)
PHOTON_DIR=~/Projects/my-marketplace photon beam
```

This makes it easy to develop and test photons locally without installing them globally. The local version shadows the global one, but state is shared because it always goes to `~/.photon/.data/`.

### Environment Variable: PHOTON_DIR

| Aspect | Behavior |
|--------|----------|
| **Discovery** | Photons in `$PHOTON_DIR` are discovered alongside `~/.photon`, with `$PHOTON_DIR` taking priority |
| **State** | Always `~/.photon/.data/` — `PHOTON_DIR` has no effect on state paths |
| **Config** | `config.json` is read from `$PHOTON_DIR` when set |
| **When set automatically** | If `cwd` contains `.photon.ts` files, the runtime sets `PHOTON_DIR=cwd` for child processes |

---

## Communication Patterns

### Allowed Protocols

| Path | Protocol | Implementation |
|------|----------|----------------|
| Browser ↔ Beam | MCP Streamable HTTP | `POST /mcp` + SSE responses |
| Cross-process sync | Daemon Unix Socket | `~/.photon/.data/daemon.sock` |
| Photon ↔ External MCP | stdio / SSE / HTTP | `@mcp` directive |
| CLI ↔ Photon (stateless) | Direct method call | In-process |
| CLI ↔ Photon (`@stateful`) | Daemon Unix Socket | Shared session via daemon |
| Beam ↔ Photon (`@stateful`) | Daemon Unix Socket | Routed through daemon for shared instance |
| External Agent ↔ Beam | AG-UI over MCP | `ag-ui/run` + `ag-ui/event` notifications |

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

## Protocol Interoperability

Photon's protocol stack aligns with the emerging industry standard layers:

| Layer | Standard | Photon Implementation |
|-------|----------|----------------------|
| Agent ↔ Tool | **MCP** (Anthropic) | Core protocol — every `.photon.ts` is an MCP server |
| Agent ↔ UI | **AG-UI** (open protocol) | Adapter layer on MCP transport — `ag-ui/run` + `ag-ui/event` |
| Async Operations | **MCP Tasks** | `tasks/create` + `tasks/get` — non-blocking long-running methods |
| Server Discovery | **MCP Server Cards** | `GET /.well-known/mcp-server` — auto-generated from photon metadata |
| Agent ↔ Agent | **A2A** (Google) | `GET /.well-known/agent.json` — Agent Cards with skills from methods |
| Observability | **OTel GenAI** (CNCF) | `gen_ai.tool.call` spans on `executeTool` — opt-in via `@opentelemetry/api` |

### AG-UI Protocol Support

AG-UI events flow as MCP notifications over the existing SSE transport. No separate endpoint.

**Two modes:**

1. **Proxy** — external AG-UI agents (LangGraph, CrewAI, Google ADK, etc.) stream through Beam:
   ```
   ag-ui/run { agentUrl: "https://agent.example.com", input: RunAgentInput }
   → proxies SSE events as ag-ui/event MCP notifications
   ```

2. **Local** — Photon methods emit AG-UI-compatible events:
   ```
   ag-ui/run { photon: "name", method: "tool", input: RunAgentInput }
   → wraps yields (stream, progress, emit) as AG-UI events
   ```

**Event mapping:**

| Photon Yield | AG-UI Event |
|---|---|
| Stream chunks (strings) | `TEXT_MESSAGE_START` / `CONTENT` / `END` |
| `yield { emit: 'progress' }` | `STEP_STARTED` / `STEP_FINISHED` |
| Channel events (patches) | `STATE_DELTA` (RFC 6902 JSON Patch) |
| `this.emit()` | `CUSTOM` event |
| Tool result | `STATE_SNAPSHOT` + `RUN_FINISHED` |
| Error | `RUN_ERROR` |

**Spec compliance:**
- MCP: Custom notifications are legal per JSON-RPC 2.0. Advertised via `experimental.ag-ui` capability.
- AG-UI: Transport-agnostic by design. Events arrive in order via SSE. Terminal event guaranteed.

**Files:** `src/ag-ui/types.ts`, `src/ag-ui/adapter.ts`, handler in `streamable-http-transport.ts`

### Bidirectional State Exposure

Custom UIs passively expose context to photon methods via `_clientState`:

```
UI sets widgetState → bridge auto-attaches as _clientState →
loader strips before schema validation → available as this._clientState
```

CLI calls without widgetState work unchanged — the field is optional.

### Persistent Approval Queue

Durable human-in-the-loop that survives navigation and restart:

```
yield { ask: 'confirm', persistent: true, expires: '24h' }
→ written to ~/.photon/.data/{photon}/state/{instance}/approvals.json
→ exposed as approval:// MCP resources
→ resolved via beam/approval-response
```

### MCP Tasks (Async Long-Running Operations)

Non-blocking execution for methods that take time. Client gets a task ID immediately, polls for completion.

```
tasks/create { photon: "name", method: "tool", arguments: {...} }
→ returns { taskId: "task_xxx", state: "working" }

tasks/get { taskId: "task_xxx" }
→ returns { state: "completed", result: {...} }
```

**Task states:** `working` → `completed` | `failed` | `cancelled`. Generator yields update progress; `yield { ask: ... }` sets `input_required`.

**Storage:** `~/.photon/.data/tasks/{taskId}.json`

**Files:** `src/tasks/types.ts`, `src/tasks/store.ts`, handlers in `streamable-http-transport.ts`

### MCP Server Cards (Discovery)

Auto-generated metadata describing the server's capabilities, photons, and tools — enabling discovery without connecting.

```
GET /.well-known/mcp-server → ServerCard JSON
```

Also available via MCP: `server/card` handler.

**Files:** `src/server-card.ts`, route in `beam.ts`

### A2A Agent Cards (Multi-Agent Discovery)

Each Beam instance is discoverable as an A2A agent. Photon methods become A2A skills.

```
GET /.well-known/agent.json → AgentCard JSON
```

Also available via MCP: `a2a/card` handler.

**Capabilities auto-detected:** `tool_execution`, `stateful`, `streaming`, `ag-ui`

**Files:** `src/a2a/types.ts`, `src/a2a/card-generator.ts`, route in `beam.ts`

### OpenTelemetry GenAI (Observability)

Optional instrumentation using OTel GenAI semantic conventions. Zero cost when `@opentelemetry/api` is not installed — falls back to no-op spans.

```
executeTool("photon", "method", params)
→ creates span: gen_ai.tool.call { gen_ai.agent.name, gen_ai.tool.name, gen_ai.operation.name }
```

**Attributes:** `gen_ai.agent.name`, `gen_ai.tool.name`, `gen_ai.operation.name`, `photon.instance`, `photon.stateful`, `photon.caller`

**Files:** `src/telemetry/otel.ts`, instrumentation in `src/loader.ts`

---

## Related Documentation

- [DAEMON-PUBSUB.md](./DAEMON-PUBSUB.md) - Detailed pub/sub protocol
- [AUTO-UI-ARCHITECTURE.md](./AUTO-UI-ARCHITECTURE.md) - UI system architecture
- [ADVANCED.md](../guides/ADVANCED.md) - Integration patterns (external services)

---

*Last updated: March 2026*
