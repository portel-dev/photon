/**
 * Test progressive enhancement: MCP responses adapt by client capability
 *
 * Tests BOTH transports:
 * - STDIO: spawns PhotonServer as subprocess, connects via StdioClientTransport
 * - SSE (HTTP): spawns PhotonServer with --transport sse, connects via SSEClientTransport
 *
 * Three tiers tested on each transport:
 * - basic: no UI capability → no _meta.ui, no structuredContent
 * - mcp-apps: experimental["io.modelcontextprotocol/ui"] → full UI response
 * - beam: clientInfo.name = "beam" → full UI response (name-based fallback)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const fixturesDir = path.join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function ok(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────
// Transport helpers
// ─────────────────────────────────────────────────────────

type ClientOpts = {
  name: string;
  version?: string;
  capabilities?: Record<string, unknown>;
};

/**
 * Create a connected MCP client over STDIO transport
 */
async function createStdioClient(opts: ClientOpts): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, `--dir=${fixturesDir}`, 'mcp', 'ui-test'],
  });

  const client = new Client(
    { name: opts.name, version: opts.version ?? '1.0.0' },
    { capabilities: opts.capabilities ?? {} }
  );

  await client.connect(transport);
  return client;
}

/**
 * Start a PhotonServer SSE process and wait until the HTTP endpoint is ready
 */
async function startSSEServer(port: number): Promise<ChildProcess> {
  const proc = spawn(
    'node',
    [
      cliPath,
      `--dir=${fixturesDir}`,
      'mcp',
      'ui-test',
      '--transport',
      'sse',
      '--port',
      String(port),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] }
  );

  // Capture stderr for debugging
  let stderr = '';
  proc.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`SSE server exited with code ${code}, signal ${signal}`);
      if (stderr) console.error('SSE server stderr:', stderr.slice(-500));
    }
  });

  // Wait for the server to be ready by polling the root endpoint
  const startTime = Date.now();
  const timeout = 15000;
  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return proc;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  proc.kill();
  throw new Error(
    `SSE server did not start within ${timeout}ms on port ${port}. Stderr: ${stderr}`
  );
}

/**
 * Create a connected MCP client over SSE transport
 */
async function createSSEClient(port: number, opts: ClientOpts): Promise<Client> {
  const url = new URL(`http://localhost:${port}/mcp`);
  const transport = new SSEClientTransport(url);

  const client = new Client(
    { name: opts.name, version: opts.version ?? '1.0.0' },
    { capabilities: opts.capabilities ?? {} }
  );

  await client.connect(transport);
  return client;
}

// ─────────────────────────────────────────────────────────
// Test assertions (shared between transports)
// ─────────────────────────────────────────────────────────

async function testBasicToolsList(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(`[${label}] Basic client: tools/list should NOT include _meta.ui`);
  const client = await createFn({ name: 'unknown-client' });
  try {
    const { tools } = await client.listTools();
    const mainTool = tools.find((t) => t.name === 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!(mainTool as any)._meta?.ui, 'No _meta.ui for basic client');
  } finally {
    await client.close();
  }
}

async function testBasicToolsCall(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(
    `[${label}] Basic client: tools/call should NOT include structuredContent or _meta.ui`
  );
  const client = await createFn({ name: 'unknown-client' });
  try {
    const result = await client.callTool({ name: 'main', arguments: {} });
    ok(Array.isArray(result.content), 'Has content array');
    ok(!(result as any).structuredContent, 'No structuredContent');
    ok(!(result as any)._meta?.ui, 'No _meta.ui');
  } finally {
    await client.close();
  }
}

async function testMCPAppsToolsList(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(`[${label}] MCP Apps client (capability): tools/list should include _meta.ui`);
  const client = await createFn({
    name: 'some-ui-client',
    capabilities: { experimental: { 'io.modelcontextprotocol/ui': {} } },
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = tools.find((t) => t.name === 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    const meta = (mainTool as any)._meta;
    ok(!!meta?.ui?.resourceUri, 'Has _meta.ui.resourceUri');
    ok((meta.ui.resourceUri as string).startsWith('ui://'), `Starts with ui://`);
  } finally {
    await client.close();
  }
}

async function testMCPAppsToolsCall(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(
    `[${label}] MCP Apps client (capability): tools/call should include structuredContent + _meta.ui`
  );
  const client = await createFn({
    name: 'some-ui-client',
    capabilities: { experimental: { 'io.modelcontextprotocol/ui': {} } },
  });
  try {
    const result = await client.callTool({ name: 'main', arguments: {} });
    ok(Array.isArray(result.content), 'Has content array');
    ok(!!(result as any).structuredContent, 'Has structuredContent');
    ok(
      (result as any).structuredContent?.message === 'Hello from UI test',
      `structuredContent has correct value`
    );
    ok(!!(result as any)._meta?.ui?.resourceUri, 'Has _meta.ui.resourceUri');
  } finally {
    await client.close();
  }
}

async function testKnownClientFallback(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(`[${label}] Known client name fallback (chatgpt): should get _meta.ui`);
  const client = await createFn({ name: 'chatgpt' });
  try {
    const { tools } = await client.listTools();
    const mainTool = tools.find((t) => t.name === 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!!(mainTool as any)._meta?.ui?.resourceUri, 'Has _meta.ui.resourceUri (chatgpt fallback)');
  } finally {
    await client.close();
  }
}

async function testBeamClient(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(`[${label}] Beam client: tools/list + tools/call should include full UI response`);
  const client = await createFn({ name: 'beam' });
  try {
    const { tools } = await client.listTools();
    const mainTool = tools.find((t) => t.name === 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!!(mainTool as any)._meta?.ui?.resourceUri, 'tools/list: has _meta.ui.resourceUri');

    const result = await client.callTool({ name: 'main', arguments: {} });
    ok(!!(result as any).structuredContent, 'tools/call: has structuredContent');
    ok(!!(result as any)._meta?.ui?.resourceUri, 'tools/call: has _meta.ui.resourceUri');
  } finally {
    await client.close();
  }
}

async function testClaudeDesktop(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(`[${label}] Claude Desktop (no UI capability): should be basic tier`);
  const client = await createFn({
    name: 'claude-ai',
    capabilities: { elicitation: {} },
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = tools.find((t) => t.name === 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!(mainTool as any)._meta?.ui, 'No _meta.ui (claude-ai without UI capability)');
  } finally {
    await client.close();
  }
}

// ─────────────────────────────────────────────────────────
// Run all tests
// ─────────────────────────────────────────────────────────

async function runTests() {
  console.log('🧪 Client-Adaptive MCP Responses Tests\n');

  // ═══════════════════════════════════════════════════════
  // Part 1: STDIO Transport
  // ═══════════════════════════════════════════════════════
  console.log('══════════════════════════════════════════');
  console.log('  STDIO Transport');
  console.log('══════════════════════════════════════════\n');

  await testBasicToolsList(createStdioClient, 'STDIO');
  await testBasicToolsCall(createStdioClient, 'STDIO');
  await testMCPAppsToolsList(createStdioClient, 'STDIO');
  await testMCPAppsToolsCall(createStdioClient, 'STDIO');
  await testKnownClientFallback(createStdioClient, 'STDIO');
  await testBeamClient(createStdioClient, 'STDIO');
  await testClaudeDesktop(createStdioClient, 'STDIO');

  // ═══════════════════════════════════════════════════════
  // Part 2: SSE Transport (HTTP)
  // Each test creates and closes its own SSE session
  // ═══════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════');
  console.log('  SSE Transport (HTTP)');
  console.log('══════════════════════════════════════════\n');

  const SSE_PORT = 3870 + Math.floor(Math.random() * 20);
  let sseProc: ChildProcess | null = null;

  try {
    console.log(`Starting SSE server on port ${SSE_PORT}...`);
    sseProc = await startSSEServer(SSE_PORT);
    console.log(`SSE server ready on port ${SSE_PORT}\n`);

    const createSSE = (opts: ClientOpts) => createSSEClient(SSE_PORT, opts);

    await testBasicToolsList(createSSE, 'SSE');
    await testBasicToolsCall(createSSE, 'SSE');
    await testMCPAppsToolsList(createSSE, 'SSE');
    await testMCPAppsToolsCall(createSSE, 'SSE');
    await testKnownClientFallback(createSSE, 'SSE');
    await testBeamClient(createSSE, 'SSE');
    await testClaudeDesktop(createSSE, 'SSE');
  } finally {
    if (sseProc) {
      sseProc.kill();
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (sseProc!.killed) return resolve();
        sseProc!.on('exit', () => resolve());
        setTimeout(resolve, 2000);
      });
    }
  }

  // ─────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('❌ Test suite error:', err);
  process.exit(1);
});
