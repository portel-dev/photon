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

### Real-Time Updates

```typescript
// Server-side: emit events
this.emit({
  channel: `${this.photonId}:${itemId}`,
  event: 'data-changed',
  data: { ... }
});

// Client-side: receive via postMessage
window.addEventListener('message', (event) => {
  if (event.data.type === 'photon:channel-event') {
    handleUpdate(event.data);
  }
});
```

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

*Last updated: January 2026*
