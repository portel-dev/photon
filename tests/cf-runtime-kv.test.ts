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

describe('CFLocalRuntime', () => {
  const baseDir = path.join(os.tmpdir(), 'photon-cf-runtime-' + Date.now());
  const rt = new CFLocalRuntime(
    'test-photon',
    {
      kv: { cache: 'cache-id' },
      r2: { photos: 'photos-id' },
      d1: { app: 'app-id' },
      queue: { uploads: 'uploads-q' },
      ai: true,
    },
    baseDir
  );

  afterAll(async () => {
    await rt.dispose();
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  describe('KV', () => {
    it('round-trips put/get', async () => {
      const ns = rt.kv('cache') as any;
      await ns.put('hello', 'world');
      expect(await ns.get('hello')).toBe('world');
    });

    it('returns null for missing keys', async () => {
      const ns = rt.kv('cache') as any;
      expect(await ns.get('missing-' + Math.random())).toBeNull();
    });

    it('throws when binding is undeclared', () => {
      expect(() => rt.kv('not-declared')).toThrow(/not declared in protected cfBindings/);
    });
  });

  describe('R2', () => {
    it('round-trips put/get on objects', async () => {
      const bucket = rt.r2('photos') as any;
      await bucket.put('greeting.txt', 'hello r2');
      const obj = await bucket.get('greeting.txt');
      expect(obj).toBeTruthy();
      const text = await obj.text();
      expect(text).toBe('hello r2');
    });

    it('lists objects under the bucket', async () => {
      const bucket = rt.r2('photos') as any;
      await bucket.put('list-test.txt', 'x');
      const listing = await bucket.list({ prefix: 'list-test' });
      expect(listing.objects.some((o: any) => o.key === 'list-test.txt')).toBe(true);
    });

    it('throws on undeclared binding', () => {
      expect(() => rt.r2('archive')).toThrow(/not declared/);
    });
  });

  describe('D1', () => {
    it('exec + prepare/bind/run round-trip', async () => {
      const db = rt.d1('app') as any;
      await db.exec('CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT);');
      await db.prepare('INSERT INTO items (name) VALUES (?)').bind('alpha').run();
      await db.prepare('INSERT INTO items (name) VALUES (?)').bind('beta').run();
      const result = await db.prepare('SELECT name FROM items ORDER BY id').all();
      const names = (result.results as { name: string }[]).map((r) => r.name);
      expect(names).toEqual(['alpha', 'beta']);
    });

    it('first() returns a single row', async () => {
      const db = rt.d1('app') as any;
      const row = await db.prepare('SELECT name FROM items ORDER BY id LIMIT 1').first();
      expect(row).toEqual({ name: 'alpha' });
    });
  });

  describe('Queue', () => {
    it('send accepts a message body', async () => {
      const q = rt.queue('uploads') as any;
      // Producer accepts the message; we just verify no throw. Consumer
      // wiring is out of scope (no consumer worker registered).
      await expect(q.send({ photo: 'a.jpg' })).resolves.not.toThrow();
    });

    it('throws on undeclared binding', () => {
      expect(() => rt.queue('unknown')).toThrow(/not declared/);
    });
  });

  describe('AI', () => {
    it('property is a usable proxy when ai: true', () => {
      // Method exists; we don't actually invoke a model in the unit test
      // because miniflare's AI binding requires a real or stubbed model
      // service. Just confirm the proxy shape.
      expect(typeof (rt.ai as any).run).toBe('function');
    });
  });

  describe('Deferred categories', () => {
    it('fetch() rejects with deferral reason', async () => {
      await expect(rt.fetch('https://x/')).rejects.toThrow(/deferred.*Phase B/);
    });

    it('browser proxy throws on access', () => {
      expect(() => (rt.browser as any).fetch('x')).toThrow(/Chromium/);
    });

    it('images throws when not declared', () => {
      // Default fixture omits images; access errors at use time.
      const rt2 = new CFLocalRuntime('p', { kv: { c: 'c' } }, baseDir);
      expect(() => (rt2.images as any).info('x')).toThrow(/declare `images: true`/);
    });
  });
});
