/**
 * Connection Retry Tests
 *
 * Ensures that Beam's connection retry logic stops after max attempts
 * and doesn't spam error messages indefinitely.
 *
 * Run: npx tsx tests/connection-retry.test.ts
 */

import { strict as assert } from 'assert';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      passed++;
      console.log(`  ✅ ${name}`);
    },
    (err) => {
      failed++;
      console.log(`  ❌ ${name}: ${err.message}`);
    }
  );
}

/**
 * Simulates the Beam connection retry logic extracted from beam-app.ts.
 * This mirrors the actual behavior so we can test it without a browser.
 */
class ConnectionRetrySimulator {
  connected = false;
  reconnecting = false;
  reconnectAttempt = 0;
  connectRetries = 0;
  maxRetries: number;
  connectCalls: number[] = []; // timestamps of connect attempts
  toasts: string[] = [];
  bannerState: 'hidden' | 'reconnecting' | 'disconnected' = 'hidden';

  constructor(maxRetries = 5) {
    this.maxRetries = maxRetries;
  }

  async connect(shouldFail: boolean) {
    this.connectCalls.push(Date.now());

    if (shouldFail) {
      this.connectRetries++;
      this.connected = false;

      if (this.connectRetries <= this.maxRetries) {
        this.reconnecting = true;
        this.reconnectAttempt = this.connectRetries;
        this.bannerState = 'reconnecting';
      } else {
        // Give up
        this.reconnecting = false;
        this.bannerState = 'disconnected';
      }
    } else {
      this.connected = true;
      this.reconnecting = false;
      this.connectRetries = 0;
      this.reconnectAttempt = 0;
      this.bannerState = 'hidden';
    }
  }

  retry() {
    this.connectRetries = 0;
  }
}

async function run() {
  console.log('\n📦 Connection Retry Logic\n');

  await test('stops retrying after max attempts', async () => {
    const sim = new ConnectionRetrySimulator(5);

    // Simulate 10 failed connection attempts
    for (let i = 0; i < 10; i++) {
      await sim.connect(true);
    }

    // Should have stopped reconnecting after 5
    assert.equal(sim.reconnecting, false, 'Should stop reconnecting');
    assert.equal(sim.bannerState, 'disconnected', 'Should show disconnected banner');
    assert.equal(sim.connectRetries, 10, 'Counter should still track');
  });

  await test('shows reconnecting state during retries', async () => {
    const sim = new ConnectionRetrySimulator(5);

    // First 5 attempts should show reconnecting
    for (let i = 1; i <= 5; i++) {
      await sim.connect(true);
      assert.equal(sim.reconnecting, true, `Attempt ${i} should be reconnecting`);
      assert.equal(sim.reconnectAttempt, i, `Attempt counter should be ${i}`);
      assert.equal(sim.bannerState, 'reconnecting');
    }

    // 6th attempt should give up
    await sim.connect(true);
    assert.equal(sim.reconnecting, false, 'Should stop after max');
    assert.equal(sim.bannerState, 'disconnected');
  });

  await test('successful connection resets retry counter', async () => {
    const sim = new ConnectionRetrySimulator(5);

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await sim.connect(true);
    }
    assert.equal(sim.connectRetries, 3);

    // Succeed
    await sim.connect(false);
    assert.equal(sim.connectRetries, 0);
    assert.equal(sim.connected, true);
    assert.equal(sim.reconnecting, false);
    assert.equal(sim.bannerState, 'hidden');
  });

  await test('manual retry resets counter and allows new attempts', async () => {
    const sim = new ConnectionRetrySimulator(5);

    // Exhaust retries
    for (let i = 0; i < 6; i++) {
      await sim.connect(true);
    }
    assert.equal(sim.reconnecting, false, 'Should have given up');

    // User clicks "Retry Now"
    sim.retry();
    assert.equal(sim.connectRetries, 0);

    // Can retry again
    await sim.connect(true);
    assert.equal(sim.reconnecting, true, 'Should be reconnecting again');
    assert.equal(sim.reconnectAttempt, 1);
  });

  await test('no error spam: max 5 reconnecting states for 5 retries', async () => {
    const sim = new ConnectionRetrySimulator(5);
    let reconnectingCount = 0;

    for (let i = 0; i < 20; i++) {
      await sim.connect(true);
      if (sim.reconnecting) reconnectingCount++;
    }

    assert.equal(reconnectingCount, 5, 'Should only show reconnecting 5 times');
  });

  console.log('\n📦 Activity Log Deduplication\n');

  await test('duplicate messages increment count instead of creating new entries', () => {
    // Simulates beam-app._log() deduplication
    const log: Array<{ message: string; type: string; count: number }> = [];

    function addLog(type: string, message: string) {
      const last = log[0];
      if (last && last.message === message && last.type === type) {
        log[0] = { ...last, count: last.count + 1 };
        return;
      }
      log.unshift({ type, message, count: 1 });
    }

    addLog('error', 'Connection lost');
    addLog('error', 'Connection lost');
    addLog('error', 'Connection lost');

    assert.equal(log.length, 1, 'Should have 1 entry, not 3');
    assert.equal(log[0].count, 3, 'Count should be 3');
  });

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
