/**
 * Daemon Protocol Validation Tests
 *
 * Comprehensive tests for DaemonRequest/DaemonResponse validation.
 * Covers every message type and ensures malformed requests are rejected.
 * Protocol bugs cause silent failures in daemon ↔ client communication.
 */

import { strict as assert } from 'assert';
import { isValidDaemonRequest, isValidDaemonResponse } from '../src/daemon/protocol.js';

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
      console.log(`    Error: ${err.message}`);
    });
}

// ══════════════════════════════════════════════════════════════════════
// DaemonRequest Validation
// ══════════════════════════════════════════════════════════════════════

async function testRequestValidation() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  DaemonRequest Validation');
  console.log(`${'═'.repeat(60)}`);

  // ── Basics ──

  await test('rejects null', () => {
    assert.equal(isValidDaemonRequest(null), false);
  });

  await test('rejects undefined', () => {
    assert.equal(isValidDaemonRequest(undefined), false);
  });

  await test('rejects primitives', () => {
    assert.equal(isValidDaemonRequest('string'), false);
    assert.equal(isValidDaemonRequest(42), false);
    assert.equal(isValidDaemonRequest(true), false);
  });

  await test('rejects empty object', () => {
    assert.equal(isValidDaemonRequest({}), false);
  });

  await test('rejects missing id', () => {
    assert.equal(isValidDaemonRequest({ type: 'ping' }), false);
  });

  await test('rejects numeric id', () => {
    assert.equal(isValidDaemonRequest({ type: 'ping', id: 123 }), false);
  });

  await test('rejects invalid type', () => {
    assert.equal(isValidDaemonRequest({ type: 'invalid', id: '1' }), false);
  });

  // ── Simple types (no extra required fields) ──

  const simpleTypes = [
    'ping',
    'shutdown',
    'list_jobs',
    'list_locks',
    'get_events_since',
    'clear_instances',
    'status',
  ];
  for (const type of simpleTypes) {
    await test(`accepts valid ${type} request`, () => {
      assert.equal(isValidDaemonRequest({ type, id: 'req-1' }), true);
    });
  }

  // ── Command ──

  await test('command requires method field', () => {
    assert.equal(isValidDaemonRequest({ type: 'command', id: '1' }), false);
  });

  await test('command with method is valid', () => {
    assert.equal(isValidDaemonRequest({ type: 'command', id: '1', method: 'status' }), true);
  });

  await test('command with method and args is valid', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'command',
        id: '1',
        method: 'register',
        args: { group: 'test' },
      }),
      true
    );
  });

  // ── Pub/Sub ──

  await test('subscribe requires channel', () => {
    assert.equal(isValidDaemonRequest({ type: 'subscribe', id: '1' }), false);
  });

  await test('subscribe with channel is valid', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'subscribe', id: '1', channel: 'events:claw' }),
      true
    );
  });

  await test('unsubscribe requires channel', () => {
    assert.equal(isValidDaemonRequest({ type: 'unsubscribe', id: '1' }), false);
  });

  await test('publish requires channel', () => {
    assert.equal(isValidDaemonRequest({ type: 'publish', id: '1' }), false);
  });

  await test('publish with channel is valid', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'publish',
        id: '1',
        channel: 'events:test',
        message: { data: 1 },
      }),
      true
    );
  });

  // ── Locks ──

  await test('lock requires lockName', () => {
    assert.equal(isValidDaemonRequest({ type: 'lock', id: '1' }), false);
  });

  await test('lock with lockName is valid', () => {
    assert.equal(isValidDaemonRequest({ type: 'lock', id: '1', lockName: 'sync' }), true);
  });

  await test('unlock requires lockName', () => {
    assert.equal(isValidDaemonRequest({ type: 'unlock', id: '1' }), false);
  });

  await test('unlock with lockName is valid', () => {
    assert.equal(isValidDaemonRequest({ type: 'unlock', id: '1', lockName: 'sync' }), true);
  });

  // ── Schedule ──

  await test('schedule requires jobId', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'schedule', id: '1', method: 'm', cron: '0 * * * *' }),
      false
    );
  });

  await test('schedule requires method', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'schedule', id: '1', jobId: 'j1', cron: '0 * * * *' }),
      false
    );
  });

  await test('schedule requires cron', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'schedule', id: '1', jobId: 'j1', method: 'm' }),
      false
    );
  });

  await test('schedule with all required fields is valid', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'schedule',
        id: '1',
        jobId: 'claw:compact',
        method: '_compactAll',
        cron: '0 3 * * *',
      }),
      true
    );
  });

  await test('unschedule requires jobId', () => {
    assert.equal(isValidDaemonRequest({ type: 'unschedule', id: '1' }), false);
  });

  await test('unschedule with jobId is valid', () => {
    assert.equal(isValidDaemonRequest({ type: 'unschedule', id: '1', jobId: 'j1' }), true);
  });

  // ── Reload ──

  await test('reload requires photonPath', () => {
    assert.equal(isValidDaemonRequest({ type: 'reload', id: '1' }), false);
  });

  await test('reload with photonPath is valid', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'reload', id: '1', photonPath: '/path/to/photon.ts' }),
      true
    );
  });

  // ── Prompt response ──

  await test('prompt_response is valid without extra fields', () => {
    assert.equal(isValidDaemonRequest({ type: 'prompt_response', id: '1' }), true);
  });

  await test('prompt_response with promptValue is valid', () => {
    assert.equal(
      isValidDaemonRequest({ type: 'prompt_response', id: '1', promptValue: 'yes' }),
      true
    );
  });

  // ── Optional fields don't break validation ──

  await test('extra optional fields are tolerated', () => {
    assert.equal(
      isValidDaemonRequest({
        type: 'command',
        id: '1',
        method: 'status',
        photonName: 'claw',
        sessionId: 's1',
        clientType: 'cli',
        instanceName: 'default',
        workingDir: '/tmp',
      }),
      true
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// DaemonResponse Validation
// ══════════════════════════════════════════════════════════════════════

async function testResponseValidation() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  DaemonResponse Validation');
  console.log(`${'═'.repeat(60)}`);

  await test('rejects null', () => {
    assert.equal(isValidDaemonResponse(null), false);
  });

  await test('rejects missing id', () => {
    assert.equal(isValidDaemonResponse({ type: 'result' }), false);
  });

  await test('rejects invalid type', () => {
    assert.equal(isValidDaemonResponse({ type: 'invalid', id: '1' }), false);
  });

  const responseTypes = [
    'result',
    'error',
    'pong',
    'prompt',
    'channel_message',
    'refresh_needed',
    'emit',
  ];
  for (const type of responseTypes) {
    await test(`accepts valid ${type} response`, () => {
      assert.equal(isValidDaemonResponse({ type, id: 'res-1' }), true);
    });
  }

  await test('result with data is valid', () => {
    assert.equal(
      isValidDaemonResponse({ type: 'result', id: '1', success: true, data: { groups: [] } }),
      true
    );
  });

  await test('error with error message is valid', () => {
    assert.equal(
      isValidDaemonResponse({ type: 'error', id: '1', error: 'Something went wrong' }),
      true
    );
  });

  await test('prompt with prompt details is valid', () => {
    assert.equal(
      isValidDaemonResponse({
        type: 'prompt',
        id: '1',
        prompt: { type: 'confirm', message: 'Continue?' },
      }),
      true
    );
  });

  await test('emit with emitData is valid', () => {
    assert.equal(
      isValidDaemonResponse({ type: 'emit', id: '1', emitData: { status: 'running' } }),
      true
    );
  });

  await test('channel_message with channel and message is valid', () => {
    assert.equal(
      isValidDaemonResponse({
        type: 'channel_message',
        id: '1',
        channel: 'events:test',
        message: { event: 'update' },
      }),
      true
    );
  });
}

// ══════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          DAEMON PROTOCOL VALIDATION TESTS                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testRequestValidation();
  await testResponseValidation();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All protocol validation tests passed!\n');
})();
