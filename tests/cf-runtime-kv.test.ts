/**
 * Unit tests for CFLocalRuntime — the miniflare-backed local adapter.
 *
 * Loader integration is covered by a CLI smoke (run `photon cli cf-kv-min
 * put/get` after build); the loader path can't run inside vitest because
 * tsx/esbuild's transform service collides with vitest's own one.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { CFLocalRuntime } from '../src/runtime/cf-local.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('CFLocalRuntime — KV', () => {
  const baseDir = path.join(os.tmpdir(), 'photon-cf-runtime-' + Date.now());
  const rt = new CFLocalRuntime('test-photon', { kv: { cache: 'cache-id' } }, baseDir);

  afterAll(async () => {
    await rt.dispose();
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('round-trips put/get through miniflare KV', async () => {
    const ns = rt.kv('cache') as {
      put: (k: string, v: string) => Promise<void>;
      get: (k: string) => Promise<string | null>;
    };
    await ns.put('hello', 'world');
    const got = await ns.get('hello');
    expect(got).toBe('world');
  });

  it('returns null for missing keys', async () => {
    const ns = rt.kv('cache') as { get: (k: string) => Promise<string | null> };
    const got = await ns.get('definitely-missing-' + Math.random());
    expect(got).toBeNull();
  });

  it('throws when calling an undeclared KV binding', () => {
    expect(() => rt.kv('not-declared')).toThrow(/not declared in protected cfBindings/);
  });

  it('throws "lands in A2b" for non-KV categories', () => {
    expect(() => rt.r2('any')).toThrow(/A2b/);
    expect(() => rt.d1('any')).toThrow(/A2b/);
    expect(() => rt.queue('any')).toThrow(/A2b/);
    expect(() => rt.vectorize('any')).toThrow(/A2b/);
    expect(() => rt.do('any')).toThrow(/A2b/);
  });

  it('throws "lands in A2b" for property-style categories on access', () => {
    expect(() => (rt.ai as any).run('@cf/foo')).toThrow(/A2b/);
    expect(() => (rt.images as any).info('x')).toThrow(/A2b/);
    expect(() => (rt.browser as any).fetch('https://x/')).toThrow(/A2b/);
  });
});
