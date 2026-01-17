# Daemon Pub/Sub Protocol

Real-time messaging via Unix sockets for local development. Part of the `@stateful` daemon infrastructure.

## Problem Statement

When Claude moves a Kanban task via MCP, the BEAM UI doesn't update because:
- MCP and BEAM are separate processes with separate photon instances
- `emit()` only sends to the current caller's `outputHandler`
- No cross-process notification mechanism existed

## Solution

Extend the existing `@stateful` daemon with pub/sub channels:

```
┌─────────────────┐     ┌───────────────────────────────────┐     ┌────────────────┐
│  Photon Tool    │────▶│   Daemon                          │────▶│  BEAM UI       │
│  (MCP/Claude)   │     │   ~/.photon/daemons/kanban.sock   │     │  (WebSocket)   │
└─────────────────┘     └───────────────────────────────────┘     └────────────────┘
        │                             ▲                                    │
        │                             │                                    │
        └─────── emit({ channel }) ───┴──── subscribe(channel) ────────────┘
```

## Protocol Extensions

### Request Types

Added to `DaemonRequest`:

```typescript
export interface DaemonRequest {
  type: 'command' | 'ping' | 'shutdown' | 'prompt_response'
      | 'subscribe' | 'unsubscribe' | 'publish';  // NEW
  id: string;
  channel?: string;      // Channel name for pub/sub
  message?: unknown;     // Payload for publish operations
  // ... existing fields
}
```

### Response Types

Added to `DaemonResponse`:

```typescript
export interface DaemonResponse {
  type: 'result' | 'error' | 'pong' | 'prompt' | 'channel_message';  // NEW
  id: string;
  channel?: string;      // Channel for channel_message type
  message?: unknown;     // Payload for channel_message type
  // ... existing fields
}
```

## Protocol Messages

### Subscribe

Request:
```json
{
  "type": "subscribe",
  "id": "sub_123",
  "channel": "board:my-board"
}
```

Response:
```json
{
  "type": "result",
  "id": "sub_123",
  "success": true,
  "data": { "subscribed": true, "channel": "board:my-board" }
}
```

### Unsubscribe

Request:
```json
{
  "type": "unsubscribe",
  "id": "unsub_456",
  "channel": "board:my-board"
}
```

Response:
```json
{
  "type": "result",
  "id": "unsub_456",
  "success": true,
  "data": { "unsubscribed": true, "channel": "board:my-board" }
}
```

### Publish

Request:
```json
{
  "type": "publish",
  "id": "pub_789",
  "channel": "board:my-board",
  "message": { "event": "task-moved", "taskId": "123" }
}
```

Response:
```json
{
  "type": "result",
  "id": "pub_789",
  "success": true,
  "data": { "published": true, "channel": "board:my-board" }
}
```

### Channel Message (Push)

Sent to all subscribers when a message is published:
```json
{
  "type": "channel_message",
  "id": "ch_123_abc",
  "channel": "board:my-board",
  "message": { "event": "task-moved", "taskId": "123" }
}
```

## Client API

### Subscribe to a Channel

```typescript
import { subscribeChannel } from '@portel/photon/daemon/client';

const unsubscribe = await subscribeChannel('kanban', 'board:my-board', (message) => {
  console.log('Received:', message);
  // Update UI, trigger refresh, etc.
});

// Later: cleanup
unsubscribe();
```

### Publish to a Channel

```typescript
import { publishToChannel } from '@portel/photon/daemon/client';

await publishToChannel('kanban', 'board:my-board', {
  event: 'task-moved',
  taskId: '123',
  newColumn: 'Done'
});
```

## Server Implementation

The daemon server (`src/daemon/server.ts`) maintains channel subscriptions in memory:

```typescript
// Channel subscriptions for pub/sub
// Map: channel name -> Set of subscribed sockets
const channelSubscriptions = new Map<string, Set<net.Socket>>();
```

Key behaviors:
- Subscriptions are per-socket (connection)
- When a socket disconnects, all its subscriptions are cleaned up
- Publishers don't receive their own messages (excludeSocket)
- No persistence - channels are ephemeral

## Usage in Photons

When a photon method calls `this.emit()` with a `channel` property, it automatically publishes via the channel broker system (which uses this daemon protocol for local development):

```typescript
// In a photon method
async moveTask(params: { taskId: string; column: string }) {
  // ... move task logic ...

  // This broadcasts to all subscribers
  this.emit({
    channel: `board:${this.boardName}`,
    event: 'task-moved',
    data: { taskId: params.taskId, newColumn: params.column }
  });

  return { success: true };
}
```

## BEAM Integration

BEAM uses the daemon pub/sub to receive real-time updates:

```typescript
// In BEAM server
import { subscribeChannel } from '../daemon/client.js';

// When a client requests board updates
const unsubscribe = await subscribeChannel('kanban', `board:${boardName}`, (data) => {
  // Forward to WebSocket clients
  broadcast({ type: 'channel', channel: `board:${boardName}`, data });
});
```

## Relationship to Channel Brokers

This daemon pub/sub is the **local implementation** of the broader channel broker architecture defined in `@portel/photon-core`. The broker system auto-detects and uses this daemon protocol when:

1. `PHOTON_CHANNEL_BROKER` is not set (auto-detect mode)
2. No Redis or HTTP broker environment variables are configured
3. The daemon socket file exists at `~/.photon/daemons/{photon}.sock`

For cloud/multi-server deployments, use Redis or HTTP brokers instead. See `@portel/photon-core` CHANNELS.md for the full broker architecture.

## Files

| File | Purpose |
|------|---------|
| `src/daemon/protocol.ts` | Type definitions for pub/sub messages |
| `src/daemon/server.ts` | Server-side channel handling |
| `src/daemon/client.ts` | Client functions (subscribeChannel, publishToChannel) |

## Limitations

- **Local only**: Unix sockets work on a single machine
- **No persistence**: Messages are not stored; missed messages are lost
- **No wildcards**: Must subscribe to exact channel names
- **Memory-based**: All subscriptions are in-memory

For production/cloud deployments, use the Redis or HTTP brokers in `@portel/photon-core`.
