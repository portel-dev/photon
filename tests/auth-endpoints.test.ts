/**
 * OAuth 2.1 authorization server endpoint tests.
 *
 * Covers /authorize, /token, /register, /consent as pure functions.
 * Validates RFC 6749/7591/7636 conformance + CIMD interop.
 */

import assert from 'node:assert/strict';
import {
  handleAuthorize,
  handleConsent,
  handleToken,
  handleRegister,
  DEFAULT_ENDPOINT_CONFIG,
  type EndpointConfig,
  type EndpointDeps,
  type AuthRequest,
} from '../src/serv/auth/endpoints.js';
import {
  MemoryAuthCodeStore,
  MemoryRefreshTokenStore,
  MemoryClientRegistry,
  MemoryConsentStore,
  MemoryPendingAuthorizationStore,
  generateSecureToken,
} from '../src/serv/auth/auth-store.js';
import { JwtService, generateCodeChallenge } from '../src/serv/auth/jwt.js';
import { CimdCache } from '../src/serv/auth/well-known.js';
import type { Tenant } from '../src/serv/types/index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_TENANT: Tenant = {
  id: 'tenant-1',
  name: 'Test Org',
  slug: 'test',
  region: 'local',
  plan: 'free',
  encryptionKeyId: 'k1',
  settings: {
    allowAnonymousUsers: false,
    sponsoredPhotons: [],
  },
  createdAt: new Date(),
};

const TEST_CONFIG: EndpointConfig = {
  ...DEFAULT_ENDPOINT_CONFIG,
  issuer: 'https://serv.test',
  authorizeUrl: 'https://serv.test/authorize',
  consentUrl: 'https://serv.test/consent',
  loginUrl: 'https://serv.test/login',
};

function makeDeps(overrides: Partial<EndpointDeps> = {}): EndpointDeps {
  return {
    tenant: TEST_TENANT,
    config: TEST_CONFIG,
    codeStore: new MemoryAuthCodeStore(),
    refreshTokenStore: new MemoryRefreshTokenStore(),
    clientRegistry: new MemoryClientRegistry(),
    consentStore: new MemoryConsentStore(),
    pendingStore: new MemoryPendingAuthorizationStore(),
    jwtService: new JwtService({
      secret: 'test-secret-at-least-32-chars-long-1234',
      issuer: 'https://serv.test',
    }),
    cimdCache: new CimdCache(),
    ...overrides,
  };
}

function buildAuthorizeUrl(params: Record<string, string>): string {
  const url = new URL('https://serv.test/authorize');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

// ============================================================================
// /register tests
// ============================================================================

async function testRegister() {
  console.log('/register:');

  await test('happy path returns client_id + client_secret', async () => {
    const deps = makeDeps();
    const res = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: { 'user-agent': 'test-client/1.0' },
        body: JSON.stringify({
          client_name: 'Test Client',
          redirect_uris: ['https://app.example.com/cb'],
        }),
      },
      deps
    );
    assert.equal(res.status, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.client_id);
    assert.ok(body.client_secret, 'confidential client gets secret');
    assert.deepEqual(body.redirect_uris, ['https://app.example.com/cb']);
    assert.equal(body.token_endpoint_auth_method, 'client_secret_basic');
  });

  await test('public client (auth_method=none) has no client_secret', async () => {
    const deps = makeDeps();
    const res = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'Public Client',
          redirect_uris: ['https://public.example.com/cb'],
          token_endpoint_auth_method: 'none',
        }),
      },
      deps
    );
    assert.equal(res.status, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.client_id);
    assert.equal(body.client_secret, undefined);
  });

  await test('missing redirect_uris rejected', async () => {
    const deps = makeDeps();
    const res = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({ client_name: 'No Redirect' }),
      },
      deps
    );
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'invalid_redirect_uri');
  });

  await test('non-http redirect_uri rejected', async () => {
    const deps = makeDeps();
    const res = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          redirect_uris: ['ftp://evil.example.com/cb'],
        }),
      },
      deps
    );
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'invalid_redirect_uri');
  });

  await test('GET returns method-not-allowed', async () => {
    const deps = makeDeps();
    const res = await handleRegister(
      { method: 'GET', url: 'https://serv.test/register', headers: {} },
      deps
    );
    assert.equal(res.status, 405);
  });
}

// ============================================================================
// /authorize tests
// ============================================================================

async function testAuthorize() {
  console.log('/authorize:');

  await test('missing client_id returns invalid_request', async () => {
    const deps = makeDeps();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({ redirect_uri: 'https://app/cb', response_type: 'code' }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_request');
  });

  await test('wrong response_type returns unsupported_response_type', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'token', // implicit flow disallowed in OAuth 2.1
          code_challenge: 'x',
          code_challenge_method: 'S256',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'unsupported_response_type');
  });

  await test('missing PKCE code_challenge rejected', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'invalid_request');
    assert.match(body.error_description, /code_challenge/);
  });

  await test('plain code_challenge_method rejected (S256 only)', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'plain',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
  });

  await test('unknown client_id returns invalid_client', async () => {
    const deps = makeDeps();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'unknown-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'S256',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_client');
  });

  await test('redirect_uri mismatch rejected', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://attacker.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'S256',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
  });

  await test('unauthenticated user redirected to login', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'S256',
        }),
        headers: {},
        // no userId
      },
      deps
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.Location, /^https:\/\/serv\.test\/login/);
    assert.match(res.headers.Location, /return_to=/);
  });

  await test('prompt=none with no session returns login_required redirect', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'S256',
          prompt: 'none',
        }),
        headers: {},
      },
      deps
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.Location, /error=login_required/);
  });

  await test('first-party client skips consent + issues code', async () => {
    const deps = makeDeps();
    // photon-cli is in firstPartyClientIds by default — register it for redirect_uri validation
    await deps.clientRegistry.save({
      clientId: 'photon-cli',
      clientName: 'Photon CLI',
      redirectUris: ['http://localhost:8787/cb'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      scope: 'mcp:read mcp:write',
      isPublic: true,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    });
    const verifier = generateSecureToken(32);
    const challenge = generateCodeChallenge(verifier);

    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'photon-cli',
          redirect_uri: 'http://localhost:8787/cb',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'xyz',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 302);
    const redirect = new URL(res.headers.Location);
    assert.equal(redirect.origin + redirect.pathname, 'http://localhost:8787/cb');
    assert.ok(redirect.searchParams.get('code'), 'code param present');
    assert.equal(redirect.searchParams.get('state'), 'xyz', 'state echoed');
  });

  await test('third-party client redirected to consent screen', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'S256',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.Location, /^https:\/\/serv\.test\/consent/);
    assert.match(res.headers.Location, /req=/);
  });

  await test('prompt=none without consent returns consent_required', async () => {
    const deps = await depsWithRegisteredClient();
    const res = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: 'test-client',
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          code_challenge: 'xxx',
          code_challenge_method: 'S256',
          prompt: 'none',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.Location, /error=consent_required/);
  });
}

async function depsWithRegisteredClient(): Promise<EndpointDeps> {
  const deps = makeDeps();
  await deps.clientRegistry.save({
    clientId: 'test-client',
    clientName: 'Test Client',
    clientSecretHash: undefined,
    redirectUris: ['https://app.example.com/cb'],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    scope: 'mcp:read',
    isPublic: true,
    createdAt: new Date(),
    lastUsedAt: new Date(),
  });
  return deps;
}

// ============================================================================
// /consent tests
// ============================================================================

async function testConsent() {
  console.log('/consent:');

  await test('GET renders consent HTML for pending request', async () => {
    const deps = await depsWithPending();
    const res = await handleConsent(
      {
        method: 'GET',
        url: `https://serv.test/consent?req=${encodeURIComponent(deps.pendingId)}`,
        headers: {},
        userId: 'user-1',
      },
      deps.deps
    );
    assert.equal(res.status, 200);
    assert.match(res.headers['Content-Type'], /html/);
    assert.match(res.body, /Test Client/);
    assert.match(res.body, /Requested scopes/);
    assert.match(res.body, /Approve/);
    assert.match(res.body, /Deny/);
  });

  await test('POST approve issues code and stores consent record', async () => {
    const { deps, pendingId } = await depsWithPending();
    const res = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId, decision: 'approve' }),
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 302);
    const redirect = new URL(res.headers.Location);
    assert.ok(redirect.searchParams.get('code'));
    // Verify consent was saved
    const covered = await deps.consentStore.covers('user-1', 'tenant-1', 'test-client', [
      'mcp:read',
    ]);
    assert.equal(covered, true);
  });

  await test('POST deny redirects with access_denied error', async () => {
    const { deps, pendingId } = await depsWithPending();
    const res = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId, decision: 'deny' }),
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 302);
    assert.match(res.headers.Location, /error=access_denied/);
  });

  await test('POST from different user rejected', async () => {
    const { deps, pendingId } = await depsWithPending();
    const res = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId, decision: 'approve' }),
        userId: 'different-user',
      },
      deps
    );
    assert.equal(res.status, 403);
  });

  await test('GET with unknown req returns 400', async () => {
    const deps = makeDeps();
    const res = await handleConsent(
      {
        method: 'GET',
        url: 'https://serv.test/consent?req=unknown',
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(res.status, 400);
  });
}

async function depsWithPending(): Promise<{
  deps: EndpointDeps;
  pendingId: string;
  codeChallenge: string;
  codeVerifier: string;
}> {
  const deps = await depsWithRegisteredClient();
  const codeVerifier = generateSecureToken(32);
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const pendingId = 'pending-123';
  await deps.pendingStore.save({
    id: pendingId,
    clientId: 'test-client',
    redirectUri: 'https://app.example.com/cb',
    scope: 'mcp:read',
    codeChallenge,
    codeChallengeMethod: 'S256',
    userId: 'user-1',
    tenantId: 'tenant-1',
    responseType: 'code',
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
  });
  return { deps, pendingId, codeChallenge, codeVerifier };
}

// ============================================================================
// /token tests
// ============================================================================

async function testToken() {
  console.log('/token:');

  await test('authorization_code happy path returns access + refresh token', async () => {
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    const code = await issueAuthCode(deps, clientId, redirectUri, codeVerifier);

    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: formBody({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.access_token);
    assert.ok(body.refresh_token);
    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.scope, 'mcp:read');
  });

  await test('PKCE verifier mismatch rejected', async () => {
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    const code = await issueAuthCode(deps, clientId, redirectUri, codeVerifier);

    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: 'wrong-verifier',
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_grant');
  });

  await test('code replay rejected (single-use)', async () => {
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    const code = await issueAuthCode(deps, clientId, redirectUri, codeVerifier);

    // First use succeeds
    const first = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(first.status, 200);

    // Second use rejected
    const second = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(second.status, 400);
    assert.equal(JSON.parse(second.body).error, 'invalid_grant');
  });

  await test('refresh_token rotates old token and issues new access token', async () => {
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    const code = await issueAuthCode(deps, clientId, redirectUri, codeVerifier);

    const tokenRes = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: codeVerifier,
          client_id: clientId,
        }),
      },
      deps
    );
    const { refresh_token: refreshToken } = JSON.parse(tokenRes.body);

    const refreshRes = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(refreshRes.status, 200);
    const refreshed = JSON.parse(refreshRes.body);
    assert.ok(refreshed.access_token);
    assert.ok(refreshed.refresh_token);
    assert.notEqual(refreshed.refresh_token, refreshToken, 'refresh token rotated');

    // Old refresh token should now fail
    const replay = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(replay.status, 400);
  });

  await test('client_credentials with Basic auth issues access token (no refresh)', async () => {
    const deps = makeDeps();
    // Register a confidential client
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'Server-to-Server',
          redirect_uris: ['https://noop.example.com/cb'],
          scope: 'mcp:read mcp:write',
        }),
      },
      deps
    );
    const { client_id, client_secret } = JSON.parse(regRes.body);

    const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({ grant_type: 'client_credentials', scope: 'mcp:read' }),
      },
      deps
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.access_token);
    assert.equal(body.refresh_token, undefined, 'no refresh token for client_credentials');
    assert.equal(body.scope, 'mcp:read');
  });

  await test('client_credentials with wrong secret rejected', async () => {
    const deps = makeDeps();
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          redirect_uris: ['https://noop/cb'],
          scope: 'mcp:read',
        }),
      },
      deps
    );
    const { client_id } = JSON.parse(regRes.body);

    const basic = Buffer.from(`${client_id}:wrong-secret`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({ grant_type: 'client_credentials' }),
      },
      deps
    );
    assert.equal(res.status, 401);
  });

  await test('unsupported grant_type rejected', async () => {
    const deps = makeDeps();
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({ grant_type: 'password' }),
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'unsupported_grant_type');
  });
}

async function primeAuthorizationCode(): Promise<{
  deps: EndpointDeps;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}> {
  const deps = await depsWithRegisteredClient();
  const codeVerifier = generateSecureToken(32);
  return {
    deps,
    clientId: 'test-client',
    redirectUri: 'https://app.example.com/cb',
    codeVerifier,
  };
}

async function issueAuthCode(
  deps: EndpointDeps,
  clientId: string,
  redirectUri: string,
  codeVerifier: string
): Promise<string> {
  const challenge = generateCodeChallenge(codeVerifier);
  // Pre-consent via consent store so first authorize skips the screen
  await deps.consentStore.save({
    userId: 'user-1',
    tenantId: 'tenant-1',
    clientId,
    scopes: 'mcp:read',
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  });
  const res = await handleAuthorize(
    {
      method: 'GET',
      url: buildAuthorizeUrl({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
      headers: {},
      userId: 'user-1',
    },
    deps
  );
  assert.equal(res.status, 302);
  const url = new URL(res.headers.Location);
  const code = url.searchParams.get('code');
  assert.ok(code);
  return code!;
}

// ============================================================================
// End-to-end integration
// ============================================================================

async function testIntegration() {
  console.log('End-to-end:');

  await test('full flow: register → authorize → consent → token → refresh', async () => {
    const deps = makeDeps();

    // 1. Register client
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: { 'user-agent': 'integration-test/1.0' },
        body: JSON.stringify({
          client_name: 'Integration Test',
          redirect_uris: ['https://app.example.com/cb'],
          token_endpoint_auth_method: 'none',
        }),
      },
      deps
    );
    assert.equal(regRes.status, 201);
    const { client_id } = JSON.parse(regRes.body);

    // 2. Authorize — hits consent (third-party client, no prior consent)
    const verifier = generateSecureToken(32);
    const challenge = generateCodeChallenge(verifier);
    const authRes = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id,
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          scope: 'mcp:read',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'flow-state',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(authRes.status, 302);
    const consentRedirect = new URL(authRes.headers.Location);
    const pendingId = consentRedirect.searchParams.get('req');
    assert.ok(pendingId);

    // 3. Approve consent
    const consentRes = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId!, decision: 'approve' }),
        userId: 'user-1',
      },
      deps
    );
    assert.equal(consentRes.status, 302);
    const callback = new URL(consentRes.headers.Location);
    const code = callback.searchParams.get('code');
    assert.ok(code);
    assert.equal(callback.searchParams.get('state'), 'flow-state');

    // 4. Exchange code for tokens
    const tokenRes = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: 'https://app.example.com/cb',
          code_verifier: verifier,
          client_id,
        }),
      },
      deps
    );
    assert.equal(tokenRes.status, 200);
    const tokens = JSON.parse(tokenRes.body);
    assert.ok(tokens.access_token);
    assert.ok(tokens.refresh_token);

    // 5. Subsequent authorize skips consent (remembered for same scope set)
    const secondAuth = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id,
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          scope: 'mcp:read',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }),
        headers: {},
        userId: 'user-1',
      },
      deps
    );
    assert.equal(secondAuth.status, 302);
    const secondRedirect = new URL(secondAuth.headers.Location);
    assert.equal(
      secondRedirect.origin + secondRedirect.pathname,
      'https://app.example.com/cb',
      'should skip consent, redirect direct to callback'
    );
    assert.ok(secondRedirect.searchParams.get('code'));
  });
}

// ============================================================================
// Runner
// ============================================================================

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    throw err;
  }
}

async function main() {
  await testRegister();
  await testAuthorize();
  await testConsent();
  await testToken();
  await testIntegration();
  console.log('\nAll auth endpoint tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
