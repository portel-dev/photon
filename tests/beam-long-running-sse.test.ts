/**
 * Regression test: streamable HTTP must flush progress notifications from a
 * long-running generator tool before the tool has a final result.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { handleStreamableHTTP } from '../src/auto-ui/streamable-http-transport.js';

const PORT = 35000 + Math.floor(Math.random() * 4000);
const ENDPOINT = `http://127.0.0.1:${PORT}/mcp`;

async function rpc(
  sessionId: string | undefined,
  body: object,
  options?: { signal?: AbortSignal; accept?: string }
): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: options?.accept ?? 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

async function readFirstSseMessage(response: Response, timeoutMs = 2000): Promise<any> {
  if (!response.body) throw new Error('missing response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';

  while (Date.now() < deadline) {
    const read = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) =>
        setTimeout(() => reject(new Error('timeout waiting for SSE chunk')), 100)
      ),
    ]).catch(() => null);

    if (!read) continue;
    if (read.done) break;

    buffer += decoder.decode(read.value, { stream: true });
    const eventEnd = buffer.indexOf('\n\n');
    if (eventEnd === -1) continue;

    const rawEvent = buffer.slice(0, eventEnd);
    const dataLine = rawEvent
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('data:'));
    if (!dataLine) continue;

    return JSON.parse(dataLine.slice('data:'.length).trim());
  }

  throw new Error(`no SSE message within ${timeoutMs}ms; buffer=${buffer}`);
}

describe('streamable HTTP long-running tool progress', () => {
  let server: Server;

  beforeAll(async () => {
    const instance = {
      async *subscribe() {
        yield {
          emit: 'status',
          message: 'subscribed',
          data: { kind: 'intent', id: 'intent-1' },
        };

        await new Promise(() => {});
      },
    };

    server = createServer(async (req, res) => {
      const handled = await handleStreamableHTTP(req, res, {
        photons: [{ name: 'emit-helpers', configured: false, methods: [] } as any],
        photonMCPs: new Map([
          [
            'emit-helpers',
            {
              name: 'emit-helpers',
              instance,
              classConstructor: instance.constructor,
            } as any,
          ],
        ]),
        loadUIAsset: async () => null,
        broadcast: () => {},
        loader: {
          async executeTool(mcp: any, toolName: string, args: any, options?: any) {
            const generator = mcp.instance[toolName](args);

            while (true) {
              const { value, done } = await generator.next();
              if (done) return value;
              await options?.outputHandler?.(value);
            }
          },
        },
      } as any);

      if (!handled && !res.writableEnded) {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('flushes status notifications on the POST SSE stream before final result', async () => {
    const initResponse = await rpc(undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'long-running-sse-test', version: '0.0.0' },
      },
    });
    expect(initResponse.status).toBe(200);

    const sessionId = initResponse.headers.get('mcp-session-id') ?? undefined;
    expect(sessionId).toBeTruthy();

    await rpc(sessionId, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    const controller = new AbortController();
    const callResponse = await rpc(
      sessionId,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'emit-helpers/subscribe',
          arguments: {},
          _meta: { progressToken: 'subscribe-token' },
        },
      },
      { accept: 'text/event-stream', signal: controller.signal }
    );

    try {
      expect(callResponse.status).toBe(200);
      const message = await readFirstSseMessage(callResponse);
      expect(message).toMatchObject({
        jsonrpc: '2.0',
        method: 'notifications/progress',
        params: {
          progressToken: 'subscribe-token',
          message: 'subscribed',
          data: { kind: 'intent', id: 'intent-1' },
        },
      });
    } finally {
      controller.abort();
    }
  }, 10_000);
});
