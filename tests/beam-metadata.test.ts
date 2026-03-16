/**
 * Tests for beam class-metadata pure functions.
 */

import { strict as assert } from 'assert';
import {
  extractClassMetadataFromSource,
  applyMethodVisibility,
  extractCspFromSource,
  prettifyName,
  prettifyToolName,
  backfillEnvDefaults,
} from '../src/auto-ui/beam/class-metadata.js';

console.log('Running Beam Class Metadata Tests...\n');

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ═══════════════════════════════════════════════════════════════════
// extractClassMetadataFromSource
// ═══════════════════════════════════════════════════════════════════

console.log('extractClassMetadataFromSource');

await test('full JSDoc with all tags', () => {
  const source = `
/**
 * A cool photon
 * @icon rocket
 * @internal
 * @version 2.1.0
 * @author Jane Doe
 * @label My Photon
 * @description Does amazing things
 */
class MyPhoton {}
`;
  const meta = extractClassMetadataFromSource(source);
  assert.equal(meta.icon, 'rocket');
  assert.equal(meta.internal, true);
  assert.equal(meta.version, '2.1.0');
  assert.equal(meta.author, 'Jane Doe');
  assert.equal(meta.label, 'My Photon');
  assert.equal(meta.description, 'Does amazing things');
});

await test('minimal JSDoc - description from first line, no tags', () => {
  const source = `
/**
 * Simple description only
 */
class Foo {}
`;
  const meta = extractClassMetadataFromSource(source);
  assert.equal(meta.description, 'Simple description only');
  assert.equal(meta.icon, undefined);
  assert.equal(meta.internal, undefined);
  assert.equal(meta.version, undefined);
  assert.equal(meta.author, undefined);
  assert.equal(meta.label, undefined);
});

await test('empty content returns empty object', () => {
  const meta = extractClassMetadataFromSource('');
  assert.deepEqual(meta, {});
});

await test('@internal boolean flag detection', () => {
  const source = `
/**
 * Hidden photon
 * @internal
 */
class Secret {}
`;
  const meta = extractClassMetadataFromSource(source);
  assert.equal(meta.internal, true);
});

await test('description from first line when no @description tag', () => {
  const source = `
/**
 * First line is the description
 * @version 1.0.0
 */
class Described {}
`;
  const meta = extractClassMetadataFromSource(source);
  assert.equal(meta.description, 'First line is the description');
  assert.equal(meta.version, '1.0.0');
});

await test('JSDoc before export default class', () => {
  const source = `
/**
 * Exported default photon
 * @icon star
 */
export default class DefaultPhoton {}
`;
  const meta = extractClassMetadataFromSource(source);
  assert.equal(meta.description, 'Exported default photon');
  assert.equal(meta.icon, 'star');
});

// ═══════════════════════════════════════════════════════════════════
// applyMethodVisibility
// ═══════════════════════════════════════════════════════════════════

console.log('\napplyMethodVisibility');

await test('method with @visibility model,app', () => {
  const source = `
class Foo {
  /**
   * A method
   * @visibility model,app
   */
  doStuff() {}
}
`;
  const methods: any[] = [{ name: 'doStuff', description: '', params: {}, returns: {} }];
  applyMethodVisibility(source, methods);
  assert.deepEqual(methods[0].visibility, ['model', 'app']);
});

await test('method with @visibility model only', () => {
  const source = `
class Foo {
  /**
   * @visibility model
   */
  hidden() {}
}
`;
  const methods: any[] = [{ name: 'hidden', description: '', params: {}, returns: {} }];
  applyMethodVisibility(source, methods);
  assert.deepEqual(methods[0].visibility, ['model']);
});

await test('method without @visibility stays unchanged', () => {
  const source = `
class Foo {
  /** No visibility */
  plain() {}
}
`;
  const methods: any[] = [{ name: 'plain', description: '', params: {}, returns: {} }];
  applyMethodVisibility(source, methods);
  assert.equal(methods[0].visibility, undefined);
});

await test('invalid visibility values filtered out', () => {
  const source = `
class Foo {
  /**
   * @visibility model,bogus,app
   */
  mixed() {}
}
`;
  const methods: any[] = [{ name: 'mixed', description: '', params: {}, returns: {} }];
  applyMethodVisibility(source, methods);
  assert.deepEqual(methods[0].visibility, ['model', 'app']);
});

await test('works with async methods', () => {
  const source = `
class Foo {
  /**
   * @visibility app
   */
  async fetch() {}
}
`;
  const methods: any[] = [{ name: 'fetch', description: '', params: {}, returns: {} }];
  applyMethodVisibility(source, methods);
  assert.deepEqual(methods[0].visibility, ['app']);
});

await test('works with generator methods', () => {
  const source = `
class Foo {
  /**
   * @visibility model
   */
  *stream() {}
}
`;
  const methods: any[] = [{ name: 'stream', description: '', params: {}, returns: {} }];
  applyMethodVisibility(source, methods);
  assert.deepEqual(methods[0].visibility, ['model']);
});

// ═══════════════════════════════════════════════════════════════════
// extractCspFromSource
// ═══════════════════════════════════════════════════════════════════

console.log('\nextractCspFromSource');

await test('@csp connect → connectDomains', () => {
  const source = `
/**
 * @csp connect api.example.com
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, { __class__: { connectDomains: ['api.example.com'] } });
});

await test('@csp resource → resourceDomains', () => {
  const source = `
/**
 * @csp resource cdn.example.com
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, { __class__: { resourceDomains: ['cdn.example.com'] } });
});

await test('@csp frame → frameDomains', () => {
  const source = `
/**
 * @csp frame embed.example.com
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, { __class__: { frameDomains: ['embed.example.com'] } });
});

await test('@csp base-uri → baseUriDomains', () => {
  const source = `
/**
 * @csp base-uri example.com
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, { __class__: { baseUriDomains: ['example.com'] } });
});

await test('multiple @csp tags combined', () => {
  const source = `
/**
 * @csp connect api.example.com
 * @csp resource cdn.example.com
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, {
    __class__: {
      connectDomains: ['api.example.com'],
      resourceDomains: ['cdn.example.com'],
    },
  });
});

await test('multiple domains comma-separated', () => {
  const source = `
/**
 * @csp connect api.one.com,api.two.com
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, { __class__: { connectDomains: ['api.one.com', 'api.two.com'] } });
});

await test('no @csp returns empty object', () => {
  const source = `
/**
 * No CSP here
 */
class Foo {}
`;
  const csp = extractCspFromSource(source);
  assert.deepEqual(csp, {});
});

// ═══════════════════════════════════════════════════════════════════
// prettifyName
// ═══════════════════════════════════════════════════════════════════

console.log('\nprettifyName');

await test('"filesystem" → "Filesystem"', () => {
  assert.equal(prettifyName('filesystem'), 'Filesystem');
});

await test('"git-box" → "Git Box"', () => {
  assert.equal(prettifyName('git-box'), 'Git Box');
});

await test('"my-cool-tool" → "My Cool Tool"', () => {
  assert.equal(prettifyName('my-cool-tool'), 'My Cool Tool');
});

// ═══════════════════════════════════════════════════════════════════
// prettifyToolName
// ═══════════════════════════════════════════════════════════════════

console.log('\nprettifyToolName');

await test('"get_status" → "Get Status"', () => {
  assert.equal(prettifyToolName('get_status'), 'Get Status');
});

await test('"read-file" → "Read File"', () => {
  assert.equal(prettifyToolName('read-file'), 'Read File');
});

await test('"simple" → "Simple"', () => {
  assert.equal(prettifyToolName('simple'), 'Simple');
});

// ═══════════════════════════════════════════════════════════════════
// backfillEnvDefaults
// ═══════════════════════════════════════════════════════════════════

console.log('\nbackfillEnvDefaults');

await test('sets env var when not already set and param has default', () => {
  const envKey = 'TEST_BACKFILL_SET_' + Date.now();
  delete process.env[envKey];
  const instance = { myProp: 'hello' };
  backfillEnvDefaults(instance, [{ name: 'myProp', envVar: envKey, hasDefault: true }]);
  assert.equal(process.env[envKey], 'hello');
  delete process.env[envKey];
});

await test('does NOT overwrite existing env var', () => {
  const envKey = 'TEST_BACKFILL_EXIST_' + Date.now();
  process.env[envKey] = 'original';
  const instance = { myProp: 'new-value' };
  backfillEnvDefaults(instance, [{ name: 'myProp', envVar: envKey, hasDefault: true }]);
  assert.equal(process.env[envKey], 'original');
  delete process.env[envKey];
});

await test('handles object values via JSON.stringify', () => {
  const envKey = 'TEST_BACKFILL_OBJ_' + Date.now();
  delete process.env[envKey];
  const instance = { config: { a: 1, b: 2 } };
  backfillEnvDefaults(instance, [{ name: 'config', envVar: envKey, hasDefault: true }]);
  assert.equal(process.env[envKey], '{"a":1,"b":2}');
  delete process.env[envKey];
});

await test('handles null/undefined values by skipping', () => {
  const envKey1 = 'TEST_BACKFILL_NULL_' + Date.now();
  const envKey2 = 'TEST_BACKFILL_UNDEF_' + Date.now();
  delete process.env[envKey1];
  delete process.env[envKey2];
  const instance = { a: null, b: undefined };
  backfillEnvDefaults(instance, [
    { name: 'a', envVar: envKey1, hasDefault: true },
    { name: 'b', envVar: envKey2, hasDefault: true },
  ]);
  assert.equal(process.env[envKey1], undefined);
  assert.equal(process.env[envKey2], undefined);
});

// ═══════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════

console.log(`\nBeam metadata tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
