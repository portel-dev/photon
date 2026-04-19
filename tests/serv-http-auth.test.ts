/**
 * SERV OAuth 2.1 HTTP integration tests.
 *
 * Spins up a real Node http server mounting handleAuthServerHTTP, then
 * exercises the endpoints end-to-end with real HTTP requests. This is
 * the layer above tests/auth-endpoints.test.ts — those verify the pure
 * handlers, these verify the HTTP adapter (path matching, body parsing,
 * header translation, CORS, well-known routing).
 */

import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { Serv, handleAuthServerHTTP, type AuthServerHTTPOptions } from '../src/serv/index.js';
import type { Tenant } from '../src/serv/types/index.js';

// ============================================================================
// Harness
// ============================================================================

const TENANT_SLUG = 'acme';
const TENANT: Tenant = {
  id: 'tenant-acme',
  name: 'Acme Corp',
  slug: TENANT_SLUG,
  region: 'local',
  plan: 'free',
  encryptionKeyId: 'k1',
  settings: { allowAnonymousUsers: false, sponsoredPhotons: [] },
  createdAt: new Date(),
};

interface ServerHandle {
  server: http.Server;
  baseUrl: string;
  close: () => Promise<void>;
  /** Override the user resolver mid-test (for /authorize login flow). */
  setUser: (id: string | undefined) => void;
}

async function startServer(serv: Serv, singleTenant = false): Promise<ServerHandle> {
  let currentUser: string | undefined;
  const options: AuthServerHTTPOptions = {
    serv,
    singleTenant,
    resolveTenant: async (_req, slug) => {
      if (singleTenant && slug === null) return TENANT;
      if (slug === TENANT_SLUG) return TENANT;
      return null;
    },
    resolveUserId: async () => currentUser,
  };

  const server = http.createServer(async (req, res) => {
    const handled = await handleAuthServerHTTP(req, res, options);
    if (!handled) {
      res.writeHead(404);
      res.end('not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    setUser: (id) => {
      currentUser = id;
    },
  };
}

function buildServ(): Serv {
  return new Serv({
    baseUrl: 'http://serv.test',
    baseDomain: 'serv.test',
    jwtSecret: 'test-secret-at-least-32-chars-long-1234',
    encryptionKey: 'test-encryption-key-32-chars-long-1234',
    stateSecret: 'test-state-secret-at-least-32-chars-12',
  });
}

async function fetchJson(
  url: string,
  init?: RequestInit & { allowNon2xx?: boolean }
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const res = await fetch(url, { redirect: 'manual', ...init });
  let body: unknown = null;
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (text.length > 0) {
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } else {
      body = text;
    }
  }
  return { status: res.status, headers: res.headers, body };
}

function formEncode(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

// ============================================================================
// Tests
// ============================================================================

async function testRouteMatching() {
  console.log('Route matching:');
  const serv = buildServ();
  const handle = await startServer(serv);
  try {
    await test('unknown path falls through to host 404', async () => {
      const res = await fetchJson(`${handle.baseUrl}/random`);
      assert.equal(res.status, 404);
      assert.equal(res.body, 'not found');
    });

    await test('unknown tenant slug returns tenant_not_found', async () => {
      const res = await fetchJson(`${handle.baseUrl}/tenant/unknown/authorize?client_id=x`);
      assert.equal(res.status, 404);
      assert.equal((res.body as { error: string }).error, 'tenant_not_found');
    });

    await test('CORS preflight returns 204', async () => {
      const res = await fetchJson(`${handle.baseUrl}/tenant/${TENANT_SLUG}/token`, {
        method: 'OPTIONS',
      });
      assert.equal(res.status, 204);
      assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
    });
  } finally {
    await handle.close();
  }
}

async function testWellKnown() {
  console.log('Well-known metadata:');
  const serv = buildServ();
  const handle = await startServer(serv);
  try {
    await test('oauth-authorization-server advertises the AS endpoints', async () => {
      const res = await fetchJson(
        `${handle.baseUrl}/tenant/${TENANT_SLUG}/.well-known/oauth-authorization-server`
      );
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.ok(body.authorization_endpoint, 'authorization_endpoint present');
      assert.ok(body.token_endpoint, 'token_endpoint present');
      assert.equal(body.client_id_metadata_document_supported, true);
    });

    await test('oauth-protected-resource returns resource metadata', async () => {
      const res = await fetchJson(
        `${handle.baseUrl}/tenant/${TENANT_SLUG}/.well-known/oauth-protected-resource`
      );
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.ok(body.resource, 'resource URI present');
    });
  } finally {
    await handle.close();
  }
}

async function testRegister() {
  console.log('POST /register (DCR):');
  const serv = buildServ();
  const handle = await startServer(serv);
  try {
    await test('registers a public client', async () => {
      const res = await fetchJson(`${handle.baseUrl}/tenant/${TENANT_SLUG}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'HTTP Integration Client',
          redirect_uris: ['https://app.example.com/cb'],
          token_endpoint_auth_method: 'none',
        }),
      });
      assert.equal(res.status, 201);
      const body = res.body as Record<string, unknown>;
      assert.ok(body.client_id);
      assert.equal(body.client_secret, undefined, 'public clients get no secret');
    });

    await test('rejects body > 64 KiB with 413', async () => {
      const big = JSON.stringify({ pad: 'a'.repeat(128 * 1024) });
      const res = await fetchJson(`${handle.baseUrl}/tenant/${TENANT_SLUG}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: big,
      });
      assert.equal(res.status, 413);
    });
  } finally {
    await handle.close();
  }
}

async function testFullFlow() {
  console.log('Full register → authorize → token flow:');
  const serv = buildServ();
  const handle = await startServer(serv);
  try {
    // Register
    const reg = await fetchJson(`${handle.baseUrl}/tenant/${TENANT_SLUG}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Flow Client',
        redirect_uris: ['https://app.example.com/cb'],
        token_endpoint_auth_method: 'none',
      }),
    });
    const { client_id } = reg.body as { client_id: string };

    // Pre-seed consent so /authorize skips the consent screen.
    const consentRecord = {
      userId: 'user-flow',
      tenantId: TENANT.id,
      clientId: client_id,
      scopes: 'mcp:read',
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(),
    };
    await serv.consentStore.save(consentRecord);

    // Authenticate the next request as user-flow
    handle.setUser('user-flow');

    const { verifier, challenge } = pkce();
    await test('authorize redirects to client with code', async () => {
      const url = new URL(`${handle.baseUrl}/tenant/${TENANT_SLUG}/authorize`);
      url.searchParams.set('client_id', client_id);
      url.searchParams.set('redirect_uri', 'https://app.example.com/cb');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'mcp:read');
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', 'xyz');

      const res = await fetch(url.toString(), { redirect: 'manual' });
      assert.equal(res.status, 302);
      const location = new URL(res.headers.get('location') ?? '');
      assert.equal(location.origin + location.pathname, 'https://app.example.com/cb');
      const code = location.searchParams.get('code');
      assert.ok(code, 'authorize should return a code');
      assert.equal(location.searchParams.get('state'), 'xyz');

      // Exchange code for tokens
      const tokenRes = await fetchJson(`${handle.baseUrl}/tenant/${TENANT_SLUG}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formEncode({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: 'https://app.example.com/cb',
          code_verifier: verifier,
          client_id,
        }),
      });
      assert.equal(tokenRes.status, 200);
      const tokens = tokenRes.body as Record<string, string>;
      assert.ok(tokens.access_token);
      assert.ok(tokens.refresh_token);
      assert.equal(tokens.token_type, 'Bearer');
    });
  } finally {
    await handle.close();
  }
}

async function testSingleTenantRootMount() {
  console.log('Single-tenant root mount:');
  const serv = buildServ();
  const handle = await startServer(serv, true);
  try {
    await test('root-mounted well-known resolves', async () => {
      const res = await fetchJson(`${handle.baseUrl}/.well-known/oauth-authorization-server`);
      assert.equal(res.status, 200);
    });

    await test('root-mounted /register works without tenant prefix', async () => {
      const res = await fetchJson(`${handle.baseUrl}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Root Mount',
          redirect_uris: ['https://app/cb'],
          token_endpoint_auth_method: 'none',
        }),
      });
      assert.equal(res.status, 201);
    });
  } finally {
    await handle.close();
  }
}

async function testLoginRedirect() {
  console.log('Authorize without session redirects to login:');
  const serv = buildServ();
  const handle = await startServer(serv);
  try {
    // Register a client first
    const reg = await fetchJson(`${handle.baseUrl}/tenant/${TENANT_SLUG}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Auth Client',
        redirect_uris: ['https://app/cb'],
        token_endpoint_auth_method: 'none',
      }),
    });
    const { client_id } = reg.body as { client_id: string };

    await test('302s to loginUrl with return_to when no userId', async () => {
      handle.setUser(undefined);
      const url = new URL(`${handle.baseUrl}/tenant/${TENANT_SLUG}/authorize`);
      url.searchParams.set('client_id', client_id);
      url.searchParams.set('redirect_uri', 'https://app/cb');
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', 'x');
      url.searchParams.set('code_challenge_method', 'S256');

      const res = await fetch(url.toString(), { redirect: 'manual' });
      assert.equal(res.status, 302);
      const loc = res.headers.get('location') ?? '';
      assert.match(loc, /\/login/, 'redirects to configured loginUrl');
      assert.match(loc, /return_to=/, 'carries return_to');
    });
  } finally {
    await handle.close();
  }
}

// ============================================================================
// Runner
// ============================================================================

async function main() {
  await testRouteMatching();
  await testWellKnown();
  await testRegister();
  await testFullFlow();
  await testSingleTenantRootMount();
  await testLoginRedirect();
  console.log('\nAll serv-http-auth integration tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
