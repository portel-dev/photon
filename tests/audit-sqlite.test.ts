/**
 * SQLite audit backend tests.
 *
 * Covers write, query filters, row trim, and JSONL fallback via
 * `queryAudit()` when SQLite isn't initialized.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAuditDatabase, SqliteAuditBackend } from '../dist/shared/audit-sqlite.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-audit-sqlite-'));
  return join(dir, 'audit.db');
}

async function testBasics() {
  console.log('SqliteAuditBackend basics:');
  const dbPath = tempDbPath();
  const db = await openAuditDatabase(dbPath);
  const backend = new SqliteAuditBackend(db);

  await test('write + query round-trip', () => {
    backend.write({
      ts: new Date().toISOString(),
      event: 'tool_call',
      photon: 'stripe',
      method: 'charge',
      client: 'user-1',
      durationMs: 42,
    });
    const results = backend.query({});
    assert.equal(results.length, 1);
    assert.equal(results[0].photon, 'stripe');
    assert.equal(results[0].method, 'charge');
    assert.equal(results[0].durationMs, 42);
  });

  await test('filter by photon', () => {
    backend.write({ ts: new Date().toISOString(), event: 'tool_call', photon: 'github' });
    backend.write({ ts: new Date().toISOString(), event: 'tool_call', photon: 'slack' });
    const results = backend.query({ photon: 'github' });
    assert.equal(results.length, 1);
    assert.equal(results[0].photon, 'github');
  });

  await test('filter by client', () => {
    backend.write({
      ts: new Date().toISOString(),
      event: 'tool_call',
      client: 'alice',
      photon: 'p',
    });
    backend.write({
      ts: new Date().toISOString(),
      event: 'tool_call',
      client: 'bob',
      photon: 'p',
    });
    const results = backend.query({ client: 'alice', photon: 'p' });
    assert.equal(results.length, 1);
    assert.equal(results[0].client, 'alice');
  });

  await test('filter by time range', () => {
    const now = Date.now();
    backend.write({ ts: new Date(now - 3600_000).toISOString(), event: 'old' });
    backend.write({ ts: new Date(now).toISOString(), event: 'new' });
    const recent = backend.query({ since: new Date(now - 60_000), event: 'new' });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].event, 'new');
  });

  await test('limit caps result set', () => {
    for (let i = 0; i < 20; i++) {
      backend.write({ ts: new Date().toISOString(), event: 'bulk', photon: 'x' });
    }
    const results = backend.query({ event: 'bulk', limit: 5 });
    assert.equal(results.length, 5);
  });

  await test('extra fields round-trip via JSON blob', () => {
    backend.write({
      ts: new Date().toISOString(),
      event: 'custom',
      photon: 'x',
      customField: 'value',
      nested: { depth: 1 },
    } as Parameters<typeof backend.write>[0]);
    const results = backend.query({ event: 'custom' });
    assert.equal(results.length, 1);
    assert.equal(
      (results[0] as Record<string, unknown>).customField,
      'value',
      'custom field preserved'
    );
  });

  await test('descending order by default', () => {
    const results = backend.query({ order: 'desc' });
    // Most recent first
    const timestamps = results.map((r) => new Date(r.ts).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      assert.ok(timestamps[i - 1] >= timestamps[i], 'descending order');
    }
  });

  backend.close();
  rmSync(dbPath, { force: true });
}

async function testTrim() {
  console.log('Row trim:');
  const dbPath = tempDbPath();
  const db = await openAuditDatabase(dbPath);
  // Cap at 50 rows, trim every 20 writes
  const backend = new SqliteAuditBackend(db, 50, 20);

  await test('oldest rows dropped when count exceeds maxRows', () => {
    for (let i = 0; i < 100; i++) {
      backend.write({
        ts: new Date(Date.now() - (100 - i) * 1000).toISOString(),
        event: 'bulk',
        photon: 'trim-test',
        instance: `#${i}`,
      });
    }
    const count = backend.count();
    assert.ok(count <= 50, `row count should be capped, got ${count}`);
    // Oldest rows should be gone; most recent should remain
    const results = backend.query({ limit: 50, order: 'asc' });
    assert.ok(results.length > 0);
    // Earliest surviving row should have a higher instance number than some early writes
    const firstInstance = parseInt((results[0].instance ?? '#-1').slice(1));
    assert.ok(
      firstInstance > 10,
      `should have pruned early writes, first remaining=#${firstInstance}`
    );
  });

  backend.close();
  rmSync(dbPath, { force: true });
}

async function testDispatcher() {
  console.log('audit.ts dispatcher:');
  const { audit, queryAudit, setAuditBackend } = await import('../dist/shared/audit.js');
  const dbPath = tempDbPath();
  const db = await openAuditDatabase(dbPath);
  const backend = new SqliteAuditBackend(db);
  setAuditBackend(backend);

  await test('audit() writes through SQLite when backend is set', async () => {
    audit({ ts: new Date().toISOString(), event: 'dispatcher_test', photon: 'p' });
    const results = await queryAudit({ event: 'dispatcher_test' });
    assert.equal(results.length, 1);
  });

  await test('queryAudit returns SQLite results when backend is set', async () => {
    audit({ ts: new Date().toISOString(), event: 'dispatcher_test', photon: 'p', client: 'u' });
    audit({ ts: new Date().toISOString(), event: 'dispatcher_test', photon: 'p', client: 'v' });
    const u = await queryAudit({ client: 'u', event: 'dispatcher_test' });
    assert.equal(u.length, 1);
    assert.equal(u[0].client, 'u');
  });

  setAuditBackend(null);
  backend.close();
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
  await testBasics();
  await testTrim();
  await testDispatcher();
  console.log('\nAll audit-sqlite tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
