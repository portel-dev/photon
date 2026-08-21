/**
 * Strict OAuth role-conformance expectations for transport-level challenges.
 *
 * Run with:
 *   bunx tsx tests/oauth-role-conformance-gaps.test.ts
 *
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
const oldEnv = { ...process.env };

async function postMcp(port: number, body: unknown, token?: string) {
  const request =
    typeof body === 'object' && body !== null
      ? {
          ...(body as Record<string, unknown>),
          params: {
            ...(((body as Record<string, unknown>).params as Record<string, unknown> | undefined) ||
              {}),
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': {
                name: 'oauth-role-conformance-gaps',
                version: '1.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }
      : body;
  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'Mcp-Protocol-Version': '2026-07-28',
    'Mcp-Method':
      typeof request === 'object' && request !== null && 'method' in request
        ? String((request as { method?: unknown }).method || '')
        : '',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const requestParams =
    typeof request === 'object' && request !== null
      ? (request as { params?: { name?: unknown } }).params
      : undefined;
  if (typeof requestParams?.name === 'string') headers['Mcp-Name'] = requestParams.name;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });
  return {
    status: response.status,
    body: (await response.json()) as any,
    wwwAuthenticate: response.headers.get('www-authenticate'),
  };
}

function oauthToken(
  server: PhotonServer,
  input: { sub: string; scope: string; audience?: string }
): string {
  const runtime = (server as any).oauthRuntime;
  const now = Math.floor(Date.now() / 1000);
  return runtime.serv.jwtService.exchangeSign({
    iss: runtime.issuer,
    sub: input.sub,
    aud: input.audience ?? runtime.resource,
    exp: now + 900,
    iat: now,
    jti: `oauth-role-conformance-gap-${input.sub}-${now}`,
    tenant_id: runtime.tenant.id,
    client_id: 'oauth-role-conformance-client',
    scope: input.scope,
  });
}

function contentText(body: any): string {
  return (body?.result?.content ?? []).map((content: any) => content.text ?? '').join('\n');
}

async function main(): Promise<number> {
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

    const test = async (name: string, assertion: () => Promise<void>) => {
      await assertion();
      console.log(`  ✓ ${name}`);
    };

    console.log('OAuth role conformance — transport challenges:');

    await test('missing scope uses 403 insufficient_scope', async () => {
      const response = await postMcp(
        port,
        {
          jsonrpc: '2.0',
          id: 'missing-scope',
          method: 'tools/call',
          params: { name: 'customerExactScope', arguments: {} },
        },
        customerRead
      );
      assert.equal(response.status, 403);
      assert.equal(response.body.error?.data?.reason, 'insufficient_scope');
      assert.match(response.wwwAuthenticate ?? '', /error="insufficient_scope"/);
    });

    await test('anonymous protected call returns an OAuth challenge', async () => {
      const response = await postMcp(port, {
        jsonrpc: '2.0',
        id: 'connect-customer',
        method: 'tools/call',
        params: { name: 'customerBookings', arguments: {} },
      });
      assert.equal(response.status, 401);
      assert.match(response.wwwAuthenticate ?? '', /resource_metadata=/);
      assert.match(response.wwwAuthenticate ?? '', /error="invalid_token"/);
      assert.equal(response.body.result?.isError, undefined);
      assert.equal(contentText(response.body), '');
    });

    return 0;
  } finally {
    await server.stop();
    process.env = { ...oldEnv };
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.env = { ...oldEnv };
    process.exit(1);
  }
);
