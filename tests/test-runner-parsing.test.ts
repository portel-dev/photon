/**
 * Test Runner Parsing Tests
 *
 * Tests the pure parsing functions from src/test-runner.ts.
 * Since these are not exported, we duplicate the logic here
 * (same approach as worker-dep-proxy tests).
 */

import { strict as assert } from 'assert';

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

// ── Duplicated logic from src/test-runner.ts ────────────────────────────────

interface MethodSchema {
  name: string;
  params: Array<{ name: string; type: string; required: boolean; example?: string }>;
}

function parseTestTags(source: string): Map<string, { skip?: string; only?: boolean }> {
  const tags = new Map<string, { skip?: string; only?: boolean }>();

  const pattern = /\/\*\*([\s\S]*?)\*\/\s*export\s+(?:async\s+)?(?:function\s+|const\s+)(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const comment = match[1];
    const name = match[2];
    const entry: { skip?: string; only?: boolean } = {};

    const skipMatch = comment.match(/@skip(?:\s+(.+?))?(?:\n|\*)/);
    if (skipMatch) {
      entry.skip = skipMatch[1]?.trim() || 'skipped';
    }

    if (/@only\b/.test(comment)) {
      entry.only = true;
    }

    tags.set(name, entry);
  }

  return tags;
}

function buildExampleParams(method: MethodSchema): Record<string, any> {
  const params: Record<string, any> = {};

  for (const param of method.params) {
    if (param.example !== undefined) {
      params[param.name] = param.example;
    } else if (param.required) {
      switch (param.type) {
        case 'string':
          params[param.name] = 'test';
          break;
        case 'number':
        case 'integer':
          params[param.name] = 1;
          break;
        case 'boolean':
          params[param.name] = true;
          break;
        case 'array':
          params[param.name] = [];
          break;
        case 'object':
          params[param.name] = {};
          break;
      }
    }
  }

  return params;
}

function getTestMethods(instance: any): string[] {
  const methods: string[] = [];
  const proto = Object.getPrototypeOf(instance);

  for (const name of Object.getOwnPropertyNames(proto)) {
    if (
      name.startsWith('test') &&
      typeof instance[name] === 'function' &&
      name !== 'constructor' &&
      name !== 'testBeforeAll' &&
      name !== 'testAfterAll'
    ) {
      methods.push(name);
    }
  }

  return methods.sort();
}

function hasLifecycleHook(instance: any, hookName: string): boolean {
  return typeof instance[hookName] === 'function';
}

// ── parseTestTags tests ─────────────────────────────────────────────────────

async function testParseTestTags() {
  console.log('\n  parseTestTags');

  await test('source with @skip reason', () => {
    const source = `/**\n * @skip reason for skipping\n */\nexport function testFoo() {}`;
    const tags = parseTestTags(source);
    assert.equal(tags.size, 1);
    assert.equal(tags.get('testFoo')?.skip, 'reason for skipping');
  });

  await test('source with @only', () => {
    const source = `/** @only */\nexport async function testBar() {}`;
    const tags = parseTestTags(source);
    assert.equal(tags.size, 1);
    assert.equal(tags.get('testBar')?.only, true);
  });

  await test('source with no tags', () => {
    const source = `/** Just a description */\nexport function testPlain() {}`;
    const tags = parseTestTags(source);
    assert.equal(tags.size, 1);
    const entry = tags.get('testPlain');
    assert.equal(entry?.skip, undefined);
    assert.equal(entry?.only, undefined);
  });

  await test('source with both @skip and @only', () => {
    const source = `/** @skip not ready\n * @only */\nexport function testBoth() {}`;
    const tags = parseTestTags(source);
    const entry = tags.get('testBoth');
    assert.equal(entry?.skip, 'not ready');
    assert.equal(entry?.only, true);
  });

  await test('multiple exports', () => {
    const source = [
      `/**`,
      ` * @skip wip`,
      ` */`,
      `export function testA() {}`,
      ``,
      `/** @only */`,
      `export async function testB() {}`,
      ``,
      `/** plain */`,
      `export const testC = () => {}`,
    ].join('\n');
    const tags = parseTestTags(source);
    assert.equal(tags.size, 3);
    assert.equal(tags.get('testA')?.skip, 'wip');
    assert.equal(tags.get('testB')?.only, true);
    assert.equal(tags.get('testC')?.skip, undefined);
    assert.equal(tags.get('testC')?.only, undefined);
  });
}

// ── buildExampleParams tests ────────────────────────────────────────────────

async function testBuildExampleParams() {
  console.log('\n  buildExampleParams');

  await test('required string → "test"', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'a', type: 'string', required: true }],
    };
    assert.deepEqual(buildExampleParams(method), { a: 'test' });
  });

  await test('required number → 1', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'n', type: 'number', required: true }],
    };
    assert.deepEqual(buildExampleParams(method), { n: 1 });
  });

  await test('required integer → 1', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'i', type: 'integer', required: true }],
    };
    assert.deepEqual(buildExampleParams(method), { i: 1 });
  });

  await test('required boolean → true', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'b', type: 'boolean', required: true }],
    };
    assert.deepEqual(buildExampleParams(method), { b: true });
  });

  await test('required array → []', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'arr', type: 'array', required: true }],
    };
    assert.deepEqual(buildExampleParams(method), { arr: [] });
  });

  await test('required object → {}', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'obj', type: 'object', required: true }],
    };
    assert.deepEqual(buildExampleParams(method), { obj: {} });
  });

  await test('param with example → uses example', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [{ name: 'x', type: 'string', required: true, example: 'hello' }],
    };
    assert.deepEqual(buildExampleParams(method), { x: 'hello' });
  });

  await test('optional params → skipped', () => {
    const method: MethodSchema = {
      name: 'foo',
      params: [
        { name: 'req', type: 'string', required: true },
        { name: 'opt', type: 'string', required: false },
      ],
    };
    assert.deepEqual(buildExampleParams(method), { req: 'test' });
  });
}

// ── getTestMethods tests ────────────────────────────────────────────────────

async function testGetTestMethods() {
  console.log('\n  getTestMethods');

  await test('returns only test* methods, excludes _private and regular', () => {
    class Fake {
      testFoo() {}
      testBar() {}
      _private() {}
      regular() {}
    }
    const instance = new Fake();
    const methods = getTestMethods(instance);
    assert.deepEqual(methods, ['testBar', 'testFoo']);
  });

  await test('excludes testBeforeAll and testAfterAll', () => {
    class Fake {
      testBeforeAll() {}
      testAfterAll() {}
      testActual() {}
    }
    const instance = new Fake();
    const methods = getTestMethods(instance);
    assert.deepEqual(methods, ['testActual']);
  });

  await test('returns sorted', () => {
    class Fake {
      testZulu() {}
      testAlpha() {}
      testMike() {}
    }
    const instance = new Fake();
    const methods = getTestMethods(instance);
    assert.deepEqual(methods, ['testAlpha', 'testMike', 'testZulu']);
  });
}

// ── hasLifecycleHook tests ──────────────────────────────────────────────────

async function testHasLifecycleHook() {
  console.log('\n  hasLifecycleHook');

  await test('instance with testBeforeAll → true', () => {
    class Fake {
      testBeforeAll() {}
    }
    assert.equal(hasLifecycleHook(new Fake(), 'testBeforeAll'), true);
  });

  await test('instance without testBeforeAll → false', () => {
    class Fake {
      testSomething() {}
    }
    assert.equal(hasLifecycleHook(new Fake(), 'testBeforeAll'), false);
  });

  await test('instance with testAfterAll → true', () => {
    class Fake {
      testAfterAll() {}
    }
    assert.equal(hasLifecycleHook(new Fake(), 'testAfterAll'), true);
  });
}

// ── Runner ──────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                TEST RUNNER PARSING TESTS                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testParseTestTags();
  await testBuildExampleParams();
  await testGetTestMethods();
  await testHasLifecycleHook();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All test runner parsing tests passed!\n');
})();
