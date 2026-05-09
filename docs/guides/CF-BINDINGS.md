# Cloudflare Bindings — `Cloudflare` injection

Photons reach Cloudflare resources (KV, R2, D1, Queues, Vectorize, Workers AI, Images, Browser Rendering) through a single injected dependency: `Cloudflare`. The same code runs locally against a miniflare sandbox and on a deployed Worker against real bindings.

For the broader picture of how a photon receives any runtime capability — see [PHOTON-INJECTION.md](PHOTON-INJECTION.md). This guide focuses on the CF specifics: auto-naming, override layer, deploy autogen, escape hatch.

## Quick start

```typescript
import type { Photon, Cloudflare } from '@portel/photon';

export default class Gallery {
  constructor(
    private photon: Photon,
    private cf: Cloudflare,
  ) {}

  /** Save a blob and record it. @param name Object key. @param bytes Blob body. */
  async upload(p: { name: string; bytes: string }) {
    await this.cf.r2().put(p.name, p.bytes);
    await this.cf.d1().exec(
      'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT)',
    );
    await this.cf.d1().prepare('INSERT INTO items (name) VALUES (?)').bind(p.name).run();
    await this.photon.memory.set('last', p.name);
    return { uploaded: p.name };
  }
}
```

Run locally — miniflare sandbox boots on first access, persists under `<baseDir>/.data/cf-sandbox/gallery/`:

```bash
photon cli gallery upload --name 1.jpg --bytes "blob"
```

Deploy with the same source. `photon host deploy cloudflare gallery` autogenerates the matching `wrangler.toml` bindings:

```bash
photon host deploy cloudflare gallery
```

No `wrangler.toml` to write by hand. No binding names to invent.

## Auto-naming

`Cloudflare` derives binding names from the photon name + an optional qualifier. The convention lives in one place (`bindingNameFor` in `@portel/photon-core`) and feeds the local sandbox seed list, the deploy-time `wrangler.toml` emission, and the runtime lookup on the deployed Worker — so binding names always line up across runtimes.

| Call | Binding name |
|---|---|
| `cf.kv()` | `<photon>_kv` |
| `cf.kv('cache')` | `<photon>_cache_kv` |
| `cf.r2()` | `<photon>_r2` |
| `cf.r2('archive')` | `<photon>_archive_r2` |
| `cf.d1()` | `<photon>_d1` |
| `cf.queue()` | `<photon>_queue` |
| `cf.queue('uploads')` | `<photon>_uploads_queue` |
| `cf.vectorize()` | `<photon>_vectorize` |
| `cf.vectorize('embeddings')` | `<photon>_embeddings_vectorize` |
| `cf.ai`, `cf.images`, `cf.browser` | shared `AI`, `IMAGES`, `BROWSER` (single binding per Worker) |

Photon names with hyphens are normalized to underscores so the result is wrangler-legal (e.g. `my-photon` → `my_photon_kv`).

### Qualifier discovery

The runtime needs to know up front which qualifiers a photon will use — both miniflare and `wrangler.toml` require every binding declared at boot. A source scanner walks the photon's TypeScript and collects every literal qualifier passed to `cf.kv(...)`, `cf.r2(...)`, etc.

This means: **literal qualifiers are discovered automatically.** Dynamic qualifiers (`cf.kv(this.tenantId)`) only get the default binding seeded; if you genuinely need to fan out per request, list the qualifiers as overrides (see below) so the deploy emits all the bindings.

## Constructor injection vs. forgiving auto-inject

The explicit form documents the dependency:

```typescript
constructor(private cf: Cloudflare) {}
// ... this.cf.kv()
```

The forgiving form skips the ceremony. If the loader sees `this.cf.*` on a plain class without a typed constructor parameter, it auto-injects after construction:

```typescript
// No import. No ctor param. The loader fills it in.
export default class Quick {
  async ping() {
    await this.cf.kv().put('hit', String(Date.now()));
    return { ok: true };
  }
}
```

Both produce identical runtime behavior. The explicit form is what you want for testability and strict typing; the forgiving form is for sketching. See [PHOTON-INJECTION.md](PHOTON-INJECTION.md) for the full picture.

## Override layer — `protected cfBindings`

The auto-naming convention covers the common case. When you need to repoint a binding at a pre-existing CF resource (a shared bucket, a real D1 with a known UUID, an existing KV namespace), declare an override on the class:

```typescript
export default class Gallery {
  protected cfBindings = {
    // Default cf.r2() now points at an org-shared bucket
    r2: { default: 'org-shared-photos' },
    // Qualified cf.r2('cold') points at a separate bucket
    r2: { cold: 'gallery-archive' },
    // cf.d1() points at a real CF database with explicit name + id
    d1: { default: { name: 'gallery-prod', id: 'abcd-1234-...' } },
    // Shared toggles still work (auto-derived from usage; only set
    // here if you want to force-enable when source doesn't reference)
    ai: true,
  };

  constructor(private cf: Cloudflare) {}
}
```

Override schema:

| Category | Key | Value |
|---|---|---|
| `kv`, `r2`, `queue`, `vectorize` | qualifier (`'default'` for no-arg, otherwise the literal string) | resource name (string) |
| `d1` | qualifier | `string` (when `name == id`) **or** `{ name, id }` (production CF accounts where `database_id` is a UUID) |
| `ai`, `images`, `browser` | — | `true` to force-enable even if source doesn't reference |

`protected cfBindings` is **optional.** Most photons don't need it — the auto-naming convention covers the common case.

### CLI override (no source change)

`photon cf set` writes a parallel override at `<baseDir>/.data/cf-overrides/<photon>.json` that layers on top of source-declared overrides:

```bash
photon cf set gallery r2.default org-shared-photos
photon cf set gallery d1.default '{"name":"gallery-prod","id":"abcd-1234"}'
photon cf bindings gallery        # show effective bindings
photon cf reset gallery           # clear the JSON override
```

Source-declared overrides + JSON overrides flow into both the local runtime *and* the deploy-time `wrangler.toml` autogen, so a `set` immediately reshapes the next `photon host deploy cloudflare`.

## Deploy

`photon host deploy cloudflare <photon>` reads the host photon and any sibling `@photons` it depends on, runs each through the source scanner + override layer, and emits a single `wrangler.toml`. Each photon contributes its own auto-named bindings, namespaced by photon name so siblings can't collide.

```bash
photon host deploy cloudflare gallery
# Generated wrangler.toml fragment:
#   [[r2_buckets]]
#   binding = "gallery_r2"
#   bucket_name = "org-shared-photos"
#
#   [[d1_databases]]
#   binding = "gallery_d1"
#   database_name = "gallery-prod"
#   database_id   = "abcd-1234-..."
#
#   [ai]
#   binding = "AI"
```

Resource ids default to the binding name when no override is set — that's enough for `wrangler d1 create` preflows and for the local miniflare sandbox. Production deployments that reuse existing CF resources should set explicit overrides (per the schema above) so the deployed Worker points at the right place.

### Auth: `PHOTON_MCP_BEARER`

The deployed Worker enforces a transport-level bearer check on `/mcp` when `PHOTON_MCP_BEARER` is set as a Worker secret. `tools/call` requires `Authorization: Bearer <secret>` (timing-safe compare); `tools/list`, `initialize`, `ping`, and `notifications/*` stay unauthed so MCP clients can complete their handshake. Mismatch returns `401` with `WWW-Authenticate: Bearer realm="photon"`. Unset secret = open access (back-compat).

Inside a tool method, `this.mcpAuthed` reflects whether the active call passed the bearer gate — guard sensitive methods like:

```typescript
async deleteAll() {
  if (!this.mcpAuthed) throw new Error('unauthorized');
  // ...
}
```

`this.mcpAuthed` is scoped to the active tool call via `AsyncLocalStorage`, so concurrent calls each see their own value.

## Escape hatch — `CloudflareEnv`

For the 5% of cases the wrapped surface doesn't cover (service bindings, exotic CF features, secrets that don't fit the binding model), inject the raw env:

```typescript
import type { CloudflareEnv } from '@portel/photon';

interface Env {
  STRIPE_KEY: string;
  ORDERS_QUEUE: Queue;
}

export default class Checkout {
  constructor(private env: CloudflareEnv<Env>) {}

  async charge(p: { amount: number }) {
    await this.env.ORDERS_QUEUE.send({ amount: p.amount });
    return fetch('https://api.stripe.com/v1/charges', {
      headers: { Authorization: `Bearer ${this.env.STRIPE_KEY}` },
      // ...
    });
  }
}
```

`CloudflareEnv<T>` is a generic. The default `CloudflareEnv = Record<string, unknown>` works without an explicit type. Mixing `Cloudflare` and `CloudflareEnv` in one constructor is fine — they reach the same underlying env.

## Local sandbox — what miniflare seeds

When a photon imports `Cloudflare` (or uses `this.cf.*`), the loader boots a miniflare instance scoped to the photon name. State persists under `<baseDir>/.data/cf-sandbox/<photon>/`:

```
<baseDir>/.data/cf-sandbox/
├── gallery/
│   ├── kv/
│   ├── r2/
│   └── d1/
└── notes/
    └── kv/
```

Each photon gets its own sandbox; data doesn't leak between photons. Restart the runtime and the data survives.

Browser Rendering is currently deferred locally (it requires a Chromium dep we haven't wanted to pull into the runtime); the deployed Worker handles it natively.

## When `cf.*` throws

| Scenario | What you see |
|---|---|
| Photon outside CF, no factory configured | `cf.kv() called but no CF runtime is attached. Run via 'photon host run' (miniflare-backed) or deploy with 'photon host deploy cloudflare'.` |
| Photon imports `CloudflareEnv` but no env attached | `CloudflareEnv.<key> accessed but no CF env was attached.` (Throwing Proxy.) |
| Qualifier not seeded (boot scanner missed it) | `cf.kv('foo') resolves to binding "<photon>_foo_kv", which the runtime did not seed. Either reference this binding with a literal qualifier somewhere in your photon source, or add a "kv" override to protected cfBindings.` |
| Deployed Worker, binding missing from env | `cf.kv() requires binding "<photon>_kv" on the Worker env, but it is not defined. Add it to wrangler.toml (or run 'photon host deploy cloudflare').` |

Diagnostic messages always name the imported symbol and point at the next concrete action.

## Migrating from the legacy shape

The pre-1.30 shape required `protected cfBindings` and used binding names directly: `cf.kv('cache')` looked up a binding literally named `cache`. The new shape derives binding names from the photon name; `cf.kv('cache')` resolves to `<photon>_cache_kv`.

For most photons the migration is mechanical:

| Before | After |
|---|---|
| `protected cfBindings = { kv: { cache: 'cache-id' } }` | (delete — auto-derived) |
| `this.cf.kv('cache')` | `this.cf.kv('cache')` (same surface, auto-resolved) |

If you depended on a specific binding NAME (e.g. integrating with an existing wrangler.toml outside the photon), declare an override:

```typescript
protected cfBindings = {
  kv: { cache: 'my-pre-existing-namespace-id' },
};
```

## Schema and migrations (D1)

Photon does not own SQL DDL or migrations — it gives you the binding and stays out of your way. Three patterns work today, ordered from simplest to most ambitious:

### Pattern 1 — idempotent schema in source (recommended for new photons)

The cheapest reliable approach. Schema setup runs at the top of every method that touches the database, guarded by `CREATE TABLE IF NOT EXISTS`:

```typescript
async upload(p: { name: string; bytes: string }) {
  await this.cf.d1().exec(
    `CREATE TABLE IF NOT EXISTS items (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  );
  await this.cf.d1().prepare('INSERT INTO items (name, created_at) VALUES (?, ?)')
    .bind(p.name, Date.now())
    .run();
  return { uploaded: p.name };
}
```

Pros: single file, zero deps, works locally and deployed identically. Cons: no version tracking — schema changes that need migrations (rename column, add NOT NULL constraint to existing data, etc.) need a more careful approach.

### Pattern 2 — versioned migrations on a tracking table

When you need to evolve schema without dropping data, run migrations against a `_photon_migrations` tracking table during a setup method or in `onInitialize`:

```typescript
const MIGRATIONS = [
  { id: '001', sql: `CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)` },
  { id: '002', sql: `ALTER TABLE items ADD COLUMN created_at INTEGER` },
];

async onInitialize() {
  const db = this.cf.d1();
  await db.exec('CREATE TABLE IF NOT EXISTS _photon_migrations (id TEXT PRIMARY KEY)');
  const applied = new Set(
    ((await db.prepare('SELECT id FROM _photon_migrations').all()).results as { id: string }[])
      .map(r => r.id),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.exec(m.sql);
    await db.prepare('INSERT INTO _photon_migrations (id) VALUES (?)').bind(m.id).run();
  }
}
```

Migrations run idempotently on every photon load. The tracking table makes it cheap to add new migrations without re-running old ones. Photon may ship a `runMigrations()` helper for this pattern in a future minor when a real photon dogfoods it; for now, copy the snippet.

### Pattern 3 — BYO Drizzle (power users)

`cf.d1()` returns a structurally compatible `D1DatabaseLike`. Drizzle's D1 adapter wraps any binding that satisfies that shape:

```typescript
import { drizzle } from 'drizzle-orm/d1';
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

const items = sqliteTable('items', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});

async list() {
  const db = drizzle(this.cf.d1() as any);
  return db.select().from(items).all();
}
```

You manage `drizzle.config.ts`, schema files, and `drizzle-kit generate` / `drizzle-kit migrate` yourself; Photon doesn't get in the way. This is the right answer when you need full ORM ergonomics.

### Which to pick

- **New photon, simple schema** → Pattern 1.
- **Schema will evolve, but you don't want a build step** → Pattern 2.
- **You already use Drizzle elsewhere or want type-safe queries** → Pattern 3.

Photon explicitly doesn't ship a migration framework. The single-file invariant is more strategic than ORM convenience; authors who need heavy schema tooling reach for Drizzle, and those who don't get a primitive that doesn't lock them in.

## Reference

- [PHOTON-INJECTION.md](PHOTON-INJECTION.md) — the broader injection model (`Photon`, `Cloudflare`, `CloudflareEnv`).
- [DEPLOYMENT.md](DEPLOYMENT.md) — `photon host deploy cloudflare` workflow.
- [`bindingNameFor`](https://github.com/portel-dev/photon-core/blob/main/src/cloudflare.ts) — single-source-of-truth helper exported from `@portel/photon-core`.
