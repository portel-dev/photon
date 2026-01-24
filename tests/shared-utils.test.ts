/**
 * Tests for shared utility modules
 */

import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  toEnvVarName,
  generateExampleValue,
  summarizeConstructorParams,
  generateConfigErrorMessage,
} from '../dist/shared/config-docs.js';
import { renderSection, renderKeyValueSection } from '../dist/shared/cli-sections.js';
import { runTask } from '../dist/shared/task-runner.js';
import {
  getBundledPhotonPath,
  DEFAULT_BUNDLED_PHOTONS,
  BEAM_BUNDLED_PHOTONS,
  getErrorMessage,
  withErrorContext,
  withErrorContextSync,
} from '../dist/shared-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('🧪 Running Shared Utilities Tests...\n');

let passed = 0;
let failed = 0;

function test(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ ${message}`);
    passed++;
  } else {
    console.error(`❌ ${message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG-DOCS TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('📋 config-docs.ts Tests');

// toEnvVarName tests
{
  test(
    toEnvVarName('my-mcp', 'apiKey') === 'MY_MCP_API_KEY',
    'toEnvVarName: converts to uppercase with underscores'
  );

  test(
    toEnvVarName('github-issues', 'repoName') === 'GITHUB_ISSUES_REPO_NAME',
    'toEnvVarName: handles kebab-case MCP name'
  );

  test(
    toEnvVarName('simple', 'value') === 'SIMPLE_VALUE',
    'toEnvVarName: handles simple names'
  );

  test(
    toEnvVarName('test', 'camelCaseParam') === 'TEST_CAMEL_CASE_PARAM',
    'toEnvVarName: expands camelCase params'
  );
}

// generateExampleValue tests
{
  test(
    generateExampleValue('apiKey', 'string') === 'sk_your_api_key_here',
    'generateExampleValue: apiKey returns API key example'
  );

  test(
    generateExampleValue('api_key', 'string') === 'sk_your_api_key_here',
    'generateExampleValue: api_key returns API key example'
  );

  test(
    generateExampleValue('token', 'string') === 'your_secret_token',
    'generateExampleValue: token returns token example'
  );

  test(
    generateExampleValue('secret', 'string') === 'your_secret_token',
    'generateExampleValue: secret returns token example'
  );

  test(
    generateExampleValue('url', 'string') === 'https://api.example.com',
    'generateExampleValue: url returns URL example'
  );

  test(
    generateExampleValue('endpoint', 'string') === 'https://api.example.com',
    'generateExampleValue: endpoint returns URL example'
  );

  test(
    generateExampleValue('host', 'string') === 'localhost',
    'generateExampleValue: host returns localhost'
  );

  test(
    generateExampleValue('server', 'string') === 'localhost',
    'generateExampleValue: server returns localhost'
  );

  test(
    generateExampleValue('port', 'number') === '5432',
    'generateExampleValue: port returns port number'
  );

  test(
    generateExampleValue('database', 'string') === 'my_database',
    'generateExampleValue: database returns db name'
  );

  test(
    generateExampleValue('dbName', 'string') === 'my_database',
    'generateExampleValue: db returns db name'
  );

  test(
    generateExampleValue('user', 'string') === 'admin',
    'generateExampleValue: user returns admin'
  );

  test(
    generateExampleValue('username', 'string') === 'admin',
    'generateExampleValue: username returns admin'
  );

  test(
    generateExampleValue('password', 'string') === 'your_secure_password',
    'generateExampleValue: password returns password example'
  );

  test(
    generateExampleValue('path', 'string') === '/path/to/directory',
    'generateExampleValue: path returns directory'
  );

  test(
    generateExampleValue('dataDir', 'string') === '/path/to/directory',
    'generateExampleValue: dir returns directory'
  );

  test(
    generateExampleValue('serviceName', 'string') === 'my-service',
    'generateExampleValue: name returns service name'
  );

  test(
    generateExampleValue('region', 'string') === 'us-east-1',
    'generateExampleValue: region returns AWS region'
  );

  test(
    generateExampleValue('enabled', 'boolean') === 'true',
    'generateExampleValue: boolean returns true'
  );

  test(
    generateExampleValue('count', 'number') === '3000',
    'generateExampleValue: number returns 3000'
  );

  test(
    generateExampleValue('unknownParam', 'string') === null,
    'generateExampleValue: unknown param returns null'
  );
}

// summarizeConstructorParams tests
{
  const params = [
    { name: 'apiKey', type: 'string', isOptional: false, hasDefault: false },
    { name: 'debug', type: 'boolean', isOptional: true, hasDefault: true, defaultValue: false },
  ];

  const result = summarizeConstructorParams(params, 'test-mcp');

  test(
    result.docs.includes('TEST_MCP_API_KEY'),
    'summarizeConstructorParams: includes env var name'
  );

  test(
    result.docs.includes('[REQUIRED]'),
    'summarizeConstructorParams: marks required params'
  );

  test(
    result.docs.includes('[OPTIONAL]'),
    'summarizeConstructorParams: marks optional params'
  );

  test(
    result.exampleEnv['TEST_MCP_API_KEY'] !== undefined,
    'summarizeConstructorParams: includes required in exampleEnv'
  );

  test(
    result.exampleEnv['TEST_MCP_DEBUG'] === undefined,
    'summarizeConstructorParams: excludes optional with defaults'
  );
}

// generateConfigErrorMessage tests
{
  const missing = [
    { paramName: 'apiKey', envVarName: 'MY_MCP_API_KEY', type: 'string' },
    { paramName: 'token', envVarName: 'MY_MCP_TOKEN', type: 'string' },
  ];

  const message = generateConfigErrorMessage('my-mcp', missing);

  test(
    message.includes('Configuration Warning'),
    'generateConfigErrorMessage: includes warning header'
  );

  test(
    message.includes('MY_MCP_API_KEY'),
    'generateConfigErrorMessage: includes first env var'
  );

  test(
    message.includes('MY_MCP_TOKEN'),
    'generateConfigErrorMessage: includes second env var'
  );

  test(
    message.includes('mcpServers'),
    'generateConfigErrorMessage: includes MCP config example'
  );

  test(
    message.includes('photon my-mcp --config'),
    'generateConfigErrorMessage: includes fix command'
  );
}

// ═══════════════════════════════════════════════════════════════════
// CLI-SECTIONS TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 cli-sections.ts Tests');

// renderSection tests
{
  // renderSection prints to console, doesn't return a string
  // Just test that it doesn't throw
  let noError = true;
  try {
    renderSection('Test Section', ['Line 1', 'Line 2']);
  } catch (e) {
    noError = false;
  }

  test(
    noError,
    'renderSection: renders without error'
  );

  // Test with empty array - should not throw
  noError = true;
  try {
    renderSection('Empty Section', []);
  } catch (e) {
    noError = false;
  }

  test(
    noError,
    'renderSection: handles empty array'
  );
}

// renderKeyValueSection tests
{
  let noError = true;
  try {
    renderKeyValueSection('Key Value Section', [
      { label: 'Name', value: 'Test' },
      { label: 'Version', value: '1.0.0' },
      { label: 'Empty', value: null },
      { label: 'Undefined', value: undefined },
      { label: 'Blank', value: '' },
    ]);
  } catch (e) {
    noError = false;
  }

  test(
    noError,
    'renderKeyValueSection: renders without error'
  );
}

// ═══════════════════════════════════════════════════════════════════
// TASK-RUNNER TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 task-runner.ts Tests');

// runTask tests
{
  let executed = false;
  const result = await runTask('Test task', async () => {
    executed = true;
    return 'done';
  });

  test(
    executed === true,
    'runTask: executes the task function'
  );

  test(
    result === 'done',
    'runTask: returns the task result'
  );
}

{
  let errorCaught = false;
  try {
    await runTask('Failing task', async () => {
      throw new Error('Task failed');
    });
  } catch (e) {
    errorCaught = true;
  }

  test(
    errorCaught === true,
    'runTask: propagates errors'
  );
}

// ═══════════════════════════════════════════════════════════════════
// BUNDLED PHOTON PATH TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 shared-utils.ts Tests (Bundled Photon Paths)');

// DEFAULT_BUNDLED_PHOTONS tests
{
  test(
    DEFAULT_BUNDLED_PHOTONS.includes('maker'),
    'DEFAULT_BUNDLED_PHOTONS: includes maker'
  );
}

// BEAM_BUNDLED_PHOTONS tests
{
  test(
    BEAM_BUNDLED_PHOTONS.includes('maker'),
    'BEAM_BUNDLED_PHOTONS: includes maker'
  );

  test(
    BEAM_BUNDLED_PHOTONS.includes('tunnel'),
    'BEAM_BUNDLED_PHOTONS: includes tunnel'
  );
}

// getBundledPhotonPath tests
{
  test(
    getBundledPhotonPath('non-existent', __dirname) === null,
    'getBundledPhotonPath: returns null for non-bundled photon'
  );

  test(
    getBundledPhotonPath('tunnel', __dirname, DEFAULT_BUNDLED_PHOTONS) === null,
    'getBundledPhotonPath: respects bundledList parameter'
  );

  // Test from dist directory (where bundled photons should be found)
  const distDir = path.join(__dirname, '..', 'dist');
  const makerPath = getBundledPhotonPath('maker', distDir);
  test(
    makerPath === null || makerPath.endsWith('maker.photon.ts'),
    'getBundledPhotonPath: finds or returns null for maker from dist'
  );
}

// ═══════════════════════════════════════════════════════════════════
// ERROR HANDLING UTILITY TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n📋 shared-utils.ts Tests (Error Handling)');

// getErrorMessage tests
{
  test(
    getErrorMessage(new Error('Test error')) === 'Test error',
    'getErrorMessage: extracts message from Error'
  );

  test(
    getErrorMessage('String error') === 'String error',
    'getErrorMessage: handles string errors'
  );

  test(
    getErrorMessage({ code: 404 }) === '[object Object]',
    'getErrorMessage: stringifies object errors'
  );
}

// withErrorContext tests
{
  let contextResult: string | null = null;
  (async () => {
    contextResult = await withErrorContext(
      async () => 'success',
      'Test operation'
    );
  })();

  // Give async a moment
  await new Promise(resolve => setTimeout(resolve, 10));

  test(
    contextResult === 'success',
    'withErrorContext: passes through successful result'
  );
}

{
  let errorWrapped = false;
  try {
    await withErrorContext(
      async () => { throw new Error('Inner error'); },
      'Loading file'
    );
  } catch (error) {
    if (error instanceof Error) {
      errorWrapped = error.message.includes('Loading file') && error.message.includes('Inner error');
    }
  }

  test(
    errorWrapped,
    'withErrorContext: wraps errors with context'
  );
}

{
  let loggedMessage = '';
  const mockLogger = {
    error: (msg: string) => { loggedMessage = msg; }
  };

  try {
    await withErrorContext(
      async () => { throw new Error('Logged error'); },
      'Test context',
      mockLogger
    );
  } catch {
    // Expected
  }

  test(
    loggedMessage.includes('Test context') && loggedMessage.includes('Logged error'),
    'withErrorContext: calls logger when provided'
  );
}

// withErrorContextSync tests
{
  const syncResult = withErrorContextSync(
    () => 42,
    'Sync operation'
  );

  test(
    syncResult === 42,
    'withErrorContextSync: works synchronously'
  );
}

{
  let syncErrorWrapped = false;
  try {
    withErrorContextSync(
      () => { throw new Error('Sync error'); },
      'Sync context'
    );
  } catch (error) {
    if (error instanceof Error) {
      syncErrorWrapped = error.message.includes('Sync context');
    }
  }

  test(
    syncErrorWrapped,
    'withErrorContextSync: wraps sync errors'
  );
}

console.log(`\n✅ Shared Utilities tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
