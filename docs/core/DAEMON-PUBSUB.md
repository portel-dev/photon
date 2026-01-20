# Daemon Protocol

Full-featured daemon infrastructure for local development via Unix sockets. Provides pub/sub messaging, distributed locks, scheduled jobs, and webhooks.

## Overview

The daemon provides four key capabilities:
1. **Pub/Sub Channels** - Real-time cross-process messaging
2. **Distributed Locks** - Coordinate exclusive access to resources
3. **Scheduled Jobs** - Cron-like background task execution
4. **Webhooks** - HTTP endpoint for external service integration

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
| `src/daemon/protocol.ts` | Type definitions for all daemon messages |
| `src/daemon/server.ts` | Server-side handlers (channels, locks, jobs, webhooks) |
| `src/daemon/client.ts` | Client functions for all daemon operations |
| `tests/daemon-pubsub.test.ts` | Comprehensive tests (48 tests) |

## Limitations (Pub/Sub)

- **Local only**: Unix sockets work on a single machine
- **No persistence**: Messages are not stored; missed messages are lost
- **No wildcards**: Must subscribe to exact channel names
- **Memory-based**: All subscriptions are in-memory

For production/cloud deployments, use the Redis or HTTP brokers in `@portel/photon-core`.

---

## Distributed Locks

Coordinate exclusive access to shared resources across multiple processes.

### Protocol Messages

#### Acquire Lock

Request:
```json
{
  "type": "lock",
  "id": "lock_123",
  "sessionId": "cli-1234-abc",
  "lockName": "board:kanban:write",
  "lockTimeout": 30000
}
```

Response (success):
```json
{
  "type": "result",
  "id": "lock_123",
  "data": { "acquired": true, "expiresAt": 1705483200000 }
}
```

Response (already held):
```json
{
  "type": "result",
  "id": "lock_123",
  "data": { "acquired": false, "holder": "mcp-5678-xyz" }
}
```

#### Release Lock

Request:
```json
{
  "type": "unlock",
  "id": "unlock_456",
  "sessionId": "cli-1234-abc",
  "lockName": "board:kanban:write"
}
```

Response:
```json
{
  "type": "result",
  "id": "unlock_456",
  "data": { "released": true }
}
```

#### List Locks

Request:
```json
{
  "type": "list_locks",
  "id": "list_789"
}
```

Response:
```json
{
  "type": "result",
  "id": "list_789",
  "data": {
    "locks": [
      {
        "name": "board:kanban:write",
        "holder": "cli-1234-abc",
        "acquiredAt": 1705483170000,
        "expiresAt": 1705483200000
      }
    ]
  }
}
```

### Client API

```typescript
import { acquireLock, releaseLock, listLocks } from '@portel/photon/daemon/client';

// Acquire a lock (returns true if acquired)
const acquired = await acquireLock('kanban', 'board:default:write', 30000);

if (acquired) {
  try {
    // Do exclusive work...
  } finally {
    // Always release
    await releaseLock('kanban', 'board:default:write');
  }
}

// List all active locks
const locks = await listLocks('kanban');
```

### Features

- **Auto-expiration**: Locks expire after timeout (default 30s)
- **Session-bound**: Only the holder session can release the lock
- **Re-entrant**: Same session can re-acquire its own lock
- **Cleanup**: Expired locks are automatically cleaned up

---

## Scheduled Jobs

Cron-like background task execution for recurring operations.

### Protocol Messages

#### Schedule Job

Request:
```json
{
  "type": "schedule",
  "id": "sched_123",
  "sessionId": "cli-1234-abc",
  "jobId": "cleanup-old-tasks",
  "method": "cleanupOldTasks",
  "cron": "0 * * * *",
  "args": { "maxAge": 86400 }
}
```

Response:
```json
{
  "type": "result",
  "id": "sched_123",
  "data": {
    "scheduled": true,
    "nextRun": 1705486800000
  }
}
```

#### Unschedule Job

Request:
```json
{
  "type": "unschedule",
  "id": "unsched_456",
  "jobId": "cleanup-old-tasks"
}
```

Response:
```json
{
  "type": "result",
  "id": "unsched_456",
  "data": { "unscheduled": true }
}
```

#### List Jobs

Request:
```json
{
  "type": "list_jobs",
  "id": "list_789"
}
```

Response:
```json
{
  "type": "result",
  "id": "list_789",
  "data": {
    "jobs": [
      {
        "id": "cleanup-old-tasks",
        "method": "cleanupOldTasks",
        "cron": "0 * * * *",
        "args": { "maxAge": 86400 },
        "nextRun": 1705486800000,
        "lastRun": 1705483200000,
        "runCount": 5,
        "createdAt": 1705400000000
      }
    ]
  }
}
```

### Client API

```typescript
import { scheduleJob, unscheduleJob, listJobs } from '@portel/photon/daemon/client';

// Schedule a recurring job
const result = await scheduleJob(
  'kanban',
  'daily-cleanup',
  'cleanupOldTasks',
  '0 0 * * *',  // Daily at midnight
  { maxAge: 604800 }  // 7 days
);

console.log(`Next run: ${new Date(result.nextRun)}`);

// List all scheduled jobs
const jobs = await listJobs('kanban');

// Remove a scheduled job
await unscheduleJob('kanban', 'daily-cleanup');
```

### Cron Syntax

Standard 5-field cron format:
```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

Examples:
- `*/5 * * * *` - Every 5 minutes
- `0 * * * *` - Every hour
- `0 0 * * *` - Daily at midnight
- `0 9 * * 1-5` - Weekdays at 9am
- `0 0 1 * *` - Monthly on the 1st

---

## Webhooks

HTTP endpoint for external services (GitHub, Stripe, etc.) to trigger photon methods.

### Starting the Webhook Server

When a daemon starts, it can optionally listen on an HTTP port:

```typescript
// In daemon server.ts
startWebhookServer(3457);  // Listen on port 3457
```

### Endpoint

```
POST http://localhost:3457/webhook/{method}
Content-Type: application/json

{
  "event": "task.completed",
  "taskId": "123"
}
```

### Authentication

Webhooks support optional secret validation:

```
POST /webhook/handleGithubPush
X-Webhook-Secret: my-secret-token
```

### Example: GitHub Webhook

```typescript
// In your photon
async handleGithubPush(params: {
  ref: string;
  commits: Array<{ message: string }>;
}) {
  // Called when GitHub pushes to your repo
  const branch = params.ref.replace('refs/heads/', '');
  const commitCount = params.commits.length;

  this.emit({
    channel: 'github:updates',
    event: 'push',
    data: { branch, commitCount }
  });

  return { processed: true };
}
```

Configure GitHub webhook:
- URL: `http://your-server:3457/webhook/handleGithubPush`
- Content type: `application/json`
- Secret: `your-secret-token`

### Example: Stripe Webhook

```typescript
async handleStripePayment(params: {
  type: string;
  data: { object: any };
}) {
  if (params.type === 'payment_intent.succeeded') {
    const payment = params.data.object;
    // Process payment...
  }
  return { received: true };
}
```

---

## Protocol Types

Full type definitions in `src/daemon/protocol.ts`:

```typescript
export interface DaemonRequest {
  type:
    | 'command' | 'ping' | 'shutdown' | 'prompt_response'
    | 'subscribe' | 'unsubscribe' | 'publish'
    | 'lock' | 'unlock' | 'list_locks'
    | 'schedule' | 'unschedule' | 'list_jobs';
  id: string;
  sessionId?: string;
  clientType?: 'cli' | 'mcp' | 'code-mode' | 'beam';
  method?: string;
  args?: Record<string, unknown>;
  channel?: string;
  message?: unknown;
  lockName?: string;
  lockTimeout?: number;
  jobId?: string;
  cron?: string;
}

export interface ScheduledJob {
  id: string;
  method: string;
  args?: Record<string, unknown>;
  cron: string;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  createdAt: number;
  createdBy?: string;
}

export interface LockInfo {
  name: string;
  holder: string;
  acquiredAt: number;
  expiresAt: number;
}
```
