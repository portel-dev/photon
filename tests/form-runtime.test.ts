import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { ResourceServer } from '../dist/resource-server.js';
import { generateBridgeScript } from '../dist/auto-ui/bridge/index.js';
import { callFormTool } from '../src/auto-ui/frontend/services/form-runtime.ts';

const resourceServer = new ResourceServer(
  {
    executeTool: async () => ({}),
    getLoadedPhotons: () => new Map(),
  },
  { filePath: '' }
);

const canonicalBundle = readFileSync('dist/photon-form.bundle.js', 'utf8');
const compatibilityBundle = readFileSync('dist/beam-form.bundle.js', 'utf8');
const inlineableBundle = canonicalBundle.replace(/\n\/\/# sourceMappingURL=.*$/gm, '');

assert.equal(
  compatibilityBundle,
  canonicalBundle,
  'Beam compatibility bundle must be the canonical rich form runtime'
);

const formRuntime = resourceServer.generatePhotonFormRuntime();
assert.match(formRuntime, /data-photon-form-runtime/);
assert.ok(formRuntime.includes(inlineableBundle), 'MCP resources should inline the form bundle');
assert.ok(!formRuntime.includes('src="'), 'Inline form runtime must not fetch a script');
assert.ok(
  !formRuntime.includes('sourceMappingURL'),
  'Inline form runtime must not fetch a source map'
);

const mcpRuntime = resourceServer.generateMcpAppsRuntime(null);
assert.ok(mcpRuntime.includes('data-photon-form-runtime'));
assert.ok(
  !mcpRuntime.includes('/beam-form.bundle.js'),
  'MCP App runtime must not depend on the Beam bundle URL'
);

const bridge = generateBridgeScript({ theme: 'dark', hostName: 'beam' });
assert.ok(
  bridge.includes('data-photon-form-runtime'),
  'Bridge should recognize an inline canonical form runtime'
);
assert.ok(
  bridge.includes('/beam-form.bundle.js'),
  'Beam should retain the legacy form bundle fallback'
);

const previousWindow = globalThis.window;
const calls: string[] = [];
globalThis.window = {
  photon: {
    callTool: async (name: string) => {
      calls.push(`host:${name}`);
      return { source: 'host' };
    },
  },
} as unknown as Window & typeof globalThis;

const hostResult = await callFormTool(
  'demo/options',
  {},
  { callTool: async (name) => ({ source: `fallback:${name}` }) }
);
assert.deepEqual(hostResult, { source: 'host' });
assert.deepEqual(calls, ['host:demo/options']);

globalThis.window = {
  openai: {
    callTool: async (name: string) => ({ source: `openai:${name}` }),
  },
} as unknown as Window & typeof globalThis;
const openaiResult = await callFormTool(
  'demo/options',
  {},
  { callTool: async () => ({ source: 'fallback' }) }
);
assert.deepEqual(openaiResult, { source: 'openai:demo/options' });

globalThis.window = previousWindow;
console.log('✅ form runtime regression tests passed');
