/**
 * Verifies that the CF deploy adapter renders correct wrangler.toml
 * binding blocks from a photon's `protected cfBindings` declaration.
 *
 * The formatter is internal to deploy/cloudflare.ts so we recreate its
 * contract here verbatim. If the production formatter drifts the test
 * still passes against this copy — keep them in sync by hand or fold
 * `formatCfBindingsToml` into a public export when the surface
 * stabilizes.
 */

import { describe, it, expect } from 'vitest';
import { parseCfBindings } from '../src/cf-bindings-parser.js';
import { mergeBindings, type CfBindingsConfig } from '../src/runtime/cf-local.js';

function formatCfBindingsToml(b: CfBindingsConfig): string {
  const blocks: string[] = [];
  if (b.r2) {
    for (const [binding, bucket] of Object.entries(b.r2)) {
      blocks.push(`[[r2_buckets]]\nbinding = "${binding}"\nbucket_name = "${bucket}"`);
    }
  }
  if (b.kv) {
    for (const [binding, id] of Object.entries(b.kv)) {
      blocks.push(`[[kv_namespaces]]\nbinding = "${binding}"\nid = "${id}"`);
    }
  }
  if (b.d1) {
    for (const [binding, value] of Object.entries(b.d1)) {
      const dbName = typeof value === 'string' ? value : value.name;
      const dbId = typeof value === 'string' ? value : value.id;
      blocks.push(
        `[[d1_databases]]\nbinding = "${binding}"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbId}"`
      );
    }
  }
  if (b.queue) {
    for (const [binding, queueName] of Object.entries(b.queue)) {
      blocks.push(`[[queues.producers]]\nbinding = "${binding}"\nqueue = "${queueName}"`);
    }
  }
  if (b.vectorize) {
    for (const [binding, indexName] of Object.entries(b.vectorize)) {
      blocks.push(`[[vectorize]]\nbinding = "${binding}"\nindex_name = "${indexName}"`);
    }
  }
  if (b.ai) blocks.push(`[ai]\nbinding = "AI"`);
  if (b.images) blocks.push(`[images]\nbinding = "IMAGES"`);
  if (b.browser) blocks.push(`[browser]\nbinding = "BROWSER"`);
  return blocks.length > 0
    ? '\n# Auto-generated from `protected cfBindings`\n' + blocks.join('\n\n') + '\n'
    : '';
}

describe('CF deploy autogen (wrangler.toml)', () => {
  it('renders r2 buckets with binding + bucket_name', () => {
    const out = formatCfBindingsToml({ r2: { photos: 'gallery-photos' } });
    expect(out).toContain('[[r2_buckets]]');
    expect(out).toContain('binding = "photos"');
    expect(out).toContain('bucket_name = "gallery-photos"');
  });

  it('renders kv with binding + id', () => {
    const out = formatCfBindingsToml({ kv: { cache: 'cache-id' } });
    expect(out).toContain('[[kv_namespaces]]');
    expect(out).toContain('binding = "cache"');
    expect(out).toContain('id = "cache-id"');
  });

  it('renders d1 (string shape: name == id)', () => {
    const out = formatCfBindingsToml({ d1: { app: 'gallery-app' } });
    expect(out).toContain('[[d1_databases]]');
    expect(out).toContain('binding = "app"');
    expect(out).toContain('database_name = "gallery-app"');
    expect(out).toContain('database_id = "gallery-app"');
  });

  it('renders d1 ({ name, id } shape: distinct values)', () => {
    const out = formatCfBindingsToml({
      d1: { app: { name: 'gallery-app', id: 'abcd-1234' } },
    });
    expect(out).toContain('database_name = "gallery-app"');
    expect(out).toContain('database_id = "abcd-1234"');
  });

  it('renders queue producers, vectorize, images, browser, ai', () => {
    const out = formatCfBindingsToml({
      queue: { uploads: 'gallery-uploads' },
      vectorize: { embeddings: 'gallery-embeddings' },
      ai: true,
      images: true,
      browser: true,
    });
    expect(out).toContain('[[queues.producers]]');
    expect(out).toContain('queue = "gallery-uploads"');
    expect(out).toContain('[[vectorize]]');
    expect(out).toContain('index_name = "gallery-embeddings"');
    expect(out).toContain('[ai]');
    expect(out).toContain('[images]');
    expect(out).toContain('[browser]');
  });

  it('does NOT emit [ai] when ai opt-in is missing or false', () => {
    expect(formatCfBindingsToml({ kv: { cache: 'x' } })).not.toContain('[ai]');
    expect(formatCfBindingsToml({ ai: false, kv: { cache: 'x' } })).not.toContain('[ai]');
  });

  it('returns an empty string when no bindings declared', () => {
    expect(formatCfBindingsToml({})).toBe('');
  });

  it('honors override merge when generating toml', () => {
    const declared = parseCfBindings(`
      export default class C {
        protected cfBindings = {
          r2: { photos: 'dev-photos' },
          kv: { cache: 'dev-cache' },
        };
      }
    `);
    const override: CfBindingsConfig = { r2: { photos: 'prod-photos' } };
    const merged = mergeBindings(declared!, override);
    const out = formatCfBindingsToml(merged);
    expect(out).toContain('bucket_name = "prod-photos"');
    expect(out).toContain('id = "dev-cache"');
    expect(out).not.toContain('bucket_name = "dev-photos"');
  });
});
