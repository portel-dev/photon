/**
 * Daemon Client Pure Logic Tests
 *
 * Tests pure logic patterns extracted from src/daemon/client.ts
 * without requiring a running daemon socket.
 */

import { strict as assert } from 'assert';
import * as crypto from 'crypto';

// Track test results
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      console.log(`  \u2713 ${name}`);
    })
    .catch((err) => {
      failed++;
      console.log(`  \u2717 ${name}`);
      console.log(`    Error: ${err.message}`);
    });
}

// ── 1. isDaemonConnectionError (line 120) ──────────────────────────────

function isDaemonConnectionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('ENOENT') || msg.includes('ECONNREFUSED') || msg.includes('Connection error');
}

// ── 2. Channel wildcard matching (line 400-402) ────────────────────────

function isChannelMatch(pattern: string, actual: string): boolean {
  return pattern.endsWith(':*') ? actual.startsWith(pattern.slice(0, -1)) : actual === pattern;
}

// ── 3. Reconnect delay calculation (line 463) ──────────────────────────

function calculateReconnectDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
}

// ── 4. Session ID generation (line 20-21) ──────────────────────────────

function generateSessionId(): string {
  return `cli-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
}

// ── 5. Buffer splitting / newline-delimited JSON protocol (line 222-223)

function splitBuffer(buffer: string): { lines: string[]; remaining: string } {
  const parts = buffer.split('\n');
  const remaining = parts.pop() || '';
  return { lines: parts, remaining };
}

// ── 6. Request ID generation pattern ───────────────────────────────────

function generateRequestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// ── Test runner ────────────────────────────────────────────────────────

async function run() {
  console.log('\nDaemon Client Pure Logic Tests');
  console.log('='.repeat(50));

  // ── 1. isDaemonConnectionError ──────────────────────────────────────

  console.log('\n  isDaemonConnectionError:');

  await test('ENOENT error returns true', () => {
    assert.equal(isDaemonConnectionError(new Error('connect ENOENT /tmp/sock')), true);
  });

  await test('ECONNREFUSED error returns true', () => {
    assert.equal(isDaemonConnectionError(new Error('connect ECONNREFUSED')), true);
  });

  await test('Connection error message returns true', () => {
    assert.equal(isDaemonConnectionError(new Error('Connection error: socket hung up')), true);
  });

  await test('regular error returns false', () => {
    assert.equal(isDaemonConnectionError(new Error('timeout')), false);
  });

  await test('string error works', () => {
    assert.equal(isDaemonConnectionError('ENOENT: no such file'), true);
  });

  await test('non-Error object works', () => {
    assert.equal(isDaemonConnectionError({ toString: () => 'ECONNREFUSED' }), true);
  });

  await test('non-matching string returns false', () => {
    assert.equal(isDaemonConnectionError('something else'), false);
  });

  // ── 2. Channel wildcard matching ────────────────────────────────────

  console.log('\n  isChannelMatch:');

  await test('exact match succeeds', () => {
    assert.equal(isChannelMatch('events:claw', 'events:claw'), true);
  });

  await test('exact mismatch fails', () => {
    assert.equal(isChannelMatch('events:claw', 'events:other'), false);
  });

  await test('wildcard matches events:claw', () => {
    assert.equal(isChannelMatch('events:*', 'events:claw'), true);
  });

  await test('wildcard matches events:test', () => {
    assert.equal(isChannelMatch('events:*', 'events:test'), true);
  });

  await test('wildcard matches events: (empty suffix)', () => {
    assert.equal(isChannelMatch('events:*', 'events:'), true);
  });

  await test('wildcard does not match other namespace', () => {
    assert.equal(isChannelMatch('events:*', 'other:claw'), false);
  });

  await test('non-wildcard does not partial match', () => {
    assert.equal(isChannelMatch('events:cl', 'events:claw'), false);
  });

  // ── 3. Reconnect delay calculation ──────────────────────────────────

  console.log('\n  calculateReconnectDelay:');

  await test('attempt 1 → 1000ms', () => {
    assert.equal(calculateReconnectDelay(1), 1000);
  });

  await test('attempt 2 → 2000ms', () => {
    assert.equal(calculateReconnectDelay(2), 2000);
  });

  await test('attempt 3 → 4000ms', () => {
    assert.equal(calculateReconnectDelay(3), 4000);
  });

  await test('attempt 5 → 16000ms', () => {
    assert.equal(calculateReconnectDelay(5), 16000);
  });

  await test('attempt 10 → 30000ms (capped)', () => {
    assert.equal(calculateReconnectDelay(10), 30000);
  });

  await test('attempt 100 → 30000ms (still capped)', () => {
    assert.equal(calculateReconnectDelay(100), 30000);
  });

  // ── 4. Session ID format ────────────────────────────────────────────

  console.log('\n  Session ID generation:');

  await test('starts with "cli-"', () => {
    const id = generateSessionId();
    assert.ok(id.startsWith('cli-'), `Expected "cli-" prefix, got: ${id}`);
  });

  await test('contains process PID', () => {
    const id = generateSessionId();
    assert.ok(id.includes(`${process.pid}`), `Expected PID ${process.pid} in: ${id}`);
  });

  await test('has hex suffix (8 chars)', () => {
    const id = generateSessionId();
    const parts = id.split('-');
    const hexPart = parts[parts.length - 1];
    assert.ok(/^[0-9a-f]{8}$/.test(hexPart), `Expected 8-char hex suffix, got: ${hexPart}`);
  });

  await test('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateSessionId()));
    assert.equal(ids.size, 10, 'Expected 10 unique session IDs');
  });

  // ── 5. Buffer splitting ─────────────────────────────────────────────

  console.log('\n  splitBuffer:');

  await test('complete message: 1 line, empty remaining', () => {
    const result = splitBuffer('{"type":"result"}\n');
    assert.deepEqual(result.lines, ['{"type":"result"}']);
    assert.equal(result.remaining, '');
  });

  await test('multiple messages: 2 lines, empty remaining', () => {
    const result = splitBuffer('{"a":1}\n{"b":2}\n');
    assert.deepEqual(result.lines, ['{"a":1}', '{"b":2}']);
    assert.equal(result.remaining, '');
  });

  await test('partial message: 0 lines, remaining preserved', () => {
    const result = splitBuffer('{"type":"re');
    assert.deepEqual(result.lines, []);
    assert.equal(result.remaining, '{"type":"re');
  });

  await test('mixed: 1 complete line + partial remaining', () => {
    const result = splitBuffer('{"a":1}\n{"partial');
    assert.deepEqual(result.lines, ['{"a":1}']);
    assert.equal(result.remaining, '{"partial');
  });

  await test('empty buffer: 0 lines, empty remaining', () => {
    const result = splitBuffer('');
    assert.deepEqual(result.lines, []);
    assert.equal(result.remaining, '');
  });

  // ── 6. Request ID generation ────────────────────────────────────────

  console.log('\n  generateRequestId:');

  await test('starts with given prefix', () => {
    const id = generateRequestId('req');
    assert.ok(id.startsWith('req_'), `Expected "req_" prefix, got: ${id}`);
  });

  await test('contains timestamp', () => {
    const before = Date.now();
    const id = generateRequestId('sub');
    const after = Date.now();
    const parts = id.split('_');
    const ts = parseInt(parts[1], 10);
    assert.ok(ts >= before && ts <= after, `Timestamp ${ts} not in range [${before}, ${after}]`);
  });

  await test('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateRequestId('test')));
    assert.equal(ids.size, 20, 'Expected 20 unique request IDs');
  });

  await test('works with different prefixes', () => {
    const prefixes = ['req', 'sub', 'pub', 'lock', 'ping'];
    for (const prefix of prefixes) {
      const id = generateRequestId(prefix);
      assert.ok(id.startsWith(`${prefix}_`), `Expected "${prefix}_" prefix, got: ${id}`);
    }
  });

  // ── Summary ─────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
