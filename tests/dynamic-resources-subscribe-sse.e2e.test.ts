/**
 * End-to-end SSE / streamable-HTTP drive of resources/subscribe.
 *
 * Spawns the dev `photon mcp --transport sse` against
 * `examples/dynamic-resources.photon.ts`, connects via the SDK's
 * StreamableHTTPClientTransport (so this test speaks the same dialect
 * Claude Desktop and other modern MCP clients use), and pins:
 *
 *   1. resources/subscribe is acknowledged by the server.
 *   2. tools/call upsertPerson fires `notifications/resources/updated`
 *      with the subscribed URI.
 *   3. resources/unsubscribe stops further notifications for that URI.
 *
 * STDIO is covered by the unit test
 * `tests/dynamic-resources-subscribe.test.ts`. This file is the parity
 * gate: if a streamable-HTTP wiring regression slips in, this fails.
 *
 * Skipped under CI=true unless RUN_E2E=1 — spinning up a child photon
 * server makes the test environment-sensitive in a way the rest of the
 * suite is not. Locally it runs by default.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  ResourceUpdatedNotificationSchema,
  type ResourceUpdatedNotification,
} from '@modelcontextprotocol/sdk/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
// Use a dedicated non-`@stateful` fixture: the daemon-routed path the
// stateful example takes is exercised elsewhere and would obscure failures
// in the wire-level subscribe/notify test.
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'dynamic-resources-e2e.photon.ts');

// Pick a high random port for each run. Vitest runs files in parallel
// workers, so a deterministic port (process.pid mod N) collides when two
// files in the same worker happen to schedule the spawn at the same
// time. Random + a five-digit range is good enough for local + CI.
const PORT = 30000 + Math.floor(Math.random() * 30000);
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`;

const SKIP = process.env.CI === 'true' && process.env.RUN_E2E !== '1';

async function waitForPort(port: number, timeoutMs = 8000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
      // Any HTTP response (even 4xx) means the server is listening.
      if (res.status > 0) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start on port ${port} within ${timeoutMs}ms`);
}

describe.skipIf(SKIP)('streamable-HTTP e2e: resources/subscribe', () => {
  let server: ChildProcess;
  let client: Client;

  beforeAll(async () => {
    server = spawn(PHOTON_BIN, ['mcp', '--transport', 'sse', '--port', String(PORT), FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Surface server errors when something goes wrong locally.
    server.stderr?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stderr.write(b);
    });
    server.stdout?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stdout.write(b);
    });
    await waitForPort(PORT);

    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));
    client = new Client({ name: 'subscribe-e2e', version: '0.0.0' }, {});
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

  it('subscribe → mutate → notification fires; unsubscribe → silent', async () => {
    const slug = 'eve';
    const uri = `person://${slug}`;
    const notifications: ResourceUpdatedNotification[] = [];
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      notifications.push(n);
    });

    // 1. subscribe is acknowledged
    await client.subscribeResource({ uri });

    // 2. mutate via tool call → expect one notification for the subscribed URI
    await client.callTool({
      name: 'upsertPerson',
      arguments: { slug, name: 'Eve', role: 'Eng' },
    });

    // Allow a short window for the SSE notification to deliver.
    await new Promise((r) => setTimeout(r, 250));
    const fired = notifications.filter((n) => n.params.uri === uri);
    expect(fired.length).toBe(1);

    // 3. unsubscribe → mutating again should not fire another notification
    notifications.length = 0;
    await client.unsubscribeResource({ uri });
    await client.callTool({
      name: 'upsertPerson',
      arguments: { slug, name: 'Eve W.', role: 'CTO' },
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(notifications.filter((n) => n.params.uri === uri).length).toBe(0);
  }, 10_000);
});
