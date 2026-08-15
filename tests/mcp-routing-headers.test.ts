import { strict as assert } from 'node:assert';
import {
  buildMCPParamHeaders,
  decodeMCPHeaderValue,
  encodeMCPHeaderValue,
  getMCPRequestRoutingHeaders,
  parseMCPHeaderBindings,
  validateMCPParamHeaders,
} from '../dist/mcp/protocol/routing-headers.js';
import { createMCPRoutingFetch } from '../dist/auto-ui/beam/external-mcp.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function validBindings() {
  const parsed = parseMCPHeaderBindings({
    type: 'object',
    properties: {
      region: { type: 'string', 'x-mcp-header': 'Region' },
      options: {
        type: 'object',
        properties: {
          shard: { type: 'integer', 'x-mcp-header': 'Shard' },
          preview: { type: 'boolean', 'x-mcp-header': 'Preview' },
        },
      },
    },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error(parsed.issue);
  return parsed.bindings;
}

console.log('MCP custom routing headers:');

await test('extracts direct and nested statically-known primitive bindings', () => {
  assert.deepEqual(validBindings(), [
    {
      path: ['region'],
      annotation: 'Region',
      headerName: 'Mcp-Param-Region',
      type: 'string',
    },
    {
      path: ['options', 'shard'],
      annotation: 'Shard',
      headerName: 'Mcp-Param-Shard',
      type: 'integer',
    },
    {
      path: ['options', 'preview'],
      annotation: 'Preview',
      headerName: 'Mcp-Param-Preview',
      type: 'boolean',
    },
  ]);
});

await test('rejects invalid, duplicate, non-primitive, and sensitive annotations', () => {
  const invalidSchemas = [
    { properties: { value: { type: 'string', 'x-mcp-header': '' } } },
    { properties: { value: { type: 'string', 'x-mcp-header': 'bad name' } } },
    { properties: { value: { type: 'string', 'x-mcp-header': 'bad:name' } } },
    {
      properties: {
        first: { type: 'string', 'x-mcp-header': 'Route' },
        second: { type: 'string', 'x-mcp-header': 'route' },
      },
    },
    { properties: { value: { type: 'number', 'x-mcp-header': 'Value' } } },
    { properties: { values: { type: 'array', 'x-mcp-header': 'Values' } } },
    { properties: { apiToken: { type: 'string', 'x-mcp-header': 'Route' } } },
    {
      properties: {
        value: { type: 'string', writeOnly: true, 'x-mcp-header': 'Route' },
      },
    },
    {
      properties: {
        value: { type: 'string', format: 'password', 'x-mcp-header': 'Route' },
      },
    },
  ];
  for (const schema of invalidSchemas) {
    assert.equal(parseMCPHeaderBindings(schema).ok, false, JSON.stringify(schema));
  }
});

await test('rejects annotations reachable through dynamic schema routes', () => {
  for (const schema of [
    {
      properties: {
        list: {
          type: 'array',
          items: { type: 'string', 'x-mcp-header': 'Item' },
        },
      },
    },
    {
      properties: {
        value: {
          oneOf: [{ type: 'string', 'x-mcp-header': 'Variant' }],
        },
      },
    },
    {
      allOf: [
        {
          properties: {
            value: { type: 'string', 'x-mcp-header': 'RootVariant' },
          },
        },
      ],
    },
    {
      properties: {
        value: {
          $ref: '#/$defs/routed',
        },
      },
      $defs: {
        routed: { type: 'string', 'x-mcp-header': 'Reference' },
      },
    },
    {
      type: 'object',
      'x-mcp-header': 'Root',
      properties: {},
    },
  ]) {
    assert.equal(parseMCPHeaderBindings(schema).ok, false, JSON.stringify(schema));
  }
});

await test('uses plain ASCII when safe and canonical UTF-8 base64 otherwise', () => {
  assert.equal(encodeMCPHeaderValue('us-east'), 'us-east');
  assert.equal(encodeMCPHeaderValue(0), '0');
  assert.equal(encodeMCPHeaderValue(false), 'false');
  for (const value of [' leading', 'trailing\t', '東京', 'line\nbreak', '=?base64?YWJj?=']) {
    const encoded = encodeMCPHeaderValue(value);
    assert.match(encoded, /^=\?base64\?[A-Za-z0-9+/]*={0,2}\?=$/);
    assert.equal(decodeMCPHeaderValue(encoded), value);
  }
  assert.equal(decodeMCPHeaderValue('=?base64?not-canonical?='), null);
  assert.equal(decodeMCPHeaderValue('=?base64?/w==?='), null);
  assert.equal(decodeMCPHeaderValue(' leading'), null);
  assert.equal(decodeMCPHeaderValue('trailing '), null);
});

await test('omits absent and null values but preserves empty, false, and zero', () => {
  const headers = buildMCPParamHeaders(validBindings(), {
    region: '',
    options: { shard: 0, preview: false },
  });
  assert.deepEqual(headers, {
    'Mcp-Param-Region': '',
    'Mcp-Param-Shard': '0',
    'Mcp-Param-Preview': 'false',
  });
  assert.deepEqual(
    buildMCPParamHeaders(validBindings(), {
      region: null,
      options: {},
    }),
    {}
  );
});

await test('validates exact nested values and equivalent integer spellings', () => {
  const bindings = validBindings();
  const argumentsValue = {
    region: '東京',
    options: { shard: 42, preview: false },
  };
  const valid = validateMCPParamHeaders({
    bindings,
    argumentsValue,
    rawHeaders: [
      'Mcp-Param-Region',
      encodeMCPHeaderValue('東京'),
      'Mcp-Param-Shard',
      '42.0',
      'Mcp-Param-Preview',
      'false',
    ],
  });
  assert.deepEqual(valid, { ok: true });
});

await test('rejects missing, unexpected, malformed, duplicate, and mismatched values', () => {
  const [region] = validBindings();
  for (const result of [
    validateMCPParamHeaders({
      bindings: [region],
      argumentsValue: { region: 'west' },
      rawHeaders: [],
    }),
    validateMCPParamHeaders({
      bindings: [region],
      argumentsValue: {},
      rawHeaders: ['Mcp-Param-Region', 'west'],
    }),
    validateMCPParamHeaders({
      bindings: [region],
      argumentsValue: { region: 'west' },
      rawHeaders: ['Mcp-Param-Region', '=?base64?bad?='],
    }),
    validateMCPParamHeaders({
      bindings: [region],
      argumentsValue: { region: 'west' },
      rawHeaders: ['Mcp-Param-Region', 'west', 'mcp-param-region', 'west'],
    }),
    validateMCPParamHeaders({
      bindings: [region],
      argumentsValue: { region: 'west' },
      rawHeaders: ['Mcp-Param-Region', 'east'],
    }),
  ]) {
    assert.equal(result.ok, false);
  }
});

await test('outbound HTTP calls mirror routing values without mutating shared headers', async () => {
  const schemas = new Map<string, Record<string, unknown>>([
    [
      'geo.lookup',
      {
        type: 'object',
        properties: {
          region: { type: 'string', 'x-mcp-header': 'Region' },
        },
      },
    ],
  ]);
  const observed: Array<{ headers: Headers; body: string | undefined }> = [];
  const baseHeaders = new Headers({ Authorization: 'Bearer test' });
  const fetchImpl: typeof fetch = async (_input, init) => {
    observed.push({
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return new Response('{}', { status: 200 });
  };
  const routingFetch = createMCPRoutingFetch(schemas, fetchImpl);

  await Promise.all([
    routingFetch('https://example.test/mcp', {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'geo.lookup', arguments: { region: 'west' } },
      }),
    }),
    routingFetch('https://example.test/mcp', {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'geo.lookup', arguments: { region: 'east' } },
      }),
    }),
  ]);

  assert.equal(baseHeaders.has('Mcp-Method'), false);
  assert.deepEqual(observed.map((request) => request.headers.get('Mcp-Param-Region')).sort(), [
    'east',
    'west',
  ]);
  for (const request of observed) {
    assert.equal(request.headers.get('Mcp-Method'), 'tools/call');
    assert.equal(request.headers.get('Mcp-Name'), 'geo.lookup');
    assert.equal(request.headers.get('Authorization'), 'Bearer test');
  }
});

await test('extracts MCP 2026 method and name headers for SDK client calls', async () => {
  assert.deepEqual(
    getMCPRequestRoutingHeaders({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'consult/listAvailableSlots', arguments: {} },
    }),
    { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'consult/listAvailableSlots' }
  );
  assert.deepEqual(getMCPRequestRoutingHeaders({ method: 'tools/list', params: {} }), {
    'Mcp-Method': 'tools/list',
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
