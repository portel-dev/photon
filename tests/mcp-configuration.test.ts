/**
 * Tests for MCP Configuration Features
 *
 * Tests the Streamable HTTP transport configuration schema:
 * - configurationSchema in initialize response
 * - beam/configure tool
 * - beam/browse tool
 * - JSON Schema format values (password, path, enum)
 *
 * Uses a self-contained test photon in a temp directory so tests
 * are environment-independent (don't rely on ~/.photon contents).
 */

import { strict as assert } from 'assert';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Test photon with required constructor params that exercise all schema formats:
 * - apiKey (sensitive → format: password, writeOnly: true)
 * - socketPath (path-like → format: path)
 * Both produce x-env-var entries.
 */
const TEST_PHOTON_SOURCE = `
export default class ConfigTestMCP {
  /**
   * @param apiKey API key for authentication
   * @param socketPath Path to unix socket
   */
  constructor(apiKey: string, socketPath: string) {}

  /** Echo text back */
  async echo(params: { text: string }) {
    return params.text;
  }
}
`;

// Helper to make HTTP requests
async function mcpRequest(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string
): Promise<{ result?: unknown; error?: unknown; sessionId?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId;
  }

  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params,
    }),
  });

  const newSessionId = response.headers.get('Mcp-Session-Id') || undefined;
  const json = await response.json();

  return {
    result: json.result,
    error: json.error,
    sessionId: newSessionId || sessionId,
  };
}

// Start Beam server with a custom --dir pointing to our test photon directory
async function startBeamServer(port: number, dir: string): Promise<ChildProcess> {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

  // --dir must come after 'beam' to avoid preprocessArgs() treating the path as a photon name
  const proc = spawn('node', [cliPath, 'beam', '--port', String(port), '--dir', dir], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Ensure the test photon's env vars are NOT set so it stays unconfigured
      CONFIG_TEST_MCP_API_KEY: undefined as any,
      CONFIG_TEST_MCP_SOCKET_PATH: undefined as any,
    },
  });

  // Wait for server to be fully ready (photons loaded)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 30000);
    let allOutput = '';

    const checkReady = (data: Buffer) => {
      allOutput += data.toString();
      // Wait for "Photon Beam ready" which means photons are loaded
      if (allOutput.includes('Photon Beam ready')) {
        clearTimeout(timeout);
        resolve();
      }
    };

    proc.stdout?.on('data', checkReady);
    proc.stderr?.on('data', checkReady);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return proc;
}

async function runTests() {
  console.log('🧪 Running MCP Configuration Tests...\n');

  const port = 3899;
  let server: ChildProcess | null = null;
  let tempDir: string | null = null;

  try {
    // Create temp directory with our test photon
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'photon-config-test-'));
    await fs.writeFile(
      path.join(tempDir, 'config-test-mcp.photon.ts'),
      TEST_PHOTON_SOURCE,
      'utf-8'
    );

    // Start server with our temp dir
    server = await startBeamServer(port, tempDir);

    // Initialize session
    const initResult = await mcpRequest(port, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    });

    assert.ok(initResult.result, 'Initialize should return result');
    const result = initResult.result as Record<string, unknown>;
    const sessionId = initResult.sessionId;

    // Test 1: configurationSchema is present
    {
      assert.ok(result.configurationSchema, 'Should include configurationSchema');
      const schema = result.configurationSchema as Record<string, unknown>;
      assert.ok(Object.keys(schema).length > 0, 'configurationSchema should have entries');
      console.log('✅ configurationSchema is present in initialize response');
    }

    // Test 2: configurationSchema has correct structure
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;
      assert.ok(schema['config-test-mcp'], 'Should have config-test-mcp entry');

      const photonSchema = schema['config-test-mcp'];
      assert.equal(photonSchema.type, 'object', 'Schema should be type object');
      assert.ok(photonSchema.properties, 'Schema should have properties');
      console.log('✅ configurationSchema has correct JSON Schema structure');
    }

    // Test 3: Sensitive fields use format: password + writeOnly: true
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;
      const properties = schema['config-test-mcp'].properties as Record<
        string,
        Record<string, unknown>
      >;

      // apiKey should have format: password
      const apiKeyField = properties['apiKey'];
      assert.ok(apiKeyField, 'Should have apiKey field');
      assert.equal(apiKeyField.format, 'password', 'apiKey should have format: password');
      assert.equal(apiKeyField.writeOnly, true, 'apiKey should have writeOnly: true');
      console.log('✅ Sensitive fields use OpenAPI-compliant format: password + writeOnly: true');
    }

    // Test 4: Path fields use format: path
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;
      const properties = schema['config-test-mcp'].properties as Record<
        string,
        Record<string, unknown>
      >;

      const socketPathField = properties['socketPath'];
      assert.ok(socketPathField, 'Should have socketPath field');
      assert.equal(socketPathField.format, 'path', 'socketPath should have format: path');
      console.log('✅ Path fields use format: path');
    }

    // Test 5: x-env-var is present for mapping to environment variables
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;
      const properties = schema['config-test-mcp'].properties as Record<
        string,
        Record<string, unknown>
      >;

      const apiKeyField = properties['apiKey'];
      assert.ok(apiKeyField['x-env-var'], 'Fields should have x-env-var for env mapping');
      console.log('✅ Fields have x-env-var for environment variable mapping');
    }

    // Send initialized notification (no response expected)
    await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      }),
    });

    // Test 6: tools/list includes beam/configure and beam/browse
    {
      const toolsResult = await mcpRequest(port, 'tools/list', {}, sessionId);
      const tools = (toolsResult.result as { tools: Array<{ name: string }> }).tools;

      const hasBeamConfigure = tools.some((t) => t.name === 'beam/configure');
      const hasBeamBrowse = tools.some((t) => t.name === 'beam/browse');

      assert.ok(hasBeamConfigure, 'Should have beam/configure tool');
      assert.ok(hasBeamBrowse, 'Should have beam/browse tool');
      console.log('✅ tools/list includes beam/configure and beam/browse');
    }

    // Test 7: beam/browse tool returns directory listing
    {
      const browseResult = await mcpRequest(
        port,
        'tools/call',
        {
          name: 'beam/browse',
          arguments: {},
        },
        sessionId
      );

      const callResult = browseResult.result as {
        content: Array<{ type: string; text: string }>;
      };
      assert.ok(callResult.content, 'beam/browse should return content');

      const textContent = callResult.content.find((c) => c.type === 'text');
      assert.ok(textContent, 'Should have text content');

      const data = JSON.parse(textContent.text);
      assert.ok(data.path, 'Should have path');
      assert.ok(Array.isArray(data.items), 'Should have items array');
      console.log('✅ beam/browse returns directory listing');
    }

    // Test 8: beam/configure validates required params
    {
      const configureResult = await mcpRequest(
        port,
        'tools/call',
        {
          name: 'beam/configure',
          arguments: {}, // Missing required params
        },
        sessionId
      );

      const callResult = configureResult.result as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };
      assert.ok(callResult.isError, 'Should return error for missing params');
      console.log('✅ beam/configure validates required parameters');
    }

    console.log('\n✅ All MCP Configuration tests passed!');
  } finally {
    // Cleanup
    if (server) {
      server.kill();
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
