/**
 * Constructor Context Tests
 *
 * Tests for `photon use` (context switching) and `photon set` (environment config).
 * Covers: argument parsing, storage, retrieval, and state partitioning.
 *
 * Run: npx tsx tests/constructor-context.test.ts
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ConstructorParam } from '@portel/photon-core';
import {
  parseContextArgs,
  ContextStore,
  EnvStore,
  getStatePartitionPath,
  classifyParam,
} from '../src/context-store.js';

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

// ══════════════════════════════════════════════════════════════════

async function run() {
  // Create temp dir for test storage
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-context-test-'));
  const homedir = os.homedir();

  try {
    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 Argument Parsing — `photon use`\n');
    // ═════════════════════════════════════════════════════════════

    const singleParam: ConstructorParam[] = [
      {
        name: 'name',
        type: 'string',
        isPrimitive: true,
        hasDefault: true,
        defaultValue: 'default',
      },
    ];

    const multiParams: ConstructorParam[] = [
      {
        name: 'name',
        type: 'string',
        isPrimitive: true,
        hasDefault: true,
        defaultValue: 'default',
      },
      {
        name: 'category',
        type: 'string',
        isPrimitive: true,
        hasDefault: true,
        defaultValue: 'general',
      },
      {
        name: 'priority',
        type: 'string',
        isPrimitive: true,
        hasDefault: true,
        defaultValue: 'normal',
      },
    ];

    await test('single positional arg maps to first param', () => {
      const result = parseContextArgs(['workouts'], singleParam);
      assert.equal(result.get('name'), 'workouts');
    });

    await test('multiple positional args map in order', () => {
      const result = parseContextArgs(['workouts', 'fitness', 'high'], multiParams);
      assert.equal(result.get('name'), 'workouts');
      assert.equal(result.get('category'), 'fitness');
      assert.equal(result.get('priority'), 'high');
    });

    await test('partial positional args set only given params', () => {
      const result = parseContextArgs(['workouts'], multiParams);
      assert.equal(result.get('name'), 'workouts');
      assert.equal(result.has('category'), false);
      assert.equal(result.has('priority'), false);
    });

    await test('named arg sets specific param', () => {
      const result = parseContextArgs(['category', 'fitness'], multiParams);
      assert.equal(result.get('category'), 'fitness');
      assert.equal(result.has('name'), false);
    });

    await test('mixed named and positional args', () => {
      const result = parseContextArgs(['workouts', 'priority', 'high'], multiParams);
      assert.equal(result.get('name'), 'workouts');
      assert.equal(result.get('priority'), 'high');
      assert.equal(result.has('category'), false);
    });

    await test('named arg in middle, positional fills remaining', () => {
      const result = parseContextArgs(['category', 'fitness', 'workouts'], multiParams);
      assert.equal(result.get('category'), 'fitness');
      assert.equal(result.get('name'), 'workouts');
    });

    await test('no args returns empty map', () => {
      const result = parseContextArgs([], multiParams);
      assert.equal(result.size, 0);
    });

    await test('value that happens to match param name but no next arg → positional', () => {
      // Edge case: last arg matches a param name but there's no value after it
      // Should treat it as a positional value, not a named param
      const params: ConstructorParam[] = [
        {
          name: 'list',
          type: 'string',
          isPrimitive: true,
          hasDefault: true,
          defaultValue: 'default',
        },
        {
          name: 'mode',
          type: 'string',
          isPrimitive: true,
          hasDefault: true,
          defaultValue: 'normal',
        },
      ];
      const result = parseContextArgs(['mode'], params);
      // 'mode' is a param name but there's no value after it → treat as positional for 'list'
      assert.equal(result.get('list'), 'mode');
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 Argument Parsing — `photon set`\n');
    // ═════════════════════════════════════════════════════════════

    const envParams: ConstructorParam[] = [
      { name: 'apiKey', type: 'string', isPrimitive: true, hasDefault: false },
      { name: 'region', type: 'string', isPrimitive: true, hasDefault: false },
    ];

    await test('set: positional arg maps to first env param', () => {
      const result = parseContextArgs(['sk-123'], envParams);
      assert.equal(result.get('apiKey'), 'sk-123');
    });

    await test('set: named arg sets specific env param', () => {
      const result = parseContextArgs(['region', 'eu-west'], envParams);
      assert.equal(result.get('region'), 'eu-west');
    });

    await test('set: detects unset params for prompting', () => {
      const result = parseContextArgs(['sk-123'], envParams);
      const unset = envParams.filter((p) => !result.has(p.name));
      assert.equal(unset.length, 1);
      assert.equal(unset[0].name, 'region');
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 Context Store\n');
    // ═════════════════════════════════════════════════════════════

    const contextStore = new ContextStore(tmpDir);

    await test('write and read context', () => {
      contextStore.write('todo-list', { name: 'workouts' });
      const ctx = contextStore.read('todo-list');
      assert.equal(ctx.name, 'workouts');
    });

    await test('write merges with existing context', () => {
      contextStore.write('todo-list', { name: 'workouts' });
      contextStore.write('todo-list', { category: 'fitness' });
      const ctx = contextStore.read('todo-list');
      assert.equal(ctx.name, 'workouts');
      assert.equal(ctx.category, 'fitness');
    });

    await test('overwrite existing key', () => {
      contextStore.write('todo-list', { name: 'groceries' });
      const ctx = contextStore.read('todo-list');
      assert.equal(ctx.name, 'groceries');
    });

    await test('read non-existent photon returns empty object', () => {
      const ctx = contextStore.read('nonexistent');
      assert.deepEqual(ctx, {});
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 Environment Store\n');
    // ═════════════════════════════════════════════════════════════

    const envStore = new EnvStore(tmpDir);

    await test('write and read env values', () => {
      envStore.write('tracker', { apiKey: 'sk-secret-key-123' });
      const env = envStore.read('tracker');
      assert.equal(env.apiKey, 'sk-secret-key-123');
    });

    await test('masked values hide middle of long strings', () => {
      envStore.write('tracker', { apiKey: 'sk-secret-key-123' });
      const masked = envStore.getMasked('tracker');
      assert.equal(masked.apiKey, 'sk-***123');
    });

    await test('masked values fully hide short strings', () => {
      envStore.write('tracker', { pin: '1234' });
      const masked = envStore.getMasked('tracker');
      assert.equal(masked.pin, '***');
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 State Partitioning\n');
    // ═════════════════════════════════════════════════════════════

    await test('default context → base state path', () => {
      const ctx = new Map<string, string>();
      const result = getStatePartitionPath('todo-list', ctx, singleParam);
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list'));
    });

    await test('default value explicitly set → base state path', () => {
      const ctx = new Map([['name', 'default']]);
      const result = getStatePartitionPath('todo-list', ctx, singleParam);
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list'));
    });

    await test('non-default context → partitioned state path', () => {
      const ctx = new Map([['name', 'workouts']]);
      const result = getStatePartitionPath('todo-list', ctx, singleParam);
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list--workouts'));
    });

    await test('multiple context params → joined partition path', () => {
      const ctx = new Map([
        ['name', 'workouts'],
        ['category', 'fitness'],
      ]);
      const result = getStatePartitionPath('todo-list', ctx, multiParams);
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list--workouts--fitness'));
    });

    await test('only second param changed → partition includes only changed', () => {
      const ctx = new Map([['category', 'fitness']]);
      const result = getStatePartitionPath('todo-list', ctx, multiParams);
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list--fitness'));
    });

    await test('all params at default → base path', () => {
      const ctx = new Map([
        ['name', 'default'],
        ['category', 'general'],
        ['priority', 'normal'],
      ]);
      const result = getStatePartitionPath('todo-list', ctx, multiParams);
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list'));
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 Injection Type Classification\n');
    // ═════════════════════════════════════════════════════════════

    await test('primitive without default → env', () => {
      const result = classifyParam(
        { name: 'apiKey', type: 'string', isPrimitive: true, hasDefault: false },
        false,
        new Set(),
        new Set()
      );
      assert.equal(result, 'env');
    });

    await test('primitive with default → context', () => {
      const result = classifyParam(
        {
          name: 'region',
          type: 'string',
          isPrimitive: true,
          hasDefault: true,
          defaultValue: 'us-east',
        },
        false,
        new Set(),
        new Set()
      );
      assert.equal(result, 'context');
    });

    await test('non-primitive with default on @stateful → state', () => {
      const result = classifyParam(
        { name: 'items', type: 'string[]', isPrimitive: false, hasDefault: true },
        true,
        new Set(),
        new Set()
      );
      assert.equal(result, 'state');
    });

    await test('name matching @mcp → mcp regardless of type', () => {
      const result = classifyParam(
        { name: 'github', type: 'any', isPrimitive: false, hasDefault: false },
        false,
        new Set(['github']),
        new Set()
      );
      assert.equal(result, 'mcp');
    });

    await test('name matching @photon → photon regardless of type', () => {
      const result = classifyParam(
        { name: 'billing', type: 'any', isPrimitive: false, hasDefault: false },
        false,
        new Set(),
        new Set(['billing'])
      );
      assert.equal(result, 'photon');
    });

    await test('primitive with default + @mcp match → mcp wins', () => {
      // @mcp takes precedence over context classification
      const result = classifyParam(
        {
          name: 'github',
          type: 'string',
          isPrimitive: true,
          hasDefault: true,
          defaultValue: 'token',
        },
        false,
        new Set(['github']),
        new Set()
      );
      assert.equal(result, 'mcp');
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n📦 Full Workflow: use → resolve → partition\n');
    // ═════════════════════════════════════════════════════════════

    await test('end-to-end: set context then resolve for stateful photon', () => {
      const store = new ContextStore(tmpDir);

      // Simulate: photon use todo-list workouts
      const args = parseContextArgs(['workouts'], singleParam);
      const values = Object.fromEntries(args);
      store.write('todo-list', values);

      // Simulate: loader resolving context param
      const stored = store.read('todo-list');
      assert.equal(stored.name, 'workouts');

      // Simulate: determining state partition
      const partitionPath = getStatePartitionPath(
        'todo-list',
        new Map(Object.entries(stored)),
        singleParam
      );
      assert.equal(partitionPath, path.join(homedir, '.photon', 'state', 'todo-list--workouts'));
    });

    await test('end-to-end: switch context changes partition', () => {
      const store = new ContextStore(tmpDir);

      // First: use workouts
      store.write('todo-list', { name: 'workouts' });
      let stored = store.read('todo-list');
      let partitionPath = getStatePartitionPath(
        'todo-list',
        new Map(Object.entries(stored)),
        singleParam
      );
      assert.equal(partitionPath, path.join(homedir, '.photon', 'state', 'todo-list--workouts'));

      // Switch: use groceries
      store.write('todo-list', { name: 'groceries' });
      stored = store.read('todo-list');
      partitionPath = getStatePartitionPath(
        'todo-list',
        new Map(Object.entries(stored)),
        singleParam
      );
      assert.equal(partitionPath, path.join(homedir, '.photon', 'state', 'todo-list--groceries'));
    });

    await test('end-to-end: no context set → uses default → base path', () => {
      const store = new ContextStore(tmpDir);
      const stored = store.read('fresh-photon'); // never set
      const partitionPath = getStatePartitionPath(
        'fresh-photon',
        new Map(Object.entries(stored)),
        singleParam
      );
      assert.equal(partitionPath, path.join(homedir, '.photon', 'state', 'fresh-photon'));
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n');
    // ═════════════════════════════════════════════════════════════

    console.log(`Results: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
  } finally {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run();
