/**
 * Standalone HTTP server: per-claim instance pool (Track C closure).
 *
 * Plan reference: server-provided-what-a-reactive-globe.md → Track C.
 *
 * Without this routing, two authenticated callers hitting the standalone
 * `photon mcp --transport sse` server share `this.mcp.instance` — alice
 * and bob would race on the same `this.tasks`. The runtime now reads
 * the cf-access auth headers, derives a bound instance name via
 * `resolveInstanceFromClaims`, and lazy-loads a fresh photon per claim.
 *
 * The fixture is `@stateful` + `@auth cf-access` (the minimum shape
 * that opts into per-caller state). Plain `@stateful` photons with no
 * `@auth` keep their v1.28 single-instance behavior — covered by the
 * regression suite, not retested here.
 *
 * Skipped under CI=true unless RUN_E2E=1 (spawns a real photon process).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'multi-tenant.photon.ts');

const PORT = 31000 + Math.floor(Math.random() * 30000);
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

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  asEmail: string | null
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  // Cloudflare Access populates this header at the edge after JWT
  // verification; the runtime treats its presence as ground truth.
  if (asEmail) headers['cf-access-authenticated-user-email'] = asEmail;
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.random().toString(36).slice(2),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const env = (await res.json()) as { result?: any; error?: { message: string } };
  if (env.error) throw new Error(env.error.message);
  // The result body is wrapped in MCP's content-array. The fixture's
  // structuredContent gives us the typed return directly.
  return env.result?.structuredContent ?? JSON.parse(env.result?.content?.[0]?.text ?? 'null');
}

async function getToolName(asEmail: string, baseName: string): Promise<string> {
  // The standalone server prefixes tool names with the photon ID
  // (`multi-tenant/addTask`). Discover the prefix once so the test
  // doesn't have to hard-code it.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'cf-access-authenticated-user-email': asEmail,
  };
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'list',
      method: 'tools/list',
      params: {},
    }),
  });
  const env = (await res.json()) as { result?: { tools: Array<{ name: string }> } };
  const tool = env.result?.tools.find(
    (t) => t.name === baseName || t.name.endsWith('/' + baseName)
  );
  if (!tool) throw new Error(`tool ${baseName} not found in tools/list`);
  return tool.name;
}

describe.skipIf(SKIP)('standalone HTTP server — per-claim instance pool', () => {
  let server: ChildProcess;
  let addTaskName: string;
  let listTasksName: string;

  beforeAll(async () => {
    server = spawn(PHOTON_BIN, ['mcp', '--transport', 'sse', '--port', String(PORT), FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stderr.write(b);
    });
    await waitForPort(PORT);
    addTaskName = await getToolName('alice@example.com', 'addTask');
    listTasksName = await getToolName('alice@example.com', 'listTasks');
  }, 15_000);

  afterAll(() => {
    server?.kill();
  });

  it('alice and bob land on disjoint instances', async () => {
    // Alice adds two tasks; Bob adds one. Each should see only their own.
    await callTool(addTaskName, { title: 'alice-1' }, 'alice@example.com');
    await callTool(addTaskName, { title: 'alice-2' }, 'alice@example.com');
    await callTool(addTaskName, { title: 'bob-1' }, 'bob@example.com');

    const aliceList = (await callTool(listTasksName, {}, 'alice@example.com')) as string[];
    const bobList = (await callTool(listTasksName, {}, 'bob@example.com')) as string[];

    expect(aliceList).toEqual(['alice-1', 'alice-2']);
    expect(bobList).toEqual(['bob-1']);
  });

  it('a third caller (carol) starts with empty state', async () => {
    // Lazy-loading: carol's instance must not exist until her first
    // request. After that first request, her tasks should be empty
    // (her own scope), not whatever alice/bob left behind.
    const carolList = (await callTool(listTasksName, {}, 'carol@example.com')) as string[];
    expect(carolList).toEqual([]);
  });

  it('repeat calls from alice keep accumulating on her instance', async () => {
    // The pool reuses cached instances — a second request from alice
    // should see her prior state, not load a fresh empty instance.
    const before = (await callTool(listTasksName, {}, 'alice@example.com')) as string[];
    await callTool(addTaskName, { title: 'alice-3' }, 'alice@example.com');
    const after = (await callTool(listTasksName, {}, 'alice@example.com')) as string[];
    expect(after.length).toBe(before.length + 1);
    expect(after[after.length - 1]).toBe('alice-3');
  });

  it('@expose HTTP routes also isolate by claim (codex-flagged regression)', async () => {
    // Same isolation contract via /api/<kebab>. Without the dispatcher's
    // resolveInstanceMcp call, alice's POST /api/expose-add-task would
    // share state with bob's. Use a fresh user pair so we don't pollute
    // the alice/bob/carol instances above.
    const aliceCount = (await fetch(`${BASE}/api/expose-add-task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-access-authenticated-user-email': 'dave@example.com',
      },
      body: JSON.stringify({ title: 'dave-spa' }),
    }).then((r) => r.json())) as { count: number };
    expect(aliceCount.count).toBe(1);

    const eveList = (await fetch(`${BASE}/api/expose-list-tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-access-authenticated-user-email': 'eve@example.com',
      },
      body: JSON.stringify({}),
    }).then((r) => r.json())) as string[];
    expect(eveList).toEqual([]);

    const daveList = (await fetch(`${BASE}/api/expose-list-tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-access-authenticated-user-email': 'dave@example.com',
      },
      body: JSON.stringify({}),
    }).then((r) => r.json())) as string[];
    expect(daveList).toEqual(['dave-spa']);
  });

  it('a request without auth headers falls back to the default instance', async () => {
    // Backward-compat: an anonymous request shouldn't 500 — it lands on
    // the shared default instance, the same way a v1.28 photon ran.
    // The exact contents don't matter; the request must succeed and
    // return a list (possibly empty, possibly populated by other test
    // runs hitting the default).
    const list = await callTool(listTasksName, {}, null);
    expect(Array.isArray(list)).toBe(true);
  });
});
