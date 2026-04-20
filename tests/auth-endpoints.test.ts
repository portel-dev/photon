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
  handleRevoke,
  handleIntrospect,
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

  await test('wrong-user POST does NOT consume the pending request', async () => {
    // Regression: previous flow consumed the pending request before
    // verifying ownership, so a stray wrong-session POST killed the
    // legitimate user's consent attempt and forced them to restart
    // /authorize.
    const { deps, pendingId } = await depsWithPending();

    // Stray POST from wrong user.
    const reject = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId, decision: 'approve' }),
        userId: 'different-user',
      },
      deps
    );
    assert.equal(reject.status, 403);

    // Legitimate user's request must still be available.
    const still = await deps.pendingStore.peek(pendingId);
    assert.ok(still, 'pending request must survive wrong-user POST');
    assert.equal(still.userId, 'user-1');

    // And the legitimate user can approve normally.
    const ok = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId, decision: 'approve' }),
        userId: 'user-1',
      },
      deps
    );
    assert.equal(ok.status, 302);
    assert.ok(ok.headers.Location.includes('code='));
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

  await test('validation-failed retries do NOT burn a valid code', async () => {
    // Regression: the old flow consumed the code before verifying PKCE /
    // client_id / redirect_uri, so any fat-fingered retry killed an
    // otherwise-valid code and forced the user back through /authorize.
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    const code = await issueAuthCode(deps, clientId, redirectUri, codeVerifier);

    // First: wrong verifier → should fail WITHOUT consuming the code.
    const badRetry = await handleToken(
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
    assert.equal(badRetry.status, 400);

    // Code must still be peekable — proves the bad retry did NOT consume it.
    const stillThere = await deps.codeStore.peek(code);
    assert.ok(stillThere, 'code must survive a validation failure');

    // Second: correct verifier → must succeed on the SAME code.
    const good = await handleToken(
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
    assert.equal(good.status, 200);
    const body = JSON.parse(good.body);
    assert.ok(body.access_token);
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

async function testRevokeIntrospect() {
  console.log('/revoke + /introspect:');

  await test('revoke removes refresh token', async () => {
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
    const { refresh_token } = JSON.parse(tokenRes.body);

    const revokeRes = await handleRevoke(
      {
        method: 'POST',
        url: 'https://serv.test/revoke',
        headers: {},
        body: formBody({ token: refresh_token, token_type_hint: 'refresh_token' }),
      },
      deps
    );
    assert.equal(revokeRes.status, 200);

    // refresh token should now fail
    const failed = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: clientId,
        }),
      },
      deps
    );
    assert.equal(failed.status, 400);
  });

  await test('revoke of unknown token returns 200 (no scanning)', async () => {
    const deps = makeDeps();
    const res = await handleRevoke(
      {
        method: 'POST',
        url: 'https://serv.test/revoke',
        headers: {},
        body: formBody({ token: 'bogus-token' }),
      },
      deps
    );
    assert.equal(res.status, 200);
  });

  await test('introspect returns active=true + claims for valid access token', async () => {
    const deps = makeDeps();
    // Register confidential client
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'Introspect Caller',
          redirect_uris: ['https://noop/cb'],
          scope: 'mcp:read',
        }),
      },
      deps
    );
    const { client_id, client_secret } = JSON.parse(regRes.body);

    // Issue an access token via client_credentials
    const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');
    const tokenRes = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({ grant_type: 'client_credentials' }),
      },
      deps
    );
    const { access_token } = JSON.parse(tokenRes.body);

    // Introspect the token using the same client's auth
    const introRes = await handleIntrospect(
      {
        method: 'POST',
        url: 'https://serv.test/introspect',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({ token: access_token }),
      },
      deps
    );
    assert.equal(introRes.status, 200);
    const introspection = JSON.parse(introRes.body);
    assert.equal(introspection.active, true);
    assert.equal(introspection.client_id, client_id);
  });

  await test('introspect without client auth rejected', async () => {
    const deps = makeDeps();
    const res = await handleIntrospect(
      {
        method: 'POST',
        url: 'https://serv.test/introspect',
        headers: {},
        body: formBody({ token: 'anything' }),
      },
      deps
    );
    assert.equal(res.status, 401);
  });

  await test('introspect of unknown token returns active=false', async () => {
    const deps = makeDeps();
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'Prober',
          redirect_uris: ['https://noop/cb'],
          scope: 'mcp:read',
        }),
      },
      deps
    );
    const { client_id, client_secret } = JSON.parse(regRes.body);
    const basic = Buffer.from(`${client_id}:${client_secret}`).toString('base64');

    const res = await handleIntrospect(
      {
        method: 'POST',
        url: 'https://serv.test/introspect',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({ token: 'does-not-exist' }),
      },
      deps
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.active, false);
    assert.equal(Object.keys(body).length, 1, 'no extra leakage');
  });
}

async function testTokenExchange() {
  console.log('RFC 8693 token exchange:');

  async function setupExchange(): Promise<{
    deps: EndpointDeps;
    subjectToken: string;
    mcpClientId: string;
    mcpClientSecret: string;
  }> {
    const deps = makeDeps();

    // Register the MCP server as a confidential client (it will be the "actor")
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'MCP Server',
          redirect_uris: ['https://mcp.example.com/cb'],
          scope: 'mcp:read mcp:write',
        }),
      },
      deps
    );
    const { client_id: mcpClientId, client_secret: mcpClientSecret } = JSON.parse(regRes.body);

    // Mint a subject token (simulating the user's access token)
    const subjectToken = deps.jwtService.generateAccessToken({
      sub: 'user-alice',
      tenantId: 'tenant-1',
      scope: 'mcp:read mcp:write',
      clientId: 'claude-client',
      expiresInSeconds: 900,
    });

    return { deps, subjectToken, mcpClientId, mcpClientSecret };
  }

  await test('happy path: user token exchanged for upstream-audience token', async () => {
    const { deps, subjectToken, mcpClientId, mcpClientSecret } = await setupExchange();
    const basic = Buffer.from(`${mcpClientId}:${mcpClientSecret}`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: 'https://upstream-api.example.com',
          scope: 'mcp:read',
        }),
      },
      deps
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.access_token);
    assert.equal(body.issued_token_type, 'urn:ietf:params:oauth:token-type:access_token');
    assert.equal(body.scope, 'mcp:read', 'narrowed scope');

    // Decode the exchanged token and verify claims
    const [, payloadB64] = (body.access_token as string).split('.');
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    assert.equal(claims.sub, 'user-alice', 'subject preserved');
    assert.equal(claims.aud, 'https://upstream-api.example.com', 'audience bound to target');
    assert.deepEqual(
      claims.act,
      { sub: `client:${mcpClientId}` },
      'act claim identifies the actor (MCP server)'
    );
  });

  await test('missing audience rejected', async () => {
    const { deps, subjectToken, mcpClientId, mcpClientSecret } = await setupExchange();
    const basic = Buffer.from(`${mcpClientId}:${mcpClientSecret}`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        }),
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.match(JSON.parse(res.body).error_description, /audience/);
  });

  await test('scope expansion rejected (narrow only)', async () => {
    const { deps, subjectToken, mcpClientId, mcpClientSecret } = await setupExchange();
    const basic = Buffer.from(`${mcpClientId}:${mcpClientSecret}`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: 'https://upstream/',
          scope: 'mcp:admin', // not in subject's scope
        }),
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_scope');
  });

  await test('invalid subject_token rejected', async () => {
    const { deps, mcpClientId, mcpClientSecret } = await setupExchange();
    const basic = Buffer.from(`${mcpClientId}:${mcpClientSecret}`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: 'not-a-valid-jwt',
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: 'https://upstream/',
        }),
      },
      deps
    );
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body).error, 'invalid_grant');
  });

  await test('unauthenticated caller rejected', async () => {
    const { deps, subjectToken } = await setupExchange();
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: subjectToken,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: 'https://upstream/',
        }),
      },
      deps
    );
    assert.equal(res.status, 401);
  });

  await test('delegation chain: nested act preserved', async () => {
    const { deps, mcpClientId, mcpClientSecret } = await setupExchange();
    // Craft a subject token that already has an `act` chain
    const chainedSubject = deps.jwtService.exchangeSign({
      iss: 'https://serv.test',
      sub: 'user-alice',
      aud: 'https://mcp.example.com',
      exp: Math.floor(Date.now() / 1000) + 900,
      iat: Math.floor(Date.now() / 1000),
      jti: 'test-jti-1',
      scope: 'mcp:read',
      act: { sub: 'client:first-actor' },
    });
    const basic = Buffer.from(`${mcpClientId}:${mcpClientSecret}`).toString('base64');
    const res = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: { authorization: `Basic ${basic}` },
        body: formBody({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token: chainedSubject,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          audience: 'https://upstream/',
        }),
      },
      deps
    );
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    const [, payloadB64] = (body.access_token as string).split('.');
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    assert.deepEqual(
      claims.act,
      { sub: `client:${mcpClientId}`, act: { sub: 'client:first-actor' } },
      'delegation chain preserved'
    );
  });
}

async function testIdToken() {
  console.log('OIDC id_token:');

  await test('openid scope triggers id_token emission', async () => {
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    // Save consent for openid scope
    await deps.consentStore.save({
      userId: 'u-oidc',
      tenantId: 'tenant-1',
      clientId,
      scopes: 'openid mcp:read',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });
    const challenge = generateCodeChallenge(codeVerifier);
    const authRes = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid mcp:read',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }),
        headers: {},
        userId: 'u-oidc',
      },
      deps
    );
    const code = new URL(authRes.headers.Location).searchParams.get('code')!;
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
    const body = JSON.parse(tokenRes.body);
    assert.ok(body.id_token, 'id_token present when openid scope granted');
    // Decode (skip signature verify in test)
    const [, payloadB64] = (body.id_token as string).split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    assert.equal(payload.sub, 'u-oidc');
    assert.equal(payload.aud, clientId, 'id_token aud is client_id per OIDC');
    assert.equal(payload.azp, clientId);
  });

  await test('nonce from /authorize is echoed into id_token', async () => {
    // RFC regression: previously /authorize parsed nonce but never plumbed
    // it through PendingAuthorization or AuthorizationCode, so the id_token
    // always had it missing. OIDC code-flow clients rejected our tokens.
    const { deps, codeVerifier, redirectUri, clientId } = await primeAuthorizationCode();
    await deps.consentStore.save({
      userId: 'u-nonce',
      tenantId: 'tenant-1',
      clientId,
      scopes: 'openid mcp:read',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });
    const challenge = generateCodeChallenge(codeVerifier);
    const nonceValue = 'client-supplied-nonce-' + Math.random();
    const authRes = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: 'openid mcp:read',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          nonce: nonceValue,
        }),
        headers: {},
        userId: 'u-nonce',
      },
      deps
    );
    const code = new URL(authRes.headers.Location).searchParams.get('code')!;
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
    const body = JSON.parse(tokenRes.body);
    assert.ok(body.id_token);
    const [, payloadB64] = (body.id_token as string).split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    assert.equal(payload.nonce, nonceValue, 'id_token must echo the authorize nonce');
  });

  await test('nonce survives consent screen detour', async () => {
    // Third-party client (no pre-saved consent) goes through pending stash +
    // consent approve before the code is issued. Nonce must survive that trip.
    const deps = makeDeps();
    const regRes = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'Nonce Consent Client',
          redirect_uris: ['https://app.example.com/cb'],
          token_endpoint_auth_method: 'none',
        }),
      },
      deps
    );
    const { client_id } = JSON.parse(regRes.body);
    const verifier = generateSecureToken(32);
    const challenge = generateCodeChallenge(verifier);
    const authRes = await handleAuthorize(
      {
        method: 'GET',
        url: buildAuthorizeUrl({
          client_id,
          redirect_uri: 'https://app.example.com/cb',
          response_type: 'code',
          scope: 'openid mcp:read',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          nonce: 'consent-path-nonce',
        }),
        headers: {},
        userId: 'u-consent-nonce',
      },
      deps
    );
    const pendingId = new URL(authRes.headers.Location).searchParams.get('req')!;
    const consentRes = await handleConsent(
      {
        method: 'POST',
        url: 'https://serv.test/consent',
        headers: {},
        body: formBody({ req: pendingId, decision: 'approve' }),
        userId: 'u-consent-nonce',
      },
      deps
    );
    const code = new URL(consentRes.headers.Location).searchParams.get('code')!;
    const tokenRes = await handleToken(
      {
        method: 'POST',
        url: 'https://serv.test/token',
        headers: {},
        body: formBody({
          grant_type: 'authorization_code',
          code,
          redirect_uri: 'https://app.example.com/cb',
          code_verifier: verifier,
          client_id,
        }),
      },
      deps
    );
    const body = JSON.parse(tokenRes.body);
    const [, payloadB64] = (body.id_token as string).split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    assert.equal(payload.nonce, 'consent-path-nonce');
  });

  await test('no openid scope = no id_token', async () => {
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
    const body = JSON.parse(tokenRes.body);
    assert.equal(body.id_token, undefined);
  });
}

async function testServIntegration() {
  console.log('Serv factory:');

  await test('Serv.buildEndpointDeps wires stores + derives tenant URIs', async () => {
    const { Serv } = await import('../src/serv/index.js');
    const { MemoryTenantStore } = await import('../src/serv/middleware/tenant.js');
    const tenantStore = new MemoryTenantStore();
    tenantStore.add(TEST_TENANT);

    const serv = new Serv({
      baseUrl: 'https://serv.test',
      baseDomain: 'serv.test',
      jwtSecret: 'test-secret-at-least-32-chars-long-1234',
      encryptionKey: 'test-encryption-key-32-chars-long-1234',
      stateSecret: 'test-state-secret-at-least-32-chars-12',
      tenantStore,
    });

    const deps = serv.buildEndpointDeps(TEST_TENANT);
    assert.equal(deps.config.issuer, 'https://serv.test/tenant/test');
    assert.equal(deps.config.authorizeUrl, 'https://serv.test/tenant/test/authorize');
    assert.equal(deps.config.consentUrl, 'https://serv.test/tenant/test/consent');
    assert.equal(deps.config.loginUrl, 'https://serv.test/tenant/test/login');
    assert.ok(deps.codeStore);
    assert.ok(deps.jwtService);
    assert.ok(deps.cimdCache);

    // End-to-end call using the Serv-managed deps
    const registration = await handleRegister(
      {
        method: 'POST',
        url: 'https://serv.test/tenant/test/register',
        headers: {},
        body: JSON.stringify({
          client_name: 'Serv-factory Test',
          redirect_uris: ['https://app.example.com/cb'],
          token_endpoint_auth_method: 'none',
        }),
      },
      deps
    );
    assert.equal(registration.status, 201);
  });
}

async function main() {
  await testRegister();
  await testAuthorize();
  await testConsent();
  await testToken();
  await testRevokeIntrospect();
  await testIdToken();
  await testTokenExchange();
  await testServIntegration();
  await testIntegration();
  console.log('\nAll auth endpoint tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
