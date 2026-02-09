/**
 * Sync Photon Tests
 *
 * Ensures photons work without async methods, without PhotonMCP base class,
 * and with simple typed parameters (not just object params).
 *
 * Run: npx tsx tests/sync-photon.test.ts
 */

import { strict as assert } from 'assert';
import { PhotonLoader } from '../src/loader.js';
import { SchemaExtractor, findPhotonClass, hasMethods, isClass } from '@portel/photon-core';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`  ✅ ${name}`);
    },
    (err) => {
      failed++;
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  );
}

async function run() {
  console.log('\n📦 Class Detection — Sync Classes\n');

  await test('isClass accepts sync class', () => {
    class Foo {
      bar() {}
    }
    assert.ok(isClass(Foo));
  });

  await test('hasMethods detects sync methods', () => {
    class Foo {
      bar() {}
      baz() {}
    }
    assert.ok(hasMethods(Foo));
  });

  await test('findPhotonClass accepts sync default export', () => {
    class SyncList {
      add(item: string) {}
      remove(item: string) {}
    }
    const mod = { default: SyncList } as any;
    assert.strictEqual(findPhotonClass(mod), SyncList);
  });

  await test('findPhotonClass accepts sync named export', () => {
    class SyncList {
      add() {}
    }
    const mod = { SyncList } as any;
    assert.strictEqual(findPhotonClass(mod), SyncList);
  });

  console.log('\n📦 Schema Extractor — Simple Typed Parameters\n');

  const extractor = new SchemaExtractor();

  await test('extracts single simple param: add(item: string)', () => {
    const source = `
      export default class List {
        add(item: string): void {}
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'add');
    assert.deepStrictEqual(result.tools[0].inputSchema.properties, { item: { type: 'string' } });
    assert.deepStrictEqual(result.tools[0].inputSchema.required, ['item']);
  });

  await test('extracts multiple simple params: multiply(a: number, b: number)', () => {
    const source = `
      export default class Calc {
        multiply(a: number, b: number): number { return 0; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.equal(tool.name, 'multiply');
    assert.deepStrictEqual(tool.inputSchema.properties, {
      a: { type: 'number' },
      b: { type: 'number' },
    });
    assert.deepStrictEqual(tool.inputSchema.required, ['a', 'b']);
  });

  await test('handles optional simple param: greet(name: string, loud?: boolean)', () => {
    const source = `
      export default class Greeter {
        greet(name: string, loud?: boolean): string { return ''; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.deepStrictEqual(tool.inputSchema.required, ['name']);
    assert.ok('loud' in tool.inputSchema.properties);
  });

  await test('handles param with default value: repeat(text: string, times = 1)', () => {
    const source = `
      export default class Repeater {
        repeat(text: string, times = 1): string { return ''; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    // 'times' has initializer → optional
    assert.deepStrictEqual(tool.inputSchema.required, ['text']);
  });

  await test('object param pattern still works: add(params: { item: string })', () => {
    const source = `
      export default class List {
        async add(params: { item: string, priority?: number }) {}
      }
    `;
    const result = extractor.extractAllFromSource(source);
    const tool = result.tools[0];
    assert.ok('item' in tool.inputSchema.properties);
    assert.ok('priority' in tool.inputSchema.properties);
    assert.deepStrictEqual(tool.inputSchema.required, ['item']);
  });

  await test('no-param method has empty properties', () => {
    const source = `
      export default class List {
        getAll(): string[] { return []; }
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.deepStrictEqual(result.tools[0].inputSchema.properties, {});
  });

  await test('sync methods are extracted (no async required)', () => {
    const source = `
      export default class Counter {
        increment(): number { return 0; }
        decrement(): number { return 0; }
        reset(): void {}
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.tools.length, 3);
    assert.deepStrictEqual(result.tools.map((t) => t.name).sort(), [
      'decrement',
      'increment',
      'reset',
    ]);
  });

  await test('private/protected methods are excluded', () => {
    const source = `
      export default class Service {
        public run(): void {}
        private _helper(): void {}
        protected init(): void {}
      }
    `;
    const result = extractor.extractAllFromSource(source);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'run');
  });

  console.log('\n📦 Loader — Sync Photon End-to-End\n');

  await test('loads sync photon and discovers tools', async () => {
    const loader = new PhotonLoader(false);
    const photon = await loader.loadFile('./tests/fixtures/sync-class.photon.ts');
    assert.ok(photon, 'Photon should load');
    assert.equal(photon.name, 'sync-list');
    const toolNames = photon.tools.map((t: any) => t.name).sort();
    assert.deepStrictEqual(toolNames, ['add', 'getAll', 'remove']);
  });

  await test('executes sync photon tool with simple params', async () => {
    const loader = new PhotonLoader(false);
    const photon = await loader.loadFile('./tests/fixtures/sync-class.photon.ts');
    // add(item: string) — runtime destructures { item: 'hello' } into 'hello'
    await loader.executeTool(photon, 'add', { item: 'hello' });
    const result = await loader.executeTool(photon, 'getAll', {});
    assert.deepStrictEqual(
      result,
      ['hello'],
      'Simple param should be destructured, not passed as object'
    );
  });

  await test('sync tool with required param has correct schema', async () => {
    const loader = new PhotonLoader(false);
    const photon = await loader.loadFile('./tests/fixtures/sync-class.photon.ts');
    const addTool = photon.tools.find((t: any) => t.name === 'add');
    assert.ok(addTool);
    assert.ok('item' in addTool.inputSchema.properties, 'add should have item property');
    assert.deepStrictEqual(addTool.inputSchema.required, ['item']);
  });

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
