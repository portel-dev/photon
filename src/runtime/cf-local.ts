/**
 * Local Cloudflare runtime adapter for the new `Cloudflare` injection
 * surface. Backs `private cf: Cloudflare` constructor params (and the
 * forgiving auto-inject path for plain classes that reference
 * `this.cf.*`) with a miniflare sandbox when a photon runs outside a
 * deployed Worker.
 *
 * Auto-naming rule (single source of truth — `bindingNameFor`):
 *   cf.kv()        → <photon>_kv
 *   cf.kv('x')     → <photon>_x_kv
 *   cf.ai          → AI         (shared, single per Worker)
 *   cf.images      → IMAGES     (shared)
 *   cf.browser     → BROWSER    (shared)
 *
 * Photons no longer pick global binding names. The framework derives
 * them from the photon name plus an optional qualifier so per-photon
 * resources never collide.
 *
 * Boot is keyed off the `cf-usage-scanner` output: every literal
 * qualifier the photon uses is configured in miniflare up front, so
 * the first call to a binding doesn't pay a reconfigure cost. Dynamic
 * qualifiers (`cf.kv(this.tenantId)`) only get the default binding
 * unless the author lists overrides in `protected cfBindings`.
 *
 * Storage persists under `<baseDir>/.data/cf-sandbox/<photon>/` so
 * state survives process restarts and matches the Phase A2 layout.
 */

import * as path from 'path';
import {
  bindingNameFor,
  type Cloudflare,
  type ScopedBindingCategory,
  type R2BucketLike,
  type KVNamespaceLike,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type QueueLike,
  type VectorizeIndexLike,
  type AiLike,
  type ImagesBindingLike,
  type FetcherLike,
} from '@portel/photon-core';
import { type CfUsage, expandScopedBindingNames } from '../cf-usage-scanner.js';

/**
 * Optional override layer. Most photons leave this empty — the
 * auto-naming convention covers the common case. Authors set it when
 * they need a binding to point at a pre-existing CF resource owned
 * outside the photon (typically only matters at deploy time, not for
 * the local sandbox).
 *
 * Schema mirrors the deploy-side override JSON (~/.photon/state/...).
 * For local boot, we accept the same shape so a single
 * `protected cfBindings` block round-trips through both layers.
 */
export interface CfOverrides {
  /** Per-qualifier override of the resource name a binding points at. */
  kv?: Record<string, string>;
  r2?: Record<string, string>;
  d1?: Record<string, string | { name: string; id: string }>;
  queue?: Record<string, string>;
  vectorize?: Record<string, string>;
}

export interface CFLocalRuntimeOptions {
  photonName: string;
  baseDir: string;
  /**
   * Static-analysis output from cf-usage-scanner. Determines which
   * binding names miniflare boots with. When absent, only the
   * default per-category binding is configured (callers that hit a
   * qualified binding without source-scanning will get a clear miss
   * error from miniflare).
   */
  usage?: CfUsage;
  /** Optional `protected cfBindings` override layer, see CfOverrides. */
  overrides?: CfOverrides;
}

/**
 * Legacy override schema. The Phase A2 release shipped `cfBindings`
 * as a `Record<bindingName, resourceId>` declaration that doubled as
 * a binding declaration. Under the new auto-naming model
 * (bindingNameFor) the same shape becomes a pure override layer —
 * authors who want to repoint a default binding at a pre-existing
 * resource still write the same JSON. Kept exported so deploy code
 * and the photon-cf CLI keep building during the migration.
 */
export type CfBindingsConfig = CfOverrides & {
  ai?: boolean;
  images?: boolean;
  browser?: boolean;
};

/**
 * Merge two CfBindingsConfig blobs. Used by the deploy pipeline to
 * stack a per-photon override JSON on top of in-source declarations.
 * Boolean shared flags are last-write-wins; per-binding records merge
 * key-by-key.
 */
export function mergeBindings(
  base: CfBindingsConfig | null | undefined,
  override: CfBindingsConfig | null | undefined
): CfBindingsConfig {
  const merged: CfBindingsConfig = { ...(base ?? {}) };
  if (!override) return merged;
  for (const cat of ['kv', 'r2', 'queue', 'vectorize'] as const) {
    const ov = override[cat];
    if (ov) {
      merged[cat] = { ...(merged[cat] ?? {}), ...ov };
    }
  }
  if (override.d1) {
    merged.d1 = { ...(merged.d1 ?? {}), ...override.d1 };
  }
  for (const cat of ['ai', 'images', 'browser'] as const) {
    if (typeof override[cat] === 'boolean') merged[cat] = override[cat];
  }
  return merged;
}

const SCOPED: readonly ScopedBindingCategory[] = ['kv', 'r2', 'd1', 'queue', 'vectorize'];

const SHARED_BINDING_NAMES = {
  ai: 'AI',
  images: 'IMAGES',
  browser: 'BROWSER',
} as const;

export class CFLocalRuntime implements Cloudflare {
  private mfPromise: Promise<import('miniflare').Miniflare> | null = null;
  private readonly photonName: string;
  private readonly baseDir: string;
  private readonly usage: CfUsage | null;
  private readonly overrides: CfOverrides;
  /**
   * Legacy mode means the photon was constructed via the Phase-A2
   * positional `(name, cfBindings, baseDir)` form. In that mode the
   * `qualifier` arg passed to `cf.kv(...)` etc. is treated as a
   * literal binding name (not run through `bindingNameFor`), and
   * miniflare seeds the names declared in `overrides.<category>`.
   * The new options-form constructor flips this to false and the
   * auto-naming convention takes over.
   */
  private readonly legacyMode: boolean;
  private readonly legacyBooleanFlags: { ai: boolean; images: boolean; browser: boolean };

  /**
   * New options-object form (preferred). Hosts that source-scan the
   * photon for `Cloudflare` usage pass the scanner output as `usage`
   * so miniflare seeds every literal-qualified binding upfront.
   */
  constructor(opts: CFLocalRuntimeOptions);
  /**
   * Legacy positional form retained for the classic loader and
   * existing CF-runtime tests. Translates the Phase-A2 `cfBindings`
   * declaration to the new override schema; auto-naming is disabled
   * (no usage scan) so explicit binding names take precedence over
   * `<photon>_<category>` defaults. Callers should migrate to the
   * options form when the demolition commit lands.
   *
   * @deprecated use the options-object constructor.
   */
  constructor(photonName: string, bindings: CfBindingsConfig, baseDir: string);
  constructor(
    optsOrName: CFLocalRuntimeOptions | string,
    legacyBindings?: CfBindingsConfig,
    legacyBaseDir?: string
  ) {
    if (typeof optsOrName === 'string') {
      this.photonName = optsOrName;
      this.baseDir = legacyBaseDir ?? '';
      this.usage = null;
      this.overrides = legacyBindings ?? {};
      this.legacyMode = true;
      this.legacyBooleanFlags = {
        ai: legacyBindings?.ai === true,
        images: legacyBindings?.images === true,
        browser: legacyBindings?.browser === true,
      };
    } else {
      this.photonName = optsOrName.photonName;
      this.baseDir = optsOrName.baseDir;
      this.usage = optsOrName.usage ?? null;
      this.overrides = optsOrName.overrides ?? {};
      this.legacyMode = false;
      this.legacyBooleanFlags = { ai: false, images: false, browser: false };
    }
  }

  /** Legacy alias retained for callers that built against the Phase-A2 API. */
  getBindings(): CfBindingsConfig {
    return this.overrides;
  }

  /** Inspector for tools/CLI: lists every binding miniflare seeded. */
  getSeededBindings(): Record<ScopedBindingCategory, string[]> {
    const out = {} as Record<ScopedBindingCategory, string[]>;
    if (this.legacyMode) {
      // Legacy: seed exactly what `cfBindings` declared, no auto-naming.
      for (const cat of SCOPED) {
        const declared = this.overrides[cat];
        if (!declared) {
          out[cat] = [];
          continue;
        }
        out[cat] = Object.keys(declared);
      }
      return out;
    }
    if (!this.usage) {
      for (const cat of SCOPED) out[cat] = [bindingNameFor(this.photonName, cat)];
      return out;
    }
    return expandScopedBindingNames(this.photonName, this.usage);
  }

  /**
   * Resolve the miniflare binding name for a `cf.<cat>(qualifier?)`
   * call. In auto-naming mode runs through `bindingNameFor`; in
   * legacy mode treats the arg as a literal binding name (matching
   * the Phase-A2 `cf.kv(name)` semantics).
   */
  private resolveBindingName(
    category: ScopedBindingCategory,
    qualifier: string | undefined
  ): string {
    if (this.legacyMode) {
      // Legacy callers pass the binding name directly. Empty / missing
      // is invalid in this mode (the old API required a name).
      if (!qualifier) {
        throw new Error(
          `cf.${category}() in legacy mode requires the binding name as an argument ` +
            `(e.g. cf.${category}('cache')). Migrate to the new options-object ` +
            `constructor to use auto-naming.`
        );
      }
      return qualifier;
    }
    return bindingNameFor(this.photonName, category, qualifier);
  }

  async dispose(): Promise<void> {
    if (this.mfPromise) {
      const mf = await this.mfPromise;
      await mf.dispose();
      this.mfPromise = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Cloudflare interface — scoped categories with auto-naming
  // ────────────────────────────────────────────────────────────────

  kv(qualifier?: string): KVNamespaceLike {
    return this.scopedBinding('kv', qualifier, ['get', 'put', 'delete', 'list']) as KVNamespaceLike;
  }

  r2(qualifier?: string): R2BucketLike {
    return this.scopedBinding('r2', qualifier, [
      'head',
      'get',
      'put',
      'delete',
      'list',
    ]) as R2BucketLike;
  }

  d1(qualifier?: string): D1DatabaseLike {
    const name = this.resolveBindingName('d1', qualifier);
    const get = this.getMiniflare.bind(this);
    return {
      prepare: (query: string) => makeD1PreparedStatement(get, name, query, []),
      batch: async <T = unknown>(statements: D1PreparedStatementLike[]) => {
        const mf = await get();
        const db = (await mf.getD1Database(name)) as { batch: (s: unknown[]) => Promise<T[]> };
        const real = await Promise.all(
          statements.map(async (s) => {
            const candidate = (s as { _materialize?: () => Promise<unknown> })._materialize;
            return candidate ? candidate() : s;
          })
        );
        return db.batch(real);
      },
      exec: async (query: string) => {
        const mf = await get();
        const db = (await mf.getD1Database(name)) as { exec: (q: string) => Promise<unknown> };
        return db.exec(query);
      },
      dump: async () => {
        const mf = await get();
        const db = (await mf.getD1Database(name)) as { dump: () => Promise<ArrayBuffer> };
        return db.dump();
      },
    };
  }

  queue<Body = unknown>(qualifier?: string): QueueLike<Body> {
    return this.scopedBinding('queue', qualifier, ['send', 'sendBatch']) as QueueLike<Body>;
  }

  vectorize(qualifier?: string): VectorizeIndexLike {
    return this.envBindingProxy(this.resolveBindingName('vectorize', qualifier), [
      'insert',
      'upsert',
      'query',
      'getByIds',
      'deleteByIds',
    ]) as VectorizeIndexLike;
  }

  // ────────────────────────────────────────────────────────────────
  // Cloudflare interface — shared categories (single per Worker)
  // ────────────────────────────────────────────────────────────────

  get ai(): AiLike {
    const enabled = this.usage?.shared.ai === true || this.legacyBooleanFlags.ai;
    if (!enabled) {
      return throwingShared(
        'ai',
        'reference this.cf.ai (or cf.ai) somewhere in the photon to enable'
      );
    }
    return this.envBindingProxy(SHARED_BINDING_NAMES.ai, ['run']) as AiLike;
  }

  get images(): ImagesBindingLike {
    const enabled = this.usage?.shared.images === true || this.legacyBooleanFlags.images;
    if (!enabled) {
      return throwingShared(
        'images',
        'reference this.cf.images (or cf.images) somewhere in the photon to enable'
      );
    }
    return this.envBindingProxy(SHARED_BINDING_NAMES.images, [
      'info',
      'input',
    ]) as ImagesBindingLike;
  }

  get browser(): FetcherLike {
    return throwingShared(
      'browser',
      'browser rendering requires a Chromium dep and is deferred until a photon dogfoods it'
    );
  }

  fetch(_input: string, _init?: unknown): Promise<unknown> {
    return Promise.reject(
      new Error(
        'cf.fetch() — not yet supported on the local sandbox. Service-binding ' +
          'fetch lands with the deploy adapter; until then, use plain `fetch()` ' +
          'or wire the photon up to a deployed Worker.'
      )
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  /** Lazily boot a Miniflare instance scoped to this photon. */
  private getMiniflare(): Promise<import('miniflare').Miniflare> {
    if (!this.mfPromise) {
      this.mfPromise = (async () => {
        const { Miniflare } = await import('miniflare');
        const sandbox = path.join(this.baseDir, '.data', 'cf-sandbox', this.photonName);
        const seeded = this.getSeededBindings();

        const options: Record<string, unknown> = {
          modules: true,
          script: 'export default { async fetch() { return new Response("noop"); } };',
        };

        if (seeded.kv.length > 0) {
          options.kvNamespaces = seeded.kv;
          options.kvPersist = path.join(sandbox, 'kv');
        }

        if (seeded.r2.length > 0) {
          options.r2Buckets = seeded.r2;
          options.r2Persist = path.join(sandbox, 'r2');
        }

        if (seeded.d1.length > 0) {
          options.d1Databases = seeded.d1;
          options.d1Persist = path.join(sandbox, 'd1');
        }

        if (seeded.queue.length > 0) {
          const producers: Record<string, { queueName: string }> = {};
          for (const bindingName of seeded.queue) {
            // Local sandbox: queue name == binding name. Overrides only
            // come into play at deploy time.
            producers[bindingName] = { queueName: bindingName };
          }
          options.queueProducers = producers;
        }

        if (seeded.vectorize.length > 0) {
          const indices: Record<string, { indexName: string }> = {};
          for (const bindingName of seeded.vectorize) {
            indices[bindingName] = { indexName: bindingName };
          }
          options.vectorize = indices;
        }

        if (this.usage?.shared.ai) {
          options.ai = { binding: SHARED_BINDING_NAMES.ai };
        }

        if (this.usage?.shared.images) {
          options.images = { binding: SHARED_BINDING_NAMES.images };
        }

        // browser intentionally omitted — see `get browser` deferral.

        return new Miniflare(options as never);
      })();
    }
    return this.mfPromise;
  }

  /**
   * Build a thin proxy whose methods defer to a binding fetched via
   * `mf.getKVNamespace(name)` / `mf.getR2Bucket(name)` / etc on first
   * invocation. Avoids paying the boot cost on cold paths.
   */
  private scopedBinding(
    category: ScopedBindingCategory,
    qualifier: string | undefined,
    methods: readonly string[]
  ): unknown {
    const name = this.resolveBindingName(category, qualifier);
    const dynamicCategory = this.usage?.dynamicQualifiers.has(category);
    const knownNames = new Set(this.getSeededBindings()[category]);
    if (!knownNames.has(name) && !dynamicCategory) {
      throw new Error(
        `cf.${category}(${qualifier ? JSON.stringify(qualifier) : ''}) on ` +
          `${this.photonName} resolves to binding "${name}", which the runtime ` +
          `did not seed. Either reference this binding with a literal qualifier ` +
          `somewhere in your photon source (the boot scanner only sees literals), ` +
          `or add a "${category}" override to \`protected cfBindings\`.`
      );
    }
    const get = this.getMiniflare.bind(this);
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of methods) {
      out[method] = async (...args: unknown[]) => {
        const mf = await get();
        const binding = await getMiniflareBinding(mf, category, name);
        const fn = (binding as Record<string, (...a: unknown[]) => unknown>)[method];
        if (typeof fn !== 'function') {
          throw new Error(
            `Miniflare binding "${name}" has no method "${method}" (category=${category}).`
          );
        }
        return fn.apply(binding, args);
      };
    }
    return out;
  }

  /**
   * Pull a binding off the miniflare-built env (for AI, Vectorize,
   * Images — categories that surface as env props rather than via a
   * dedicated `mf.getXxx(name)` accessor).
   */
  private envBindingProxy(bindingName: string, methods: readonly string[]): unknown {
    const get = this.getMiniflare.bind(this);
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of methods) {
      out[method] = async (...args: unknown[]) => {
        const mf = await get();
        const env: Record<string, unknown> = await mf.getBindings();
        const binding = env[bindingName] as
          | Record<string, (...a: unknown[]) => unknown>
          | undefined;
        if (!binding) {
          throw new Error(
            `Miniflare has no binding named '${bindingName}' (photon=${this.photonName}).`
          );
        }
        return binding[method].apply(binding, args);
      };
    }
    return out;
  }
}

async function getMiniflareBinding(
  mf: import('miniflare').Miniflare,
  category: ScopedBindingCategory,
  name: string
): Promise<unknown> {
  // Each miniflare accessor is typed for its specific binding; the
  // `as never` cast keeps the dispatcher concise without giving up
  // the runtime guarantee that `name` is one of the configured
  // bindings (the dispatcher gate above ensures this).
  switch (category) {
    case 'kv':
      return mf.getKVNamespace(name as never);
    case 'r2':
      return mf.getR2Bucket(name as never);
    case 'd1':
      return mf.getD1Database(name as never);
    case 'queue':
      return mf.getQueueProducer(name as never);
    case 'vectorize': {
      const env: Record<string, unknown> = await mf.getBindings();
      return env[name];
    }
  }
}

function throwingShared(category: string, hint: string): never {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      throw new Error(`cf.${category}.${String(prop)} — ${hint}.`);
    },
  }) as never;
}

/**
 * Build a chainable D1 prepared-statement proxy that mirrors
 * `D1PreparedStatement.bind(...).first/all/run/raw()` semantics. We
 * accumulate the bind list on the proxy and materialize the real
 * statement only when a terminal method runs.
 */
function makeD1PreparedStatement(
  get: () => Promise<import('miniflare').Miniflare>,
  dbName: string,
  query: string,
  bound: unknown[]
): D1PreparedStatementLike {
  const materialize = async () => {
    const mf = await get();
    const db = (await mf.getD1Database(dbName)) as {
      prepare: (q: string) => { bind: (...v: unknown[]) => unknown };
    };
    const stmt = db.prepare(query) as {
      bind: (...v: unknown[]) => unknown;
    } & Record<string, (...a: unknown[]) => unknown>;
    if (bound.length > 0) return stmt.bind(...bound);
    return stmt;
  };
  const proxy: D1PreparedStatementLike & { _materialize: () => Promise<unknown> } = {
    bind: (...values: unknown[]) =>
      makeD1PreparedStatement(get, dbName, query, [...bound, ...values]),
    first: async <T = unknown>(colName?: string) => {
      const real = (await materialize()) as { first: (c?: string) => Promise<T | null> };
      return real.first(colName);
    },
    run: async <T = unknown>() => {
      const real = (await materialize()) as { run: () => Promise<T> };
      return real.run();
    },
    all: async <T = unknown>() => {
      const real = (await materialize()) as { all: () => Promise<T> };
      return real.all();
    },
    raw: async <T = unknown>() => {
      const real = (await materialize()) as { raw: () => Promise<T[]> };
      return real.raw();
    },
    _materialize: materialize,
  };
  return proxy;
}
