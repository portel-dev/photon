# MCP 2026 Stateless Deployment

Photon's MCP 2026 HTTP surface is request-scoped. A load balancer may send
successive requests from one logical application flow to different Photon
processes. Clients must not send or depend on `Mcp-Session-Id`.

## Deployment contract

All instances in one Photon deployment must:

1. run the same Photon build and Photon definitions;
2. use the same `PHOTON_DIR` or `workingDir`;
3. mount that directory on storage with coherent reads, atomic rename, and
   exclusive file creation;
4. use the same OAuth resource and token-verification policy; and
5. forward the canonical MCP 2026 headers and request body without rewriting
   them.

The built-in durable backend is appropriate for one process or several
processes sharing a strongly consistent POSIX-style volume. It is not an
object-store backend and must not be placed on eventually consistent storage.
If instances do not share the deployment directory, ordinary discovery and
tool calls still work, but request-state retries, application handles,
idempotency records, and Tasks cannot move between instances.

Photon stores deployment state beneath the shared base directory:

| State                      | Purpose                                         | Restart behavior                                                    |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| `.data/mcp-request-state/` | Multi-round input and destructive confirmations | Replayed and resumed on another process                             |
| `.data/mcp-app-sessions/`  | Opaque Photon application handles               | Valid until expiry or revocation                                    |
| `.data/mcp-idempotency/`   | Duplicate detection and safe response replay    | Preserved for the retry window                                      |
| Photon Tasks directory     | Task state and terminal results                 | Terminal results survive; interrupted continuations fail explicitly |

Bearer tokens and raw caller claims are not persisted in these records.
Bindings use hashes of caller, claim scope, application handle, tool, and
canonical arguments.

## Application-session handles

Application sessions are a Photon extension, not an MCP transport session.
Declare `dev.portel.photon` in the current request and call
`server/discover`. Photon returns an opaque handle in:

```json
{
  "_meta": {
    "dev.portel.photon/appSessionId": "aps_..."
  }
}
```

Send that value in the same metadata field on later requests. Photon validates
the handle against the authenticated caller and claim scope on every request.
Caller-derived fallback identifiers are never emitted as MCP 2026 handles.

Handles contain 256 random bits, expire after 24 hours by default, and are
bounded to 1,024 per deployment and 16 per caller. Revoke a handle with:

```json
{
  "jsonrpc": "2.0",
  "id": "revoke-1",
  "method": "dev.portel.photon/app-sessions/revoke",
  "params": {
    "handle": "aps_...",
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {
        "extensions": { "dev.portel.photon": {} }
      },
      "dev.portel.photon/appSessionId": "aps_..."
    }
  }
}
```

Revocation, expiry, caller mismatch, and scope mismatch all fail closed. A
storage outage returns an availability error rather than pretending that a
valid handle is malformed.

## Multi-round execution across instances

`input_required` results contain a rotating `requestState`. The next request
may reach any instance sharing the deployment directory. Photon binds state to:

- protocol version;
- caller and claim scope;
- explicit application handle;
- method and tool;
- canonical original arguments; and
- previously used JSON-RPC request IDs.

JavaScript continuations cannot be serialized. Photon persists validated
answers and deterministically replays the tool from its beginning on each
round. Tool authors must collect input before irreversible side effects. An
interactive tool that must perform work before asking should make that work
idempotent and externally deduplicated.

State is atomically replaced after every accepted answer. Replays, stale
tokens, binding changes, simultaneous resumes, corrupt records, and unavailable
storage are rejected before user code resumes.

## Duplicate and retry behavior

For non-interactive tools, a client that negotiated `dev.portel.photon` may
send a printable 1–128 character key in:

```json
{
  "_meta": {
    "dev.portel.photon/idempotencyKey": "checkout-018f..."
  }
}
```

The behavior is determined by the tool annotations:

| Tool classification                | First request                          | Same bound key again                                   |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `readOnlyHint` or `idempotentHint` | Execute and durably store the response | Replay the completed response with the new JSON-RPC ID |
| Other non-interactive tool         | Execute once and record completion     | Reject with HTTP 409 / `DuplicateRequest`              |
| Interactive or destructive tool    | Use `requestState` confirmation flow   | Idempotency metadata is rejected                       |

A key is bound to caller, claim scope, application handle, tool, and canonical
arguments. Reusing it for a different binding is rejected. If the tool ran but
its outcome could not be committed, Photon returns an explicit
`outcome: "unknown"` error with `retryable: false`; the pending record continues
to block unsafe duplicate execution.

## Subscriptions and slow consumers

MCP 2026 subscriptions use the request-scoped
`subscriptions/listen` POST/SSE response. They never use a transport session.
Defaults are:

- 1,024 streams per process;
- 16 streams per caller;
- 64 resource URI filters per stream;
- 2,048 bytes per resource URI;
- 256 KiB of queued notification data per blocked stream;
- a 15-second keepalive; and
- a 5-second backpressure deadline.

The global and per-caller stream limits can be lowered with
`PHOTON_MCP_MAX_SUBSCRIPTIONS` and
`PHOTON_MCP_MAX_SUBSCRIPTIONS_PER_PRINCIPAL`.

When the HTTP response applies backpressure, Photon queues only up to the
bounded byte limit. It resumes delivery on `drain`; queue overflow or a missed
deadline disconnects only the slow stream. Dropped clients are removed from
resource registries. Graceful server shutdown sends a final `complete` result
when the response is still writable.

## Load-balancer and shutdown checklist

- Do not enable session affinity for protocol correctness.
- Do not synthesize or forward `Mcp-Session-Id` for 2026 requests.
- Preserve `Mcp-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and declared
  `Mcp-Param-*` headers.
- Disable proxy response buffering for subscription SSE responses.
- Set idle timeouts above the 15-second keepalive interval.
- Stop accepting new requests, invoke Photon's cleanup path, allow final SSE
  events to flush, and then terminate the process.
- Monitor shared-volume errors, request-state capacity, application-handle
  capacity, HTTP 409 duplicate responses, subscription rejections, and slow
  consumer disconnects.

Run the deployment gates with:

```bash
npm run build
npm run test:mcp-stateless-resilience-2026
npm run test:mcp-stateless-load-2026
npm run test:streamable-http
```

The load command prints its sample counts, p95 latency, fan-out duration, task
polling duration, multi-round duration, RSS growth, and enforced thresholds so
CI can retain the log as release evidence.
