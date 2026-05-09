# Cloudflare Bindings — `this.cf.*`

Photons reach into the Cloudflare runtime surface (R2, KV, D1, Queues, Vectorize, Workers AI, Images, Browser Rendering) through one namespace: `this.cf`. The same code runs locally against a miniflare sandbox and on a deployed Worker against the real bindings.

Cross-photon calls (Durable Objects internally) use `this.call('sibling.method')` and don't go through `this.cf`. See [CF-DURABLE-OBJECTS.md](../internals/CF-DURABLE-OBJECTS.md).

## Quick start

Declare the bindings on the photon class. Use `(this as any).cf.*` in any method (the `as any` cast is the simplest way to satisfy TypeScript today; see "Typing" below for `extends Photon` and other options). The local runtime backs each binding with a miniflare sandbox that boots lazily on first access; the deployed Worker uses the real Cloudflare bindings.

```typescript
export default class Gallery {
  protected cfBindings = {
    r2: { blobs: 'gallery-blobs' },
    d1: { catalog: 'gallery-catalog' },
    kv: { recent: 'gallery-recent' },
  };

  async upload(p: { name: string; bytes: string }) {
    const cf = (this as any).cf;
    await cf.r2('blobs').put(p.name, p.bytes);
    // First-run schema setup. SQL DDL is part of the photon, not external.
    await cf
      .d1('catalog')
      .exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT);');
    await cf
      .d1('catalog')
      .prepare('INSERT INTO items (name) VALUES (?)')
      .bind(p.name)
      .run();
    await cf.kv('recent').put('last', p.name);
    return { uploaded: p.name };
  }
}
```

Run it locally:

```bash
photon cli gallery upload --name 1.jpg --bytes "blob"
```

Deploy with the same source — `photon host deploy cf gallery` autogenerates the matching `wrangler.toml` bindings.

## `protected cfBindings` schema

```typescript
protected cfBindings = {
  r2: { binding: 'bucket-name' },          // R2 buckets
  kv: { binding: 'namespace-id' },          // KV namespaces
  d1: { binding: 'database-name-or-id' },   // D1 databases (see "D1" below)
  queue: { binding: 'queue-name' },         // Queue producers
  vectorize: { binding: 'index-name' },     // Vectorize indexes
  ai: true,                                 // Workers AI (opt-in)
  images: true,                             // Cloudflare Images (opt-in)
  browser: true,                            // Browser Rendering (opt-in, deploy only)
};
```

Each named-resource category maps a *binding name* (the identifier you reach via `(this as any).cf.<category>('<binding>')`) to the *resource id* (bucket / namespace / database / queue / index name in your Cloudflare account).

The boolean opt-ins (`ai`, `images`, `browser`) are single-binding categories — there's no name. **You must declare them explicitly** with `true`; the deploy adapter only emits the corresponding `[ai]` / `[images]` / `[browser]` block when the flag is set, so source and deploy stay in sync.

### Parser limitations

`protected cfBindings` is parsed by an AST scan that only recognizes the literal shapes:

- `protected cfBindings = { ... }` (must be a `protected` field, not `public` or no modifier).
- The initializer is a direct object literal — not `{...} as const`, not a spread, not an imported constant.
- Top-level keys are unquoted identifiers from the schema set above (`r2`, `kv`, `d1`, `queue`, `vectorize`, `ai`, `images`, `browser`).
- Inner values are string literals or boolean literals (or `{ name, id }` for `d1`, see below). Computed values, template strings, and other expressions are ignored.

When the scan misses your declaration, the loader falls back to "no Cloudflare runtime configured" and `this.cf.<...>(...)` throws on first use. If that happens, simplify the literal until the parser sees it.

### D1: providing a real `database_id`

Cloudflare's wrangler config requires `database_id` to be the actual database UUID for production accounts. Passing a string sets both `database_name` and `database_id` to the same value, which works for the local sandbox and for `wrangler d1 create` flows that pre-create databases by name. For real deploys against an existing database you should pass the explicit object form:

```typescript
protected cfBindings = {
  d1: {
    catalog: { name: 'gallery-catalog', id: 'abcd-1234-uuid-from-cf-dashboard' },
  },
};
```

The local sandbox uses miniflare regardless, so the `id` value is only consulted at deploy time.

## Surface — `this.cf.*`

| Call | Local backend | Deployed backend |
|---|---|---|
| `this.cf.r2(name).get/put/delete/list/head` | miniflare R2 | real R2 bucket |
| `this.cf.kv(name).get/put/delete/list` | miniflare KV | real KV namespace |
| `this.cf.d1(name).prepare(sql).bind(...).run/all/first/raw` | miniflare D1 (SQLite) | real D1 |
| `this.cf.d1(name).exec(sql)` / `.batch(stmts)` / `.dump()` | miniflare D1 | real D1 |
| `this.cf.queue(name).send/sendBatch` | miniflare queue producer | real Queue |
| `this.cf.vectorize(name).insert/upsert/query/getByIds/deleteByIds` | miniflare vectorize | real Vectorize |
| `this.cf.ai.run(model, inputs)` | miniflare AI binding (when `ai: true`) | real Workers AI (when `ai: true`) |
| `this.cf.images.info/input` | miniflare images (when `images: true`) | real Cloudflare Images (when `images: true`) |
| `this.cf.browser.fetch(...)` | deferred (heavy Chromium dep) | real Browser Rendering (when `browser: true`) |
| `this.cf.fetch(input, init)` | deferred to deploy | global fetch |

Categories marked deferred throw a clear error on use locally. The deployed Worker can use them once you redeploy with the relevant opt-in.

For cross-photon calls, use `this.call('sibling.method', args)` — backed by Durable Objects on Cloudflare. Direct DO access via `this.cf.do(...)` was removed for v1 because the Worker can't import an arbitrary external DO class definition.

## Typing

`this.cf` is always present at runtime, but TypeScript may not know about it. Three options:

1. **Cast at the call site:** `(this as any).cf.r2('blobs')`. Simplest and used by every test fixture in this repo.
2. **Extend `Photon`:** `class Gallery extends Photon { ... }` — the `cf` getter is declared on the base class so `this.cf.r2(...)` typechecks.
3. **Declare the property locally:**
   ```typescript
   import type { CFRuntime } from '@portel/photon-core';
   class Gallery {
     declare readonly cf: CFRuntime;
     // ...
   }
   ```

`CFRuntime` exposes minimal structural types (e.g., `R2BucketLike` with the methods photons commonly call) rather than re-exporting `@cloudflare/workers-types`. Photons that already import workers-types get exact compatibility through structural typing; nothing else has to change.

`this.cf.r2('typo')` typechecks today — binding names are unchecked strings. The error fires at runtime ("not declared in protected cfBindings"). Tighter typing per photon is a future enhancement.

## Local sandbox

The local runtime persists state under `<baseDir>/.data/cf-sandbox/<photon>/{kv,r2,d1,...}/` so reads and writes survive process restarts. One miniflare instance per photon, lazily booted on first `this.cf.*` access.

```
.data/cf-sandbox/gallery/
├── kv/        # KV namespace state
├── r2/        # R2 object storage
└── d1/        # D1 SQLite databases
```

## Override layer — repoint a binding without editing source

Use `photon cf` to layer an override on top of the source declaration. Useful for staging vs production or for renaming a bucket without touching the photon.

```bash
# Show declared / override / effective for a photon
photon cf bindings gallery

# Repoint a single binding
photon cf set gallery r2.blobs prod-gallery-blobs

# Toggle a boolean opt-in
photon cf set gallery ai true

# Drop the override — fall back to declared values
photon cf reset gallery
```

The override file lives at `<baseDir>/.data/cf-overrides/<photon>.json`. It's read by the loader before constructing the local runtime AND by the deploy adapter before generating `wrangler.toml`, so renames propagate to deploys. Each photon's override applies independently — host and `@photons` siblings each have their own file.

## Deploy

`photon host deploy cf <photon>` (alias `cloudflare`) autogenerates the matching wrangler.toml binding blocks from `protected cfBindings` across the host and any `@photons` siblings. Each photon's local override is applied during generation so `photon cf set` changes show up in the deployed config.

```bash
# Dry-run to inspect the generated project
photon host deploy cf gallery --dry-run --output /tmp/gallery-cf
cat /tmp/gallery-cf/wrangler.toml

# Real deploy (requires CLOUDFLARE_API_TOKEN or `wrangler login`)
photon host deploy cf gallery
```

The generated worker.ts attaches a `_cfRuntime` adapter built from the real `env`, so `this.cf.r2('blobs').put(...)` resolves to the same binding wrangler created. Source is identical between local and deployed runtimes.

### Binding-name collision warning

The deployed Worker exposes bindings on the global `env` object — every photon in the bundle shares the same env namespace. If the host photon and a `@photons` sibling both declare `kv: { cache: '...' }` with different resource ids, the merge picks one (later photon wins) and the other is silently lost. Use distinct binding names per photon (`hostCache`, `siblingCache`) to avoid collisions.

## When `this.cf` throws

Calling a category before configuring it produces a helpful error:

| Error contains | Cause | Fix |
|---|---|---|
| `No Cloudflare runtime is configured` | `protected cfBindings` not declared, or the parser couldn't read it | Declare it (or simplify the literal — see "Parser limitations") |
| `not declared in protected cfBindings` | Binding name not in the map | Add the binding to the photon source or via `photon cf set` |
| `deferred:` | Category not yet wired in this build | Use a deployed Worker, or wait for the relevant follow-up |
| `declare \`ai: true\` in protected cfBindings to enable` | Boolean opt-in missing | Set the flag in cfBindings |

(The exact wording of these errors lives in `src/runtime/cf-local.ts` and `@portel/photon-core/src/cf.ts` — match by substring, not by exact text.)

## Compatibility matrix

| Runtime | Status |
|---|---|
| Local CLI (`photon cli`) | KV/R2/D1/Queue/Vectorize/AI/Images via miniflare; Browser Rendering and `this.cf.fetch` deferred |
| Local Beam (`photon beam`) | Same as CLI |
| Deployed Worker (`photon host deploy cf`) | Every category works against real CF bindings when declared in `protected cfBindings` |

## See also

- [DEPLOYMENT.md](DEPLOYMENT.md) — full Cloudflare deployment story, including `MCP transport-level bearer auth (PHOTON_MCP_BEARER)`
- [CF-DURABLE-OBJECTS.md](../internals/CF-DURABLE-OBJECTS.md) — DO bridge for `this.memory` / `this.call`
