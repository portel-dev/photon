/**
 * Regression test: this.status() notifications must flow through the SSE stream,
 * not resolve the pending HTTP response.
 *
 * Prior to the fix, BeamCompatTransport.send() routed ALL outgoing messages
 * (including progress notifications) to pendingResponse. A this.status() call
 * inside a synchronous tool would cause the HTTP POST to return the notification
 * instead of the tool result, silently dropping the actual return value.
 *
 * This test verifies:
 *   1. The HTTP response for tools/call contains the actual tool result.
 *   2. Notifications/progress arrive on the SSE stream (not as the HTTP body).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ProgressNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const PHOTON_BIN = path.join(REPO, 'bin', 'photon');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'emit-helpers.photon.ts');

const PORT = 31000 + Math.floor(Math.random() * 4000);
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`;

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

describe.skipIf(SKIP)('BeamCompatTransport: status notifications route to SSE', () => {
  let server: ChildProcess;
  let client: Client;

  beforeAll(async () => {
    server = spawn(PHOTON_BIN, ['mcp', '--transport', 'sse', '--port', String(PORT), FIXTURE], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stderr?.on('data', (b) => {
      if (process.env.E2E_DEBUG) process.stderr.write(b);
    });
    await waitForPort(PORT);

    const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT));
    client = new Client({ name: 'beam-status-sse-test', version: '0.0.0' }, {});
    await client.connect(transport);

    // Give the transport time to establish its GET SSE stream.
    // StreamableHTTPClientTransport opens it asynchronously (fire-and-forget)
    // after the initialized handshake. Under load (full test suite), the
    // loopback round-trip still takes multiple event loop cycles.
    await new Promise((r) => setTimeout(r, 1500));
  }, 15_000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // ignore close errors during teardown
    }
    server?.kill();
  });

  it('tools/call returns actual result, not a notification', async () => {
    const result = await client.callTool({ name: 'imperative' });

    // The result must be the return value of imperative() — { ok: true }
    expect(result.isError).toBeFalsy();
    const text = (result.content as any[])?.[0]?.text;
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  it('progress notifications arrive on the SSE stream', async () => {
    const messages: string[] = [];
    client.setNotificationHandler(ProgressNotificationSchema, (notification) => {
      const message = notification.params?.message;
      if (message) messages.push(message);
    });

    await client.callTool({ name: 'imperative' });

    // Poll until both expected messages arrive or the deadline passes.
    // The SSE delivery is async relative to the POST response, so a fixed
    // sleep is unreliable under load — poll instead.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (messages.includes('working') && messages.includes('halfway')) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // this.status('working') and this.progress(0.5, 'halfway') should both arrive.
    expect(messages).toContain('working');
    expect(messages).toContain('halfway');
  }, 15_000);
});
