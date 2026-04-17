# PHOTON_DIR and Namespace

**Status**: Canonical. Any code that disagrees is a bug.
**Date**: 2026-04-17

This document defines how a photon's source file location determines where its data lives. There is one rule, and it is mechanical.

---

## The contract

### 1. `PHOTON_DIR` is the outer boundary

A photon directory is a self-contained home for both source files and data. Once `PHOTON_DIR` is resolved, every subsystem (loader, memory, state, logs, schedules, cache, env, config) stores its data under `${PHOTON_DIR}/.data/`. Nothing ever silently falls back to `~/.photon` once a different `PHOTON_DIR` has been chosen.

`~/.photon` is simply the default `PHOTON_DIR` when nothing else is specified. It is not privileged.

### 2. Resolution of `PHOTON_DIR`

Priority, highest first:

1. Explicit `process.env.PHOTON_DIR`.
2. `cwd` if it qualifies as a photon directory (see §5).
3. `~/.photon` as the default.

Once resolved at process entry, `PHOTON_DIR` is frozen for the lifetime of the process and exported back to the environment so every child/subsystem sees the same value.

### 3. Namespace comes from directory position. Nothing else.

```
namespace = path.dirname(photonFile) relative to PHOTON_DIR
         = "" (empty) if the file is flat at the root of PHOTON_DIR
         = the subdirectory path otherwise
```

Examples:

| Source file | Namespace | Data directory |
|---|---|---|
| `${PHOTON_DIR}/foo.photon.ts` | `""` | `${PHOTON_DIR}/.data/foo/` |
| `${PHOTON_DIR}/alice/foo.photon.ts` | `alice` | `${PHOTON_DIR}/.data/alice/foo/` |
| `${PHOTON_DIR}/payments/stripe.photon.ts` | `payments` | `${PHOTON_DIR}/.data/payments/stripe/` |
| `${PHOTON_DIR}/org/team/foo.photon.ts` | `org/team` | `${PHOTON_DIR}/.data/org/team/foo/` |

The runtime never consults git, never consults remote URLs, never synthesizes a namespace. Namespace is a pure function of the file path relative to `PHOTON_DIR`.

### 4. Data layout mirrors source layout

If the source is flat at the root, data is flat at the root of `.data/`. If the source is organized into subdirectories, data is organized the same way. The two trees are always isomorphic. This is the only rule you need to predict where a photon's data lives.

### 5. What qualifies as a photon directory

A directory is a photon directory if it contains one or more `.photon.ts` files at any depth. When `PHOTON_DIR` is not set explicitly, the runtime checks whether `cwd` qualifies. If yes, `cwd` becomes `PHOTON_DIR` and `process.env.PHOTON_DIR` is set so downstream subsystems see it.

### 6. `~/.photon` as the global default

`~/.photon` is the fallback `PHOTON_DIR`, no more and no less. Photons at its root are not global, they are just photons that happen to live in the default location. Installing a photon from another author places its file at `~/.photon/<author>/<name>.photon.ts`, which produces the namespace `<author>` by rule §3 without any special casing.

---

## What this replaces

The runtime previously derived a namespace for flat files by running `git remote get-url origin` on the base directory. That produced two failure modes:

- Adding a git remote to a `PHOTON_DIR` flipped the namespace, orphaning existing data under the old namespace bucket.
- Data could end up under a different namespace than the source file's directory, breaking the "data mirrors source" invariant.

The new rule eliminates both by construction. Git state of a directory has no semantic meaning to the runtime.

---

## Migration from the old model

For installations that already have data stranded under a git-remote-derived namespace (e.g. `.data/<owner>/<photon>/` where the source sits flat at the root), the runtime ships a one-release compatibility shim that moves such data into the correct canonical location on first access. The shim is scheduled for removal in the following minor release. After removal, a small `photon migrate` CLI may be offered to help users who missed the transition.

---

## Implementation notes

- All path resolution goes through `photon-core/src/data-paths.ts`. `getDataRoot(baseDir)` returns `${baseDir}/.data/`. Callers that pass no `baseDir` get the resolved `PHOTON_DIR` (via `getBase`), which is correct by §1.
- `detectNamespace(dir)` (git-remote based) is removed. It has no valid caller under this model.
- `PhotonLoader.resolveNamespace(absolutePath)` computes namespace purely from `path.relative(this.baseDir, absolutePath)`. No branch consults git or treats `~/.photon` specially.
- `context.ts` produces a `PhotonContext` whose `dataDir` is `getDataRoot(baseDir)`, not hardcoded to `HOME_PHOTON_DIR`. This was the single line that silently broke Option B for every consumer that read `context.dataDir`.

---

## Testing the contract

A runtime change passes the Option B compliance check if, for any `PHOTON_DIR`:

1. Creating a new photon file writes source exactly where you put it, and data at the mirrored position under `.data/`.
2. No data paths resolve under `~/.photon` unless `PHOTON_DIR` itself resolves to `~/.photon`.
3. Changing the git state of the `PHOTON_DIR` (adding, removing, or changing a remote) produces no change in any data path.
4. Two `PHOTON_DIR` trees operated on in sequence (or in parallel) do not share or leak any data between them.

Any failure of (1)-(4) indicates a subsystem that has not been routed through `getDataRoot(baseDir)` correctly.

---

## 8. Daemon central, data distributed

The runtime has **exactly one** piece of global infrastructure: the daemon. Everything else that looks like it belongs to a photon (state, memory, logs, env, schedules, config, instance data) is **data** and lives with the `PHOTON_DIR` that owns it.

### Classification

| Concern | Classification | Location |
|---|---|---|
| Daemon socket / pid / log | Infrastructure | `~/.photon/.data/daemon.*` (one per user) |
| Webhook HTTP server (port, routing table) | Infrastructure | In-process on the daemon |
| In-memory locks, channel buffers, session managers | Infrastructure (transient) | Daemon process memory |
| Bases registry | Infrastructure | `~/.photon/.data/.bases.json` |
| Scheduled jobs | **Data** | `{PHOTON_DIR}/.data/{ns}/{photon}/schedules/` |
| Instance state | **Data** | `{PHOTON_DIR}/.data/{ns}/{photon}/state/{instance}/` |
| Memory (`this.memory`) | **Data** | `{PHOTON_DIR}/.data/{ns}/{photon}/memory/` |
| Logs | **Data** | `{PHOTON_DIR}/.data/{ns}/{photon}/logs/` |
| Env / context / config | **Data** | `{PHOTON_DIR}/.data/{ns}/{photon}/...` |

The daemon is the **mechanism** that fires schedules, routes webhooks, serves MCP requests. It does not **own** the records — records live with their PHOTON_DIR.

### Rule

> A subsystem is infrastructure if it exists once per user. Everything else is data, and its location is a function of `PHOTON_DIR`.

Concretely: if you're considering where to store something, ask "does it make sense to have more than one of these, scoped per project/marketplace?" If yes, it's data. If no (there's only ever one daemon, one webhook port, one socket), it's infrastructure.

### How the daemon handles data distributed across PHOTON_DIRs

One daemon serves all the PHOTON_DIRs the user has ever launched photons from. For that to work for long-lived concerns like schedules, the daemon maintains a **bases registry** at `~/.photon/.data/.bases.json`:

```json
{
  "bases": [
    { "path": "/Users/arul/Projects/kith", "firstSeen": "2026-04-17T09:00:00Z", "lastSeen": "2026-04-17T11:30:00Z" },
    { "path": "/Users/arul/.photon",       "firstSeen": "2026-04-10T12:00:00Z", "lastSeen": "2026-04-17T11:32:00Z" }
  ]
}
```

Every time the daemon handles an invocation from a PHOTON_DIR, it upserts that base with a fresh `lastSeen`. On startup, the daemon:

1. Reads the registry.
2. Prunes entries whose `path` no longer exists on disk (`ENOENT`). Entries with temporary read errors (e.g. unmounted network drive) are kept.
3. For each surviving base, scans `{base}/.data/*/*/schedules/*.json` and reinstates the timers.

Schedule records themselves carry the originating `baseDir` inline so the daemon knows which context to re-enter when firing.

### What this replaces

The legacy behavior wrote all schedules to `~/.photon/schedules/` regardless of which PHOTON_DIR spawned them (optionally redirected by `PHOTON_SCHEDULES_DIR`). That directly violated the Option B contract. The registry + per-base schedule layout restores it while keeping the daemon topology unchanged.
