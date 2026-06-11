# The Photon Daemon

Every runtime that executes photons - Beam, `photon cli`, MCP stdio/SSE servers, scheduled jobs - delegates to a single background daemon process. No runtime runs photon code directly. The daemon owns photon instances, state, locks, schedules, and the event bus, so all clients see the same live instances.

```
  Beam (HTTP server)
       |
       v
  daemon.sock  <-- photon cli <method>
  (~/.photon/.data/daemon.sock)
       ^
       |
  MCP stdio / SSE server
```

You normally never manage the daemon yourself. It starts on demand, restarts automatically on the next command if it dies, and survives client restarts.

## One daemon, many photon directories

There is exactly one daemon per user, but it serves any number of photon directories. The two concepts are separate:

- **The daemon** is global. Its socket, PID file, and log always live under `~/.photon/.data/` (or `$PHOTON_HOME/.data/` if set), regardless of where you run commands from.
- **`PHOTON_DIR`** is the per-project home for photon source files and their data. State, cache, and config live under `{PHOTON_DIR}/.data/`.

`PHOTON_DIR` resolves in this order:

1. **Explicit `PHOTON_DIR` env var** - always wins once set.
2. **Current directory, if it is a marketplace** - a directory containing a `.marketplace/` marker (created by `photon maker init`) is auto-detected as the `PHOTON_DIR` for that invocation.
3. **`~/.photon`** - the global default where installed photons live.

When you are inside a marketplace folder, its photons overlay the globally installed ones for discovery, and a local photon shadows an installed photon of the same name (you get a one-time warning, because the two have separate state stores).

The daemon keeps a registry of every `PHOTON_DIR` it has served so schedules and webhooks keep firing across restarts. `photon ps` shows photons, schedules, webhooks, and active sessions for every registered base; use `photon ps --base <dir>` to filter to one.

## Lifecycle commands

```bash
photon daemon status        # PID, uptime, memory, log path
photon daemon start         # start (no-op if already running)
photon daemon stop          # stop the running daemon
photon daemon restart       # stop + start
photon daemon prune-bases   # drop registered PHOTON_DIRs that no longer exist
photon ps                   # what the daemon is hosting right now
```

`photon daemon prune-bases --dry-run` previews what would be removed. Restart the daemon afterwards so running schedules pick up the change.

## What resilience looks like in practice

- **Daemon down?** The next CLI command or tool call auto-starts it and retries once, after waiting for the socket to respond (exponential backoff up to 10 seconds). Typical recovery is under 2 seconds.
- **Client disconnects?** Subscriptions (Beam live updates, channel subscribers) reconnect with exponential backoff and replay missed events. The daemon buffers up to 5 minutes (max 500 events per channel); a longer gap triggers a full state refresh instead of a replay.
- **Daemon restarts with stateful photons?** Persisted state reloads from disk as usual. Constructor env values are also replayed: the first time a stateful photon is constructed with its env present, the daemon snapshots the resolved constructor env (encrypted, scoped to that photon's `PHOTON_DIR` and source path). After a restart from an env-less shell, the snapshot fills the constructor parameters. Run the photon once with your normal environment and restarts take care of themselves. See the [Troubleshooting guide](../TROUBLESHOOTING.md) for the full setup pattern.

## Environment variables

| Variable | Effect |
|----------|--------|
| `PHOTON_DIR` | Override the photon directory for source files and `.data/` (see resolution order above) |
| `PHOTON_HOME` | Relocate the global home (default `~/.photon`), including the daemon socket/pid/log |
| `PHOTON_DAEMON_IDLE_TIMEOUT_MS` | Retire the daemon after N ms without clients or work. Default `0` (run forever). Temp-socket test daemons default to 60s |
| `PHOTON_LIGHT_DAEMON=1` | Start a daemon that skips startup photon discovery, persisted schedule loading, and the webhook server. Used automatically for short-lived CLI sessions that only need a transport |

## Troubleshooting

**`ECONNREFUSED` / daemon unreachable**: usually self-heals; the next command restarts the daemon. If it keeps happening, check the log:

```bash
photon daemon status          # shows the log path
tail -50 ~/.photon/.data/daemon.log
```

**Stale instance after editing a photon**: the daemon hot-reloads on file change (with debounce). If an edit does not take, `photon daemon restart` forces a clean slate; circuit-breaker state and compile caches are dropped on reload.

**Schedules firing for a deleted project**: `photon daemon prune-bases`, then restart.

More cases are covered in [TROUBLESHOOTING.md](../TROUBLESHOOTING.md). For protocol-level internals (event buffers, pub/sub), see [internals/DAEMON-PUBSUB.md](../internals/DAEMON-PUBSUB.md).
