# Photon Injection Model — Three Ways to Author a Photon

A photon is a single TypeScript class. The runtime needs to give that class access to memory, scheduling, emit, cross-photon calls, MCP, Cloudflare bindings, and more. There are three ways the class can receive those capabilities, and you pick the one that matches your situation. Same API, same behavior — only the access path differs.

The author chooses based on a single question: **does my class already have a base class?**

| Your situation | Pick this |
|---|---|
| New class, no other base | `extends Photon` (most idiomatic) **or** inject — your call |
| Class already extends something else (third-party SDK base, framework class) | Inject `Photon` as a constructor param |
| Need direct Cloudflare access | Add `Cloudflare` (or `CloudflareEnv`) as a separate constructor param |

The **import line is the contract.** A photon that imports `Cloudflare` from `@portel/photon` declares that it depends on a Cloudflare deploy target. Outside CF, the loader injects a throwing Proxy whose error message names the imported symbol — the diagnostic is unambiguous. A portable photon imports only `Photon` (or extends it) and runs anywhere: CLI, MCP, Beam, deployed Worker, future runtimes.

## Mode 1 — `extends Photon`

The classic shape. Capabilities show up on `this`.

```typescript
import { Photon } from '@portel/photon';

export default class Notes extends Photon {
  /** Save a quick note. @param text The note content. */
  async add(p: { text: string }) {
    await this.memory.set(`note:${Date.now()}`, p.text);
    this.emit({ status: 'saved', text: p.text });
    return { saved: p.text };
  }
}
```

What you get on `this`: `memory`, `schedule`, `emit`, `render`, `ask`, `confirm`, `elicit`, `sample`, `call`, `mcp(name)`, `caller`, `roots`, `photon.use(name)`. Plus `env` and `mcpAuthed` when running on a deployed Cloudflare Worker.

Use this when you don't already have a base class. It's the shortest path from blank file to working photon.

## Mode 2 — Inject `Photon`

A photon doesn't have to extend anything. If you'd rather use composition (or you already extend something else), declare a constructor parameter typed `Photon` and the runtime injects an instance configured for *your* photon's name and scope.

```typescript
import type { Photon } from '@portel/photon';

export default class Notes {
  constructor(private photon: Photon) {}

  async add(p: { text: string }) {
    await this.photon.memory.set(`note:${Date.now()}`, p.text);
    this.photon.emit({ status: 'saved', text: p.text });
    return { saved: p.text };
  }
}
```

The injected `Photon` is the same shape as the base class. `this.photon.memory` writes to the same scope `this.memory` would have written to under `extends Photon` — same photon name, same `_baseDir`, same `_callHandler`, same `_photonResolver`. Switching between modes is purely cosmetic.

You can also extend an unrelated base class and still get Photon capabilities:

```typescript
import type { Photon } from '@portel/photon';
import { SomeThirdPartyBase } from 'some-sdk';

export default class Notes extends SomeThirdPartyBase {
  constructor(private photon: Photon) {
    super();
  }

  async add(p: { text: string }) {
    await this.photon.memory.set(`note:${Date.now()}`, p.text);
    return this.someThirdPartyMethod(p.text);
  }
}
```

The runtime detects the typed parameter (`private photon: Photon`) and supplies the value at construction time. No decorators, no factories.

## Mode 3 — Inject Cloudflare

The previous two modes work on every deploy target. CF-specific resources (KV, R2, D1, Queues, Vectorize, Workers AI, Images, Browser Rendering) live behind a separate, optional injection so a portable photon stays portable.

### `Cloudflare` — wrapped, auto-named

```typescript
import type { Photon, Cloudflare } from '@portel/photon';

export default class Gallery {
  constructor(
    private photon: Photon,
    private cf: Cloudflare,
  ) {}

  async upload(p: { name: string; bytes: string }) {
    await this.cf.r2().put(p.name, p.bytes);
    await this.photon.memory.set(`recent:${Date.now()}`, p.name);
    return { uploaded: p.name };
  }
}
```

Auto-naming derives binding names from the photon name + an optional qualifier:

| Call | Resolves to binding |
|---|---|
| `cf.kv()` | `gallery_kv` |
| `cf.kv('cache')` | `gallery_cache_kv` |
| `cf.r2()` | `gallery_r2` |
| `cf.r2('archive')` | `gallery_archive_r2` |
| `cf.d1()` | `gallery_d1` |
| `cf.queue('uploads')` | `gallery_uploads_queue` |
| `cf.ai`, `cf.images`, `cf.browser` | shared `AI`, `IMAGES`, `BROWSER` (one per Worker) |

The convention is the **single source of truth.** The same naming feeds:

- the local miniflare sandbox seed names,
- the `wrangler.toml` the deploy emits,
- the Worker's runtime lookup against `env`.

You never pick global binding names; collisions across photons are impossible by construction.

### `CloudflareEnv<T>` — raw escape hatch

When you need direct access to the Worker `env` (service bindings, exotic features, anything not wrapped by `Cloudflare`):

```typescript
import type { CloudflareEnv } from '@portel/photon';

interface Env {
  STRIPE_KEY: string;
  MY_SERVICE: Fetcher;
}

export default class Webhooks {
  constructor(private env: CloudflareEnv<Env>) {}

  async charge(p: { amount: number }) {
    return fetch('https://api.stripe.com/v1/charges', {
      headers: { Authorization: `Bearer ${this.env.STRIPE_KEY}` },
      method: 'POST',
      body: new URLSearchParams({ amount: String(p.amount) }),
    });
  }
}
```

The default `CloudflareEnv = Record<string, unknown>` works too if you don't want to type bindings explicitly.

## Forgiving authoring — `this.cf` on plain classes

Authors don't always remember the import + ctor param ceremony. The loader scans every photon's source. If it sees `this.cf.kv(...)` (or any `this.cf.*` member) on a class that didn't declare a `Cloudflare` constructor parameter, it auto-injects the field after construction. Nothing is logged in green; the photon just works.

```typescript
// No constructor param. No import. Still works.
export default class Quick {
  async ping() {
    await this.cf.kv().put('hit', String(Date.now()));
    return { ok: true };
  }
}
```

The same auto-inject covers `this.cfEnv`. This is the same mechanism the loader uses for `this.memory` / `this.emit` / `this.call` etc. on plain classes — capability detection by source pattern. Use the explicit injection when you want strict typing; fall back to the loose form when you're sketching.

## Override layer — `protected cfBindings`

`protected cfBindings = { ... }` is now a *pure override layer.* It's optional. Use it only when you need to repoint a specific qualifier at a pre-existing CF resource you don't want auto-created:

```typescript
import type { Photon, Cloudflare } from '@portel/photon';

export default class Gallery {
  protected cfBindings = {
    // The default cf.r2() points at the org-shared bucket, not gallery_r2
    r2: { default: 'org-shared-photos' },
    // cf.d1() points at a real CF D1 with a known UUID
    d1: { default: { name: 'gallery-prod', id: 'abcd-1234-...' } },
  };

  constructor(
    private photon: Photon,
    private cf: Cloudflare,
  ) {}

  async upload(p: { name: string; bytes: string }) {
    await this.cf.r2().put(p.name, p.bytes);   // → org-shared-photos
    await this.cf.d1().exec('SELECT 1');        // → gallery-prod
  }
}
```

The override key is the qualifier (use `default` for the no-arg call, or the literal qualifier string like `'cache'`). The override value is the resource id (or `{ name, id }` for D1).

The same shape can be supplied via `photon cf set <photon> <category>.<qualifier> <resource>` from the CLI without touching photon source. CLI overrides land in `<baseDir>/.data/cf-overrides/<photon>.json` and layer on top of source-declared overrides.

## What runs where

| Mode | CLI | MCP STDIO | Beam | Deployed CF Worker |
|---|---|---|---|---|
| `extends Photon` | ✅ | ✅ | ✅ | ✅ |
| Inject `Photon` | ✅ | ✅ | ✅ | ✅ |
| Inject `Cloudflare` | ⚠️ miniflare sandbox | ⚠️ miniflare sandbox | ⚠️ miniflare sandbox | ✅ real bindings |
| Inject `CloudflareEnv` | ⚠️ throws on access | ⚠️ throws on access | ⚠️ throws on access | ✅ real env |

Photons that import `Cloudflare` run locally under a miniflare-backed sandbox so you can test without deploying. Photons that import `CloudflareEnv` (the raw escape hatch) only work where a real CF env is attached — the throwing-Proxy fallback names the imported symbol so the failure mode is loud, not silent.

## Choosing between modes

- **Default to `extends Photon`** if it's a new class. Shortest path.
- **Inject `Photon`** if you already extend something, prefer composition for testability, or want to inject a stub `Photon` in unit tests.
- **Add `Cloudflare`** when the photon legitimately depends on CF resources. The import line documents the deploy-target dependency.
- **Add `CloudflareEnv`** only for the 5% of cases the wrapped surface doesn't cover (service bindings, exotic CF features). Mixing `Cloudflare` and `CloudflareEnv` in one constructor is fine.

The framework treats all four as equally valid. There's no "preferred" mode — ergonomics drive the choice, not policy.
