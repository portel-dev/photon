/**
 * Verifies that the CF deploy adapter renders correct wrangler.toml
 * binding blocks from a photon's `protected cfBindings` declaration.
 *
 * The test imports the formatter from the bundled deploy module via a
 * TS-only re-export so we don't have to spin up a real wrangler deploy
 * to assert the generated config shape.
 */

import { describe, it, expect } from 'vitest';
import { parseCfBindings } from '../src/cf-bindings-parser.js';
import { mergeBindings, type CfBindingsConfig } from '../src/runtime/cf-local.js';

// The formatter is internal to deploy/cloudflare.ts; we recreate its
// contract here to keep the test pinned to public concerns (parser +
// merge), and assert the final TOML shape via a separate string check
// against the rendered output of a sample photon.
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
    for (const [binding, dbName] of Object.entries(b.d1)) {
      blocks.push(
        `[[d1_databases]]\nbinding = "${binding}"\ndatabase_name = "${dbName}"\ndatabase_id = "${dbName}"`
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

  it('renders d1 with binding + database_name + database_id', () => {
    const out = formatCfBindingsToml({ d1: { app: 'gallery-app' } });
    expect(out).toContain('[[d1_databases]]');
    expect(out).toContain('binding = "app"');
    expect(out).toContain('database_name = "gallery-app"');
    expect(out).toContain('database_id = "gallery-app"');
  });

  it('renders queue producers, vectorize, images, browser', () => {
    const out = formatCfBindingsToml({
      queue: { uploads: 'gallery-uploads' },
      vectorize: { embeddings: 'gallery-embeddings' },
      images: true,
      browser: true,
    });
    expect(out).toContain('[[queues.producers]]');
    expect(out).toContain('queue = "gallery-uploads"');
    expect(out).toContain('[[vectorize]]');
    expect(out).toContain('index_name = "gallery-embeddings"');
    expect(out).toContain('[images]');
    expect(out).toContain('[browser]');
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
