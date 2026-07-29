/**
 * Streamable HTTP transport regression tests.
 */

import { strict as assert } from 'assert';
import http from 'http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Socket } from 'net';
import {
  __streamableHttpTransportInternals,
  attachLoaderForResourceUpdates,
  broadcastMCPListChanges,
  broadcastNotification,
  handleStreamableHTTP,
  stopSessionCleanup,
} from '../dist/auto-ui/streamable-http-transport.js';
import { createPhotonAuthKeypair, signPhotonAuthToken } from '../dist/auth/mcp-jwt.js';

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
  body: Record<string, unknown> | Array<Record<string, unknown>>,
  agent?: http.Agent,
  headers: Record<string, string> = {},
  path = '/mcp'
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    let responseStarted = false;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        agent: agent ?? new http.Agent({ keepAlive: false }),
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        responseStarted = true;
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          const contentType = String(res.headers['content-type'] || '');
          const dataPayloads = contentType.includes('text/event-stream')
            ? responseBody
                .split(/\r?\n/)
                .filter((line) => line.startsWith('data: '))
                .map((line) => JSON.parse(line.slice(6)))
            : [];
          resolve({
            status: res.statusCode ?? 0,
            body: responseBody
              ? contentType.includes('text/event-stream')
                ? dataPayloads.length === 1
                  ? dataPayloads[0]
                  : dataPayloads
                : JSON.parse(responseBody)
              : null,
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', (error) => {
      if (!responseStarted) reject(error);
    });
    req.end(payload);
  });
}

function postRaw(
  port: number,
  payload: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
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
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: responseBody,
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

function getRaw(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers,
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
            body: responseBody,
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function openLegacySSE(
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...headers },
      },
      (res) => {
        res.once('error', (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ECONNRESET') reject(error);
        });
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          close: () => {
            res.destroy();
            req.destroy();
          },
        });
      }
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.end();
  });
}

const MCP_2026_VERSION = '2026-07-28';

function mcp2026Meta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MCP_2026_VERSION,
    'io.modelcontextprotocol/clientInfo': { name: 'photon-regression', version: '1.0.0' },
    'io.modelcontextprotocol/clientCapabilities': {},
    ...overrides,
  };
}

function mcp2026ExtensionMeta(
  extensions: Record<string, Record<string, unknown>>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return mcp2026Meta({
    'io.modelcontextprotocol/clientCapabilities': { extensions },
    ...overrides,
  });
}

function mcp2026PhotonMeta(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return mcp2026ExtensionMeta({ 'dev.portel.photon': {} }, overrides);
}

function mcp2026Headers(method: string, name?: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': MCP_2026_VERSION,
    'Mcp-Method': method,
    ...(name ? { 'Mcp-Name': name } : {}),
  };
}

type SSEEvent = Record<string, any>;

/**
 * Open a MCP 2026 subscription and collect each JSON-RPC message delivered on
 * its request-scoped SSE response. The caller owns cancellation via `close`.
 */
function openSubscriptionStream(
  port: number,
  body: Record<string, unknown>
): Promise<{
  headers: http.IncomingHttpHeaders;
  events: SSEEvent[];
  close: () => void;
  waitFor: (predicate: (event: SSEEvent) => boolean) => Promise<SSEEvent>;
}> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'subscriptions/listen',
        },
      },
      (res) => {
        const events: SSEEvent[] = [];
        let buffer = '';
        const waiters = new Set<{
          predicate: (event: SSEEvent) => boolean;
          resolve: (event: SSEEvent) => void;
          reject: (error: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }>();

        const emit = (event: SSEEvent) => {
          events.push(event);
          for (const waiter of [...waiters]) {
            if (!waiter.predicate(event)) continue;
            clearTimeout(waiter.timer);
            waiters.delete(waiter);
            waiter.resolve(event);
          }
        };

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice('data:'.length).trimStart())
              .join('\n');
            if (data) emit(JSON.parse(data));
            boundary = buffer.indexOf('\n\n');
          }
        });
        res.on('error', reject);
        res.on('end', () => {
          for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.reject(new Error('subscription stream ended before the expected notification'));
          }
          waiters.clear();
        });

        resolve({
          headers: res.headers,
          events,
          close: () => req.destroy(),
          waitFor: (predicate) =>
            new Promise<SSEEvent>((resolveEvent, rejectEvent) => {
              const existing = events.find(predicate);
              if (existing) {
                resolveEvent(existing);
                return;
              }
              const waiter = {
                predicate,
                resolve: resolveEvent,
                reject: rejectEvent,
                timer: setTimeout(() => {
                  waiters.delete(waiter);
                  rejectEvent(new Error('timed out waiting for subscription notification'));
                }, 1_000),
              };
              waiters.add(waiter);
            }),
        });
      }
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      // Aborting a long-lived response is normal subscription cleanup.
      if (error.code !== 'ECONNRESET') reject(error);
    });
    req.end(payload);
  });
}

function openPausedSubscription(
  port: number,
  id: string
): Promise<{
  closed: Promise<void>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const body = {
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: {
        _meta: mcp2026Meta(),
        notifications: { toolsListChanged: true },
      },
    };
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          ...mcp2026Headers('subscriptions/listen'),
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (response) => {
        assert.equal(response.statusCode, 200);
        response.pause();
        let resolveClosed!: () => void;
        const closed = new Promise<void>((resolveEvent) => {
          resolveClosed = resolveEvent;
        });
        response.once('aborted', resolveClosed);
        response.once('close', resolveClosed);
        resolve({
          closed,
          close: () => {
            response.destroy();
            request.destroy();
          },
        });
      }
    );
    request.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
    request.end(payload);
  });
}

function createTestContext(overrides: Record<string, unknown> = {}) {
  const isolatedWorkingDir = mkdtempSync(join(tmpdir(), 'photon-streamable-http-'));
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
    workingDir: isolatedWorkingDir,
    __isolatedTestWorkingDir: isolatedWorkingDir,
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
    if (typeof context.__isolatedTestWorkingDir === 'string') {
      rmSync(context.__isolatedTestWorkingDir, { recursive: true, force: true });
    }
  }
}

async function runTests(): Promise<void> {
  console.log('\nStreamable HTTP Transport:');

  await test('authenticates protected tools before execution and binds resource scopes', async () => {
    let executions = 0;
    let observedCaller: Record<string, unknown> | undefined;
    const verificationContexts: Array<Record<string, unknown>> = [];
    const context = createTestContext({
      oauthResource: 'https://api.example.test/mcp',
      oauthResourceMetadataUrl: 'https://api.example.test/.well-known/oauth-protected-resource',
      photons: [
        {
          id: 'secure-id',
          name: 'secure',
          path: `${process.cwd()}/secure.photon.ts`,
          configured: true,
          auth: 'https://issuer.example.test',
          methods: [
            {
              name: 'run',
              description: 'Run securely',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              scopes: ['records:write', 'records:read', 'records:write'],
            },
          ],
        },
      ],
      photonMCPs: new Map([['secure', { instance: { run: () => null } }]]),
      verifyBearerToken: async (token: string, verificationContext: Record<string, unknown>) => {
        verificationContexts.push(verificationContext);
        if (token === 'under-scoped') return { ok: false, reason: 'insufficient_scope' };
        if (token !== 'valid-signed-token') return { ok: false, reason: 'bad_signature' };
        return {
          ok: true,
          claims: {
            sub: 'caller-123',
            scope: 'records:read records:write',
            aud: 'https://api.example.test/mcp',
          },
        };
      },
      loader: {
        executeTool: async (_mcp: unknown, _method: string, _args: unknown, options: any) => {
          executions++;
          observedCaller = options.caller;
          return { ok: true };
        },
      },
    });
    const call = {
      jsonrpc: '2.0',
      id: 'secure-call',
      method: 'tools/call',
      params: {
        name: 'secure.run',
        arguments: {},
        _meta: mcp2026Meta(),
      },
    };
    const headers = mcp2026Headers('tools/call', 'secure.run');

    await withServer(context, async (port) => {
      const missing = await postJSON(port, call, undefined, headers);
      assert.equal(missing.status, 401);
      assert.equal(missing.body.error.code, -32001);
      assert.match(
        String(missing.headers['www-authenticate']),
        /resource_metadata="https:\/\/api\.example\.test\/\.well-known\/oauth-protected-resource"/
      );
      assert.match(
        String(missing.headers['www-authenticate']),
        /scope="records:read records:write"/
      );

      const forged = await postJSON(port, call, undefined, {
        ...headers,
        Authorization: 'Bearer forged-token',
      });
      assert.equal(forged.status, 401);
      assert.equal(forged.body.error.data.reason, 'bad_signature');

      const underScoped = await postJSON(port, call, undefined, {
        ...headers,
        Authorization: 'Bearer under-scoped',
      });
      assert.equal(underScoped.status, 403);
      assert.equal(underScoped.body.error.code, -32003);
      assert.match(String(underScoped.headers['www-authenticate']), /error="insufficient_scope"/);

      const valid = await postJSON(port, call, undefined, {
        ...headers,
        Authorization: 'Bearer valid-signed-token',
      });
      assert.equal(valid.status, 200);
      assert.equal(valid.body.result.isError, false);
    });

    assert.equal(executions, 1, 'only a verified, sufficiently scoped call may execute');
    assert.equal(observedCaller?.id, 'caller-123');
    assert.equal(observedCaller?.scope, 'records:read records:write');
    assert.deepEqual(verificationContexts.at(-1), {
      resource: 'https://api.example.test/mcp',
      expectedIssuer: 'https://issuer.example.test',
      requiredScopes: ['records:read', 'records:write'],
    });
  });

  await test('default JWT verifier rejects forged claims and accepts one exact resource token', async () => {
    const envKeys = [
      'PHOTON_MCP_AUTH_MODE',
      'PHOTON_MCP_JWT_PROFILE',
      'PHOTON_MCP_JWT_ISSUER',
      'PHOTON_MCP_JWT_JWKS',
      'PHOTON_MCP_JWT_AUDIENCE',
    ] as const;
    const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    const keypair = createPhotonAuthKeypair('streamable-oauth');
    const issuer = {
      ...keypair.issuer,
      issuer: 'https://issuer.example.test',
    };
    const audience = 'https://resource.example.test/mcp';
    process.env.PHOTON_MCP_AUTH_MODE = 'jwt';
    delete process.env.PHOTON_MCP_JWT_PROFILE;
    process.env.PHOTON_MCP_JWT_ISSUER = issuer.issuer;
    process.env.PHOTON_MCP_JWT_JWKS = JSON.stringify(keypair.jwks);
    process.env.PHOTON_MCP_JWT_AUDIENCE = audience;

    let executions = 0;
    const context = createTestContext({
      oauthResource: audience,
      photons: [
        {
          id: 'jwt-secure-id',
          name: 'jwtSecure',
          path: `${process.cwd()}/jwt-secure.photon.ts`,
          configured: true,
          auth: issuer.issuer,
          methods: [
            {
              name: 'run',
              description: 'Run securely',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              scopes: ['records:read'],
            },
          ],
        },
      ],
      photonMCPs: new Map([['jwtSecure', { instance: { run: () => null } }]]),
      loader: {
        executeTool: async () => {
          executions++;
          return { ok: true };
        },
      },
    });
    const call = {
      jsonrpc: '2.0',
      id: 'jwt-secure-call',
      method: 'tools/call',
      params: { name: 'jwtSecure.run', arguments: {}, _meta: mcp2026Meta() },
    };
    const headers = mcp2026Headers('tools/call', 'jwtSecure.run');
    const token = (
      tokenIssuer: typeof issuer,
      tokenAudience: string,
      ttlSeconds = 900,
      now?: Date
    ) =>
      signPhotonAuthToken(tokenIssuer, keypair.privateJwk, {
        agent: 'verified-agent',
        audience: tokenAudience,
        scopes: ['records:read'],
        ttlSeconds,
        now,
      });

    try {
      await withServer(context, async (port) => {
        const forged = token(issuer, audience);
        const forgedParts = forged.split('.');
        const forgedClaims = JSON.parse(Buffer.from(forgedParts[1], 'base64url').toString('utf8'));
        forgedClaims.sub = 'agent:attacker';
        forgedParts[1] = Buffer.from(JSON.stringify(forgedClaims)).toString('base64url');

        for (const [credential, reason] of [
          [forgedParts.join('.'), 'bad_signature'],
          [token(issuer, 'https://wrong-resource.example/mcp'), 'wrong_audience'],
          [
            token({ ...issuer, issuer: 'https://rotated-issuer.example' }, audience),
            'wrong_issuer',
          ],
          [token(issuer, audience, 10, new Date(Date.now() - 120_000)), 'expired_token'],
        ] as const) {
          const rejected = await postJSON(port, call, undefined, {
            ...headers,
            Authorization: `Bearer ${credential}`,
          });
          assert.equal(rejected.status, 401);
          assert.equal(rejected.body.error.data.reason, reason);
        }

        const valid = await postJSON(port, call, undefined, {
          ...headers,
          Authorization: `Bearer ${token(issuer, audience)}`,
        });
        assert.equal(valid.status, 200);
      });
      assert.equal(executions, 1);
    } finally {
      for (const key of envKeys) {
        const value = originalEnv[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  await test('keeps public tools anonymous and rejects unverified supplied credentials', async () => {
    let executions = 0;
    let verificationCalls = 0;
    const context = createTestContext({
      photons: [
        {
          id: 'public-id',
          name: 'public',
          path: `${process.cwd()}/public.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'run',
              description: 'Run publicly',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
            },
          ],
        },
      ],
      photonMCPs: new Map([['public', { instance: { run: () => null } }]]),
      verifyBearerToken: async () => {
        verificationCalls++;
        return { ok: false, reason: 'bad_signature' };
      },
      loader: {
        executeTool: async () => {
          executions++;
          return { ok: true };
        },
      },
    });
    const call = {
      jsonrpc: '2.0',
      id: 'public-call',
      method: 'tools/call',
      params: { name: 'public.run', arguments: {}, _meta: mcp2026Meta() },
    };
    const headers = mcp2026Headers('tools/call', 'public.run');

    await withServer(context, async (port) => {
      const anonymous = await postJSON(port, call, undefined, headers);
      assert.equal(anonymous.status, 200);
      assert.equal(verificationCalls, 0);

      const forged = await postJSON(port, call, undefined, {
        ...headers,
        Authorization: 'Bearer forged-token',
      });
      assert.equal(forged.status, 401);
    });

    assert.equal(executions, 1);
    assert.equal(verificationCalls, 1);
  });

  await test('never accepts bearer query credentials for modern or POST requests', async () => {
    let executions = 0;
    const context = createTestContext({
      photons: [
        {
          id: 'secure-query-id',
          name: 'secureQuery',
          path: `${process.cwd()}/secure-query.photon.ts`,
          configured: true,
          auth: 'required',
          methods: [
            {
              name: 'run',
              description: 'Run securely',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
            },
          ],
        },
      ],
      photonMCPs: new Map([['secureQuery', { instance: { run: () => null } }]]),
      verifyBearerToken: async (token: string) =>
        token === 'legacy-query-token'
          ? {
              ok: true,
              claims: { sub: 'query-caller' },
            }
          : { ok: false, reason: 'bad_signature' },
      loader: {
        executeTool: async () => {
          executions++;
          return { ok: true };
        },
      },
    });
    const modernCall = {
      jsonrpc: '2.0',
      id: 'query-call',
      method: 'tools/call',
      params: { name: 'secureQuery.run', arguments: {}, _meta: mcp2026Meta() },
    };

    await withServer(context, async (port) => {
      const modern = await postJSON(
        port,
        modernCall,
        undefined,
        mcp2026Headers('tools/call', 'secureQuery.run'),
        '/mcp?token=query-secret'
      );
      assert.equal(modern.status, 400);
      assert.match(JSON.stringify(modern.body), /not accepted in query parameters/);

      const legacyPost = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'legacy-query-call',
          method: 'tools/call',
          params: { name: 'secureQuery.run', arguments: {} },
        },
        undefined,
        {},
        '/mcp?token=query-secret'
      );
      assert.equal(legacyPost.status, 401);
      assert.equal(legacyPost.body.error.data.reason, 'missing_token');

      const ambiguousLegacyGet = await getRaw(port, '/mcp?token=query-secret', {
        Authorization: 'Bearer header-secret',
      });
      assert.equal(ambiguousLegacyGet.status, 400);
      assert.match(ambiguousLegacyGet.body, /ambiguous bearer credentials/);

      const forgedLegacyGet = await getRaw(port, '/mcp?token=query-secret', {
        Accept: 'text/event-stream',
      });
      assert.equal(forgedLegacyGet.status, 401);
      assert.match(forgedLegacyGet.body, /bad_signature/);

      const validLegacyGet = await openLegacySSE(port, '/mcp?token=legacy-query-token');
      try {
        assert.equal(validLegacyGet.status, 200);
        assert.match(String(validLegacyGet.headers.warning), /query tokens are deprecated/);
      } finally {
        validLegacyGet.close();
      }
    });

    assert.equal(executions, 0);
  });

  await test('normalizes legacy initialize clients into a sessionful client profile', async () => {
    const session = {
      id: 'legacy-session',
      initialized: false,
      createdAt: new Date(),
      lastActivity: new Date(),
    } as any;

    const profile = __streamableHttpTransportInternals.resolveClientProfile(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: { sampling: {} },
          clientInfo: { name: 'beam', version: '1.0.0' },
        },
      },
      session,
      {}
    );

    assert.equal(profile.mode, 'legacy-sessionful');
    assert.equal(profile.protocolVersion, '2025-03-26');
    assert.equal(profile.clientName, 'beam');
    assert.equal(profile.capabilities.sampling, true);
    assert.equal(profile.capabilities.tasks, 'legacy-core');
    assert.equal(profile.quirks.requiresLegacyInitializeConfigSchema, true);
  });

  await test('ignores 2025 aliases and client-brand heuristics in stateless requests', async () => {
    const session = {
      id: 'transport-session',
      initialized: false,
      createdAt: new Date(),
      lastActivity: new Date(),
    } as any;

    const requestContext = __streamableHttpTransportInternals.resolvePhotonRequestContext({
      request: {
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'tools/call',
        params: {
          name: 'demo.rows',
          arguments: {},
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'ChatGPT', version: 'future' },
            'io.modelcontextprotocol/clientCapabilities': {
              extensions: { 'mcp-apps': { version: '1.0.0' } },
            },
            'photon/appSessionId': 'psess_123',
            traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
            tracestate: 'vendor=value',
            baggage: 'tenant=demo',
          },
        },
      },
      session,
      headers: { 'mcp-method': 'tools/call' },
    });

    assert.equal(requestContext.client.mode, 'stateless');
    assert.equal(requestContext.client.quirks.unnamespacedToolNames, false);
    assert.equal(requestContext.appSessionId, 'anonymous');
    assert.equal(requestContext.appSessionSource, 'anonymous-default');
    assert.equal(
      requestContext.traceparent,
      '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01'
    );
    assert.equal(requestContext.tracestate, 'vendor=value');
    assert.equal(requestContext.baggage, 'tenant=demo');
    assert.equal(requestContext.client.capabilities.tasks, 'none');
    assert.equal(requestContext.client.capabilities.cacheMetadata, true);
    assert.equal(requestContext.client.capabilities.mcpApps, false);
    assert.equal(requestContext.client.capabilities.photon, false);
  });

  await test('normalizes only canonical stateless UI and Photon extensions', async () => {
    const session = {
      id: 'transport-session',
      initialized: false,
      createdAt: new Date(),
      lastActivity: new Date(),
    } as any;
    const requestContext = __streamableHttpTransportInternals.resolvePhotonRequestContext({
      request: {
        jsonrpc: '2.0',
        id: 'req-canonical-extensions',
        method: 'tools/call',
        params: {
          name: 'demo.rows',
          arguments: {},
          _meta: {
            ...mcp2026ExtensionMeta({
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app'],
              },
              'dev.portel.photon': {},
            }),
            'dev.portel.photon/appSessionId': 'psess_canonical',
          },
        },
      },
      session,
      headers: { 'mcp-method': 'tools/call' },
    });

    assert.equal(requestContext.client.capabilities.mcpApps, true);
    assert.equal(requestContext.client.capabilities.photon, true);
    assert.equal(requestContext.appSessionId, 'psess_canonical');
    assert.equal(requestContext.appSessionSource, 'explicit-meta');
  });

  await test('MCP 2026 rejects every missing or malformed canonical request metadata field', async () => {
    const validMeta = () => mcp2026Meta();
    const cases: Array<{
      name: string;
      meta: Record<string, unknown> | undefined;
    }> = [
      { name: 'missing _meta', meta: undefined },
      {
        name: 'missing protocol version',
        meta: (() => {
          const meta = validMeta();
          delete meta['io.modelcontextprotocol/protocolVersion'];
          return meta;
        })(),
      },
      {
        name: 'non-string protocol version',
        meta: { ...validMeta(), 'io.modelcontextprotocol/protocolVersion': 20260728 },
      },
      {
        name: 'blank protocol version',
        meta: { ...validMeta(), 'io.modelcontextprotocol/protocolVersion': '  ' },
      },
      {
        name: 'non-object client info',
        meta: { ...validMeta(), 'io.modelcontextprotocol/clientInfo': 'client' },
      },
      {
        name: 'missing client name',
        meta: { ...validMeta(), 'io.modelcontextprotocol/clientInfo': { version: '1.0.0' } },
      },
      {
        name: 'non-string client name',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientInfo': { name: 1, version: '1.0.0' },
        },
      },
      {
        name: 'blank client name',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientInfo': { name: ' ', version: '1.0.0' },
        },
      },
      {
        name: 'missing client version',
        meta: { ...validMeta(), 'io.modelcontextprotocol/clientInfo': { name: 'client' } },
      },
      {
        name: 'non-string client version',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientInfo': { name: 'client', version: 1 },
        },
      },
      {
        name: 'blank client version',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientInfo': { name: 'client', version: ' ' },
        },
      },
      {
        name: 'missing client capabilities',
        meta: (() => {
          const meta = validMeta();
          delete meta['io.modelcontextprotocol/clientCapabilities'];
          return meta;
        })(),
      },
      {
        name: 'array client capabilities',
        meta: { ...validMeta(), 'io.modelcontextprotocol/clientCapabilities': [] },
      },
      {
        name: 'null client capabilities',
        meta: { ...validMeta(), 'io.modelcontextprotocol/clientCapabilities': null },
      },
      {
        name: 'string client capabilities',
        meta: { ...validMeta(), 'io.modelcontextprotocol/clientCapabilities': 'none' },
      },
      {
        name: 'array extension map',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientCapabilities': { extensions: [] },
        },
      },
      {
        name: 'scalar extension settings',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { 'io.modelcontextprotocol/tasks': true },
          },
        },
      },
      {
        name: 'UI settings without required MIME type',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { 'io.modelcontextprotocol/ui': {} },
          },
        },
      },
      {
        name: 'unknown reserved extension identifier',
        meta: {
          ...validMeta(),
          'io.modelcontextprotocol/clientCapabilities': {
            extensions: { 'io.modelcontextprotocol/not-real': {} },
          },
        },
      },
      {
        name: 'excessive metadata depth',
        meta: {
          ...validMeta(),
          'com.example/deep': {
            a: {
              b: {
                c: {
                  d: {
                    e: {
                      f: {
                        g: {
                          h: {
                            i: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ];

    await withServer(createTestContext(), async (port) => {
      for (const testCase of cases) {
        const response = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: `invalid-meta-${testCase.name}`,
            method: 'tools/list',
            params: testCase.meta ? { _meta: testCase.meta } : {},
          },
          undefined,
          mcp2026Headers('tools/list')
        );
        assert.equal(response.status, 400, testCase.name);
        assert(response.body?.error, `${testCase.name} should return a JSON-RPC error`);
      }
    });
  });

  await test('MCP transport rejects oversized request bodies before JSON parsing', async () => {
    await withServer(createTestContext(), async (port) => {
      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'oversized-request',
          method: 'tools/list',
          params: {
            _meta: mcp2026Meta({
              'com.example/padding': 'x'.repeat(1_048_576),
            }),
          },
        },
        undefined,
        mcp2026Headers('tools/list')
      );
      assert.equal(response.status, 413);
      assert.equal(response.body.error.code, -32600);
    });
  });

  await test('MCP 2026 enforces HTTP content negotiation and returns JSON-RPC parse errors', async () => {
    await withServer(createTestContext(), async (port) => {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: 'content-negotiation',
        method: 'tools/list',
        params: { _meta: mcp2026Meta() },
      });

      const invalidAccept = await postRaw(port, payload, {
        ...mcp2026Headers('tools/list'),
        Accept: 'application/json',
      });
      assert.equal(invalidAccept.status, 406);

      const invalidContentType = await postRaw(port, payload, {
        ...mcp2026Headers('tools/list'),
        'Content-Type': 'text/plain',
      });
      assert.equal(invalidContentType.status, 415);

      const forbiddenOrigin = await postRaw(port, payload, {
        ...mcp2026Headers('tools/list'),
        Origin: 'https://attacker.example',
      });
      assert.equal(forbiddenOrigin.status, 403);

      const invalidJSON = await postRaw(port, '{"jsonrpc":');
      assert.equal(invalidJSON.status, 400);
      const parsedError = JSON.parse(invalidJSON.body);
      assert.equal(parsedError.id, null);
      assert.equal(parsedError.error.code, -32700);
    });
  });

  await test('MCP 2026 accepts an omitted optional clientInfo field', async () => {
    const meta = mcp2026Meta();
    delete meta['io.modelcontextprotocol/clientInfo'];
    await withServer(createTestContext(), async (port) => {
      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'optional-client-info',
          method: 'tools/list',
          params: { _meta: meta },
        },
        undefined,
        mcp2026Headers('tools/list')
      );
      assert.equal(response.status, 200);
      assert(response.body?.result);
    });
  });

  await test('MCP 2026 rejects unsupported, malformed, and mismatched protocol versions', async () => {
    await withServer(createTestContext(), async (port) => {
      const cases = [
        {
          name: 'unsupported header version',
          meta: mcp2026Meta({ 'io.modelcontextprotocol/protocolVersion': '2026-09-01' }),
          headers: { ...mcp2026Headers('tools/list'), 'Mcp-Protocol-Version': '2026-09-01' },
          headerMismatch: false,
        },
        {
          name: 'malformed header version',
          meta: mcp2026Meta({ 'io.modelcontextprotocol/protocolVersion': 'future' }),
          headers: { ...mcp2026Headers('tools/list'), 'Mcp-Protocol-Version': 'future' },
          headerMismatch: false,
        },
        {
          name: 'body and header version mismatch',
          meta: mcp2026Meta(),
          headers: { ...mcp2026Headers('tools/list'), 'Mcp-Protocol-Version': '2025-11-25' },
          headerMismatch: true,
        },
      ];

      for (const testCase of cases) {
        const response = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: `version-${testCase.name}`,
            method: 'tools/list',
            params: { _meta: testCase.meta },
          },
          undefined,
          testCase.headers
        );
        assert.equal(response.status, 400, testCase.name);
        assert(response.body?.error, `${testCase.name} should return a JSON-RPC error`);
        if (testCase.headerMismatch) assert.equal(response.body.error.code, -32020);
      }

      const unsupportedBodyVersion = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'unsupported-body-version',
          method: 'tools/list',
          params: {
            _meta: mcp2026Meta({
              'io.modelcontextprotocol/protocolVersion': '2026-09-01',
            }),
          },
        },
        undefined,
        { 'Mcp-Method': 'tools/list' }
      );
      assert.equal(unsupportedBodyVersion.status, 400);
      assert.equal(unsupportedBodyVersion.body.error.code, -32022);
      assert.equal(unsupportedBodyVersion.body.error.data.requested, '2026-09-01');
      assert.deepEqual(unsupportedBodyVersion.body.error.data.supported, [
        '2025-03-26',
        '2025-11-25',
        MCP_2026_VERSION,
      ]);
    });
  });

  await test('MCP 2026 ignores protocol session headers and rejects JSON-RPC batches', async () => {
    await withServer(createTestContext(), async (port) => {
      const sessionHeader = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'session-header',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        { ...mcp2026Headers('tools/list'), 'Mcp-Session-Id': 'legacy-session' }
      );
      assert.equal(sessionHeader.status, 200);
      assert(sessionHeader.body?.result);
      assert.equal(sessionHeader.headers['mcp-session-id'], undefined);

      const batch = await postJSON(
        port,
        [
          {
            jsonrpc: '2.0',
            id: 'batch-one',
            method: 'tools/list',
            params: { _meta: mcp2026Meta() },
          },
          {
            jsonrpc: '2.0',
            id: 'batch-two',
            method: 'tools/list',
            params: { _meta: mcp2026Meta() },
          },
        ],
        undefined,
        mcp2026Headers('tools/list')
      );
      assert.equal(batch.status, 400);
      assert(batch.body?.error);
    });
  });

  await test('MCP 2026 request capabilities are isolated per request', async () => {
    await withServer(createTestContext(), async (port) => {
      const first = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'capabilities-one',
          method: 'server/discover',
          params: {
            _meta: mcp2026Meta({
              'io.modelcontextprotocol/clientCapabilities': {
                sampling: {},
                extensions: { 'dev.portel.photon': {} },
              },
            }),
          },
        },
        undefined,
        mcp2026Headers('server/discover')
      );
      assert.equal(first.status, 200);
      assert.equal(first.body.result._meta['photon/clientProfile'].capabilities.sampling, true);

      const second = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'capabilities-two',
          method: 'server/discover',
          params: { _meta: mcp2026PhotonMeta() },
        },
        undefined,
        mcp2026Headers('server/discover')
      );
      assert.equal(second.status, 200);
      assert.equal(second.body.result._meta['photon/clientProfile'].capabilities.sampling, false);
    });
  });

  await test('MCP 2026 ignores legacy session identity and capabilities', async () => {
    await withServer(createTestContext(), async (port) => {
      const initialized = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-profile-source',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: { sampling: {} },
          clientInfo: { name: 'ChatGPT', version: '1.0.0' },
        },
      });
      assert.equal(initialized.status, 200);

      const meta = mcp2026PhotonMeta();
      delete meta['io.modelcontextprotocol/clientInfo'];
      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'stateless-profile-isolation',
          method: 'server/discover',
          params: { _meta: meta },
        },
        undefined,
        {
          ...mcp2026Headers('server/discover'),
          'Mcp-Session-Id': String(initialized.headers['mcp-session-id']),
        }
      );
      assert.equal(response.status, 200);
      const profile = response.body.result._meta['photon/clientProfile'];
      assert.equal(profile.clientName, undefined);
      assert.equal(profile.capabilities.sampling, false);
      assert.equal(profile.quirks.unnamespacedToolNames, false);
      assert.equal(response.headers['mcp-session-id'], undefined);
    });
  });

  await test('MCP 2026 validates task routing headers and declared Tasks extension capability', async () => {
    await withServer(createTestContext(), async (port) => {
      const missingName = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'task-missing-name',
          method: 'tasks/get',
          params: { taskId: 'task_123', _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('tasks/get')
      );
      assert.equal(missingName.status, 400);
      assert.equal(missingName.body.error.code, -32020);

      const missingCapability = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'task-missing-capability',
          method: 'tasks/get',
          params: {
            taskId: 'task_123',
            _meta: mcp2026Meta(),
          },
        },
        undefined,
        mcp2026Headers('tasks/get', 'task_123')
      );
      assert.equal(missingCapability.status, 400);
      assert.equal(missingCapability.body.error.code, -32021);
      assert.deepEqual(missingCapability.body.error.data.requiredCapabilities, {
        extensions: { 'io.modelcontextprotocol/tasks': {} },
      });
    });
  });

  await test('MCP 2025 batches and initialization-derived profiles remain supported', async () => {
    await withServer(
      createTestContext({
        photons: [
          {
            id: 'legacy-demo-id',
            name: 'legacyDemo',
            path: `${process.cwd()}/legacy-demo.photon.ts`,
            configured: true,
            methods: [{ name: 'run', description: 'Run demo', params: { type: 'object' } }],
          },
        ],
      }),
      async (port) => {
        const initialized = await postJSON(port, {
          jsonrpc: '2.0',
          id: 'legacy-initialize',
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: { sampling: {} },
            clientInfo: { name: 'ChatGPT', version: '1.0.0' },
          },
        });
        assert.equal(initialized.status, 200);
        const sessionId = initialized.headers['mcp-session-id'];
        assert.equal(typeof sessionId, 'string');

        const legacyBatch = await postJSON(
          port,
          [
            { jsonrpc: '2.0', id: 'legacy-batch-one', method: 'tools/list', params: {} },
            { jsonrpc: '2.0', id: 'legacy-batch-two', method: 'resources/list', params: {} },
          ],
          undefined,
          { 'Mcp-Session-Id': sessionId as string }
        );
        assert.equal(legacyBatch.status, 200);
        assert(Array.isArray(legacyBatch.body));
        assert.equal(legacyBatch.body.length, 2);
        assert(
          legacyBatch.body[0].result.tools.some((tool: any) => tool.name === 'run'),
          'legacy clients should retain the initialized slashless tool name'
        );
        assert.equal(legacyBatch.headers['mcp-session-id'], sessionId);
      }
    );
  });

  await test('stateless requests reject missing or mismatched routing headers', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'demo-id',
          name: 'demo',
          path: `${process.cwd()}/demo.photon.ts`,
          configured: true,
          methods: [{ name: 'run', description: 'Run demo', params: { type: 'object' } }],
        },
      ],
    });

    await withServer(context, async (port) => {
      const missingMethod = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'missing-method',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        { 'Mcp-Protocol-Version': '2026-07-28' }
      );
      assert.equal(missingMethod.status, 400);
      assert.equal(missingMethod.body.error.code, -32020);
      assert.match(missingMethod.body.error.message, /^Header mismatch:/);
      assert.match(missingMethod.body.error.message, /Mcp-Method header is required/);

      const wrongMethod = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'wrong-method',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        {
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/call',
        }
      );
      assert.equal(wrongMethod.status, 400);
      assert.equal(wrongMethod.body.error.code, -32020);
      assert.match(wrongMethod.body.error.message, /^Header mismatch:/);
      assert.match(wrongMethod.body.error.message, /does not match request method/);

      const missingName = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'missing-name',
          method: 'tools/call',
          params: { name: 'demo.run', arguments: {}, _meta: mcp2026Meta() },
        },
        undefined,
        {
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/call',
        }
      );
      assert.equal(missingName.status, 400);
      assert.equal(missingName.body.error.code, -32020);
      assert.match(missingName.body.error.message, /Mcp-Name header is required/);

      const wrongName = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'wrong-name',
          method: 'tools/call',
          params: { name: 'demo.run', arguments: {}, _meta: mcp2026Meta() },
        },
        undefined,
        {
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'other.run',
        }
      );
      assert.equal(wrongName.status, 400);
      assert.equal(wrongName.body.error.code, -32020);
      assert.match(wrongName.body.error.message, /^Header mismatch:/);
      assert.match(wrongName.body.error.message, /does not match request name/);
    });
  });

  await test('custom routing headers round-trip only for modern annotated tools', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const routedSchema = {
      type: 'object',
      properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' },
        options: {
          type: 'object',
          properties: {
            shard: { type: 'integer', 'x-mcp-header': 'Shard' },
            preview: { type: 'boolean', 'x-mcp-header': 'Preview' },
          },
        },
      },
    };
    const unsafeSchema = {
      type: 'object',
      properties: {
        secretValue: { type: 'string', 'x-mcp-header': 'SecretRoute' },
      },
    };
    const context = createTestContext({
      photons: [
        {
          id: 'router-id',
          name: 'router',
          path: `${process.cwd()}/router.photon.ts`,
          configured: true,
          methods: [
            { name: 'lookup', description: 'Route lookup', params: routedSchema },
            { name: 'unsafe', description: 'Unsafe route', params: unsafeSchema },
          ],
        },
      ],
      photonMCPs: new Map([
        [
          'router',
          {
            instance: {
              lookup: (args: Record<string, unknown>) => {
                calls.push(args);
                return args;
              },
              unsafe: () => 'legacy-only',
            },
          },
        ],
      ]),
    });

    await withServer(context, async (port) => {
      const modernList = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'routing-list-modern',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('tools/list')
      );
      const routed = modernList.body.result.tools.find(
        (tool: any) => tool.name === 'router.lookup'
      );
      assert.equal(routed.inputSchema.properties.region['x-mcp-header'], 'Region');
      assert.equal(
        modernList.body.result.tools.some((tool: any) => tool.name === 'router.unsafe'),
        false
      );

      const legacyList = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'routing-list-legacy',
        method: 'tools/list',
        params: {},
      });
      assert.equal(
        legacyList.body.result.tools.some(
          (tool: any) => tool.name === 'router.unsafe' || tool.name === 'unsafe'
        ),
        true
      );

      const argumentsValue = {
        region: '東京',
        options: { shard: 0, preview: false },
      };
      const success = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'routing-success',
          method: 'tools/call',
          params: {
            name: 'router.lookup',
            arguments: argumentsValue,
            _meta: mcp2026Meta(),
          },
        },
        undefined,
        {
          ...mcp2026Headers('tools/call', 'router.lookup'),
          'Mcp-Param-Region': '=?base64?5p2x5Lqs?=',
          'Mcp-Param-Shard': '0',
          'Mcp-Param-Preview': 'false',
        }
      );
      assert.equal(success.status, 200);
      assert.equal(success.body.result.isError, false);
      assert.equal(calls.length, 1);

      for (const [id, headers] of [
        [
          'routing-missing',
          {
            ...mcp2026Headers('tools/call', 'router.lookup'),
            'Mcp-Param-Shard': '0',
            'Mcp-Param-Preview': 'false',
          },
        ],
        [
          'routing-mismatch',
          {
            ...mcp2026Headers('tools/call', 'router.lookup'),
            'Mcp-Param-Region': 'east',
            'Mcp-Param-Shard': '0',
            'Mcp-Param-Preview': 'false',
          },
        ],
      ] as const) {
        const rejected = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: {
              name: 'router.lookup',
              arguments: argumentsValue,
              _meta: mcp2026Meta(),
            },
          },
          undefined,
          headers
        );
        assert.equal(rejected.status, 400);
        assert.equal(rejected.body.error.code, -32020);
      }
      assert.equal(calls.length, 1);

      const legacy = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'routing-legacy-call',
        method: 'tools/call',
        params: { name: 'router.lookup', arguments: argumentsValue },
      });
      assert.equal(legacy.status, 200);
      assert.equal(legacy.body.result.isError, false);
      assert.equal(calls.length, 2);

      const cors = await new Promise<http.IncomingHttpHeaders>((resolve, reject) => {
        const request = http.request(
          {
            host: '127.0.0.1',
            port,
            path: '/mcp',
            method: 'OPTIONS',
            headers: {
              Origin: 'http://localhost:3000',
              'Access-Control-Request-Headers': 'Mcp-Param-Attacker',
            },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.headers));
          }
        );
        request.on('error', reject);
        request.end();
      });
      const allowed = String(cors['access-control-allow-headers'] ?? '');
      assert.match(allowed, /Mcp-Param-Region/);
      assert.match(allowed, /Mcp-Param-Shard/);
      assert.doesNotMatch(allowed, /Mcp-Param-SecretRoute/);
      assert.doesNotMatch(allowed, /Mcp-Param-Attacker/);
    });
  });

  await test('server/discover returns stateless capability and app-session metadata', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'needs-config',
          name: 'needsConfig',
          path: `${process.cwd()}/needs-config.photon.ts`,
          configured: false,
          requiredParams: [
            {
              name: 'apiKey',
              envVar: 'API_KEY',
              type: 'string',
              isOptional: false,
              hasDefault: false,
              description: 'API key',
            },
          ],
        },
      ],
    });

    await withServer(context, async (port) => {
      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'discover-1',
          method: 'server/discover',
          params: {
            _meta: mcp2026PhotonMeta({
              'io.modelcontextprotocol/clientInfo': { name: 'ChatGPT', version: 'future' },
            }),
          },
        },
        undefined,
        {
          ...mcp2026Headers('server/discover'),
          'X-Photon-App-Session-Id': 'psess_header',
        }
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.result.resultType, 'complete');
      assert.deepEqual(response.body.result.supportedVersions, [
        '2025-03-26',
        '2025-11-25',
        '2026-07-28',
      ]);
      assert.equal(
        response.body.result._meta['io.modelcontextprotocol/serverInfo'].name,
        'beam-mcp'
      );
      assert.deepEqual(response.body.result.capabilities.tools, { listChanged: true });
      assert.equal(
        response.body.result.capabilities.extensions['dev.portel.photon'].requestContext,
        true
      );
      assert.match(
        response.body.result._meta['dev.portel.photon/appSessionId'],
        /^aps_[A-Za-z0-9_-]{43}$/
      );
      assert.equal(response.body.result._meta['photon/clientProfile'].mode, 'stateless');
      assert.equal(response.headers['mcp-session-id'], undefined);
      assert.equal(
        response.body.result.configurationSchema.needsConfig.properties.apiKey['x-env-var'],
        'API_KEY'
      );
    });
  });

  await test('MCP 2026 emits UI and Photon metadata only for exact per-request opt-ins', async () => {
    const broadcasts: Array<Record<string, unknown>> = [];
    const context = createTestContext({
      photons: [
        {
          id: 'ui-demo-id',
          name: 'uiDemo',
          path: `${process.cwd()}/ui-demo.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'show',
              description: 'Show the UI',
              params: { type: 'object', properties: {} },
              linkedUi: 'panel',
            },
          ],
          assets: {
            ui: [
              {
                id: 'panel',
                uri: 'ui://uiDemo/panel',
                mimeType: 'text/html;profile=mcp-app',
              },
            ],
          },
        },
      ],
      loadUIAsset: async () => ({
        content: '<main>canonical app</main>',
        isPhotonTemplate: false,
      }),
      photonMCPs: new Map([
        [
          'uiDemo',
          {
            instance: {
              show: () => ({ visible: true }),
            },
          },
        ],
      ]),
      broadcast: (message: object) => broadcasts.push(message as Record<string, unknown>),
    });

    const list = async (port: number, extensions: Record<string, Record<string, unknown>> = {}) =>
      postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: `extension-list-${Object.keys(extensions).join('-') || 'plain'}`,
          method: 'tools/list',
          params: { _meta: mcp2026ExtensionMeta(extensions) },
        },
        undefined,
        mcp2026Headers('tools/list')
      );

    await withServer(context, async (port) => {
      const plain = await list(port);
      const plainTool = plain.body.result.tools.find((tool: any) => tool.name === 'uiDemo.show');
      assert.equal(plainTool._meta, undefined);
      assert.equal(plainTool['x-photon-path'], undefined);
      assert.equal(plain.body.result._meta?.['photon/clientProfile'], undefined);

      const alias = await list(port, { 'mcp-apps': { version: '1.0.0' } });
      const aliasTool = alias.body.result.tools.find((tool: any) => tool.name === 'uiDemo.show');
      assert.equal(aliasTool._meta, undefined);

      const apps = await list(port, {
        'io.modelcontextprotocol/ui': {
          mimeTypes: ['text/html;profile=mcp-app'],
        },
      });
      const appsTool = apps.body.result.tools.find((tool: any) => tool.name === 'uiDemo.show');
      assert.equal(appsTool._meta.ui.resourceUri, 'ui://uiDemo/panel');
      assert.equal(appsTool._meta['ui/resourceUri'], 'ui://uiDemo/panel');
      assert.equal(appsTool._meta['photon/render'], undefined);
      assert.equal(appsTool['x-photon-path'], undefined);

      const appCall = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'canonical-app-call',
          method: 'tools/call',
          params: {
            name: 'uiDemo.show',
            arguments: {},
            _meta: mcp2026ExtensionMeta({
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app'],
              },
            }),
          },
        },
        undefined,
        mcp2026Headers('tools/call', 'uiDemo.show')
      );
      assert.equal(appCall.status, 200);
      assert.equal(
        broadcasts.some((message) => message.method === 'ui/notifications/tool-result'),
        false,
        'the MCP Apps host forwards its own result to its View; modern calls must not use a global broadcast'
      );

      const photon = await list(port, { 'dev.portel.photon': {} });
      const photonTool = photon.body.result.tools.find((tool: any) => tool.name === 'uiDemo.show');
      assert.equal(photonTool._meta.ui, undefined);
      assert.equal(photonTool._meta['photon/render'].mode, 'custom');
      assert.equal(photonTool['x-photon-path'], `${process.cwd()}/ui-demo.photon.ts`);

      const missingUI = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'read-ui-without-capability',
          method: 'resources/read',
          params: { uri: 'ui://uiDemo/panel', _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('resources/read', 'ui://uiDemo/panel')
      );
      assert.equal(missingUI.status, 400);
      assert.equal(missingUI.body.error.code, -32021);

      const readUI = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'read-ui-with-capability',
          method: 'resources/read',
          params: {
            uri: 'ui://uiDemo/panel',
            _meta: mcp2026ExtensionMeta({
              'io.modelcontextprotocol/ui': {
                mimeTypes: ['text/html;profile=mcp-app'],
              },
            }),
          },
        },
        undefined,
        mcp2026Headers('resources/read', 'ui://uiDemo/panel')
      );
      assert.equal(readUI.status, 200);
      assert.equal(readUI.body.result.contents[0].mimeType, 'text/html;profile=mcp-app');
      assert.equal(readUI.body.result.contents[0]._meta.ui.prefersBorder, true);
      assert.equal(readUI.body.result.contents[0]._meta['openai/widgetDescription'], undefined);
    });
  });

  await test('legacy discovery and list responses preserve the 2025 wire shape', async () => {
    const context = createTestContext();

    await withServer(context, async (port) => {
      const discovery = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-discover',
        method: 'server/discover',
        params: {},
      });

      assert.equal(discovery.status, 200);
      assert.equal(discovery.body.result.protocolVersion, '2025-11-25');
      assert.deepEqual(discovery.body.result.supportedProtocolVersions, [
        '2025-03-26',
        '2025-11-25',
        '2026-07-28',
      ]);
      assert.equal(discovery.body.result.supportedVersions, undefined);
      assert.equal(discovery.body.result.resultType, undefined);
      assert.equal(discovery.body.result.serverInfo.name, 'beam-mcp');
      assert.equal(typeof discovery.headers['mcp-session-id'], 'string');

      const list = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-list',
        method: 'tools/list',
        params: {},
      });
      assert.equal(list.status, 200);
      assert.equal(list.body.result.resultType, undefined);
      assert.equal(list.body.result._meta?.['io.modelcontextprotocol/serverInfo'], undefined);
      assert.equal(typeof list.headers['mcp-session-id'], 'string');
    });
  });

  await test('legacy-only lifecycle and task methods are isolated from MCP 2026', async () => {
    const context = createTestContext();

    await withServer(context, async (port) => {
      for (const method of ['tasks/create', 'tasks/list', 'tasks/result']) {
        const response = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: `legacy-${method}-on-2026`,
            method,
            params: { _meta: mcp2026Meta() },
          },
          undefined,
          mcp2026Headers(method)
        );

        assert.equal(response.status, 404, method);
        assert.equal(response.body.error.code, -32601, method);
        assert.match(response.body.error.message, /not available in MCP 2026/, method);
        assert.equal(response.headers['mcp-session-id'], undefined, method);
      }
    });
  });

  await test('wire adapters map unknown methods without changing legacy HTTP behavior', async () => {
    await withServer(createTestContext(), async (port) => {
      const modern = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'modern-unknown-method',
          method: 'com.example/unknown',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('com.example/unknown')
      );
      assert.equal(modern.status, 404);
      assert.equal(modern.body.error.code, -32601);
      assert.equal(modern.headers['mcp-session-id'], undefined);

      const legacy = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-unknown-method',
        method: 'com.example/unknown',
        params: {},
      });
      assert.equal(legacy.status, 200);
      assert.equal(legacy.body.error.code, -32601);
      assert.equal(typeof legacy.headers['mcp-session-id'], 'string');
    });
  });

  await test('MCP 2026 subscriptions/listen streams only requested notifications', async () => {
    const context = createTestContext();

    await withServer(context, async (port) => {
      const subscriptionId = 'listen-tools-only';
      const subscribedResourceUri = 'photon://demo/items/alpha';
      let notifyResourceUpdated: ((uri: string) => void | Promise<void>) | undefined;
      attachLoaderForResourceUpdates({
        setResourceUpdateNotifier: (notifier) => {
          notifyResourceUpdated = notifier;
        },
      });
      const stream = await openSubscriptionStream(port, {
        jsonrpc: '2.0',
        id: subscriptionId,
        method: 'subscriptions/listen',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'photon-regression', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
          notifications: {
            toolsListChanged: true,
            promptsListChanged: false,
            resourcesListChanged: false,
            resourceSubscriptions: [subscribedResourceUri],
          },
        },
      });

      try {
        assert.match(String(stream.headers['content-type']), /^text\/event-stream/);
        assert.equal(stream.headers['mcp-session-id'], undefined);

        const acknowledgement = await stream.waitFor(
          (event) => event.method === 'notifications/subscriptions/acknowledged'
        );
        assert.equal(
          stream.events[0],
          acknowledgement,
          'acknowledgement must be the first SSE event'
        );
        assert.deepEqual(acknowledgement.params.notifications, {
          toolsListChanged: true,
          resourceSubscriptions: [subscribedResourceUri],
        });
        assert.equal(
          acknowledgement.params._meta['io.modelcontextprotocol/subscriptionId'],
          subscriptionId
        );

        // The stream explicitly opted out of prompt changes, so this legacy
        // broadcast must not appear on the 2026 subscription.
        broadcastNotification('notifications/prompts/list_changed');
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(
          stream.events.some((event) => event.method === 'notifications/prompts/list_changed'),
          false
        );

        broadcastNotification('notifications/tools/list_changed');
        const toolChange = await stream.waitFor(
          (event) => event.method === 'notifications/tools/list_changed'
        );
        assert.equal(
          toolChange.params._meta['io.modelcontextprotocol/subscriptionId'],
          subscriptionId
        );

        assert(notifyResourceUpdated, 'loader should receive a resource-update notifier');
        await notifyResourceUpdated('photon://demo/items/not-requested');
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(
          stream.events.some(
            (event) =>
              event.method === 'notifications/resources/updated' &&
              event.params.uri === 'photon://demo/items/not-requested'
          ),
          false
        );
        await notifyResourceUpdated(subscribedResourceUri);
        const resourceUpdate = await stream.waitFor(
          (event) => event.method === 'notifications/resources/updated'
        );
        assert.equal(resourceUpdate.params.uri, subscribedResourceUri);
        assert.equal(
          resourceUpdate.params._meta['io.modelcontextprotocol/subscriptionId'],
          subscriptionId
        );
      } finally {
        // Closing the response stream is the MCP 2026 HTTP cancellation path.
        stream.close();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
  });

  await test('MCP 2026 subscriptions/listen requires an explicit notifications filter', async () => {
    await withServer(createTestContext(), async (port) => {
      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'listen-missing-filter',
          method: 'subscriptions/listen',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'photon-regression', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        },
        undefined,
        {
          Accept: 'application/json, text/event-stream',
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'subscriptions/listen',
        }
      );

      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, -32602);
      assert.match(response.body.error.message, /notifications/i);
    });
  });

  await test('advertised MCP 2026 list invalidations reach opted-in subscriptions', async () => {
    await withServer(createTestContext(), async (port) => {
      const subscriptionId = 'listen-all-list-invalidations';
      const stream = await openSubscriptionStream(port, {
        jsonrpc: '2.0',
        id: subscriptionId,
        method: 'subscriptions/listen',
        params: {
          _meta: mcp2026Meta(),
          notifications: {
            toolsListChanged: true,
            promptsListChanged: true,
            resourcesListChanged: true,
          },
        },
      });

      try {
        await stream.waitFor(
          (event) => event.method === 'notifications/subscriptions/acknowledged'
        );
        broadcastMCPListChanges();
        for (const method of [
          'notifications/tools/list_changed',
          'notifications/prompts/list_changed',
          'notifications/resources/list_changed',
        ]) {
          const event = await stream.waitFor((candidate) => candidate.method === method);
          assert.equal(
            event.params._meta['io.modelcontextprotocol/subscriptionId'],
            subscriptionId
          );
        }
      } finally {
        stream.close();
      }
    });
  });

  await test('MCP 2026 bounds subscription filters and per-caller streams', async () => {
    await withServer(createTestContext(), async (port) => {
      const limits = __streamableHttpTransportInternals.statelessSubscriptionLimits();
      const excessiveFilters = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'listen-too-many-filters',
          method: 'subscriptions/listen',
          params: {
            _meta: mcp2026Meta(),
            notifications: {
              resourceSubscriptions: Array.from(
                { length: limits.resourceFilters + 1 },
                (_, index) => `photon://resource/${index}`
              ),
            },
          },
        },
        undefined,
        mcp2026Headers('subscriptions/listen')
      );
      assert.equal(excessiveFilters.status, 400);
      assert.match(excessiveFilters.body.error.message, /exceeds/);

      const streams: Awaited<ReturnType<typeof openSubscriptionStream>>[] = [];
      try {
        for (let index = 0; index < limits.perPrincipal; index += 1) {
          streams.push(
            await openSubscriptionStream(port, {
              jsonrpc: '2.0',
              id: `bounded-listener-${index}`,
              method: 'subscriptions/listen',
              params: {
                _meta: mcp2026Meta(),
                notifications: { toolsListChanged: true },
              },
            })
          );
        }
        assert.equal(
          __streamableHttpTransportInternals.activeStatelessSubscriptionCount(),
          limits.perPrincipal
        );
        const rejected = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: 'bounded-listener-rejected',
            method: 'subscriptions/listen',
            params: {
              _meta: mcp2026Meta(),
              notifications: { toolsListChanged: true },
            },
          },
          undefined,
          mcp2026Headers('subscriptions/listen')
        );
        assert.equal(rejected.status, 429);
      } finally {
        for (const stream of streams) stream.close();
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(__streamableHttpTransportInternals.activeStatelessSubscriptionCount(), 0);
    });
  });

  await test('MCP 2026 gracefully terminates subscriptions during shutdown', async () => {
    await withServer(createTestContext(), async (port) => {
      const stream = await openSubscriptionStream(port, {
        jsonrpc: '2.0',
        id: 'graceful-listener',
        method: 'subscriptions/listen',
        params: {
          _meta: mcp2026Meta(),
          notifications: { toolsListChanged: true },
        },
      });
      await stream.waitFor((event) => event.method === 'notifications/subscriptions/acknowledged');
      const completed = stream.waitFor(
        (event) => event.id === 'graceful-listener' && event.result?.resultType === 'complete'
      );
      stopSessionCleanup();
      const finalEvent = await completed;
      assert.equal(
        finalEvent.result._meta['io.modelcontextprotocol/subscriptionId'],
        'graceful-listener'
      );
      assert.equal(__streamableHttpTransportInternals.activeStatelessSubscriptionCount(), 0);
    });
  });

  await test('MCP 2026 disconnects a slow subscriber at the bounded queue limit', async () => {
    await withServer(createTestContext(), async (port) => {
      const slow = await openPausedSubscription(port, 'slow-listener');
      try {
        const padding = 'x'.repeat(32 * 1024);
        for (let index = 0; index < 512; index += 1) {
          broadcastNotification('notifications/tools/list_changed', { index, padding });
          if (__streamableHttpTransportInternals.activeStatelessSubscriptionCount() === 0) break;
        }
        assert.equal(__streamableHttpTransportInternals.activeStatelessSubscriptionCount(), 0);

        const healthy = await openSubscriptionStream(port, {
          jsonrpc: '2.0',
          id: 'healthy-after-slow',
          method: 'subscriptions/listen',
          params: {
            _meta: mcp2026Meta(),
            notifications: { toolsListChanged: true },
          },
        });
        try {
          await healthy.waitFor(
            (event) => event.method === 'notifications/subscriptions/acknowledged'
          );
          broadcastNotification('notifications/tools/list_changed');
          await healthy.waitFor((event) => event.method === 'notifications/tools/list_changed');
        } finally {
          healthy.close();
        }
      } finally {
        slow.close();
      }
    });
  });

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
      const tool = response.body.result.tools.find((entry: any) => entry.name === 'demo.rows');
      assert(tool, 'expected demo.rows tool');
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

  await test('tools/list advertises TSX app entries as web apps', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'demo-id',
          name: 'demo',
          path: `${process.cwd()}/demo.photon.ts`,
          configured: true,
          isApp: true,
          appEntry: { name: 'main', linkedUi: 'app' },
          assets: {
            ui: [{ id: 'app', path: `${process.cwd()}/ui/app.tsx` }],
          },
          description: 'Demo app',
          methods: [
            {
              name: 'main',
              description: 'Open the demo app',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              linkedUi: 'app',
            },
          ],
        },
      ],
      photonMCPs: new Map([['demo', { instance: { main: () => ({ app: 'demo' }) } }]]),
    });

    await withServer(context, async (port) => {
      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      assert.equal(response.status, 200);
      const tool = response.body.result.tools.find((entry: any) => entry.name === 'demo.main');
      assert(tool, 'expected demo.main tool');
      assert.equal(tool['x-web-url'], '/web/demo/');
      assert.equal(tool['x-web-description'], 'Demo app');
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
      assert.equal(toolPage1.body.result.ttlMs, 30000);
      assert.equal(toolPage1.body.result.cacheScope, 'private');

      const toolPage2 = await postJSON(port, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list',
        params: { cursor: toolPage1.body.result.nextCursor },
      });
      assert.equal(toolPage2.status, 200);
      const toolNames = [...toolPage1.body.result.tools, ...toolPage2.body.result.tools].map(
        (tool: any) => tool.name
      );
      assert.equal(new Set(toolNames).size, toolNames.length);
      assert(toolNames.includes('demo.method100'));

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
        assert.equal(page1.body.result.ttlMs, 30000);
        assert.equal(page1.body.result.cacheScope, 'private');

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

  await test('MCP 2026 list pages are deterministic and retain legacy cursor decoding', async () => {
    const methods = Array.from({ length: 105 }, (_, index) => ({
      name: `method-${String(index).padStart(3, '0')}`,
      description: `Method ${index}`,
      params: { type: 'object', properties: {} },
    }));
    const uiAssets = Array.from({ length: 105 }, (_, index) => ({
      id: `view-${String(index).padStart(3, '0')}`,
      uri: `ui://demo/view-${String(index).padStart(3, '0')}`,
      mimeType: 'text/html;profile=mcp-app',
    }));
    const statics = Array.from({ length: 105 }, (_, index) => ({
      uri: `demo://items/${String(index).padStart(3, '0')}/{id}`,
      name: `item-${String(index).padStart(3, '0')}`,
      mimeType: 'application/json',
    }));
    const templates = Array.from({ length: 105 }, (_, index) => ({
      name: `prompt-${String(index).padStart(3, '0')}`,
      description: `Prompt ${index}`,
      inputSchema: { type: 'object', properties: {} },
    }));
    const makeContext = (reverse: boolean) =>
      createTestContext({
        photons: [
          {
            id: 'deterministic-demo',
            name: 'demo',
            path: `${process.cwd()}/demo.photon.ts`,
            configured: true,
            methods: reverse ? [...methods].reverse() : methods,
            assets: { ui: reverse ? [...uiAssets].reverse() : uiAssets },
          },
        ],
        photonMCPs: new Map([
          [
            'demo',
            {
              instance: {},
              statics: reverse ? [...statics].reverse() : statics,
              templates: reverse ? [...templates].reverse() : templates,
            },
          ],
        ]),
      });
    const endpoints = [
      ['tools/list', 'tools', 'name'],
      ['resources/list', 'resources', 'uri'],
      ['resources/templates/list', 'resourceTemplates', 'uriTemplate'],
      ['prompts/list', 'prompts', 'name'],
    ] as const;

    const collectPages = async (context: any) => {
      const collected: Record<string, { first: string[]; second: string[]; cursor: string }> = {};
      await withServer(context, async (port) => {
        for (const [method, collection, key] of endpoints) {
          const first = await postJSON(
            port,
            {
              jsonrpc: '2.0',
              id: `${method}-deterministic-1`,
              method,
              params: { _meta: mcp2026Meta() },
            },
            undefined,
            mcp2026Headers(method)
          );
          const cursor = first.body.result.nextCursor;
          assert.equal(typeof cursor, 'string');
          const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          assert.deepEqual(decoded, { v: 1, offset: 100 });
          const second = await postJSON(
            port,
            {
              jsonrpc: '2.0',
              id: `${method}-deterministic-2`,
              method,
              params: { cursor, _meta: mcp2026Meta() },
            },
            undefined,
            mcp2026Headers(method)
          );
          const firstIds = first.body.result[collection].map((item: any) => item[key]);
          const secondIds = second.body.result[collection].map((item: any) => item[key]);
          assert.deepEqual(firstIds, [...firstIds].sort());
          assert.equal(
            new Set([...firstIds, ...secondIds]).size,
            firstIds.length + secondIds.length
          );
          collected[method] = { first: firstIds, second: secondIds, cursor };
        }

        for (const cursor of [
          '100',
          Buffer.from(JSON.stringify({ offset: 100 }), 'utf8').toString('base64url'),
        ]) {
          const response = await postJSON(
            port,
            {
              jsonrpc: '2.0',
              id: `legacy-cursor-${cursor}`,
              method: 'prompts/list',
              params: { cursor, _meta: mcp2026Meta() },
            },
            undefined,
            mcp2026Headers('prompts/list')
          );
          assert.equal(response.status, 200);
          assert(response.body.result.prompts.length > 0);
        }
      });
      return collected;
    };

    const forward = await collectPages(makeContext(false));
    const reversed = await collectPages(makeContext(true));
    assert.deepEqual(reversed, forward);
  });

  await test('offset cursors stay valid across mutations with documented duplicate/gap semantics', async () => {
    const methods = Array.from({ length: 120 }, (_, index) => ({
      name: `method-${String(index).padStart(3, '0')}`,
      description: `Method ${index}`,
      params: { type: 'object', properties: {} },
    }));
    const context = createTestContext({
      photons: [
        {
          id: 'mutable-demo',
          name: 'mutable',
          path: `${process.cwd()}/mutable.photon.ts`,
          configured: true,
          methods,
        },
      ],
    });

    await withServer(context, async (port) => {
      const list = async (cursor?: string) =>
        postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: `mutable-${cursor ?? 'first'}`,
            method: 'tools/list',
            params: {
              ...(cursor ? { cursor } : {}),
              _meta: mcp2026Meta(),
            },
          },
          undefined,
          mcp2026Headers('tools/list')
        );
      const first = await list();
      const cursor = first.body.result.nextCursor as string;
      const baselineSecond = await list(cursor);
      const firstNames = first.body.result.tools.map((tool: any) => tool.name);
      const baselineSecondNames = baselineSecond.body.result.tools.map((tool: any) => tool.name);

      methods.push({
        name: '000-before-boundary',
        description: 'Inserted before the old offset boundary',
        params: { type: 'object', properties: {} },
      });
      const afterInsertion = await list(cursor);
      const insertedPageNames = afterInsertion.body.result.tools.map((tool: any) => tool.name);
      assert(
        insertedPageNames.some((name: string) => firstNames.includes(name)),
        'an insertion before an offset cursor may repeat a boundary item'
      );

      methods.pop();
      methods.shift();
      const afterRemoval = await list(cursor);
      const removedPageNames = afterRemoval.body.result.tools.map((tool: any) => tool.name);
      assert.equal(afterRemoval.status, 200);
      assert.equal(
        removedPageNames.includes(baselineSecondNames[0]),
        false,
        'a removal before an offset cursor may skip the former first boundary item'
      );
    });
  });

  await test('every MCP 2026 cacheable operation declares safe cache metadata', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'cache-demo',
          name: 'cacheDemo',
          path: `${process.cwd()}/cache-demo.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'run',
              description: 'Run',
              params: { type: 'object', properties: {} },
            },
          ],
          assets: {
            ui: [
              {
                id: 'panel',
                uri: 'ui://cacheDemo/panel',
                mimeType: 'text/html;profile=mcp-app',
              },
            ],
          },
        },
      ],
      photonMCPs: new Map([
        [
          'cacheDemo',
          {
            instance: {},
            statics: [
              {
                uri: 'cache://items/{id}',
                name: 'item',
                mimeType: 'application/json',
              },
              {
                uri: 'cache://live',
                name: 'live',
                mimeType: 'application/json',
              },
            ],
            templates: [
              {
                name: 'summarize',
                description: 'Summarize',
                inputSchema: { type: 'object', properties: {} },
              },
            ],
          },
        ],
      ]),
      loadUIAsset: async () => ({
        content: '<main>cache-safe</main>',
        isPhotonTemplate: false,
      }),
      loader: {
        executeTool: async () => ({ value: 'caller-shaped' }),
      },
      verifyBearerToken: async (token: string) =>
        token === 'verified-cache-token'
          ? {
              ok: true,
              claims: {
                sub: 'authenticated-cache-user',
                scope: '',
              },
            }
          : { ok: false, reason: 'bad_signature' },
    });

    await withServer(context, async (port) => {
      for (const [method, params] of [
        ['tools/list', {}],
        ['prompts/list', {}],
        ['resources/list', {}],
        ['resources/templates/list', {}],
        ['resources/read', { uri: 'ui://cacheDemo/panel' }],
      ] as const) {
        const response = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: `cache-${method}`,
            method,
            params: {
              ...params,
              _meta:
                'uri' in params && params.uri.startsWith('ui://')
                  ? mcp2026ExtensionMeta({
                      'io.modelcontextprotocol/ui': {
                        mimeTypes: ['text/html;profile=mcp-app'],
                      },
                    })
                  : mcp2026Meta(),
            },
          },
          undefined,
          mcp2026Headers(method, 'uri' in params ? params.uri : undefined)
        );
        assert.equal(response.status, 200);
        assert.equal(Number.isInteger(response.body.result.ttlMs), true);
        assert(response.body.result.ttlMs >= 0);
        assert.equal(
          response.body.result.cacheScope,
          'uri' in params && params.uri.startsWith('ui://') ? 'private' : 'public'
        );
      }

      const dynamic = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'cache-dynamic-resource',
          method: 'resources/read',
          params: { uri: 'cache://live', _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('resources/read', 'cache://live')
      );
      assert.equal(dynamic.status, 200);
      assert.equal(dynamic.body.result.ttlMs, 0);
      assert.equal(dynamic.body.result.cacheScope, 'private');

      const legacyRead = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'cache-legacy-resource-read',
        method: 'resources/read',
        params: { uri: 'ui://cacheDemo/panel' },
      });
      assert.equal(legacyRead.status, 200);
      assert.equal(legacyRead.body.result.ttlMs, undefined);
      assert.equal(legacyRead.body.result.cacheScope, undefined);

      const issuedSession = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'cache-session-discovery',
          method: 'server/discover',
          params: { _meta: mcp2026PhotonMeta() },
        },
        undefined,
        mcp2026Headers('server/discover')
      );
      assert.equal(issuedSession.status, 200);
      const appSession = issuedSession.body.result._meta['dev.portel.photon/appSessionId'];
      assert.match(appSession, /^aps_[A-Za-z0-9_-]{43}$/);

      const explicitSession = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'cache-explicit-session',
          method: 'tools/list',
          params: {
            _meta: {
              ...mcp2026PhotonMeta(),
              'dev.portel.photon/appSessionId': appSession,
            },
          },
        },
        undefined,
        mcp2026Headers('tools/list')
      );
      assert.equal(explicitSession.body.result.cacheScope, 'private');
      assert.equal(explicitSession.body.result._meta['dev.portel.photon/appSessionId'], appSession);

      const publicResults = [];
      for (const clientName of ['anonymous-a', 'anonymous-b']) {
        const response = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: 'cache-client-name-independent',
            method: 'tools/list',
            params: {
              _meta: mcp2026Meta({
                'io.modelcontextprotocol/clientInfo': {
                  name: clientName,
                  version: '1.0.0',
                },
              }),
            },
          },
          undefined,
          mcp2026Headers('tools/list')
        );
        assert.equal(response.body.result.cacheScope, 'public');
        assert.equal(response.body.result._meta?.['photon/clientProfile'], undefined);
        publicResults.push(response.body.result);
      }
      assert.deepEqual(publicResults[1], publicResults[0]);

      const publicPromptResults = [];
      for (const clientCapabilities of [{}, { sampling: {} }]) {
        const response = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: 'cache-capability-independent',
            method: 'prompts/list',
            params: {
              _meta: mcp2026Meta({
                'io.modelcontextprotocol/clientCapabilities': clientCapabilities,
              }),
            },
          },
          undefined,
          mcp2026Headers('prompts/list')
        );
        assert.equal(response.body.result.cacheScope, 'public');
        publicPromptResults.push(response.body.result);
      }
      assert.deepEqual(publicPromptResults[1], publicPromptResults[0]);

      const authenticated = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'cache-authenticated',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        {
          ...mcp2026Headers('tools/list'),
          Authorization: 'Bearer verified-cache-token',
        }
      );
      assert.equal(authenticated.body.result.cacheScope, 'private');
    });

    assert.equal(
      __streamableHttpTransportInternals.cacheScopeForRequest({
        requestContext: { scopeDir: '/scoped/project' },
      } as any),
      'private',
      'claim-scoped responses must never enter a shared cache'
    );
  });

  await test('stateless list responses include cache and Photon request metadata', async () => {
    const context = createTestContext({
      photons: [
        {
          id: 'demo-id',
          name: 'demo',
          path: `${process.cwd()}/demo.photon.ts`,
          configured: true,
          methods: [
            {
              name: 'run',
              description: 'Run demo',
              params: { type: 'object', properties: {} },
            },
          ],
        },
      ],
    });

    await withServer(context, async (port) => {
      const issuedSession = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'stateless-list-session-discovery',
          method: 'server/discover',
          params: {
            _meta: mcp2026PhotonMeta({
              'io.modelcontextprotocol/clientInfo': { name: 'ChatGPT', version: 'future' },
            }),
          },
        },
        undefined,
        mcp2026Headers('server/discover')
      );
      assert.equal(issuedSession.status, 200);
      const appSession = issuedSession.body.result._meta['dev.portel.photon/appSessionId'];

      const response = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'stateless-list',
          method: 'tools/list',
          params: {
            _meta: {
              ...mcp2026PhotonMeta({
                'io.modelcontextprotocol/clientInfo': { name: 'ChatGPT', version: 'future' },
              }),
              'dev.portel.photon/appSessionId': appSession,
            },
          },
        },
        undefined,
        {
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        }
      );

      assert.equal(response.status, 200);
      assert.equal(response.body.result.ttlMs, 30000);
      assert.equal(response.body.result.cacheScope, 'private');
      assert.equal(response.body.result._meta['dev.portel.photon/appSessionId'], appSession);
      assert.equal(response.body.result._meta['photon/clientProfile'].mode, 'stateless');
      assert.equal(response.body.result.resultType, 'complete');
      assert.equal(
        response.body.result._meta['io.modelcontextprotocol/serverInfo'].name,
        'beam-mcp'
      );
      assert.equal(response.headers['mcp-session-id'], undefined);
      assert.equal(
        response.body.result._meta['photon/clientProfile'].protocolVersion,
        '2026-07-28'
      );
      assert(response.body.result.tools.some((tool: any) => tool.name === 'demo.run'));
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
        (entry: any) => entry.name === 'tasks.createTask'
      );
      assert(tool, 'expected tasks.createTask tool');
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
      for (const cursor of [
        'not-a-valid-cursor',
        Buffer.from(JSON.stringify({ v: 2, offset: 0 }), 'utf8').toString('base64url'),
        String(Number.MAX_SAFE_INTEGER + 1),
      ]) {
        const response = await postJSON(port, {
          jsonrpc: '2.0',
          id: `invalid-${cursor}`,
          method: 'tools/list',
          params: { cursor },
        });

        assert.equal(response.status, 200);
        assert.equal(response.body.error.code, -32602);
        assert.match(response.body.error.message, /Invalid pagination cursor/);
      }
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
            {
              name: 'tags',
              description: 'List tags',
              params: { type: 'object', properties: {} },
              returns: { type: 'array', items: { type: 'string' } },
              outputSchema: { type: 'array', items: { type: 'string' } },
            },
            {
              name: 'label',
              description: 'Return a string',
              params: { type: 'object', properties: {} },
              returns: { type: 'string' },
              outputSchema: { type: 'string', const: 'alpha' },
            },
            {
              name: 'zero',
              description: 'Return zero',
              params: { type: 'object', properties: {} },
              returns: { type: 'number' },
              outputSchema: { type: 'number' },
            },
            {
              name: 'disabled',
              description: 'Return false',
              params: { type: 'object', properties: {} },
              returns: { type: 'boolean' },
              outputSchema: { type: 'boolean' },
            },
            {
              name: 'nothing',
              description: 'Return null',
              params: { type: 'object', properties: {} },
              returns: { type: 'null' },
              outputSchema: { type: 'null' },
            },
            {
              name: 'invalid',
              description: 'Return an invalid declared result',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              outputSchema: {
                type: 'object',
                required: ['count'],
                properties: { count: { type: 'integer' } },
              },
            },
            {
              name: 'unsafeSchema',
              description: 'Declare a forbidden external reference',
              params: { type: 'object', properties: {} },
              returns: { type: 'object' },
              outputSchema: { $ref: 'https://example.invalid/output.json' },
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
              tags: () => ['alpha', 'beta'],
              label: () => 'alpha',
              zero: () => 0,
              disabled: () => false,
              nothing: () => null,
              invalid: () => ({ count: 'wrong' }),
              unsafeSchema: () => ({ count: 1 }),
            },
          },
        ],
      ]),
    });

    await withServer(context, async (port) => {
      const listed = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'schema-list',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('tools/list')
      );
      const listedLabel = listed.body.result.tools.find((tool: any) => tool.name === 'demo.label');
      assert.equal(listedLabel.inputSchema.type, 'object');
      assert.equal(
        listedLabel.outputSchema.$schema,
        'https://json-schema.org/draft/2020-12/schema'
      );
      const legacyListed = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-schema-list',
        method: 'tools/list',
        params: {},
      });
      const legacyListedLabel = legacyListed.body.result.tools.find(
        (tool: any) => tool.name === 'demo.label'
      );
      assert.equal(legacyListedLabel.outputSchema.$schema, undefined);

      const response = await postJSON(port, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'demo.rows', arguments: {} },
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

      const legacyArray = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-array',
        method: 'tools/call',
        params: { name: 'demo.tags', arguments: {} },
      });
      assert.equal(legacyArray.body.result.structuredContent, undefined);

      const statelessArray = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'stateless-array',
          method: 'tools/call',
          params: { name: 'demo.tags', arguments: {}, _meta: mcp2026Meta() },
        },
        undefined,
        {
          'Mcp-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'demo.tags',
        }
      );
      assert.deepEqual(statelessArray.body.result.structuredContent, ['alpha', 'beta']);
      assert.equal(statelessArray.body.result.resultType, 'complete');

      for (const [name, expected] of [
        ['label', 'alpha'],
        ['zero', 0],
        ['disabled', false],
        ['nothing', null],
      ] as const) {
        const modern = await postJSON(
          port,
          {
            jsonrpc: '2.0',
            id: `modern-${name}`,
            method: 'tools/call',
            params: {
              name: `demo.${name}`,
              arguments: {},
              _meta: mcp2026Meta(),
            },
          },
          undefined,
          mcp2026Headers('tools/call', `demo.${name}`)
        );
        assert.equal(modern.body.result.isError, false);
        assert.deepEqual(modern.body.result.structuredContent, expected);

        const legacy = await postJSON(port, {
          jsonrpc: '2.0',
          id: `legacy-${name}`,
          method: 'tools/call',
          params: { name: `demo.${name}`, arguments: {} },
        });
        assert.equal(legacy.body.result.isError, false);
        assert.equal(legacy.body.result.structuredContent, undefined);
      }

      const invalid = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'modern-invalid-output',
          method: 'tools/call',
          params: {
            name: 'demo.invalid',
            arguments: {},
            _meta: mcp2026PhotonMeta(),
          },
        },
        undefined,
        mcp2026Headers('tools/call', 'demo.invalid')
      );
      assert.equal(invalid.status, 200);
      assert.equal(invalid.body.result.isError, true);
      assert.equal(invalid.body.result.structuredContent.error.code, 'PHOTON_TOOL_OUTPUT_INVALID');
      assert.equal(invalid.body.result.structuredContent.count, undefined);
      assert.equal(invalid.body.result._meta['photon/outputValidation'].kind, 'invalid-output');
      const legacyInvalid = await postJSON(port, {
        jsonrpc: '2.0',
        id: 'legacy-invalid-output',
        method: 'tools/call',
        params: { name: 'demo.invalid', arguments: {} },
      });
      assert.equal(legacyInvalid.body.result.isError, true);
      assert.equal(
        legacyInvalid.body.result.structuredContent.error.code,
        'PHOTON_TOOL_OUTPUT_INVALID'
      );
      assert.equal(legacyInvalid.body.result.structuredContent.count, undefined);
      assert.equal(
        legacyInvalid.body.result._meta['photon/outputValidation'].kind,
        'invalid-output'
      );

      const unsafeSchema = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'modern-unsafe-output-schema',
          method: 'tools/call',
          params: {
            name: 'demo.unsafeSchema',
            arguments: {},
            _meta: mcp2026PhotonMeta(),
          },
        },
        undefined,
        mcp2026Headers('tools/call', 'demo.unsafeSchema')
      );
      assert.equal(unsafeSchema.status, 200);
      assert.equal(unsafeSchema.body.result.isError, true);
      assert.equal(
        unsafeSchema.body.result.structuredContent.error.code,
        'PHOTON_TOOL_OUTPUT_INVALID'
      );
      assert.equal(
        unsafeSchema.body.result._meta['photon/outputValidation'].kind,
        'invalid-schema'
      );
    });
  });

  await test('external MCP output schemas are preserved and enforced', async () => {
    const outputSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $defs: { value: { type: 'string', minLength: 1 } },
      oneOf: [{ $ref: '#/$defs/value' }, { type: 'null' }],
    };
    const context = createTestContext({
      externalMCPs: [
        {
          id: 'external-upstream',
          name: 'upstream',
          connected: true,
          methods: [
            {
              name: 'valid',
              description: 'Valid external result',
              params: { type: 'object', properties: {} },
              returns: {},
              outputSchema,
            },
            {
              name: 'invalid',
              description: 'Invalid external result',
              params: { type: 'object', properties: {} },
              returns: {},
              outputSchema: { type: 'integer' },
            },
          ],
        },
      ],
      externalMCPSDKClients: new Map([
        [
          'upstream',
          {
            callTool: async ({ name }: { name: string }) => ({
              content: [{ type: 'text', text: name === 'valid' ? 'ok' : 'wrong' }],
              structuredContent: name === 'valid' ? 'ok' : 'wrong',
              isError: false,
            }),
          },
        ],
      ]),
    });

    await withServer(context, async (port) => {
      const listed = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'external-schema-list',
          method: 'tools/list',
          params: { _meta: mcp2026Meta() },
        },
        undefined,
        mcp2026Headers('tools/list')
      );
      const externalTool = listed.body.result.tools.find(
        (tool: any) => tool.name === 'upstream.valid'
      );
      assert.deepEqual(externalTool.outputSchema, outputSchema);

      const valid = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'external-schema-valid',
          method: 'tools/call',
          params: {
            name: 'upstream.valid',
            arguments: {},
            _meta: mcp2026PhotonMeta(),
          },
        },
        undefined,
        mcp2026Headers('tools/call', 'upstream.valid')
      );
      assert.equal(valid.body.result.isError, false);
      assert.equal(valid.body.result.structuredContent, 'ok');

      const invalid = await postJSON(
        port,
        {
          jsonrpc: '2.0',
          id: 'external-schema-invalid',
          method: 'tools/call',
          params: {
            name: 'upstream.invalid',
            arguments: {},
            _meta: mcp2026PhotonMeta(),
          },
        },
        undefined,
        mcp2026Headers('tools/call', 'upstream.invalid')
      );
      assert.equal(invalid.body.result.isError, true);
      assert.equal(invalid.body.result.structuredContent.error.code, 'PHOTON_TOOL_OUTPUT_INVALID');
      assert.equal(invalid.body.result._meta['photon/outputValidation'].kind, 'invalid-output');
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
