import { strict as assert } from 'node:assert';
import http from 'node:http';
import { handleStreamableHTTP } from '../dist/auto-ui/streamable-http-transport.js';
import { PHOTON_TOOL_ERROR_META_KEY } from '../dist/mcp/protocol/tool-errors.js';

const MCP_VERSION = '2026-07-28';
const TRACEPARENT = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(error);
  }
}

function modernMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'photon-error-test', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {
      extensions: { 'dev.portel.photon': {} },
    },
    ...overrides,
  };
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': MCP_VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
  };
}

function postRaw(
  port: number,
  payload: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body, headers: response.headers })
        );
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

async function postJSON(
  port: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; raw: string }> {
  const response = await postRaw(port, JSON.stringify(body), headers);
  const contentType = String(response.headers['content-type'] || '');
  const payload = contentType.includes('text/event-stream')
    ? response.body
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .at(-1)
    : response.body;
  return {
    status: response.status,
    body: payload ? JSON.parse(payload) : null,
    raw: response.body,
  };
}

function createContext(): any {
  const methods = [
    {
      name: 'echo',
      description: 'Echo a count',
      params: {
        type: 'object',
        required: ['count'],
        additionalProperties: false,
        properties: { count: { type: 'integer', minimum: 1 } },
      },
      returns: { type: 'object' },
    },
    {
      name: 'fail',
      description: 'Return a business failure',
      params: {
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string' } },
      },
      returns: { type: 'object' },
    },
  ];
  return {
    photons: [
      {
        id: 'errors-id',
        name: 'errors',
        path: `${process.cwd()}/errors.photon.ts`,
        configured: true,
        methods,
      },
    ],
    photonMCPs: new Map([
      [
        'errors',
        {
          instance: {
            echo: ({ count }: { count: number }) => ({ count }),
            fail: () => {
              const error = new Error(
                'Business failed password=TOP_SECRET_MESSAGE Authorization: Bearer abcdefghijklmnopqrstuvwxyz'
              );
              error.stack += '\n    at /private/workspace/secret-tool.ts:1:1';
              throw error;
            },
          },
        },
      ],
    ]),
    externalMCPs: [
      {
        id: 'external-id',
        name: 'upstream',
        connected: true,
        methods: [
          {
            name: 'reported',
            description: 'Reports an upstream error result',
            params: { type: 'object', properties: {} },
            returns: {},
          },
          {
            name: 'throws',
            description: 'Throws an upstream transport failure',
            params: { type: 'object', properties: {} },
            returns: {},
          },
        ],
      },
    ],
    externalMCPClients: new Map(),
    externalMCPSDKClients: new Map([
      [
        'upstream',
        {
          callTool: async ({ name }: { name: string }) => {
            if (name === 'throws') {
              throw new Error(
                'upstream password=EXTERNAL_SECRET Bearer zyxwvutsrqponmlkjihgfedcba'
              );
            }
            return {
              content: [{ type: 'text', text: 'Upstream rejected the operation' }],
              structuredContent: { reason: 'upstream-policy' },
              isError: true,
              _meta: { upstream: 'preserved' },
            };
          },
        },
      ],
    ]),
    reconnectExternalMCP: async () => ({ success: false }),
    loadUIAsset: async (_photonName: string, uiId: string) => {
      if (uiId === 'panel') {
        throw new Error('render failed password=RESOURCE_SECRET');
      }
      return null;
    },
    configurePhoton: async () => ({ success: false }),
    reloadPhoton: async () => ({ success: false }),
    removePhoton: async () => ({ success: false }),
    updateMetadata: () => undefined,
    generatePhotonHelp: () => '',
    loader: undefined,
    broadcast: () => undefined,
    workingDir: process.cwd(),
  };
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const context = createContext();
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
  }
}

async function main(): Promise<void> {
  console.log('\nMCP error semantics:');

  await withServer(async (port) => {
    await test('separates HTTP, parse, dispatch, and protocol parameter failures', async () => {
      const unsupportedMedia = await postRaw(port, '{}', {
        'Content-Type': 'text/plain',
        'Mcp-Protocol-Version': MCP_VERSION,
      });
      assert.equal(unsupportedMedia.status, 415);

      const parse = await postRaw(port, '{"jsonrpc":');
      assert.equal(parse.status, 400);
      assert.equal(JSON.parse(parse.body).error.code, -32700);

      const unknownMethod = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'unknown-method',
          method: 'unknown/method',
          params: { _meta: modernMeta() },
        },
        modernHeaders('unknown/method')
      );
      assert.equal(unknownMethod.status, 404);
      assert.equal(unknownMethod.body.error.code, -32601);

      const malformedCall = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'malformed-call',
          method: 'tools/call',
          params: { name: '', arguments: [], _meta: modernMeta() },
        },
        modernHeaders('tools/call')
      );
      assert.equal(malformedCall.status, 400);
      assert.equal(malformedCall.body.error.code, -32602);
    });

    await test('uses modern Invalid Params for unknown tools and preserves legacy result errors', async () => {
      const modern = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'unknown-modern',
          method: 'tools/call',
          params: {
            name: 'errors.missing',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', 'errors.missing')
      );
      assert.equal(modern.status, 400);
      assert.equal(modern.body.error.code, -32602);
      assert.match(modern.body.error.message, /Unknown tool/);

      const legacy = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'unknown-legacy',
        method: 'tools/call',
        params: { name: 'errors.missing', arguments: {} },
      });
      assert.equal(legacy.status, 200);
      assert.equal(legacy.body.result.isError, true);
      assert.equal(legacy.body.result.resultType, undefined);
      assert.equal(
        legacy.body.result._meta[PHOTON_TOOL_ERROR_META_KEY].code,
        'PHOTON_TOOL_INPUT_INVALID'
      );
    });

    await test('returns correctable tool-input failures and permits a new-id retry', async () => {
      const invalid = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'input-invalid',
          method: 'tools/call',
          params: {
            name: 'errors.echo',
            arguments: { count: 0 },
            _meta: modernMeta({ traceparent: TRACEPARENT }),
          },
        },
        modernHeaders('tools/call', 'errors.echo')
      );
      assert.equal(invalid.status, 200);
      assert.equal(invalid.body.result.isError, true);
      assert.equal(invalid.body.result.resultType, 'complete');
      const descriptor = invalid.body.result._meta[PHOTON_TOOL_ERROR_META_KEY];
      assert.equal(descriptor.code, 'PHOTON_TOOL_INPUT_INVALID');
      assert.equal(descriptor.category, 'tool_input');
      assert.equal(descriptor.retryable, false);
      assert.equal(descriptor.correlationId, 'input-invalid');
      assert.equal(descriptor.traceparent, TRACEPARENT);

      const corrected = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'input-corrected',
          method: 'tools/call',
          params: {
            name: 'errors.echo',
            arguments: { count: 2 },
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', 'errors.echo')
      );
      assert.equal(corrected.status, 200);
      assert.equal(corrected.body.result.isError, false);
      assert.match(corrected.body.result.content[0].text, /2/);

      const unsafeTrace = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'input-unsafe-trace',
          method: 'tools/call',
          params: {
            name: 'errors.echo',
            arguments: { count: 0 },
            _meta: modernMeta({
              traceparent: '00-00000000000000000000000000000000-0000000000000000-01',
              baggage: 'password=BAGGAGE_SECRET',
            }),
          },
        },
        modernHeaders('tools/call', 'errors.echo')
      );
      assert.equal(unsafeTrace.status, 400);
      assert.equal(unsafeTrace.body.error.code, -32602);
      assert.match(unsafeTrace.body.error.message, /traceparent/i);
      assert(!unsafeTrace.raw.includes('BAGGAGE_SECRET'));
    });

    await test('redacts credentials, arguments, and stacks from native tool errors', async () => {
      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'business-failure',
          method: 'tools/call',
          params: {
            name: 'errors.fail',
            arguments: { password: 'TOP_SECRET_ARGUMENT' },
            _meta: modernMeta({ traceparent: TRACEPARENT }),
          },
        },
        modernHeaders('tools/call', 'errors.fail')
      );
      assert.equal(response.status, 200);
      assert.equal(response.body.result.isError, true);
      assert.equal(
        response.body.result._meta[PHOTON_TOOL_ERROR_META_KEY].code,
        'PHOTON_TOOL_EXECUTION_FAILED'
      );
      for (const secret of [
        'TOP_SECRET_ARGUMENT',
        'TOP_SECRET_MESSAGE',
        'abcdefghijklmnopqrstuvwxyz',
        '/private/workspace/secret-tool.ts',
      ]) {
        assert(!response.raw.includes(secret), `response leaked ${secret}`);
      }
      assert(response.raw.includes('[REDACTED]'));

      const generic = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'business-failure-generic-client',
          method: 'tools/call',
          params: {
            name: 'errors.fail',
            arguments: {},
            _meta: modernMeta({
              'io.modelcontextprotocol/clientCapabilities': {},
            }),
          },
        },
        modernHeaders('tools/call', 'errors.fail')
      );
      assert.equal(generic.body.result.isError, true);
      assert.equal(generic.body.result._meta?.[PHOTON_TOOL_ERROR_META_KEY], undefined);
    });

    await test('preserves upstream isError and metadata while normalizing Photon metadata', async () => {
      const upstream = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'upstream-reported',
          method: 'tools/call',
          params: {
            name: 'upstream.reported',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', 'upstream.reported')
      );
      assert.equal(upstream.status, 200);
      assert.equal(upstream.body.result.isError, true);
      assert.deepEqual(upstream.body.result.structuredContent, { reason: 'upstream-policy' });
      assert.equal(upstream.body.result._meta.upstream, 'preserved');
      assert.equal(
        upstream.body.result._meta[PHOTON_TOOL_ERROR_META_KEY].type,
        'external_tool_error'
      );

      const thrown = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'upstream-thrown',
          method: 'tools/call',
          params: {
            name: 'upstream.throws',
            arguments: {},
            _meta: modernMeta(),
          },
        },
        modernHeaders('tools/call', 'upstream.throws')
      );
      assert.equal(thrown.status, 200);
      assert.equal(thrown.body.result.isError, true);
      assert.equal(
        thrown.body.result._meta[PHOTON_TOOL_ERROR_META_KEY].code,
        'PHOTON_DEPENDENCY_UNAVAILABLE'
      );
      assert.equal(thrown.body.result._meta[PHOTON_TOOL_ERROR_META_KEY].retryable, true);
      assert(!thrown.raw.includes('EXTERNAL_SECRET'));
      assert(!thrown.raw.includes('zyxwvutsrqponmlkjihgfedcba'));
    });

    await test('maps resource absence and unexpected handler failures without leaking detail', async () => {
      const absentModern = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'resource-missing-modern',
          method: 'resources/read',
          params: {
            uri: 'ui://errors/missing',
            _meta: modernMeta({
              'io.modelcontextprotocol/clientCapabilities': {
                extensions: {
                  'io.modelcontextprotocol/ui': {
                    mimeTypes: ['text/html;profile=mcp-app'],
                  },
                },
              },
            }),
          },
        },
        modernHeaders('resources/read', 'ui://errors/missing')
      );
      assert.equal(absentModern.status, 400);
      assert.equal(absentModern.body.error.code, -32602);

      const absentLegacy = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'resource-missing-legacy',
        method: 'resources/read',
        params: { uri: 'ui://errors/missing' },
      });
      assert.equal(absentLegacy.status, 200);
      assert.equal(absentLegacy.body.error.code, -32602);

      const internal = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'resource-internal',
          method: 'resources/read',
          params: {
            uri: 'ui://errors/panel',
            _meta: modernMeta({
              traceparent: TRACEPARENT,
              'io.modelcontextprotocol/clientCapabilities': {
                extensions: {
                  'io.modelcontextprotocol/ui': {
                    mimeTypes: ['text/html;profile=mcp-app'],
                  },
                  'dev.portel.photon': {},
                },
              },
            }),
          },
        },
        modernHeaders('resources/read', 'ui://errors/panel')
      );
      assert.equal(internal.status, 500);
      assert.equal(internal.body.error.code, -32603);
      assert.equal(internal.body.error.message, 'Internal Photon failure');
      assert.equal(
        internal.body.error.data[PHOTON_TOOL_ERROR_META_KEY].correlationId,
        'resource-internal'
      );
      assert.equal(internal.body.error.data[PHOTON_TOOL_ERROR_META_KEY].traceparent, TRACEPARENT);
      assert(!internal.raw.includes('RESOURCE_SECRET'));
      assert(!internal.raw.includes('render failed'));
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

await main();
