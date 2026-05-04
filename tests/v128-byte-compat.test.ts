/**
 * v1.28 byte-compat regression
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → "Backward-compat regression".
 *
 * Locks the v1.28 default-path surface so each v1.29 track lands without
 * silently shifting behaviour for photons that haven't opted into any new
 * feature. The fixture tests/fixtures/v128-compat.photon.ts uses NO new
 * tags (no @expose, no future-tag opt-ins). After every track, this file
 * must stay green — if it goes red, that track is reverted.
 *
 * Coverage:
 *   1. MCP tools/list → expected tool set + schemas
 *   2. MCP tools/call → byte-stable output for deterministic methods
 *   3. MCP prompts/list + prompts/get
 *   4. MCP resources/list + resources/read
 *   5. HTTP @get route handler returning Response → bytes pass through
 *   6. HTTP @post route handler returning Response → bytes pass through
 *   7. @ui standalone HTML served at /api/ui/<id> → NO COOP/COEP headers (sentinel for D2 opt-in)
 *
 * Skipped under CI=true unless RUN_E2E=1 (matches dynamic-resources-subscribe-sse.e2e
 * convention; spawning a child server is environment-sensitive).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'v128-compat.photon.ts');

const PORT = 30000 + Math.floor(Math.random() * 30000);
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`;
const BASE = `http://127.0.0.1:${PORT}`;

const SKIP = process.env.CI === 'true' && process.env.RUN_E2E !== '1';

async function waitForPort(port: number, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
      if (res.status > 0) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start on port ${port} within ${timeoutMs}ms`);
}

describe.skipIf(SKIP)('v1.28 byte-compat regression', () => {
  let server: ChildProcess;
  let client: Client;

  beforeAll(async () => {
    server = spawn(PHOTON_BIN, ['mcp', '--transport', 'sse', '--port', String(PORT), FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stderr.write(b);
    });
    server.stdout?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stdout.write(b);
    });
    await waitForPort(PORT);

    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));
    client = new Client({ name: 'v128-byte-compat', version: '0.0.0' }, {});
    await client.connect(transport);
  }, 15_000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // ignore close errors during teardown
    }
    server?.kill();
  });

  // v1.28 namespaces tool names as `<photon>/<method>`. Locking that here.
  const TOOL = 'v128-compat/wordCount';

  it('MCP tools/list returns the expected tool set (route handlers excluded)', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    // hello and echo are @get/@post handlers and must NOT appear as MCP tools.
    expect(names).toEqual([TOOL]);

    const wordCount = tools.find((t) => t.name === TOOL)!;
    expect(wordCount.inputSchema?.type).toBe('object');
    expect((wordCount.inputSchema as any)?.properties?.text?.type).toBe('string');
  });

  it('MCP tools/call wordCount produces byte-stable output', async () => {
    const response = await client.callTool({
      name: TOOL,
      arguments: { text: 'Hello world test' },
    });
    const content = response.content as Array<{ type: string; text: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].type).toBe('text');
    expect(content[0].text).toBe('Word count: 3');
  });

  it('MCP prompts/list + prompts/get behave as in v1.28', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(['codeReview']);

    const got = await client.getPrompt({
      name: 'codeReview',
      arguments: { language: 'TypeScript', code: 'const x = 5;' },
    });
    const messages = got.messages as Array<{ role: string; content: { text: string } }>;
    expect(messages[0].role).toBe('user');
    // v1.28 wraps the photon method's return value as JSON inside content.text.
    // Lock that exact shape so any track that changes it surfaces here.
    expect(JSON.parse(messages[0].content.text)).toEqual({
      role: 'user',
      content: {
        type: 'text',
        text: 'Please review this TypeScript code:\n\nconst x = 5;',
      },
    });
  });

  it('MCP resources/list + resources/read behave as in v1.28', async () => {
    const { resources } = await client.listResources();
    const apiDocs = resources.find((r) => r.uri === 'api://docs');
    expect(apiDocs).toBeDefined();

    const read = await client.readResource({ uri: 'api://docs' });
    const contents = read.contents as Array<{ mimeType: string; text: string }>;
    expect(contents[0].mimeType).toBe('text/markdown');
    // v1.28 wraps resource handler return values as JSON inside contents[].text.
    expect(JSON.parse(contents[0].text)).toEqual({
      mimeType: 'text/markdown',
      text: '# API Documentation\n\nThis is the API docs.',
    });
  });

  it('HTTP @get route handler Response passes through byte-identical', async () => {
    const res = await fetch(`${BASE}/hello`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('hello world');
  });

  it('HTTP @post route handler Response passes through byte-identical', async () => {
    const res = await fetch(`${BASE}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'echo me',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('echo me');
  });

  it('@ui standalone HTML served without COOP/COEP unless opted in (D2 sentinel)', async () => {
    const res = await fetch(`${BASE}/api/ui/form`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html');

    // Sentinel: track D2 must keep these headers OFF on the default path.
    // Track D2 introduces COOP/COEP only on the opt-in standalone path
    // (top-level navigation without ?embed=1). The @ui path tested here
    // is the embedded-iframe path Claude Desktop / Cursor consume —
    // adding COOP/COEP here would break iframe embedding.
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
    expect(res.headers.get('cross-origin-embedder-policy')).toBeNull();
  });
});
