# Photon Platform Promises

> Define intent once. Deliver everywhere.

This document defines **what Photon promises its users**. Every feature, interface,
and architectural decision must trace back to one of these promises. If a change
doesn't serve a promise, it doesn't belong. If a promise isn't validated, it's just
marketing.

## Overview

| # | Intent | Promises | Assertions | Priority |
|---|--------|----------|------------|----------|
| [1](#intent-1-single-file-full-stack) | Single File, Full Stack | 3 | 12 | P0 — Core |
| [2](#intent-2-human--agent-same-surface) | Human + Agent, Same Surface | 3 | 11 | P0 — Core |
| [3](#intent-3-zero-config) | Zero Config | 3 | 12 | P0 — Core |
| [4](#intent-4-format-driven-rendering) | Format-Driven Rendering | 3 | 12 | P1 — Essential |
| [5](#intent-5-stateful-by-annotation) | Stateful by Annotation | 3 | 11 | P1 — Essential |
| [6](#intent-6-composable) | Composable | 2 | 8 | P1 — Essential |
| [7](#intent-7-portable) | Portable | 2 | 7 | P2 — Important |
| [8](#intent-8-resilient-by-default) | Resilient by Default | 2 | 9 | P2 — Important |
| [9](#intent-9-secure-by-default) | Secure by Default | 2 | 7 | P0 — Core |
| [10](#intent-10-standards-aligned) | Standards-Aligned | 3 | 27 | P2 — Important |
| | **Total** | **26** | **116** | |

## How to Read This

- **Intents** are foundational — they define *what Photon is*
- **Promises** are specific commitments derived from intents
- **Assertions** are testable statements that validate each promise
- **Targets** indicate where the assertion must hold (CLI, Beam, MCP, Runtime)

Assertions describe supported configurations, not an implicit guarantee that every
adapter implements every feature. A target is validated only by tests exercising
that target. Exposure metadata, configured authentication, and resource availability
remain part of the capability contract. Missing coverage is unvalidated, not a pass.

## How to Use This

- **Adding a feature?** — Which promise does it fulfill?
- **Designing an interface?** — Which intents does it serve?
- **Reviewing a PR?** — Do any promises regress?
- **Planning a release?** — Are all core promises validated?

---

## Intent 1: Single File, Full Stack

*Write one TypeScript file. Get a CLI app, an MCP server, and a web application.*

This is Photon's defining promise. A `.photon.ts` file expresses a **complete
application** as a single class. The same capability can also be loaded into Node
code through Photon's library API; runtime-managed invocation preserves the
capability's validation and execution lifecycle.

### P1.1 — One file, three interfaces

A single `.photon.ts` file produces a working CLI tool, MCP server, and Beam web UI
without any additional files, config, or build step.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | Running `photon <name> <method>` executes the method and prints output | CLI |
| 2 | Connecting via MCP STDIO lists public methods exposed as tools | MCP |
| 3 | Opening Beam shows the photon in the sidebar with its permitted actions | Beam |
| 4 | The same method returns identical data across all three interfaces | All |

### P1.2 — No boilerplate

No decorators, no registration, no server setup. An ordinary public method becomes
a tool by convention; internal/lifecycle methods and HTTP-only endpoints are not
automatically public tools.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | A class with zero imports and one `async` method works as a photon | Runtime |
| 2 | No `tsconfig.json` required | CLI |
| 3 | No `package.json` required in photon directory | CLI |
| 4 | Adding a new method requires only writing the method — no registration | Runtime |

### P1.3 — TypeScript is the only language

JSDoc annotations are the configuration surface. Types are the schema.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | TypeScript return types generate MCP `outputSchema` automatically | MCP |
| 2 | Parameter types generate form fields in Beam | Beam |
| 3 | JSDoc `@param` descriptions appear in CLI help and Beam labels | CLI, Beam |
| 4 | Constraint tags (`@min`, `@max`, `@pattern`) validate on all surfaces | All |

---

## Intent 2: Human + Agent, Same Surface

*The same code serves humans and AI agents equally. No special agent API, no
separate human UI. One method, two audiences.*

### P2.1 — Methods work for both audiences

Methods exposed as tools are available through CLI, MCP, and Beam, subject to
exposure metadata and authorization. Internal methods, lifecycle hooks, and
HTTP-only endpoints have their own ingress rules.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | A human can invoke permitted tool methods via Beam UI without typing JSON | Beam |
| 2 | An agent can invoke the same method via MCP `tools/call` | MCP |
| 3 | CLI `photon <name> <method> --param value` works for scripts and humans | CLI |
| 4 | Output is structured data — renderable for humans, parseable for agents | All |

### P2.2 — Annotations guide both audiences

`@readOnly` and `@destructive` provide intent metadata for human UX and MCP clients.
MCP hosts choose their own approval policy; these hints do not enforce safety or
grant authorization. `@locked` is runtime coordination.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@readOnly` marks MCP tools with `readOnlyHint`; the MCP host controls approval | Beam, MCP |
| 2 | `@destructive` methods show confirmation in Beam, flag in MCP schema | Beam, MCP |
| 3 | `@locked` serializes access — human and agent wait their turn | Runtime |
| 4 | `@auth` requires verified caller context supplied by the configured authentication adapter | Runtime |

### P2.3 — Text-first, always

Every exposed tool method must work as plain text. Visual rendering is progressive enhancement.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | Every method produces readable output in a terminal (no Beam required) | CLI |
| 2 | `@format` tags enhance display but the underlying data is always text/JSON | All |
| 3 | `@ui` custom HTML is optional — removing it doesn't break the method | Beam |

---

## Intent 3: Zero Config

*Install and run. No setup wizard, no config files, no environment prep.
It works on first contact.*

### P3.1 — Instant start

From install to working photon in under 60 seconds.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `bun add -g @portel/photon` → `photon beam` shows working UI | CLI, Beam |
| 2 | No `~/.photon/` directory required before first run | CLI |
| 3 | Marketplace photons are pre-cached or fast-fetched on first boot | Beam |
| 4 | `photon add <name>` → immediately usable, no restart needed | CLI |

### P3.2 — Dependencies resolve themselves

npm packages, CLI tools, MCP servers, other photons — all auto-managed.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@dependencies axios` installs axios on first run without user action | Runtime |
| 2 | `@cli ffmpeg` blocks loading with clear error if ffmpeg is missing | Runtime |
| 3 | `@photon todo` auto-installs from marketplace if not present | Runtime |
| 4 | `@mcp slack` injects MCP client or null if server unavailable | Runtime |

### P3.3 — Configuration from code, not files

Constructor parameters + environment variables. No `.rc` files, no YAML.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | Constructor params auto-map to `PHOTON_NAME_PARAM` env vars | Runtime |
| 2 | Beam shows a settings panel auto-generated from constructor params | Beam |
| 3 | `apiKey` param renders as password field, masked in UI | Beam |
| 4 | Defaults work — a photon with optional params runs without any config | All |

---

## Intent 4: Format-Driven Rendering

*Annotate your output once. Every target renders it appropriately.
One annotation, three surfaces.*

### P4.1 — Formats render on all targets

Every `@format` tag must produce correct output on CLI, Beam, and MCP.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@format table` renders as ASCII table in CLI, HTML table in Beam | CLI, Beam |
| 2 | `@format markdown` renders styled in Beam, formatted in CLI | CLI, Beam |
| 3 | `@format chart:bar` renders interactive chart in Beam, data table in CLI | CLI, Beam |
| 4 | Unknown `@format` falls back gracefully (never silently drops data) | All |

### P4.2 — Auto-UI from signatures

Forms, validation, layouts generated from method signatures and tags.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | A method with `number` param shows numeric input in Beam | Beam |
| 2 | `@min 0 @max 100` enforces range in Beam form AND CLI validation | Beam, CLI |
| 3 | `@choice ["a","b","c"]` renders dropdown in Beam, validates in CLI/MCP | All |
| 4 | Optional params show as non-required fields; required params are enforced | All |

### P4.3 — Custom UI as progressive layer

`@ui` HTML replaces auto-generated view but the method still works without it.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@ui dashboard` loads custom HTML from `<photon>/ui/dashboard.html` | Beam |
| 2 | Removing the `@ui` tag still shows auto-generated result view | Beam |
| 3 | Custom UI receives theme CSS variables from host (light/dark) | Beam |
| 4 | Same method works identically via CLI and MCP without the UI file | CLI, MCP |

---

## Intent 5: Stateful by Annotation

*Add `@stateful` to your class. Get persistence, events, memory, and
cross-client sync — no database, no infra, no wiring.*

### P5.1 — Persistence without infrastructure

State survives restarts with a persistent backend. Memory persists across calls.
Named instances partition state; a shared instance intentionally shares state
among its authorized callers. A named instance is not itself a user or tenant
authorization boundary: access checks and instance routing must enforce that policy.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `this.memory.set(k, v)` persists to disk, survives process restart | Runtime |
| 2 | `@stateful` class state is isolated per named instance | Runtime |
| 3 | `protected settings = {...}` auto-generates settings tool + persists | Runtime |
| 4 | State works identically whether accessed via CLI, Beam, or MCP | All |

### P5.2 — Real-time events with zero wiring (CloudEvents 1.0)

`this.emit()` publishes notifications to subscribed clients. Notifications are
best-effort; durable state is the source of truth. A reconnecting client must
re-read state rather than assume it received every change. Shared-state guarantees
apply to clients addressing the same server, photon, and named instance; separate
processes do not automatically share an in-memory instance.

Beam revalidates the visible result of an explicitly read-only (`@readOnly`)
stateful method every three seconds while online, and when the browser returns
online or becomes visible. It reuses the last submitted arguments and never
replays an undeclared or destructive method as a background refresh. Custom UI
resources manage their own subscriptions/refresh behavior. This is eventual
view convergence, not guaranteed delivery of private events on every MCP era.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `this.emit('update', data)` reaches Beam UI via SSE | Beam |
| 2 | `@stateful` methods auto-emit execution events (method, params, result) | Runtime |
| 3 | Visible read-only Beam views addressing the same instance converge after changes and reconnection | Beam |
| 4 | `this.render()` pushes live output to both CLI and Beam | CLI, Beam |

### P5.3 — Observable by default

Activity log, audit trail, execution history — automatic for stateful photons.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | Beam shows activity log with timestamped method calls | Beam |
| 2 | Returned objects carry `__meta` (non-enumerable) with audit data | Runtime |
| 3 | Execution events include method name, params, result, and timestamp | Runtime |

---

## Intent 6: Composable

*Photons call photons. Small, focused tools compose into complex workflows.*

### P6.1 — Photon-to-photon calls

`@photon` injects other photons as dependencies. `this.call()` invokes them.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@photon todo` injects a working todo instance into constructor | Runtime |
| 2 | `this.call('todo.add', { text })` executes the target method | Runtime |
| 3 | Transitive `@photon` deps auto-resolve from same marketplace source | Runtime |
| 4 | `.on('todo:completed')` receives events from composed photons | Runtime |

### P6.2 — Marketplace as composition layer

Install, compose, extend. The ecosystem is the feature set.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `photon add <name>` works from marketplace or GitHub | CLI |
| 2 | Installed photons appear in Beam sidebar immediately | Beam |
| 3 | `photon search <query>` finds relevant photons | CLI |
| 4 | Private marketplace sources are supported for team-internal photons | CLI |

---

## Intent 7: Portable

*Build once, run anywhere. Standalone binary, edge deployment, containerized.*

### P7.1 — Standalone binary

`photon build` uses Bun to compile a standalone executable for a supported target.
The resulting executable needs no Node.js, npm, or Photon installation. External
CLI tools, MCP servers, credentials, and platform services remain external
dependencies; compilation reports dependencies it cannot bundle.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `photon build <name>` produces executable binary | CLI |
| 2 | Binary runs without Node.js, npm, or Photon installed | Runtime |
| 3 | Bundleable `@dependencies` are included; external dependencies are reported during build | Runtime |
| 4 | Cross-platform targets: macOS ARM/Intel, Linux x64/ARM64 | CLI |

### P7.2 — Deploy anywhere

The same source can target bare metal, Docker, Cloudflare, and AWS Lambda where
its dependencies and runtime features are supported. Validate deployment behavior
on the generated target; local invocation alone does not prove adapter parity.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | Photon works as MCP server in Claude Desktop, ChatGPT, Cursor | MCP |
| 2 | Beam serves the web UI with zero additional infrastructure | Beam |
| 3 | Deployment guides exist for Docker, Cloudflare, Lambda, systemd | Docs |

---

## Intent 8: Resilient by Default

*Methods handle failures gracefully. Retry, timeout, circuit break, rate limit —
all via annotations, no try/catch boilerplate.*

### P8.1 — Middleware from annotations (Resilience4j/Polly vocabulary)

Functional tags compose into a Koa-style middleware pipeline with phase ordering.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@retryable 3` retries failed calls up to 3 times | Runtime |
| 2 | `@timeout 5000` rejects the invocation after 5 seconds; underlying work may continue | Runtime |
| 3 | `@cached 60` memoizes results for 60 seconds | Runtime |
| 4 | `@throttled 10/min` rate-limits to 10 calls per minute | Runtime |
| 5 | `@circuitBreaker 5 30s` fast-rejects after 5 failures, resets after 30s | Runtime |
| 6 | Multiple tags compose: `@retryable 3` + `@timeout 5000` both apply | Runtime |

A timeout bounds the caller's wait; it does not forcibly terminate JavaScript or
roll back side effects. Cancellation is cooperative: supported execution paths
propagate an `AbortSignal`, and application code and dependencies must honor it.
Closing a stream is not proof that all underlying work has stopped. Cancellation,
cleanup, and protection against late state writes require target-specific tests.

### P8.2 — Scheduled and async execution

Background tasks and cron without infrastructure.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@scheduled 0 * * * *` runs method every hour | Runtime |
| 2 | `@async` returns execution ID immediately, runs in background | Runtime |
| 3 | `@webhook` exposes method as HTTP endpoint | Runtime |

---

## Intent 9: Secure by Default

*Authentication, encryption, and access control are built-in primitives,
not afterthoughts.*

### P9.1 — OAuth without boilerplate (MCP OAuth 2.1 / RFC 9728)

Built-in OAuth 2.1 with PKCE, RFC 9728 Protected Resource Metadata, and
`@auth` enforcement from authenticated caller context or supported elicitation.
Authentication adapters establish identity; the loader consumes that context.
Applications must declare the required authorization policy. A shared instance
may be intentionally collaborative; private tenant state requires both isolated
routing/storage and access checks, verified on each advertised transport.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@auth required` enforces authentication on the method | Runtime |
| 2 | `this.caller` provides authenticated identity (id, name, claims) | Runtime |
| 3 | OAuth tokens auto-refresh with 5-minute buffer | Runtime |
| 4 | Token vault uses AES-256 encryption, per-tenant isolation | Runtime |

### P9.2 — Identity-aware coordination

Locks and permissions know who's calling.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@locked` with `@auth` assigns lock to specific caller ID | Runtime |
| 2 | Only the lock holder can execute — others get clear "wait" message | Runtime |
| 3 | Webhook secrets enforce `X-Webhook-Secret` header validation | Runtime |

---

## Intent 10: Standards-Aligned

*Follow established protocols. Don't reinvent what already works.
Adopt standards that enable interoperability without sacrificing simplicity.*

Photon's features align with industry standards where they exist, and stay
custom only where no standard applies or where the Photon-specific design is
genuinely stronger.

### P10.1 -- CloudEvents for event emission

`@stateful` events use the CNCF CloudEvents 1.0 envelope format, making them
consumable by any CloudEvents-aware sink (Kafka, EventBridge, NATS).

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@stateful` method execution emits `specversion: '1.0'` in event payload | Runtime |
| 2 | Events include `id`, `source`, `type`, and `time` fields | Runtime |
| 3 | `source` follows `photon/{name}` format | Runtime |
| 4 | `type` follows `photon.{name}.{method}.executed` format | Runtime |

### P10.2 -- OpenTelemetry for observability

`@async` execution IDs are valid W3C trace IDs. OTel spans carry photon context.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@async` returns a 32-hex-char trace ID compatible with OTel | Runtime |
| 2 | Response includes `_traceparent` in W3C format `00-{traceId}-{spanId}-01` | Runtime |
| 3 | OTel span attributes include `photon.trace_id` when async ID is provided | Runtime |
| 4 | OTel span attributes include `photon.stateful` when the tool is @stateful | Runtime |
| 5 | `parseTraceparent` accepts valid W3C format and rejects malformed/all-zero | Runtime |
| 6 | Tool-call telemetry emitted as OTel metrics (`photon.tool.duration` histogram, `photon.tool.calls`, `photon.tool.errors` counters) | Runtime |
| 7 | Request context available via `AsyncLocalStorage` during tool execution | Runtime |
| 8 | Nested `this.call()` forwards `_meta.traceparent` so child spans chain under the parent trace | Runtime |
| 9 | OTel Logs bridge forwards every `Logger` record when `@opentelemetry/api-logs` is installed, no-op otherwise | Runtime |
| 10 | `initOtelSdk` boots `@opentelemetry/sdk-node` automatically when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; no-op otherwise | Runtime |
| 11 | AG-UI `RUN_ERROR` events carry `code`, `retryable`, `runId`, `threadId` so clients can classify and auto-retry failures | Runtime |
| 12 | AG-UI events include `rawEvent.traceparent` when emitted inside a request context, correlating UI events to OTel spans | Runtime |
| 13 | MCP `initialize` advertises `experimental['ag-ui'].features` (`structured-errors`, `trace-correlation`, `proxy-mode`, `local-mode`) for capability negotiation | Runtime |

### P10.3 -- Established patterns for resilience, auth, and storage

Middleware follows Resilience4j/Polly vocabulary. Auth follows MCP OAuth 2.1.
Memory follows Deno KV minimal surface.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `MemoryBackend` interface includes `list(prefix?)` matching Deno KV surface | Runtime |
| 2 | `MiddlewareContext` includes `caller` for auth-aware custom middleware | Runtime |
| 3 | Circuit breaker state is inspectable via `/api/health/circuits` endpoint | Beam |
| 10 | `/api/health` returns liveness/readiness with per-subsystem status (runtime/photons/circuits) and 503 when any subsystem is degraded | Beam |
| 4 | `formatToolError` classifies `PhotonCircuitOpenError` as `circuit_open` with `retryable: true` | Runtime |
| 5 | `formatToolError` marks `ValidationError` as non-retryable | Runtime |
| 6 | `wrapError` preserves the root cause via `Error.cause` for OTel `recordException` | Runtime |
| 7 | MCP tool error responses include `structuredContent.error` with `type`, `retryable`, `message` so agents can make typed retry decisions | Runtime |
| 8 | `formatToolError` classifies `PhotonRateLimitError` as `rate_limited` with `retryable: true` and a dedicated `photon.rate_limit.rejections` counter is emitted | Runtime |
| 9 | `@bulkhead N` caps concurrent executions per tool at N and throws `PhotonBulkheadFullError` (classified as `bulkhead_full`, retryable, counted as `photon.bulkhead.rejections`) | Runtime |

---

## Validation

Each assertion maps to one of:

- **Visual** — Screenshot + lookout `validate()` (Beam targets)
- **CLI** — Command execution + exit code + output check (CLI targets)
- **MCP** — HTTP/STDIO request + response validation (MCP targets)
- **Runtime** — Unit/integration test (Runtime targets)

Every assertion in this document must be backed by automation before it is treated as launch-safe.

`bun run test:promises` exercises a subset and emits a machine-readable check
inventory (`promise-report.json`). Checks are not mapped one-to-one to assertion
IDs: multiple checks may exercise one assertion, and skipped checks validate
nothing. The inventory is not a completion or validated-coverage percentage.
Assertions outside that subset require dedicated tests before being described as
validated. A test that merely checks command help does not establish successful
execution; errors must fail an execution check, and unavailable prerequisites
must be reported as explicit skips.

The task-board collaboration milestone requires behavioral coverage of a human
and an MCP client reading and changing the same instance, seeing each other's
changes, reconnecting and re-reading consistent state, and preserving persisted
state after restart. Rejected access must leave state unchanged. Where a target
advertises cancellation, cover cooperative cancellation and late-write prevention.
These checks establish the exercised workflow, not general conflict resolution
or exactly-once event delivery.

### Promise Priority

| Priority | Intents | Release gate? |
|----------|---------|---------------|
| P0 — Core | 1, 2, 3, 9 | Yes — blocks release for advertised capabilities |
| P1 — Essential | 4, 5, 6 | Yes — blocks release |
| P2 — Important | 7, 8, 10 | Warning only, except safety guarantees below |

Authorization, tenant/instance isolation, cancellation, and lifecycle correctness
block release wherever the release advertises those guarantees, regardless of
feature priority. An unavailable prerequisite is a skip and leaves the related
guarantee unvalidated; it cannot make a release gate pass. This table is release
policy, not a claim that this single suite enforces every gate automatically.

---

## Evolution

This document evolves with the platform:

1. **New feature** → Must trace to an existing promise or establish a new one
2. **New promise** → Must include testable assertions across relevant targets
3. **Broken promise** → Either fix the code or explicitly retire the promise
4. **Retired promise** → Move to an appendix with rationale

The promises are the stable contract. The implementation changes; the intents endure.
