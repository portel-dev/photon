# Photon Runtime Wiki for LLM Agents

This document is the canonical runtime playbook for coding agents working on Photon.
Keep it updated whenever behavior changes (connection model, UI bridge, event names,
or scheduling semantics).

## What this is for

- New session bootstrap: understand how Photon behaves across CLI, Beam, and MCP clients.
- Rapid maintenance: find the right file and call pattern without rediscovering the runtime.
- Deterministic handoff: avoid undocumented assumptions that cause repeated "disconnect/reconnect" loops or broken UI bridges.

## First read list (before changing a photon)

1. `docs/reference/DOCBLOCK-TAGS.md` (tool/class metadata and runtime annotations)
2. `docs/guides/CUSTOM-UI.md` (iframe bridge, event patterns, sandbox constraints)
3. `docs/reference/LONG-RUNNING-METHODS.md` (heartbeat + progress contract)
4. The target photon file and any existing `@ui` HTML for concrete behavior

If this list is missing behavior you need, add it here before implementing more.

## Runtime mental model (single source of truth)

- A photon is one `.photon.ts` file, typically a class extending `Photon`.
- Methods on that class are exposed as tools (LLM-callable actions) unless hidden with
  tags like `@internal`.
- The same photon runs in different frontends:
  - CLI (`photon my-photon method`)
  - Beam (`@ui` dashboard, live events, live rendering)
  - Any MCP-capable client
- Runtime behavior is transport-agnostic; your method logic and tags should not assume a specific client.

## Running from a marketplace workspace

- Run `photon` commands from the marketplace root when testing local photons. Example:
  `cd /path/to/marketplace && photon cli whatsapp status`.
- Photon resolves the active `PHOTON_DIR` in this priority order:
  1. explicit `PHOTON_DIR`
  2. current working directory when it is a photon workspace
  3. the global `~/.photon` home
- A directory is an explicit photon workspace when it has a `.marketplace/` directory.
- `.marketplace/photon.json` may exist as a small marker/config file, but it is **not** the
  marketplace manifest consumed by installs.
- `.marketplace/photons.json` is the distributable marketplace manifest. Generate or refresh it
  with `photon maker sync` before expecting `photon marketplace add <github-repo>` and
  downstream `photon add <name>` flows to work from a cloned repository.
- For local CLI testing, use the photon name exactly as the file stem. `whatsapp.photon.ts`
  is invoked with `photon cli whatsapp ...`; a typo like `whatsaapp` correctly reports
  `Photon 'whatsaapp' not found`.
- Dependency installation is automatic. If a photon declares `@dependencies`, the runtime should
  install those packages under the active workspace cache at
  `{PHOTON_DIR}/.data/.cache/dependencies/<cache-key>/node_modules`. Repeated installs for the
  same unchanged dependency set indicate a runtime cache bug, not a user action item.

## Tags that matter for agent workflows

- `@runtime` pins compatible runtime versions.
- `@ui <name>` registers a UI asset by convention. Resolution order is
  `ui/<name>.photon.tsx`, `ui/<name>.tsx`, `ui/<name>.photon.html`,
  `ui/<name>.html`. Use `@ui <name> <path>` only for non-conventional
  locations such as prebuilt bundles.
- A resolved `.tsx` UI is a client application shell. In Beam, `/mcp` runtime
  paths and declared web routes win; otherwise GET routes fall through to the
  TSX app so the client router owns navigation.
- `@readOnly`, `@destructive`, `@idempotent`, `@openWorld`, `@closedWorld`, `@audience`,
  `@title`, `@priority` drive LLM UX behavior in tool listing and execution.
- Method-level functional tags (`@async`, `@logged`, `@retryable`, `@queued`, `@fallback`, etc.)
  change production behavior and should be declared intentionally.
- `@internal` removes tools from LLM/tool listing.
- Use `@internal + @audience user` for dashboard-only methods that should still be callable
  from UI code.

## Custom UI contract (critical for LLM-facing maintenance)

When `@ui` is enabled, Photon injects two APIs into the iframe:

1. `window.photon` - low-level bridge
2. `window.<photon-name>` - convenience API, e.g. `whatsapp.status()`, `whatsapp.onStatus(...)`

### Mandatory low-level operations

- `window.photon.callTool(name, args)` - execute a server method
- `window.photon.invoke(name, args)` - alias for `callTool`
- `window.photon.onEmit(cb)` - subscribe to all emitted events
- `window.photon.onStatus(cb)` - runtime status / heartbeat events
- `window.photon.onResult(cb)` - final tool result
- `window.photon.onError(cb)` - bridge error events
- `window.photon.onProgress(cb)` - progress events
- `window.photon.onStream(cb)` - stream chunks
- `window.photon.setWidgetState(state)` / restore via `photon:state-restored` event

### Named convenience API behavior

For a photon file `whatsapp.photon.ts`, the convenience global is `whatsapp`:

- `whatsapp.methodName(payload)` -> calls `callTool('methodName', payload)`
- `whatsapp.onEventName(cb)` -> subscribes to `eventName` (PascalCase conversion pattern: `onFooBar`)

Example:

```javascript
whatsapp.onConnected(() => {
  console.log('connected');
});
await whatsapp.refreshStatus();
```

### UI reliability constraints to remember

- UIs run in a sandboxed `blob:` iframe for portability across clients.
- Cross-origin `fetch`, threaded WASM, WebGPU, and some privileged browser APIs may not work.
- For client-side limits, move work to photon methods when possible (backend in Bun/Node).
- Avoid designs that rely on host-specific APIs not listed in the Custom UI contract.

## Event and message flow

- Server can emit events with `this.emit('<eventName>', payload)`.
- Client listens via `photon.onEmit(...)` for raw events or `<global>.on<EventName>(...)`.
- `onResult` is the final completion event for the current tool invocation.
- For long-running flows, expect heartbeats from `this.status(...)` and/or `this.progress(...)`.

## Long-running methods: contract to follow

- Runtime does not enforce hard method timeouts.
- Clients/humans/agents decide wait strategy.
- Photon developers **must emit `status`/`progress` periodically** for methods that can run
  longer than a few seconds.
- Without periodic heartbeat, silent methods are treated as potential stalls by callers.

Recommended threshold for stable behavior: emit at least every 5 seconds during busy work.

## Operational runbook for debugging reconnect/sync loops

1. Check method entry points first (`connect`, `disconnect`, status getters, loop timers, backoff state).
2. Confirm whether events are emitted on every state transition (`connected`, `disconnected`, `reconnect_*`).
3. Verify whether reconnect calls are gated by a manual/disposed flag so user disconnects don't auto-reconnect.
4. Check polling intervals and exponential backoff caps.
5. Confirm event source and UI are de-duplicated (one listener set per mount, clear on teardown).
6. Ensure `pending`-style buffers are bounded or drained regularly (no unbounded growth).
7. Reproduce once with logs and map each repeated action to the exact trigger.

## What to avoid in LLM edits

- Recreating runtime loops without reading existing `@ui` or reconnect state.
- Duplicating `status()` calls in multiple concurrent timers.
- Calling `this.emit(...)` for every micro-tick when no state changed.
- Ignoring UI lifecycle (`window.addEventListener('photon:state-restored', ...)`, teardown) when adding dashboard scripts.
- Adding client assumptions that break sandbox portability.

## Template for code changes (recommended)

Before editing a photon:

1. Update this file's affected section first.
2. Make method/UI changes.
3. Update tests/docs/comments that describe semantics (if present).
4. Keep any reconnect/backoff, emit contract, or event names explicit.
5. Record validation notes in this wiki entry (commands, observed status, edge cases).

## Cross-reference

- Runtime + formatting: `docs/reference/DOCBLOCK-TAGS.md`
- Custom UI and bridge API: `docs/guides/CUSTOM-UI.md`
- Long-running methods: `docs/reference/LONG-RUNNING-METHODS.md`
- Daemon/architecture context: `wiki/daemon-architecture.md`

## Ownership

Treat this file as the single LLM-facing source of truth for Photon runtime behavior.
If behavior changes, update this file in the same commit.
