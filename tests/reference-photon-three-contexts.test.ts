/**
 * Reference photon — three-context smoke (Track F)
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track F.
 *
 * Drives the same photon over the three surfaces v1.29 promises:
 *   1. MCP tools/list + tools/call (the v1.28 surface, kept intact).
 *   2. Standalone web app via @ui dashboard (HTML page + sibling assets).
 *   3. External HTTP API via @expose (auto-RPC) and an explicit @get
 *      route with a Response pass-through (RSS feed).
 *
 * The test isn't trying to validate every field — it's a forcing function
 * that verifies one photon really does work in all three contexts. If any
 * of these surfaces regresses on a future track the test fails fast.
 *
 * Skipped under CI=true unless RUN_E2E=1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'examples', 'todo-app', 'todo-app.photon.ts');

const PORT = 30000 + Math.floor(Math.random() * 30000);
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

async function jsonrpc(method: string, params: unknown = {}): Promise<unknown> {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random().toString(36).slice(2),
      method,
      params,
    }),
  });
  if (!res.ok) throw new Error(`MCP ${method} → HTTP ${res.status}`);
  const env = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (env.error) throw new Error(env.error.message);
  return env.result;
}

describe.skipIf(SKIP)('reference photon — three contexts', () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawn(PHOTON_BIN, ['mcp', '--transport', 'sse', '--port', String(PORT), FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stderr.write(b);
    });
    await waitForPort(PORT);
  }, 15_000);

  afterAll(() => {
    server?.kill();
  });

  it('Context 1: MCP tools/list + tools/call surface every photon method', async () => {
    const list = (await jsonrpc('tools/list')) as { tools: Array<{ name: string }> };
    const names = new Set(list.tools.map((t) => t.name));
    // Methods bound to @get/@post are filtered out of the MCP surface;
    // `feed` carries @get /api/feed.rss so it should NOT appear here.
    expect(names.has('todo-app.feed')).toBe(false);
    // The @expose'd methods stay in the MCP catalog as tools.
    for (const name of ['addTask', 'listTasks', 'removeTask', 'search']) {
      expect(
        Array.from(names).some(
          (n) => n === name || n.endsWith('.' + name) || n.endsWith('/' + name)
        ),
        `tools/list should include ${name}; got ${[...names].join(', ')}`
      ).toBe(true);
    }

    // Add via MCP tool call.
    const addTaskName = Array.from(names).find(
      (n) => n === 'addTask' || n.endsWith('.addTask') || n.endsWith('/addTask')
    )!;
    const added = (await jsonrpc('tools/call', {
      name: addTaskName,
      arguments: { title: 'engineering review' },
    })) as { content: Array<{ text: string }>; structuredContent?: { id: string; title: string } };
    const task = added.structuredContent ?? JSON.parse(added.content[0].text);
    expect(task.title).toBe('engineering review');
  });

  it('Context 2: standalone @ui dashboard serves SPA + sibling chunks with COOP/COEP', async () => {
    const res = await fetch(`${BASE}/api/ui/dashboard`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(res.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    const html = await res.text();
    expect(html).toContain('todo-app dashboard');
    // The bridge is injected automatically by handleUIAssetRead — confirm
    // the standalone page can talk to the photon via window.photon.
    expect(html).toContain('window.photon');
  });

  it('Context 3a: @expose public auto-RPC at /api/<kebab>', async () => {
    // Add via the public auto-RPC endpoint. No Sec-Fetch-Site needed for
    // public routes; the dispatcher accepts anonymous callers.
    const add = await fetch(`${BASE}/api/add-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ title: 'rss subscriber added me' }),
    });
    expect(add.status).toBe(200);

    const list = await fetch(`${BASE}/api/list-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({}),
    });
    expect(list.status).toBe(200);
    const tasks = (await list.json()) as Array<{ title: string }>;
    expect(tasks.some((t) => t.title === 'rss subscriber added me')).toBe(true);
  });

  it('Context 3b: explicit @get /api/feed.rss returns valid RSS', async () => {
    const res = await fetch(`${BASE}/api/feed.rss`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/rss+xml');
    const xml = await res.text();
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<rss version="2.0">');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<title>todo-app feed</title>');
  });
});
