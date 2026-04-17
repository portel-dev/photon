/**
 * Execution-History Tests
 *
 * Covers persistence, rotation, retention (TTL + per-method cap), and
 * query filtering for the scheduled-job execution log at
 *   {PHOTON_DIR}/.data/{photon}/schedules/executions.jsonl
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import {
  executionsFile,
  previewResult,
  readExecutionHistory,
  recordExecution,
  sweepAllBases,
  sweepExecutions,
  __test__,
} from '../dist/daemon/execution-history.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

/** Point PHOTON_DIR (via getDefaultContext) at a throwaway tree for each block. */
function tmpBase(): string {
  const base = path.join(os.tmpdir(), `photon-exec-${randomUUID()}`);
  fs.mkdirSync(base, { recursive: true });
  return base;
}

async function runTests(): Promise<void> {
  console.log('\nExecution History:');

  await test('recordExecution appends to the per-photon JSONL file', () => {
    const base = tmpBase();
    const photon = 'demo';
    recordExecution(
      photon,
      {
        ts: 1_700_000_000_000,
        jobId: 'demo:sched:abc',
        method: 'sync',
        durationMs: 42,
        status: 'success',
        outputPreview: '{"ok":true}',
      },
      base
    );
    const file = executionsFile(photon, base);
    assert.equal(fs.existsSync(file), true, 'expected jsonl file to exist');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.method, 'sync');
    assert.equal(parsed.status, 'success');
    assert.equal(parsed.durationMs, 42);
  });

  await test('readExecutionHistory filters by method and returns newest-first', () => {
    const base = tmpBase();
    const photon = 'demo';
    for (let i = 0; i < 3; i++) {
      recordExecution(
        photon,
        { ts: 1000 + i, jobId: `j${i}`, method: 'a', durationMs: 1, status: 'success' },
        base
      );
    }
    recordExecution(
      photon,
      { ts: 2000, jobId: 'jb', method: 'b', durationMs: 1, status: 'success' },
      base
    );
    const a = readExecutionHistory(photon, { method: 'a' }, base);
    assert.equal(a.length, 3);
    assert.equal(a[0].ts, 1002, 'newest first');
    assert.equal(a[2].ts, 1000);
    const b = readExecutionHistory(photon, { method: 'b' }, base);
    assert.equal(b.length, 1);
  });

  await test('readExecutionHistory honors limit and sinceTs', () => {
    const base = tmpBase();
    const photon = 'demo';
    for (let i = 0; i < 5; i++) {
      recordExecution(
        photon,
        { ts: 1000 + i * 100, jobId: `j${i}`, method: 'x', durationMs: 1, status: 'success' },
        base
      );
    }
    const limited = readExecutionHistory(photon, { method: 'x', limit: 2 }, base);
    assert.equal(limited.length, 2);
    assert.equal(limited[0].ts, 1400, 'newest first');
    const since = readExecutionHistory(photon, { method: 'x', sinceTs: 1200 }, base);
    assert.equal(since.length, 3, 'entries at or after 1200');
    assert.deepEqual(since.map((e) => e.ts).sort(), [1200, 1300, 1400]);
  });

  await test('error entries carry errorMessage and no outputPreview', () => {
    const base = tmpBase();
    recordExecution(
      'demo',
      {
        ts: 1,
        jobId: 'j',
        method: 'fail',
        durationMs: 7,
        status: 'error',
        errorMessage: 'boom',
      },
      base
    );
    const [e] = readExecutionHistory('demo', { method: 'fail' }, base);
    assert.equal(e.status, 'error');
    assert.equal(e.errorMessage, 'boom');
    assert.equal(e.outputPreview, undefined);
  });

  await test('sweepExecutions drops entries older than the TTL window', () => {
    const base = tmpBase();
    const now = 10_000_000_000;
    const oldTs = now - __test__.TTL_MS - 1000; // stale
    const freshTs = now - 1000; // kept
    recordExecution(
      'demo',
      { ts: oldTs, jobId: 'j0', method: 'x', durationMs: 1, status: 'success' },
      base
    );
    recordExecution(
      'demo',
      { ts: freshTs, jobId: 'j1', method: 'x', durationMs: 1, status: 'success' },
      base
    );
    const file = executionsFile('demo', base);
    sweepExecutions(file, now);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).ts, freshTs);
  });

  await test('sweepExecutions caps per-method count at MAX_ENTRIES_PER_METHOD', () => {
    const base = tmpBase();
    const now = Date.now();
    const cap = __test__.MAX_ENTRIES_PER_METHOD;
    // Write cap + 10 entries, all fresh.
    for (let i = 0; i < cap + 10; i++) {
      recordExecution(
        'demo',
        { ts: now - (cap + 10 - i), jobId: `j${i}`, method: 'x', durationMs: 1, status: 'success' },
        base
      );
    }
    const file = executionsFile('demo', base);
    sweepExecutions(file, now);
    const remaining = fs.readFileSync(file, 'utf-8').trim().split('\n').length;
    assert.equal(remaining, cap, `expected per-method cap ${cap}, got ${remaining}`);
    // The 10 oldest should be gone — first surviving ts is now - cap.
    const first = JSON.parse(fs.readFileSync(file, 'utf-8').trim().split('\n')[0]);
    assert.equal(first.ts, now - cap);
  });

  await test('sweepAllBases walks every photon directory under each base', () => {
    const baseA = tmpBase();
    const baseB = tmpBase();
    const now = 10_000_000_000;
    const stale = now - __test__.TTL_MS - 1;
    recordExecution(
      'p1',
      { ts: stale, jobId: 'a', method: 'x', durationMs: 1, status: 'success' },
      baseA
    );
    recordExecution(
      'p2',
      { ts: stale, jobId: 'b', method: 'x', durationMs: 1, status: 'success' },
      baseB
    );
    sweepAllBases([baseA, baseB], now);
    assert.equal(fs.readFileSync(executionsFile('p1', baseA), 'utf-8').trim(), '');
    assert.equal(fs.readFileSync(executionsFile('p2', baseB), 'utf-8').trim(), '');
  });

  await test('rotation moves the active file aside when it crosses MAX_FILE_SIZE', () => {
    const base = tmpBase();
    const file = executionsFile('demo', base);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bigLine = 'x'.repeat(__test__.MAX_FILE_SIZE + 10);
    fs.writeFileSync(file, bigLine + '\n');
    // Triggers the size check, rotates aside, writes fresh line.
    recordExecution(
      'demo',
      { ts: 1, jobId: 'j', method: 'x', durationMs: 1, status: 'success' },
      base
    );
    assert.equal(fs.existsSync(path.join(path.dirname(file), 'executions.1.jsonl')), true);
    const current = fs.readFileSync(file, 'utf-8').trim().split('\n');
    assert.equal(current.length, 1);
    assert.equal(JSON.parse(current[0]).jobId, 'j');
  });

  await test('previewResult truncates long payloads and skips empty values', () => {
    assert.equal(previewResult(undefined), undefined);
    assert.equal(previewResult(null), undefined);
    assert.equal(previewResult(''), undefined);
    assert.equal(previewResult('hello'), 'hello');
    const big = 'a'.repeat(__test__.OUTPUT_PREVIEW_MAX + 50);
    const out = previewResult(big);
    assert.ok(out && out.length <= __test__.OUTPUT_PREVIEW_MAX + 2);
    assert.ok(out && out.endsWith('…'));
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

void runTests();
