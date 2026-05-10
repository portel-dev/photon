> Related: [INDEX.md](INDEX.md)

# Daemon Architecture: Runtimes, Communication, and Resilience

## The Model

Every runtime that runs photons - Beam, a photon launched directly via CLI, or a photon exposed via MCP stdio - communicates through a single global daemon process. No runtime executes photon code directly; they all delegate to the daemon via a Unix socket.

```
  Beam (HTTP server)
       |
       v
  daemon.sock  ←── CLI photon run
  (~/.photon/.data/daemon.sock)
       ^
       |
  MCP stdio server (server.ts)
```

The socket path is always `~/.photon/.data/daemon.sock` regardless of `PHOTON_DIR`, working directory, or which project you are in. This is hardcoded in `photon-core/src/data-paths.ts:getDaemonSocketPath()`. One user = one daemon = one socket. The `baseDir` for state and cache varies per project directory; the daemon socket never does.

## What Is Implemented

### Event replay on reconnect

`src/daemon/server.ts` maintains `channelEventBuffers: Map<string, ChannelBuffer>`. Every channel event is written to this buffer via `bufferEvent()` before dispatch. Events older than **5 minutes** (`EVENT_BUFFER_DURATION_MS = 5 * 60 * 1000`) are pruned on each write.

When a subscriber reconnects it sends its `lastEventId` (a Unix timestamp). The daemon runs `getEventsSince()`:
- If the buffer has events since `lastEventId`, they are replayed immediately (delta sync).
- If the buffer is empty and `lastEventId > 0` (daemon restarted), the response carries `refreshNeeded: true`. The subscriber must do a full state reload.
- If `lastEventId` is older than the oldest buffered event (subscriber was gone more than 5 minutes), same result: `refreshNeeded: true`.

There is no size cap on the buffer beyond the time window. A high-frequency channel that generates thousands of events per minute will hold all of them for 5 minutes.

### sendCommand retry behavior

`sendCommand` in `src/daemon/client.ts` defaults to `maxRetries: 1`. On the first connection error (`isDaemonConnectionError` - ENOENT, ECONNREFUSED, "service stopped", etc.) it calls `ensureDaemon()` to start the daemon if it is not running, then retries the command once.

**There is no queue, no waiting period.** If the daemon is down and `ensureDaemon()` fails or the retry also fails, the call throws. During the 30-second window of a daemon restart, a CLI tool call will attempt once, start the daemon, and retry - total latency is the daemon startup time (typically under 2 seconds), not 30 seconds.

For read-only methods listed in `RETRYABLE_METHODS`, transient errors (request timeout, "shutting down") also trigger a retry with exponential backoff (500ms to 2s).

### subscribeChannel reconnect loop

`subscribeChannel` in `src/daemon/client.ts` accepts `reconnect: true` for permanent subscriptions. On any disconnect (socket error, socket end, daemon shutdown signal) it schedules a reconnect with exponential backoff: 1s, 2s, 4s... capped at 30 seconds. There is no maximum attempt count by default (`maxReconnectAttempts` defaults to `Infinity`).

Each reconnect attempt:
1. Calls `ensureDaemon()` (coalesced - concurrent callers share one start attempt)
2. Calls `connect()` which re-establishes the subscription with the last seen `eventId`
3. Resets the attempt counter on success

Beam uses this for its real-time channel subscriptions. The subscription survives daemon restarts transparently as long as the gap is under 5 minutes (within the buffer window).

### MCP stdio goes through the daemon

`src/server.ts` (the MCP stdio + SSE server) calls `sendCommand` for every tool invocation (lines 1305, 1317). At startup it calls `ensureDaemon(true)` (line 2218). MCP stdio is **not** independent - it depends on the daemon for all photon execution. Losing the daemon during an MCP stdio session will cause tool calls to fail until the daemon restarts and the call retries.

## Fixed Gaps (closed in v1.30.x)

### Socket error now always handled (was: process crash)

`connectToDaemon` previously threw synchronously when the socket file was missing. A throw inside a Promise executor becomes a rejection (fine), but a throw outside one crashes the process. Callers that used fire-and-forget patterns triggered this.

Fixed: `connectToDaemon` now always returns a socket and emits the ENOENT error asynchronously via `process.nextTick`. This matches `net.createConnection` semantics — callers always attach `error` handlers before the event fires. The `process.on('uncaughtException')` band-aid in `beam.ts` has been removed.

### sendCommand waits for daemon readiness (was: single blind retry)

After `ensureDaemon()`, the daemon process may be starting but the socket not yet bound. The previous single retry happened immediately, hitting the not-yet-ready socket and failing.

Fixed: `waitForDaemon()` polls `pingDaemon` with exponential backoff (100ms → 1s, cap 10s) after `ensureDaemon()`. The retry only fires once the socket responds, covering the daemon startup window.

### Event buffer has a count cap (was: unbounded in 5-minute window)

High-frequency channels could accumulate thousands of events within the 5-minute window.

Fixed: `MAX_BUFFER_EVENTS_PER_CHANNEL = 500` enforced in `bufferEvent`. Overflow drops oldest events; reconnecting clients with a stale `lastEventId` receive `refreshNeeded: true` and do a full sync via the existing mechanism.

## Still Open

### No cross-directory daemon awareness at the CLI level

The daemon is global but `baseDir` for state is per-directory. When a photon changes its working directory (e.g. a user switches projects), the daemon continues holding instances from the previous directory until they are explicitly unloaded or the daemon restarts. There is no protocol for a CLI client to announce its working directory is changing or for the daemon to scope running instances to their originating directory.

### No command queueing during daemon downtime

Commands that arrive during a daemon restart window are retried once (after `waitForDaemon` returns). If the daemon takes longer than 10 seconds to start, the retry fails. High-concurrency MCP clients issuing parallel tool calls during a restart will see some failures. True queueing (hold commands until daemon is ready, drain in order) is not implemented.

## The Intended Model (User's Vision)

The intended architecture is:
- Single daemon, always alive, owns all photon instances
- Reconnecting clients (Beam restarts, CLI photon runs, MCP stdio sessions) pick up where they left off via the event replay buffer
- Commands queue during brief daemon downtime rather than failing
- All runtimes - Beam, CLI, MCP stdio - are interchangeable from the daemon's perspective

The event replay buffer implements the subscriber side of this. The command side has a single retry (not a queue). The daemon-global socket with per-client reconnect loops is the right structure.

## File Map

| Concern | File | Key Lines |
|---------|------|-----------|
| Global socket path | `photon-core/src/data-paths.ts` | `getDaemonSocketPath()` |
| Event buffer | `src/daemon/server.ts` | `bufferEvent`, `getEventsSince`, ~442-496 |
| Buffer window | `src/daemon/server.ts` | `EVENT_BUFFER_DURATION_MS = 5 * 60 * 1000` (line 439) |
| sendCommand retry | `src/daemon/client.ts` | `sendCommand`, ~232-278 |
| subscribeChannel reconnect | `src/daemon/client.ts` | `subscribeChannel`, `scheduleReconnect`, ~628-658 |
| MCP stdio daemon calls | `src/server.ts` | `ensureDaemon` line 2218, `sendCommand` lines 1305-1317 |
| Beam crash handler (band-aid) | `src/auto-ui/beam.ts` | `process.on('uncaughtException')` in `startBeam()` |
