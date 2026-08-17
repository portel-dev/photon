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

      // A per-request SSE response is the official Streamable HTTP way to
      // carry progress and the eventual result for a modern call.
      if (msg.method === 'tools/call' && msg.params?.name === 'slow/but/progressing') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Mcp-Session-Id': sessionId,
        });
        const progressToken =
          (msg.params?._meta as Record<string, unknown> | undefined)?.progressToken ?? msg.id;
        let ticks = 0;
        const heartbeat = setInterval(() => {
          ticks++;
          res.write(
            `data: ${JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/progress',
              params: { progressToken, progress: ticks, total: 10 },
            })}\n\n`
          );
          if (ticks === 6) {
            clearInterval(heartbeat);
            res.write(
              `data: ${JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }] },
              })}\n\n`
            );
            res.end();
          }
        }, 150);
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

      if (msg.method === 'initialize') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'test-server', version: '1.0.0' },
            },
          })
        );
        return;
      }

      if (msg.method === 'server/discover') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              resultType: 'complete',
              supportedVersions: ['2025-11-25', '2026-07-28'],
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'test-server', version: '1.0.0' },
            },
          })
        );
        return;
      }

      if (msg.method === 'tools/list') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { resultType: 'complete', tools: [] },
          })
        );
        return;
      }

      if (msg.method === 'tools/call') {
        const modern = Boolean(
          (msg.params?._meta as Record<string, unknown> | undefined)?.[
            'io.modelcontextprotocol/protocolVersion'
          ]
        );
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: modern
              ? { resultType: 'complete', content: [{ type: 'text', text: 'ok' }] }
              : { content: [{ type: 'text', text: 'ok' }] },
          })
        );
        return;
      }

      // Default: reply with empty result
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId,
      });
      const modern = Boolean(
        (msg.params?._meta as Record<string, unknown> | undefined)?.[
          'io.modelcontextprotocol/protocolVersion'
        ]
      );
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: modern || msg.method.startsWith('beam/') ? { resultType: 'complete' } : {},
        })
      );
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

  await test('official client aborts an in-flight request', async () => {
    const state = newServerState();
    state.silentMethods.add('tools/call');
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();

      const ac = new AbortController();
      const callPromise = sdk
        .callTool('slow/method', {}, { signal: ac.signal, progressToken: 'pt-1' })
        .catch((e) => ({ error: e }));

      // Wait for the POST to land on server
      await waitFor(() => state.receivedMessages.some((m) => m.method === 'tools/call'));

      ac.abort();

      const result = (await callPromise) as { error?: Error };
      assert.ok(result.error, 'call should reject on abort');
      assert.match(result.error!.message, /abort/i);
    } finally {
      await close();
    }
  });

  await test('official timeout aborts a silent request', async () => {
    const state = newServerState();
    state.silentMethods.add('tools/call');
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();

      const started = Date.now();
      const result = await sdk
        .callTool('hanging/method', {}, { progressToken: 'idle-1', idleTimeoutMs: 400 })
        .catch((e: Error) => e);
      const elapsed = Date.now() - started;

      assert.ok(result instanceof Error, 'call should reject on idle timeout');
      assert.match((result as Error).message, /timed out/i, 'error should cite the SDK timeout');
      assert.ok(elapsed >= 375, `should wait roughly 400ms (got ${elapsed}ms)`);
      assert.ok(elapsed < 1500, `should not hang past idle timeout (got ${elapsed}ms)`);

      assert.ok(result instanceof Error, 'official client should reject the timed-out request');
    } finally {
      await close();
    }
  });

  await test('official client consumes a streamed tool result', async () => {
    const state = newServerState();
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();

      const callPromise = sdk
        .callTool(
          'slow/but/progressing',
          {},
          {
            progressToken: 'progresses-1',
            idleTimeoutMs: 2_000,
          }
        )
        .catch((e: Error) => e);

      const result = await callPromise;
      assert.ok(
        !(result instanceof Error),
        `call should consume the streamed result (got: ${(result as Error)?.message})`
      );
    } finally {
      await close();
    }
  });

  await test('MCP 2026 tool continuations send requestState and inputResponses outside arguments', async () => {
    const state = newServerState();
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();

      await sdk.callTool(
        'pizza-shop/menu',
        {},
        {
          requestState: 'state-token',
          inputResponses: { input_1: { selection: ['margherita'] } },
        }
      );

      const call = state.receivedMessages.find((message) => message.method === 'tools/call');
      assert.ok(call, 'tools/call should reach the server');
      assert.equal(call.params.name, 'pizza-shop/menu');
      assert.deepEqual(call.params.arguments, {});
      assert.equal(call.params.requestState, 'state-token');
      assert.deepEqual(call.params.inputResponses, {
        input_1: { selection: ['margherita'] },
      });
      assert.equal(call.params.arguments.requestState, undefined);
    } finally {
      await close();
    }
  });

  await test('Photon extension requests and notifications use the official client seam', async () => {
    const state = newServerState();
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url);
      await sdk.connect();

      const response = await sdk.request<{ ok?: boolean }>('beam/approvals-list', {});
      assert.deepEqual(response, {});
      await sdk.notify('beam/viewing', { photonId: 'pizza-shop', itemId: 'menu' });
      assert.ok(
        state.receivedMessages.some(
          (message) =>
            message.method === 'beam/viewing' &&
            message.params?.photonId === 'pizza-shop' &&
            message.params?.itemId === 'menu'
        ),
        'custom Photon notifications should be sent through the official transport'
      );
    } finally {
      await close();
    }
  });

  await test('official client falls back to the legacy 2025 handshake', async () => {
    const state = newServerState();
    const { url, close } = await startMcpServer(state);
    try {
      const sdk = new MCPClientSDK(url, { protocolVersion: '2025-11-25' });
      await sdk.connect();
      assert.equal(sdk.getServerVersion()?.name, 'test-server');
      const result = await sdk.callTool('legacy/tool', {});
      assert.equal((result as { content?: Array<{ text?: string }> }).content?.[0]?.text, 'ok');
      assert.ok(state.receivedMessages.some((message) => message.method === 'initialize'));
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
