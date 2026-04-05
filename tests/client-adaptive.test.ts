/**
 * Test progressive enhancement: MCP responses adapt by client capability
 *
 * Tests BOTH transports:
 * - STDIO: spawns PhotonServer as subprocess, connects via StdioClientTransport
 * - SSE (HTTP): spawns PhotonServer with --transport sse, connects via SSEClientTransport
 *
 * Client tiers tested on each transport:
 * - basic: no UI capability → no _meta.ui, no structuredContent
 * - experimental: experimental["io.modelcontextprotocol/ui"] → full UI response (older SDK)
 * - extensions: extensions["io.modelcontextprotocol/ui"] → full UI response (protocol 2025-11-25+)
 * - beam: clientInfo.name = "beam" → full UI response (name-based fallback)
 *
 * The extensions vs experimental distinction is critical:
 * Claude Desktop and ChatGPT use `extensions`, older clients use `experimental`.
 * Both paths MUST work — a regression in either path breaks real clients.
 *
 * Note: The MCP SDK Client passes `extensions` in the JSON-RPC initialize message
 * (TypeScript types are erased at runtime), but the MCP SDK Server's Zod schema
 * strips it during validation. The server uses transport-level interception to
 * capture raw capabilities before Zod parsing.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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

/** Resolve tool name — handles both bare 'main' (STDIO) and 'photon/main' (SSE) */
function findTool(tools: any[], name: string) {
  return tools.find((t: any) => t.name === name || t.name.endsWith(`/${name}`));
}
function toolName(tools: any[], name: string): string {
  const t = findTool(tools, name);
  return t?.name ?? name;
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
    args: [cliPath, 'mcp', 'ui-test'],
    env: { ...process.env, PHOTON_DIR: fixturesDir },
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
    [cliPath, 'mcp', 'ui-test', '--transport', 'sse', '--port', String(port)],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PHOTON_DIR: fixturesDir } }
  );

  let stderr = '';
  proc.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`SSE server exited with code ${code}, signal ${signal}`);
      if (stderr) console.error('SSE server stderr:', stderr.slice(-500));
    }
  });

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
  const transport = new StreamableHTTPClientTransport(url);

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

/**
 * Basic client with no capabilities → should get text-only responses
 */
async function testBasicToolsList(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(`[${label}] Basic client: tools/list should NOT include _meta.ui`);
  const client = await createFn({ name: 'unknown-client' });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
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
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: toolName(tools, 'main'), arguments: {} });
    ok(Array.isArray(result.content), 'Has content array');
    ok(!(result as any).structuredContent, 'No structuredContent');
    ok(!(result as any)._meta?.ui, 'No _meta.ui');
  } finally {
    await client.close();
  }
}

/**
 * Client using `experimental` field (older SDK types) → should get full UI
 */
async function testExperimentalCapability(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(`[${label}] Client with experimental UI capability: tools/list + tools/call`);
  const client = await createFn({
    name: 'some-ui-client',
    capabilities: { experimental: { 'io.modelcontextprotocol/ui': {} } },
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    const meta = (mainTool as any)._meta;
    ok(!!meta?.ui?.resourceUri, 'tools/list: has _meta.ui.resourceUri');
    ok((meta.ui.resourceUri as string).startsWith('ui://'), 'tools/list: starts with ui://');

    const result = await client.callTool({ name: mainTool!.name, arguments: {} });
    ok(Array.isArray(result.content), 'tools/call: has content array');
    ok(!!(result as any).structuredContent, 'tools/call: has structuredContent');
    ok(
      (result as any).structuredContent?.message === 'Hello from UI test',
      'tools/call: structuredContent has correct value'
    );
    ok(!!(result as any)._meta?.ui?.resourceUri, 'tools/call: has _meta.ui.resourceUri');
  } finally {
    await client.close();
  }
}

/**
 * Claude Desktop — sends extensions["io.modelcontextprotocol/ui"]
 *
 * This is THE critical test. Claude Desktop uses `extensions` (protocol 2025-11-25+),
 * NOT `experimental`. The MCP SDK's Zod schema strips `extensions` during validation,
 * so the server must intercept raw capabilities from the transport layer.
 *
 * Reproduces the exact initialize payload from Claude Desktop logs:
 * {"capabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}}
 *
 * If this test fails, MCP Apps UI is broken for ALL Claude Desktop users.
 */
async function testClaudeDesktopWithUI(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(
    `[${label}] Claude Desktop (extensions UI capability): tools/list + tools/call with full UI`
  );
  const client = await createFn({
    name: 'claude-ai',
    version: '0.1.0',
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/ui': {
          mimeTypes: ['text/html;profile=mcp-app'],
        },
      },
    } as any, // `extensions` not in SDK types but IS sent over the wire
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!!(mainTool as any)._meta?.ui?.resourceUri, 'tools/list: has _meta.ui.resourceUri');

    const result = await client.callTool({ name: mainTool!.name, arguments: {} });
    ok(!!(result as any).structuredContent, 'tools/call: has structuredContent');
    ok(
      (result as any).structuredContent?.message === 'Hello from UI test',
      'tools/call: structuredContent has correct value'
    );
    ok(!!(result as any)._meta?.ui?.resourceUri, 'tools/call: has _meta.ui.resourceUri');
  } finally {
    await client.close();
  }
}

/**
 * Claude Desktop WITHOUT UI capability → basic tier
 */
async function testClaudeDesktopNoUI(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(`[${label}] Claude Desktop (no UI capability): should be basic tier`);
  const client = await createFn({
    name: 'claude-ai',
    capabilities: { elicitation: {} },
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!(mainTool as any)._meta?.ui, 'No _meta.ui (claude-ai without UI capability)');

    const result = await client.callTool({ name: mainTool!.name, arguments: {} });
    ok(!(result as any).structuredContent, 'No structuredContent without UI capability');
  } finally {
    await client.close();
  }
}

/**
 * ChatGPT — also uses extensions field
 */
async function testChatGPTWithUI(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(`[${label}] ChatGPT (extensions UI): tools/list + tools/call with full UI`);
  const client = await createFn({
    name: 'chatgpt',
    capabilities: {
      extensions: {
        'io.modelcontextprotocol/ui': {
          mimeTypes: ['text/html;profile=mcp-app'],
        },
      },
    } as any,
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!!(mainTool as any)._meta?.ui?.resourceUri, 'tools/list: has _meta.ui.resourceUri');

    const result = await client.callTool({ name: mainTool!.name, arguments: {} });
    ok(!!(result as any).structuredContent, 'tools/call: has structuredContent');
  } finally {
    await client.close();
  }
}

/**
 * ChatGPT WITHOUT extensions → basic tier (no hardcoded name fallback)
 */
async function testChatGPTNoCapability(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(`[${label}] ChatGPT (no capability): should be basic tier`);
  const client = await createFn({ name: 'chatgpt', capabilities: {} });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!(mainTool as any)._meta?.ui, 'No _meta.ui (chatgpt without capability)');
  } finally {
    await client.close();
  }
}

/**
 * Beam — implicit UI support via client name (no capability needed)
 */
async function testBeamClient(createFn: (opts: ClientOpts) => Promise<Client>, label: string) {
  console.log(`[${label}] Beam client: tools/list + tools/call should include full UI response`);
  const client = await createFn({ name: 'beam' });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!!(mainTool as any)._meta?.ui?.resourceUri, 'tools/list: has _meta.ui.resourceUri');

    const result = await client.callTool({ name: mainTool!.name, arguments: {} });
    ok(!!(result as any).structuredContent, 'tools/call: has structuredContent');
    ok(!!(result as any)._meta?.ui?.resourceUri, 'tools/call: has _meta.ui.resourceUri');
  } finally {
    await client.close();
  }
}

/**
 * Unknown future client with extensions capability → should work
 * Proves detection is purely capability-based, not name-based
 */
async function testUnknownFutureClient(
  createFn: (opts: ClientOpts) => Promise<Client>,
  label: string
) {
  console.log(`[${label}] Unknown future client (extensions): should get full UI`);
  const client = await createFn({
    name: 'cursor-mcp-2027',
    capabilities: {
      extensions: { 'io.modelcontextprotocol/ui': {} },
    } as any,
  });
  try {
    const { tools } = await client.listTools();
    const mainTool = findTool(tools, 'main');
    assert.ok(mainTool, 'Should have "main" tool');
    ok(!!(mainTool as any)._meta?.ui?.resourceUri, 'Future client with capability gets _meta.ui');

    const result = await client.callTool({ name: mainTool!.name, arguments: {} });
    ok(!!(result as any).structuredContent, 'Future client gets structuredContent');
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
  await testExperimentalCapability(createStdioClient, 'STDIO');
  await testClaudeDesktopWithUI(createStdioClient, 'STDIO');
  await testClaudeDesktopNoUI(createStdioClient, 'STDIO');
  await testChatGPTWithUI(createStdioClient, 'STDIO');
  await testChatGPTNoCapability(createStdioClient, 'STDIO');
  await testBeamClient(createStdioClient, 'STDIO');
  await testUnknownFutureClient(createStdioClient, 'STDIO');

  // ═══════════════════════════════════════════════════════
  // Part 2: SSE Transport (HTTP)
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
    await testExperimentalCapability(createSSE, 'SSE');
    await testClaudeDesktopWithUI(createSSE, 'SSE');
    await testClaudeDesktopNoUI(createSSE, 'SSE');
    await testChatGPTWithUI(createSSE, 'SSE');
    await testChatGPTNoCapability(createSSE, 'SSE');
    await testBeamClient(createSSE, 'SSE');
    await testUnknownFutureClient(createSSE, 'SSE');
  } finally {
    if (sseProc) {
      sseProc.kill();
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
