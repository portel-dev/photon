/**
 * Pin the source-scanner contract: it MUST recognize every shape an
 * author can use to access the injected `Cloudflare` surface, and it
 * MUST collect literal qualifiers per scoped category. Both miniflare
 * (local boot) and wrangler.toml (deploy) consume this output, so a
 * silent miss here means a binding is never declared and the photon
 * fails at runtime — which is exactly the bug class this scanner
 * exists to prevent.
 */

import { describe, it, expect } from 'vitest';
import {
  scanCfUsage,
  expandScopedBindingNames,
  SCOPED_CATEGORIES,
} from '../src/cf-usage-scanner.js';

const PHOTON = 'gallery';

describe('scanCfUsage — access paths', () => {
  it('recognizes `private cf: Cloudflare` parameter property', () => {
    const usage = scanCfUsage(`
      import type { Cloudflare } from '@portel/photon';
      export default class Gallery {
        constructor(private cf: Cloudflare) {}
        async upload() { await this.cf.r2().put('a', 'b'); }
      }
    `);
    expect(usage.accessPaths.has('cf')).toBe(true);
    expect(usage.qualifiers.r2.has('')).toBe(true);
  });

  it('recognizes a custom parameter name typed Cloudflare', () => {
    const usage = scanCfUsage(`
      import type { Cloudflare } from '@portel/photon';
      export default class Gallery {
        constructor(private xCloud: Cloudflare) {}
        async upload() { await this.xCloud.kv('cache').put('k', 'v'); }
      }
    `);
    expect(usage.accessPaths.has('xCloud')).toBe(true);
    expect(usage.qualifiers.kv.has('cache')).toBe(true);
  });

  it('still recognizes `this.cf.*` on a plain class (forgiving auto-inject)', () => {
    // No constructor parameter — the loader's forgiving auto-inject
    // populates `this.cf` post-construction. The scanner must still
    // see these calls so miniflare gets seeded.
    const usage = scanCfUsage(`
      export default class Gallery {
        async upload() { await this.cf.r2('photos').put('a', 'b'); }
      }
    `);
    expect(usage.accessPaths.has('cf')).toBe(true);
    expect(usage.qualifiers.r2.has('photos')).toBe(true);
  });
});

describe('scanCfUsage — qualifier collection', () => {
  it('default call (no args) records empty-string qualifier', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() { await this.cf.kv().get('a'); }
      }
    `);
    expect([...usage.qualifiers.kv]).toEqual(['']);
  });

  it('multiple literal qualifiers are deduped per category', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() {
          await this.cf.kv('cache').get('a');
          await this.cf.kv('sessions').get('b');
          await this.cf.kv('cache').delete('a');
        }
      }
    `);
    expect([...usage.qualifiers.kv].sort()).toEqual(['cache', 'sessions']);
  });

  it('dynamic qualifier is flagged and falls back to default name', () => {
    const usage = scanCfUsage(`
      export default class X {
        tenantId = 'foo';
        async run() { await this.cf.kv(this.tenantId).get('a'); }
      }
    `);
    expect(usage.dynamicQualifiers.has('kv')).toBe(true);
    expect(usage.qualifiers.kv.has('')).toBe(true);
  });

  it('qualifiers are tracked per category independently', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() {
          await this.cf.kv('cache').get('a');
          await this.cf.r2('photos').put('a', 'b');
          await this.cf.d1().prepare('select 1');
        }
      }
    `);
    expect([...usage.qualifiers.kv]).toEqual(['cache']);
    expect([...usage.qualifiers.r2]).toEqual(['photos']);
    expect([...usage.qualifiers.d1]).toEqual(['']);
    expect([...usage.qualifiers.queue]).toEqual([]);
  });
});

describe('scanCfUsage — shared categories', () => {
  it('detects ai, images, browser via property access', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() {
          await this.cf.ai.run('@cf/foo', {});
          this.cf.images.info(null as any);
          this.cf.browser.fetch('http://x');
        }
      }
    `);
    expect(usage.shared.ai).toBe(true);
    expect(usage.shared.images).toBe(true);
    expect(usage.shared.browser).toBe(true);
  });

  it('does not falsely match unrelated property names', () => {
    const usage = scanCfUsage(`
      export default class X {
        ai = { run: () => null };
        async test() { this.ai.run(); }
      }
    `);
    expect(usage.shared.ai).toBe(false);
  });
});

describe('scanCfUsage — type-cast access shapes', () => {
  it('handles (this as any).cf.kv()', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() { await (this as any).cf.kv('cache').get('a'); }
      }
    `);
    expect(usage.qualifiers.kv.has('cache')).toBe(true);
  });

  it('handles (this as unknown as { cf: any }).cf.r2()', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() {
          await (this as unknown as { cf: any }).cf.r2('photos').put('a', 'b');
        }
      }
    `);
    expect(usage.qualifiers.r2.has('photos')).toBe(true);
  });
});

describe('expandScopedBindingNames', () => {
  it('emits <photon>_<category> for the default qualifier', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() { await this.cf.kv().get('a'); }
      }
    `);
    expect(expandScopedBindingNames(PHOTON, usage).kv).toEqual(['gallery_kv']);
  });

  it('emits <photon>_<qualifier>_<category> for qualified calls', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() {
          await this.cf.kv('cache').get('a');
          await this.cf.kv('sessions').get('b');
        }
      }
    `);
    const names = expandScopedBindingNames(PHOTON, usage).kv.sort();
    expect(names).toEqual(['gallery_cache_kv', 'gallery_sessions_kv']);
  });

  it('mixes default + qualified for the same category', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() {
          await this.cf.kv().get('a');
          await this.cf.kv('cache').get('b');
        }
      }
    `);
    const names = expandScopedBindingNames(PHOTON, usage).kv.sort();
    expect(names).toEqual(['gallery_cache_kv', 'gallery_kv']);
  });

  it('returns empty arrays for categories the photon does not use', () => {
    const usage = scanCfUsage(`export default class X { async ping() {} }`);
    for (const cat of SCOPED_CATEGORIES) {
      expect(expandScopedBindingNames(PHOTON, usage)[cat]).toEqual([]);
    }
  });

  it('hyphenated photon names normalize to underscores in output', () => {
    const usage = scanCfUsage(`
      export default class X {
        async run() { await this.cf.kv().get('a'); }
      }
    `);
    expect(expandScopedBindingNames('my-photon', usage).kv).toEqual(['my_photon_kv']);
  });
});

describe('scanCfUsage — empty source / non-CF photons', () => {
  it('returns empty qualifiers for a photon with no CF usage', () => {
    const usage = scanCfUsage(`
      export default class X {
        async ping() { return 'pong'; }
      }
    `);
    for (const cat of SCOPED_CATEGORIES) {
      expect([...usage.qualifiers[cat]]).toEqual([]);
    }
    expect(usage.shared.ai).toBe(false);
  });

  it('handles empty source without throwing', () => {
    expect(() => scanCfUsage('')).not.toThrow();
  });
});
