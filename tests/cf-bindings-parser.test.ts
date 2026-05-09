/**
 * Unit tests for parseCfBindings — recognizes a photon's
 * `protected cfBindings = { ... }` declaration and returns the literal.
 */

import { describe, it, expect } from 'vitest';
import { parseCfBindings } from '../src/cf-bindings-parser.js';

describe('parseCfBindings', () => {
  it('returns null when source has no cfBindings', () => {
    const src = `export default class Plain { async foo() { return 1; } }`;
    expect(parseCfBindings(src)).toBeNull();
  });

  it('returns null when cfBindings appears in a comment but not as a property', () => {
    const src = `// see cfBindings docs\nexport default class Plain {}`;
    // We allow false positives at the regex gate for cheapness; the AST
    // walk then finds no property and returns null.
    expect(parseCfBindings(src)).toBeNull();
  });

  it('parses named-resource bindings (r2, kv, d1, queue, vectorize)', () => {
    const src = `
      export default class Gallery {
        protected cfBindings = {
          r2: { photos: 'gallery-photos', archive: 'gallery-archive' },
          kv: { cache: 'gallery-cache' },
          d1: { app: 'gallery-app' },
          queue: { uploads: 'gallery-uploads' },
          vectorize: { embeddings: 'gallery-embeddings' },
        };
      }
    `;
    expect(parseCfBindings(src)).toEqual({
      r2: { photos: 'gallery-photos', archive: 'gallery-archive' },
      kv: { cache: 'gallery-cache' },
      d1: { app: 'gallery-app' },
      queue: { uploads: 'gallery-uploads' },
      vectorize: { embeddings: 'gallery-embeddings' },
    });
  });

  it('parses d1 entries with the { name, id } object shape', () => {
    const src = `
      export default class Gallery {
        protected cfBindings = {
          d1: {
            catalog: { name: 'gallery-catalog', id: 'abcd-1234-uuid' },
            legacy: 'legacy-db',
          },
        };
      }
    `;
    expect(parseCfBindings(src)).toEqual({
      d1: {
        catalog: { name: 'gallery-catalog', id: 'abcd-1234-uuid' },
        legacy: 'legacy-db',
      },
    });
  });

  it('parses boolean opt-ins (ai, images, browser)', () => {
    const src = `
      export default class C {
        protected cfBindings = { ai: true, images: false, browser: true };
      }
    `;
    expect(parseCfBindings(src)).toEqual({ ai: true, images: false, browser: true });
  });

  it('ignores cfBindings if not protected', () => {
    const src = `
      export default class Plain {
        cfBindings = { kv: { cache: 'x' } };
      }
    `;
    expect(parseCfBindings(src)).toBeNull();
  });

  it('ignores categories with non-object initializers', () => {
    const src = `
      export default class C {
        protected cfBindings = { kv: 'not-an-object' as any };
      }
    `;
    expect(parseCfBindings(src)).toEqual({});
  });

  it('handles quoted property names', () => {
    const src = `
      export default class C {
        protected cfBindings = { kv: { 'with-dashes': 'gallery-cache' } };
      }
    `;
    expect(parseCfBindings(src)).toEqual({ kv: { 'with-dashes': 'gallery-cache' } });
  });
});
