/**
 * Sidebar Counts Tests
 *
 * Verifies that photon-level metadata (promptCount, resourceCount, description,
 * icon) propagates from backend tool extensions through to frontend photon objects.
 *
 * This was a regression where toolsToPhotons() reconstructed photon objects from
 * MCP tools but never extracted photon-level metadata — so the sidebar showed
 * no prompt or resource counts.
 */

import assert from 'node:assert/strict';

// ============================================================================
// Test runner
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

// ============================================================================
// Replicate toolsToPhotons logic (from mcp-client.ts)
// This is a pure data transform — extracted here to test without browser APIs.
// ============================================================================

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  [key: string]: unknown;
}

function toolsToPhotons(tools: MCPTool[]) {
  const photonMap = new Map<string, any>();

  for (const tool of tools) {
    const slashIndex = tool.name.indexOf('/');
    if (slashIndex === -1) continue;

    const photonName = tool.name.slice(0, slashIndex);
    const methodName = tool.name.slice(slashIndex + 1);

    if (!photonMap.has(photonName)) {
      photonMap.set(photonName, {
        id: tool['x-photon-id'] || photonName,
        name: photonName,
        path: tool['x-photon-path'],
        description: tool['x-photon-description'],
        icon: tool['x-photon-icon'],
        promptCount: tool['x-photon-prompt-count'] || 0,
        resourceCount: tool['x-photon-resource-count'] || 0,
        configured: true,
        methods: [],
      });
    }

    photonMap.get(photonName).methods.push({
      name: methodName,
      description: tool.description || '',
      params: tool.inputSchema || { type: 'object', properties: {} },
      icon: tool['x-icon'],
      autorun: tool['x-autorun'],
      outputFormat: tool['x-output-format'],
      layoutHints: tool['x-layout-hints'],
      buttonLabel: tool['x-button-label'],
      linkedUi: tool._meta?.ui?.resourceUri?.match(/^ui:\/\/[^/]+\/(.+)$/)?.[1],
    });
  }

  for (const photon of photonMap.values()) {
    const mainMethod = photon.methods.find((m: any) => m.name === 'main' && m.linkedUi);
    if (mainMethod) {
      photon.isApp = true;
      photon.appEntry = mainMethod;
    }
  }

  return Array.from(photonMap.values());
}

// ============================================================================
// Fixtures — simulate tools/list response with photon-level extensions
// ============================================================================

function makeTools(): MCPTool[] {
  return [
    {
      name: 'serum/truth',
      description: 'Truth serum',
      inputSchema: { type: 'object', properties: {} },
      'x-photon-id': 'abc123',
      'x-photon-path': '/photons/serum.photon.ts',
      'x-photon-description': 'Forces unfiltered honesty',
      'x-photon-icon': '💉',
      'x-photon-prompt-count': 10,
      'x-photon-resource-count': 0,
      'x-output-format': 'markdown',
    },
    {
      name: 'serum/clarity',
      description: 'Clarity serum',
      inputSchema: { type: 'object', properties: {} },
      'x-photon-id': 'abc123',
      'x-photon-path': '/photons/serum.photon.ts',
      'x-photon-description': 'Forces unfiltered honesty',
      'x-photon-icon': '💉',
      'x-photon-prompt-count': 10,
      'x-photon-resource-count': 0,
    },
    {
      name: 'preferences/get',
      description: 'Get preferences',
      inputSchema: { type: 'object', properties: {} },
      'x-photon-id': 'def456',
      'x-photon-path': '/photons/preferences.photon.ts',
      'x-photon-description': 'User preferences manager',
      'x-photon-icon': '⚙️',
      'x-photon-prompt-count': 0,
      'x-photon-resource-count': 1,
    },
  ];
}

// ============================================================================
// Tests
// ============================================================================

async function testPhotonMetadataExtraction() {
  console.log('\ntoolsToPhotons metadata extraction:');

  await test('extracts promptCount from tool extensions', () => {
    const photons = toolsToPhotons(makeTools());
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.promptCount, 10);
  });

  await test('extracts resourceCount from tool extensions', () => {
    const photons = toolsToPhotons(makeTools());
    const prefs = photons.find((p) => p.name === 'preferences');
    assert.equal(prefs.resourceCount, 1);
  });

  await test('extracts description from tool extensions', () => {
    const photons = toolsToPhotons(makeTools());
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.description, 'Forces unfiltered honesty');
  });

  await test('extracts icon from tool extensions', () => {
    const photons = toolsToPhotons(makeTools());
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.icon, '💉');
  });

  await test('zero counts default correctly', () => {
    const photons = toolsToPhotons(makeTools());
    const prefs = photons.find((p) => p.name === 'preferences');
    assert.equal(prefs.promptCount, 0);
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.resourceCount, 0);
  });

  await test('missing extensions default to zero', () => {
    const tools: MCPTool[] = [
      {
        name: 'bare/method',
        description: 'No extensions',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
    const photons = toolsToPhotons(tools);
    assert.equal(photons[0].promptCount, 0);
    assert.equal(photons[0].resourceCount, 0);
    assert.equal(photons[0].description, undefined);
    assert.equal(photons[0].icon, undefined);
  });
}

async function testPhotonGrouping() {
  console.log('\ntoolsToPhotons grouping:');

  await test('groups multiple tools into one photon', () => {
    const photons = toolsToPhotons(makeTools());
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.methods.length, 2);
    assert.equal(serum.methods[0].name, 'truth');
    assert.equal(serum.methods[1].name, 'clarity');
  });

  await test('creates separate photons for different names', () => {
    const photons = toolsToPhotons(makeTools());
    assert.equal(photons.length, 2);
    assert.ok(photons.find((p) => p.name === 'serum'));
    assert.ok(photons.find((p) => p.name === 'preferences'));
  });

  await test('skips tools without slash separator', () => {
    const tools: MCPTool[] = [
      { name: 'no-slash', description: 'System tool' },
      { name: 'photon/method', description: 'Valid' },
    ];
    const photons = toolsToPhotons(tools);
    assert.equal(photons.length, 1);
    assert.equal(photons[0].name, 'photon');
  });

  await test('extracts photon-id and path', () => {
    const photons = toolsToPhotons(makeTools());
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.id, 'abc123');
    assert.equal(serum.path, '/photons/serum.photon.ts');
  });
}

async function testMethodMetadata() {
  console.log('\ntoolsToPhotons method metadata:');

  await test('extracts method-level outputFormat', () => {
    const photons = toolsToPhotons(makeTools());
    const serum = photons.find((p) => p.name === 'serum');
    assert.equal(serum.methods[0].outputFormat, 'markdown');
    assert.equal(serum.methods[1].outputFormat, undefined);
  });

  await test('detects app photons with main + linkedUi', () => {
    const tools: MCPTool[] = [
      {
        name: 'myapp/main',
        description: 'Main entry',
        _meta: { ui: { resourceUri: 'ui://myapp/board.html' } },
      },
      { name: 'myapp/helper', description: 'Helper' },
    ];
    const photons = toolsToPhotons(tools);
    assert.equal(photons[0].isApp, true);
    assert.equal(photons[0].appEntry.name, 'main');
  });
}

// ============================================================================
// Run
// ============================================================================

(async () => {
  console.log('Running Sidebar Counts Tests...\n');

  await testPhotonMetadataExtraction();
  await testPhotonGrouping();
  await testMethodMetadata();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
