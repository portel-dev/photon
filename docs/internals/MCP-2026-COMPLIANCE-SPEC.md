# MCP 2026 Compliance and Backward-Compatibility Specification

**Status:** Complete; release gates passing on 2026-07-28
**Target protocol:** MCP `2026-07-28`
**Compatibility floor:** MCP `2025-03-26` and `2025-11-25`
**Spec snapshot:** `modelcontextprotocol/modelcontextprotocol@31eefec6` (2026-07-27)
**Tasks draft snapshot:** `modelcontextprotocol/ext-tasks@2c1425d9` (2026-07-27)
**Baseline commits:** `079c72ce`, `89645ed1`
**Primary transport:** Streamable HTTP
**Secondary transport:** stdio

## 1. Objective

Photon will implement the MCP `2026-07-28` core protocol and the optional
features it deliberately advertises, while continuing to serve existing
sessionful MCP 2025 clients without wire-format regressions.

Completion means more than accepting a 2026 version string. Photon must:

- produce protocol-correct messages for the selected revision;
- avoid advertising capabilities it cannot honor;
- keep 2026 request handling independent of protocol-level sessions;
- preserve Photon application state through explicit application handles;
- pass revision-specific conformance, compatibility, security, and load gates;
- document intentional extensions and deprecated compatibility features.

The official specification and generated schema are the source of truth. This
document defines Photon’s implementation order and acceptance evidence.

## 2. Non-negotiable compatibility invariants

Every work package must preserve these invariants:

1. MCP 2025 clients retain `initialize`, `notifications/initialized`,
   `Mcp-Session-Id`, transport-level GET/SSE, legacy resource subscriptions,
   server-to-client sampling/elicitation, and the existing Tasks surface.
2. MCP 2026 clients never receive or depend on `Mcp-Session-Id`.
3. A 2026 request is interpreted only from its request body, authorization, and
   mirrored HTTP headers. Prior requests or connections cannot change its
   protocol interpretation.
4. Photon application sessions are not MCP protocol sessions. Application state
   is addressed through explicit Photon handles, arguments, or `_meta`.
5. New 2026 fields are never injected into 2025 responses unless the older
   specification explicitly permits them.
6. Optional extensions are advertised only when their complete server contract
   is enabled.
7. No compatibility alias can override a canonical 2026 field.
8. Errors at the HTTP, JSON-RPC, MCP, tool, and application layers remain
   distinguishable.

## 3. Current baseline

The following is already implemented and is treated as the starting point:

- version-gated 2025 and 2026 request profiles;
- canonical 2026 request metadata parsing;
- `server/discover`;
- `resultType` and standard server identity metadata on 2026 results;
- standard `Mcp-Method` and `Mcp-Name` mismatch handling;
- removal of `Mcp-Session-Id` from 2026 responses;
- request-scoped 2026 `subscriptions/listen` SSE streams;
- opt-in list-change and exact-resource notification filters;
- JSON-valued 2026 `structuredContent`;
- trace context fields;
- 2026 isolation from legacy lifecycle and Tasks methods;
- regression coverage for both protocol eras.

This baseline is not a declaration of full 2026 compliance. The work packages
below close the remaining gaps.

## 4. Architecture: one runtime, two wire adapters

Protocol branching must be concentrated at the transport boundary.

```text
HTTP or stdio message
        |
        v
Request decoder and validator
        |
        v
Canonical Photon request context
        |
        v
Photon capability/runtime execution
        |
        v
Canonical execution result
        |
        +--------------------+
        |                    |
        v                    v
MCP 2025 adapter       MCP 2026 adapter
sessionful wire        stateless wire
```

The canonical runtime model must not contain fields whose only meaning comes
from one protocol revision. Revision-specific concerns include:

- initialization and session headers;
- required per-request metadata;
- result discriminators;
- legacy server-to-client requests versus multi-round results;
- core Tasks versus the Tasks extension;
- legacy resource subscriptions versus `subscriptions/listen`.

Recommended module boundary:

```text
src/mcp/protocol/
  versions.ts
  request-decoder.ts
  request-validation.ts
  response-adapter.ts
  errors.ts
  input-required.ts
  capabilities.ts
  mcp-2025.ts
  mcp-2026.ts
```

The existing Streamable HTTP handler can be migrated incrementally. Behavior
must move behind these modules before old branches are deleted.

## 5. Work package 1: strict 2026 request validation

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Make every 2026 request self-describing, independently validatable, and safe to
route without connection history.

### Implementation steps

1. Define protocol version constants and an exact supported-version lookup.
   Do not use lexical string comparison for protocol semantics.
2. Require `MCP-Protocol-Version` on every 2026 HTTP POST and validate it by
   exact lookup. Unsupported versions return HTTP 400 with
   `UnsupportedProtocolVersionError` (`-32022`) and both `requested` and
   `supported` version data. Require `Content-Type: application/json` and an
   `Accept` value that advertises both `application/json` and
   `text/event-stream`. Validate every supplied `Origin` and return HTTP 403
   before request processing when it is not allowed.
3. For every 2026 request, require:
   - `_meta.io.modelcontextprotocol/protocolVersion`;
   - `_meta.io.modelcontextprotocol/clientCapabilities`.

   Treat `_meta.io.modelcontextprotocol/clientInfo` as optional (`SHOULD`), but
   when present require non-empty `name` and `version` strings.

4. Treat the body as authoritative. Compare mirrored HTTP values to the body
   and return HTTP 400 with `HeaderMismatch` (`-32020`) when required headers
   are absent, malformed, or disagree.
5. Require `Mcp-Method` on all 2026 POST requests.
6. Require `Mcp-Name` for named operations, including tool, resource, prompt,
   and task identifiers.
7. Reject JSON-RPC batches for 2026. Retain existing batch behavior only where
   required for older Photon clients.
8. Reject `initialize`, `notifications/initialized`, and removed
   connection-scoped operations in 2026. Ignore `Mcp-Session-Id` and
   `Last-Event-ID` on 2026 requests, and never mint, store, depend on, or echo
   an MCP protocol session for them.
9. Validate request IDs and notification shapes before dispatch.
10. When processing requires an undeclared client capability, return HTTP 400
    and `MissingRequiredClientCapabilityError` (`-32021`) with
    `data.requiredCapabilities`.
11. Bound request body size, metadata depth, collection sizes, and string
    lengths before expensive validation.

### Backward compatibility

- Missing 2026 metadata remains legal for 2025 requests.
- Existing 2025 initialization-derived client profiles remain available.
- Compatibility aliases may be read for 2025 but must not satisfy canonical
  2026 requirements.

### Acceptance evidence

- Table-driven tests for every required field and invalid type.
- Header/body mismatch tests for every mirrored header.
- Unsupported-version and batch-rejection tests.
- A two-request test proving no client capability leaks between 2026 requests.
- Existing MCP 2025 transport and SDK integration tests remain green.

## 6. Work package 2: complete versioned wire adapter

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Remove revision checks from business handlers and guarantee uniform response
shapes from a single adapter.

### Implementation steps

1. Introduce a canonical internal success result, tool error, protocol error,
   input-required result, and durable-task result.
2. Move 2026 `resultType` decoration and server identity `_meta` into the 2026
   adapter.
3. Move 2025 session headers and legacy result shapes into the 2025 adapter.
4. Move discovery capability construction into version-specific capability
   builders.
5. Ensure an existing non-`complete` discriminator is preserved.
6. Define one mapping for HTTP status and JSON-RPC/MCP error codes.
7. Prevent handler code from directly adding transport headers.
8. Add golden wire fixtures for:
   - discovery;
   - list operations;
   - tool success and tool failure;
   - resource read success and not-found;
   - subscription acknowledgement and termination;
   - input-required and task results.

### Backward compatibility

Snapshot the current 2025 messages before extraction. The extracted adapter must
be byte-compatible for fields, error codes, and session headers covered by the
fixtures.

### Acceptance evidence

- No protocol-version comparisons remain in capability business handlers.
- Golden tests pass for both revisions.
- Type-level exhaustiveness prevents adding a canonical result without defining
  both wire mappings.

### Implementation evidence

- `src/mcp/protocol/response-adapter.ts` owns canonical complete, tool-error,
  protocol-error, input-required, durable-task, and extension-result mappings.
- `src/mcp/protocol/capabilities.ts` owns revision-specific capability and
  discovery wire shapes.
- `src/mcp/protocol/errors.ts` owns the transport error-code and HTTP-status
  mapping used by request validation and modern method routing.
- `tests/fixtures/mcp-wire/{2025,2026}/responses.json` lock discovery, list,
  tool success/error, resource success/error, subscription acknowledgement and
  termination, input-required, task, and non-standard discriminator envelopes.
- `bun run test:mcp-wire` is the named adapter regression command. Full
  input-required retry semantics and durable task execution remain intentionally
  assigned to work packages 6 and 7; their wire envelopes are fixed here.

## 7. Work package 3: deterministic discovery, lists, and caching

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Make advertised capabilities truthful and cacheable results safe and
deterministic.

### Implementation steps

1. Sort tools, prompts, resources, and resource templates by canonical stable
   identifier before pagination.
2. Keep cursor generation independent of object insertion order.
3. Add `ttlMs >= 0` and `cacheScope` to all required 2026 operations:
   - `tools/list`;
   - `prompts/list`;
   - `resources/list`;
   - `resources/templates/list`;
   - `resources/read`.
4. Determine `cacheScope` from authorization and actual personalization:
   - use `private` when the result varies by caller, claim scope, or explicit
     application session;
   - use `public` only when the result is identical across authorization
     contexts;
   - do not mark a result private merely because a client supplied its name.
5. Use `ttlMs: 0` for volatile or task-derived resources.
6. Invalidate relevant caches through opted-in subscription notifications.
7. Advertise `listChanged` or resource subscriptions only when the corresponding
   notification path is active.
8. Exclude unsupported extensions from discovery.

### Backward compatibility

The 2025 ordering may become deterministic, but existing cursor decoding and
page sizes remain supported through a cursor-version field.

Photon cursors are offset projections rather than registry snapshots. A cursor
remains syntactically valid after a registry mutation, but an insertion before
the saved offset may repeat a boundary item and a removal before the offset may
skip the former boundary item. Clients that require a complete mutation-free
view must restart pagination after receiving the corresponding list-change
notification.

### Acceptance evidence

- Repeated list calls over randomized input order produce identical pages.
- Public/private cache-scope security tests cover anonymous, authenticated,
  claim-scoped, and app-session requests.
- Every required cacheable 2026 response contains valid cache fields.
- Pagination mutation tests document the allowed duplicate/gap behavior.

### Implementation evidence

- All four list handlers apply a stable code-point sort by their canonical
  identifier before the shared 100-item paginator. Resource and resource
  template ties use `name`.
- Newly emitted cursors encode `{ "v": 1, "offset": n }`; the decoder retains
  support for numeric legacy cursors and the earlier unversioned
  `{ "offset": n }` envelope while rejecting unknown versions and unsafe
  offsets.
- Every required 2026 cacheable operation emits a non-negative `ttlMs` and a
  `public` or `private` `cacheScope`. Dynamic and approval resources use
  `ttlMs: 0`; 2025 `resources/read` responses retain their prior shape without
  the new fields.
- Cache scope derives from actual caller, claim, explicit app-session, or
  response personalization. Anonymous public results omit self-reported client
  identity while retaining a stable diagnostic profile.
- Claim scoping is applied to discovery configuration, prompt/resource lists,
  templates, and resource reads in addition to tools.
- Photon registry changes now broadcast tools, prompts, and resources
  list-change notifications; request-scoped 2026 streams still receive only
  filters they explicitly selected.
- `tests/streamable-http-transport.test.ts` covers randomized/reversed registry
  construction, versioned and legacy cursors, duplicate/gap mutation semantics,
  all five cacheable operations, anonymous/authenticated/claim/app-session
  scope decisions, 2025 resource-read compatibility, and all advertised list
  invalidations.

## 8. Work package 4: JSON Schema 2020-12 and structured output

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Support the complete MCP tool schema contract without unsafe reference loading
or Photon-specific object restrictions.

### Implementation steps

1. Replace object-only `outputSchema` TypeScript types with JSON Schema 2020-12
   types.
2. Keep the MCP input-schema object-root requirement.
3. Support `$defs`, local `$ref`, `oneOf`, `anyOf`, `allOf`, `not`,
   `if`/`then`/`else`, arrays, enums, constants, and nullable unions.
4. Allow output schemas whose root is any JSON type.
5. Allow `structuredContent` to contain any finite JSON value, including
   `null`, scalars, and arrays.
6. Validate structured results against declared output schemas before emitting
   them.
7. Define failure behavior:
   - author/runtime schema mismatches become tool errors;
   - Photon never emits invalid structured content alongside a successful tool
     result.
8. Do not automatically dereference network or filesystem `$ref` values.
9. Bound schema depth, reference count, validation time, array length, and error
   detail size.
10. Preserve schema keywords when importing external MCP tools.
11. Add schema-dialect metadata where required and avoid silently rewriting
    semantics between drafts.

### Backward compatibility

For 2025 clients, retain object-only structured output where required by the
installed v1 SDK types, while still validating the canonical runtime value.

### Acceptance evidence

- Official JSON Schema composition fixtures pass.
- Circular, external, and excessively deep references fail safely.
- Scalar, array, object, and null output fixtures pass in 2026.
- The existing Photon schema extractor and UI renderer tests remain green.

### Implementation evidence

- `src/mcp/protocol/json-schema.ts` defines the public recursive finite-JSON
  value and Draft 2020-12 schema types, local-reference preflight, complexity
  limits, dialect helpers, and the validation boundary.
- Validation runs in a restartable worker with a hard 500 ms deadline. Schema
  depth, nodes, local-reference count, schema strings, output depth/nodes,
  array length, object properties, output strings, compiled-validator cache,
  and returned issue details all have explicit limits. Per-call overrides may
  tighten these limits for tests or stricter deployments but cannot raise the
  production ceilings.
- Only local JSON Pointer and local anchor `$ref` values are accepted.
  Network, filesystem, unresolved, circular, dynamic, and recursive references
  fail before compilation; Ajv has no asynchronous schema loader.
- Draft 2020-12 is the default canonical dialect. Explicit 2019-09 and Draft 7
  schemas are validated with their matching Ajv implementation and are never
  rewritten. Photon-authored 2026 tool schemas receive explicit 2020-12
  dialect metadata; legacy 2025 and imported schemas retain their prior bytes.
- Native, daemon, generator, stdio/SSE, and imported-MCP tool-result paths
  validate declared structured output before emission. Author schema failures
  and runtime mismatches become bounded tool errors with no invalid
  `structuredContent`.
- Modern 2026 responses preserve object, array, string, number, boolean, and
  null roots. The 2025 adapters continue to emit structured content only for
  object roots while still applying canonical validation.
- External MCP import retains `outputSchema`, `$schema`, `$defs`, composition
  keywords, local references, and custom vocabulary keys without semantic
  transformation.
- Structured-content consumers now check property presence rather than
  truthiness, so `false`, `0`, empty strings, and `null` are not discarded.
- `bun run test:mcp-schema` is the named validator/security regression command.
  Its fixtures cover composition, local pointers/anchors, all JSON roots,
  bounded mismatch details, unsafe/circular/deep references, output limits,
  worker timeout/recovery, non-finite/cyclic runtime values, dialect handling,
  and imported schema preservation. The streamable transport suite adds
  end-to-end 2025/2026 wire and tool-error coverage.

## 9. Work package 5: tool error semantics

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Return recoverable tool and validation failures as tool results while reserving
JSON-RPC errors for protocol failures.

### Implementation steps

1. Classify errors into:
   - HTTP envelope errors;
   - JSON-RPC parse/dispatch errors;
   - MCP protocol and capability errors;
   - tool input validation errors;
   - tool execution/business errors;
   - internal Photon failures.
2. Return tool input and business failures through `CallToolResult` with
   `isError: true`, useful text content, and safe structured details.
3. Use `-32602` for invalid MCP parameters, including resource-not-found where
   required by the target specification.
4. Retain correlation IDs and trace context without leaking secrets or stack
   traces.
5. Add a stable Photon error-code namespace under `_meta`.
6. Ensure external MCP tool errors retain their upstream `isError` semantics.
7. Document retryability and which failures an LLM can correct.

### Canonical error contract

Photon separates failures at the first boundary that can classify them without
guessing:

| Failure layer                     | Wire representation                                         | Modern HTTP status |
| --------------------------------- | ----------------------------------------------------------- | ------------------ |
| HTTP envelope                     | HTTP error; JSON-RPC only after a request can be identified | `4xx` or `5xx`     |
| JSON parse/request/dispatch       | JSON-RPC `-32700`, `-32600`, or `-32601`                    | `400` or `404`     |
| MCP parameters/capabilities       | JSON-RPC `-32602` or the defined `-32020..-32022` codes     | `400`              |
| Unknown 2026 tool                 | JSON-RPC `-32602`                                           | `400`              |
| Tool argument schema mismatch     | `CallToolResult` with `isError: true`                       | `200`              |
| Tool business/dependency failure  | `CallToolResult` with `isError: true`                       | `200`              |
| Unexpected Photon handler failure | JSON-RPC `-32603` with generic public text                  | `500`              |

A malformed `tools/call` request is therefore different from a well-formed
call whose `arguments` fail the advertised tool schema. The former is a
protocol error; the latter is actionable model feedback and can be retried
with corrected arguments and a new JSON-RPC id.

Every Photon-authored tool error has a bounded descriptor at
`_meta["io.portel.photon/error"]`. The descriptor contains a stable code,
category, retryability, safe public message, and—when valid—a correlation id
and W3C `traceparent`. `_meta.photon` remains as the 2025 Beam compatibility
alias, and `structuredContent.error` remains object-shaped for legacy SDKs.

| Stable code                      | Retryable  | Corrective action                                               |
| -------------------------------- | ---------- | --------------------------------------------------------------- |
| `PHOTON_TOOL_INPUT_INVALID`      | No         | Correct arguments using `inputSchema`, then retry with a new id |
| `PHOTON_TOOL_EXECUTION_FAILED`   | Usually no | Use the safe tool feedback or choose another operation          |
| `PHOTON_TOOL_OUTPUT_INVALID`     | No         | Server/tool author must fix its declared output contract        |
| `PHOTON_AUTHENTICATION_REQUIRED` | No         | Acquire credentials, then issue a new call                      |
| `PHOTON_ACCESS_DENIED`           | No         | Use an authorized caller or permitted tool                      |
| `PHOTON_DEPENDENCY_UNAVAILABLE`  | Yes        | Back off and retry when the upstream recovers                   |
| `PHOTON_TOOL_RATE_LIMITED`       | Yes        | Wait for the rate-limit window                                  |
| `PHOTON_TOOL_TIMED_OUT`          | Yes        | Retry with backoff or reduce the operation                      |
| `PHOTON_TOOL_CANCELLED`          | No         | Start a new call only if the work is still needed               |

### Backward compatibility

Preserve legacy error fields used by Beam through the 2025 adapter. Beam must be
updated to prefer canonical structured errors while accepting the old shape.

### Acceptance evidence

- A matrix test covers every error layer and expected HTTP/JSON-RPC/result
  shape.
- Tool validation errors can be corrected and retried by a client.
- Security tests prove stack traces, tokens, and secret arguments are redacted.

### Implementation evidence

- `src/mcp/protocol/tool-errors.ts` owns the stable code namespace, bounded
  descriptor, safe correlation/trace reference, structured error result, and
  2025 `_meta.photon` alias.
- `src/shared/error-handler.ts` strips stack frames, authorization values,
  bearer credentials, JWTs, password/secret/token/API-key fields, URL
  credentials, private keys, control characters, and oversized public text.
  Development mode no longer serializes tool arguments or stack traces.
- Modern adapters map parse/request/parameter errors to HTTP `400`,
  method-not-found to `404`, and internal errors to `500`; legacy JSON-RPC
  responses retain HTTP `200`.
- Native, daemon, Beam-system, external SDK, and wrapper-client tool paths
  converge on the canonical tool-error builder. Upstream `isError`,
  `structuredContent`, content, and metadata semantics remain tool results
  rather than being converted to protocol failures.
- A dispatch containment boundary converts unexpected handler exceptions to a
  generic correlated `-32603` response without returning implementation text.
  `resources/read` absence remains `-32602`.
- Generated Beam, MCP Apps, platform, and resource bridges reject
  `isError: true`, retain stable code/correlation/retryability on the JavaScript
  `Error`, and continue accepting the legacy success shape.
- `bun run test:mcp-errors` covers HTTP, parse, dispatch, protocol-parameter,
  input-validation, business, dependency, resource-not-found, and internal
  layers; corrected retries; 2025 compatibility; upstream preservation;
  correlation/trace metadata; and behavioral secret/stack redaction.

## 10. Work package 6: multi-round tool responses

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Replace connection-bound 2026 elicitation and sampling with the stateless
`input_required` retry model.

### Implementation steps

1. Define canonical `InputRequest`, `InputResponses`, and
   `InputRequiredResult` types.
2. Adapt Photon `yield { ask: ... }`, `this.elicit()`, and supported sampling
   requests into `inputRequests`.
3. Return:
   - `resultType: "input_required"`;
   - one or more `inputRequests`;
   - opaque `requestState`.
4. Implement a request-state store with:
   - cryptographically random identifiers or authenticated state tokens;
   - caller, tool, and original-arguments binding;
   - expiration;
   - single-use or explicitly idempotent replay behavior;
   - size limits and cleanup.
5. Accept retries of the original method with `inputResponses` and
   `requestState`.
6. Require a new JSON-RPC ID for the retry.
7. Reject state used by another caller, method, tool name, or argument set.
8. Define partial-response behavior when only some requests are answered.
9. Make cancellation and timeout release pending execution resources.
10. Keep 2025 behavior:
    - Beam/session clients may continue using server-to-client elicitation and
      sampling;
    - the runtime chooses the adapter from the request profile.
11. Prefer direct model-provider integrations for new sampling use cases and
    retain MCP sampling as a deprecated compatibility path.

### Acceptance evidence

- Form, confirmation, URL, and sampling-style input fixtures complete after a
  stateless retry.
- Cross-caller, modified-argument, expired-state, duplicate-response, and replay
  attacks are rejected.
- A server restart test defines whether outstanding state is durable or
  intentionally invalidated.
- Existing 2025 Beam elicitation and sampling tests remain green.

### Implementation evidence

- `src/mcp/protocol/input-required.ts` defines the canonical
  `InputRequest`, `InputRequests`, `InputResponses`, and
  `InputRequiredResult` shapes and a bounded request-state coordinator. The
  protocol shapes are exported from Photon’s public TypeScript entry point.
- Every outstanding flow uses a 256-bit random opaque state identifier, a hard
  TTL, global/per-principal capacity limits, round/request/value limits, and an
  owned abort signal. Accepted retries rotate the state identifier; consumed
  and stale identifiers cannot be replayed.
- State is bound to protocol revision, authenticated principal attributes,
  authorization/claim scope, explicit Photon application session (when one was
  supplied), original method, resolved tool, purpose, and a deterministic
  SHA-256 hash of the original finite-JSON arguments.
- 2026 `tools/call` maps Photon generator asks, `this.elicit()`, confirmation,
  URL elicitation, and `this.sample()` to canonical in-band
  `{ method, params }` requests. A retry resumes the suspended execution without
  using an MCP session, transport GET stream, or server-to-client JSON-RPC
  request.
- Partial responses are accepted only for currently outstanding keys. Photon
  returns the unanswered requests with a rotated state identifier and resumes
  execution exactly once when the round is complete.
- Outstanding continuations are intentionally process-local in WP6. A restart
  invalidates them with `-32602`; WP12 is the explicit gate for a
  process-independent continuation strategy. This avoids claiming durability
  for JavaScript continuations that cannot be serialized safely.
- The 2025 path still uses Beam/session server-to-client elicitation and
  sampling. Its provider functions and stdio behavior are unchanged.
- `docs/reference/MCP-PRIMITIVES.md` marks MCP sampling as a deprecated
  compatibility API for 2026 and recommends direct provider integration when a
  workflow requires predictable model availability.
- `bun run test:mcp-multi-round` covers form, confirmation, URL, sampling,
  sequential and partial rounds; new-id, caller/tool/scope/argument binding;
  malformed results; expiry; cancellation; replay; restart invalidation; and
  capacity limits. The wire, error, streamable transport, and primitive
  compatibility suites remain green.

### Spec provenance note

The 2026 release-candidate blog used the older
`resultType: "inputRequired"` spelling. The pinned generated schema, current
Tools specification, SEP-2322, and TypeScript SDK migration guide all use
`resultType: "input_required"`, which is the wire value Photon implements.

## 11. Work package 7: MCP Tasks extension

### Goal

Map Photon’s durable task engine to the official-organization experimental
`io.modelcontextprotocol/tasks` extension draft.

### Implementation steps

1. Keep internal task storage independent of either wire revision.
2. Change 2026 wire fields to:
   - `taskId`;
   - `status`;
   - `createdAt`;
   - `lastUpdatedAt`;
   - `ttlMs`;
   - `pollIntervalMs`.
3. Add complete task state payloads:
   - `result` for completed tasks;
   - structured `error` for failed tasks;
   - `inputRequests` for `input_required`;
   - status message and progress where permitted.
4. Remove `tasks/create` and `tasks/list` from the 2026 surface.
5. Implement:
   - `tasks/get`;
   - `tasks/update`;
   - `tasks/cancel`.
6. Make task creation server-directed from a supported request such as
   `tools/call`.
7. Return `resultType: "task"` only when the request declares
   `clientCapabilities.extensions["io.modelcontextprotocol/tasks"]`.
8. If the client lacks the extension:
   - execute synchronously when safe; or
   - return a clear capability error when the operation requires durability.
9. Persist the task before returning its handle.
10. Bind task visibility and mutation to caller identity and claim scope.
11. Make `tasks/update` accept responses only for outstanding input-request
    keys.
12. Make cancellation cooperative and idempotent.
13. Define TTL cleanup, terminal-result retention, and restart recovery.
14. Advertise the extension only after all three task methods and durable
    creation pass conformance.
15. Retain the existing 2025 core Tasks handlers in the 2025 adapter.

### Acceptance evidence

- Durable create-before-response test.
- Working, input-required, completed, failed, and cancelled state-machine tests.
- Restart recovery and TTL expiration tests.
- Unauthorized task access tests.
- Duplicate update and cancellation race tests.
- Parallel 2025 and 2026 task client integration tests.

### Status and evidence (completed 2026-07-27)

- The MCP `2026-07-28` core schema does not define Tasks methods or task
  objects. Photon therefore does not describe Tasks as core compliance. It pins
  the experimental extension draft at
  `modelcontextprotocol/ext-tasks@2c1425d9a288b9b1f489430fe1e00bb392b47e48`
  and advertises `io.modelcontextprotocol/tasks: {}` as an optional extension.
- Internal task records are protocol-neutral. The 2025 adapter retains
  `ttl`/`pollInterval`, nested creation results, `tasks/create`, `tasks/list`,
  and `tasks/result`. The 2026 extension adapter emits flat task handles with
  `taskId`, `status`, `createdAt`, `lastUpdatedAt`, `ttlMs`, and optional
  `pollIntervalMs`; `tasks/create`, `tasks/list`, and `tasks/result` return
  method-not-found.
- Server-directed 2026 creation is available for Photon generator/input
  workflows and `@async` methods. The request must declare the exact extension;
  a legacy `task` request parameter is ignored by 2026 and cannot opt a client
  in. Without the extension, the normal synchronous/MRTR path remains active.
- A task is atomically persisted before its handle is returned. IDs contain
  256 random bits, and stored access metadata binds the task to the
  request’s caller principal, OAuth/claim scope, and any explicit Photon
  application session without persisting bearer credentials.
- Modern `tasks/get` returns the complete status-specific shape:
  `inputRequests`, `result`, or structured JSON-RPC `error`. Internal progress
  remains available for status-message updates; the draft Task object has no
  generic `progress` member, so Photon does not emit a non-standard field.
- Modern `tasks/update` consumes only currently outstanding keys, supports
  partial updates, and ignores unknown, duplicate, or already-satisfied keys as
  required by the draft. Elicitation and sampling requests are both represented
  as direct `{ method, params }` values.
- Task lifecycle requests without the extension receive the draft’s
  extension-specific `-32003` Missing Required Client Capability error; this is
  intentionally distinct from the pinned core profile’s generic capability
  error code.
- Modern cancellation is cooperative and idempotent. Compare-and-transition
  writes prevent a cancellation/completion race from overwriting an existing
  terminal result.
- TTL is measured from creation for modern records. Atomic file replacement,
  periodic cleanup, terminal retention, and lazy per-directory recovery are
  implemented. Because JavaScript continuations are not serializable, a
  persisted non-terminal task found after restart becomes a structured
  `PHOTON_TASK_INTERRUPTED_BY_RESTART` failure; completed results survive.
- Modern tasks are never sent through the unauthenticated legacy task-status
  broadcast. Request-scoped, task-filtered status notifications remain a WP9
  subscription enhancement and are not claimed by this extension capability.
- `tests/mcp-tasks-extension.test.ts` covers capability discovery, no-capability
  fallback, persist-before-response, working/input-required/completed/failed/
  cancelled states, keyed input updates and replay, caller isolation,
  idempotent cancellation, TTL expiry, restart recovery, and parallel 2025
  wire behavior. The legacy task suite and complete Streamable HTTP regression
  suite remain green.

## 12. Work package 8: extension negotiation and MCP Apps

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Make every optional feature discoverable through canonical, enforceable
extension negotiation.

### Implementation steps

1. Centralize extension identifiers:
   - `io.modelcontextprotocol/ui`;
   - `io.modelcontextprotocol/tasks`;
   - `dev.portel.photon`.
2. Parse only canonical extension identifiers for 2026.
3. Retain `mcp-apps`, `apps`, and experimental aliases only in the 2025
   compatibility profile.
4. Validate extension settings objects and reject invalid reserved identifiers.
5. Require the corresponding client extension before emitting extension result
   fields.
6. Keep UI resource and linked-tool metadata compliant with the installed MCP
   Apps extension.
7. Separate Photon-private metadata from standard MCP Apps metadata.
8. Add an extension registry that owns:
   - identifier;
   - version;
   - client requirement;
   - advertised server settings;
   - request and response hooks.

### Acceptance evidence

- Discovery contains only enabled canonical extensions in 2026.
- Alias acceptance tests are revision-scoped.
- Missing-capability tests return `-32021`.
- Beam, ChatGPT, and a generic MCP Apps client render the same linked tool.

### Implementation evidence

- `src/mcp/protocol/extensions.ts` is the registry for the canonical UI, Tasks,
  and Photon extension identifiers. It owns server advertisement, request
  settings validation, exact opt-in checks, and the pinned MCP Apps MIME type.
- Photon pins `@modelcontextprotocol/ext-apps` `1.7.5`, released from official
  commit `92f46a574568a3ddac7600343b7d3c4c4ed7b588`. Its generated
  JSON Schema 2020-12 document is the Apps wire authority used for this work
  package. The extension's older core-initialize examples do not override the
  pinned MCP 2026 per-request capability contract.
- Modern discovery is registry-derived and advertises only
  `io.modelcontextprotocol/ui`, `io.modelcontextprotocol/tasks`, and
  `dev.portel.photon`. The unregistered AG-UI experimental advertisement was
  removed from the 2026 profile and remains available through legacy behavior.
- A 2026 Apps client must declare
  `extensions["io.modelcontextprotocol/ui"].mimeTypes` containing
  `text/html;profile=mcp-app` on the current request. `mcp-apps`, `apps`,
  `experimental`, OpenAI/ChatGPT identity, and Beam inference cannot activate
  the modern extension. Those compatibility paths remain in the 2025 profile.
- `ui://` resource reads require the canonical Apps capability and return
  `-32021` when it is absent. Linked tools emit both the preferred nested
  `_meta.ui.resourceUri` and the Apps 1.7.5 deprecated flat
  `_meta["ui/resourceUri"]` compatibility key only after that opt-in.
- Modern response decoration passes through a final extension firewall.
  Standard Apps metadata, Photon render/client/app-session metadata, vendor
  tool fields, and OpenAI widget aliases cannot cross into a response that did
  not negotiate the corresponding profile on that exact request.
- A modern `tools/call` result is returned only to its requesting MCP Apps
  Host, which forwards it to the associated View. Photon does not place modern
  `ui/notifications/tool-result` messages on the legacy global broadcast bus.
- Photon-private app-session input and output use
  `dev.portel.photon/appSessionId` in 2026. The legacy
  `photon/appSessionId`, argument aliases, and
  `X-Photon-App-Session-Id` header remain 2025-only.
- Client-specific extension responses are marked private for caching. Plain
  2026 clients receive byte-identical public list responses without Photon
  profile echoes.
- `tests/streamable-http-transport.test.ts` covers malformed settings, unknown
  reserved identifiers, canonical opt-in, modern alias/brand rejection,
  per-request isolation, standard/private metadata separation, deprecated Apps
  linkage compatibility, resource capability errors, and unchanged legacy
  discovery/list behavior.

## 13. Work package 9: custom routing headers

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Support `x-mcp-header` without allowing ambiguous routing or accidental secret
exposure.

### Implementation steps

1. Preserve `x-mcp-header` annotations in tool input schemas.
2. Validate annotation values:
   - non-empty;
   - valid RFC 9110 `tchar` names;
   - case-insensitively unique;
   - applied only to string, integer, or boolean properties;
   - reachable only through statically known nested `properties` paths, never
     arrays, references, composition, or conditionals.
3. Mirror annotated arguments to `Mcp-Param-{name}` on Photon’s outbound MCP
   client calls.
4. On inbound calls, compare mirrored parameter headers with canonical body
   values and return `HeaderMismatch` on disagreement.
5. Define canonical string serialization for primitive values:
   - strings remain unchanged when they are printable ASCII without leading or
     trailing space or tab;
   - integers use decimal and booleans use lowercase;
   - unsafe ASCII, controls, non-ASCII, and literal sentinel-shaped strings use
     the `=?base64?{UTF-8 base64}?=` envelope;
   - absent and null values omit the header while empty string, zero, and false
     remain present.
6. Reject duplicate or multi-valued routing headers.
7. Prevent annotations on fields marked secret, write-only, credentials, or
   otherwise sensitive.
8. Update CORS preflight handling for the finite advertised header set.
9. Add proxy tests proving routing can occur without parsing the body.

### Backward compatibility

Older clients may omit custom headers. Photon must require them only when the
negotiated revision and tool schema make them part of the request contract.

### Acceptance evidence

- Valid annotations round-trip through tools/list and tools/call.
- Invalid annotation definitions are excluded or rejected deterministically.
- Header/body mismatch, boolean/integer serialization, CORS, and secret-field
  tests pass.

### Implementation evidence

- `src/mcp/protocol/routing-headers.ts` owns bounded annotation parsing, static
  path extraction, sensitivity checks, canonical encoding/decoding, outbound
  header construction, and raw-header/body validation.
- MCP 2026 inbound `tools/call` requests require the exact mirrored headers and
  return HTTP 400 with `HeaderMismatch` (`-32020`) for missing, malformed,
  duplicate, unexpected, or mismatched values. MCP 2025 calls retain the
  body-only path.
- External Streamable HTTP clients register only valid annotated tool schemas
  and clone per-request headers before adding `Mcp-Method`, encoded `Mcp-Name`,
  and `Mcp-Param-*` values. Shared request headers are never mutated.
- Modern discovery excludes invalid annotated tools. CORS advertises the
  finite union of valid routing headers and never reflects requested header
  names.
- `bun run test:mcp-routing-headers` covers direct and nested schemas, invalid
  routes and types, case-insensitive duplicates, sensitive fields, canonical
  encoding, UTF-8 failure, empty/zero/false behavior, integer equivalence,
  missing/unexpected/malformed/duplicate/mismatched values, and concurrent
  outbound calls.
- `bun run test:streamable-http` covers annotation preservation, modern
  exclusion of invalid tools, successful and rejected calls, 2025 omission
  compatibility, finite CORS advertising, and proof that rejected routing
  requests do not execute user code.

## 14. Work package 10: authorization hardening

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Bring Photon’s HTTP authorization implementation into alignment with the MCP
OAuth profile while keeping stdio credentials environment-based.

### Implementation steps

1. Audit Protected Resource Metadata and ensure `authorization_servers` is
   present and canonical.
2. Return `WWW-Authenticate` with `resource_metadata` on relevant 401 responses.
3. Validate issuer, audience/resource, expiry, signature, and scopes on every
   protected request.
4. Bind client registrations, credentials, tokens, and refresh state to the
   authorization-server issuer.
5. Invalidate or re-register when the discovered issuer changes.
6. Include and validate issuer identification in authorization responses where
   supported by the selected OAuth profile.
7. Support `application_type` in Dynamic Client Registration:
   - `native` for CLI, desktop, mobile, and localhost callbacks;
   - `web` for remotely hosted browser clients.
8. Require exact redirect URI matching, PKCE, and state validation.
9. Include the canonical MCP resource indicator in authorization and token
   requests.
10. Never accept bearer tokens through query parameters for 2026 requests.
    Retain query-token support only where a legacy EventSource transport
    requires it, with explicit warnings and narrow scope.
11. Keep refresh tokens confidential and issuer-scoped.
12. Test multiple authorization servers without credential crossover.

### Acceptance evidence

- Metadata, 401 challenge, issuer, application type, PKCE, resource indicator,
  refresh, and scope tests.
- Negative tests for wrong issuer, wrong audience, issuer rotation, redirect
  mismatch, expired tokens, and cross-server credential reuse.
- stdio tests prove HTTP OAuth behavior is not applied there.

### Implementation evidence

- SERV Protected Resource Metadata now publishes the canonical tenant or
  custom-domain MCP resource, a non-empty `authorization_servers` array,
  header-only bearer transport, and supported scopes. Authorization Server
  Metadata advertises RFC 9207 issuer response parameters.
- Every relevant HTTP 401 carries an absolute `resource_metadata` challenge.
  Insufficient scope returns HTTP 403 with `error="insufficient_scope"` and
  the required scope set.
- Streamable HTTP no longer decodes an unverified JWT into caller identity.
  Protected calls verify signature, exact issuer, exact resource audience,
  expiry/not-before/issued-at bounds, and method scopes before any Photon code
  executes. Verified claims alone populate the request caller.
- Authorization codes, pending consent requests, DCR registrations, refresh
  tokens, issued access tokens, revocation, and introspection are bound to the
  tenant authorization-server issuer and canonical RFC 8707 resource.
  Issuerless legacy persisted records fail closed and require re-registration.
- `/authorize` and every applicable `/token` grant require exactly one
  canonical `resource` value. Authorization success and trusted error
  redirects include `iss`; redirect URIs match exactly and PKCE remains S256.
- DCR validates and persists `application_type`. Remote browser clients are
  `web`; native clients are public and may use loopback HTTP. Omitted
  `application_type` still infers `native` for existing loopback clients,
  preserving their migration path, while remote registrations retain the
  standard `web` default.
- Modern requests and all POST requests reject bearer query credentials.
  Legacy EventSource GET alone may carry a query token; it is cryptographically
  verified, principal-bound to the legacy session, and returned with an
  explicit deprecation warning.
- SERV accepts canonical resource-bound OAuth access tokens without requiring
  an MCP transport session and retains the old signed session-token path for
  MCP 2025 clients. The stdio integration suite deliberately runs with an
  incomplete HTTP JWT configuration and still completes discovery and a tool
  call, proving HTTP OAuth is not applied to stdio.
- `bun run test:mcp-oauth-2026` is the named verification command. It covers
  metadata/challenges, JWT claims and tampering, PKCE, DCR application types,
  exact redirects, resource indicators, issuer rotation and credential
  crossover, refresh rotation/revocation, SQLite migration and persistence,
  Streamable HTTP execution gating, legacy EventSource compatibility, and
  stdio isolation.

## 15. Work package 11: observability and deprecated feature migration

**Status:** Implemented; acceptance verification passing locally on 2026-07-27.

### Goal

Keep deprecated MCP features available for compatibility while moving Photon’s
primary developer experience to their supported replacements.

### Implementation steps

1. Mark roots, sampling, and MCP logging as compatibility features in docs and
   capability descriptions.
2. Keep them operational for revisions that require the deprecation window.
3. Move structured runtime observability to OpenTelemetry.
4. Write human-readable stdio diagnostics to stderr, never stdout.
5. Carry `traceparent`, `tracestate`, and `baggage` through:
   - request decoding;
   - loader execution;
   - daemon calls;
   - task creation and polling;
   - external MCP calls;
   - logs and spans.
6. Validate trace and baggage syntax and bound baggage size.
7. Prevent untrusted baggage from becoming metric labels without sanitization.
8. Provide direct model-provider adapters as the preferred replacement for
   `this.sample()`.
9. Recommend explicit tool arguments, resource URIs, or server configuration
   instead of roots.
10. Define a future removal gate based on the MCP deprecation lifecycle rather
    than Photon release dates alone.

### Acceptance evidence

- End-to-end trace continuity tests across HTTP, daemon, task, and external MCP
  hops.
- stdout purity test for stdio.
- Documentation contains migration examples for all three deprecated features.
- Legacy feature tests remain green during the required support window.

### Implementation evidence

- Streamable HTTP accepts W3C propagation from canonical request `_meta` or
  HTTP headers, rejects multiple/header-body disagreements, and validates
  lowercase `traceparent`, bounded `tracestate`, and bounded `baggage` before
  authentication or Photon execution. The same validator is reused at loader,
  daemon, task-store, and OpenTelemetry boundaries.
- `traceparent`, `tracestate`, and `baggage` now survive HTTP request decoding,
  AsyncLocalStorage, nested `this.call()`, daemon IPC, daemon worker threads,
  persisted task creation, OpenTelemetry logs/spans, and SDK-backed external
  MCP calls. Invalid internal/in-band context is dropped; invalid public HTTP
  or daemon wire context is rejected.
- The metrics bridge has no request-context or baggage input. Baggage remains a
  bounded propagation/log context value and is never expanded into metric
  attribute keys or values, avoiding untrusted-cardinality labels.
- `OpenAICompatibleProvider`, `AnthropicProvider`, and the stable
  `ModelProvider` interface provide dependency-free direct-provider execution
  as the preferred sampling replacement. They support deferred API-key
  resolution, custom base URLs/fetch implementations, abort signals,
  per-request models, usage normalization, and bounded provider errors.
- The `dev.portel.photon` 2026 capability description names roots, sampling,
  and logging as deprecated compatibility features with their replacements and
  MCP-lifecycle removal gate. The legacy 2025 discovery bytes are unchanged.
- `docs/guides/MCP-DEPRECATED-FEATURES.md` contains before/after migration
  examples for roots, sampling, and logging. Compatibility removal requires
  eligibility under the MCP feature lifecycle, a separate removal SEP, a
  protocol revision that omits the feature, and Photon’s 2025 compatibility
  gate; it is not tied to a Photon release date.
- `bun run test:mcp-observability-2026` is the named verification command. Its
  nine gates cover strict propagation syntax and limits, OTel correlation and
  metric-cardinality isolation, both model adapters, lifecycle capability
  metadata, HTTP-to-loader and HTTP-to-external-MCP continuity, task
  persistence without wire leakage, live daemon IPC continuity, invalid
  context rejection, stdio stdout purity, and migration documentation.
- The MCP 2025 byte-golden fixture, Streamable HTTP suite, Tasks extension
  suite, stdio integration suite, server tests, logger tests, daemon protocol
  suite, and promise suite remain the compatibility regression gates.

## 16. Work package 12: stateless deployment and resilience

**Status:** Implemented; resilience, boundary, and load gates passing locally
on 2026-07-27.

### Goal

Prove that the 2026 protocol surface can run behind ordinary horizontally
scaled HTTP infrastructure.

### Implementation steps

1. Remove all 2026 routing decisions based on in-memory transport session state.
2. Keep ephemeral request execution local; store durable multi-round and task
   state in a process-independent store.
3. Make application-session handles explicit, opaque, scoped, and revocable.
4. Define behavior when requests in one logical application flow reach
   different Photon instances.
5. Add bounded subscription counts, resource filters, queues, and keepalives.
6. Apply backpressure or disconnect slow subscription consumers without
   blocking other clients.
7. Deliver graceful subscription termination during server shutdown.
8. Make duplicate request and retry behavior explicit for idempotent and
   non-idempotent tools.
9. Add load tests for:
   - discovery and list caching;
   - concurrent tool calls;
   - subscription fan-out;
   - task polling;
   - multi-round retries.
10. Add failure tests for instance restart, daemon restart, dropped streams,
    stale handles, and partial storage outages.

### Acceptance evidence

- A two-process test distributes successive requests across instances.
- No 2026 test sends a protocol session header.
- Durable tasks and request state survive the documented restart boundary.
- Load tests meet recorded latency, memory, and subscription limits.

### Implementation evidence

- Modern input and destructive-confirmation flows now use
  `DurableStatelessInputStateStore`. Records are atomically written beneath the
  deployment `workingDir`, locked during resume, bounded by deployment/caller,
  and bound to protocol, caller, scope, application handle, tool, arguments,
  and request IDs. A lock heartbeat prevents long post-input execution from
  being mistaken for an abandoned process; closing one process does not delete
  state needed by another.
- Because JavaScript continuations cannot cross processes, validated answers
  are persisted and the tool is deterministically replayed from its beginning.
  `docs/guides/MCP-STATELESS-DEPLOYMENT.md` makes the resulting
  collect-input-before-side-effects authoring rule explicit.
- `AppSessionHandleStore` issues 256-bit opaque `aps_` handles from
  `server/discover` only after exact Photon-extension negotiation. Handles are
  scoped to caller and claim scope, expire, have global/per-caller bounds, and
  can be revoked through
  `dev.portel.photon/app-sessions/revoke`. Modern responses never expose the
  caller-derived fallback identity as an application handle.
- `IdempotencyStore` uses atomic exclusive claims. Completed read-only or
  idempotent responses replay with the retry's JSON-RPC ID; pending or completed
  non-idempotent duplicates return HTTP 409 / `DuplicateRequest`. Keys bind to
  caller, scope, application handle, tool, and canonical arguments.
  Interactive/destructive tools continue through request-state confirmation
  and reject the separate idempotency field.
- Request-state, application-handle, and idempotency storage failures fail
  closed. Corrupt data is not replayed; availability failures are distinguished
  from malformed client state; an uncommitted post-execution outcome is marked
  unknown and non-retryable.
- Request-scoped subscriptions are limited to 1,024 per process and 16 per
  caller, 64 resource filters, 2,048-byte URIs, and a 256 KiB blocked-stream
  queue. A 15-second keepalive and 5-second backpressure deadline are enforced.
  Drain resumes the bounded queue; overflow or timeout disconnects only the
  slow consumer. Disconnect removes resource sinks, and shutdown emits a final
  complete event where possible.
- `tests/mcp-stateless-resilience-2026.test.ts` runs two independent HTTP
  processes against one shared deployment directory. It starts input on
  instance A, terminates A, resumes on B, replays a safe response on C without
  executing C, rejects an unsafe duplicate, creates a Task on B and polls it on
  C, revokes a handle on C and observes rejection on B, and covers corruption,
  expiry, caller/scope mismatch, and partial storage outages. None of its 2026
  requests sends `Mcp-Session-Id`.
- `tests/streamable-http-transport.test.ts` covers filter and URI boundaries,
  the exact per-caller subscription cap, dropped-stream cleanup, bounded-queue
  slow-consumer isolation, and graceful shutdown. Existing daemon watcher and
  reconnect suites cover daemon loss, event refresh, and instance-routing
  recovery without making HTTP protocol state daemon-local.
- `npm run test:mcp-stateless-load-2026` exercises 60 discovery/list requests,
  64 concurrent calls, 12-way subscription fan-out, 12 Tasks, and eight
  concurrent multi-round retries in a real child process. The recorded local
  gate observed p95 discovery/list 1.45 ms, p95 concurrent call 39.14 ms,
  fan-out 1.11 ms, task completion/polling 84.55 ms, multi-round completion
  12.16 ms, and 12.6 MiB RSS growth. Enforced thresholds are respectively
  500 ms, 1 s, 2 s, 3 s, 3 s, and 64 MiB; every CI run prints fresh evidence.

## 17. Work package 13: SDK isolation and conformance

**Status:** Implemented; official HTTP, Tasks, SDK-boundary, stdio parity, and
MCP Apps contract gates passing locally on 2026-07-28.

### Goal

Use official SDK behavior for Beam’s client protocol without coupling
Photon’s canonical server/runtime model to SDK classes.

### Implementation steps

1. Confine `@modelcontextprotocol/sdk` v1 usage to the 2025 adapter.
2. Avoid casting new 2026 result shapes through v1 types.
3. Keep Beam on the official TypeScript SDK v2 client and validate its Photon
   adapter seam against the official client’s modern and legacy behavior.
4. Keep Photon’s canonical runtime types independent of SDK classes.
5. Vendor no unofficial protocol changes.
6. Run the official conformance suite against:
   - 2025 Streamable HTTP;
   - 2026 Streamable HTTP;
   - supported stdio revisions;
   - optional Tasks and MCP Apps profiles.
7. Add Photon’s golden compatibility suite for behaviors outside official
   conformance coverage.
8. Pin the tested specification schema and SDK versions in CI.
9. Add a scheduled compatibility job against the newest allowed SDK patch.

### Acceptance evidence

- `tests/conformance/official-runner.ts` runs the pinned official package
  against an ephemeral real Photon Streamable HTTP server and archives
  per-profile reports under `artifacts/mcp-conformance/`.
- The recorded local official results are 42/42 for MCP 2025 HTTP, 23/23 for
  MCP 2026 core HTTP, 80/80 for the 2026 draft suite, and 35/35 for the Tasks
  extension scenarios.
- `tests/mcp-sdk-boundary.test.ts` proves that production v1 SDK imports are
  confined to `src/mcp/sdk-v1-2025/` and that canonical protocol modules do not
  depend on that adapter.
- `tests/conformance/pins.json` records the exact spec, Tasks, Apps, official
  Beam client, legacy server SDK, and conformance revisions.
- `.github/workflows/ci.yml` runs and archives official conformance plus
  Photon stdio parity and MCP Apps contracts.
  `.github/workflows/mcp-sdk-compat.yml` tests the newest allowed SDK v1 patch
  weekly.
- The official runner currently exposes only an HTTP URL target and contains no
  MCP Apps server scenarios. The recorded design substitution is Photon’s
  schema-driven stdio/HTTP parity suite and complete MCP Apps contract suite;
  see `docs/internals/MCP-CONFORMANCE.md`.

## 18. Work package 14: documentation and release

**Status:** Implemented; documentation clients, release manifest, and doctor
diagnostics passing locally on 2026-07-28.

### Goal

Ship an accurate compatibility promise that coders and generated-code workflows
can rely on.

### Implementation steps

1. Update the protocol feature guide with canonical required 2026 metadata.
2. Publish a compatibility matrix by protocol version and transport.
3. Document:
   - discovery;
   - stateless application handles;
   - subscriptions;
   - multi-round responses;
   - Tasks;
   - schema support;
   - authorization;
   - deprecated features.
4. Add copy-paste examples and minimal clients for 2025 and 2026.
5. Add migration notes for existing Photon Tasks, sampling, roots, and logging
   users.
6. Expose a `photon doctor mcp` command or equivalent diagnostic that reports
   adapter, protocol, capability, auth, and conformance status.
7. Mark experimental features accurately until their acceptance gates pass.
8. Publish release notes with known limitations and rollback instructions.

### Acceptance evidence

- `docs/guides/MCP-COMPATIBILITY.md` publishes the version/transport matrix,
  canonical request metadata, discovery, handles, subscriptions, multi-round
  input, Tasks, Apps, schema, authorization, and deprecation contracts.
- `examples/mcp-clients/legacy-2025.mjs` and
  `examples/mcp-clients/stateless-2026.mjs` are copy-paste clients.
  `tests/mcp-documentation.test.ts` runs both against a real Photon server in
  CI.
- `photon doctor mcp` renders `src/mcp/protocol/compliance.ts`, including
  adapters, protocols, transports, extensions, auth mode, exact pins, and the
  release conformance checkpoint.
- The documentation test proves the release manifest’s versions and extension
  IDs exactly match the runtime registries.
- `docs/guides/MCP-DEPRECATED-FEATURES.md` confines removed task operations to
  explicitly labeled 2025 migration guidance and documents 2026 per-request
  logging.
- `docs/guides/MCP-2026-RELEASE-NOTES.md` records the compatibility promise,
  migration sequence, known limitations, staged rollout, and rollback without
  state deletion.
- README links the compatibility matrix and diagnostic command.

## 19. Ordered implementation milestones

The work packages must be completed in this order unless a recorded design
decision changes the dependency graph.

### Milestone A: protocol foundation

1. Work package 1: strict request validation.
2. Work package 2: versioned wire adapter.
3. Work package 3: deterministic lists and caching.
4. Work package 5: tool error semantics.

**Exit gate:** Core 2026 operations pass conformance without optional Tasks or
multi-round features, and the complete 2025 regression suite passes.

### Milestone B: schema and multi-round execution

1. Work package 4: JSON Schema 2020-12.
2. Work package 6: multi-round tool responses.
3. Work package 12: durable request-state portion.

**Exit gate:** Stateless input-required flows are secure, restart behavior is
documented, and legacy Beam elicitation remains operational.

### Milestone C: durable Tasks

1. Work package 7: Tasks extension.
2. Tasks-related parts of work packages 8 and 12.

**Exit gate:** Photon advertises `io.modelcontextprotocol/tasks` and passes the
extension’s full lifecycle and security suite.

### Milestone D: ecosystem hardening

1. Work package 8: extension registry and MCP Apps.
2. Work package 9: custom routing headers.
3. Work package 10: authorization.
4. Work package 11: observability and deprecations.

**Exit gate:** Optional capability claims are truthful and security tests pass.

### Milestone E: release proof

1. Work package 13: SDK isolation and conformance.
2. Remaining work package 12 resilience and load tests.
3. Work package 14 documentation and release.

**Exit gate:** The completion definition in section 21 is fully evidenced.

## 20. Required verification matrix

| Area                    |       MCP 2025 HTTP |        MCP 2026 HTTP |            stdio |         Security |     Load |
| ----------------------- | ------------------: | -------------------: | ---------------: | ---------------: | -------: |
| Discovery and lifecycle |            Required |             Required |         Required |         Required |    Smoke |
| Tools and schemas       |            Required |             Required |         Required |         Required | Required |
| Resources and caching   |            Required |             Required |         Required |         Required | Required |
| Prompts                 |            Required |             Required |         Required |            Basic |    Smoke |
| Subscriptions           |      Legacy GET/SSE |      Listen POST/SSE |     If supported |         Required | Required |
| Multi-round input       | Legacy request flow | Input-required retry |         Required |         Required | Required |
| Tasks                   |         Legacy core |            Extension |     If supported |         Required | Required |
| MCP Apps                |    Required clients |    Extension clients |              N/A |         Required |    Smoke |
| Authorization           |         Legacy HTTP |        OAuth profile | Environment only |         Required |    Smoke |
| Trace context           |            Required |             Required |         Required | Injection safety | Required |

Every row must have:

- unit tests for encoding and validation;
- transport integration tests;
- at least one representative client test;
- negative and boundary tests;
- a named CI command;
- recorded evidence in the completion checklist.

### Recorded release-gate evidence

- `npm test`: 113/113 repository suites passed in 225 seconds on the final
  worktree, including HTTP transport, stdio, auth, daemon, storage, rendering,
  parity, and documentation regressions.
- `npm run test:mcp-release`: passed the canonical CI gate covering wire
  goldens, JSON Schema 2020-12, error semantics, routing headers, multi-round
  input, Tasks, observability, restart resilience, load, OAuth, stdio/HTTP
  parity, MCP Apps, documentation clients, and every official profile.
- Official results: MCP 2025 HTTP 42/42, MCP 2026 core HTTP 23/23, MCP 2026
  draft 80/80, and Tasks extension 35/35.
- Generated stdio/HTTP schema and invocation parity: 57/57.
- Final stateless load evidence: discovery/list p95 1.09 ms, concurrent tool
  call p95 27.95 ms, subscription fan-out 5.59 ms, Task polling 82.54 ms,
  multi-round completion 9.15 ms, and 16.7 MiB RSS growth. All are below the
  documented thresholds.
- `npm run docs:build`: all 66 documentation pages rendered successfully.
- CI runs the single `test:mcp-release` command and archives
  `artifacts/mcp-conformance/` even on failure. The weekly SDK job separately
  exercises the newest allowed v1 patch.

## 21. Definition of complete

This specification is complete only when all of the following are true:

1. Every work package acceptance section has current passing evidence.
2. The official core conformance suite passes for every advertised revision and
   transport.
3. Every advertised optional extension passes its own conformance or complete
   contract suite.
4. MCP 2025 compatibility tests pass without waived regressions.
5. No 2026 request depends on protocol-level session state.
6. No unsupported or incomplete capability is advertised.
7. Security tests cover request state, task access, authorization, headers,
   schema validation, subscription limits, and metadata propagation.
8. Load and restart tests pass against the documented deployment model.
9. User documentation, examples, and release notes match the shipped wire
   behavior.
10. The worktree is clean and the implementation is checkpointed in reviewable
    commits.

### Completion record

All ten conditions above are satisfied by the recorded gates. Optional
capabilities are sourced from one extension registry; the release manifest and
doctor test assert exact protocol and extension identity parity. MCP 2026 is
advertised only on Streamable HTTP, the pinned Tasks draft remains explicitly
experimental, and stdio remains on the stable MCP 2025 adapter. The
implementation is checkpointed as one specification commit and one reviewable
commit per work package, followed by the release-gate closure.

## 22. Primary references

- MCP `2026-07-28` release candidate:
  <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>
- Draft schema:
  <https://modelcontextprotocol.io/specification/draft/schema>
- Discovery:
  <https://modelcontextprotocol.io/specification/draft/server/discover>
- Streamable HTTP:
  <https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http>
- Tools:
  <https://modelcontextprotocol.io/specification/draft/server/tools>
- Caching:
  <https://modelcontextprotocol.io/specification/draft/server/utilities/caching>
- Authorization:
  <https://modelcontextprotocol.io/specification/draft/basic/authorization>
- Tasks:
  <https://modelcontextprotocol.io/extensions/tasks/overview>
- Deprecated features:
  <https://modelcontextprotocol.io/specification/draft/deprecated>
