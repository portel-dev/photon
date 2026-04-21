/**
 * SQLite store tests for the authorization server.
 *
 * Runs the same contract as the in-memory stores against the SQLite-backed
 * implementations, plus persistence-across-handle tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openAuthDatabase,
  SqliteAuthCodeStore,
  SqliteRefreshTokenStore,
  SqliteClientRegistry,
  SqliteConsentStore,
  SqlitePendingAuthorizationStore,
} from '../dist/serv/auth/sqlite-stores.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-auth-sqlite-'));
  return join(dir, 'test.db');
}

async function testAuthCodeStore() {
  console.log('SqliteAuthCodeStore:');
  const dbPath = tempDbPath();
  const db = await openAuthDatabase(dbPath);
  const store = new SqliteAuthCodeStore(db);

  await test('save + consume round-trip', async () => {
    await store.save({
      code: 'test-code-1',
      clientId: 'client-a',
      redirectUri: 'https://app/cb',
      scope: 'mcp:read',
      userId: 'u1',
      tenantId: 't1',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    const consumed = await store.consume('test-code-1');
    assert.ok(consumed);
    assert.equal(consumed.clientId, 'client-a');
  });

  await test('consume is single-use', async () => {
    await store.save({
      code: 'test-code-2',
      clientId: 'client-a',
      redirectUri: 'https://app/cb',
      scope: 'mcp:read',
      userId: 'u1',
      tenantId: 't1',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    const first = await store.consume('test-code-2');
    assert.ok(first);
    const second = await store.consume('test-code-2');
    assert.equal(second, null);
  });

  await test('expired code returns null on consume', async () => {
    await store.save({
      code: 'test-code-3',
      clientId: 'client-a',
      redirectUri: 'https://app/cb',
      scope: 'mcp:read',
      userId: 'u1',
      tenantId: 't1',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });
    assert.equal(await store.consume('test-code-3'), null);
  });

  await test('sweep removes expired codes', async () => {
    await store.save({
      code: 'test-code-4',
      clientId: 'client-a',
      redirectUri: 'https://app/cb',
      scope: 'mcp:read',
      userId: 'u1',
      tenantId: 't1',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() - 2000),
      createdAt: new Date(),
    });
    const removed = await store.sweep();
    assert.ok(removed >= 1);
  });

  await test('duplicate code throws collision', async () => {
    const code = {
      code: 'dupe',
      clientId: 'client-a',
      redirectUri: 'https://app/cb',
      scope: 'mcp:read',
      userId: 'u1',
      tenantId: 't1',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256' as const,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    };
    await store.save(code);
    await assert.rejects(() => store.save(code), /collision/);
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testRefreshTokenStore() {
  console.log('SqliteRefreshTokenStore:');
  const dbPath = tempDbPath();
  const db = await openAuthDatabase(dbPath);
  const store = new SqliteRefreshTokenStore(db);

  const baseToken = {
    clientId: 'c1',
    userId: 'u1',
    tenantId: 't1',
    scope: 'mcp:read',
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  };

  await test('save + find round-trip', async () => {
    await store.save({ token: 'rt-1', ...baseToken });
    const found = await store.find('rt-1');
    assert.ok(found);
    assert.equal(found.clientId, 'c1');
  });

  await test('rotate atomically replaces token', async () => {
    await store.save({ token: 'rt-old', ...baseToken });
    const rotated = await store.rotate('rt-old', { token: 'rt-new', ...baseToken });
    assert.ok(rotated);
    assert.equal(await store.find('rt-old'), null, 'old token gone');
    assert.ok(await store.find('rt-new'), 'new token present');
  });

  await test('rotate of unknown token returns null', async () => {
    assert.equal(await store.rotate('does-not-exist', { token: 'x', ...baseToken }), null);
  });

  await test('revoke deletes token', async () => {
    await store.save({ token: 'rt-rev', ...baseToken });
    assert.equal(await store.revoke('rt-rev'), true);
    assert.equal(await store.find('rt-rev'), null);
    assert.equal(await store.revoke('rt-rev'), false, 'second revoke no-op');
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testClientRegistry() {
  console.log('SqliteClientRegistry:');
  const dbPath = tempDbPath();
  const db = await openAuthDatabase(dbPath);
  const store = new SqliteClientRegistry(db);

  await test('save + find round-trip with full metadata', async () => {
    await store.save({
      clientId: 'c1',
      clientSecretHash: 'hash-1',
      clientName: 'Test Client',
      redirectUris: ['https://app/cb', 'http://127.0.0.1:8787/cb'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      scope: 'mcp:read mcp:write',
      contacts: ['sec@app.example'],
      logoUri: 'https://app/logo.png',
      isPublic: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      registrationContext: { userAgent: 'test/1.0', ipAddress: '127.0.0.1' },
    });
    const found = await store.find('c1');
    assert.ok(found);
    assert.equal(found.clientName, 'Test Client');
    assert.deepEqual(found.redirectUris, ['https://app/cb', 'http://127.0.0.1:8787/cb']);
    assert.deepEqual(found.contacts, ['sec@app.example']);
    assert.equal(found.isPublic, false);
    assert.equal(found.registrationContext?.ipAddress, '127.0.0.1');
  });

  await test('touch updates lastUsedAt', async () => {
    const before = await store.find('c1');
    const newTime = new Date(before!.lastUsedAt.getTime() + 10_000);
    await store.touch('c1', newTime);
    const after = await store.find('c1');
    assert.equal(after!.lastUsedAt.getTime(), newTime.getTime());
  });

  await test('sweep evicts idle clients', async () => {
    await store.save({
      clientId: 'c-idle',
      clientName: 'Idle',
      redirectUris: ['https://app/cb'],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      scope: 'mcp:read',
      isPublic: true,
      createdAt: new Date(),
      lastUsedAt: new Date(Date.now() - 100_000),
    });
    const removed = await store.sweep(50_000);
    assert.ok(removed >= 1);
    assert.equal(await store.find('c-idle'), null);
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testConsentStore() {
  console.log('SqliteConsentStore:');
  const dbPath = tempDbPath();
  const db = await openAuthDatabase(dbPath);
  const store = new SqliteConsentStore(db);

  await test('save + covers exact-match round-trip', async () => {
    await store.save({
      userId: 'u1',
      tenantId: 't1',
      clientId: 'c1',
      scopes: 'mcp:read mcp:write',
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    });
    assert.equal(await store.covers('u1', 't1', 'c1', ['mcp:read']), true);
    assert.equal(await store.covers('u1', 't1', 'c1', ['mcp:read', 'mcp:write']), true);
  });

  await test('covers returns false for expanded scopes', async () => {
    assert.equal(await store.covers('u1', 't1', 'c1', ['mcp:admin']), false);
  });

  await test('covers returns false for wrong user', async () => {
    assert.equal(await store.covers('u-other', 't1', 'c1', ['mcp:read']), false);
  });

  await test('revoke removes record', async () => {
    assert.equal(await store.revoke('u1', 't1', 'c1'), true);
    assert.equal(await store.covers('u1', 't1', 'c1', ['mcp:read']), false);
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testPendingStore() {
  console.log('SqlitePendingAuthorizationStore:');
  const dbPath = tempDbPath();
  const db = await openAuthDatabase(dbPath);
  const store = new SqlitePendingAuthorizationStore(db);

  await test('save + consume round-trip', async () => {
    await store.save({
      id: 'p1',
      clientId: 'c1',
      redirectUri: 'https://app/cb',
      scope: 'mcp:read',
      state: 'abc',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      userId: 'u1',
      tenantId: 't1',
      responseType: 'code',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    const consumed = await store.consume('p1');
    assert.ok(consumed);
    assert.equal(consumed.state, 'abc');
    assert.equal(await store.consume('p1'), null, 'single-use');
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testNonceMigration() {
  console.log('Schema migration: nonce backfill:');
  // Simulate an "old" SERV database that pre-dates the nonce column.
  // Manually create the legacy schema, then re-open via openAuthDatabase
  // and expect the ALTER TABLE migration to add the column without erroring.
  const dbPath = tempDbPath();
  // Use the shared runtime-agnostic loader so this test works under Bun
  // (bun:sqlite) as well as Node (better-sqlite3). Directly importing
  // better-sqlite3 fails under Bun due to N-API version mismatch.
  const { openSqlite } = await import('../dist/shared/sqlite-runtime.js');
  const legacyLoader = await openSqlite(dbPath, () => {});
  legacyLoader.exec(`
    CREATE TABLE auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE pending_auth (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      response_type TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  legacyLoader.close();

  await test('openAuthDatabase backfills nonce on legacy schema', async () => {
    const db = await openAuthDatabase(dbPath);
    const codeStore = new SqliteAuthCodeStore(db);
    // Insert with a nonce — would fail with "table has no column nonce"
    // before the migration was added.
    await codeStore.save({
      code: 'mig-1',
      clientId: 'c',
      redirectUri: 'https://app/cb',
      scope: 'openid',
      userId: 'u',
      tenantId: 't',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      nonce: 'preserved-nonce',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    const consumed = await codeStore.consume('mig-1');
    assert.ok(consumed);
    assert.equal(consumed.nonce, 'preserved-nonce');

    // Pending too
    const pendingStore = new SqlitePendingAuthorizationStore(db);
    await pendingStore.save({
      id: 'mig-pend',
      clientId: 'c',
      redirectUri: 'https://app/cb',
      scope: 'openid',
      nonce: 'pending-nonce',
      codeChallenge: 'xxx',
      codeChallengeMethod: 'S256',
      userId: 'u',
      tenantId: 't',
      responseType: 'code',
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
    });
    const p = await pendingStore.consume('mig-pend');
    assert.ok(p);
    assert.equal(p.nonce, 'pending-nonce');

    db.close();
  });

  await test('re-running openAuthDatabase is idempotent (no duplicate column error)', async () => {
    const db = await openAuthDatabase(dbPath);
    db.close();
  });

  rmSync(dbPath, { force: true });
}

async function testPersistence() {
  console.log('Persistence across DB handles:');
  const dbPath = tempDbPath();
  const db1 = await openAuthDatabase(dbPath);
  const store1 = new SqliteRefreshTokenStore(db1);
  await store1.save({
    token: 'rt-persist',
    clientId: 'c1',
    userId: 'u1',
    tenantId: 't1',
    scope: 'mcp:read',
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  });
  db1.close();

  const db2 = await openAuthDatabase(dbPath);
  const store2 = new SqliteRefreshTokenStore(db2);

  await test('token saved in handle 1 is found in handle 2', async () => {
    const found = await store2.find('rt-persist');
    assert.ok(found);
    assert.equal(found.clientId, 'c1');
  });

  db2.close();
  rmSync(dbPath, { force: true });
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

async function main() {
  await testAuthCodeStore();
  await testRefreshTokenStore();
  await testClientRegistry();
  await testConsentStore();
  await testPendingStore();
  await testNonceMigration();
  await testPersistence();
  console.log('\nAll SQLite store tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
