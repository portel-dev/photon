/**
 * Instance Store & Injection Tests
 *
 * Tests for named instance management, environment config, and injection classification.
 * Covers: InstanceStore, EnvStore, getInstanceStatePath, classifyParam.
 *
 * Run: npx tsx tests/constructor-context.test.ts
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ConstructorParam } from '@portel/photon-core';
import {
  InstanceStore,
  EnvStore,
  getInstanceStatePath,
  classifyParam,
} from '../src/context-store.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`  \u2705 ${name}`);
    },
    (err) => {
      failed++;
      console.log(`  \u274C ${name}: ${err.message}`);
    }
  );
}

// ══════════════════════════════════════════════════════════════

async function run() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-instance-test-'));
  const homedir = os.homedir();

  try {
    // ═════════════════════════════════════════════════════════════
    console.log('\n\uD83D\uDCE6 Instance Store\n');
    // ═════════════════════════════════════════════════════════════

    const instanceStore = new InstanceStore(tmpDir);

    await test('default instance is empty string', () => {
      const result = instanceStore.getCurrentInstance('todo-list');
      assert.equal(result, '');
    });

    await test('set and get instance', () => {
      instanceStore.setCurrentInstance('todo-list', 'workouts');
      assert.equal(instanceStore.getCurrentInstance('todo-list'), 'workouts');
    });

    await test('switch instance', () => {
      instanceStore.setCurrentInstance('todo-list', 'groceries');
      assert.equal(instanceStore.getCurrentInstance('todo-list'), 'groceries');
    });

    await test('reset to default (empty string)', () => {
      instanceStore.setCurrentInstance('todo-list', '');
      assert.equal(instanceStore.getCurrentInstance('todo-list'), '');
    });

    await test('different photons have independent instances', () => {
      instanceStore.setCurrentInstance('todo-list', 'workouts');
      instanceStore.setCurrentInstance('notes', 'journal');
      assert.equal(instanceStore.getCurrentInstance('todo-list'), 'workouts');
      assert.equal(instanceStore.getCurrentInstance('notes'), 'journal');
    });

    await test('list instances from state directory', () => {
      // Create fake state files
      const stateDir = path.join(tmpDir, 'state', 'todo-list');
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, 'default.json'), '{}');
      fs.writeFileSync(path.join(stateDir, 'workouts.json'), '{}');
      fs.writeFileSync(path.join(stateDir, 'groceries.json'), '{}');

      const instances = instanceStore.listInstances('todo-list');
      assert.deepEqual(instances.sort(), ['default', 'groceries', 'workouts']);
    });

    await test('list instances for non-existent photon returns empty', () => {
      const instances = instanceStore.listInstances('nonexistent');
      assert.deepEqual(instances, []);
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n\uD83D\uDCE6 Environment Store\n');
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
    console.log('\n\uD83D\uDCE6 Instance State Path\n');
    // ═════════════════════════════════════════════════════════════

    await test('default instance → default.json', () => {
      const result = getInstanceStatePath('todo-list', '');
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list', 'default.json'));
    });

    await test('named instance → {name}.json', () => {
      const result = getInstanceStatePath('todo-list', 'workouts');
      assert.equal(result, path.join(homedir, '.photon', 'state', 'todo-list', 'workouts.json'));
    });

    await test('different photons have separate directories', () => {
      const a = getInstanceStatePath('todo-list', 'workouts');
      const b = getInstanceStatePath('notes', 'workouts');
      assert.notEqual(a, b);
      assert.ok(a.includes('todo-list'));
      assert.ok(b.includes('notes'));
    });

    // ═════════════════════════════════════════════════════════════
    console.log('\n\uD83D\uDCE6 Injection Type Classification\n');
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

    await test('primitive with default → env (no more context type)', () => {
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
      assert.equal(result, 'env');
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
    console.log('\n');
    // ═════════════════════════════════════════════════════════════

    console.log(`Results: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run();
