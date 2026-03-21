/**
 * Tests for MCP Server Card generation
 */

import { strict as assert } from 'assert';
import { generateServerCard } from '../src/server-card.js';
import type { PhotonInfo, AnyPhotonInfo, UnconfiguredPhotonInfo } from '../src/auto-ui/types.js';
import { readFileSync } from 'fs';

console.log('Running Server Card Tests...\n');

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
      console.log(`    Error: ${(err as Error).message}`);
    });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const todoPhoton: PhotonInfo = {
  id: 'abc123',
  name: 'todo',
  path: '/tmp/todo.photon.ts',
  configured: true,
  description: 'Task management',
  icon: '📋',
  stateful: true,
  resourceCount: 2,
  promptCount: 1,
  methods: [
    { name: 'add', description: 'Add a task', params: {}, returns: {} },
    { name: 'list', description: 'List tasks', params: {}, returns: {} },
  ],
};

const calcPhoton: PhotonInfo = {
  id: 'def456',
  name: 'calc',
  path: '/tmp/calc.photon.ts',
  configured: true,
  description: 'Calculator',
  stateful: false,
  methods: [{ name: 'eval', description: 'Evaluate expression', params: {}, returns: {} }],
};

const unconfigured: UnconfiguredPhotonInfo = {
  id: 'ghi789',
  name: 'broken',
  path: '/tmp/broken.photon.ts',
  configured: false,
  requiredParams: [],
  errorMessage: 'Missing API key',
};

// ── Tests ────────────────────────────────────────────────────────────────────

await test('generates valid card from photon info', () => {
  const card = generateServerCard([todoPhoton, calcPhoton]);
  assert.equal(card.name, 'photon-beam');
  assert.equal(card.protocol, 'mcp');
  assert.ok(card.version);
  assert.ok(card.transport.length > 0);
  assert.equal(card.transport[0].type, 'streamable-http');
});

await test('includes all photon names and methods', () => {
  const card = generateServerCard([todoPhoton, calcPhoton]);
  assert.equal(card.photons.length, 2);
  assert.deepEqual(card.photons[0].methods, ['add', 'list']);
  assert.deepEqual(card.photons[1].methods, ['eval']);
  assert.equal(card.tools.length, 3);
  assert.equal(card.tools[0].name, 'todo/add');
  assert.equal(card.tools[1].name, 'todo/list');
  assert.equal(card.tools[2].name, 'calc/eval');
});

await test('marks stateful photons correctly', () => {
  const card = generateServerCard([todoPhoton, calcPhoton]);
  assert.equal(card.photons[0].stateful, true);
  assert.equal(card.photons[1].stateful, false);
});

await test('includes icon for photons that have one', () => {
  const card = generateServerCard([todoPhoton, calcPhoton]);
  assert.equal(card.photons[0].icon, '📋');
  assert.equal(card.photons[1].icon, undefined);
});

await test('includes AG-UI experimental capability', () => {
  const card = generateServerCard([todoPhoton]);
  assert.ok(card.experimental);
  assert.equal(card.experimental!['ag-ui'], true);
});

await test('card is valid JSON', () => {
  const card = generateServerCard([todoPhoton, calcPhoton]);
  const json = JSON.stringify(card);
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, 'photon-beam');
  assert.equal(parsed.tools.length, 3);
});

await test('detects resources and prompts capabilities', () => {
  const card = generateServerCard([todoPhoton]);
  assert.ok(card.capabilities.includes('tools'));
  assert.ok(card.capabilities.includes('resources'));
  assert.ok(card.capabilities.includes('prompts'));
});

await test('omits resources/prompts when none present', () => {
  const card = generateServerCard([calcPhoton]);
  assert.ok(card.capabilities.includes('tools'));
  assert.ok(!card.capabilities.includes('resources'));
  assert.ok(!card.capabilities.includes('prompts'));
});

await test('skips unconfigured photons', () => {
  const card = generateServerCard([todoPhoton, unconfigured]);
  assert.equal(card.photons.length, 1);
  assert.equal(card.photons[0].name, 'todo');
  assert.equal(card.tools.length, 2);
});

await test('includes baseUrl in transport when provided', () => {
  const card = generateServerCard([todoPhoton], { baseUrl: 'http://localhost:3000' });
  assert.equal(card.transport[0].url, 'http://localhost:3000/mcp');
});

await test('handles empty photon list', () => {
  const card = generateServerCard([]);
  assert.equal(card.photons.length, 0);
  assert.equal(card.tools.length, 0);
  assert.deepEqual(card.capabilities, ['tools']);
});

await test('HTTP endpoint exists in beam.ts', () => {
  const beamSource = readFileSync(new URL('../src/auto-ui/beam.ts', import.meta.url), 'utf-8');
  assert.ok(
    beamSource.includes('/.well-known/mcp-server'),
    'beam.ts should have /.well-known/mcp-server route'
  );
  assert.ok(beamSource.includes('generateServerCard'), 'beam.ts should call generateServerCard');
});

await test('MCP handler exists in streamable-http-transport.ts', () => {
  const transportSource = readFileSync(
    new URL('../src/auto-ui/streamable-http-transport.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(transportSource.includes("'server/card'"), 'transport should have server/card handler');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
