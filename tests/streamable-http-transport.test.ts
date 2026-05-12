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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void runTests();
