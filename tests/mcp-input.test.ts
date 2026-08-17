import { strict as assert } from 'node:assert';
import {
  inputResponseValue,
  isMCPInputRequired,
  presentMCPInputRequest,
} from '../src/auto-ui/frontend/services/mcp-input.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

await test('recognizes a valid MCP 2026 input_required result', () => {
  assert.equal(
    isMCPInputRequired({
      resultType: 'input_required',
      requestState: 'state-token',
      inputRequests: {},
    }),
    true
  );
  assert.equal(isMCPInputRequired({ resultType: 'complete' }), false);
});

await test('maps a pizza-style array elicitation to Beam multi-select cards', () => {
  const presentation = presentMCPInputRequest('input_1', {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Select pizzas',
      requestedSchema: {
        type: 'object',
        properties: {
          selection: {
            type: 'array',
            items: {
              anyOf: [
                { const: 'margherita', title: 'Margherita', description: 'Classic' },
                { const: 'pepperoni', title: 'Pepperoni' },
              ],
            },
          },
        },
        required: ['selection'],
      },
    },
  });

  assert.equal(presentation.data.ask, 'select');
  assert.equal(presentation.data.multi, true);
  assert.equal(presentation.responseProperty, 'selection');
  assert.deepEqual(presentation.data.options, [
    { value: 'margherita', label: 'Margherita', description: 'Classic' },
    { value: 'pepperoni', label: 'Pepperoni', description: undefined },
  ]);
});

await test('keeps multi-field MCP forms intact', () => {
  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Name' },
      email: { type: 'string', title: 'Email', format: 'email' },
    },
    required: ['name', 'email'],
  };
  const presentation = presentMCPInputRequest('input_1', {
    method: 'elicitation/create',
    params: { mode: 'form', message: 'Your details', requestedSchema: schema },
  });

  assert.equal(presentation.data.ask, 'form');
  assert.deepEqual(presentation.data.schema, schema);
  assert.equal(presentation.responseProperty, undefined);
});

await test('wraps native control values in MCP form content', () => {
  assert.deepEqual(inputResponseValue(['margherita'], 'selection'), {
    selection: ['margherita'],
  });
  assert.deepEqual(inputResponseValue({ name: 'Arul' }), { name: 'Arul' });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
