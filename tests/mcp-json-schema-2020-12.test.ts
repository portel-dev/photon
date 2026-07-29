import { strict as assert } from 'node:assert';
import {
  JSON_SCHEMA_2020_12_DIALECT,
  MCP_JSON_SCHEMA_LIMITS,
  isFiniteJSONValue,
  stopJSONSchemaValidationWorker,
  validateStructuredOutput,
  withJSONSchemaDialect,
} from '../dist/mcp/protocol/json-schema.js';
import { __externalMCPInternals } from '../dist/auto-ui/beam/external-mcp.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

async function main(): Promise<void> {
  console.log('\nMCP JSON Schema 2020-12:');

  await test('validates local refs and composition keywords without rewriting', async () => {
    const schema = {
      $schema: JSON_SCHEMA_2020_12_DIALECT,
      $defs: {
        base: {
          $anchor: 'base-value',
          type: 'object',
          required: ['kind', 'payload', 'choice', 'nullable'],
          properties: {
            kind: { enum: ['count', 'label'] },
            payload: {},
            choice: { oneOf: [{ const: 'x' }, { const: 'y' }] },
            nullable: { type: ['string', 'null'] },
          },
        },
      },
      allOf: [
        { $ref: '#base-value' },
        {
          if: { properties: { kind: { const: 'count' } } },
          then: { properties: { payload: { type: 'integer' } } },
          else: { properties: { payload: { type: 'string' } } },
        },
        {
          anyOf: [
            { properties: { choice: { const: 'x' } } },
            { properties: { choice: { const: 'y' } } },
          ],
        },
        { not: { properties: { payload: { const: 'forbidden' } } } },
      ],
    } as const;
    const snapshot = JSON.stringify(schema);
    const result = await validateStructuredOutput(schema, {
      kind: 'count',
      payload: 3,
      choice: 'x',
      nullable: null,
    });
    assert.equal(result.ok, true);
    assert.equal(JSON.stringify(schema), snapshot);
  });

  await test('accepts every finite JSON root against a matching schema', async () => {
    for (const [schema, value] of [
      [{ type: 'object' }, { ok: true }],
      [{ type: 'array', items: { type: 'integer' } }, [1, 2, 3]],
      [{ type: 'string' }, 'value'],
      [{ type: 'number' }, 0],
      [{ type: 'boolean' }, false],
      [{ type: 'null' }, null],
    ] as const) {
      const result = await validateStructuredOutput(schema, value);
      assert.equal(result.ok, true);
      if (result.ok) assert.deepEqual(result.value, value);
    }
  });

  await test('returns bounded validation issues for mismatched output', async () => {
    const result = await validateStructuredOutput(
      {
        type: 'object',
        required: ['count'],
        properties: { count: { type: 'integer', minimum: 1 } },
      },
      { count: 'not-an-integer' }
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.kind, 'invalid-output');
      assert((result.issues?.length ?? 0) <= MCP_JSON_SCHEMA_LIMITS.maxIssues);
      assert(JSON.stringify(result).length < 2_048);
    }
    const alwaysInvalid = await validateStructuredOutput(false, null);
    assert.equal(alwaysInvalid.ok, false);
    if (!alwaysInvalid.ok) assert.equal(alwaysInvalid.kind, 'invalid-output');
  });

  await test('rejects external, unresolved, and circular references without I/O', async () => {
    const schemas = [
      { $ref: 'https://example.invalid/schema.json' },
      { $ref: 'file:///etc/passwd' },
      { $dynamicRef: 'https://example.invalid/dynamic.json' },
      { $ref: '#/$defs/missing', $defs: {} },
      {
        $defs: {
          node: {
            type: 'object',
            properties: { next: { $ref: '#/$defs/node' } },
          },
        },
        $ref: '#/$defs/node',
      },
    ];
    for (const schema of schemas) {
      const result = await validateStructuredOutput(schema, {});
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.kind, 'invalid-schema');
    }
  });

  await test('enforces schema depth, reference count, and output size limits', async () => {
    let deep: Record<string, unknown> = { type: 'string' };
    for (let index = 0; index <= MCP_JSON_SCHEMA_LIMITS.maxSchemaDepth; index++) {
      deep = { allOf: [deep] };
    }
    const tooManyRefs = {
      $defs: { value: { type: 'string' } },
      allOf: Array.from({ length: MCP_JSON_SCHEMA_LIMITS.maxSchemaReferences + 1 }, () => ({
        $ref: '#/$defs/value',
      })),
    };
    const oversizedOutput = Array.from(
      { length: MCP_JSON_SCHEMA_LIMITS.maxOutputArrayLength + 1 },
      () => 1
    );

    for (const [schema, value, expectedKind] of [
      [deep, 'value', 'schema-limit'],
      [tooManyRefs, 'value', 'schema-limit'],
      [{ type: 'array' }, oversizedOutput, 'output-limit'],
    ] as const) {
      const result = await validateStructuredOutput(schema, value);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.kind, expectedKind);
    }
  });

  await test('limit overrides can tighten but never relax production ceilings', async () => {
    const tightened = await validateStructuredOutput({ type: 'array' }, [1, 2], {
      maxOutputArrayLength: 1,
    });
    assert.equal(tightened.ok, false);
    if (!tightened.ok) assert.equal(tightened.kind, 'output-limit');

    const oversizedOutput = Array.from(
      { length: MCP_JSON_SCHEMA_LIMITS.maxOutputArrayLength + 1 },
      () => 1
    );
    const relaxed = await validateStructuredOutput({ type: 'array' }, oversizedOutput, {
      maxOutputArrayLength: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(relaxed.ok, false);
    if (!relaxed.ok) assert.equal(relaxed.kind, 'output-limit');
  });

  await test('hard validation deadline terminates and recovers the worker', async () => {
    stopJSONSchemaValidationWorker();
    const timedOut = await validateStructuredOutput({ type: 'string' }, 'value', {
      ...MCP_JSON_SCHEMA_LIMITS,
      maxValidationMs: 0,
    });
    assert.equal(timedOut.ok, false);
    if (!timedOut.ok) assert.equal(timedOut.kind, 'validation-timeout');

    const recovered = await validateStructuredOutput({ const: 'ok' }, 'ok');
    assert.equal(recovered.ok, true);
  });

  await test('rejects non-finite, cyclic, and non-JSON runtime values', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1n, undefined, cyclic]) {
      assert.equal(isFiniteJSONValue(value), false);
      const result = await validateStructuredOutput(true, value);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.kind, 'invalid-output');
    }
  });

  await test('adds a dialect only to authored schemas and preserves declared dialects', () => {
    assert.deepEqual(withJSONSchemaDialect({ type: 'string' }), {
      type: 'string',
      $schema: JSON_SCHEMA_2020_12_DIALECT,
    });
    const draft7 = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
    } as any;
    assert.equal(withJSONSchemaDialect(draft7), draft7);
  });

  await test('external MCP import preserves output schema keywords byte-for-byte', () => {
    const outputSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $defs: { value: { type: 'string' } },
      oneOf: [{ $ref: '#/$defs/value' }, { type: 'null' }],
      'x-upstream-vocabulary': { mode: 'strict' },
    };
    const [method] = __externalMCPInternals.toolsToMethods([
      {
        name: 'external',
        inputSchema: { type: 'object', properties: {} },
        outputSchema,
      },
    ]);
    assert.equal(method.outputSchema, outputSchema);
    assert.deepEqual(method.outputSchema, outputSchema);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
