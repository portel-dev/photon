/**
 * Local Cloudflare runtime adapter — backs `this.cf.*` with a miniflare
 * sandbox when a photon runs outside a deployed Worker.
 *
 * Phase A2 ships KV end-to-end as the proof point. Other categories
 * (R2, D1, queues, vectorize, AI, images, browser, DOs) throw a clear
 * "lands in A2b" error so consumers can see the wiring is in place
 * without an unfinished half-merged backend.
 *
 * Lifecycle: one Miniflare instance per photon name. Boot is lazy — we
 * don't pay the workerd startup cost unless `this.cf.*` is actually
 * called. Persistence is rooted under `<baseDir>/.data/cf-sandbox/<photon>/`
 * so state survives process restarts.
 */

import type { CFRuntime } from '@portel/photon-core';
import * as path from 'path';

/**
 * Shape of the `protected cfBindings = { ... }` declaration. Each
 * category maps a binding name to a resource identifier; categories
 * with no name (ai, images, browser) take a boolean.
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

const A2B_HINT =
  'Wired in Phase A2b. Currently only KV is backed end-to-end through ' +
  'miniflare. Track plan file how-can-we-open-expressive-hollerith.md.';

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
        const kvNamespaces = this.bindings.kv ? Object.keys(this.bindings.kv) : [];
        return new Miniflare({
          modules: true,
          script: 'export default { async fetch() { return new Response("noop"); } };',
          kvNamespaces,
          kvPersist: path.join(sandbox, 'kv'),
        });
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

  kv(name: string): any {
    if (!this.bindings.kv?.[name]) {
      throw new Error(
        `this.cf.kv('${name}') is not declared in protected cfBindings on ${this.photonName}. ` +
          `Add { kv: { ${name}: '<namespace-id>' } } to the photon's cfBindings.`
      );
    }
    // Return a thin proxy that defers to miniflare on each call. Avoids
    // forcing callers to await the boot before using the namespace; the
    // boot promise resolves on first method invocation.
    const get = this.getMiniflare.bind(this);
    return {
      async get(key: string, options?: any) {
        const mf = await get();
        const ns = (await mf.getKVNamespace(name)) as any;
        return ns.get(key, options);
      },
      async put(key: string, value: any, options?: any) {
        const mf = await get();
        const ns = (await mf.getKVNamespace(name)) as any;
        return ns.put(key, value, options);
      },
      async delete(key: string) {
        const mf = await get();
        const ns = (await mf.getKVNamespace(name)) as any;
        return ns.delete(key);
      },
      async list(options?: any) {
        const mf = await get();
        const ns = (await mf.getKVNamespace(name)) as any;
        return ns.list(options);
      },
    };
  }

  r2(_name: string): any {
    throw new Error(`this.cf.r2() — ${A2B_HINT}`);
  }
  d1(_name: string): any {
    throw new Error(`this.cf.d1() — ${A2B_HINT}`);
  }
  queue<Body = unknown>(_name: string): any {
    throw new Error(`this.cf.queue() — ${A2B_HINT}`);
  }
  vectorize(_name: string): any {
    throw new Error(`this.cf.vectorize() — ${A2B_HINT}`);
  }
  do(_name: string): any {
    throw new Error(`this.cf.do() — ${A2B_HINT}`);
  }
  fetch(_input: string, _init?: unknown): Promise<unknown> {
    return Promise.reject(new Error(`this.cf.fetch() — ${A2B_HINT}`));
  }

  get ai(): any {
    return throwingProperty('ai');
  }
  get images(): any {
    return throwingProperty('images');
  }
  get browser(): any {
    return throwingProperty('browser');
  }
}

function throwingProperty(category: string): any {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      throw new Error(`this.cf.${category}.${String(prop)} — ${A2B_HINT}`);
    },
  });
}
