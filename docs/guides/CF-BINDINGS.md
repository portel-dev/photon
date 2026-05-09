# Cloudflare Bindings — `this.cf.*`

Photons reach into the full Cloudflare runtime surface (R2, KV, D1, Queues, Vectorize, Workers AI, Images, Browser Rendering, Durable Objects) through one namespace: `this.cf`. The same code runs locally against a miniflare sandbox and on a deployed Worker against the real bindings.

## Quick start

Declare the bindings on the photon class. Use `this.cf.*` in any method. The local runtime backs each binding with a miniflare sandbox that boots lazily on first access; the deployed Worker uses the real Cloudflare bindings.

```typescript
export default class Gallery {
  protected cfBindings = {
    r2: { blobs: 'gallery-blobs' },
    d1: { catalog: 'gallery-catalog' },
    kv: { recent: 'gallery-recent' },
  };

  async upload(p: { name: string; bytes: string }) {
    await this.cf.r2('blobs').put(p.name, p.bytes);
    await this.cf
      .d1('catalog')
      .prepare('INSERT INTO items (name) VALUES (?)')
      .bind(p.name)
      .run();
    await this.cf.kv('recent').put('last', p.name);
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
  r2: { binding: 'bucket-name' },        // R2 buckets
  kv: { binding: 'namespace-id' },        // KV namespaces
  d1: { binding: 'database-name' },       // D1 databases
  queue: { binding: 'queue-name' },       // Queue producers
  vectorize: { binding: 'index-name' },   // Vectorize indexes
  do: { binding: 'class-name' },          // Durable Objects (deploy-only for now)
  ai: true,                               // Workers AI
  images: true,                           // Cloudflare Images
  browser: true,                          // Browser Rendering (deploy-only)
};
```

Each named-resource category maps a *binding name* (the identifier you reach via `this.cf.<category>('<binding>')`) to the *resource id* (bucket / namespace / database / queue / index name in your Cloudflare account).

Boolean opt-ins (`ai`, `images`, `browser`) are single-binding categories — there's no name to declare.

## Surface — `this.cf.*`

| Call | Local backend | Deployed backend |
|---|---|---|
| `this.cf.r2(name).get/put/delete/list/head` | miniflare R2 | real R2 bucket |
| `this.cf.kv(name).get/put/delete/list` | miniflare KV | real KV namespace |
| `this.cf.d1(name).prepare(sql).bind(...).run/all/first/raw` | miniflare D1 (SQLite) | real D1 |
| `this.cf.d1(name).exec(sql)` / `.batch(stmts)` / `.dump()` | miniflare D1 | real D1 |
| `this.cf.queue(name).send/sendBatch` | miniflare queue producer | real Queue |
| `this.cf.vectorize(name).insert/upsert/query/getByIds/deleteByIds` | miniflare vectorize | real Vectorize |
| `this.cf.ai.run(model, inputs)` | miniflare AI binding | real Workers AI |
| `this.cf.images.info/input` | miniflare images | real Cloudflare Images |
| `this.cf.browser.fetch(...)` | deferred (heavy Chromium dep) | real Browser Rendering |
| `this.cf.do(name).get(id)` | deferred (needs class registration) | real DO namespace |
| `this.cf.fetch(input, init)` | deferred to deploy | global fetch |

Categories marked deferred throw a clear error pointing at the future phase that lights them up locally. The deployed Worker can use them today.

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

The override file lives at `<baseDir>/.data/cf-overrides/<photon>.json`. It's read by the loader before constructing the local runtime AND by the deploy adapter before generating `wrangler.toml`, so renames propagate to deploys.

## Deploy

`photon host deploy cf <photon>` (alias `cloudflare`) autogenerates the matching wrangler.toml binding blocks from `protected cfBindings`. The local override is applied during generation so `photon cf set` changes show up in the deployed config.

```bash
# Dry-run to inspect the generated project
photon host deploy cf gallery --dry-run --output /tmp/gallery-cf
cat /tmp/gallery-cf/wrangler.toml

# Real deploy (requires CLOUDFLARE_API_TOKEN or `wrangler login`)
photon host deploy cf gallery
```

The generated worker.ts attaches a `_cfRuntime` adapter built from the real `env`, so `this.cf.r2('blobs').put(...)` resolves to the same binding wrangler created. Source is identical between local and deployed runtimes.

## Capability detection

`this.cf` is auto-injected for plain classes (no `extends Photon` required). The detection scan recognizes:

- `this.cf.<category>(...)` — direct member access
- `(this as any).cf.<category>(...)` — typed cast workarounds

If neither matches but a photon needs the namespace, add `extends Photon` to get the getter from the base class.

## When `this.cf` throws

Calling a category before configuring it produces a helpful error:

| Error | Cause | Fix |
|---|---|---|
| `No Cloudflare runtime is configured` | `protected cfBindings` not declared on the class | Add the property |
| `not declared in protected cfBindings` | Binding name not in the map | Add the binding to the photon source or override |
| `deferred: ... lands in A2b/A3/Phase B` | Category not yet wired in this build | Use a deployed Worker, or wait for the named phase |
| `declare 'ai: true' in protected cfBindings to enable` | Boolean opt-in missing | Set the flag in cfBindings |

## Compatibility matrix

| Runtime | Status |
|---|---|
| Local CLI (`photon cli`) | KV/R2/D1/Queue/Vectorize/AI/Images via miniflare; DOs and Browser Rendering deferred |
| Local Beam (`photon beam`) | Same as CLI |
| Deployed Worker (`photon host deploy cf`) | All categories work against real CF bindings |

## See also

- [DEPLOYMENT.md](DEPLOYMENT.md) — full Cloudflare deployment story
- [CF-DURABLE-OBJECTS.md](../internals/CF-DURABLE-OBJECTS.md) — DO bridge for `this.memory` / `this.call`
