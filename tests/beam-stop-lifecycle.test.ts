import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import type { BeamState } from '../src/auto-ui/beam/types.js';
import { __stopBeamStateForTests } from '../src/auto-ui/beam.js';

test('Beam stop cleanup closes server, watchers, timers, and daemon subscriptions', async () => {
  const server = createServer((_req, res) => {
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  let watcherClosed = 0;
  let unsubscribed = 0;
  let timerFired = false;
  const timer = setTimeout(() => {
    timerFired = true;
  }, 10_000);

  const state: BeamState = {
    actions: {
      broadcastPhotonChange: () => {},
      handleFileChange: async () => {},
      loadSinglePhoton: async () => null,
      reconnectExternalMCP: async () => ({ success: true }),
      loadUIAsset: async () => null,
      subscribeToChannel: async () => {},
      unsubscribeFromChannel: () => {},
      configurePhotonViaMCP: async () => ({}),
      reloadPhotonViaMCP: async () => ({}),
      removePhotonViaMCP: async () => ({}),
    },
    workingDir: process.cwd(),
    ctx: null,
    loader: {} as BeamState['loader'],
    marketplace: {} as BeamState['marketplace'],
    savedConfig: { photons: {}, mcpServers: {} },
    photons: [],
    photonMCPs: new Map(),
    externalMCPs: [],
    externalMCPClients: new Map(),
    externalMCPSDKClients: new Map(),
    channelSubscriptions: new Map([
      [
        'demo:default:state-changed',
        {
          photonName: 'demo',
          channelPattern: 'demo:default:state-changed',
          refCount: 1,
          unsubscribe: () => {
            unsubscribed += 1;
          },
        },
      ],
    ]),
    channelEventBuffers: new Map([['demo:default:state-changed', []]]),
    sessionViewState: new Map([['session-1', 'demo']]),
    apiRateLimiter: {} as BeamState['apiRateLimiter'],
    server,
    activeSockets: new Set(),
    stopping: false,
    pendingSubscriptions: new Map(),
    watchers: [
      {
        close: () => {
          watcherClosed += 1;
        },
      } as BeamState['watchers'][number],
    ],
    pendingReloads: new Map([['demo', timer]]),
    activeLoads: new Set(['demo']),
    pendingAfterLoad: new Map([['demo', []]]),
    beamDir: process.cwd(),
    configuredCount: 0,
    unconfiguredCount: 0,
  };

  await __stopBeamStateForTests(state);

  assert.equal(server.listening, false);
  assert.equal(watcherClosed, 1);
  assert.equal(unsubscribed, 1);
  assert.equal(timerFired, false);
  assert.equal(state.watchers.length, 0);
  assert.equal(state.pendingReloads.size, 0);
  assert.equal(state.activeLoads.size, 0);
  assert.equal(state.pendingAfterLoad.size, 0);
  assert.equal(state.channelSubscriptions.size, 0);
  assert.equal(state.channelEventBuffers.size, 0);
  assert.equal(state.sessionViewState.size, 0);
});

test('Beam stop closes active HTTP connections before resolving', async () => {
  const server = createServer((_req, res) => {
    // Keep the request open so server.close() cannot finish by itself.
    res.writeHead(200, { Connection: 'keep-alive' });
    res.write('connected');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let socket: Socket | null = null;
  let stopPromise: Promise<void> | null = null;

  try {
    socket = createConnection({ port: address.port, host: '127.0.0.1' });
    await new Promise<void>((resolve, reject) => {
      socket?.once('connect', () => resolve());
      socket?.once('error', reject);
    });
    socket.write(
      `GET / HTTP/1.1\r\nHost: 127.0.0.1:${address.port}\r\nConnection: keep-alive\r\n\r\n`
    );
    await new Promise<void>((resolve, reject) => {
      socket?.once('data', () => resolve());
      socket?.once('error', reject);
    });

    const state: BeamState = {
      actions: {
        broadcastPhotonChange: () => {},
        handleFileChange: async () => {},
        loadSinglePhoton: async () => null,
        reconnectExternalMCP: async () => ({ success: true }),
        loadUIAsset: async () => null,
        subscribeToChannel: async () => {},
        unsubscribeFromChannel: () => {},
        configurePhotonViaMCP: async () => ({}),
        reloadPhotonViaMCP: async () => ({}),
        removePhotonViaMCP: async () => ({}),
      },
      workingDir: process.cwd(),
      ctx: null,
      loader: {} as BeamState['loader'],
      marketplace: {} as BeamState['marketplace'],
      savedConfig: { photons: {}, mcpServers: {} },
      photons: [],
      photonMCPs: new Map(),
      externalMCPs: [],
      externalMCPClients: new Map(),
      externalMCPSDKClients: new Map(),
      channelSubscriptions: new Map(),
      channelEventBuffers: new Map(),
      sessionViewState: new Map(),
      apiRateLimiter: {} as BeamState['apiRateLimiter'],
      server,
      activeSockets: new Set([socket]),
      stopping: false,
      pendingSubscriptions: new Map(),
      watchers: [],
      pendingReloads: new Map(),
      activeLoads: new Set(),
      pendingAfterLoad: new Map(),
      beamDir: process.cwd(),
      configuredCount: 0,
      unconfiguredCount: 0,
    };

    stopPromise = __stopBeamStateForTests(state);
    const outcome = await Promise.race([
      stopPromise.then(() => 'closed' as const),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ]);

    assert.equal(outcome, 'closed', 'Beam stop must not wait forever on an open HTTP connection');
  } finally {
    socket?.destroy();
    await stopPromise?.catch(() => undefined);
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
