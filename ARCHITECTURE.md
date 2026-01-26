# Photon Architecture

> **This document defines architectural constraints that MUST be followed.**
> Violations will be caught by pre-commit hooks.

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

These patterns are **explicitly forbidden** in the codebase. Pre-commit hooks enforce this.

### In `src/auto-ui/` (Beam)

| Pattern | Why Forbidden | Use Instead |
|---------|---------------|-------------|
| `WebSocketServer` | Beam uses SSE only | `handleStreamableHTTP()` |
| `new WebSocket(` | No WS client in Beam | MCP client with SSE |
| `wss.on('connection'` | Legacy WS handler | SSE sessions |

### In `src/auto-ui/frontend/`

| Pattern | Why Forbidden | Use Instead |
|---------|---------------|-------------|
| `new WebSocket(` | Frontend uses MCP/SSE | `MCPClient` with EventSource |
| Direct `fetch('/api/` | Bypass MCP | `window.photon.invoke()` |

### General Anti-Patterns

| Pattern | Why Forbidden | Use Instead |
|---------|---------------|-------------|
| In-memory cache for shared data | Cross-process sync fails | Read from disk, use daemon pub/sub |
| Global mutable state | Race conditions | Instance state or daemon locks |

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

Always use daemon pub/sub for cross-process sync:
```typescript
import { subscribeChannel, publishChannel } from './daemon-client.js';

// Subscribe
subscribeChannel(photonName, channel, (message) => {
  // Handle cross-process event
});

// Publish
publishChannel(photonName, channel, event, data);
```

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

**Decision:** Use MCP Streamable HTTP (SSE) for all browser↔server communication.

### Why Daemon for Cross-Process?

| Aspect | Shared Memory/Files | Daemon (Chosen) |
|--------|---------------------|-----------------|
| Real-time | Polling required | Push notifications |
| Consistency | Race conditions | Serialized via broker |
| Complexity | Simple but fragile | Robust pub/sub |

**Decision:** Use daemon Unix socket for cross-process pub/sub.

---

## Verification

### Pre-Commit Hook

The `.claude/hooks/pre-commit` script enforces these constraints:

```bash
# Forbidden patterns in Beam
grep -r "WebSocketServer\|wss\.on\|new WebSocket" src/auto-ui/ && exit 1

# Forbidden patterns in frontend
grep -r "new WebSocket" src/auto-ui/frontend/ && exit 1
```

### Manual Verification

Before major changes, verify:
1. No new communication protocols introduced
2. Real-time uses `this.emit()` pattern
3. Cross-process uses daemon pub/sub
4. No in-memory caches for shared data

---

## Related Documentation

- [DAEMON-PUBSUB.md](DAEMON-PUBSUB.md) - Detailed pub/sub protocol
- [docs/core/AUTO-UI-ARCHITECTURE.md](docs/core/AUTO-UI-ARCHITECTURE.md) - UI system architecture
- [ADVANCED.md](ADVANCED.md) - Integration patterns (external services)

---

*Last updated: January 2026*
