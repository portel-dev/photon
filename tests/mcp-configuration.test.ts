/**
 * Tests for MCP Configuration Features
 *
 * Tests the Streamable HTTP transport configuration schema:
 * - configurationSchema in initialize response
 * - beam/configure tool
 * - beam/browse tool
 * - JSON Schema format values (password, path, enum)
 */

import { strict as assert } from 'assert';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Start Beam server and wait for it to be ready
async function startBeamServer(port: number): Promise<ChildProcess> {
  const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');

  const proc = spawn('node', [cliPath, 'beam', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  // Wait for server to start
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 15000);

    proc.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Photon Beam')) {
        clearTimeout(timeout);
        resolve();
      }
    });

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

  try {
    // Start server
    server = await startBeamServer(port);

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
      const photonNames = Object.keys(schema);

      // Check at least one photon schema
      const firstPhoton = schema[photonNames[0]];
      assert.equal(firstPhoton.type, 'object', 'Schema should be type object');
      assert.ok(firstPhoton.properties, 'Schema should have properties');
      console.log('✅ configurationSchema has correct JSON Schema structure');
    }

    // Test 3: Sensitive fields use format: password + writeOnly: true
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;

      // Find a schema with sensitive field (like aws-s3 or slack)
      let foundSensitiveField = false;
      for (const [photonName, photonSchema] of Object.entries(schema)) {
        const properties = photonSchema.properties as Record<string, Record<string, unknown>>;
        for (const [fieldName, fieldSchema] of Object.entries(properties)) {
          if (fieldSchema.format === 'password') {
            assert.equal(fieldSchema.writeOnly, true, `${photonName}.${fieldName} should have writeOnly: true`);
            foundSensitiveField = true;
            break;
          }
        }
        if (foundSensitiveField) break;
      }
      assert.ok(foundSensitiveField, 'Should have at least one field with format: password');
      console.log('✅ Sensitive fields use OpenAPI-compliant format: password + writeOnly: true');
    }

    // Test 4: Path fields use format: path
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;

      // Find docker schema which has socketPath
      let foundPathField = false;
      for (const [photonName, photonSchema] of Object.entries(schema)) {
        const properties = photonSchema.properties as Record<string, Record<string, unknown>>;
        for (const [fieldName, fieldSchema] of Object.entries(properties)) {
          if (fieldSchema.format === 'path') {
            foundPathField = true;
            break;
          }
        }
        if (foundPathField) break;
      }
      assert.ok(foundPathField, 'Should have at least one field with format: path');
      console.log('✅ Path fields use format: path');
    }

    // Test 5: x-env-var is present for mapping to environment variables
    {
      const schema = result.configurationSchema as Record<string, Record<string, unknown>>;
      const firstPhotonName = Object.keys(schema)[0];
      const firstPhoton = schema[firstPhotonName];
      const properties = firstPhoton.properties as Record<string, Record<string, unknown>>;
      const firstField = Object.values(properties)[0];

      assert.ok(firstField['x-env-var'], 'Fields should have x-env-var for env mapping');
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

      const hasBeamConfigure = tools.some(t => t.name === 'beam/configure');
      const hasBeamBrowse = tools.some(t => t.name === 'beam/browse');

      assert.ok(hasBeamConfigure, 'Should have beam/configure tool');
      assert.ok(hasBeamBrowse, 'Should have beam/browse tool');
      console.log('✅ tools/list includes beam/configure and beam/browse');
    }

    // Test 7: beam/browse tool returns directory listing
    {
      const browseResult = await mcpRequest(port, 'tools/call', {
        name: 'beam/browse',
        arguments: {},
      }, sessionId);

      const callResult = browseResult.result as { content: Array<{ type: string; text: string }> };
      assert.ok(callResult.content, 'beam/browse should return content');

      const textContent = callResult.content.find(c => c.type === 'text');
      assert.ok(textContent, 'Should have text content');

      const data = JSON.parse(textContent.text);
      assert.ok(data.path, 'Should have path');
      assert.ok(Array.isArray(data.items), 'Should have items array');
      console.log('✅ beam/browse returns directory listing');
    }

    // Test 8: beam/configure validates required params
    {
      const configureResult = await mcpRequest(port, 'tools/call', {
        name: 'beam/configure',
        arguments: {},  // Missing required params
      }, sessionId);

      const callResult = configureResult.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
      assert.ok(callResult.isError, 'Should return error for missing params');
      console.log('✅ beam/configure validates required parameters');
    }

    console.log('\n✅ All MCP Configuration tests passed!');
  } finally {
    // Cleanup
    if (server) {
      server.kill();
    }
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
