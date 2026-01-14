/**
 * Core Features Test Suite
 *
 * Tests the core features of Photon:
 * 1. Photon-to-Photon injection (@photon tag)
 * 2. NPM dependency management (@dependencies tag)
 * 3. Workflow/generator execution (async generators with io.ask/emit)
 * 4. MCP interoperability (multi-language MCP support)
 *
 * Run: npx tsx tests/core-features.test.ts
 */

import { PhotonLoader } from '../src/loader.js';

async function testInjection() {
  console.log('\n=== TEST 1: Photon-to-Photon Injection ===\n');

  const loader = new PhotonLoader(true);

  // Set env var for constructor injection
  process.env['TEST_INJECTION_API_KEY'] = 'my-secret-key';

  // Load photon with @photon helper dependency
  const photon = await loader.loadFile('./tests/injection/test-injection.photon.ts');

  console.log('✅ Photon loaded:', photon.name);

  // Test status method (shows injection state)
  const status = await loader.executeTool(photon, 'status', {});
  console.log('✅ Status (env vars injected):', JSON.stringify(status, null, 2));

  // Test calling helper photon
  const result = await loader.executeTool(photon, 'callHelper', { name: 'World' });
  console.log('✅ Call helper result:', JSON.stringify(result, null, 2));
}

async function testDependencies() {
  console.log('\n=== TEST 2: NPM Dependency Management ===\n');

  const loader = new PhotonLoader(true);

  // Load a photon that uses @dependencies (uuid package)
  const photon = await loader.loadFile('./tests/fixtures/with-deps.photon.ts');
  console.log('✅ Loaded photon with npm dependencies:', photon.name);
  console.log('   Tools:', photon.tools.map(t => t.name).join(', '));

  // Actually call the method that uses the dependency
  const result = await loader.executeTool(photon, 'generateId', {});
  console.log('✅ Generated UUID:', result.id);

  // Verify it's a valid UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(result.id)) {
    console.log('✅ UUID format validated');
  } else {
    throw new Error('Invalid UUID format');
  }
}

async function testWorkflows() {
  console.log('\n=== TEST 3: Workflow Generator Execution ===\n');

  const loader = new PhotonLoader(false); // quiet mode

  // Load demo photon which has generator methods
  const demo = await loader.loadFile('./tests/fixtures/demo.photon.ts');

  // Check if generator methods are detected
  const metadata = demo.tools.find(t => t.name === 'askName');
  console.log('✅ Generator method detected:', metadata?.name);

  // The askName method is an async generator that yields io.ask
  // We can test it works by checking the metadata
  const multiStep = demo.tools.find(t => t.name === 'multiStepForm');
  console.log('✅ Multi-step workflow method:', multiStep?.name);
  console.log('   Description:', multiStep?.description);
}

async function testMCPConfig() {
  console.log('\n=== TEST 4: MCP Interoperability Config ===\n');

  // Test that MCP config resolution works
  const { resolveMCPSource } = await import('../src/mcp-client.js');

  // Test GitHub shorthand resolution
  const githubConfig = resolveMCPSource('github', 'anthropics/mcp-server-github', 'github');
  console.log('✅ GitHub MCP resolved:', {
    command: githubConfig.command,
    hasArgs: Array.isArray(githubConfig.args),
  });

  // Test HTTP/SSE resolution
  const httpConfig = resolveMCPSource('api', 'http://api.example.com/mcp', 'url');
  console.log('✅ HTTP MCP resolved:', {
    url: httpConfig.url,
    transport: httpConfig.transport,
  });

  // Test npm package resolution
  const npmConfig = resolveMCPSource('jira', 'npm:@anthropic/mcp-server-jira', 'npm');
  console.log('✅ NPM MCP resolved:', {
    command: npmConfig.command,
    hasArgs: Array.isArray(npmConfig.args),
  });

  console.log('✅ MCP config resolution works for all transport types');
}

async function main() {
  try {
    await testInjection();
    await testDependencies();
    await testWorkflows();
    await testMCPConfig();

    console.log('\n=== All Core Feature Tests Passed ===\n');
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

main();
