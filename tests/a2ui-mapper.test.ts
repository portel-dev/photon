/**
 * A2UI v0.9 Mapper Tests
 *
 * Verify the heuristic mapper produces valid v0.9 JSONL sequences for the
 * common photon return shapes (array of rows, single object, card-shaped,
 * primitives) plus the __a2ui escape hatch.
 */

import { strict as assert } from 'assert';
import { resultToA2UIMessages } from '../src/a2ui/mapper.js';
import {
  A2UI_BASIC_CATALOG,
  A2UI_VERSION,
  type A2UIComponent,
  type A2UIMessage,
  type CreateSurfaceMessage,
  type UpdateComponentsMessage,
  type UpdateDataModelMessage,
} from '../src/a2ui/types.js';

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
      console.log(`    ${err.message || err}`);
    });
}

function splitMessages(msgs: A2UIMessage[]): {
  create: CreateSurfaceMessage;
  update: UpdateComponentsMessage;
  data: UpdateDataModelMessage;
} {
  const create = msgs.find(
    (m): m is CreateSurfaceMessage => 'createSurface' in m
  ) as CreateSurfaceMessage;
  const update = msgs.find(
    (m): m is UpdateComponentsMessage => 'updateComponents' in m
  ) as UpdateComponentsMessage;
  const data = msgs.find(
    (m): m is UpdateDataModelMessage => 'updateDataModel' in m
  ) as UpdateDataModelMessage;
  assert.ok(create, 'createSurface message missing');
  assert.ok(update, 'updateComponents message missing');
  assert.ok(data, 'updateDataModel message missing');
  return { create, update, data };
}

async function testShapes(): Promise<void> {
  console.log('\n  Shape heuristics');

  await test('always emits the v0.9 lifecycle triple', () => {
    const msgs = resultToA2UIMessages('hello');
    assert.equal(msgs.length, 3);
    const { create } = splitMessages(msgs);
    assert.equal(create.version, A2UI_VERSION);
    assert.equal(create.createSurface.catalogId, A2UI_BASIC_CATALOG);
  });

  await test('primitive string → single Text component', () => {
    const msgs = resultToA2UIMessages('hello world');
    const { update, data } = splitMessages(msgs);
    assert.equal(update.updateComponents.components.length, 1);
    const root = update.updateComponents.components[0];
    assert.equal(root.id, 'root');
    assert.equal(root.component, 'Text');
    assert.deepEqual(data.updateDataModel.value, { value: 'hello world' });
  });

  await test('array of row objects → List with Card template', () => {
    const rows = [
      { name: 'Alice', role: 'Eng' },
      { name: 'Bob', role: 'PM' },
    ];
    const msgs = resultToA2UIMessages(rows);
    const { update, data } = splitMessages(msgs);
    const byId = new Map(update.updateComponents.components.map((c) => [c.id, c]));
    const root = byId.get('root');
    assert.equal(root?.component, 'List');
    assert.ok(byId.get('rowCard'), 'template rowCard exists');
    assert.deepEqual(data.updateDataModel.value, { items: rows });
  });

  await test('single object → Column of Text rows', () => {
    const result = { host: 'prod-01', region: 'us-east', cpu: '42%' };
    const msgs = resultToA2UIMessages(result);
    const { update, data } = splitMessages(msgs);
    const root = update.updateComponents.components.find((c) => c.id === 'root');
    assert.equal(root?.component, 'Column');
    assert.deepEqual(data.updateDataModel.value, result);
    const textRows = update.updateComponents.components.filter((c) => c.id.startsWith('row'));
    assert.equal(textRows.length, 3, 'one Text row per key');
  });

  await test('card-shaped object → Card with action buttons', () => {
    const card = {
      title: 'Deploy',
      description: 'Ship to production',
      actions: [
        { label: 'Deploy', name: 'deploy' },
        { label: 'Cancel', name: 'cancel' },
      ],
    };
    const msgs = resultToA2UIMessages(card);
    const { update } = splitMessages(msgs);
    const byId = new Map(update.updateComponents.components.map((c) => [c.id, c]));
    assert.equal(byId.get('root')?.component, 'Card');
    assert.equal(byId.get('cardBtn0')?.component, 'Button');
    assert.equal(byId.get('cardBtn1')?.component, 'Button');
  });

  await test('empty array → empty-state primitive', () => {
    const msgs = resultToA2UIMessages([]);
    const { update } = splitMessages(msgs);
    const root = update.updateComponents.components[0];
    assert.equal(root.component, 'Text');
  });

  await test('array of primitives → List with label template', () => {
    const msgs = resultToA2UIMessages(['apple', 'banana']);
    const { update, data } = splitMessages(msgs);
    assert.equal(
      update.updateComponents.components.find((c) => c.id === 'root')?.component,
      'List'
    );
    const items = (data.updateDataModel.value as { items: unknown[] }).items;
    assert.equal(items.length, 2);
  });
}

async function testEscapeHatch(): Promise<void> {
  console.log('\n  Escape hatch');

  await test('__a2ui: true passes components through verbatim', () => {
    const components: A2UIComponent[] = [{ id: 'root', component: 'Text', text: 'Custom' }];
    const msgs = resultToA2UIMessages({
      __a2ui: true,
      components,
      data: { foo: 'bar' },
    });
    const { update, data } = splitMessages(msgs);
    assert.deepEqual(update.updateComponents.components, components);
    assert.deepEqual(data.updateDataModel.value, { foo: 'bar' });
  });

  await test('escape hatch missing root throws', () => {
    assert.throws(
      () =>
        resultToA2UIMessages({
          __a2ui: true,
          components: [{ id: 'not-root', component: 'Text', text: 'x' }],
        }),
      /root/
    );
  });
}

async function testInvariants(): Promise<void> {
  console.log('\n  Invariants');

  const cases: Array<[string, unknown]> = [
    ['primitive', 'hello'],
    ['array', [{ a: 1 }]],
    ['object', { a: 1, b: 2 }],
    ['card', { title: 'T', actions: [{ label: 'Go' }] }],
    ['empty object', {}],
    ['null', null],
  ];

  for (const [label, input] of cases) {
    await test(`${label}: exactly one root component`, () => {
      const msgs = resultToA2UIMessages(input);
      const { update } = splitMessages(msgs);
      const roots = update.updateComponents.components.filter((c) => c.id === 'root');
      assert.equal(roots.length, 1);
    });
  }

  await test('surfaceId is consistent across all three messages', () => {
    const msgs = resultToA2UIMessages({ a: 1 });
    const { create, update, data } = splitMessages(msgs);
    assert.equal(create.createSurface.surfaceId, update.updateComponents.surfaceId);
    assert.equal(create.createSurface.surfaceId, data.updateDataModel.surfaceId);
  });

  await test('custom surfaceId from options flows through', () => {
    const msgs = resultToA2UIMessages({ a: 1 }, { surfaceId: 'custom-id' });
    const { create } = splitMessages(msgs);
    assert.equal(create.createSurface.surfaceId, 'custom-id');
  });
}

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    A2UI MAPPER TESTS                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testShapes();
  await testEscapeHatch();
  await testInvariants();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All A2UI mapper tests passed!\n');
})();
