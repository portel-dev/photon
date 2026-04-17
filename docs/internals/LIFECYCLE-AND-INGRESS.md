# Lifecycle Hooks & Ingress Model

**Status**: Design approved, implementation in progress (as of 2026-04-17)
**Scope**: One new lifecycle hook (`onError`) built on the existing `onInitialize`/`onShutdown` foundation plus a consistency fix to the Beam hot-reload path, webhook authentication v2, `@scheduled` syntax polish, removal of the `handle*` prefix convention

---

## The organizing principle: ingress and visibility are orthogonal

Every method on a photon has two independent properties:

- **Ingress** — who can trigger this method? (MCP client, webhook HTTP, scheduler, runtime itself)
- **Visibility** — does it appear in the MCP tool list? (yes / no)

The new model treats them as independent axes:

| Ingress | Default visibility | Rationale |
|---|---|---|
| Regular (no tag) | Visible | Default user/LLM-callable method. |
| `@webhook` | **Hidden** | Purpose-built for external HTTP events. Manual MCP invocation is nonsensical. |
| `@scheduled` | Visible | Method does real work; the schedule is one trigger among many. "Run now" is a valid user request. |
| `@internal` | Hidden | Explicit opt-out. Composes with any ingress. |
| Lifecycle hooks | Hidden | Runtime-only; never user-callable. |

Composition is explicit:

```ts
/**
 * Scheduled hidden-from-MCP cleanup (runs only on schedule).
 * @scheduled 0 0 * * *
 * @internal
 */
async nightlyCleanup() { ... }
```

---

## 1. Lifecycle hooks

### 1.1 Existing hooks (already shipped)

Photons already have two lifecycle hooks that this design **does not change**:

| Hook | Signature | When it fires |
|---|---|---|
| `onInitialize` | `async onInitialize(): Promise<void>` | After construction, before first method call |
| `onShutdown` | `async onShutdown(): Promise<void>` | SIGTERM/SIGINT drain, hot-reload (old instance), explicit unload |

Already wired end-to-end:
- Both loaders call `onInitialize` after instance construction and dependency injection.
- `onShutdown` is invoked on session teardown (`src/server.ts:2742`) and before hot-reload of the old instance (`src/server.ts:2897`).
- Daemon `SIGTERM`/`SIGINT` handler drains all session managers, which invoke `onShutdown` on every loaded photon (`src/daemon/server.ts:3870`, `:4034`).
- Method list extractor excludes both from MCP advertisement.
- Photon templates scaffold both by default.
- Worker-thread auto-detection places photons with both hooks into worker threads so the host process is protected from blocking cleanup.

Because this foundation already exists, no renaming or migration is part of this design.

### 1.2 New hook: `onError`

One genuinely new hook. Optional, async, hidden from MCP and CLI.

| Hook | Signature | When it fires | Default timeout |
|---|---|---|---|
| `onError` | `async onError(err: unknown, ctx: { tool: string; params: any }): Promise<void>` | Any tool method throws (observability only; cannot suppress) | 5s |

`onError` provides a single handler for author-side observability (metrics, logging, alerts, custom reporting) without wrapping every method in try/catch. Wired into `photon-core/src/base.ts` `executeTool`, so every invocation path (CLI, daemon, lite loader, MCP, webhook dispatch) picks it up for free.

Contract:
- Runs **after** the error is captured, **before** the error is re-thrown to the caller.
- Cannot suppress or transform the error — `throw` from `onError`, or a return value, is ignored.
- A throw or timeout inside `onError` is logged and swallowed; observability code never cascades into the request path.
- Default timeout: 5s.

### 1.3 State preservation across hot reload (already shipped, now consistent)

Original design notes here proposed a new `onReload` hook for state-preserving reload. Investigation revealed the state-transfer mechanism already exists via context parameters on the existing hooks:

```ts
async onInitialize?(ctx?: { reason?: string; oldInstance?: any }): Promise<void>;
async onShutdown?(ctx?: { reason?: string }): Promise<void>;
```

- `onShutdown({ reason: 'hot-reload' })` — old instance can skip destructive cleanup of resources the new instance will reuse.
- `onInitialize({ reason: 'hot-reload', oldInstance })` — new instance pulls non-copyable resources (sockets, timers, DB connections) from the old. In-memory non-function properties are also auto-copied by the runtime.

This pattern was already correctly wired in the **daemon** hot-reload path (`src/daemon/server.ts:3665-3700`) but not in the **Beam server** hot-reload path (`src/server.ts`). The latter is now fixed to match. A new `onReload` hook is not needed — the existing API already covers the use case, and making the Beam path consistent is the real round-1 work.

### 1.3 Ordering with `@photon` dependencies

`onInitialize` already fires in dependency-first order naturally, because `@photon` dependencies are constructed recursively before the dependent's construction completes. The new hooks inherit this:

- `onInitialize` fires in dependency order (deps first).
- `onShutdown` fires in reverse (dependents first).

If any `onInitialize` fails or times out, dependents fail to load. The existing `PhotonInitializationError` surfaces this.

### 1.4 Loader-lite gap

`photon-loader-lite.ts` (the programmatic `photon()` API) calls `onInitialize` but does not call `onShutdown`. In the lite path the caller owns the instance lifecycle, so this is arguably correct for programmatic use. This design surfaces the gap; a decision on whether lite should expose an explicit `dispose` or match the full loader is tracked as an open question (section 5).

---

## 2. Webhooks v2

### 2.1 `@webhook` methods are hidden from the MCP tool list

A method marked `@webhook` is registered only as an HTTP endpoint. It does not appear as an MCP tool. It remains reachable by:

- `POST /webhook/{photonName}/{method}` (the existing daemon endpoint)
- The CLI testing command (section 2.4)
- `this.call()` from other photons (internal trust)

### 2.2 Per-service authentication

A new tag co-locates authentication with the method:

```
@webhook-auth <scheme> <header> <secret-ref>
```

`<secret-ref>` is `env:VAR_NAME` or `settings:key`. Built-in schemes:

| Scheme | Verification | Typical providers |
|---|---|---|
| `stripe` | HMAC-SHA256 over `{timestamp}.{body}`, 5-minute tolerance | Stripe |
| `github-sha256` | HMAC-SHA256 of raw body, `sha256=` prefix | GitHub |
| `github-sha1` | HMAC-SHA1, `sha1=` prefix | GitHub (legacy) |
| `slack` | HMAC-SHA256 over `v0:{timestamp}:{body}`, 5-minute tolerance | Slack |
| `twilio` | HMAC-SHA1 over `{url}{sortedParams}` | Twilio |
| `hmac-sha256` | Generic HMAC-SHA256 of raw body | Custom services |
| `hmac-sha1` | Generic HMAC-SHA1 of raw body | Legacy custom |
| `bearer` | `Authorization: Bearer <secret>` exact match | OAuth-ish |
| `shared-secret` | Header value exact match (timing-safe) | Current behavior |
| `none` | No verification | Public forms, IP-restricted internal |

Examples:

```ts
/**
 * @webhook stripe/events
 * @webhook-auth stripe Stripe-Signature env:STRIPE_WEBHOOK_SECRET
 */
async handleStripe(body: any) { ... }

/**
 * @webhook github/push
 * @webhook-auth github-sha256 X-Hub-Signature-256 env:GH_WEBHOOK_SECRET
 */
async onPush(body: any) { ... }

/**
 * @webhook public-form
 * @webhook-auth none
 */
async handleForm(body: any) { ... }
```

The runtime verifies the signature at the HTTP edge. Handlers never see unauthenticated requests.

### 2.3 Raw body access

HMAC verification is performed against the exact bytes received, before JSON parsing. The `_webhook` metadata object gains `raw: Buffer` for handlers that need the original bytes (rare, but some providers require it for custom checks).

### 2.4 CLI testing support

```bash
# Fire a webhook against a local daemon
photon webhook forms handleSubmission --body @sample.json

# Compute and attach a Stripe-style signature
photon webhook stripe handleStripe --body @event.json --sign stripe --secret env:STRIPE_WEBHOOK_SECRET

# Generic HMAC with custom header
photon webhook my handler --body '{"x":1}' --sign hmac-sha256 --header X-Signature --secret env:MY_SECRET

# Dry-run: print the equivalent curl command without sending
photon webhook forms handleSubmission --body @sample.json --dry-run
```

The CLI uses the same verifier code paths as the server, so a passing `photon webhook` run guarantees the live endpoint would accept the same request.

### 2.5 Global fallback

`PHOTON_WEBHOOK_SECRET` continues to work as a coarse dev-mode fallback when a method has no `@webhook-auth` tag. Prefer per-method auth for production.

### 2.6 Removal of the `handle*` prefix convention

Methods named `handle*` no longer auto-register as webhooks. `@webhook` is the only declaration path. The runtime emits a one-time warning for one minor release before the warning goes silent. Migration: add `@webhook` to each `handle*` method.

---

## 3. `@scheduled` syntax

### 3.1 Canonical tag

`@scheduled` remains the canonical tag (consistent with `@locked`, `@stateful`). `@cron` is soft-deprecated: the alias continues to work but emits a load-time warning. The alias is removed in the next major version.

### 3.2 Broadened argument syntax

```
@scheduled 0 * * * *                   # cron (canonical for complex schedules)
@scheduled every 5 minutes             # interval
@scheduled every 2 hours
@scheduled daily at 9am                # natural
@scheduled daily at 09:00
@scheduled weekly on monday at 8am
@scheduled at 2026-05-01T00:00:00Z     # one-shot, fires once
```

Cron remains the most expressive; interval and natural forms exist for readability on common cases.

---

## 4. Migration summary

| Change | Severity | Path |
|---|---|---|
| `onError` hook | Additive | Opt-in; define the method if you want observability. |
| Beam hot-reload context | Bug fix | Already-documented `{ reason, oldInstance }` context now flows through the Beam path (already flowed through the daemon path). |
| `@webhook` hidden from MCP | Behavioral | Intentional; no migration needed unless you relied on MCP-calling a webhook method. |
| Per-method `@webhook-auth` | Additive | Global `PHOTON_WEBHOOK_SECRET` still works. |
| `handle*` → `@webhook` | Breaking (one-minor warning window) | Add `@webhook` to each `handle*` method. |
| `@cron` → `@scheduled` | Soft-deprecated (alias preserved) | Rename at your convenience. |
| `@scheduled` syntax broadened | Additive | Existing cron expressions unaffected. |

Existing `onInitialize`/`onShutdown` behavior is unchanged.

---

## 5. Open questions (round 2)

- **Class-level default `@webhook-auth`**: override per method. Useful for Stripe-only photons.
- **IP allowlist** (`@webhook-source <cidr>`): for providers that publish source ranges.
- **Loader-lite shutdown**: should `photon-loader-lite.ts` expose an explicit `dispose` that invokes `onShutdown`, or keep the "caller owns lifecycle" contract?
- **State/settings hooks**: `onStateLoad`, `onStateSave`, `onSettingsChange`.
- **Webhook response schema enforcement**: pass-through today; may want opinionated shape later.

---

## 6. Implementation order

1. `onError` hook + Beam hot-reload context fix (smallest blast radius, independent)
2. `@webhook` → MCP-list exclusion in `photon-doc-extractor.ts`
3. Raw body + per-service `@webhook-auth` verifiers
4. `photon webhook ...` CLI testing command
5. `@scheduled` syntax broadening + `@cron` deprecation warning
6. `handle*` prefix removal with deprecation warning
7. Docs pass (update `WEBHOOKS.md`, `DOCBLOCK-TAGS.md`, `GUIDE.md`, skill references)

Each step is shippable independently.

---

## 7. Related docs

- [`GUIDE.md`](../GUIDE.md) — covers existing `onInitialize`/`onShutdown` usage
- [`guides/ADVANCED.md`](../guides/ADVANCED.md) — lifecycle patterns and worker-thread placement
- [`WEBHOOKS.md`](../reference/WEBHOOKS.md) — user-facing webhook guide (will be updated when implementation lands)
- [`DOCBLOCK-TAGS.md`](../reference/DOCBLOCK-TAGS.md) — tag reference (will list new tags when implementation lands)
- [`CONSTRUCTOR-INJECTION.md`](CONSTRUCTOR-INJECTION.md) — complements lifecycle hooks for async setup
