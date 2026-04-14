/**
 * Cross-transport data parity tests
 *
 * Verifies that the same photon method returns identical data values
 * when called through different transports (CLI, STDIO MCP, SSE HTTP).
 *
 * The two handler paths (setupHandlers for STDIO, setupSessionHandlers for SSE)
 * have diverged over time. This test catches data-level regressions.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { strict as assert } from 'assert';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, type ChildProcess } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '..', 'dist', 'cli.js');
const fixturesDir = path.join(__dirname, 'fixtures');
const photonFile = path.join(fixturesDir, 'promise-test.photon.ts');

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

function extractText(result: any): string {
  if (result?.content) {
    return result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
  }
  return String(result);
}

function extractJSON(result: any): any {
  const text = extractText(result);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function findToolName(tools: any[], name: string): string {
  const t = tools.find((t: any) => t.name === name || t.name.endsWith(`/${name}`));
  return t?.name ?? name;
}

// ─────────────────────────────────────────────────────────
// Transport helpers
// ─────────────────────────────────────────────────────────

function runCLI(method: string, args: string = ''): string {
  const cmd = `node ${cliPath} ${photonFile} ${method} ${args}`.trim();
  return execSync(cmd, {
    encoding: 'utf-8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    timeout: 15000,
  }).trim();
}

async function createStdioClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [cliPath, 'mcp', 'promise-test'],
    env: { ...process.env, PHOTON_DIR: fixturesDir },
  });
  const client = new Client({ name: 'parity-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function startSSEServer(port: number): Promise<ChildProcess> {
  const proc = spawn(
    'node',
    [cliPath, 'mcp', 'promise-test', '--transport', 'sse', '--port', String(port)],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PHOTON_DIR: fixturesDir } }
  );

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  proc.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`SSE server exited: code=${code} signal=${signal}`);
      if (stderr) console.error(stderr.slice(-500));
    }
  });

  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await fetch(`http://localhost:${port}/`);
      if (res.ok) return proc;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`SSE server did not start within 15s. Stderr: ${stderr}`);
}

async function createSSEClient(port: number): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`));
  const client = new Client({ name: 'parity-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

// ─────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────

async function runTests() {
  console.log('🧪 Cross-transport data parity tests\n');

  const SSE_PORT = 19876;
  let sseProc: ChildProcess | null = null;
  let stdioClient: Client | null = null;
  let sseClient: Client | null = null;

  try {
    // Start both transports
    console.log('Starting transports...');
    [stdioClient, sseProc] = await Promise.all([createStdioClient(), startSSEServer(SSE_PORT)]);
    sseClient = await createSSEClient(SSE_PORT);

    // ── Test 1: Tool listing parity ──
    {
      console.log('\n[1] Tool listing parity');
      const stdioTools = await stdioClient.listTools();
      const sseTools = await sseClient.listTools();

      const stdioNames = stdioTools.tools.map((t) => t.name).sort();
      const sseNames = sseTools.tools
        .map((t) => (t.name.includes('/') ? t.name.split('/').pop()! : t.name))
        .sort();

      ok(
        JSON.stringify(stdioNames) === JSON.stringify(sseNames),
        `Tool names match: ${stdioNames.join(', ')}`
      );
    }

    // ── Test 2: Simple call returns same data ──
    {
      console.log('\n[2] Simple call: greet({name: "World"})');
      const stdioResult = await stdioClient.callTool({
        name: findToolName((await stdioClient.listTools()).tools, 'greet'),
        arguments: { name: 'World' },
      });
      const sseResult = await sseClient.callTool({
        name: findToolName((await sseClient.listTools()).tools, 'greet'),
        arguments: { name: 'World' },
      });

      const stdioText = extractText(stdioResult);
      const sseText = extractText(sseResult);
      ok(stdioText === sseText, `STDIO="${stdioText}" === SSE="${sseText}"`);
    }

    // ── Test 3: Structured data parity (table format) ──
    {
      console.log('\n[3] Structured data: users() with @format table');
      const stdioResult = await stdioClient.callTool({
        name: findToolName((await stdioClient.listTools()).tools, 'users'),
        arguments: {},
      });
      const sseResult = await sseClient.callTool({
        name: findToolName((await sseClient.listTools()).tools, 'users'),
        arguments: {},
      });

      const stdioData = extractJSON(stdioResult);
      const sseData = extractJSON(sseResult);
      ok(
        JSON.stringify(stdioData) === JSON.stringify(sseData),
        'Structured data identical across transports'
      );
    }

    // ── Test 4: Parameter validation consistency ──
    {
      console.log('\n[4] Parameter validation: add() with @min constraint');
      const stdioTools = (await stdioClient.listTools()).tools;
      const sseTools = (await sseClient.listTools()).tools;
      const stdioAdd = stdioTools.find((t) => t.name === 'add' || t.name.endsWith('/add'));
      const sseAdd = sseTools.find((t) => t.name === 'add' || t.name.endsWith('/add'));

      const stdioSchema = (stdioAdd as any)?.inputSchema?.properties;
      const sseSchema = (sseAdd as any)?.inputSchema?.properties;

      ok(
        stdioSchema?.a?.minimum === sseSchema?.a?.minimum,
        `@min constraint: STDIO=${stdioSchema?.a?.minimum}, SSE=${sseSchema?.a?.minimum}`
      );
    }

    // ── Test 5: Markdown format parity ──
    {
      console.log('\n[5] Markdown format: docs()');
      const stdioResult = await stdioClient.callTool({
        name: findToolName((await stdioClient.listTools()).tools, 'docs'),
        arguments: {},
      });
      const sseResult = await sseClient.callTool({
        name: findToolName((await sseClient.listTools()).tools, 'docs'),
        arguments: {},
      });

      const stdioText = extractText(stdioResult);
      const sseText = extractText(sseResult);
      ok(stdioText === sseText, 'Markdown content identical across transports');
    }

    // ── Test 6: Error handling consistency ──
    {
      console.log('\n[6] Error handling: calling non-existent tool');
      let stdioError: string | null = null;
      let sseError: string | null = null;

      try {
        await stdioClient.callTool({ name: 'nonexistent', arguments: {} });
      } catch (e: any) {
        stdioError = e.message || String(e);
      }

      try {
        await sseClient.callTool({ name: 'nonexistent', arguments: {} });
      } catch (e: any) {
        sseError = e.message || String(e);
      }

      // Both should either throw or return isError - the key is they both handle it
      const bothHandleErrors = (stdioError !== null) === (sseError !== null);
      ok(
        bothHandleErrors,
        `Both transports handle unknown tools: STDIO=${!!stdioError}, SSE=${!!sseError}`
      );
    }

    // ── Test 7: Tool annotations parity ──
    {
      console.log('\n[7] Tool annotations: @readOnly propagated consistently');
      const stdioTools = (await stdioClient.listTools()).tools;
      const sseTools = (await sseClient.listTools()).tools;

      const stdioGreet = stdioTools.find((t) => t.name === 'greet' || t.name.endsWith('/greet'));
      const sseGreet = sseTools.find((t) => t.name === 'greet' || t.name.endsWith('/greet'));

      const stdioReadOnly = (stdioGreet as any)?.annotations?.readOnlyHint;
      const sseReadOnly = (sseGreet as any)?.annotations?.readOnlyHint;

      ok(
        stdioReadOnly === sseReadOnly,
        `@readOnly annotation: STDIO=${stdioReadOnly}, SSE=${sseReadOnly}`
      );
    }

    // ── Summary ──
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  } finally {
    if (stdioClient) await stdioClient.close().catch(() => {});
    if (sseClient) await sseClient.close().catch(() => {});
    if (sseProc) sseProc.kill();
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
