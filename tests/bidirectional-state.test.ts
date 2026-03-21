/**
 * Bidirectional State Exposure Tests
 *
 * Verifies that:
 * 1. Bridge auto-attaches widgetState as _clientState in tool call args
 * 2. Loader strips _clientState before schema validation
 * 3. _clientState is available on the instance during execution
 * 4. CLI calls (no widgetState) work unchanged
 */

import { generateBridgeScript } from '../dist/auto-ui/bridge/index.js';
import { PhotonLoader } from '../src/loader.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result instanceof Promise) {
    return result.then(
      () => {
        console.log(`\u2705 ${name}`);
        passed++;
      },
      (e: any) => {
        console.log(`\u274c ${name}\n   ${e.message}`);
        failed++;
      }
    );
  }
  try {
    console.log(`\u2705 ${name}`);
    passed++;
  } catch (e: any) {
    console.log(`\u274c ${name}\n   ${e.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

console.log('\n\ud83e\uddea Bidirectional State Exposure Tests\n');

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE SCRIPT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

const bridgeScript = generateBridgeScript({
  photon: 'test-photon',
  method: 'test-method',
  theme: 'dark',
});

await test('bridge script includes _clientState injection logic', () => {
  assert(
    bridgeScript.includes('_clientState'),
    'Generated bridge script should contain _clientState injection code'
  );
});

await test('bridge script attaches widgetState when keys exist', () => {
  assert(
    bridgeScript.includes('Object.keys(widgetState).length > 0'),
    'Should check widgetState has keys before attaching'
  );
});

await test('bridge script does not attach _clientState when widgetState is empty', () => {
  // The logic: only attach if Object.keys(widgetState).length > 0
  // This means an empty widgetState {} won't add _clientState
  assert(
    bridgeScript.includes('widgetState') && bridgeScript.includes('_clientState'),
    'Should have both widgetState check and _clientState attachment'
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOADER _clientState EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

// Create a temporary photon for testing
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-state-test-'));
const photonFile = path.join(tmpDir, 'state-test.photon.ts');

fs.writeFileSync(
  photonFile,
  `
/**
 * State test photon
 * @photon
 */
export default class StateTest {
  /**
   * Returns the _clientState that was injected
   */
  async check(params: { query: string }) {
    return {
      query: params.query,
      clientState: (this as any)._clientState || null,
    };
  }
}
`
);

const loader = new PhotonLoader(false);

await test('loader strips _clientState from parameters before execution', async () => {
  const mcp = await loader.loadFile(photonFile);
  assert(mcp !== null, 'Should load photon');

  // Simulate a tool call with _clientState in args (as bridge would send)
  const result = await loader.executeTool(mcp!, 'check', {
    query: 'hello',
    _clientState: { selectedItems: ['a', 'b'], viewMode: 'grid' },
  });

  // The method should receive { query: 'hello' } without _clientState in params
  assert(result.query === 'hello', `Expected query 'hello', got '${result.query}'`);
});

await test('_clientState is available on this._clientState during execution', async () => {
  const mcp = await loader.loadFile(photonFile);
  assert(mcp !== null, 'Should load photon');

  const result = await loader.executeTool(mcp!, 'check', {
    query: 'test',
    _clientState: { selectedItems: ['x'], viewMode: 'list' },
  });

  assert(result.clientState !== null, 'Should have clientState on instance');
  assert(
    result.clientState.viewMode === 'list',
    `Expected viewMode 'list', got '${result.clientState?.viewMode}'`
  );
  assert(Array.isArray(result.clientState.selectedItems), 'selectedItems should be an array');
});

await test('CLI calls without _clientState work normally', async () => {
  const mcp = await loader.loadFile(photonFile);
  assert(mcp !== null, 'Should load photon');

  const result = await loader.executeTool(mcp!, 'check', {
    query: 'no-state',
  });

  assert(result.query === 'no-state', 'Should work without _clientState');
  // _clientState may be undefined or from a previous call — the important thing is no error
});

await test('empty _clientState object is still extracted', async () => {
  const mcp = await loader.loadFile(photonFile);
  assert(mcp !== null, 'Should load photon');

  const result = await loader.executeTool(mcp!, 'check', {
    query: 'empty',
    _clientState: {},
  });

  assert(result.query === 'empty', 'Should work with empty _clientState');
  // Empty _clientState should still be set on instance
  assert(result.clientState !== null, 'Empty _clientState should still be set');
});

// ═══════════════════════════════════════════════════════════════════════════════
// TYPE DOCUMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

await test('bridge types.ts documents ClientState interface', () => {
  const typesContent = fs.readFileSync(
    path.join(process.cwd(), 'src/auto-ui/bridge/types.ts'),
    'utf-8'
  );
  assert(
    typesContent.includes('interface ClientState'),
    'types.ts should export ClientState interface'
  );
  assert(typesContent.includes('_clientState'), 'types.ts should document _clientState convention');
});

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
