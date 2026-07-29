# MCP compatibility

Photon 1.36.1 supports existing MCP 2025 clients and the MCP `2026-07-28`
release-candidate wire protocol. The 2026 support promise applies to
Streamable HTTP. Local stdio remains on the stable MCP 2025 SDK adapter.

## Compatibility matrix

| Feature | MCP 2025 Streamable HTTP | MCP 2025 stdio | MCP 2026 Streamable HTTP |
| --- | --- | --- | --- |
| Lifecycle | `initialize`, sessionful | `initialize`, sessionful | Stateless, no `initialize` |
| Protocol revisions | `2025-03-26`, `2025-11-25` | `2025-03-26`, `2025-11-25` | `2026-07-28` |
| Tools, resources, prompts | Stable | Stable | Release candidate |
| JSON Schema | Draft-07-compatible input | Draft-07-compatible input | JSON Schema 2020-12 input and output |
| Discovery | Initialized capabilities | Initialized capabilities | `server/discover` on every independent request |
| Pagination and caching | Opaque cursors; additive cache metadata | Opaque cursors | Deterministic cursors, `ttlMs`, `cacheScope`, `cacheKey` |
| Subscriptions | Legacy GET/SSE and resource methods | SDK notifications where supported | `subscriptions/listen` POST/SSE |
| Interactive input | Live sampling/elicitation request | Live sampling/elicitation request | Stateless `input_required` retry |
| Tasks | Legacy Photon/Core vocabulary | Legacy Photon/Core vocabulary | `io.modelcontextprotocol/tasks` extension |
| MCP Apps | Legacy capability aliases accepted | Host capability negotiation | Exact `io.modelcontextprotocol/ui` opt-in |
| Authorization | Public, bearer, or JWT by tool | Local process boundary | OAuth resource/JWT authorization by tool |
| Protocol logging | `logging/setLevel` | `logging/setLevel` | Per-request log-level metadata only |

MCP 2026 and its Tasks extension remain accurately labeled release-candidate
and experimental respectively. Photon does not silently upgrade a 2025 request
to 2026 behavior.

## Required MCP 2026 request shape

Every 2026 request has a fresh JSON-RPC ID, mirrors its protocol and routing in
HTTP headers, and carries canonical metadata in `params._meta`:

```http
POST /mcp
Accept: application/json, text/event-stream
Content-Type: application/json
Mcp-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: weather.current
```

```json
{
  "jsonrpc": "2.0",
  "id": "call-1",
  "method": "tools/call",
  "params": {
    "name": "weather.current",
    "arguments": { "city": "Singapore" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "my-client",
        "version": "1.0.0"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
```

`clientInfo` is optional. The protocol version and client-capabilities object
are required. Header/body mismatches are rejected, and no 2026 response emits
or relies on `Mcp-Session-Id`.

Copy-paste clients that exercise the real release paths are included:

```bash
node examples/mcp-clients/legacy-2025.mjs https://example.com/mcp
node examples/mcp-clients/stateless-2026.mjs https://example.com/mcp
```

Both examples run in CI against a real Photon server.

## Discovery

Send `server/discover` with the required 2026 metadata. The result declares the
exact protocol revisions, core capabilities, optional extension settings,
cache behavior, and Photon application-handle support enabled by that build.
Clients must not infer capabilities from a previous request.

## Stateless application handles

An application handle preserves Photon UI or workflow identity without
reintroducing a protocol session. Opt into `dev.portel.photon`, call
`server/discover`, and retain the issued opaque handle from
`_meta["dev.portel.photon/appSessionId"]`. Send it explicitly on later requests.

Handles are bound to the authenticated principal and scope. They expire, can be
revoked, and are safe to use across instances sharing the documented Photon
deployment directory. They are not authentication credentials.

## Subscriptions

MCP 2026 clients open `subscriptions/listen` as a POST/SSE request with an
explicit notification filter. Photon acknowledges the stream first and tags
every delivered notification with its subscription ID. Exact resource filters
are bounded, and slow consumers are disconnected without blocking other
subscribers.

Subscription connections are intentionally ephemeral. Reconnect and
resubscribe after network or process loss; do not persist the subscription ID
as application state.

## Multi-round input

A 2026 tool or prompt can return:

```json
{
  "resultType": "input_required",
  "requestState": "opaque-and-signed",
  "inputRequests": {
    "server-key": {
      "method": "elicitation/create",
      "params": {
        "mode": "form",
        "message": "What is your name?",
        "requestedSchema": {
          "type": "object",
          "properties": { "name": { "type": "string" } },
          "required": ["name"]
        }
      }
    }
  }
}
```

Retry the original method with a new JSON-RPC ID, the unchanged original
arguments, `requestState`, and `inputResponses` keyed by the server keys.
Photon binds state to the caller, scope, method, target, application handle,
and canonical arguments. Missing, duplicate, expired, tampered, or cross-user
state fails closed. Multiple requests may be answered partially.

## Tasks

Declare the extension on each request:

```json
{
  "io.modelcontextprotocol/clientCapabilities": {
    "extensions": {
      "io.modelcontextprotocol/tasks": {}
    }
  }
}
```

Photon may return a flat task creation result from `tools/call`. Poll with
`tasks/get`, answer pending input with `tasks/update`, and cancel with
`tasks/cancel`. Completed results and protocol failures are inlined by
`tasks/get`. A tool marked as requiring Tasks returns the standard missing
capability error if the current request did not opt in.

The legacy task-list and separate task-result operations are 2025-only
compatibility methods. They are deliberately unavailable in 2026.

## MCP Apps

Declare:

```json
{
  "io.modelcontextprotocol/clientCapabilities": {
    "extensions": {
      "io.modelcontextprotocol/ui": {
        "mimeTypes": ["text/html;profile=mcp-app"]
      }
    }
  }
}
```

Photon emits `ui://` resources and UI result metadata only for the exact
canonical extension in 2026. Client-name inference and aliases are confined to
2025 compatibility behavior.

## Schema support

MCP 2026 tool input and structured output use JSON Schema 2020-12. Photon
validates schemas and values with bounded depth, collection size, and string
size. Invalid tool input is a correctable tool result where the protocol
permits it; malformed protocol parameters remain JSON-RPC errors.

## Authorization

HTTP tools may be public or protected with scoped JWT/OAuth resource
authorization. Photon validates signature, issuer, exact resource audience,
expiry, and required scopes before dispatch. Bearer tokens are accepted only
in the `Authorization` header, never in URLs. stdio relies on the local process
and environment boundary.

See [MCP JWT authorization](MCP-JWT-AUTH.md) for setup and
[MCP 2026 stateless deployment](MCP-STATELESS-DEPLOYMENT.md) for shared-state
requirements.

## Deprecated compatibility features

Roots, sampling, and protocol logging remain supported where the negotiated
revision defines them, but they are deprecated in MCP 2026. Prefer explicit
tool/resource inputs, direct model-provider APIs, stderr for local stdio
diagnostics, and OpenTelemetry for production telemetry.

In 2026, `notifications/message` is emitted only when the current request
includes `_meta["io.modelcontextprotocol/logLevel"]` at a compatible severity.
`logging/setLevel` is a 2025-only method.

See [MCP deprecated-feature migration](MCP-DEPRECATED-FEATURES.md).

## Diagnose and verify

```bash
photon doctor mcp
bun run test:mcp-docs
bun run test:mcp-official-conformance
```

The exact SDK, specification, extension, and conformance pins are documented in
[MCP conformance and SDK policy](../internals/MCP-CONFORMANCE.md).
