/**
 * Test script for dependency injection
 *
 * Run with: npx tsx tests/injection/run-test.ts
 */

import { PhotonLoader } from '../../src/loader.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
  console.log('='.repeat(60));
  console.log('Testing Photon Dependency Injection');
  console.log('='.repeat(60));

  // Set up environment variables for primitive injection
  process.env.TEST_INJECTION_API_KEY = 'test-api-key-12345';
  process.env.TEST_INJECTION_TIMEOUT = '10000';
  process.env.TEST_INJECTION_DEBUG = 'true';

  const loader = new PhotonLoader(true); // verbose mode

  try {
    // Load the test Photon
    const photonPath = path.join(__dirname, 'test-injection.photon.ts');
    console.log('\n[1] Loading test Photon:', photonPath);

    const photon = await loader.loadFile(photonPath);

    console.log('\n[2] Photon loaded successfully');
    console.log('  Name:', photon.name);
    console.log('  Tools:', photon.tools.map(t => t.name).join(', '));

    // Access instance directly to check injections
    // (executeTool throws on config warnings, which is correct for production)
    const instance = photon.instance;

    console.log('\n[3] Testing injections (via instance inspection)...');

    // Check injected values directly
    const hasApiKey = !!(instance as any).apiKey;
    const apiKeyValue = (instance as any).apiKey;
    const timeout = (instance as any).timeout;
    const debug = (instance as any).debug;
    const hasHelper = !!(instance as any).helper;

    console.log('\n[4] Injection Results:');
    console.log(JSON.stringify({
      hasApiKey,
      apiKeyValue: hasApiKey ? apiKeyValue.substring(0, 10) + '...' : null,
      timeout,
      debug,
      hasHelper,
    }, null, 2));

    // Verify results
    const allPassed: [string, boolean][] = [
      ['API Key injected', hasApiKey === true],
      ['API Key has correct value', apiKeyValue === 'test-api-key-12345'],
      ['Timeout injected (env override)', timeout === 10000],
      ['Debug injected (env override)', debug === true],
      ['Helper Photon injected', hasHelper === true],
    ];

    console.log('\n[5] Verification:');
    let passed = 0;
    for (const [name, success] of allPassed) {
      const status = success ? '✅' : '❌';
      console.log(`  ${status} ${name}`);
      if (success) passed++;
    }

    console.log('\n[6] Summary:', `${passed}/${allPassed.length} tests passed`);

    // Test calling helper directly on instance
    console.log('\n[7] Testing helper Photon call...');
    try {
      const helperResult = await (instance as any).helper.greet({ name: 'World' });
      console.log('  Result:', helperResult);
      console.log('  ✅ Helper call successful');
      passed++; // Bonus point
    } catch (e: any) {
      console.log('  ❌ Helper call failed:', e.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log(passed >= allPassed.length ? '✅ All tests passed!' : '⚠️ Some tests failed');
    console.log('='.repeat(60));

    process.exit(passed >= allPassed.length ? 0 : 1);
  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
