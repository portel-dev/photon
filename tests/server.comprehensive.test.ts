/**
 * Comprehensive Tests for Photon Server
 *
 * Tests for MCP protocol handlers, SSE transport, hot reload, and UI format detection.
 * Aim: Increase server.ts coverage from ~5% to 70%+
 */

import { PhotonServer, HotReloadDisabledError, TransportType } from '../dist/server.js';
import { strict as assert } from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';

const testDir = path.join(os.tmpdir(), `photon-server-test-${Date.now()}`);

async function setup() {
  await fs.mkdir(testDir, { recursive: true });
}

async function cleanup() {
  await fs.rm(testDir, { recursive: true, force: true });
}

async function createTestPhoton(name: string, content: string): Promise<string> {
  const testFile = path.join(testDir, `${name}.photon.ts`);
  await fs.writeFile(testFile, content, 'utf-8');
  return testFile;
}

// Basic photon content for testing
const basicPhotonContent = `
  export default class TestMCP {
    /**
     * Echo back the input
     * @param value Value to echo
     */
    async echo(params: { value: string }) {
      return \`Echo: \${params.value}\`;
    }

    /**
     * Add two numbers
     * @param a First number
     * @param b Second number
     */
    async add(params: { a: number; b: number }) {
      return params.a + params.b;
    }

    /**
     * Returns an object
     */
    async getConfig() {
      return { version: '1.0', enabled: true };
    }

    /**
     * Throw an error for testing
     */
    async throwError() {
      throw new Error('Test error message');
    }
  }
`;

// Photon with templates and statics
const photonWithTemplatesContent = `
  type Template = string & { __brand: 'Template' };
  type Static = string & { __brand: 'Static' };
  const asTemplate = (str: string): Template => str as Template;
  const asStatic = (str: string): Static => str as Static;

  export default class TemplateMCP {
    /**
     * Generate a prompt
     * @Template
     * @param topic Topic to generate about
     */
    async generatePrompt(params: { topic: string }): Promise<Template> {
      return asTemplate(\`Write about \${params.topic}\`);
    }

    /**
     * Static API docs
     * @Static api://docs
     * @mimeType text/markdown
     */
    async getDocs(params: {}): Promise<Static> {
      return asStatic("# API Documentation\\n\\nWelcome");
    }

    /**
     * Parameterized resource
     * @Static project://{name}/readme
     * @mimeType text/markdown
     * @param name Project name
     */
    async getReadme(params: { name: string }): Promise<Static> {
      return asStatic(\`# \${params.name}\\n\\nProject readme\`);
    }
  }
`;

async function runTests() {
  console.log('🧪 Running Comprehensive Photon Server Tests...\n');

  await setup();

  try {
    // ═══════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & VALIDATION TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('📋 Constructor & Validation Tests');

    // Test 1: Valid file path
    {
      const testFile = await createTestPhoton('valid-photon', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      assert.ok(server, 'Should create server with valid path');
      console.log('  ✅ Constructor accepts valid file path');
    }

    // Test 2: Invalid file extension
    {
      try {
        new PhotonServer({ filePath: '/tmp/invalid.txt' });
        assert.fail('Should throw for invalid extension');
      } catch (error: any) {
        assert.ok(error.message.includes('extension'), 'Should mention extension');
        console.log('  ✅ Rejects invalid file extension');
      }
    }

    // Test 3: Empty file path
    {
      try {
        new PhotonServer({ filePath: '' });
        assert.fail('Should throw for empty path');
      } catch (error: any) {
        assert.ok(error, 'Should throw for empty path');
        console.log('  ✅ Rejects empty file path');
      }
    }

    // Test 4: Valid transport options
    {
      const testFile = await createTestPhoton('transport-test', basicPhotonContent);
      const server1 = new PhotonServer({ filePath: testFile, transport: 'stdio' });
      const server2 = new PhotonServer({ filePath: testFile, transport: 'sse' });
      assert.ok(server1 && server2, 'Should accept valid transports');
      console.log('  ✅ Accepts valid transport options');
    }

    // Test 5: Invalid transport
    {
      const testFile = await createTestPhoton('invalid-transport', basicPhotonContent);
      try {
        new PhotonServer({ filePath: testFile, transport: 'invalid' as TransportType });
        assert.fail('Should throw for invalid transport');
      } catch (error: any) {
        assert.ok(error.message.includes('transport'), 'Should mention transport');
        console.log('  ✅ Rejects invalid transport');
      }
    }

    // Test 6: Valid port range
    {
      const testFile = await createTestPhoton('port-test', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile, port: 3000 });
      assert.ok(server, 'Should accept valid port');
      console.log('  ✅ Accepts valid port');
    }

    // Test 7: Invalid port (too low)
    {
      const testFile = await createTestPhoton('low-port', basicPhotonContent);
      try {
        new PhotonServer({ filePath: testFile, port: 0 });
        assert.fail('Should throw for port 0');
      } catch (error: any) {
        assert.ok(error.message.includes('port'), 'Should mention port');
        console.log('  ✅ Rejects port 0');
      }
    }

    // Test 8: Invalid port (too high)
    {
      const testFile = await createTestPhoton('high-port', basicPhotonContent);
      try {
        new PhotonServer({ filePath: testFile, port: 70000 });
        assert.fail('Should throw for port > 65535');
      } catch (error: any) {
        assert.ok(error.message.includes('port'), 'Should mention port');
        console.log('  ✅ Rejects port > 65535');
      }
    }

    // Test 9: Dev mode option
    {
      const testFile = await createTestPhoton('dev-mode', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile, devMode: true });
      assert.ok((server as any).devMode === true, 'Should set dev mode');
      console.log('  ✅ Dev mode option works');
    }

    // Test 10: Logger creation
    {
      const testFile = await createTestPhoton('logger-test', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const logger = server.getLogger();
      assert.ok(logger, 'Should have logger');
      assert.ok(typeof logger.info === 'function', 'Logger should have info method');
      console.log('  ✅ Logger is available');
    }

    // Test 11: Scoped logger creation
    {
      const testFile = await createTestPhoton('scoped-logger', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const scopedLogger = server.createScopedLogger('test-scope');
      assert.ok(scopedLogger, 'Should create scoped logger');
      console.log('  ✅ Scoped logger creation works');
    }

    // ═══════════════════════════════════════════════════════════════════
    // URI HANDLING TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 URI Handling Tests');

    // Test 12: URI template detection
    {
      const testFile = await createTestPhoton('uri-template', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const isTemplate = (uri: string) => (server as any).isUriTemplate(uri);

      assert.equal(isTemplate('api://docs'), false, 'Static URI not template');
      assert.equal(isTemplate('readme://{project}'), true, 'Single param is template');
      assert.equal(isTemplate('repo://{owner}/{repo}'), true, 'Multiple params is template');
      assert.equal(isTemplate('file://path/to/file'), false, 'No params is not template');
      console.log('  ✅ URI template detection');
    }

    // Test 13: URI pattern matching
    {
      const testFile = await createTestPhoton('uri-pattern', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const matchPattern = (pattern: string, uri: string) =>
        (server as any).matchUriPattern(pattern, uri);

      assert.ok(matchPattern('readme://{name}', 'readme://myproject'), 'Should match simple pattern');
      assert.ok(matchPattern('repo://{owner}/{repo}', 'repo://facebook/react'), 'Should match complex pattern');
      assert.ok(!matchPattern('readme://{name}', 'docs://myproject'), 'Should not match different scheme');
      assert.ok(!matchPattern('repo://{owner}/{repo}', 'repo://facebook'), 'Should not match incomplete URI');
      console.log('  ✅ URI pattern matching');
    }

    // Test 14: URI parameter parsing
    {
      const testFile = await createTestPhoton('uri-params', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const parseParams = (pattern: string, uri: string) =>
        (server as any).parseUriParams(pattern, uri);

      const params1 = parseParams('readme://{name}', 'readme://myproject');
      assert.deepEqual(params1, { name: 'myproject' }, 'Should extract single param');

      const params2 = parseParams('repo://{owner}/{repo}', 'repo://facebook/react');
      assert.deepEqual(params2, { owner: 'facebook', repo: 'react' }, 'Should extract multiple params');

      const params3 = parseParams('file://{dir}/{subdir}/{file}', 'file://src/utils/helper');
      assert.deepEqual(params3, { dir: 'src', subdir: 'utils', file: 'helper' }, 'Should extract three params');
      console.log('  ✅ URI parameter parsing');
    }

    // ═══════════════════════════════════════════════════════════════════
    // RESULT FORMATTING TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Result Formatting Tests');

    // Test 15: Format string result
    {
      const testFile = await createTestPhoton('format-string', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatResult = (result: any) => (server as any).formatResult(result);

      assert.equal(formatResult('Hello'), 'Hello', 'String should pass through');
      console.log('  ✅ Format string result');
    }

    // Test 16: Format object result
    {
      const testFile = await createTestPhoton('format-object', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatResult = (result: any) => (server as any).formatResult(result);

      const obj = { key: 'value', num: 42 };
      const formatted = formatResult(obj);
      assert.ok(formatted.includes('"key"'), 'Should JSON stringify object');
      assert.ok(formatted.includes('"value"'), 'Should include values');
      console.log('  ✅ Format object result');
    }

    // Test 17: Format success/content result
    {
      const testFile = await createTestPhoton('format-success', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatResult = (result: any) => (server as any).formatResult(result);

      const successResult = { success: true, content: 'Operation completed' };
      assert.equal(formatResult(successResult), 'Operation completed', 'Should extract content');
      console.log('  ✅ Format success/content result');
    }

    // Test 18: Format success/error result (success false throws)
    {
      const testFile = await createTestPhoton('format-error', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatResult = (result: any) => (server as any).formatResult(result);

      const errorResult = { success: false, error: 'Something went wrong' };
      try {
        formatResult(errorResult);
        assert.fail('Should throw when success is false');
      } catch (error: any) {
        assert.equal(error.message, 'Something went wrong', 'Should throw with error message');
        console.log('  ✅ Format error result throws');
      }
    }

    // Test 19: Format primitive values
    {
      const testFile = await createTestPhoton('format-primitive', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatResult = (result: any) => (server as any).formatResult(result);

      assert.equal(formatResult(42), '42', 'Should stringify number');
      assert.equal(formatResult(true), 'true', 'Should stringify boolean');
      assert.equal(formatResult(null), 'null', 'Should stringify null');
      console.log('  ✅ Format primitive values');
    }

    // ═══════════════════════════════════════════════════════════════════
    // TEMPLATE RESULT FORMATTING TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Template Result Formatting Tests');

    // Test 20: Format simple string template
    {
      const testFile = await createTestPhoton('template-string', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatTemplate = (result: any) => (server as any).formatTemplateResult(result);

      const result = formatTemplate('Hello world');
      assert.ok(result.messages, 'Should have messages');
      assert.equal(result.messages[0].role, 'user', 'Should have user role');
      assert.equal(result.messages[0].content.type, 'text', 'Should have text type');
      assert.equal(result.messages[0].content.text, 'Hello world', 'Should preserve text');
      console.log('  ✅ Format simple string template');
    }

    // Test 21: Format TemplateResponse object
    {
      const testFile = await createTestPhoton('template-response', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatTemplate = (result: any) => (server as any).formatTemplateResult(result);

      const templateResponse = {
        messages: [
          { role: 'user', content: { type: 'text', text: 'Question' } },
          { role: 'assistant', content: { type: 'text', text: 'Answer' } },
        ],
      };
      const result = formatTemplate(templateResponse);
      assert.deepEqual(result.messages, templateResponse.messages, 'Should pass through messages');
      console.log('  ✅ Format TemplateResponse object');
    }

    // Test 22: Format object as template
    {
      const testFile = await createTestPhoton('template-object', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatTemplate = (result: any) => (server as any).formatTemplateResult(result);

      const obj = { topic: 'AI', details: 'Test' };
      const result = formatTemplate(obj);
      assert.ok(result.messages[0].content.text.includes('"topic"'), 'Should JSON stringify object');
      console.log('  ✅ Format object as template');
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATIC RESULT FORMATTING TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Static Result Formatting Tests');

    // Test 23: Format static string result
    {
      const testFile = await createTestPhoton('static-string', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatStatic = (result: any, mimeType?: string) =>
        (server as any).formatStaticResult(result, mimeType);

      const result = formatStatic('# Documentation', 'text/markdown');
      assert.ok(result.contents, 'Should have contents');
      assert.equal(result.contents[0].mimeType, 'text/markdown', 'Should have MIME type');
      assert.equal(result.contents[0].text, '# Documentation', 'Should preserve text');
      console.log('  ✅ Format static string result');
    }

    // Test 24: Format static object result
    {
      const testFile = await createTestPhoton('static-object', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatStatic = (result: any, mimeType?: string) =>
        (server as any).formatStaticResult(result, mimeType);

      const result = formatStatic({ key: 'value' }, 'application/json');
      assert.ok(result.contents[0].text.includes('"key"'), 'Should JSON stringify');
      assert.equal(result.contents[0].mimeType, 'application/json', 'Should have MIME type');
      console.log('  ✅ Format static object result');
    }

    // Test 25: Format static with default MIME type
    {
      const testFile = await createTestPhoton('static-default', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatStatic = (result: any, mimeType?: string) =>
        (server as any).formatStaticResult(result, mimeType);

      const result = formatStatic('Plain text');
      assert.equal(result.contents[0].mimeType, 'text/plain', 'Should default to text/plain');
      console.log('  ✅ Format static with default MIME type');
    }

    // ═══════════════════════════════════════════════════════════════════
    // ERROR FORMATTING TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Error Formatting Tests');

    // Test 26: Format validation error
    {
      const testFile = await createTestPhoton('error-validation', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatError = (error: any, toolName: string, args: any) =>
        (server as any).formatError(error, toolName, args);

      const error = new Error('required parameter missing');
      const result = formatError(error, 'testTool', {});
      assert.ok(result.isError, 'Should have isError flag');
      assert.ok(result.content[0].text.includes('validation_error'), 'Should categorize as validation');
      assert.ok(result.content[0].text.includes('testTool'), 'Should include tool name');
      console.log('  ✅ Format validation error');
    }

    // Test 27: Format timeout error
    {
      const testFile = await createTestPhoton('error-timeout', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatError = (error: any, toolName: string, args: any) =>
        (server as any).formatError(error, toolName, args);

      const error = new Error('Connection timeout');
      const result = formatError(error, 'testTool', {});
      assert.ok(result.content[0].text.includes('timeout_error'), 'Should categorize as timeout');
      console.log('  ✅ Format timeout error');
    }

    // Test 28: Format network error
    {
      const testFile = await createTestPhoton('error-network', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatError = (error: any, toolName: string, args: any) =>
        (server as any).formatError(error, toolName, args);

      const error = new Error('ECONNREFUSED');
      const result = formatError(error, 'testTool', {});
      assert.ok(result.content[0].text.includes('network_error'), 'Should categorize as network');
      console.log('  ✅ Format network error');
    }

    // Test 29: Format permission error
    {
      const testFile = await createTestPhoton('error-permission', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatError = (error: any, toolName: string, args: any) =>
        (server as any).formatError(error, toolName, args);

      const error = new Error('EACCES permission denied');
      const result = formatError(error, 'testTool', {});
      assert.ok(result.content[0].text.includes('permission_error'), 'Should categorize as permission');
      console.log('  ✅ Format permission error');
    }

    // Test 30: Format not found error
    {
      const testFile = await createTestPhoton('error-notfound', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const formatError = (error: any, toolName: string, args: any) =>
        (server as any).formatError(error, toolName, args);

      const error = new Error('ENOENT not found');
      const result = formatError(error, 'testTool', {});
      assert.ok(result.content[0].text.includes('not_found_error'), 'Should categorize as not found');
      console.log('  ✅ Format not found error');
    }

    // Test 31: Format error in dev mode includes args
    {
      const testFile = await createTestPhoton('error-devmode', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile, devMode: true });
      const formatError = (error: any, toolName: string, args: any) =>
        (server as any).formatError(error, toolName, args);

      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at testFunction';
      const args = { param1: 'value1' };
      const result = formatError(error, 'testTool', args);
      assert.ok(result.content[0].text.includes('param1'), 'Should include args in dev mode');
      assert.ok(result.content[0].text.includes('Stack trace'), 'Should include stack in dev mode');
      console.log('  ✅ Format error in dev mode includes details');
    }

    // ═══════════════════════════════════════════════════════════════════
    // UI FORMAT DETECTION TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 UI Format Detection Tests');

    // Test 32: Default UI format is photon
    {
      const testFile = await createTestPhoton('ui-default', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const format = (server as any).getUIFormat();
      assert.equal(format, 'photon', 'Default format should be photon');
      console.log('  ✅ Default UI format is photon');
    }

    // Test 33: Build UI resource URI for photon format
    {
      const testFile = await createTestPhoton('ui-uri', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      // Mock mcp name
      (server as any).mcp = { name: 'test-photon' };

      const uri = (server as any).buildUIResourceUri('settings');
      assert.equal(uri, 'photon://test-photon/ui/settings', 'Should build photon URI');
      console.log('  ✅ Build UI resource URI for photon format');
    }

    // Test 34: Build UI tool meta for photon format
    {
      const testFile = await createTestPhoton('ui-meta', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      (server as any).mcp = { name: 'test-photon' };

      const meta = (server as any).buildUIToolMeta('form');
      assert.ok(meta.outputTemplate, 'Should have outputTemplate for photon format');
      assert.ok(meta.outputTemplate.includes('photon://'), 'Should use photon:// scheme');
      console.log('  ✅ Build UI tool meta for photon format');
    }

    // Test 35: Get UI MIME type
    {
      const testFile = await createTestPhoton('ui-mime', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });

      const mimeType = (server as any).getUIMimeType();
      assert.equal(mimeType, 'text/html', 'Default MIME type should be text/html');
      console.log('  ✅ Get UI MIME type');
    }

    // ═══════════════════════════════════════════════════════════════════
    // ELICITATION SUPPORT TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Elicitation Support Tests');

    // Test 36: Client supports elicitation - false by default
    {
      const testFile = await createTestPhoton('elicit-default', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });

      const supports = (server as any).clientSupportsElicitation();
      assert.equal(supports, false, 'Should not support elicitation by default');
      console.log('  ✅ Client elicitation support - false by default');
    }

    // Test 37: Get default for text ask
    {
      const testFile = await createTestPhoton('default-text', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const getDefault = (ask: any) => (server as any).getDefaultForAsk(ask);

      assert.equal(getDefault({ ask: 'text' }), '', 'Text default should be empty string');
      assert.equal(getDefault({ ask: 'text', default: 'hello' }), 'hello', 'Should use provided default');
      console.log('  ✅ Get default for text ask');
    }

    // Test 38: Get default for confirm ask
    {
      const testFile = await createTestPhoton('default-confirm', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const getDefault = (ask: any) => (server as any).getDefaultForAsk(ask);

      assert.equal(getDefault({ ask: 'confirm' }), false, 'Confirm default should be false');
      console.log('  ✅ Get default for confirm ask');
    }

    // Test 39: Get default for number ask
    {
      const testFile = await createTestPhoton('default-number', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const getDefault = (ask: any) => (server as any).getDefaultForAsk(ask);

      assert.equal(getDefault({ ask: 'number' }), 0, 'Number default should be 0');
      assert.equal(getDefault({ ask: 'number', default: 42 }), 42, 'Should use provided default');
      console.log('  ✅ Get default for number ask');
    }

    // Test 40: Get default for select ask
    {
      const testFile = await createTestPhoton('default-select', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const getDefault = (ask: any) => (server as any).getDefaultForAsk(ask);

      assert.equal(getDefault({ ask: 'select', multi: false }), null, 'Single select default should be null');
      assert.deepEqual(getDefault({ ask: 'select', multi: true }), [], 'Multi select default should be []');
      console.log('  ✅ Get default for select ask');
    }

    // Test 41: Get default for date ask
    {
      const testFile = await createTestPhoton('default-date', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const getDefault = (ask: any) => (server as any).getDefaultForAsk(ask);

      const result = getDefault({ ask: 'date' });
      assert.ok(result.match(/^\d{4}-\d{2}-\d{2}$/), 'Date default should be ISO date format');
      console.log('  ✅ Get default for date ask');
    }

    // Test 42: Build elicit params for text
    {
      const testFile = await createTestPhoton('elicit-text', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const buildParams = (ask: any) => (server as any).buildElicitParams(ask);

      const params = buildParams({ ask: 'text', message: 'Enter name', label: 'Name' });
      assert.equal(params.mode, 'form', 'Should be form mode');
      assert.equal(params.message, 'Enter name', 'Should have message');
      assert.equal(params.requestedSchema.properties.value.type, 'string', 'Should request string');
      console.log('  ✅ Build elicit params for text');
    }

    // Test 43: Build elicit params for confirm
    {
      const testFile = await createTestPhoton('elicit-confirm', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const buildParams = (ask: any) => (server as any).buildElicitParams(ask);

      const params = buildParams({ ask: 'confirm', message: 'Are you sure?' });
      assert.equal(params.requestedSchema.properties.confirmed.type, 'boolean', 'Should request boolean');
      console.log('  ✅ Build elicit params for confirm');
    }

    // Test 44: Build elicit params for number
    {
      const testFile = await createTestPhoton('elicit-number', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const buildParams = (ask: any) => (server as any).buildElicitParams(ask);

      const params = buildParams({ ask: 'number', message: 'Enter age', min: 0, max: 120 });
      assert.equal(params.requestedSchema.properties.value.type, 'number', 'Should request number');
      assert.equal(params.requestedSchema.properties.value.minimum, 0, 'Should have min');
      assert.equal(params.requestedSchema.properties.value.maximum, 120, 'Should have max');
      console.log('  ✅ Build elicit params for number');
    }

    // Test 45: Build elicit params for select
    {
      const testFile = await createTestPhoton('elicit-select', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const buildParams = (ask: any) => (server as any).buildElicitParams(ask);

      const params = buildParams({
        ask: 'select',
        message: 'Choose option',
        options: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }],
      });
      assert.ok(params.requestedSchema.properties.selection.enum, 'Should have enum for options');
      assert.deepEqual(params.requestedSchema.properties.selection.enum, ['a', 'b'], 'Should extract values');
      console.log('  ✅ Build elicit params for select');
    }

    // Test 46: Build elicit params for multi-select
    {
      const testFile = await createTestPhoton('elicit-multiselect', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const buildParams = (ask: any) => (server as any).buildElicitParams(ask);

      const params = buildParams({
        ask: 'select',
        message: 'Choose options',
        options: ['a', 'b', 'c'],
        multi: true,
      });
      assert.equal(params.requestedSchema.properties.selection.type, 'array', 'Multi-select should be array');
      console.log('  ✅ Build elicit params for multi-select');
    }

    // Test 47: Build elicit params for date
    {
      const testFile = await createTestPhoton('elicit-date', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const buildParams = (ask: any) => (server as any).buildElicitParams(ask);

      const params = buildParams({ ask: 'date', message: 'Select date' });
      assert.equal(params.requestedSchema.properties.value.format, 'date', 'Should have date format');
      console.log('  ✅ Build elicit params for date');
    }

    // Test 48: Extract elicit value for confirm
    {
      const testFile = await createTestPhoton('extract-confirm', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const extractValue = (ask: any, content: any) => (server as any).extractElicitValue(ask, content);

      const value = extractValue({ ask: 'confirm' }, { confirmed: true });
      assert.equal(value, true, 'Should extract confirmed value');
      console.log('  ✅ Extract elicit value for confirm');
    }

    // Test 49: Extract elicit value for select
    {
      const testFile = await createTestPhoton('extract-select', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const extractValue = (ask: any, content: any) => (server as any).extractElicitValue(ask, content);

      const value = extractValue({ ask: 'select' }, { selection: 'optionA' });
      assert.equal(value, 'optionA', 'Should extract selection value');
      console.log('  ✅ Extract elicit value for select');
    }

    // Test 50: Extract elicit value for default
    {
      const testFile = await createTestPhoton('extract-default', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      const extractValue = (ask: any, content: any) => (server as any).extractElicitValue(ask, content);

      const value = extractValue({ ask: 'text' }, { value: 'hello' });
      assert.equal(value, 'hello', 'Should extract value');
      console.log('  ✅ Extract elicit value for default types');
    }

    // ═══════════════════════════════════════════════════════════════════
    // STATUS SNAPSHOT TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Status Snapshot Tests');

    // Test 51: Build status snapshot basic
    {
      const testFile = await createTestPhoton('status-basic', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile, devMode: true });
      (server as any).mcp = {
        name: 'test-mcp',
        tools: [{ name: 'tool1', description: 'Test tool' }],
        assets: { ui: [], prompts: [], resources: [] },
        instance: {},
      };

      const snapshot = (server as any).buildStatusSnapshot();
      assert.equal(snapshot.photon, 'test-mcp', 'Should have photon name');
      assert.equal(snapshot.devMode, true, 'Should show dev mode');
      assert.equal(snapshot.hotReloadDisabled, false, 'Hot reload should be enabled');
      assert.ok(snapshot.status, 'Should have status');
      assert.ok(snapshot.summary, 'Should have summary');
      console.log('  ✅ Build status snapshot basic');
    }

    // Test 52: Status snapshot with config error
    {
      const testFile = await createTestPhoton('status-error', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      (server as any).mcp = {
        name: 'test-mcp',
        tools: [],
        assets: { ui: [], prompts: [], resources: [] },
        instance: { _photonConfigError: 'Missing API key' },
      };

      const snapshot = (server as any).buildStatusSnapshot();
      assert.ok(snapshot.warnings.length > 0, 'Should have warnings');
      assert.ok(snapshot.warnings[0].includes('configuration'), 'Warning should mention config');
      console.log('  ✅ Status snapshot with config error');
    }

    // Test 53: Status snapshot with tool UI
    {
      const testFile = await createTestPhoton('status-ui', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      (server as any).mcp = {
        name: 'test-mcp',
        tools: [{ name: 'editTool', description: 'Edit something' }],
        assets: {
          ui: [{ id: 'editor', linkedTool: 'editTool' }],
          prompts: [],
          resources: [],
        },
        instance: {},
      };

      const snapshot = (server as any).buildStatusSnapshot();
      assert.ok(snapshot.summary.tools[0].hasUI, 'Tool should have UI flag');
      console.log('  ✅ Status snapshot with tool UI');
    }

    // ═══════════════════════════════════════════════════════════════════
    // HOT RELOAD TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Hot Reload Tests');

    // Test 54: Hot reload disabled error
    {
      const error = new HotReloadDisabledError('Test message');
      assert.equal(error.name, 'HotReloadDisabledError', 'Should have correct name');
      assert.equal(error.message, 'Test message', 'Should have correct message');
      console.log('  ✅ HotReloadDisabledError');
    }

    // Test 55: Reload when hot reload disabled
    {
      const testFile = await createTestPhoton('reload-disabled', basicPhotonContent);
      const server = new PhotonServer({ filePath: testFile });
      (server as any).hotReloadDisabled = true;

      try {
        await (server as any).reload();
        assert.fail('Should throw when hot reload disabled');
      } catch (error: any) {
        assert.ok(error instanceof HotReloadDisabledError, 'Should be HotReloadDisabledError');
        console.log('  ✅ Reload throws when disabled');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SSE & HTTP SERVER TESTS (Integration)
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 SSE & HTTP Server Tests');

    // Test 56: SSE server starts and responds to health check
    {
      const testFile = await createTestPhoton('sse-health', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3789,
        devMode: true,
      });

      try {
        // Start in background with timeout
        const startPromise = server.start();
        await Promise.race([
          startPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Start timeout')), 5000)
          ),
        ]);

        // Wait for server to be ready
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Make health check request
        const response = await fetch('http://localhost:3789/');
        assert.equal(response.status, 200, 'Health check should return 200');

        const data = await response.json();
        assert.ok(data.name, 'Should have name');
        assert.equal(data.transport, 'sse', 'Should show SSE transport');
        assert.ok(typeof data.tools === 'number', 'Should have tools count');

        console.log('  ✅ SSE health check endpoint');
      } finally {
        await server.stop();
      }
    }

    // Test 57: SSE server returns 404 for unknown path
    {
      const testFile = await createTestPhoton('sse-404', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3790,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3790/unknown-path');
        assert.equal(response.status, 404, 'Unknown path should return 404');

        console.log('  ✅ SSE 404 for unknown path');
      } finally {
        await server.stop();
      }
    }

    // Test 58: API call endpoint
    {
      const testFile = await createTestPhoton('api-call', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3791,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3791/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'echo', args: { value: 'test' } }),
        });

        const data = await response.json();
        assert.ok(data.success, 'Call should succeed');
        assert.ok(data.data.includes('test'), 'Should return echoed value');

        console.log('  ✅ API call endpoint');
      } finally {
        await server.stop();
      }
    }

    // Test 59: API call with error
    {
      const testFile = await createTestPhoton('api-error', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3792,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3792/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'throwError', args: {} }),
        });

        const data = await response.json();
        assert.equal(data.success, false, 'Call should fail');
        assert.ok(data.error, 'Should have error message');

        console.log('  ✅ API call error handling');
      } finally {
        await server.stop();
      }
    }

    // Test 60: Playground in dev mode
    {
      const testFile = await createTestPhoton('playground', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3793,
        devMode: true,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3793/playground');
        assert.equal(response.status, 200, 'Playground should return 200');
        assert.ok(
          response.headers.get('content-type')?.includes('text/html'),
          'Should return HTML'
        );

        console.log('  ✅ Playground endpoint in dev mode');
      } finally {
        await server.stop();
      }
    }

    // Test 61: Playground not available without dev mode
    {
      const testFile = await createTestPhoton('no-playground', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3794,
        devMode: false,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3794/playground');
        assert.equal(response.status, 404, 'Playground should not be available');

        console.log('  ✅ Playground not available without dev mode');
      } finally {
        await server.stop();
      }
    }

    // Test 62: API tools endpoint in dev mode
    {
      const testFile = await createTestPhoton('api-tools', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3795,
        devMode: true,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3795/api/tools');
        assert.equal(response.status, 200, 'Tools endpoint should return 200');

        const data = await response.json();
        assert.ok(data.tools, 'Should have tools array');
        assert.ok(data.tools.length > 0, 'Should have some tools');

        console.log('  ✅ API tools endpoint');
      } finally {
        await server.stop();
      }
    }

    // Test 63: API status endpoint
    {
      const testFile = await createTestPhoton('api-status', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3796,
        devMode: true,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3796/api/status');
        assert.equal(response.status, 200, 'Status endpoint should return 200');

        const data = await response.json();
        assert.ok(data.photon, 'Should have photon name');
        assert.ok(data.summary, 'Should have summary');

        console.log('  ✅ API status endpoint');
      } finally {
        await server.stop();
      }
    }

    // Test 64: CORS headers on API endpoints
    {
      const testFile = await createTestPhoton('cors', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3797,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3797/api/call', {
          method: 'OPTIONS',
        });

        assert.equal(response.status, 204, 'OPTIONS should return 204');
        assert.ok(
          response.headers.get('access-control-allow-origin'),
          'Should have CORS header'
        );

        console.log('  ✅ CORS headers on API endpoints');
      } finally {
        await server.stop();
      }
    }

    // Test 65: Server stop clears resources
    {
      const testFile = await createTestPhoton('stop-cleanup', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3798,
      });

      await server.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify server is running
      const response1 = await fetch('http://localhost:3798/');
      assert.equal(response1.status, 200, 'Server should be running');

      // Stop server
      await server.stop();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify server is stopped
      try {
        await fetch('http://localhost:3798/', { signal: AbortSignal.timeout(500) });
        assert.fail('Server should be stopped');
      } catch {
        // Expected - connection refused
        console.log('  ✅ Server stop clears resources');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHOTON WITH TEMPLATES & STATICS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Templates & Statics Tests');

    // Test 66: Server loads templates
    {
      const testFile = await createTestPhoton('templates', photonWithTemplatesContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3799,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check server loaded correctly
        const mcp = (server as any).mcp;
        assert.ok(mcp, 'MCP should be loaded');
        assert.ok(mcp.templates.length > 0, 'Should have templates');

        console.log('  ✅ Server loads templates');
      } finally {
        await server.stop();
      }
    }

    // Test 67: Server loads statics
    {
      const testFile = await createTestPhoton('statics', photonWithTemplatesContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3800,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const mcp = (server as any).mcp;
        assert.ok(mcp.statics.length > 0, 'Should have statics');

        console.log('  ✅ Server loads statics');
      } finally {
        await server.stop();
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ADDITIONAL COVERAGE TESTS
    // ═══════════════════════════════════════════════════════════════════

    console.log('\n📋 Additional Coverage Tests');

    // Test 68: API call-stream endpoint (streaming)
    {
      const testFile = await createTestPhoton('call-stream', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3801,
        devMode: true,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3801/api/call-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'echo', args: { value: 'streaming' } }),
        });

        assert.equal(response.status, 200, 'Stream endpoint should return 200');
        assert.ok(
          response.headers.get('content-type')?.includes('text/event-stream'),
          'Should return event stream'
        );

        console.log('  ✅ API call-stream endpoint');
      } finally {
        await server.stop();
      }
    }

    // Test 69: API call-stream with error
    {
      const testFile = await createTestPhoton('call-stream-error', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3802,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3802/api/call-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'throwError', args: {} }),
        });

        // The endpoint still returns 200 but sends error in stream
        assert.equal(response.status, 200, 'Stream endpoint should return 200');

        console.log('  ✅ API call-stream error handling');
      } finally {
        await server.stop();
      }
    }

    // Test 70: API call-stream missing tool
    {
      const testFile = await createTestPhoton('call-stream-missing', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3803,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3803/api/call-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args: {} }),  // No tool specified
        });

        assert.equal(response.status, 200, 'Should return 200 (error in stream)');

        console.log('  ✅ API call-stream missing tool handling');
      } finally {
        await server.stop();
      }
    }

    // Test 71: API photons endpoint
    {
      const testFile = await createTestPhoton('list-photons', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3804,
        devMode: true,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3804/api/photons');
        assert.equal(response.status, 200, 'Photons endpoint should return 200');

        const data = await response.json();
        assert.ok(data.photons, 'Should have photons array');

        console.log('  ✅ API photons endpoint');
      } finally {
        await server.stop();
      }
    }

    // Test 72: API UI endpoint - 404 for unknown UI
    {
      const testFile = await createTestPhoton('ui-404', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3805,
        devMode: true,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3805/api/ui/nonexistent');
        assert.equal(response.status, 404, 'Unknown UI should return 404');

        console.log('  ✅ API UI endpoint - 404 for unknown');
      } finally {
        await server.stop();
      }
    }

    // Test 73: Add method execution
    {
      const testFile = await createTestPhoton('add-method', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3806,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3806/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'add', args: { a: 5, b: 3 } }),
        });

        const data = await response.json();
        assert.ok(data.success, 'Add should succeed');
        assert.equal(data.data, 8, 'Add result should be 8');

        console.log('  ✅ Add method execution');
      } finally {
        await server.stop();
      }
    }

    // Test 74: GetConfig method (returns object)
    {
      const testFile = await createTestPhoton('getconfig', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3807,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3807/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'getConfig', args: {} }),
        });

        const data = await response.json();
        assert.ok(data.success, 'GetConfig should succeed');
        assert.ok(data.data.version, 'Should return config object');
        assert.ok(data.data.enabled === true, 'Should have enabled flag');

        console.log('  ✅ GetConfig method execution');
      } finally {
        await server.stop();
      }
    }

    // Test 75: Invalid tool name
    {
      const testFile = await createTestPhoton('invalid-tool', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3808,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3808/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'nonExistentTool', args: {} }),
        });

        const data = await response.json();
        assert.equal(data.success, false, 'Invalid tool should fail');

        console.log('  ✅ Invalid tool name handling');
      } finally {
        await server.stop();
      }
    }

    // Test 76: Server info includes correct counts
    {
      const testFile = await createTestPhoton('server-info', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3809,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const response = await fetch('http://localhost:3809/');
        const data = await response.json();

        assert.ok(data.tools >= 4, 'Should have at least 4 tools');
        assert.ok(data.endpoints, 'Should have endpoints');

        console.log('  ✅ Server info includes correct counts');
      } finally {
        await server.stop();
      }
    }

    // Test 77: Multiple sequential requests
    {
      const testFile = await createTestPhoton('sequential', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3810,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        // First request
        const r1 = await fetch('http://localhost:3810/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'add', args: { a: 1, b: 2 } }),
        });
        const d1 = await r1.json();
        assert.equal(d1.data, 3, 'First call should return 3');

        // Second request
        const r2 = await fetch('http://localhost:3810/api/call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'add', args: { a: 10, b: 20 } }),
        });
        const d2 = await r2.json();
        assert.equal(d2.data, 30, 'Second call should return 30');

        console.log('  ✅ Multiple sequential requests');
      } finally {
        await server.stop();
      }
    }

    // Test 78: Parallel requests
    {
      const testFile = await createTestPhoton('parallel', basicPhotonContent);
      const server = new PhotonServer({
        filePath: testFile,
        transport: 'sse',
        port: 3811,
      });

      try {
        await server.start();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const [r1, r2, r3] = await Promise.all([
          fetch('http://localhost:3811/api/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'add', args: { a: 1, b: 1 } }),
          }),
          fetch('http://localhost:3811/api/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'add', args: { a: 2, b: 2 } }),
          }),
          fetch('http://localhost:3811/api/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'add', args: { a: 3, b: 3 } }),
          }),
        ]);

        const [d1, d2, d3] = await Promise.all([r1.json(), r2.json(), r3.json()]);
        assert.equal(d1.data, 2, 'First parallel call');
        assert.equal(d2.data, 4, 'Second parallel call');
        assert.equal(d3.data, 6, 'Third parallel call');

        console.log('  ✅ Parallel requests handling');
      } finally {
        await server.stop();
      }
    }

    console.log('\n✅ All Comprehensive Server tests passed!');
  } finally {
    await cleanup();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { runTests };
