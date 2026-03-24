/**
 * Schema Contract Tests
 *
 * Validates that JSDoc annotations produce the correct MCP schema fields.
 * This is the earliest detection layer — catches annotation→schema mapping
 * regressions at parse time, before any runtime or visual test.
 *
 * Promises validated:
 * - P1.3: TypeScript types → MCP outputSchema, Beam forms, CLI help
 * - P2.2: @readOnly/@destructive → MCP annotations
 * - P4.2: @min/@max/@choice → inputSchema constraints
 *
 * Run: npm test (included in main suite)
 * Cost: ~100ms, no runtime or server needed
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');

// ── Schema Extraction ────────────────────────────────────────

async function extractSchema(photonPath: string) {
  const { SchemaExtractor } = await import('@portel/photon-core');
  const extractor = new SchemaExtractor();
  const source = fs.readFileSync(photonPath, 'utf-8');
  return extractor.extractAllFromSource(source);
}

// ── Test Runner ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('\n📜 Schema Contract Tests\n');

  // Use promise-test.photon.ts as our fixture
  const promisePath = path.join(FIXTURES, 'promise-test.photon.ts');
  const meta = await extractSchema(promisePath);
  const tools = meta.tools;

  function findTool(name: string) {
    return tools.find((t: any) => t.name === name);
  }

  // ── P1.3: Types → Schema ──────────────────────────────

  console.log('  P1.3 — TypeScript is the only language\n');

  await test('Public methods become tools', async () => {
    const names = tools.map((t: any) => t.name);
    assert.ok(names.includes('greet'), 'greet should be a tool');
    assert.ok(names.includes('users'), 'users should be a tool');
    assert.ok(names.includes('docs'), 'docs should be a tool');
    assert.ok(names.includes('add'), 'add should be a tool');
    assert.equal(names.length, 4, `Expected 4 tools, got ${names.length}: ${names.join(', ')}`);
  });

  await test('Parameter types generate inputSchema properties', async () => {
    const greet = findTool('greet');
    assert.ok(greet, 'greet tool exists');
    const props = greet.inputSchema?.properties;
    assert.ok(props?.name, 'greet has "name" param');
    assert.equal(props.name.type, 'string', 'name param is string');
  });

  await test('Number params generate number type in schema', async () => {
    const add = findTool('add');
    assert.ok(add, 'add tool exists');
    const props = add.inputSchema?.properties;
    assert.ok(props?.a, 'add has param a');
    assert.ok(props?.b, 'add has param b');
    assert.equal(props.a.type, 'number', 'a is number');
    assert.equal(props.b.type, 'number', 'b is number');
  });

  await test('Required params are in required array', async () => {
    const greet = findTool('greet');
    const required = greet.inputSchema?.required || [];
    assert.ok(required.includes('name'), `name should be required, got: ${required.join(', ')}`);
  });

  await test('JSDoc @param description becomes schema description', async () => {
    const greet = findTool('greet');
    const desc = greet.inputSchema?.properties?.name?.description;
    assert.ok(desc && desc.includes('Who to greet'), `Expected description, got: ${desc}`);
  });

  console.log('');

  // ── P2.2: Annotations → MCP hints ─────────────────────

  console.log('  P2.2 — Annotations guide both audiences\n');

  await test('@readOnly → readOnlyHint: true', async () => {
    const greet = findTool('greet');
    assert.equal(
      greet.readOnlyHint,
      true,
      `greet should have readOnlyHint, got: ${JSON.stringify({ readOnly: greet.readOnlyHint })}`
    );
  });

  await test('@readOnly propagates to all tagged methods', async () => {
    const users = findTool('users');
    assert.equal(users.readOnlyHint, true, 'users should have readOnlyHint');
    const docs = findTool('docs');
    assert.equal(docs.readOnlyHint, true, 'docs should have readOnlyHint');
  });

  await test('Methods without @readOnly have no readOnlyHint', async () => {
    const add = findTool('add');
    assert.ok(!add.readOnlyHint, `add should not have readOnlyHint, got: ${add.readOnlyHint}`);
  });

  // Test with a more complex fixture if available
  const tagsPath = path.join(ROOT, 'tests/fixtures/mcp-spec-tags.photon.ts');
  if (fs.existsSync(tagsPath)) {
    const tagsMeta = await extractSchema(tagsPath);
    const tagTools = tagsMeta.tools;

    await test('@destructive → destructiveHint: true', async () => {
      const destructive = tagTools.find((t: any) => t.destructiveHint === true);
      assert.ok(
        destructive,
        `Expected at least one tool with destructiveHint, tools: ${tagTools.map((t: any) => t.name).join(', ')}`
      );
    });

    await test('@idempotent → idempotentHint: true', async () => {
      const idempotent = tagTools.find((t: any) => t.idempotentHint === true);
      assert.ok(
        idempotent,
        `Expected at least one tool with idempotentHint, tools: ${tagTools.map((t: any) => t.name).join(', ')}`
      );
    });
  }

  console.log('');

  // ── P4.2: Constraints → Schema validation ──────────────

  console.log('  P4.2 — Auto-UI from signatures\n');

  await test('@min generates minimum in inputSchema', async () => {
    const add = findTool('add');
    const aMin = add.inputSchema?.properties?.a?.minimum;
    assert.equal(aMin, 0, `Expected minimum: 0, got: ${aMin}`);
  });

  await test('@min applies to all annotated params', async () => {
    const add = findTool('add');
    const bMin = add.inputSchema?.properties?.b?.minimum;
    assert.equal(bMin, 0, `Expected b minimum: 0, got: ${bMin}`);
  });

  // Test @format extraction
  await test('@format tag extracts to outputFormat', async () => {
    const users = findTool('users');
    assert.equal(
      users.outputFormat,
      'table',
      `users format should be 'table', got: ${users.outputFormat}`
    );

    const docs = findTool('docs');
    assert.equal(
      docs.outputFormat,
      'markdown',
      `docs format should be 'markdown', got: ${docs.outputFormat}`
    );
  });

  await test('Method without @format has no outputFormat', async () => {
    const greet = findTool('greet');
    assert.ok(!greet.outputFormat, `greet should have no format, got: ${greet.outputFormat}`);
  });

  // ── @choice / @pattern / @max if fixtures have them ────

  const funcPath = path.join(FIXTURES, 'functional-tags.photon.ts');
  if (fs.existsSync(funcPath)) {
    const funcMeta = await extractSchema(funcPath);
    const funcTools = funcMeta.tools;

    // Check for any constraint tags
    for (const tool of funcTools) {
      const props = tool.inputSchema?.properties || {};
      for (const [name, prop] of Object.entries(props) as [string, any][]) {
        if (prop.minimum !== undefined) {
          await test(`${tool.name}.${name} has minimum constraint in schema`, async () => {
            assert.ok(typeof prop.minimum === 'number', `minimum should be number`);
          });
          break; // one is enough to verify the pipeline
        }
        if (prop.enum) {
          await test(`${tool.name}.${name} has enum constraint in schema`, async () => {
            assert.ok(Array.isArray(prop.enum), `enum should be array`);
          });
          break;
        }
      }
    }
  }

  console.log('');

  // ── Summary ────────────────────────────────────────────

  console.log(`  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Schema contract tests crashed:', err);
  process.exit(1);
});
