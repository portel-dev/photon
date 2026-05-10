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
import {
  ProgressNotificationSchema,
  type ProgressNotification,
} from '@modelcontextprotocol/sdk/types.js';

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
  const progressNotifications: ProgressNotification[] = [];

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

    client.setNotificationHandler(ProgressNotificationSchema, (n) => {
      progressNotifications.push(n);
    });

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

  it('tools/call returns actual result, not a notification', async () => {
    const result = await client.callTool({ name: 'imperative' }, undefined, {
      _meta: { progressToken: 'test-token-1' },
    } as any);

    // The result must be the return value of imperative() — { ok: true }
    expect(result.isError).toBeFalsy();
    const text = (result.content as any[])?.[0]?.text;
    expect(JSON.parse(text)).toEqual({ ok: true });
  });

  it('progress notifications arrive on the SSE stream', async () => {
    progressNotifications.length = 0;

    await client.callTool({ name: 'imperative' }, undefined, {
      _meta: { progressToken: 'test-token-2' },
    } as any);

    // Give the SSE stream a moment to deliver any queued notifications
    await new Promise((r) => setTimeout(r, 500));

    // this.status('working') and this.progress(0.5, 'halfway') should both arrive
    const messages = progressNotifications.map((n) => (n.params as any).message);
    expect(messages).toContain('working');
    expect(messages).toContain('halfway');
  });
});
