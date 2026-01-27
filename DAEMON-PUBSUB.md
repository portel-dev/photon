# Daemon Pub/Sub and Real-Time Communication

> Complete guide to real-time communication between Beam, Custom UIs, and MCP clients using SSE and daemon pub/sub.

---

## Architecture Overview

Photon uses **Server-Sent Events (SSE)** via the MCP Streamable HTTP transport for all real-time communication. WebSocket has been removed in favor of this simpler, more standard approach.

```
┌─────────────────┐     POST /mcp         ┌─────────────────┐
│  Browser/Client │ ───────────────────► │   Beam Server   │
│                 │                       │                 │
│  MCP Client     │ ◄─────────────────── │  Streamable     │
│  (SSE listener) │   SSE notifications   │  HTTP Transport │
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

## Key Concepts

### Photon ID

Every photon has a unique 12-character hash ID generated from its file path:

```typescript
import { createHash } from 'crypto';

function generatePhotonId(photonPath: string): string {
  return createHash('sha256').update(photonPath).digest('hex').slice(0, 12);
}

// Example:
// Path: ~/.photon/kanban.photon.ts
// ID:   f5c5ee47905e
```

**Why hashed IDs?**
- **Unique across systems**: Different installations get different IDs
- **Stable**: Same path always produces same ID
- **Multi-tenant safe**: No collisions between users/projects
- **Short**: 12 chars is enough for practical uniqueness

**Where IDs are exposed:**
- `PhotonInfo.id` - In the photon metadata
- `x-photon-id` header - In MCP tools/list response
- Channel names - Format: `{photonId}:{itemId}`

### Channel Format

Channels follow the pattern `{photonId}:{itemId}`:

```
f5c5ee47905e:photon     - Main board channel
f5c5ee47905e:task-123   - Specific task channel
f5c5ee47905e:*          - Wildcard subscription
```

This ensures complete isolation between:
- Different photon instances
- Different data directories
- Different users

---

## SSE-Only Architecture

### Why SSE Instead of WebSocket?

| Feature | WebSocket | SSE (Current) |
|---------|-----------|---------------|
| Complexity | Bidirectional, complex state | Unidirectional, simple |
| Firewall/Proxy | Often blocked | HTTP, passes through |
| Reconnection | Manual implementation | Built-in browser support |
| MCP Alignment | Custom protocol | Standard Streamable HTTP |
| Multiplexing | Not HTTP/2 friendly | HTTP/2 native |

### Streamable HTTP Transport

The `/mcp` endpoint implements MCP Streamable HTTP:

```
┌──────────────┐          ┌──────────────┐
│   Client     │          │   Server     │
├──────────────┤          ├──────────────┤
│              │  POST    │              │
│  Request  ───┼─────────►│  Process     │
│              │          │              │
│              │  SSE     │              │
│  Listen   ◄──┼──────────┤  Stream      │
│              │          │  results +   │
│              │          │  notifications│
└──────────────┘          └──────────────┘
```

**Request:** JSON-RPC 2.0 over HTTP POST
**Response:** SSE stream with results and notifications

### Client Identification

Beam identifies itself to the server during MCP initialization:

```typescript
// Client sends during initialize
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "beam",
      "version": "1.0.0"
    }
  }
}
```

The server tracks Beam clients separately to send Beam-specific notifications.

---

## Subscription Reference Counting

### Problem

Without management, each browser tab would create its own daemon subscription, leading to:
- Duplicate subscriptions
- Resource leaks when tabs close
- Inconsistent state

### Solution: Reference Counting

The `SubscriptionManager` tracks active viewers per channel:

```typescript
interface SubscriptionManager {
  // Subscribe to a channel (increments ref count)
  subscribe(photonId: string, itemId: string): Promise<void>;

  // Unsubscribe from a channel (decrements ref count)
  unsubscribe(photonId: string, itemId: string): Promise<void>;

  // Called when SSE connection closes
  onClientDisconnect(sessionId: string): void;
}
```

### How It Works

```
Browser 1 opens kanban board
    │
    ▼
subscribe("f5c5ee47905e", "photon")
    │
    ├── Count: 0 → 1 (first viewer)
    │   └── Creates daemon subscription
    │
    ▼
Browser 2 opens same board
    │
    ▼
subscribe("f5c5ee47905e", "photon")
    │
    ├── Count: 1 → 2 (reuses existing)
    │   └── No new daemon subscription
    │
    ▼
Browser 1 closes
    │
    ▼
onClientDisconnect(session1)
    │
    ├── Count: 2 → 1 (still has viewers)
    │   └── Keeps daemon subscription
    │
    ▼
Browser 2 closes
    │
    ▼
onClientDisconnect(session2)
    │
    ├── Count: 1 → 0 (no viewers)
    │   └── Removes daemon subscription
```

### Viewing Notification Protocol

Custom UIs notify Beam when the user is viewing a specific item:

```typescript
// Custom UI sends via postMessage
window.parent.postMessage({
  type: 'photon:viewing',
  photonId: 'f5c5ee47905e',
  itemId: 'my-board'
}, '*');

// Beam forwards to server via MCP notification
{
  "jsonrpc": "2.0",
  "method": "notifications/beam/viewing",
  "params": {
    "photonId": "f5c5ee47905e",
    "itemId": "my-board"
  }
}
```

---

## Cross-Browser Real-Time Sync

### Event Flow

When a change happens in one browser, all other browsers receive updates:

```
┌─────────────────┐    MCP call     ┌─────────────────┐
│  Safari         │ ──────────────► │  Beam Server    │
│  (MCP Client)   │                 │                 │
└─────────────────┘                 │  ┌───────────┐  │
                                    │  │ Execute   │  │
                                    │  │ Photon    │  │
                                    │  │ Method    │  │
                                    │  └─────┬─────┘  │
                                    │        │        │
                                    │  ┌─────▼─────┐  │
                                    │  │ this.emit │  │
                                    │  └─────┬─────┘  │
                                    └────────┼────────┘
                                             │
                            ┌────────────────┼────────────────┐
                            ▼                ▼                ▼
                    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                    │ Daemon Broker│ │ SSE to       │ │ SSE to       │
                    │ (cross-proc) │ │ Safari       │ │ Chrome       │
                    └──────────────┘ └──────────────┘ └──────────────┘
```

### In-Process vs Cross-Process

**In-Process (same Beam server):**
- MCP call → outputHandler captures emit → SSE broadcast to all sessions

**Cross-Process (different servers/processes):**
- Photon emit → Daemon broker → All subscribed Beam servers → SSE to clients

### Shadow DOM Traversal

Custom UIs render inside nested shadow DOMs:

```html
<beam-app>
  #shadow-root
    <custom-ui-renderer>
      #shadow-root
        <iframe>  <!-- Custom UI lives here -->
```

To forward events to iframes, Beam traverses the shadow DOM hierarchy:

```typescript
// In beam-app.ts
mcpClient.on('channel-event', (data) => {
  const iframes: HTMLIFrameElement[] = [];

  // Find iframes in custom-ui-renderer shadow DOMs
  this.shadowRoot?.querySelectorAll('custom-ui-renderer').forEach(renderer => {
    const iframe = renderer.shadowRoot?.querySelector('iframe');
    if (iframe) iframes.push(iframe);
  });

  // Also check for direct iframes
  this.shadowRoot?.querySelectorAll('iframe').forEach(iframe => {
    iframes.push(iframe);
  });

  // Forward to all found iframes
  iframes.forEach(iframe => {
    iframe.contentWindow?.postMessage({
      type: 'photon:channel-event',
      ...data
    }, '*');
  });
});
```

---

## Event Types

### Standard Channel Events

| Event | Description | Data |
|-------|-------------|------|
| `task-created` | New task added | `{ task: Task }` |
| `task-updated` | Task modified | `{ task: Task }` |
| `task-moved` | Task changed column | `{ taskId, column }` |
| `task-deleted` | Task removed | `{ taskId }` |
| `board-updated` | Board structure changed | `{ columns: string[] }` |

### Beam-Specific Notifications

| Method | Description | When Sent |
|--------|-------------|-----------|
| `beam/photons-changed` | Photon list updated | Hot reload, add/remove |
| `beam/hot-reload` | File changed | Dev mode file watch |
| `beam/viewing` | Client viewing item | Custom UI notification |
| `photon/board-update` | Board data changed | Any kanban modification |

---

## Custom UI Integration

### Receiving Events

Custom UIs receive events via postMessage from the parent Beam app:

```javascript
// In your Custom UI HTML
window.addEventListener('message', (event) => {
  const { type, ...data } = event.data;

  switch (type) {
    case 'photon:channel-event':
      // Real-time update from daemon pub/sub
      handleChannelEvent(data);
      break;

    case 'photon:board-update':
      // Board-specific update
      refreshBoard(data);
      break;

    case 'photon:theme-change':
      // Theme toggle
      document.body.className = data.theme;
      break;
  }
});
```

### Notifying Parent of Current View

When the user switches views, notify Beam to update subscriptions:

```javascript
function notifyViewingBoard(boardName) {
  window.parent.postMessage({
    type: 'photon:viewing',
    photonId: window.photon.photonId, // Available on bridge
    itemId: boardName
  }, '*');
}

// Call when:
// - Board loads
// - User switches boards
// - Auto-mode changes active board
```

### Bridge API

The `window.photon` bridge provides:

```typescript
interface PhotonBridge {
  // Call photon methods
  invoke(method: string, params: object): Promise<any>;

  // Get current theme
  theme: 'light' | 'dark';

  // Photon's unique ID
  photonId: string;

  // Listen for events (deprecated - use postMessage)
  on(event: string, callback: Function): void;
}
```

---

## Debugging Real-Time Issues

### Server-Side Logging

Enable debug logging in beam.ts:

```typescript
// Temporary debug: log session info
console.log(`[beam] Session ${sessionId} initialized, isBeam: ${session.isBeam}`);

// Temporary debug: log viewing notifications
console.log(`[beam] Viewing notification: photon=${photonId}, item=${itemId}`);

// Temporary debug: log broadcasts
console.log(`[beam] Broadcasting to ${sessions.size} sessions`);
```

### Client-Side Logging

In your Custom UI:

```javascript
window.addEventListener('message', (event) => {
  console.log('[custom-ui] Received:', event.data.type, event.data);
});
```

### Common Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| Events not received | Wrong channel format | Use `{photonId}:{itemId}` |
| Only works in same browser | Daemon not running | Check daemon socket |
| iframe not receiving | Shadow DOM issue | Use traversal pattern |
| Duplicate events | Multiple subscriptions | Check ref counting |

---

## Best Practices

### For Photon Developers

1. **Use granular events**: Send `task-moved` not `board-updated`
2. **Include enough context**: Event data should be actionable
3. **Use correct channel**: `{photonId}:{itemId}` format

```typescript
// Good: Granular event with context
this.emit({
  channel: `${this.photonId}:${boardName}`,
  event: 'task-moved',
  data: { taskId, fromColumn, toColumn, task }
});

// Avoid: Generic event requiring full refresh
this.emit({
  channel: `${this.photonId}:${boardName}`,
  event: 'refresh'
});
```

### For Custom UI Developers

1. **Always notify viewing**: Call `notifyViewingBoard` on load and switch
2. **Handle partial updates**: Process granular events efficiently
3. **Graceful degradation**: Work even if real-time fails

```javascript
// Good: Handle specific event
if (data.event === 'task-moved') {
  moveTaskInDOM(data.taskId, data.toColumn);
}

// Fallback: Full refresh if needed
if (data.event === 'unknown') {
  reloadBoard();
}
```

---

## Migration from WebSocket

If you have code using the old WebSocket protocol:

### Before (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:3457/ws');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'board-update') {
    handleUpdate(msg);
  }
};
```

### After (MCP + postMessage)

```javascript
// Events come via postMessage from parent
window.addEventListener('message', (event) => {
  if (event.data.type === 'photon:board-update') {
    handleUpdate(event.data);
  }
});

// Calls go through the bridge
await window.photon.invoke('moveTask', { taskId, column });
```

---

*Last updated: January 2026*
