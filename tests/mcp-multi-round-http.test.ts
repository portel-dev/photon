import { strict as assert } from 'node:assert';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleStreamableHTTP } from '../dist/auto-ui/streamable-http-transport.js';

const MCP_VERSION = '2026-07-28';
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function modernMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'photon-mrtr-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

function tokenFor(subject: string): string {
  const segment = (value: unknown) =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${segment({ alg: 'none' })}.${segment({ sub: subject, iss: 'fixture' })}.signature`;
}

function headers(name: string, subject = 'caller-a'): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'Mcp-Protocol-Version': MCP_VERSION,
    'Mcp-Method': 'tools/call',
    'Mcp-Name': name,
    Authorization: `Bearer ${tokenFor(subject)}`,
  };
}

function call(
  id: string | number,
  name: string,
  args: Record<string, unknown>,
  retry: { requestState?: string; inputResponses?: Record<string, unknown> } = {}
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
      ...retry,
      _meta: modernMeta(),
    },
  };
}

function postJSON(
  port: number,
  body: Record<string, unknown>,
  requestHeaders: Record<string, string>
): Promise<{
  status: number;
  body: any;
  raw: string;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          ...requestHeaders,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          const data = String(response.headers['content-type']).includes('text/event-stream')
            ? raw
                .split(/\r?\n/u)
                .findLast((line) => line.startsWith('data: '))
                ?.slice(6)
            : raw;
          resolve({
            status: response.statusCode ?? 0,
            body: data ? JSON.parse(data) : null,
            raw,
            headers: response.headers,
          });
        });
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

function openLegacySSE(
  port: number,
  sessionId: string
): Promise<{
  nextMessage: () => Promise<any>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const queue: any[] = [];
    const waiters: Array<(value: any) => void> = [];
    let buffer = '';
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Mcp-Session-Id': sessionId,
        },
      },
      (response) => {
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buffer += chunk;
          while (buffer.includes('\n\n')) {
            const boundary = buffer.indexOf('\n\n');
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = event
              .split(/\r?\n/u)
              .find((line) => line.startsWith('data: '))
              ?.slice(6);
            if (!data) continue;
            const message = JSON.parse(data);
            const waiter = waiters.shift();
            if (waiter) waiter(message);
            else queue.push(message);
          }
        });
        response.on('error', reject);
        resolve({
          nextMessage: () => {
            const message = queue.shift();
            if (message) return Promise.resolve(message);
            return new Promise((next) => waiters.push(next));
          },
          close: () => {
            response.destroy();
            request.destroy();
          },
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}

function createContext(): any {
  const methods = [
    { name: 'ask', description: 'Ask for a name', params: { type: 'object', properties: {} } },
    {
      name: 'sample',
      description: 'Ask the client model',
      params: { type: 'object', properties: {} },
    },
    {
      name: 'sequence',
      description: 'Ask and then sample',
      params: { type: 'object', properties: {} },
    },
    {
      name: 'url',
      description: 'Perform URL elicitation',
      params: { type: 'object', properties: {} },
    },
    {
      name: 'destructive',
      description: 'Destructive fixture',
      destructiveHint: true,
      params: { type: 'object', properties: {} },
    },
  ];
  const instance = Object.fromEntries(methods.map((method) => [method.name, () => undefined]));
  return {
    photons: [
      {
        id: 'mrtr-id',
        name: 'mrtr',
        path: `${process.cwd()}/mrtr.photon.ts`,
        configured: true,
        methods,
      },
    ],
    photonMCPs: new Map([['mrtr', { instance }]]),
    externalMCPs: [],
    externalMCPClients: new Map(),
    externalMCPSDKClients: new Map(),
    reconnectExternalMCP: async () => ({ success: false }),
    loadUIAsset: async () => null,
    configurePhoton: async () => ({ success: false }),
    reloadPhoton: async () => ({ success: false }),
    removePhoton: async () => ({ success: false }),
    updateMetadata: () => undefined,
    generatePhotonHelp: () => '',
    loader: {
      executeTool: async (
        _mcp: unknown,
        toolName: string,
        _args: Record<string, unknown>,
        options: {
          inputProvider: (ask: Record<string, unknown>) => Promise<unknown>;
          samplingProvider: (params: Record<string, unknown>) => Promise<any>;
        }
      ) => {
        if (toolName === 'ask') {
          const name = await options.inputProvider({
            ask: 'text',
            id: 'profile',
            message: 'What is your name?',
          });
          return { name };
        }
        if (toolName === 'sample') {
          const sampled = await options.samplingProvider({
            messages: [{ role: 'user', content: { type: 'text', text: 'Draft a greeting' } }],
            maxTokens: 32,
          });
          return { sampled: sampled.content.text };
        }
        if (toolName === 'sequence') {
          const name = await options.inputProvider({
            ask: 'text',
            id: 'profile',
            message: 'What is your name?',
          });
          const sampled = await options.samplingProvider({
            messages: [{ role: 'user', content: { type: 'text', text: `Greet ${String(name)}` } }],
            maxTokens: 32,
          });
          return { name, sampled: sampled.content.text };
        }
        if (toolName === 'url') {
          const accepted = await options.inputProvider({
            mode: 'url',
            message: 'Authenticate',
            url: 'https://example.test/oauth',
          });
          return { accepted };
        }
        return { executed: toolName };
      },
    },
    broadcast: () => undefined,
    workingDir: process.cwd(),
    verifyBearerToken: async (token: string) => {
      try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        return { ok: true, claims: { sub: payload.sub, iss: payload.iss } };
      } catch {
        return { ok: false, reason: 'invalid test token' };
      }
    },
  };
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const context = createContext();
  const stateDir = mkdtempSync(join(tmpdir(), 'photon-multi-round-http-'));
  context.workingDir = stateDir;
  const server = http.createServer(async (request, response) => {
    const handled = await handleStreamableHTTP(request, response, context);
    if (!handled) response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(stateDir, { recursive: true, force: true });
  }
}

console.log('MCP 2026 multi-round HTTP:');

await withServer(async (port) => {
  await test('yield-style elicitation returns canonical input_required and completes', async () => {
    const first = await postJSON(port, call(1, 'mrtr.ask', {}), headers('mrtr.ask'));
    assert.equal(first.status, 200);
    assert.equal(first.body.result.resultType, 'input_required');
    assert.deepEqual(first.body.result.inputRequests.profile, {
      method: 'elicitation/create',
      params: {
        mode: 'form',
        message: 'What is your name?',
        requestedSchema: {
          type: 'object',
          properties: {
            value: {
              type: 'string',
              title: 'Input',
              description: 'What is your name?',
            },
          },
          required: ['value'],
        },
      },
    });
    const completed = await postJSON(
      port,
      call(
        2,
        'mrtr.ask',
        {},
        {
          requestState: first.body.result.requestState,
          inputResponses: {
            profile: { action: 'accept', content: { value: 'Ada' } },
          },
        }
      ),
      headers('mrtr.ask')
    );
    assert.equal(completed.status, 200);
    assert.equal(completed.body.result.resultType, 'complete');
    assert.match(completed.body.result.content[0].text, /Ada/);
  });

  await test('state is bound to caller and canonical original arguments', async () => {
    const first = await postJSON(port, call('bind-1', 'mrtr.ask', {}), headers('mrtr.ask'));
    const state = first.body.result.requestState;
    const wrongCaller = await postJSON(
      port,
      call(
        'bind-2',
        'mrtr.ask',
        {},
        {
          requestState: state,
          inputResponses: { profile: { action: 'cancel' } },
        }
      ),
      headers('mrtr.ask', 'caller-b')
    );
    assert.equal(wrongCaller.status, 400);
    assert.equal(wrongCaller.body.error.code, -32602);

    const wrongArgs = await postJSON(
      port,
      call(
        'bind-3',
        'mrtr.ask',
        { changed: true },
        {
          requestState: state,
          inputResponses: { profile: { action: 'cancel' } },
        }
      ),
      headers('mrtr.ask')
    );
    assert.equal(wrongArgs.status, 400);
    assert.equal(wrongArgs.body.error.code, -32602);

    const completed = await postJSON(
      port,
      call(
        'bind-4',
        'mrtr.ask',
        {},
        {
          requestState: state,
          inputResponses: { profile: { action: 'accept', content: { value: 'Grace' } } },
        }
      ),
      headers('mrtr.ask')
    );
    assert.equal(completed.body.result.resultType, 'complete');
  });

  await test('same-id retries and consumed state replay are rejected', async () => {
    const first = await postJSON(port, call('replay', 'mrtr.ask', {}), headers('mrtr.ask'));
    const state = first.body.result.requestState;
    const sameId = await postJSON(
      port,
      call(
        'replay',
        'mrtr.ask',
        {},
        {
          requestState: state,
          inputResponses: { profile: { action: 'decline' } },
        }
      ),
      headers('mrtr.ask')
    );
    assert.equal(sameId.status, 400);
    const completed = await postJSON(
      port,
      call(
        'replay-fresh',
        'mrtr.ask',
        {},
        {
          requestState: state,
          inputResponses: { profile: { action: 'decline' } },
        }
      ),
      headers('mrtr.ask')
    );
    assert.equal(completed.body.result.resultType, 'complete');
    const replayed = await postJSON(
      port,
      call(
        'replay-again',
        'mrtr.ask',
        {},
        {
          requestState: state,
          inputResponses: { profile: { action: 'decline' } },
        }
      ),
      headers('mrtr.ask')
    );
    assert.equal(replayed.status, 400);
  });

  await test('sampling is carried as an in-band sampling/createMessage request', async () => {
    const first = await postJSON(port, call(10, 'mrtr.sample', {}), headers('mrtr.sample'));
    const [key] = Object.keys(first.body.result.inputRequests);
    assert.equal(first.body.result.inputRequests[key].method, 'sampling/createMessage');
    const completed = await postJSON(
      port,
      call(
        11,
        'mrtr.sample',
        {},
        {
          requestState: first.body.result.requestState,
          inputResponses: {
            [key]: {
              role: 'assistant',
              content: { type: 'text', text: 'Hello from the model' },
              model: 'fixture',
              stopReason: 'endTurn',
            },
          },
        }
      ),
      headers('mrtr.sample')
    );
    assert.equal(completed.body.result.resultType, 'complete');
    assert.match(completed.body.result.content[0].text, /Hello from the model/);
  });

  await test('sequential form and sampling rounds rotate requestState', async () => {
    const first = await postJSON(port, call(20, 'mrtr.sequence', {}), headers('mrtr.sequence'));
    const second = await postJSON(
      port,
      call(
        21,
        'mrtr.sequence',
        {},
        {
          requestState: first.body.result.requestState,
          inputResponses: {
            profile: { action: 'accept', content: { value: 'Lin' } },
          },
        }
      ),
      headers('mrtr.sequence')
    );
    assert.equal(second.body.result.resultType, 'input_required');
    assert.notEqual(second.body.result.requestState, first.body.result.requestState);
    const [samplingKey] = Object.keys(second.body.result.inputRequests);
    const completed = await postJSON(
      port,
      call(
        22,
        'mrtr.sequence',
        {},
        {
          requestState: second.body.result.requestState,
          inputResponses: {
            [samplingKey]: {
              role: 'assistant',
              content: { type: 'text', text: 'Hi Lin' },
              model: 'fixture',
            },
          },
        }
      ),
      headers('mrtr.sequence')
    );
    assert.equal(completed.body.result.resultType, 'complete');
    assert.match(completed.body.result.content[0].text, /Hi Lin/);
  });

  await test('URL elicitation uses the canonical URL request and accepts no-content response', async () => {
    const first = await postJSON(port, call(30, 'mrtr.url', {}), headers('mrtr.url'));
    const [key] = Object.keys(first.body.result.inputRequests);
    assert.deepEqual(first.body.result.inputRequests[key], {
      method: 'elicitation/create',
      params: {
        mode: 'url',
        message: 'Authenticate',
        url: 'https://example.test/oauth',
      },
    });
    const completed = await postJSON(
      port,
      call(
        31,
        'mrtr.url',
        {},
        {
          requestState: first.body.result.requestState,
          inputResponses: { [key]: { action: 'accept' } },
        }
      ),
      headers('mrtr.url')
    );
    assert.equal(completed.body.result.resultType, 'complete');
    assert.match(completed.body.result.content[0].text, /true/);
  });

  await test('destructive hints use the same stateless confirmation model', async () => {
    const first = await postJSON(
      port,
      call(40, 'mrtr.destructive', {}),
      headers('mrtr.destructive')
    );
    assert.equal(first.body.result.resultType, 'input_required');
    assert.equal(first.body.result.inputRequests.confirm.method, 'elicitation/create');
    const completed = await postJSON(
      port,
      call(
        41,
        'mrtr.destructive',
        {},
        {
          requestState: first.body.result.requestState,
          inputResponses: {
            confirm: { action: 'accept', content: { confirmed: true } },
          },
        }
      ),
      headers('mrtr.destructive')
    );
    assert.equal(completed.body.result.resultType, 'complete');
    assert.match(completed.body.result.content[0].text, /destructive/);
  });

  await test('MCP 2025 keeps session-bound elicitation and sampling', async () => {
    const legacyHeaders = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    const initialized = await postJSON(
      port,
      {
        jsonrpc: '2.0',
        id: 'legacy-init',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          clientInfo: { name: 'legacy-fixture', version: '1.0.0' },
          capabilities: { elicitation: { form: {} }, sampling: {} },
        },
      },
      legacyHeaders
    );
    const sessionId = String(initialized.headers['mcp-session-id'] || '');
    assert(sessionId);
    const stream = await openLegacySSE(port, sessionId);
    try {
      const callPromise = postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'legacy-call',
          method: 'tools/call',
          params: { name: 'mrtr.ask', arguments: {} },
        },
        {
          ...legacyHeaders,
          'Mcp-Session-Id': sessionId,
        }
      );
      const elicitation = await stream.nextMessage();
      assert.equal(elicitation.method, 'elicitation/create');
      assert.equal(elicitation.params.message, 'What is your name?');
      const reply = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: elicitation.id,
          result: { action: 'accept', content: { value: 'Legacy Ada' } },
        },
        {
          ...legacyHeaders,
          'Mcp-Session-Id': sessionId,
        }
      );
      assert.equal(reply.status, 202);
      const completed = await callPromise;
      assert.equal(completed.status, 200);
      assert.equal(completed.body.result.resultType, undefined);
      assert.match(completed.body.result.content[0].text, /Legacy Ada/);

      const samplePromise = postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'legacy-sample',
          method: 'tools/call',
          params: { name: 'mrtr.sample', arguments: {} },
        },
        {
          ...legacyHeaders,
          'Mcp-Session-Id': sessionId,
        }
      );
      const sampling = await stream.nextMessage();
      assert.equal(sampling.method, 'sampling/createMessage');
      await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: sampling.id,
          result: {
            role: 'assistant',
            content: { type: 'text', text: 'Legacy model answer' },
            model: 'legacy-fixture',
            stopReason: 'endTurn',
          },
        },
        {
          ...legacyHeaders,
          'Mcp-Session-Id': sessionId,
        }
      );
      const sampled = await samplePromise;
      assert.equal(sampled.body.result.resultType, undefined);
      assert.match(sampled.body.result.content[0].text, /Legacy model answer/);
    } finally {
      stream.close();
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
