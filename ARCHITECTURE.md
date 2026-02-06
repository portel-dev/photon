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
│                  ~/.photon/daemons/*.sock                       │
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
// Photon emits an event
this.emit({
  channel: `${this.photonId}:board`,
  event: 'task-moved',
  data: { taskId, column }
});

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

## Communication Patterns

### Allowed Protocols

| Path | Protocol | Implementation |
|------|----------|----------------|
| Browser ↔ Beam | MCP Streamable HTTP | `POST /mcp` + SSE responses |
| Cross-process sync | Daemon Unix Socket | `~/.photon/daemons/*.sock` |
| Photon ↔ External MCP | stdio / SSE / HTTP | `@mcp` directive |
| CLI ↔ Photon | Direct method call | In-process |

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

**Client-side: mirrored class API**
```javascript
// Subscribe to specific events (recommended)
photon.kanban.onTaskMove((data) => {
  moveTaskInUI(data.taskId, data.column);
});

// Or use generic event subscription
photon.on('taskMove', (data) => {
  moveTaskInUI(data.taskId, data.column);
});

// Call server methods
await photon.kanban.taskMove({ id: 'task-1', column: 'Done' });
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

- [DAEMON-PUBSUB.md](DAEMON-PUBSUB.md) - Detailed pub/sub protocol
- [docs/core/AUTO-UI-ARCHITECTURE.md](docs/core/AUTO-UI-ARCHITECTURE.md) - UI system architecture
- [ADVANCED.md](ADVANCED.md) - Integration patterns (external services)

---

*Last updated: February 2026*
