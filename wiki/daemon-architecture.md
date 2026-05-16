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

## Constructor Env Replay for Stateful Daemon Photons

### Problem statement

Stateful photon data is already persisted separately and should stay unchanged. The restart problem is specifically constructor environment injection:

- Photon knows which constructor parameters are env injections, dependency injections, photon injections, and state injections.
- Only primitive constructor params resolved as env injections need daemon replay.
- MCP/photon dependencies are already re-injected by the runtime.
- Stateful data is already restored through the existing state system.

When a stateful photon is hosted by the daemon, the daemon may need to reconstruct the class after restart. At that point the original shell environment may not exist, so constructor env values must be replayable.

### Mechanism (implemented in v1.32.5)

Shipped in v1.32.5 (commits `55bc12a`, `dcb2c68`). Verified end to end on a real deployment: a stateful photon (`kith-remind`) was constructed once with env present, then the daemon was killed and restarted from a fully env-stripped non-interactive shell; the photon still resolved its constructor env from the replayed snapshot and reached its remote backend with zero ambient env. Reproduce with the Phase A / Phase B pattern: (A) start daemon with the env present and exercise the photon once to seed the snapshot, (B) restart the daemon non-interactively with every relevant var unset and confirm the photon still works.

When the daemon successfully constructs a stateful photon for the first time, it snapshots only the resolved constructor env injections:

1. Resolve constructor injections using the existing mapping logic.
2. Keep MCP, photon, and state injections on their existing paths.
3. For each env injection, capture the resolved env value after validation/type parsing has succeeded.
4. Encrypt the captured env values.
5. Store the encrypted constructor-env snapshot in daemon-owned storage keyed by the specific photon identity.
6. On daemon restart, when that same photon identity is instantiated, decrypt and replay those constructor env values.
7. If a later run supplies a new valid env value, update the encrypted snapshot so token/config rotation works.

This is dependency-injection replay, not whole-object serialization. The class source supplies methods, the existing state system supplies state, and this snapshot supplies only the constructor env inputs that would otherwise be lost.

### Storage identity

The snapshot key should be specific enough to avoid cross-project leakage:

- resolved `PHOTON_DIR` / working directory
- photon namespace inside that directory
- photon name
- real photon source path hash

The source path hash matters because one global daemon can serve multiple working directories and photons with the same name. A snapshot for one project must never hydrate a photon from another project.

### Storage location

Keep constructor-env replay storage daemon-owned, separate from normal photon state data. The state system already owns:

```text
{PHOTON_DIR}/.data/{namespace}/{photon}/state/{instance}/state.json
```

Constructor env replay should use a daemon-specific store, for example:

```text
{PHOTON_HOME}/.data/daemon/constructor-env/{path-hash}.json
```

The exact path can change, but the rule is: do not mix encrypted constructor env snapshots with user-visible photon state files.

### Encryption model

Keep the first version portable:

- Generate a local daemon secret on first use.
- Store that secret in a daemon-owned file with restrictive permissions.
- Use the secret to encrypt/decrypt constructor-env snapshots.
- Use standard authenticated encryption, e.g. AES-256-GCM via Node/Bun `crypto`.
- Store encrypted envelopes, not plaintext values.

Example envelope shape:

```json
{
  "version": 1,
  "identity": {
    "photon": "kith-remind",
    "namespace": "local",
    "pathHash": "..."
  },
  "values": {
    "KITH_REMIND_USER_EMAIL": {
      "alg": "aes-256-gcm",
      "iv": "...",
      "tag": "...",
      "ciphertext": "..."
    }
  }
}
```

This is not meant to defend against a user-account compromise where an attacker can read both the encrypted store and daemon secret. It is meant to avoid leaving readable secrets scattered in normal `.data` files and to make daemon resurrection reliable without platform-specific keychain dependencies.

### Non-goals

- Do not serialize the whole photon instance.
- Do not change state persistence.
- Do not encrypt ordinary business state as part of this mechanism.
- Do not store MCP clients, photon instances, sockets, timers, locks, or runtime helpers.
- Do not change constructor injection classification.
- Do not make this macOS-only through Keychain as the required path.

### Failure behavior

If replay storage is unavailable or decryption fails:

- fall back to current process env if available
- otherwise fail loudly with the existing missing-constructor-env error
- never silently instantiate with wrong or empty secrets
- never log decrypted values

### Why this fits Photon

The constructor is Photon’s dependency-injection boundary. On initial construction the runtime already knows exactly which primitive env values were injected. Capturing only those values, encrypted, gives the daemon enough information to recreate stateful photons after restart while leaving all other runtime concerns on their existing, tested paths.

### Design decision: env is set the normal way, the constructor is the only contract

Constructor env replay is the entire solution. There is deliberately no `photon env set` command and no photon-managed credentials file. Rationale:

- One daemon serves many marketplaces (each project auto-scopes via its `.marketplace` dir / resolved `PHOTON_DIR`). A command or file that sets env at a global or home level would be visible to every photon in that shared daemon, and the same variable name could need different values per marketplace. That breaks the isolation the path-hash-scoped snapshot key already gives.
- Users already have a normal way to set environment variables (their shell / service launcher). Photon should not add a second, competing mechanism.
- If a specific environment variable matters to a photon, it is declared as a constructor parameter. That is the contract: it gets prefix-scoped env-var naming (`toEnvVarName(photonName, paramName)`, e.g. `kith-remind` + `userEmail` -> `KITH_REMIND_USER_EMAIL`), per-marketplace-scoped persistence, and replay across restarts. Bare `process.env.X` reads inside method bodies get none of this and are the anti-pattern this replaces.

Resolution order for a constructor env param: explicit constructor argument, then `process.env[scopedName]`, then the scoped EnvStore / replay snapshot, then the param default.

Cold start is normal operations, not a defect to engineer around. "Start the daemon once with your normal environment" is the expected setup step for any service. After that single seeded construction, the encrypted scoped snapshot carries the values across non-interactive restarts. There is intentionally no separate seeding tool: the seeding run is just running the photon once with the env you already set the normal way.

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
