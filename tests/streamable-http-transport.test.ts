/**
 * Streamable HTTP transport regression tests.
 */

import { strict as assert } from 'assert';
import http from 'http';
import type { Socket } from 'net';
import { handleStreamableHTTP } from '../dist/auto-ui/streamable-http-transport.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.stack || err.message}`);
    });
}

function post(port: number, agent: http.Agent, id: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

function postJSON(
  port: number,
  body: Record<string, unknown>,
  agent = new http.Agent({ keepAlive: false })
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        agent,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: responseBody ? JSON.parse(responseBody) : null,
          });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function createTestContext(overrides: Record<string, unknown> = {}) {
  return {
    photons: [],
    photonMCPs: new Map(),
    externalMCPs: [],
    externalMCPClients: new Map(),
    externalMCPSDKClients: new Map(),
    reconnectExternalMCP: async () => false,
    loadUIAsset: async () => null,
    configurePhoton: async () => ({ success: false, error: 'not configured in test' }),
    reloadPhoton: async () => ({ success: false, error: 'not configured in test' }),
    removePhoton: async () => ({ success: false, error: 'not configured in test' }),
    updateMetadata: () => undefined,
    generatePhotonHelp: () => '',
    loader: undefined,
    broadcast: () => undefined,
    workingDir: process.cwd(),
    ...overrides,
  } as any;
}

async function withServer(context: any, fn: (port: number) => Promise<void>): Promise<void> {
  const server = http.createServer(async (req, res) => {
    const handled = await handleStreamableHTTP(req, res, context);
    if (!handled) {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert(address && typeof address === 'object', 'server should listen on an ephemeral port');
    await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function runTests(): Promise<void> {
  console.log('\nStreamable HTTP Transport:');

  await test('POST cleanup does not accumulate socket close listeners on keep-alive', async () => {
    let observedSocket: Socket | undefined;
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on('warning', onWarning);

    const server = http.createServer(async (req, res) => {
      const handled = await handleStreamableHTTP(req, res, {
        photons: [],
        photonMCPs: new Map(),
        externalMCPs: [],
        externalMCPClients: new Map(),
        externalMCPSDKClients: new Map(),
        reconnectExternalMCP: async () => false,
        loadUIAsset: async () => null,
        configurePhoton: async () => ({ success: false, error: 'not configured in test' }),
        reloadPhoton: async () => ({ success: false, error: 'not configured in test' }),
        removePhoton: async () => ({ success: false, error: 'not configured in test' }),
        updateMetadata: () => undefined,
        generatePhotonHelp: () => '',
        loader: {} as any,
        broadcast: () => undefined,
        workingDir: process.cwd(),
      });
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });

    server.on('connection', (socket) => {
      observedSocket = socket;
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert(address && typeof address === 'object', 'server should listen on an ephemeral port');
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      try {
        for (let i = 0; i < 30; i++) {
          const status = await post(address.port, agent, i);
          assert.equal(status, 200);
          assert(observedSocket, 'expected keep-alive socket to be observed');
          assert(
            observedSocket.listenerCount('close') <= 2,
            `close listeners accumulated: ${observedSocket.listenerCount('close')}`
          );
        }
      } finally {
        agent.destroy();
      }
      await new Promise((resolve) => setImmediate(resolve));
      const listenerWarnings = warnings.filter(
        (warning) =>
          warning.name === 'MaxListenersExceededWarning' ||
          /MaxListenersExceededWarning|Possible .* memory leak detected/.test(warning.message)
      );
      assert.deepEqual(
        listenerWarnings.map((warning) => warning.message),
        [],
        'transport should not emit listener leak warnings'
      );
    } finally {
      process.off('warning', onWarning);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  await test('tools/list exposes photon/render metadata and legacy aliases', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'demo-id',
          name: 'demo',
          path: `${process.cwd()}/demo.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'rows',
              description: 'List rows',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              outputFormat: 'table',
              layoutHints: { title: 'name' },
              outputSchema: {
                type: 'object',
                properties: {
                  rows: { type: 'array' },
                },
              },
            },
          ],
        },
      ],
      photonMCPs: new Map([
        [
          'demo',
          {
            instance: {
              rows: () => ({ rows: [{ name: 'alpha' }] }),
            },
          },
        ],
      ]),
    });

    await withServer(context, async (port) => {
      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });

      assert.equal(response.status, 200);
      const tool = response.body.result.tools.find((entry: any) => entry.name === 'demo/rows');
      assert(tool, 'expected demo/rows tool');
      assert.equal(tool['x-output-format'], 'table');
      assert.deepEqual(tool['x-layout-hints'], { title: 'name' });
      assert.deepEqual(tool._meta['photon/render'], {
        version: 1,
        mode: 'auto',
        intent: {
          action: 'list',
          subject: 'rows',
          confidence: 0.85,
          sources: ['description', 'format', 'schema'],
          input: { requiresInput: false },
          output: { structured: true, format: 'table' },
        },
        format: 'table',
        layoutHints: { title: 'name' },
      });
    });
  });

  await test('MCP list endpoints paginate with nextCursor', async () => {
    const methods = Array.from({ length: 105 }, (_, index) => ({
      name: `method${index}`,
      description: `Method ${index}`,
      params: { type: 'object', properties: {} },
      returns: { type: 'object' },
    }));
    const uiAssets = Array.from({ length: 105 }, (_, index) => ({
      id: `view${index}`,
      uri: `ui://demo/view${index}`,
      mimeType: 'text/html;profile=mcp-app',
    }));
    const statics = Array.from({ length: 105 }, (_, index) => ({
      uri: `demo://items/${index}/{id}`,
      name: `item${index}`,
      mimeType: 'application/json',
    }));
    const templates = Array.from({ length: 105 }, (_, index) => ({
      name: `prompt${index}`,
      description: `Prompt ${index}`,
      inputSchema: { type: 'object', properties: {} },
    }));

    const context = createTestContext({
      photons: [
        {
          id: 'demo-id',
          name: 'demo',
          path: `${process.cwd()}/demo.photon.ts`,
          configured: true,
          methods,
          assets: { ui: uiAssets },
        },
      ],
      photonMCPs: new Map([
        [
          'demo',
          {
            instance: {},
            statics,
            templates,
          },
        ],
      ]),
    });

    await withServer(context, async (port) => {
      const toolPage1 = await postJSON(port, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list',
        params: {},
      });
      assert.equal(toolPage1.status, 200);
      assert.equal(toolPage1.body.result.tools.length, 100);
      assert.equal(typeof toolPage1.body.result.nextCursor, 'string');

      const toolPage2 = await postJSON(port, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list',
        params: { cursor: toolPage1.body.result.nextCursor },
      });
      assert.equal(toolPage2.status, 200);
      assert(toolPage2.body.result.tools.some((tool: any) => tool.name === 'demo/method100'));

      for (const [method, collection] of [
        ['resources/list', 'resources'],
        ['resources/templates/list', 'resourceTemplates'],
        ['prompts/list', 'prompts'],
      ] as const) {
        const page1 = await postJSON(port, {
          jsonrpc: '2.0',
          id: `${method}-1`,
          method,
          params: {},
        });
        assert.equal(page1.status, 200);
        assert.equal(page1.body.result[collection].length, 100);
        assert.equal(typeof page1.body.result.nextCursor, 'string');

        const page2 = await postJSON(port, {
          jsonrpc: '2.0',
          id: `${method}-2`,
          method,
          params: { cursor: page1.body.result.nextCursor },
        });
        assert.equal(page2.status, 200);
        assert(page2.body.result[collection].length > 0);
      }
    });
  });

  await test('tools/list exposes intent metadata without explicit render hints', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'tasks-id',
          name: 'tasks',
          path: `${process.cwd()}/tasks.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'createTask',
              description: 'Create task',
              params: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  notes: { type: 'string' },
                },
                required: ['title'],
              },
              returns: { type: 'object' },
              readOnlyHint: false,
              outputSchema: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                },
              },
            },
          ],
        },
      ],
    });

    await withServer(context, async (port) => {
      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/list',
        params: {},
      });

      assert.equal(response.status, 200);
      const tool = response.body.result.tools.find(
        (entry: any) => entry.name === 'tasks/createTask'
      );
      assert(tool, 'expected tasks/createTask tool');
      assert.deepEqual(tool._meta['photon/render'].intent, {
        action: 'create',
        subject: 'task',
        confidence: 0.9,
        sources: ['description', 'methodName', 'schema'],
        input: {
          requiresInput: true,
          requiredFields: ['title'],
          optionalFields: ['notes'],
        },
        output: { structured: true },
      });
    });
  });

  await test('MCP list endpoints reject malformed cursors as invalid params', async () => {
    const context = createTestContext();

    await withServer(context, async (port) => {
      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/list',
        params: { cursor: 'not-a-valid-cursor' },
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.error.code, -32602);
      assert.match(response.body.error.message, /Invalid pagination cursor/);
    });
  });

  await test('tools/call returns structuredContent with photon/render metadata', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'demo-id',
          name: 'demo',
          path: `${process.cwd()}/demo.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'rows',
              description: 'List rows',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              outputFormat: 'table',
              layoutHints: { title: 'name' },
              outputSchema: {
                type: 'object',
                properties: {
                  rows: { type: 'array' },
                },
              },
            },
          ],
        },
      ],
      photonMCPs: new Map([
        [
          'demo',
          {
            instance: {
              rows: () => ({ rows: [{ name: 'alpha' }] }),
            },
          },
        ],
      ]),
    });

    await withServer(context, async (port) => {
      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'demo/rows', arguments: {} },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(response.body.result.structuredContent, { rows: [{ name: 'alpha' }] });
      assert.equal(response.body.result['x-output-format'], 'table');
      assert.deepEqual(response.body.result['x-layout-hints'], { title: 'name' });
      assert.deepEqual(response.body.result._meta['photon/render'], {
        version: 1,
        mode: 'auto',
        intent: {
          action: 'list',
          subject: 'rows',
          confidence: 0.85,
          sources: ['description', 'format', 'schema'],
          input: { requiresInput: false },
          output: { structured: true, format: 'table' },
        },
        format: 'table',
        layoutHints: { title: 'name' },
      });
    });
  });

  await test('tools/call requiring elicitation fails fast when client lacks capability', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'shop-id',
          name: 'shop',
          path: `${process.cwd()}/shop.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'browse',
              description: 'Browse menu',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              hasGeneratorAsks: true,
            },
          ],
        },
      ],
      photonMCPs: new Map([['shop', { instance: { browse: () => null } }]]),
      loader: {
        executeTool: async (_mcp: any, _method: string, _args: any, options: any) => {
          await options.inputProvider({
            ask: 'select',
            message: 'Pick a pizza',
            options: [{ value: 'margherita', label: 'Margherita' }],
            multi: true,
          });
          return { ok: true };
        },
      },
    });

    await withServer(context, async (port) => {
      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'shop/browse', arguments: {} },
      });

      assert.equal(response.status, 200);
      assert.equal(response.body.result.isError, true);
      assert.match(
        response.body.result.content[0].text,
        /requires MCP elicitation, but this client did not advertise the elicitation capability/
      );
    });
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void runTests();
