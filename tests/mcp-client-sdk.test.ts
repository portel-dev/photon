/**
 * MCP Client SDK Tests
 *
 * Verifies the two safety-net features of MCPClientSDK that the
 * SDK-based migration is supposed to deliver:
 *
 *   1. AbortSignal → notifications/cancelled arrives at the server
 *      (proves tab-reload during a long method actually cancels the
 *      request on the server side).
 *   2. Idle-reset timeout — when the server stays silent longer than
 *      the configured idleTimeoutMs without a matching progress event,
 *      the request rejects with a timeout error and a
 *      notifications/cancelled is emitted.
 *   3. Idle timer reset — when progress notifications DO arrive with
 *      the matching progressToken, the idle timer resets, so a
 *      long-running but actively-progressing request does not abort.
 *
 * Drives MCPClientSDK directly against a local Node HTTP server that
 * speaks Streamable HTTP (POST for requests, SSE for the GET stream).
 * No browser, no Beam — pure protocol-level verification.
 */

import { strict as assert } from 'assert';
import http from 'http';
import { AddressInfo } from 'net';

// Dynamic import so this test runs without TS transpile of mcp-client-sdk.ts.
// The bundled prototype re-exports from src/; we point at the source here.
import { MCPClientSDK } from '../src/auto-ui/frontend/services/mcp-client-sdk.js';

interface ServerState {
  sessions: Map<string, { sseRes?: http.ServerResponse }>;
  /** Messages received on POST (for assertions). */
  receivedMessages: any[];
  /** Requests the server should ignore (not respond to, not broadcast). */
  silentMethods: Set<string>;
  /** For each incoming request, an optional async handler to produce a response. */
  responders: Map<string, (msg: any) => Promise<any> | any>;
}

function newServerState(): ServerState {
  return {
    sessions: new Map(),
    receivedMessages: [],
    silentMethods: new Set(),
    responders: new Map(),
  };
}

function startMcpServer(state: ServerState): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    // CORS preflight or unrelated
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const sessionId = (req.headers['mcp-session-id'] as string) || 'default';
    let session = state.sessions.get(sessionId);
    if (!session) {
      session = {};
      state.sessions.set(sessionId, session);
    }

    if (req.method === 'GET') {
      // Open SSE stream
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Mcp-Session-Id': sessionId,
      });
      res.write(': ready\n\n');
      session.sseRes = res;
      req.on('close', () => {
        if (session) session.sseRes = undefined;
      });
      return;
    }

    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks).toString('utf8');
      let msg: any;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end('bad json');
        return;
      }
      state.receivedMessages.push(msg);

      // Notification (no id)
      if (!('id' in msg)) {
        res.writeHead(202, { 'Mcp-Session-Id': sessionId });
        res.end();
        return;
      }

      // Silent method — don't respond at all (simulates stuck tool call).
      if (state.silentMethods.has(msg.method)) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Mcp-Session-Id': sessionId,
        });
        // Keep the connection open indefinitely; never write a response.
        // The test will abort the client side before this resolves.
        return;
      }

      const responder = state.responders.get(msg.method);
      if (responder) {
        const result = await responder(msg);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
        return;
      }

      // Default: reply with empty result
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }));
      return;
    }

    res.writeHead(405);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${addr.port}/mcp`,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

function sendProgress(
  state: ServerState,
  sessionId: string,
  progressToken: string | number,
  message = ''
): void {
  for (const s of state.sessions.values()) {
    if (!s.sseRes || s.sseRes.writableEnded) continue;
    s.sseRes.write(
      `data: ${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: { progressToken, progress: 0, total: 100, message },
      })}\n\n`
    );
  }
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err?.message || err}`);
    if (err?.stack) console.log(err.stack.split('\n').slice(1, 4).join('\n'));
  }
}

async function waitFor(pred: () => boolean, timeoutMs = 2000, stepMs = 25): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

async function run(): Promise<void> {
  console.log('\nMCPClientSDK tests\n');

  await test('AbortSignal → notifications/cancelled is sent to server', async () => {
    const state = newServerState();
    state.silentMethods.add('tools/call');
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();
      // Kick the GET SSE stream open by sending notifications/initialized.
      await sdk.notify('notifications/initialized');

      const ac = new AbortController();
      const callPromise = sdk
        .callTool('slow/method', {}, { signal: ac.signal, progressToken: 'pt-1' })
        .catch((e) => ({ error: e }));

      // Wait for the POST to land on server
      await waitFor(() => state.receivedMessages.some((m) => m.method === 'tools/call'));

      ac.abort();

      const result = (await callPromise) as { error?: Error };
      assert.ok(result.error, 'call should reject on abort');

      // After abort, client should POST notifications/cancelled with matching requestId
      await waitFor(
        () => state.receivedMessages.some((m) => m.method === 'notifications/cancelled'),
        3000
      );
      const cancelMsg = state.receivedMessages.find((m) => m.method === 'notifications/cancelled');
      assert.ok(cancelMsg, 'server must receive notifications/cancelled');
      assert.equal(
        cancelMsg.params.reason,
        'client-abort',
        'cancellation reason should be client-abort'
      );
    } finally {
      await close();
    }
  });

  await test('idle-reset timeout aborts request and notifies server', async () => {
    const state = newServerState();
    state.silentMethods.add('tools/call');
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();
      await sdk.notify('notifications/initialized');

      const started = Date.now();
      const result = await sdk
        .callTool('hanging/method', {}, { progressToken: 'idle-1', idleTimeoutMs: 400 })
        .catch((e: Error) => e);
      const elapsed = Date.now() - started;

      assert.ok(result instanceof Error, 'call should reject on idle timeout');
      assert.match(
        (result as Error).message,
        /timed out after 400ms of no progress/,
        'error should cite no-progress timeout'
      );
      assert.ok(elapsed >= 400, `should wait at least 400ms (got ${elapsed}ms)`);
      assert.ok(elapsed < 1500, `should not hang past idle timeout (got ${elapsed}ms)`);

      // Server should receive a notifications/cancelled with reason='idle-timeout'
      await waitFor(
        () =>
          state.receivedMessages.some(
            (m) => m.method === 'notifications/cancelled' && m.params?.reason === 'idle-timeout'
          ),
        1500
      );
    } finally {
      await close();
    }
  });

  await test('progress notifications reset the idle timer', async () => {
    const state = newServerState();
    state.silentMethods.add('tools/call');
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();
      await sdk.notify('notifications/initialized');

      const callPromise = sdk
        .callTool('slow/but/progressing', {}, { progressToken: 'progresses-1', idleTimeoutMs: 300 })
        .catch((e: Error) => e);

      // Wait for POST to land so the server knows about the call.
      await waitFor(() => state.receivedMessages.some((m) => m.method === 'tools/call'));

      // Fire a progress event every 150ms (below the 300ms idle window)
      // for 1s total. Idle timer should reset each time and never fire.
      const heartbeat = setInterval(() => {
        for (const sid of state.sessions.keys()) {
          sendProgress(state, sid, 'progresses-1', 'tick');
        }
      }, 150);
      await new Promise((r) => setTimeout(r, 1000));
      clearInterval(heartbeat);

      // Now let the server respond so the call completes normally.
      for (const s of state.sessions.values()) {
        if (s.sseRes && !s.sseRes.writableEnded) {
          // Find the pending tools/call id
          const callMsg = state.receivedMessages.find((m) => m.method === 'tools/call');
          s.sseRes.write(
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              id: callMsg.id,
              result: { content: [{ type: 'text', text: 'ok' }] },
            })}\n\n`
          );
        }
      }

      const result = await callPromise;
      assert.ok(
        !(result instanceof Error),
        `call should NOT time out while progress is streaming (got: ${(result as Error)?.message})`
      );
    } finally {
      await close();
    }
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  // Force exit — the SDK transport keeps an AbortController handle
  // alive until explicit disconnect; we want the test to end cleanly.
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
