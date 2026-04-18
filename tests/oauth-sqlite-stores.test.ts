/**
 * SQLite-backed elicitation + grant store tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openOauthDatabase,
  SqliteElicitationStore,
  SqliteGrantStore,
} from '../dist/serv/auth/oauth-sqlite-stores.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-oauth-sqlite-'));
  return join(dir, 'oauth.db');
}

async function testElicitation() {
  console.log('SqliteElicitationStore:');
  const dbPath = tempDbPath();
  const db = await openOauthDatabase(dbPath);
  const store = new SqliteElicitationStore(db);

  await test('create + get round-trip', async () => {
    const req = await store.create({
      sessionId: 's-1',
      photonId: 'stripe',
      provider: 'stripe',
      requiredScopes: ['read_charges'],
      status: 'pending',
      redirectUri: 'https://app/cb',
      expiresAt: new Date(Date.now() + 300_000),
    });
    assert.ok(req.id);
    const found = await store.get(req.id);
    assert.ok(found);
    assert.equal(found.sessionId, 's-1');
    assert.deepEqual(found.requiredScopes, ['read_charges']);
  });

  await test('update mutates status + codeVerifier', async () => {
    const req = await store.create({
      sessionId: 's-2',
      photonId: 'p',
      provider: 'github',
      requiredScopes: [],
      status: 'pending',
      redirectUri: 'https://app/cb',
      expiresAt: new Date(Date.now() + 300_000),
    });
    await store.update(req.id, { status: 'completed', codeVerifier: 'verifier-xyz' });
    const after = await store.get(req.id);
    assert.equal(after?.status, 'completed');
    assert.equal(after?.codeVerifier, 'verifier-xyz');
  });

  await test('expired request returns null + auto-deletes', async () => {
    const req = await store.create({
      sessionId: 's-3',
      photonId: 'p',
      provider: 'github',
      requiredScopes: [],
      status: 'pending',
      redirectUri: 'https://app/cb',
      expiresAt: new Date(Date.now() - 1000),
    });
    assert.equal(await store.get(req.id), null);
  });

  await test('cleanup removes expired records', async () => {
    await store.create({
      sessionId: 's-expired',
      photonId: 'p',
      provider: 'github',
      requiredScopes: [],
      status: 'pending',
      redirectUri: 'https://app/cb',
      expiresAt: new Date(Date.now() - 10_000),
    });
    const removed = await store.cleanup();
    assert.ok(removed >= 1);
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testGrant() {
  console.log('SqliteGrantStore:');
  const dbPath = tempDbPath();
  const db = await openOauthDatabase(dbPath);
  const store = new SqliteGrantStore(db);

  await test('create + find by (tenant, photon, provider, user) round-trip', async () => {
    const grant = await store.create({
      tenantId: 't-1',
      userId: 'u-1',
      photonId: 'stripe',
      provider: 'stripe',
      scopes: ['read', 'write'],
      accessTokenEncrypted: 'cipher-a',
      refreshTokenEncrypted: 'cipher-r',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const found = await store.find('t-1', 'stripe', 'stripe', 'u-1');
    assert.ok(found);
    assert.equal(found.id, grant.id);
    assert.deepEqual(found.scopes, ['read', 'write']);
    assert.equal(found.accessTokenEncrypted, 'cipher-a');
  });

  await test('find with no user (tenant-scoped grant)', async () => {
    await store.create({
      tenantId: 't-1',
      photonId: 'anon-p',
      provider: 'github',
      scopes: [],
      accessTokenEncrypted: 'c',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const found = await store.find('t-1', 'anon-p', 'github');
    assert.ok(found);
    assert.equal(found.userId, undefined);
  });

  await test('update mutates access token + expiry', async () => {
    const grant = await store.create({
      tenantId: 't-1',
      userId: 'u-2',
      photonId: 'p2',
      provider: 'github',
      scopes: [],
      accessTokenEncrypted: 'c-old',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const newExpiry = new Date(Date.now() + 7200_000);
    await store.update(grant.id, {
      accessTokenEncrypted: 'c-new',
      tokenExpiresAt: newExpiry,
    });
    const after = await store.find('t-1', 'p2', 'github', 'u-2');
    assert.equal(after?.accessTokenEncrypted, 'c-new');
    assert.equal(after?.tokenExpiresAt.getTime(), newExpiry.getTime());
  });

  await test('findByUser returns all grants for (tenant, user)', async () => {
    await store.create({
      tenantId: 't-2',
      userId: 'u-many',
      photonId: 'a',
      provider: 'github',
      scopes: [],
      accessTokenEncrypted: 'c',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    await store.create({
      tenantId: 't-2',
      userId: 'u-many',
      photonId: 'b',
      provider: 'stripe',
      scopes: [],
      accessTokenEncrypted: 'c',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const list = await store.findByUser('t-2', 'u-many');
    assert.equal(list.length, 2);
  });

  await test('delete removes grant', async () => {
    const grant = await store.create({
      tenantId: 't-3',
      userId: 'u-del',
      photonId: 'p',
      provider: 'github',
      scopes: [],
      accessTokenEncrypted: 'c',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    await store.delete(grant.id);
    assert.equal(await store.find('t-3', 'p', 'github', 'u-del'), null);
  });

  db.close();
  rmSync(dbPath, { force: true });
}

async function testPersistence() {
  console.log('Persistence across restarts:');
  const dbPath = tempDbPath();
  const db1 = await openOauthDatabase(dbPath);
  const grants1 = new SqliteGrantStore(db1);
  const grant = await grants1.create({
    tenantId: 't-persist',
    userId: 'u',
    photonId: 'stripe',
    provider: 'stripe',
    scopes: ['charges'],
    accessTokenEncrypted: 'persisted-cipher',
    tokenExpiresAt: new Date(Date.now() + 3600_000),
  });
  db1.close();

  const db2 = await openOauthDatabase(dbPath);
  const grants2 = new SqliteGrantStore(db2);

  await test('grant survives daemon restart', async () => {
    const found = await grants2.find('t-persist', 'stripe', 'stripe', 'u');
    assert.ok(found);
    assert.equal(found.id, grant.id);
    assert.equal(found.accessTokenEncrypted, 'persisted-cipher');
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
  await testElicitation();
  await testGrant();
  await testPersistence();
  console.log('\nAll oauth-sqlite-stores tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
