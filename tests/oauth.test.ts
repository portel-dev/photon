/**
 * OAuth, JWT, PKCE, Token Vault, and Well-Known Tests
 *
 * Tests auth primitives used by SERV's OAuth 2.1 implementation.
 */

import assert from 'node:assert/strict';
import {
  JwtService,
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  encodeOAuthState,
  decodeOAuthState,
} from '../src/serv/auth/jwt.js';
import type { OAuthState } from '../src/serv/auth/jwt.js';
import {
  OAuthProviderRegistry,
  MemoryElicitationStore,
  MemoryGrantStore,
} from '../src/serv/auth/oauth.js';
import { LocalTokenVault } from '../src/serv/vault/token-vault.js';
import {
  generateProtectedResourceMetadata,
  generateAuthServerMetadata,
  generateWwwAuthenticate,
} from '../src/serv/auth/well-known.js';
import { OAuthElicitationRequired } from '../src/serv/runtime/oauth-context.js';
import type { Tenant, Session } from '../src/serv/types/index.js';

// ============================================================================
// Test runner
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    });
}

// ============================================================================
// Fixtures
// ============================================================================

const TEST_SECRET = 'test-secret-key-that-is-at-least-32-bytes-long!!';
const TEST_ISSUER = 'https://serv.test.local';

function makeTenant(overrides?: Partial<Tenant>): Tenant {
  return {
    id: 'tenant-1',
    name: 'Test Tenant',
    slug: 'test-tenant',
    region: 'us-east-1',
    plan: 'pro',
    encryptionKeyId: 'key-1',
    settings: {
      allowAnonymousUsers: true,
      sponsoredPhotons: [],
    },
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 'session-1',
    tenantId: 'tenant-1',
    clientId: 'client-1',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// JwtService
// ============================================================================

async function testJwtService() {
  console.log('\nJwtService:');

  const jwt = new JwtService({ secret: TEST_SECRET, issuer: TEST_ISSUER });
  const tenant = makeTenant();
  const session = makeSession();

  await test('sign and verify round-trip', () => {
    const token = jwt.generateSessionToken(session, tenant);
    const decoded = jwt.verifySessionToken(token);
    assert.ok(decoded, 'Token should verify');
    assert.equal(decoded.iss, TEST_ISSUER);
    assert.equal(decoded.jti, session.id);
    assert.equal(decoded.tenant_id, tenant.id);
  });

  await test('tampered signature is rejected', () => {
    const token = jwt.generateSessionToken(session, tenant);
    const parts = token.split('.');
    // Flip a character in the signature
    const sig = parts[2];
    parts[2] = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
    const tampered = parts.join('.');
    assert.equal(jwt.verifySessionToken(tampered), null);
  });

  await test('expired token is rejected', () => {
    const expiredSession = makeSession({
      expiresAt: new Date(Date.now() - 1000),
    });
    const token = jwt.generateSessionToken(expiredSession, tenant);
    assert.equal(jwt.verifySessionToken(token), null);
  });

  await test('wrong issuer is rejected', () => {
    const otherJwt = new JwtService({ secret: TEST_SECRET, issuer: 'https://other.local' });
    const token = otherJwt.generateSessionToken(session, tenant);
    // Verify with original service that expects TEST_ISSUER
    assert.equal(jwt.verifySessionToken(token), null);
  });

  await test('decode returns payload without verification', () => {
    const otherJwt = new JwtService({ secret: 'another-secret-key-at-least-32-chars!!', issuer: 'other' });
    const token = otherJwt.generateSessionToken(session, tenant);
    // decode() should work even though signature doesn't match our secret
    const decoded = jwt.decode(token);
    assert.ok(decoded, 'decode should return payload');
    assert.equal(decoded.jti, session.id);
  });
}

// ============================================================================
// PKCE
// ============================================================================

async function testPkce() {
  console.log('\nPKCE:');

  await test('verifier is base64url string of correct length', () => {
    const verifier = generateCodeVerifier();
    assert.ok(verifier.length > 0, 'Verifier should not be empty');
    // 32 bytes → 43 base64url chars
    assert.equal(verifier.length, 43);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(verifier), 'Should be valid base64url');
  });

  await test('challenge is deterministic for same verifier', () => {
    const verifier = generateCodeVerifier();
    const c1 = generateCodeChallenge(verifier);
    const c2 = generateCodeChallenge(verifier);
    assert.equal(c1, c2);
  });

  await test('verify matches correct verifier/challenge pair', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    assert.ok(verifyCodeChallenge(verifier, challenge));
  });

  await test('verify rejects wrong verifier', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const wrongVerifier = generateCodeVerifier();
    assert.equal(verifyCodeChallenge(wrongVerifier, challenge), false);
  });
}

// ============================================================================
// OAuth State
// ============================================================================

async function testOAuthState() {
  console.log('\nOAuth State:');

  const state: OAuthState = {
    sessionId: 'sess-1',
    elicitationId: 'elic-1',
    photonId: 'photon-1',
    provider: 'google',
    nonce: 'abc123',
    timestamp: Date.now(),
  };

  await test('encode/decode round-trip', () => {
    const encoded = encodeOAuthState(state, TEST_SECRET);
    const decoded = decodeOAuthState(encoded, TEST_SECRET);
    assert.ok(decoded);
    assert.equal(decoded.sessionId, state.sessionId);
    assert.equal(decoded.provider, state.provider);
    assert.equal(decoded.photonId, state.photonId);
  });

  await test('wrong secret returns null', () => {
    const encoded = encodeOAuthState(state, TEST_SECRET);
    assert.equal(decodeOAuthState(encoded, 'wrong-secret'), null);
  });

  await test('expired state returns null', () => {
    const oldState: OAuthState = { ...state, timestamp: Date.now() - 6 * 60 * 1000 };
    const encoded = encodeOAuthState(oldState, TEST_SECRET);
    assert.equal(decodeOAuthState(encoded, TEST_SECRET), null);
  });

  await test('malformed input returns null', () => {
    assert.equal(decodeOAuthState('not-valid-base64url!!!', TEST_SECRET), null);
  });
}

// ============================================================================
// ProviderRegistry
// ============================================================================

async function testProviderRegistry() {
  console.log('\nProviderRegistry:');

  await test('register builtin provider', () => {
    const reg = new OAuthProviderRegistry();
    reg.register('google', 'client-id', 'client-secret');
    assert.ok(reg.has('google'));
    const p = reg.get('google');
    assert.ok(p);
    assert.equal(p.clientId, 'client-id');
    assert.equal(p.name, 'Google');
  });

  await test('has returns false for unregistered', () => {
    const reg = new OAuthProviderRegistry();
    assert.equal(reg.has('nonexistent'), false);
  });

  await test('registerCustom stores custom provider', () => {
    const reg = new OAuthProviderRegistry();
    reg.registerCustom({
      id: 'custom',
      name: 'Custom',
      authorizationUrl: 'https://custom.local/auth',
      tokenUrl: 'https://custom.local/token',
      scopes: ['read'],
      clientId: 'cid',
      clientSecret: 'csec',
    });
    assert.ok(reg.has('custom'));
    assert.equal(reg.get('custom')!.name, 'Custom');
  });

  await test('get returns null for unknown provider', () => {
    const reg = new OAuthProviderRegistry();
    assert.equal(reg.get('unknown'), null);
  });
}

// ============================================================================
// ElicitationStore
// ============================================================================

async function testElicitationStore() {
  console.log('\nElicitationStore:');

  await test('create and get', async () => {
    const store = new MemoryElicitationStore();
    const req = await store.create({
      sessionId: 's1',
      photonId: 'p1',
      provider: 'google',
      requiredScopes: ['email'],
      status: 'pending',
      redirectUri: 'https://localhost/callback',
      expiresAt: new Date(Date.now() + 60000),
    });
    assert.ok(req.id);
    const fetched = await store.get(req.id);
    assert.ok(fetched);
    assert.equal(fetched.sessionId, 's1');
  });

  await test('expired request returns null', async () => {
    const store = new MemoryElicitationStore();
    const req = await store.create({
      sessionId: 's1',
      photonId: 'p1',
      provider: 'google',
      requiredScopes: ['email'],
      status: 'pending',
      redirectUri: 'https://localhost/callback',
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    assert.equal(await store.get(req.id), null);
  });

  await test('update modifies fields', async () => {
    const store = new MemoryElicitationStore();
    const req = await store.create({
      sessionId: 's1',
      photonId: 'p1',
      provider: 'google',
      requiredScopes: ['email'],
      status: 'pending',
      redirectUri: 'https://localhost/callback',
      expiresAt: new Date(Date.now() + 60000),
    });
    await store.update(req.id, { status: 'completed' });
    const fetched = await store.get(req.id);
    assert.ok(fetched);
    assert.equal(fetched.status, 'completed');
  });

  await test('delete removes request', async () => {
    const store = new MemoryElicitationStore();
    const req = await store.create({
      sessionId: 's1',
      photonId: 'p1',
      provider: 'google',
      requiredScopes: ['email'],
      status: 'pending',
      redirectUri: 'https://localhost/callback',
      expiresAt: new Date(Date.now() + 60000),
    });
    await store.delete(req.id);
    assert.equal(await store.get(req.id), null);
  });

  await test('cleanup removes expired entries', async () => {
    const store = new MemoryElicitationStore();
    await store.create({
      sessionId: 's1',
      photonId: 'p1',
      provider: 'google',
      requiredScopes: ['email'],
      status: 'pending',
      redirectUri: 'https://localhost/callback',
      expiresAt: new Date(Date.now() - 1000),
    });
    await store.create({
      sessionId: 's2',
      photonId: 'p2',
      provider: 'github',
      requiredScopes: ['repo'],
      status: 'pending',
      redirectUri: 'https://localhost/callback',
      expiresAt: new Date(Date.now() + 60000),
    });
    const cleaned = await store.cleanup();
    assert.equal(cleaned, 1);
  });
}

// ============================================================================
// GrantStore
// ============================================================================

async function testGrantStore() {
  console.log('\nGrantStore:');

  const grantData = {
    tenantId: 't1',
    photonId: 'p1',
    provider: 'google',
    scopes: ['email'],
    accessTokenEncrypted: 'enc-access',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  };

  await test('create and find', async () => {
    const store = new MemoryGrantStore();
    const grant = await store.create(grantData);
    assert.ok(grant.id);
    const found = await store.find('t1', 'p1', 'google');
    assert.ok(found);
    assert.equal(found.id, grant.id);
  });

  await test('find miss returns null', async () => {
    const store = new MemoryGrantStore();
    assert.equal(await store.find('t1', 'p1', 'google'), null);
  });

  await test('findByUser returns matching grants', async () => {
    const store = new MemoryGrantStore();
    await store.create({ ...grantData, userId: 'u1' });
    await store.create({ ...grantData, photonId: 'p2', userId: 'u1' });
    await store.create({ ...grantData, photonId: 'p3', userId: 'u2' });
    const grants = await store.findByUser('t1', 'u1');
    assert.equal(grants.length, 2);
  });

  await test('update modifies grant', async () => {
    const store = new MemoryGrantStore();
    const grant = await store.create(grantData);
    await store.update(grant.id, { scopes: ['email', 'profile'] });
    const found = await store.find('t1', 'p1', 'google');
    assert.ok(found);
    assert.deepEqual(found.scopes, ['email', 'profile']);
  });

  await test('delete removes grant', async () => {
    const store = new MemoryGrantStore();
    const grant = await store.create(grantData);
    await store.delete(grant.id);
    assert.equal(await store.find('t1', 'p1', 'google'), null);
  });
}

// ============================================================================
// LocalTokenVault
// ============================================================================

async function testLocalTokenVault() {
  console.log('\nLocalTokenVault:');

  const masterKey = 'a-very-long-master-key-for-testing-at-least-32!';

  await test('encrypt/decrypt round-trip', async () => {
    const vault = new LocalTokenVault({ masterKey });
    const plaintext = 'ya29.access-token-value';
    const encrypted = await vault.encrypt('tenant-1', plaintext);
    assert.notEqual(encrypted, plaintext);
    const decrypted = await vault.decrypt('tenant-1', encrypted);
    assert.equal(decrypted, plaintext);
  });

  await test('different tenants produce different ciphertext', async () => {
    const vault = new LocalTokenVault({ masterKey });
    const plaintext = 'same-token';
    const e1 = await vault.encrypt('tenant-a', plaintext);
    const e2 = await vault.encrypt('tenant-b', plaintext);
    assert.notEqual(e1, e2);
  });

  await test('wrong tenant cannot decrypt', async () => {
    const vault = new LocalTokenVault({ masterKey });
    const encrypted = await vault.encrypt('tenant-a', 'secret');
    await assert.rejects(
      () => vault.decrypt('tenant-b', encrypted),
      /Unsupported state/
    );
  });
}

// ============================================================================
// Well-Known
// ============================================================================

async function testWellKnown() {
  console.log('\nWell-Known:');

  const config = { baseUrl: 'https://serv.example.com' };
  const tenant = makeTenant();

  await test('protectedResource metadata has correct resource URI', () => {
    const meta = generateProtectedResourceMetadata(config, tenant);
    assert.equal(meta.resource, 'https://serv.example.com/tenant/test-tenant/mcp');
    assert.ok(meta.authorization_servers.length > 0);
  });

  await test('authServer metadata has required endpoints', () => {
    const meta = generateAuthServerMetadata(config, tenant);
    assert.ok(meta.issuer.includes('test-tenant'));
    assert.ok(meta.authorization_endpoint.endsWith('/authorize'));
    assert.ok(meta.token_endpoint.endsWith('/token'));
    assert.deepEqual(meta.response_types_supported, ['code']);
    assert.ok(meta.code_challenge_methods_supported!.includes('S256'));
  });

  await test('wwwAuthenticate includes realm and resource_metadata', () => {
    const header = generateWwwAuthenticate('https://serv.example.com', tenant);
    assert.ok(header.startsWith('Bearer'));
    assert.ok(header.includes('realm="test-tenant"'));
    assert.ok(header.includes('resource_metadata='));
  });

  await test('wwwAuthenticate includes error when provided', () => {
    const header = generateWwwAuthenticate(
      'https://serv.example.com',
      tenant,
      'invalid_token',
      'Token expired'
    );
    assert.ok(header.includes('error="invalid_token"'));
    assert.ok(header.includes('error_description="Token expired"'));
  });
}

// ============================================================================
// OAuthElicitationRequired
// ============================================================================

async function testOAuthElicitationRequired() {
  console.log('\nOAuthElicitationRequired:');

  await test('constructor sets all fields', () => {
    const err = new OAuthElicitationRequired({
      elicitationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?...',
      elicitationId: 'elic-123',
      provider: 'google',
      scopes: ['email', 'profile'],
      message: 'Need Google access',
    });
    assert.equal(err.code, 'OAUTH_ELICITATION_REQUIRED');
    assert.equal(err.provider, 'google');
    assert.equal(err.elicitationId, 'elic-123');
    assert.deepEqual(err.scopes, ['email', 'profile']);
    assert.equal(err.message, 'Need Google access');
    assert.ok(err instanceof Error);
  });

  await test('toMCPError has correct structure', () => {
    const err = new OAuthElicitationRequired({
      elicitationUrl: 'https://example.com/auth',
      elicitationId: 'elic-456',
      provider: 'github',
      scopes: ['repo'],
    });
    const mcp = err.toMCPError();
    assert.equal(mcp.error.code, 'OAUTH_ELICITATION_REQUIRED');
    assert.equal(mcp.error.data.elicitation.type, 'oauth');
    assert.equal(mcp.error.data.elicitation.url, 'https://example.com/auth');
    assert.equal(mcp.error.data.elicitation.id, 'elic-456');
    assert.equal(mcp.error.data.elicitation.provider, 'github');
    assert.deepEqual(mcp.error.data.elicitation.scopes, ['repo']);
  });
}

// ============================================================================
// Run
// ============================================================================

(async () => {
  console.log('Running OAuth & Auth Tests...\n');

  await testJwtService();
  await testPkce();
  await testOAuthState();
  await testProviderRegistry();
  await testElicitationStore();
  await testGrantStore();
  await testLocalTokenVault();
  await testWellKnown();
  await testOAuthElicitationRequired();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
