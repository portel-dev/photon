#!/usr/bin/env tsx
/**
 * MCP Label Integration Tests
 * Tests that {@label} tags are properly exposed via MCP protocol
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { strict as assert } from 'assert';

const testPhotonContent = `
export default class LabelTestMCP {
  /**
   * Add two numbers with custom labels
   * @param a {@label First Number} First value to add
   * @param b {@label Second Number} Second value to add
   * @returns {@label Calculate Sum} The sum result
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }

  /**
   * Simple method without labels
   * @param value The value to echo
   */
  async echo(params: { value: string }) {
    return params.value;
  }

  /**
   * Method with mixed constraints and labels
   * @param level {@label Volume Level} {@min 0} {@max 100} The volume percentage
   */
  async setVolume(params: { level: number }) {
    return { volume: params.level };
  }
}
`;

async function runTests() {
  console.log('🧪 Running MCP Label Integration Tests...\n');

  const testDir = path.join(os.tmpdir(), 'photon-mcp-label-test');
  await fs.mkdir(testDir, { recursive: true });

  let passed = 0;
  let failed = 0;

  function logResult(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ ${testName}`);
      passed++;
    } else {
      console.log(`❌ ${testName}`);
      failed++;
    }
  }

  try {
    // Create test photon file
    const testFile = path.join(testDir, 'label-test.photon.ts');
    await fs.writeFile(testFile, testPhotonContent);

    // Import the loader dynamically
    const { PhotonLoader } = await import('../src/loader.js');
    const loader = new PhotonLoader(false); // quiet mode

    // Load the photon
    const mcp = await loader.loadFile(testFile);

    // Test 1: MCP loads with tools
    logResult(
      Array.isArray(mcp.tools) && mcp.tools.length === 3,
      'MCP loads 3 tools'
    );

    // Test 2: Tool with labels has title in schema
    const addTool = mcp.tools.find((t: any) => t.name === 'add');
    logResult(
      addTool?.inputSchema?.properties?.a?.title === 'First Number' &&
      addTool?.inputSchema?.properties?.b?.title === 'Second Number',
      'tools/list includes param labels (title property)'
    );

    // Test 3: Button label is included
    logResult(
      (addTool as any)?.buttonLabel === 'Calculate Sum',
      'Tool includes buttonLabel from @returns {@label}'
    );

    // Test 4: Description is clean (label tag removed)
    logResult(
      addTool?.inputSchema?.properties?.a?.description === 'First value to add',
      'Description has {@label} tag removed'
    );

    // Test 5: Method without labels has no title
    const echoTool = mcp.tools.find((t: any) => t.name === 'echo');
    logResult(
      echoTool?.inputSchema?.properties?.value?.title === undefined &&
      (echoTool as any)?.buttonLabel === undefined,
      'Method without labels has no title/buttonLabel'
    );

    // Test 6: Labels combined with other constraints
    const volumeTool = mcp.tools.find((t: any) => t.name === 'setVolume');
    logResult(
      volumeTool?.inputSchema?.properties?.level?.title === 'Volume Level' &&
      volumeTool?.inputSchema?.properties?.level?.minimum === 0 &&
      volumeTool?.inputSchema?.properties?.level?.maximum === 100,
      'Labels work with other constraints ({@min}, {@max})'
    );

    // Test 7: Tool execution with labels works
    const result = await loader.executeTool(mcp, 'add', { a: 5, b: 3 });
    logResult(
      result === 8,
      'Tool with labels executes correctly'
    );

    // Test 8: Verify schema is MCP-compatible (type: object)
    logResult(
      addTool?.inputSchema?.type === 'object' &&
      typeof addTool?.inputSchema?.properties === 'object',
      'Schema is MCP-compatible (type: object, has properties)'
    );

  } catch (error: any) {
    console.error('Test setup error:', error.message);
    failed++;
  } finally {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  }

  console.log(`\n${passed > 0 ? '✅' : '❌'} MCP Label tests: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

// Run tests
runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
