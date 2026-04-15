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
| [9](#intent-9-secure-by-default) | Secure by Default | 2 | 7 | P2 — Important |
| [10](#intent-10-standards-aligned) | Standards-Aligned | 3 | 24 | P2 — Important |
| | **Total** | **26** | **113** | |

## How to Read This

- **Intents** are foundational — they define *what Photon is*
- **Promises** are specific commitments derived from intents
- **Assertions** are testable statements that validate each promise
- **Targets** indicate where the assertion must hold (CLI, Beam, MCP, Runtime)

## How to Use This

- **Adding a feature?** — Which promise does it fulfill?
- **Designing an interface?** — Which intents does it serve?
- **Reviewing a PR?** — Do any promises regress?
- **Planning a release?** — Are all core promises validated?

---

## Intent 1: Single File, Full Stack

*Write one TypeScript file. Get a CLI app, an MCP server, and a web application.*

This is Photon's defining promise. A `.photon.ts` file is not a library, not a
framework plugin, not a config file. It's a **complete application** expressed as
a single class.

### P1.1 — One file, three interfaces

A single `.photon.ts` file produces a working CLI tool, MCP server, and Beam web UI
without any additional files, config, or build step.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | Running `photon <name> <method>` executes the method and prints output | CLI |
| 2 | Connecting via MCP STDIO lists tools matching public methods | MCP |
| 3 | Opening Beam shows the photon in the sidebar with all methods | Beam |
| 4 | The same method returns identical data across all three interfaces | All |

### P1.2 — No boilerplate

No decorators, no registration, no server setup. A public method is a tool.

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

Every method is simultaneously a CLI command, an MCP tool, and a Beam action.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | A human can invoke any method via Beam UI without typing JSON | Beam |
| 2 | An agent can invoke the same method via MCP `tools/call` | MCP |
| 3 | CLI `photon <name> <method> --param value` works for scripts and humans | CLI |
| 4 | Output is structured data — renderable for humans, parseable for agents | All |

### P2.2 — Annotations guide both audiences

`@readOnly`, `@destructive`, `@locked` inform both human UX and agent behavior.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `@readOnly` methods show no confirmation in Beam, auto-approve in MCP | Beam, MCP |
| 2 | `@destructive` methods show confirmation in Beam, flag in MCP schema | Beam, MCP |
| 3 | `@locked` serializes access — human and agent wait their turn | Runtime |
| 4 | `@auth` identifies the caller whether human (OAuth) or agent (Bearer) | Runtime |

### P2.3 — Text-first, always

Every method must work as plain text. Visual rendering is progressive enhancement.

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
| 1 | `npm i -g @portel/photon` → `photon beam` shows working UI | CLI, Beam |
| 2 | No `~/.photon/` directory required before first run | CLI |
| 3 | Marketplace photons are pre-cached or fast-fetched on first boot | Beam |
| 4 | `photon install <name>` → immediately usable, no restart needed | CLI |

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

State survives restarts. Memory persists across calls. No database required.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `this.memory.set(k, v)` persists to disk, survives process restart | Runtime |
| 2 | `@stateful` class state is isolated per named instance | Runtime |
| 3 | `protected settings = {...}` auto-generates settings tool + persists | Runtime |
| 4 | State works identically whether accessed via CLI, Beam, or MCP | All |

### P5.2 — Real-time events with zero wiring (CloudEvents 1.0)

`this.emit()` fires events that reach every connected client automatically.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `this.emit('update', data)` reaches Beam UI via SSE | Beam |
| 2 | `@stateful` methods auto-emit execution events (method, params, result) | Runtime |
| 3 | Multiple Beam tabs see the same state (cross-client sync) | Beam |
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
| 2 | `this.call('todo', 'add', { text })` executes the target method | Runtime |
| 3 | Transitive `@photon` deps auto-resolve from same marketplace source | Runtime |
| 4 | `.on('todo:completed')` receives events from composed photons | Runtime |

### P6.2 — Marketplace as composition layer

Install, compose, extend. The ecosystem is the feature set.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `photon install <name>` works from marketplace or GitHub | CLI |
| 2 | Installed photons appear in Beam sidebar immediately | Beam |
| 3 | `photon search <query>` finds relevant photons | CLI |
| 4 | Private marketplace sources are supported for team-internal photons | CLI |

---

## Intent 7: Portable

*Build once, run anywhere. Standalone binary, edge deployment, containerized.*

### P7.1 — Standalone binary

`photon build` compiles to a single executable. No runtime dependencies.

| # | Assertion | Target |
|---|-----------|--------|
| 1 | `photon build <name>` produces executable binary | CLI |
| 2 | Binary runs without Node.js, npm, or Photon installed | Runtime |
| 3 | `@dependencies` are bundled into the binary | Runtime |
| 4 | Cross-platform targets: macOS ARM/Intel, Linux x64/ARM64 | CLI |

### P7.2 — Deploy anywhere

Same photon deploys to bare metal, Docker, Cloudflare, AWS Lambda.

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
| 2 | `@timeout 5000` kills execution after 5 seconds | Runtime |
| 3 | `@cached 60` memoizes results for 60 seconds | Runtime |
| 4 | `@throttled 10/min` rate-limits to 10 calls per minute | Runtime |
| 5 | `@circuitBreaker 5 30s` fast-rejects after 5 failures, resets after 30s | Runtime |
| 6 | Multiple tags compose: `@retryable 3` + `@timeout 5000` both apply | Runtime |

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
transport-agnostic `@auth` enforcement via elicitation.

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

`npm run test:promises` validates the current release-gate subset and emits a machine-readable
coverage report (`promise-report.json`) showing which intents are currently exercised by that
suite. Assertions outside that subset must be covered by dedicated tests before they should be
described as validated.

### Promise Priority

| Priority | Intents | Release gate? |
|----------|---------|---------------|
| P0 — Core | 1, 2, 3 | Yes — blocks release |
| P1 — Essential | 4, 5, 6 | Yes — blocks release |
| P2 — Important | 7, 8, 9, 10 | Warning only |

---

## Evolution

This document evolves with the platform:

1. **New feature** → Must trace to an existing promise or establish a new one
2. **New promise** → Must include testable assertions across relevant targets
3. **Broken promise** → Either fix the code or explicitly retire the promise
4. **Retired promise** → Move to an appendix with rationale

The promises are the stable contract. The implementation changes; the intents endure.
