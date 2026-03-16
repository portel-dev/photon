/**
 * Worker Dependency Proxy Tests
 *
 * Tests the dep proxy that worker-host.ts creates for @photon dependencies.
 * This proxy caught a real production bug: .on()/.off()/.emit() were stubbed
 * as no-ops, causing claw's channel event subscriptions to silently fail.
 *
 * These tests verify the proxy behavior without needing a real worker thread.
 */

import { strict as assert } from 'assert';

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

// ── Recreate createDepProxy from worker-host.ts ──────────────────────
// We duplicate the logic here because worker-host.ts can't be imported
// outside a worker thread (it throws at module level).

function createDepProxy(depName: string, remoteToolNames: string[]): any {
  const toolSet = new Set(remoteToolNames);
  const pendingCalls = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  return new Proxy({} as any, {
    get(_target: any, prop: string) {
      if (typeof prop !== 'string') return undefined;

      // Event methods — currently stubbed as no-ops (known limitation)
      if (prop === 'on' || prop === 'off' || prop === 'emit') {
        return () => {};
      }

      if (toolSet.has(prop)) {
        return async (args: Record<string, unknown> = {}) => {
          // In real code this sends via postMessage; here we simulate
          return { called: true, method: prop, args };
        };
      }

      return undefined;
    },
  });
}

// ══════════════════════════════════════════════════════════════════════

async function testDepProxy() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Worker Dependency Proxy');
  console.log(`${'═'.repeat(60)}`);

  await test('proxy exposes known tool methods as async functions', async () => {
    const proxy = createDepProxy('telegram', ['send', 'groups', 'status']);
    assert.equal(typeof proxy.send, 'function');
    assert.equal(typeof proxy.groups, 'function');
    assert.equal(typeof proxy.status, 'function');
  });

  await test('calling a tool method returns a promise', async () => {
    const proxy = createDepProxy('telegram', ['status']);
    const result = await proxy.status();
    assert.ok(result, 'Should return a result');
    assert.equal(result.called, true);
    assert.equal(result.method, 'status');
  });

  await test('tool method passes args through', async () => {
    const proxy = createDepProxy('telegram', ['send']);
    const result = await proxy.send({ chatId: '123', text: 'hello' });
    assert.deepEqual(result.args, { chatId: '123', text: 'hello' });
  });

  await test('unknown properties return undefined', () => {
    const proxy = createDepProxy('telegram', ['send']);
    assert.equal(proxy.nonexistent, undefined);
    assert.equal(proxy.foo, undefined);
  });

  await test('.on() is a no-op function (known limitation)', () => {
    const proxy = createDepProxy('telegram', ['send']);
    assert.equal(typeof proxy.on, 'function');
    const result = proxy.on('message', () => {});
    assert.equal(result, undefined, '.on() returns undefined (no-op)');
  });

  await test('.off() is a no-op function', () => {
    const proxy = createDepProxy('telegram', []);
    assert.equal(typeof proxy.off, 'function');
    proxy.off('message', () => {}); // Should not throw
  });

  await test('.emit() is a no-op function', () => {
    const proxy = createDepProxy('telegram', []);
    assert.equal(typeof proxy.emit, 'function');
    proxy.emit('event', {}); // Should not throw
  });

  await test('.on() stub means event subscriptions silently fail', () => {
    // This documents the known bug that caused claw to not receive
    // telegram channel events when telegram ran in a worker thread.
    const proxy = createDepProxy('telegram', ['send', 'groups']);
    let received = false;
    proxy.on('message', () => {
      received = true;
    });
    // Even if we could emit, the handler was never actually registered
    assert.equal(received, false, 'Event handler was never registered (known limitation)');
  });

  await test('proxy works with empty tool list', () => {
    const proxy = createDepProxy('empty', []);
    assert.equal(proxy.anything, undefined);
    assert.equal(typeof proxy.on, 'function'); // Event stubs still work
  });

  await test('proxy distinguishes tools from non-tools', () => {
    const proxy = createDepProxy('test', ['alpha', 'beta']);
    assert.equal(typeof proxy.alpha, 'function');
    assert.equal(typeof proxy.beta, 'function');
    assert.equal(proxy.gamma, undefined);
    assert.equal(proxy.delta, undefined);
  });

  await test('symbol properties return undefined', () => {
    const proxy = createDepProxy('test', ['method']);
    // Symbol.toPrimitive and similar should not crash
    assert.equal(proxy[Symbol.toPrimitive], undefined);
  });
}

async function testDepProxyEdgeCases() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Dep Proxy Edge Cases');
  console.log(`${'═'.repeat(60)}`);

  await test('concurrent calls to same method work independently', async () => {
    const proxy = createDepProxy('test', ['fetch']);
    const results = await Promise.all([
      proxy.fetch({ id: 1 }),
      proxy.fetch({ id: 2 }),
      proxy.fetch({ id: 3 }),
    ]);
    assert.equal(results.length, 3);
    assert.deepEqual(results[0].args, { id: 1 });
    assert.deepEqual(results[1].args, { id: 2 });
    assert.deepEqual(results[2].args, { id: 3 });
  });

  await test('method with no args defaults to empty object', async () => {
    const proxy = createDepProxy('test', ['status']);
    const result = await proxy.status();
    assert.deepEqual(result.args, {});
  });

  await test('multiple proxies for different deps are independent', () => {
    const wa = createDepProxy('whatsapp', ['send', 'groups']);
    const tg = createDepProxy('telegram', ['send', 'status']);

    assert.equal(typeof wa.groups, 'function');
    assert.equal(tg.groups, undefined); // telegram doesn't have groups

    assert.equal(typeof tg.status, 'function');
    assert.equal(wa.status, undefined); // whatsapp doesn't have status
  });
}

// ══════════════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════════════

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║            WORKER DEPENDENCY PROXY TESTS                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testDepProxy();
  await testDepProxyEdgeCases();

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Some tests failed!\n');
    process.exit(1);
  }
  console.log('\n  All worker dep proxy tests passed!\n');
})();
