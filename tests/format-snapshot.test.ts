/**
 * Format Snapshot Tests
 *
 * Verifies every @format type produces non-empty output on CLI
 * and valid MCP response. Catches the recurring pattern of new
 * @format tags shipping with incomplete renderers.
 *
 * Prevents: v1.14.0 (slides), v1.18.0 (magazine), v1.21.0 (unknown fallback)
 */

import { execSync } from 'child_process';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, '..', 'dist', 'cli.js');
const FORMAT_PHOTON = path.join(__dirname, 'fixtures', 'format-test.photon.ts');

let passed = 0;
let failed = 0;

function cli(method: string): string {
  return execSync(`node ${CLI_PATH} cli ${FORMAT_PHOTON} ${method}`, {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message?.slice(0, 200)}`);
  }
}

async function runTests() {
  console.log('🧪 Format snapshot tests\n');
  console.log('── CLI output (no silent drops) ──\n');

  const formats = [
    'table',
    'markdown',
    'card',
    'kv',
    'json',
    'primitive',
    'list',
    'tree',
    'unknown',
  ];

  for (const format of formats) {
    test(`@format ${format} produces non-empty CLI output`, () => {
      const out = cli(format);
      assert.ok(out.trim().length > 0, `Empty output for @format ${format}`);
    });
  }

  // Specific content checks
  console.log('\n── Content verification ──\n');

  test('@format table contains data rows', () => {
    const out = cli('table');
    assert.ok(out.includes('Alice') && out.includes('Bob'), `Missing data: ${out.slice(0, 100)}`);
  });

  test('@format markdown renders heading', () => {
    const out = cli('markdown');
    assert.ok(out.includes('Hello'), `Missing heading: ${out.slice(0, 100)}`);
  });

  test('@format card contains values', () => {
    const out = cli('card');
    assert.ok(
      out.includes('Test Card') || out.includes('42'),
      `Missing card data: ${out.slice(0, 100)}`
    );
  });

  test('@format json contains nested structure', () => {
    const out = cli('json');
    assert.ok(
      out.includes('nested') || out.includes('data'),
      `Missing JSON data: ${out.slice(0, 100)}`
    );
  });

  test('@format primitive shows value directly', () => {
    const out = cli('primitive');
    assert.ok(out.includes('42'), `Expected 42: ${out.slice(0, 100)}`);
  });

  test('@format unknown does not silently drop data', () => {
    const out = cli('unknown');
    assert.ok(out.includes('10') || out.includes('value'), `Data dropped: ${out.slice(0, 100)}`);
  });

  // A2UI v0.9 — every method emits a valid three-message JSONL lifecycle
  console.log('\n── A2UI v0.9 JSONL output ──\n');

  function parseA2UIJsonl(raw: string): Array<Record<string, unknown>> {
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{') && l.endsWith('}'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  }

  test('@format a2ui on array of rows emits valid v0.9 JSONL', () => {
    const out = cli('a2uiRows');
    const msgs = parseA2UIJsonl(out);
    assert.ok(msgs.length >= 3, `expected ≥3 messages, got ${msgs.length}`);
    assert.equal(msgs[0].version, 'v0.9');
    assert.ok('createSurface' in msgs[0], 'first message must be createSurface');
    assert.ok(
      msgs.some((m) => 'updateComponents' in m),
      'updateComponents missing'
    );
    assert.ok(
      msgs.some((m) => 'updateDataModel' in m),
      'updateDataModel missing'
    );
  });

  test('@format a2ui uses the Basic catalog', () => {
    const out = cli('a2uiObject');
    const msgs = parseA2UIJsonl(out);
    const create = msgs.find((m) => 'createSurface' in m);
    const surface = (create as { createSurface: { catalogId: string } }).createSurface;
    assert.ok(
      surface.catalogId.includes('basic_catalog.json'),
      `expected Basic catalog, got ${surface.catalogId}`
    );
  });

  test('@format a2ui surfaceId is consistent across the lifecycle', () => {
    const out = cli('a2uiRows');
    const msgs = parseA2UIJsonl(out);
    const ids = new Set(
      msgs.map((m) => {
        const payload = (m.createSurface ?? m.updateComponents ?? m.updateDataModel) as {
          surfaceId: string;
        };
        return payload.surfaceId;
      })
    );
    assert.equal(ids.size, 1, `expected one surfaceId across the triple, got ${ids.size}`);
  });

  test('@format a2ui escape hatch emits components verbatim', () => {
    const out = cli('a2uiEscape');
    const msgs = parseA2UIJsonl(out);
    const update = msgs.find((m) => 'updateComponents' in m) as {
      updateComponents: { components: Array<{ id: string; component: string; text?: string }> };
    };
    const titleNode = update.updateComponents.components.find((c) => c.id === 'title');
    assert.equal(titleNode?.text, 'Verbatim surface', 'escape hatch text should pass through');
  });

  test('@format a2ui card-shaped result becomes a Card with action buttons', () => {
    const out = cli('a2uiCard');
    const msgs = parseA2UIJsonl(out);
    const update = msgs.find((m) => 'updateComponents' in m) as {
      updateComponents: { components: Array<{ id: string; component: string }> };
    };
    const root = update.updateComponents.components.find((c) => c.id === 'root');
    assert.equal(root?.component, 'Card');
    const buttons = update.updateComponents.components.filter((c) => c.component === 'Button');
    assert.equal(buttons.length, 2, 'Deploy + Cancel buttons expected');
  });

  // MCP verification
  console.log('\n── MCP response verification ──\n');

  test('MCP tools include all format methods', async () => {
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    const transport = new StdioClientTransport({
      command: 'node',
      args: [CLI_PATH, 'mcp', 'format-test'],
      env: { ...process.env, PHOTON_DIR: path.join(__dirname, 'fixtures') },
    });
    const client = new Client({ name: 'format-test', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const format of formats) {
      assert.ok(names.includes(format), `Missing MCP tool: ${format}`);
    }

    // Verify a call returns content
    const result = await client.callTool({ name: 'table', arguments: {} });
    const text = result.content?.find((c: any) => c.type === 'text')?.text;
    assert.ok(text && text.includes('Alice'), `MCP table result missing data`);

    await client.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(1);
});
