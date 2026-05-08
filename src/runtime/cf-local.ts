/**
 * Local Cloudflare runtime adapter — backs `this.cf.*` with a miniflare
 * sandbox when a photon runs outside a deployed Worker.
 *
 * Phase A2b: KV, R2, D1, Queue producers, Vectorize, Workers AI, and
 * Cloudflare Images route through real miniflare backends. Durable
 * Objects are deferred — they need a registered DO class plus a worker
 * script, so they ship in A3 alongside the cross-photon `this.call`
 * mapping. Browser Rendering also defers (heavy Chromium dep) until a
 * photon dogfoods it.
 *
 * Lifecycle: one Miniflare instance per photon name. Boot is lazy — we
 * don't pay the workerd startup cost unless `this.cf.*` is actually
 * called. Storage persists under `<baseDir>/.data/cf-sandbox/<photon>/`
 * so state survives process restarts.
 */

import type { CFRuntime } from '@portel/photon-core';
import * as path from 'path';

/**
 * Shape of the `protected cfBindings = { ... }` declaration. Each
 * named-resource category maps a binding name to a resource identifier;
 * categories with no name (ai, images, browser) take a boolean opt-in.
 */
export interface CfBindingsConfig {
  r2?: Record<string, string>;
  kv?: Record<string, string>;
  d1?: Record<string, string>;
  queue?: Record<string, string>;
  vectorize?: Record<string, string>;
  do?: Record<string, string>;
  ai?: boolean;
  images?: boolean;
  browser?: boolean;
}

const DEFER_HINT = (cat: string, reason: string) =>
  `this.cf.${cat}() — deferred: ${reason}. Track plan file ` +
  `how-can-we-open-expressive-hollerith.md.`;

export class CFLocalRuntime implements CFRuntime {
  private mfPromise: Promise<import('miniflare').Miniflare> | null = null;

  constructor(
    private readonly photonName: string,
    private readonly bindings: CfBindingsConfig,
    private readonly baseDir: string
  ) {}

  /** Lazily boot a Miniflare instance scoped to this photon. */
  private getMiniflare(): Promise<import('miniflare').Miniflare> {
    if (!this.mfPromise) {
      this.mfPromise = (async () => {
        const { Miniflare } = await import('miniflare');
        const sandbox = path.join(this.baseDir, '.data', 'cf-sandbox', this.photonName);

        const options: Record<string, unknown> = {
          modules: true,
          script: 'export default { async fetch() { return new Response("noop"); } };',
        };

        if (this.bindings.kv) {
          options.kvNamespaces = Object.keys(this.bindings.kv);
          options.kvPersist = path.join(sandbox, 'kv');
        }

        if (this.bindings.r2) {
          options.r2Buckets = Object.keys(this.bindings.r2);
          options.r2Persist = path.join(sandbox, 'r2');
        }

        if (this.bindings.d1) {
          options.d1Databases = Object.keys(this.bindings.d1);
          options.d1Persist = path.join(sandbox, 'd1');
        }

        if (this.bindings.queue) {
          const producers: Record<string, { queueName: string }> = {};
          for (const [bindingName, queueName] of Object.entries(this.bindings.queue)) {
            producers[bindingName] = { queueName };
          }
          options.queueProducers = producers;
        }

        if (this.bindings.vectorize) {
          const indices: Record<string, { indexName: string }> = {};
          for (const [bindingName, indexName] of Object.entries(this.bindings.vectorize)) {
            indices[bindingName] = { indexName };
          }
          options.vectorize = indices;
        }

        if (this.bindings.ai) {
          options.ai = { binding: 'AI' };
        }

        if (this.bindings.images) {
          options.images = { binding: 'IMAGES' };
        }

        // browser and do intentionally omitted — see deferral notes above.

        return new Miniflare(options as never);
      })();
    }
    return this.mfPromise;
  }

  async dispose(): Promise<void> {
    if (this.mfPromise) {
      const mf = await this.mfPromise;
      await mf.dispose();
      this.mfPromise = null;
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Named-resource categories (declared name → resource id)
  // ────────────────────────────────────────────────────────────────

  kv(name: string): any {
    this.assertDeclared('kv', name);
    return this.bindingProxy(
      async (mf) => (await mf.getKVNamespace(name)) as any,
      ['get', 'put', 'delete', 'list']
    );
  }

  r2(name: string): any {
    this.assertDeclared('r2', name);
    return this.bindingProxy(
      async (mf) => (await mf.getR2Bucket(name)) as any,
      ['head', 'get', 'put', 'delete', 'list']
    );
  }

  d1(name: string): any {
    this.assertDeclared('d1', name);
    // D1's `prepare` is sync at the binding surface but builds a chained
    // statement; expose it through a thin async wrapper that defers each
    // chain step until a terminal (run/all/first/raw) is awaited.
    const get = this.getMiniflare.bind(this);
    return {
      prepare: (query: string) => makeD1PreparedStatement(get, name, query, []),
      batch: async <T = unknown>(statements: any[]): Promise<T[]> => {
        const mf = await get();
        const db = (await mf.getD1Database(name)) as any;
        const real = statements.map((s) => s._materialize?.() ?? s);
        return db.batch(await Promise.all(real));
      },
      exec: async (query: string) => {
        const mf = await get();
        const db = (await mf.getD1Database(name)) as any;
        return db.exec(query);
      },
      dump: async () => {
        const mf = await get();
        const db = (await mf.getD1Database(name)) as any;
        return db.dump();
      },
    };
  }

  queue<Body = unknown>(name: string): any {
    this.assertDeclared('queue', name);
    return this.bindingProxy(
      async (mf) => (await mf.getQueueProducer<Body>(name)) as any,
      ['send', 'sendBatch']
    );
  }

  vectorize(name: string): any {
    this.assertDeclared('vectorize', name);
    const get = this.getMiniflare.bind(this);
    return this.envProxy(get, name, ['insert', 'upsert', 'query', 'getByIds', 'deleteByIds']);
  }

  do(_name: string): any {
    throw new Error(
      DEFER_HINT(
        'do',
        'requires a registered DO class binding plus the cross-photon ' +
          'call mapping that lands in A3'
      )
    );
  }

  fetch(_input: string, _init?: unknown): Promise<unknown> {
    return Promise.reject(
      new Error(
        DEFER_HINT('fetch', 'service-binding fetch lands with the deploy adapter in Phase B')
      )
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Property-style categories (single binding, no name)
  // ────────────────────────────────────────────────────────────────

  get ai(): any {
    if (!this.bindings.ai) {
      return errorProperty('ai', 'declare `ai: true` in protected cfBindings to enable');
    }
    return this.envProxy(this.getMiniflare.bind(this), 'AI', ['run']);
  }

  get images(): any {
    if (!this.bindings.images) {
      return errorProperty('images', 'declare `images: true` in protected cfBindings to enable');
    }
    return this.envProxy(this.getMiniflare.bind(this), 'IMAGES', ['info', 'input']);
  }

  get browser(): any {
    return errorProperty(
      'browser',
      'browser rendering requires a Chromium dep and is deferred until a photon dogfoods it'
    );
  }

  // ────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────

  private assertDeclared(category: keyof CfBindingsConfig, name: string): void {
    const map = this.bindings[category] as Record<string, string> | undefined;
    if (!map || !map[name]) {
      throw new Error(
        `this.cf.${category}('${name}') is not declared in protected cfBindings on ` +
          `${this.photonName}. Add { ${String(category)}: { ${name}: '<resource-id>' } } ` +
          `to the photon's cfBindings.`
      );
    }
  }

  /**
   * Returns a thin proxy whose methods defer to a binding obtained
   * via `getter(mf)` on first invocation. Avoids forcing callers to
   * await the boot before reaching for a method, while keeping the
   * boot cost off cold paths.
   */
  private bindingProxy(
    getter: (mf: import('miniflare').Miniflare) => Promise<any>,
    methods: string[]
  ): any {
    const get = this.getMiniflare.bind(this);
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of methods) {
      out[method] = async (...args: unknown[]) => {
        const mf = await get();
        const binding = await getter(mf);
        return binding[method](...args);
      };
    }
    return out;
  }

  /** Pull a binding off the worker env (for AI, Vectorize, Images). */
  private envProxy(
    get: () => Promise<import('miniflare').Miniflare>,
    bindingName: string,
    methods: string[]
  ): any {
    const out: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of methods) {
      out[method] = async (...args: unknown[]) => {
        const mf = await get();
        const env = await mf.getBindings<Record<string, any>>();
        const binding = env[bindingName];
        if (!binding) {
          throw new Error(
            `Miniflare has no binding named '${bindingName}'. The miniflare config ` +
              `for ${this.photonName} may be missing or out of sync.`
          );
        }
        return binding[method](...args);
      };
    }
    return out;
  }
}

function errorProperty(category: string, hint: string): any {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      throw new Error(`this.cf.${category}.${String(prop)} — ${hint}.`);
    },
  });
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
): any {
  const materialize = async () => {
    const mf = await get();
    const db = (await mf.getD1Database(dbName)) as any;
    let stmt = db.prepare(query);
    if (bound.length > 0) stmt = stmt.bind(...bound);
    return stmt;
  };
  return {
    bind: (...values: unknown[]) =>
      makeD1PreparedStatement(get, dbName, query, [...bound, ...values]),
    first: async (colName?: string) => (await materialize()).first(colName),
    run: async () => (await materialize()).run(),
    all: async () => (await materialize()).all(),
    raw: async () => (await materialize()).raw(),
    _materialize: materialize,
  };
}
