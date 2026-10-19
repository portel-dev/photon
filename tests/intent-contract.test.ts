import { strict as assert } from 'node:assert';
import {
  canRevalidateMethod,
  getIntentOutputFormat,
  isDestructiveIntent,
  methodRequiresInput,
} from '../src/auto-ui/intent.js';
import { buildPhotonRenderMeta, type MethodInfo } from '../src/auto-ui/types.js';

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
      console.log(`    ${err.stack || err.message}`);
    });
}

function method(input: Partial<MethodInfo>): MethodInfo {
  return {
    name: input.name || 'run',
    description: input.description || '',
    params: input.params || { type: 'object', properties: {} },
    returns: input.returns || { type: 'object' },
    ...input,
  };
}

async function run() {
  console.log('\nIntent Contract:');

  await test('list/table intent is stable', () => {
    const render = buildPhotonRenderMeta(
      method({
        name: 'rows',
        description: 'List rows',
        outputFormat: 'table',
        layoutHints: { title: 'name' },
        outputSchema: {
          type: 'object',
          properties: { rows: { type: 'array' } },
        },
      })
    );

    assert.deepEqual(render?.intent, {
      action: 'list',
      subject: 'rows',
      confidence: 0.85,
      sources: ['description', 'format', 'schema'],
      input: { requiresInput: false },
      output: { structured: true, format: 'table' },
    });
    assert.equal(methodRequiresInput(render!), false);
    assert.equal(getIntentOutputFormat(render!), 'table');
  });

  await test('create intent captures required and optional input', () => {
    const render = buildPhotonRenderMeta(
      method({
        name: 'createTask',
        description: 'Create task',
        params: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['title'],
        },
        outputSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      })
    );

    assert.deepEqual(render?.intent, {
      action: 'create',
      subject: 'task',
      confidence: 0.9,
      sources: ['description', 'methodName', 'schema'],
      input: {
        requiresInput: true,
        requiredFields: ['title'],
        optionalFields: ['notes'],
      },
      output: { structured: true },
    });
    assert.equal(methodRequiresInput(render!), true);
  });

  await test('required schema input cannot be masked by stale intent metadata', () => {
    const methodWithStaleIntent = method({
      name: 'forecast',
      description: '7-day weather forecast',
      params: {
        type: 'object',
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
        },
        required: ['latitude', 'longitude'],
      },
      intent: {
        action: 'view',
        confidence: 0.8,
        sources: ['schema'],
        input: { requiresInput: false },
      },
    });

    assert.equal(
      methodRequiresInput(methodWithStaleIntent),
      true,
      'required latitude/longitude must keep Beam on the form'
    );
  });

  await test('delete intent is destructive even when inferred from name', () => {
    const render = buildPhotonRenderMeta(
      method({
        name: 'deleteTask',
        description: 'Delete task',
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        destructiveHint: true,
      })
    );

    assert.deepEqual(render?.intent, {
      action: 'delete',
      subject: 'task',
      confidence: 0.9,
      sources: ['description', 'methodName', 'annotations', 'schema'],
      safety: { destructive: true },
      input: { requiresInput: true, requiredFields: ['id'] },
      output: { structured: true },
    });
    assert.equal(isDestructiveIntent(render!), true);
    assert.equal(methodRequiresInput(render!), true);
  });

  await test('status/dashboard intent maps to monitor', () => {
    const render = buildPhotonRenderMeta(
      method({
        name: 'status',
        description: 'Watch status',
        outputFormat: 'dashboard',
        readOnlyHint: true,
      })
    );

    assert.deepEqual(render?.intent, {
      action: 'monitor',
      subject: 'status',
      confidence: 0.95,
      sources: ['description', 'methodName', 'annotations', 'format', 'schema'],
      safety: { readOnly: true, destructive: false },
      input: { requiresInput: false },
      output: { structured: true, format: 'dashboard' },
    });
    assert.equal(getIntentOutputFormat(render!), 'dashboard');
  });

  await test('configure/settings intent is stable for settings surfaces', () => {
    const render = buildPhotonRenderMeta(
      method({
        name: 'settings',
        description: 'Configure settings',
        params: {
          type: 'object',
          properties: { apiKey: { type: 'string' } },
          required: [],
        },
      })
    );

    assert.deepEqual(render?.intent, {
      action: 'update',
      subject: 'settings',
      confidence: 0.75,
      sources: ['description', 'schema'],
      input: { requiresInput: false, optionalFields: ['apiKey'] },
      output: { structured: true },
    });
    assert.equal(methodRequiresInput(render!), false);
  });

  await test('background refresh requires explicit safety and rejects conflicting destructive metadata', () => {
    assert.equal(canRevalidateMethod({ params: { required: [] } }), false);
    assert.equal(canRevalidateMethod({ intent: { action: 'list' } as any }), false);
    assert.equal(canRevalidateMethod({ readOnlyHint: true }), true);
    assert.equal(canRevalidateMethod({ intent: { safety: { readOnly: true } } as any }), true);
    assert.equal(canRevalidateMethod({ readOnlyHint: true, destructiveHint: true }), false);
    assert.equal(
      canRevalidateMethod({ readOnlyHint: true, intent: { action: 'delete' } as any }),
      false
    );
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
