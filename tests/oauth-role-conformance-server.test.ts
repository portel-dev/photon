/**
 * OAuth role conformance through PhotonServer's MCP HTTP interface.
 *
 * Run with:
 *   bunx tsx tests/oauth-role-conformance-server.test.ts
 *
 * Stricter expected-failure assertions for optional-auth challenges and
 * insufficient-scope status semantics live in the companion
 * oauth-role-conformance-gaps.test.ts file.
 */

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PhotonServer } from '../src/server.js';

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/oauth-role-conformance/roles.photon.ts'
);

type JsonRpcResponse = {
  result?: {
    tools?: Array<{ name: string; scopes?: string[] }>;
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  error?: { message?: string; data?: { reason?: string } };
};

type PostResult = {
  status: number;
  body: JsonRpcResponse;
  wwwAuthenticate: string | null;
};

const oldEnv = { ...process.env };

async function postMcp(port: number, body: unknown, token?: string): Promise<PostResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as JsonRpcResponse,
    wwwAuthenticate: response.headers.get('www-authenticate'),
  };
}

function toolNames(body: JsonRpcResponse): string[] {
  // PhotonServer adds its built-in context/navigation/skill tools to the MCP
  // catalog. They are transport infrastructure, not role-tagged fixture
  // tools, so keep the conformance assertion focused on the Photon surface.
  return (body.result?.tools ?? [])
    .filter((tool) => !tool.name.startsWith('photon_'))
    .map((tool) => tool.name)
    .sort();
}

function resultText(body: JsonRpcResponse): string {
  return (body.result?.content ?? []).map((content) => content.text ?? '').join('\n');
}

function oauthToken(
  server: PhotonServer,
  input: { sub: string; scope: string; expiresInSeconds?: number; audience?: string }
): string {
  const runtime = (server as any).oauthRuntime;
  assert.ok(runtime, 'PhotonOAuthRuntime should be initialized by server.start()');
  const now = Math.floor(Date.now() / 1000);
  return runtime.serv.jwtService.exchangeSign({
    iss: runtime.issuer,
    sub: input.sub,
    aud: input.audience ?? runtime.resource,
    exp: now + (input.expiresInSeconds ?? 900),
    iat: now,
    jti: `oauth-role-conformance-${input.sub}-${now}`,
    tenant_id: runtime.tenant.id,
    client_id: 'oauth-role-conformance-client',
    scope: input.scope,
  });
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  const keypair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.PHOTON_OAUTH_HOST_SUBJECTS = 'host-1';
  delete process.env.PHOTON_OAUTH_SINGLE_USER_ID;
  delete process.env.PHOTON_OAUTH_SUBJECT_HEADER;
  process.env.PHOTON_OAUTH_JWT_SECRET = 'oauth-role-conformance-jwt-secret';
  process.env.PHOTON_OAUTH_ENCRYPTION_KEY = 'oauth-role-conformance-encryption-key';
  process.env.PHOTON_OAUTH_STATE_SECRET = 'oauth-role-conformance-state-secret';
  process.env.PHOTON_OAUTH_PRIVATE_KEY_PEM = keypair.privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
  process.env.PHOTON_OAUTH_PUBLIC_KEY_PEM = keypair.publicKey
    .export({ format: 'pem', type: 'spki' })
    .toString();

  const port = 31000 + Math.floor(Math.random() * 20000);
  const server = new PhotonServer({ filePath: fixturePath, transport: 'sse', port });

  try {
    await server.start();
    const customerRead = oauthToken(server, {
      sub: 'customer-1',
      scope: 'bookings:read',
    });
    const customerBroad = oauthToken(server, {
      sub: 'customer-1',
      scope: 'bookings:read availability:write',
    });
    const host = oauthToken(server, {
      sub: 'host-1',
      scope: 'availability:write',
    });

    console.log('OAuth role conformance — PhotonServer MCP HTTP:');

    await test('anonymous tools/list exposes only the user catalog', async () => {
      const response = await postMcp(port, {
        jsonrpc: '2.0',
        id: 'anonymous-list',
        method: 'tools/list',
        params: {},
      });
      assert.equal(response.status, 200);
      assert.deepEqual(toolNames(response.body), ['userSlots']);
    });

    await test('customer tools/list exposes only customer tools', async () => {
      const response = await postMcp(
        port,
        { jsonrpc: '2.0', id: 'customer-list', method: 'tools/list', params: {} },
        customerRead
      );
      assert.equal(response.status, 200);
      assert.deepEqual(toolNames(response.body), ['customerBookings', 'customerExactScope']);
    });

    await test('host tools/list exposes only host tools', async () => {
      const response = await postMcp(
        port,
        { jsonrpc: '2.0', id: 'host-list', method: 'tools/list', params: {} },
        host
      );
      assert.equal(response.status, 200);
      assert.deepEqual(toolNames(response.body), ['hostAvailability']);
    });

    await test('anonymous user-role tools/call remains usable with optional auth', async () => {
      const response = await postMcp(port, {
        jsonrpc: '2.0',
        id: 'anonymous-call',
        method: 'tools/call',
        params: { name: 'userSlots', arguments: {} },
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.result?.isError, false);
      assert.match(resultText(response.body), /"role":\s*"user"/);
    });

    await test('customer and host tools/call preserve the authenticated caller', async () => {
      const customerResponse = await postMcp(
        port,
        {
          jsonrpc: '2.0',
          id: 'customer-call',
          method: 'tools/call',
          params: { name: 'customerBookings', arguments: {} },
        },
        customerRead
      );
      assert.equal(customerResponse.status, 200);
      assert.match(resultText(customerResponse.body), /"role":\s*"customer"/);
      assert.match(resultText(customerResponse.body), /customer-1/);

      const hostResponse = await postMcp(
        port,
        {
          jsonrpc: '2.0',
          id: 'host-call',
          method: 'tools/call',
          params: { name: 'hostAvailability', arguments: {} },
        },
        host
      );
      assert.equal(hostResponse.status, 200);
      assert.match(resultText(hostResponse.body), /"role":\s*"host"/);
      assert.match(resultText(hostResponse.body), /host-1/);
    });

    await test('requires exact scopes, not scope prefixes', async () => {
      const tooBroad = await postMcp(
        port,
        {
          jsonrpc: '2.0',
          id: 'scope-prefix',
          method: 'tools/call',
          params: { name: 'customerExactScope', arguments: {} },
        },
        customerRead
      );
      assert.equal(tooBroad.status, 403);
      assert.equal(tooBroad.body.error?.data?.reason, 'insufficient_scope');
      assert.match(tooBroad.wwwAuthenticate ?? '', /error="insufficient_scope"/);

      const exact = await postMcp(
        port,
        {
          jsonrpc: '2.0',
          id: 'scope-exact',
          method: 'tools/call',
          params: { name: 'customerExactScope', arguments: {} },
        },
        oauthToken(server, { sub: 'customer-1', scope: 'bookings:read-extra' })
      );
      assert.equal(exact.status, 200);
      assert.equal(exact.body.result?.isError, false);
    });

    await test('rejects expired and wrong-audience tokens', async () => {
      const expired = await postMcp(
        port,
        { jsonrpc: '2.0', id: 'expired', method: 'tools/list', params: {} },
        oauthToken(server, { sub: 'customer-1', scope: 'bookings:read', expiresInSeconds: -120 })
      );
      assert.equal(expired.status, 401);
      assert.equal(expired.body.error?.data?.reason, 'invalid_token');

      const runtime = (server as any).oauthRuntime;
      const wrongAudience = await postMcp(
        port,
        { jsonrpc: '2.0', id: 'wrong-audience', method: 'tools/list', params: {} },
        oauthToken(server, {
          sub: 'customer-1',
          scope: 'bookings:read',
          audience: `${runtime.resource}/wrong`,
        })
      );
      assert.equal(wrongAudience.status, 401);
      assert.equal(wrongAudience.body.error?.data?.reason, 'invalid_token');
    });

    await test('denies a valid customer token targeting a host tool', async () => {
      const response = await postMcp(
        port,
        {
          jsonrpc: '2.0',
          id: 'wrong-role',
          method: 'tools/call',
          params: { name: 'hostAvailability', arguments: {} },
        },
        customerBroad
      );
      assert.equal(response.status, 200);
      assert.equal(response.body.result?.isError, true);
      assert.match(resultText(response.body), /not available|permission|access/i);
    });

    console.log('PhotonServer OAuth role conformance passed.');
  } finally {
    await server.stop();
    process.env = { ...oldEnv };
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.env = { ...oldEnv };
    process.exit(1);
  }
);
