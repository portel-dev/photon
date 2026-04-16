# Lifecycle Hooks & Ingress Model

**Status**: Design approved, implementation in progress (as of 2026-04-17)
**Scope**: Lifecycle hooks for photons, webhook authentication v2, `@scheduled` syntax polish, removal of the `handle*` prefix convention

---

## The organizing principle: ingress and visibility are orthogonal

Every method on a photon has two independent properties:

- **Ingress** — who can trigger this method? (MCP client, webhook HTTP, scheduler, runtime itself)
- **Visibility** — does it appear in the MCP tool list? (yes / no)

Historically these were tangled. The new model treats them as independent axes:

| Ingress | Default visibility | Rationale |
|---|---|---|
| Regular (no tag) | Visible | Default user/LLM-callable method. |
| `@webhook` | **Hidden** | Purpose-built for external HTTP events. Manual MCP invocation is nonsensical. |
| `@scheduled` | Visible | Method does real work; the schedule is one trigger among many. "Run now" is a valid user request. |
| `@internal` | Hidden | Explicit opt-out. Composes with any ingress. |
| Lifecycle (`onStart` etc.) | Hidden | Runtime-only; never user-callable. |

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

Four reserved method names the runtime recognizes. All optional, all async, all implicitly hidden from MCP and CLI.

| Hook | Signature | When it fires | Default timeout |
|---|---|---|---|
| `onStart` | `async onStart(): Promise<void>` | After construction, before first method call | 30s |
| `onStop` | `async onStop(): Promise<void>` | SIGTERM/SIGINT, hot-reload, explicit unload | 10s |
| `onReload` | `async onReload(): Promise<void>` | Hot reload (if present, replaces stop+start for the reload path) | 30s |
| `onError` | `async onError(err, ctx): Promise<void>` | Any method throws (observability only; does not suppress) | 5s |

### Firing rules

- **Beam** (long-lived daemon): `onStart` eagerly on photon load. `onStop` on shutdown, unload, hot-reload (unless `onReload` is defined).
- **CLI** (one-shot): `onStart` lazily before the single invocation. `onStop` after the method returns, before process exit.
- **STDIO MCP** (per-client session): same as Beam but scoped to the session lifetime.

### Ordering with `@photon` dependencies

- `onStart` fires in dependency order: if A depends on B, B starts first.
- `onStop` fires in reverse: A stops first, then B.
- If any `onStart` fails or times out, dependents fail to load with a clear error surfacing the chain.

### Failure behavior

- `onStart` throws → photon fails to load. Error surfaces to the caller trying to use it.
- `onStop` throws or exceeds timeout → logged and skipped; never blocks other photons' cleanup or process exit.
- `onError` throws → swallowed (an observability handler should never cascade).

### Example

```ts
import { Photon } from '@portel/photon-core';
import { MongoClient } from 'mongodb';

class TodoPhoton extends Photon {
  private db!: MongoClient;

  async onStart() {
    this.db = new MongoClient(process.env.MONGO_URL!);
    await this.db.connect();
  }

  async onStop() {
    await this.db.close();
  }

  async add(task: string) {
    await this.db.db('todos').collection('tasks').insertOne({ task });
    return { ok: true };
  }
}
```

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
| Lifecycle hooks added | Additive | Use the new methods when needed. |
| `@webhook` hidden from MCP | Behavioral | Intentional; no migration needed unless you relied on MCP-calling a webhook method. |
| Per-method `@webhook-auth` | Additive | Global `PHOTON_WEBHOOK_SECRET` still works. |
| `handle*` → `@webhook` | Breaking (one-minor warning window) | Add `@webhook` to each `handle*` method. |
| `@cron` → `@scheduled` | Soft-deprecated (alias preserved) | Rename at your convenience. |
| `@scheduled` syntax broadened | Additive | Existing cron expressions unaffected. |

---

## 5. Open questions (round 2)

- **Class-level default `@webhook-auth`**: override per method. Useful for Stripe-only photons.
- **IP allowlist** (`@webhook-source <cidr>`): for providers that publish source ranges.
- **`onIdle` / `onResume`**: release resources after N seconds idle.
- **State/settings hooks**: `onStateLoad`, `onStateSave`, `onSettingsChange`.
- **Webhook response schema enforcement**: pass-through today; may want opinionated shape later.

---

## 6. Related docs

- [`WEBHOOKS.md`](../reference/WEBHOOKS.md) — user-facing webhook guide (will be updated when implementation lands)
- [`DOCBLOCK-TAGS.md`](../reference/DOCBLOCK-TAGS.md) — tag reference (will list new tags when implementation lands)
- [`CONSTRUCTOR-INJECTION.md`](CONSTRUCTOR-INJECTION.md) — complements lifecycle hooks for async setup
