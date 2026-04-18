/**
 * SQLite execution-history backend tests.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openExecutionHistoryDatabase,
  SqliteExecutionHistoryBackend,
} from '../dist/daemon/execution-history-sqlite.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'photon-exec-hist-sqlite-'));
  return join(dir, 'exec.db');
}

async function testBasics() {
  console.log('SqliteExecutionHistoryBackend basics:');
  const dbPath = tempDbPath();
  const db = await openExecutionHistoryDatabase(dbPath);
  const backend = new SqliteExecutionHistoryBackend(db);

  await test('record + query round-trip', () => {
    backend.record('photon-a', {
      ts: Date.now(),
      jobId: 'j-1',
      method: 'sendReport',
      durationMs: 123,
      status: 'success',
    });
    const results = backend.query('photon-a', {});
    assert.equal(results.length, 1);
    assert.equal(results[0].jobId, 'j-1');
    assert.equal(results[0].method, 'sendReport');
  });

  await test('query scoped to photon', () => {
    backend.record('photon-a', {
      ts: Date.now(),
      jobId: 'j-2',
      method: 'x',
      durationMs: 1,
      status: 'success',
    });
    backend.record('photon-b', {
      ts: Date.now(),
      jobId: 'j-3',
      method: 'x',
      durationMs: 1,
      status: 'success',
    });
    const a = backend.query('photon-a', {});
    const b = backend.query('photon-b', {});
    assert.ok(a.every((e) => e.jobId !== 'j-3'));
    assert.ok(b.every((e) => e.jobId === 'j-3'));
  });

  await test('filter by method', () => {
    backend.record('photon-c', {
      ts: Date.now(),
      jobId: 'j-4',
      method: 'alpha',
      durationMs: 1,
      status: 'success',
    });
    backend.record('photon-c', {
      ts: Date.now(),
      jobId: 'j-5',
      method: 'beta',
      durationMs: 1,
      status: 'success',
    });
    const alpha = backend.query('photon-c', { method: 'alpha' });
    assert.equal(alpha.length, 1);
    assert.equal(alpha[0].method, 'alpha');
  });

  await test('filter by sinceTs', () => {
    const now = Date.now();
    backend.record('photon-d', {
      ts: now - 3600_000,
      jobId: 'j-old',
      method: 'x',
      durationMs: 1,
      status: 'success',
    });
    backend.record('photon-d', {
      ts: now,
      jobId: 'j-new',
      method: 'x',
      durationMs: 1,
      status: 'success',
    });
    const recent = backend.query('photon-d', { sinceTs: now - 60_000 });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].jobId, 'j-new');
  });

  await test('limit caps result set', () => {
    for (let i = 0; i < 15; i++) {
      backend.record('photon-e', {
        ts: Date.now() + i,
        jobId: `bulk-${i}`,
        method: 'bulk',
        durationMs: 1,
        status: 'success',
      });
    }
    const results = backend.query('photon-e', { limit: 5 });
    assert.equal(results.length, 5);
  });

  await test('newest first (DESC order)', () => {
    const a = backend.query('photon-e', {});
    for (let i = 1; i < a.length; i++) {
      assert.ok(a[i - 1].ts >= a[i].ts, 'descending timestamp');
    }
  });

  await test('output preview + error message round-trip', () => {
    backend.record('photon-f', {
      ts: Date.now(),
      jobId: 'j-fail',
      method: 'explode',
      durationMs: 10,
      status: 'error',
      errorMessage: 'boom',
      outputPreview: '{"x":1}',
    });
    const results = backend.query('photon-f', {});
    assert.equal(results[0].errorMessage, 'boom');
    assert.equal(results[0].outputPreview, '{"x":1}');
  });

  backend.close();
  rmSync(dbPath, { force: true });
}

async function testSweep() {
  console.log('Sweep:');
  const dbPath = tempDbPath();
  const db = await openExecutionHistoryDatabase(dbPath);
  const backend = new SqliteExecutionHistoryBackend(db);

  await test('TTL sweep removes old rows', () => {
    const now = Date.now();
    backend.record('p', {
      ts: now - 30 * 24 * 60 * 60 * 1000,
      jobId: 'old',
      method: 'm',
      durationMs: 1,
      status: 'success',
    });
    backend.record('p', {
      ts: now,
      jobId: 'new',
      method: 'm',
      durationMs: 1,
      status: 'success',
    });
    const removed = backend.sweep({ ttlMs: 14 * 24 * 60 * 60 * 1000, now });
    assert.ok(removed >= 1);
    const results = backend.query('p', {});
    assert.equal(results.length, 1);
    assert.equal(results[0].jobId, 'new');
  });

  await test('per-method cap keeps newest N', () => {
    for (let i = 0; i < 20; i++) {
      backend.record('cap-p', {
        ts: Date.now() + i,
        jobId: `c-${i}`,
        method: 'capped',
        durationMs: 1,
        status: 'success',
      });
    }
    backend.sweep({ maxPerMethod: 5 });
    const results = backend.query('cap-p', { method: 'capped' });
    assert.equal(results.length, 5);
    // Newest survive
    const ids = results.map((r) => r.jobId);
    assert.ok(ids.includes('c-19'));
    assert.ok(!ids.includes('c-0'));
  });

  backend.close();
  rmSync(dbPath, { force: true });
}

async function testDispatcher() {
  console.log('execution-history.ts dispatcher:');
  const { recordExecution, readExecutionHistory, setExecutionHistoryBackend } =
    await import('../dist/daemon/execution-history.js');
  const dbPath = tempDbPath();
  const db = await openExecutionHistoryDatabase(dbPath);
  const backend = new SqliteExecutionHistoryBackend(db);
  setExecutionHistoryBackend(backend);

  await test('recordExecution writes to SQLite when backend set', () => {
    recordExecution('photon-x', {
      ts: Date.now(),
      jobId: 'dispatch-1',
      method: 'hello',
      durationMs: 5,
      status: 'success',
    });
    const results = readExecutionHistory('photon-x', {});
    assert.equal(results.length, 1);
    assert.equal(results[0].jobId, 'dispatch-1');
  });

  setExecutionHistoryBackend(null);
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
  await testSweep();
  await testDispatcher();
  console.log('\nAll execution-history-sqlite tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
