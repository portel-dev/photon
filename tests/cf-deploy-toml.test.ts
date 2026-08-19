/**
 * Verify the deploy adapter's wrangler.toml binding emission.
 *
 * Auto-naming convention: each photon contributes binding entries
 * derived from its source. `cf.kv()` → `<photon>_kv`,
 * `cf.kv('cache')` → `<photon>_cache_kv`, etc. Resource ids default
 * to the binding name (works for `wrangler d1 create`-style preflows
 * + miniflare); `protected cfBindings` overrides repoint specific
 * qualifiers at pre-existing CF resources.
 *
 * These tests exercise the production `renderCfBindingsToml` (exported
 * from src/deploy/cloudflare.ts) end-to-end so test + production stay
 * locked together — the previous setup duplicated the formatter into
 * the test file, which let the two drift.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  renderCfBindingsToml,
  renderCloudflareRouteConfig,
  reconcileCloudflareDurableObjectMigrationArtifacts,
  parseCloudflareDurableObjectVersion,
  selectLatestCloudflareVersion,
  ensureNewCloudflareVersion,
} from '../src/deploy/cloudflare.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cf-deploy-toml-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('CF deploy autogen — auto-naming', () => {
  it('emits <photon>_kv for cf.kv() default call', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [{ name: 'gallery', source: `class X { async f() { await this.cf.kv().get('a'); } }` }],
        'gallery',
        dir
      )
    );
    expect(out).toContain('[[kv_namespaces]]');
    expect(out).toContain('binding = "gallery_kv"');
    expect(out).toContain('id = "gallery_kv"');
  });

  it('emits <photon>_<qualifier>_kv for qualified calls', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [
          {
            name: 'gallery',
            source: `class X { async f() {
              await this.cf.kv('cache').get('a');
              await this.cf.kv('sessions').get('b');
            } }`,
          },
        ],
        'gallery',
        dir
      )
    );
    expect(out).toContain('binding = "gallery_cache_kv"');
    expect(out).toContain('binding = "gallery_sessions_kv"');
  });

  it('emits r2 / d1 / queue / vectorize with auto-naming', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [
          {
            name: 'gallery',
            source: `class X { async f() {
              await this.cf.r2().put('a','b');
              await this.cf.d1().exec('select 1');
              await this.cf.queue().send({});
              await this.cf.vectorize().query([], {});
            } }`,
          },
        ],
        'gallery',
        dir
      )
    );
    expect(out).toContain('[[r2_buckets]]\nbinding = "gallery_r2"');
    expect(out).toContain('[[d1_databases]]\nbinding = "gallery_d1"');
    expect(out).toContain('database_name = "gallery_d1"');
    expect(out).toContain('database_id = "gallery_d1"');
    expect(out).toContain('[[queues.producers]]\nbinding = "gallery_queue"');
    expect(out).toContain('[[vectorize]]\nbinding = "gallery_vectorize"');
  });

  it('emits shared [ai] / [images] / [browser] when referenced', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [
          {
            name: 'agent',
            source: `class X { async f() {
              await this.cf.ai.run('@cf/foo', {});
              this.cf.images.info(null);
              this.cf.browser.fetch('http://x');
            } }`,
          },
        ],
        'agent',
        dir
      )
    );
    expect(out).toContain('[ai]\nbinding = "AI"');
    expect(out).toContain('[images]\nbinding = "IMAGES"');
    expect(out).toContain('[browser]\nbinding = "BROWSER"');
  });

  it('does NOT emit shared blocks when no photon references them', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [{ name: 'silent', source: `class X { async f() { await this.cf.kv().get('a'); } }` }],
        'silent',
        dir
      )
    );
    expect(out).not.toContain('[ai]');
    expect(out).not.toContain('[images]');
    expect(out).not.toContain('[browser]');
  });

  it('returns empty string when no photon uses CF', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [{ name: 'plain', source: `class X { async ping() { return 'pong'; } }` }],
        'plain',
        dir
      )
    );
    expect(out).toBe('');
  });

  it('protected cfBindings override repoints a specific qualifier resource', async () => {
    const source = `
      class X {
        protected cfBindings = {
          d1: { default: { name: 'real-app-db', id: 'abcd-1234' } },
        };
        async f() { await this.cf.d1().exec('select 1'); }
      }
    `;
    const out = await withTempDir((dir) =>
      renderCfBindingsToml([{ name: 'app', source }], 'app', dir)
    );
    expect(out).toContain('binding = "app_d1"');
    expect(out).toContain('database_name = "real-app-db"');
    expect(out).toContain('database_id = "abcd-1234"');
  });

  it('per-photon override JSON layered on top of source declarations', async () => {
    const source = `class X { async f() { await this.cf.r2().put('k','v'); } }`;
    const out = await withTempDir(async (dir) => {
      const overrideDir = path.join(dir, '.data', 'cf-overrides');
      await fs.mkdir(overrideDir, { recursive: true });
      await fs.writeFile(
        path.join(overrideDir, 'gallery.json'),
        JSON.stringify({ r2: { default: 'org-shared-photos' } })
      );
      return renderCfBindingsToml([{ name: 'gallery', source }], 'gallery', dir);
    });
    expect(out).toContain('binding = "gallery_r2"');
    expect(out).toContain('bucket_name = "org-shared-photos"');
  });

  it('multi-photon: each photon contributes its own auto-named bindings', async () => {
    const out = await withTempDir((dir) =>
      renderCfBindingsToml(
        [
          { name: 'gallery', source: `class A { async f() { await this.cf.kv().get('a'); } }` },
          { name: 'notes', source: `class B { async f() { await this.cf.r2().put('a','b'); } }` },
        ],
        'gallery',
        dir
      )
    );
    expect(out).toContain('binding = "gallery_kv"');
    expect(out).toContain('binding = "notes_r2"');
  });
});

describe('CF deploy version inspection', () => {
  it('reads Durable Object classes from Wrangler JSON metadata', () => {
    expect(
      parseCloudflareDurableObjectVersion(
        JSON.stringify({
          resources: {
            script: {
              bindings: [
                {
                  name: 'PHOTON',
                  type: 'durable_object_namespace',
                  class_name: 'AppointmentsPhotonDO_v3',
                },
              ],
            },
          },
        })
      )
    ).toEqual({ PHOTON: 'AppointmentsPhotonDO_v3' });
  });

  it('reads Durable Object classes from the Cloudflare API binding shape', () => {
    expect(
      parseCloudflareDurableObjectVersion(
        JSON.stringify({
          resources: {
            script: { bindings: [] },
            bindings: [
              {
                name: 'PHOTON',
                type: 'durable_object_namespace',
                class_name: 'AppointmentsPhotonDO_v3',
              },
            ],
          },
        })
      )
    ).toEqual({ PHOTON: 'AppointmentsPhotonDO_v3' });
  });

  it('keeps a text-output fallback for older Wrangler versions', () => {
    expect(
      parseCloudflareDurableObjectVersion(
        'env.PHOTON (AppointmentsPhotonDO_v3)      Durable Object'
      )
    ).toEqual({ PHOTON: 'AppointmentsPhotonDO_v3' });
  });
});

describe('CF deploy — Durable Object migration compatibility', () => {
  it('preserves an existing v3 class migration chain during redeploy', () => {
    const result = reconcileCloudflareDurableObjectMigrationArtifacts(
      `[[durable_objects.bindings]]\nname = "PHOTON"\nclass_name = "AppointmentsPhotonDO"\n\n[[migrations]]\ntag = "v1"\nnew_sqlite_classes = ["AppointmentsPhotonDO"]\n`,
      'export class AppointmentsPhotonDO extends BasePhotonDO {}',
      [{ binding: 'PHOTON', doClass: 'AppointmentsPhotonDO' }],
      { PHOTON: 'AppointmentsPhotonDO_v3' }
    );

    expect(result.changed).toBe(true);
    expect(result.wranglerConfig).toContain('class_name = "AppointmentsPhotonDO_v3"');
    expect(result.wranglerConfig).toContain('tag = "v2"');
    expect(result.wranglerConfig).toContain('tag = "v3"');
    expect(result.workerCode).toContain(
      'export class AppointmentsPhotonDO_v3 extends BasePhotonDO'
    );
  });

  it('leaves first-time and already-canonical deployments unchanged', () => {
    const config = 'class_name = "GalleryPhotonDO"';
    const code = 'export class GalleryPhotonDO extends BasePhotonDO {}';
    expect(
      reconcileCloudflareDurableObjectMigrationArtifacts(
        config,
        code,
        [{ binding: 'PHOTON', doClass: 'GalleryPhotonDO' }],
        {}
      )
    ).toEqual({ wranglerConfig: config, workerCode: code, changed: false });
    expect(
      reconcileCloudflareDurableObjectMigrationArtifacts(
        config,
        code,
        [{ binding: 'PHOTON', doClass: 'GalleryPhotonDO' }],
        { PHOTON: 'GalleryPhotonDO' }
      )
    ).toEqual({ wranglerConfig: config, workerCode: code, changed: false });
  });
});

describe('CF deploy version promotion', () => {
  it('selects the newest uploaded version by creation time', () => {
    const latest = selectLatestCloudflareVersion(
      `wrangler notice\n${JSON.stringify([
        { id: 'older', metadata: { created_on: '2026-08-11T16:00:00.000Z' } },
        { id: 'newer', metadata: { created_on: '2026-08-11T16:21:35.740Z' } },
      ])}`
    );
    expect(latest).toBe('newer');
  });

  it('ignores bunx progress arrays before the Wrangler payload', () => {
    const latest = selectLatestCloudflareVersion(
      `Resolving dependencies\nResolved, downloaded and extracted [2]\n${JSON.stringify([
        { id: 'older', metadata: { created_on: '2026-08-11T16:00:00.000Z' } },
        { id: 'newer', metadata: { created_on: '2026-08-11T16:21:35.740Z' } },
      ])}`
    );
    expect(latest).toBe('newer');
  });

  it('rejects malformed or empty version lists', () => {
    expect(() => selectLatestCloudflareVersion('not json')).toThrow(/parse Wrangler version list/);
    expect(() => selectLatestCloudflareVersion('[]')).toThrow(/no deployable Worker versions/);
  });

  it('never re-promotes the version that existed before upload', () => {
    expect(ensureNewCloudflareVersion('newer', 'older')).toBe('newer');
    expect(() => ensureNewCloudflareVersion('older', 'older')).toThrow(/not exposed/);
  });
});

describe('CF deploy route reconciliation', () => {
  it('records the exact zone route behind a custom domain', () => {
    const route = renderCloudflareRouteConfig({
      photonPath: '/tmp/consult.photon.ts',
      customDomain: 'consult.arul.sg',
    });
    expect(route.reconcile).toEqual({
      pattern: 'consult.arul.sg/*',
      zoneName: 'arul.sg',
    });
  });

  it('records an explicit route pattern without changing its wildcard', () => {
    const route = renderCloudflareRouteConfig({
      photonPath: '/tmp/consult.photon.ts',
      routePattern: 'consult.arul.sg/*',
    });
    expect(route.reconcile).toEqual({
      pattern: 'consult.arul.sg/*',
      zoneName: 'arul.sg',
    });
  });
});
