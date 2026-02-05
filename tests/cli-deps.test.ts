/**
 * Tests for @cli dependency checking
 *
 * Verifies that the loader checks for system CLI tools at load time
 * using `which` (Unix/Mac) or `where` (Windows) and fails with a
 * helpful error when tools are missing.
 *
 * Run: npx tsx tests/cli-deps.test.ts
 */

import { PhotonLoader } from '../src/loader.js';

async function testCliDepsPresent() {
  console.log('\n=== TEST 1: @cli with tools that exist (node, git) ===\n');

  const loader = new PhotonLoader(true);
  const photon = await loader.loadFile('./tests/fixtures/with-cli-deps.photon.ts');

  console.log('✅ Loaded photon:', photon.name);
  console.log('   Tools:', photon.tools.map(t => t.name).join(', '));

  // Verify the tool actually works
  const result = await loader.executeTool(photon, 'greet', { input: 'world' });
  console.log('✅ Tool executed:', JSON.stringify(result));

  if (result.result !== 'Hello, world') {
    throw new Error(`Unexpected result: ${result.result}`);
  }
  console.log('✅ CLI dependency check passed — photon loaded and executed');
}

async function testCliDepsMissing() {
  console.log('\n=== TEST 2: @cli with a tool that does NOT exist ===\n');

  const loader = new PhotonLoader(false);

  try {
    await loader.loadFile('./tests/fixtures/with-missing-cli.photon.ts');
    throw new Error('Expected CLIDependencyError but photon loaded successfully');
  } catch (error: any) {
    if (error.name === 'CLIDependencyError') {
      console.log('✅ Got expected CLIDependencyError:');
      console.log(`   ${error.message}`);

      // Verify the error message contains the tool name and install URL
      if (!error.message.includes('nonexistent-tool-xyz-99')) {
        throw new Error('Error message missing tool name');
      }
      if (!error.message.includes('https://example.com/install')) {
        throw new Error('Error message missing install URL');
      }
      console.log('✅ Error message contains tool name and install URL');
    } else {
      throw error;
    }
  }
}

async function main() {
  console.log('🧪 Running @cli dependency tests...');

  await testCliDepsPresent();
  await testCliDepsMissing();

  console.log('\n✅ All @cli dependency tests passed!\n');
}

main().catch((err) => {
  console.error('\n❌ Test failed:', err.message);
  process.exit(1);
});
