import { strict as assert } from 'node:assert';
import {
  buildMCPInputContinuation,
  formatMCPInputResponse,
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
                {
                  const: 'pepperoni',
                  title: 'Pepperoni',
                  'x-photon-option': {
                    image: 'https://example.com/pepperoni.jpg',
                  },
                },
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
    {
      value: 'pepperoni',
      label: 'Pepperoni',
      description: undefined,
      image: 'https://example.com/pepperoni.jpg',
    },
  ]);
});

await test('preserves rich option images from Photon select metadata', () => {
  const presentation = presentMCPInputRequest('input_1', {
    method: 'elicitation/create',
    params: {
      mode: 'form',
      message: 'Choose a pizza',
      requestedSchema: {
        type: 'object',
        properties: {
          selection: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['margherita', 'pepperoni'],
              'x-photon-options': [
                {
                  value: 'margherita',
                  label: 'Margherita',
                  description: 'Classic tomato and basil',
                  image: 'https://example.com/margherita.jpg',
                },
                {
                  value: 'pepperoni',
                  label: 'Pepperoni',
                  image: 'https://example.com/pepperoni.jpg',
                },
              ],
            },
          },
        },
      },
    },
  });

  assert.deepEqual(
    presentation.data.options?.map(({ value, label, description, image }) => ({
      value,
      label,
      description,
      image,
    })),
    [
      {
        value: 'margherita',
        label: 'Margherita',
        description: 'Classic tomato and basil',
        image: 'https://example.com/margherita.jpg',
      },
      {
        value: 'pepperoni',
        label: 'Pepperoni',
        description: undefined,
        image: 'https://example.com/pepperoni.jpg',
      },
    ]
  );
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

await test('encodes native control values as MCP 2026 elicitation results', () => {
  assert.deepEqual(formatMCPInputResponse(['margherita'], 'selection'), {
    action: 'accept',
    content: { selection: ['margherita'] },
  });
  assert.deepEqual(formatMCPInputResponse({ name: 'Arul' }), {
    action: 'accept',
    content: { name: 'Arul' },
  });
});

await test('accepts URL elicitation without incorrectly putting the URL in form content', () => {
  assert.deepEqual(formatMCPInputResponse('https://example.com', undefined, 'elicitation'), {
    action: 'accept',
  });
});

await test('builds one canonical continuation envelope for native controls', () => {
  assert.deepEqual(
    buildMCPInputContinuation(
      {
        requestState: 'state-1',
        inputKey: 'selection',
        responseProperty: 'selection',
      },
      ['margherita']
    ),
    {
      requestState: 'state-1',
      inputResponses: {
        selection: { action: 'accept', content: { selection: ['margherita'] } },
      },
    }
  );
});

await test('uses MCP response envelopes for sampling and roots rounds', () => {
  assert.deepEqual(
    buildMCPInputContinuation(
      { requestState: 'state-2', inputKey: 'sample', responseMode: 'sampling' },
      'Hello'
    ),
    {
      requestState: 'state-2',
      inputResponses: {
        sample: {
          role: 'assistant',
          content: { type: 'text', text: 'Hello' },
          model: 'human@beam',
          stopReason: 'endTurn',
        },
      },
    }
  );
  assert.deepEqual(
    buildMCPInputContinuation(
      { requestState: 'state-3', inputKey: 'roots', responseMode: 'roots' },
      undefined
    ),
    { requestState: 'state-3', inputResponses: { roots: { roots: [] } } }
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
