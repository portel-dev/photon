/**
 * Worker Dependency Proxy Tests
 *
 * Regression coverage for the @photon proxy used inside worker-host.ts.
 * The test imports production proxy code so it cannot drift into a duplicate
 * implementation that proves only itself.
 */

import { strict as assert } from 'assert';
import type { ChannelHandler, ChannelMessage, Subscription } from '@portel/photon-core';
import { createWorkerDepProxy, type PendingDepCall } from '../src/daemon/worker-dep-proxy.js';
import type { WorkerToMainMessage } from '../src/daemon/worker-protocol.js';

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

class RecordingBroker {
  subscriptions: Array<{ channel: string; handler: ChannelHandler; active: boolean }> = [];
  published: ChannelMessage[] = [];

  async subscribe(channel: string, handler: ChannelHandler): Promise<Subscription> {
    const record = { channel, handler, active: true };
    this.subscriptions.push(record);
    return {
      channel,
      active: true,
      unsubscribe: () => {
        record.active = false;
      },
    };
  }

  async publish(message: ChannelMessage): Promise<void> {
    this.published.push(message);
  }

  dispatch(channel: string, data: unknown): void {
    for (const subscription of this.subscriptions) {
      if (subscription.channel === channel && subscription.active) {
        subscription.handler({
          channel,
          event: channel.split(':').at(-1) || 'message',
          data,
          timestamp: Date.now(),
          source: channel.split(':')[0],
        });
      }
    }
  }
}

function makeProxy(depName = 'telegram', remoteToolNames = ['send', 'groups', 'status']) {
  const broker = new RecordingBroker();
  const sent: WorkerToMainMessage[] = [];
  const pendingDepCalls = new Map<string, PendingDepCall>();
  let nextId = 0;
  const proxy = createWorkerDepProxy({
    depName,
    remoteToolNames,
    broker,
    send: (msg) => sent.push(msg),
    genId: () => `id-${++nextId}`,
    pendingDepCalls,
    timeoutMs: 1_000,
  });
  return { proxy, broker, sent, pendingDepCalls };
}

async function testDepProxy() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Worker Dependency Proxy');
  console.log(`${'═'.repeat(60)}`);

  await test('proxy exposes known tool methods as async functions', () => {
    const { proxy } = makeProxy();
    assert.equal(typeof proxy.send, 'function');
    assert.equal(typeof proxy.groups, 'function');
    assert.equal(typeof proxy.status, 'function');
  });

  await test('tool method sends a dep_call IPC message', () => {
    const { proxy, sent, pendingDepCalls } = makeProxy();
    void proxy.send({ chatId: '123', text: 'hello' });

    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
      type: 'dep_call',
      id: 'id-1',
      depName: 'telegram',
      method: 'send',
      args: { chatId: '123', text: 'hello' },
    });
    assert.equal(pendingDepCalls.size, 1);
    pendingDepCalls.clear();
  });

  await test('tool methods starting with on are still dep_call methods', () => {
    const { proxy, sent, pendingDepCalls } = makeProxy('calendar', ['onboard']);
    void proxy.onboard({ userId: 'u1' });

    assert.deepEqual(sent[0], {
      type: 'dep_call',
      id: 'id-1',
      depName: 'calendar',
      method: 'onboard',
      args: { userId: 'u1' },
    });
    assert.equal(pendingDepCalls.size, 1);
    pendingDepCalls.clear();
  });

  await test('dep_call promise resolves from the pending call map', async () => {
    const { proxy, pendingDepCalls } = makeProxy();
    const resultPromise = proxy.status();
    const pending = pendingDepCalls.get('id-1');
    assert.ok(pending, 'dep_call should register a pending resolver');

    pendingDepCalls.delete('id-1');
    pending.resolve({ ok: true });
    assert.deepEqual(await resultPromise, { ok: true });
  });

  await test('method with no args defaults to empty object', () => {
    const { proxy, sent, pendingDepCalls } = makeProxy('test', ['status']);
    void proxy.status();
    assert.deepEqual((sent[0] as any).args, {});
    pendingDepCalls.clear();
  });

  await test('unknown properties return undefined', () => {
    const { proxy } = makeProxy('telegram', ['send']);
    assert.equal(proxy.nonexistent, undefined);
    assert.equal(proxy.foo, undefined);
  });

  await test('symbol properties return undefined', () => {
    const { proxy } = makeProxy('test', ['method']);
    assert.equal(proxy[Symbol.toPrimitive], undefined);
  });
}

async function testDepProxyEvents() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Worker Dependency Proxy Events');
  console.log(`${'═'.repeat(60)}`);

  await test('.on() subscribes to the dependency event channel and receives data', () => {
    const { proxy, broker } = makeProxy('telegram', ['send']);
    const received: unknown[] = [];

    proxy.on('message', (data: unknown) => received.push(data));
    assert.equal(broker.subscriptions[0].channel, 'telegram:message');

    broker.dispatch('telegram:message', { text: 'hello' });
    assert.deepEqual(received, [{ text: 'hello' }]);
  });

  await test('onEventName shorthand subscribes to the matching dependency event', () => {
    const { proxy, broker } = makeProxy('notifications', []);
    const received: unknown[] = [];

    proxy.onAlertCreated((data: unknown) => received.push(data));
    assert.equal(broker.subscriptions[0].channel, 'notifications:alertCreated');

    broker.dispatch('notifications:alertCreated', { id: 'a1' });
    assert.deepEqual(received, [{ id: 'a1' }]);
  });

  await test('.off() unsubscribes a previously registered handler', async () => {
    const { proxy, broker } = makeProxy('telegram', []);
    const received: unknown[] = [];
    const handler = (data: unknown) => received.push(data);

    proxy.on('message', handler);
    proxy.off('message', handler);
    await Promise.resolve();

    broker.dispatch('telegram:message', { text: 'after off' });
    assert.deepEqual(received, []);
  });

  await test('.off() removes only the requested event for a reused handler', async () => {
    const { proxy, broker } = makeProxy('telegram', []);
    const received: unknown[] = [];
    const handler = (data: unknown) => received.push(data);

    proxy.on('message', handler);
    proxy.on('status', handler);
    proxy.off('message', handler);
    await Promise.resolve();

    broker.dispatch('telegram:message', { text: 'message should be off' });
    broker.dispatch('telegram:status', { text: 'status should remain' });
    assert.deepEqual(received, [{ text: 'status should remain' }]);
  });

  await test('unsubscribe function returned by .on() disables delivery', async () => {
    const { proxy, broker } = makeProxy('telegram', []);
    const received: unknown[] = [];

    const unsubscribe = proxy.on('message', (data: unknown) => received.push(data));
    unsubscribe();
    await Promise.resolve();

    broker.dispatch('telegram:message', { text: 'after unsubscribe' });
    assert.deepEqual(received, []);
  });

  await test('.emit() publishes to the dependency event channel', async () => {
    const { proxy, broker } = makeProxy('telegram', []);

    await proxy.emit('message', { text: 'outbound' });
    assert.equal(broker.published.length, 1);
    assert.equal(broker.published[0].channel, 'telegram:message');
    assert.equal(broker.published[0].event, 'message');
    assert.deepEqual(broker.published[0].data, { text: 'outbound' });
    assert.equal(broker.published[0].source, 'telegram');
  });
}

async function testDepProxyEdgeCases() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Dep Proxy Edge Cases');
  console.log(`${'═'.repeat(60)}`);

  await test('concurrent calls to same method get independent pending IDs', () => {
    const { proxy, sent, pendingDepCalls } = makeProxy('test', ['fetch']);
    void proxy.fetch({ id: 1 });
    void proxy.fetch({ id: 2 });
    void proxy.fetch({ id: 3 });

    assert.deepEqual(
      sent.map((msg) => (msg as any).id),
      ['id-1', 'id-2', 'id-3']
    );
    assert.equal(pendingDepCalls.size, 3);
    pendingDepCalls.clear();
  });

  await test('multiple proxies for different deps are independent', () => {
    const wa = makeProxy('whatsapp', ['send', 'groups']).proxy;
    const tg = makeProxy('telegram', ['send', 'status']).proxy;

    assert.equal(typeof wa.groups, 'function');
    assert.equal(tg.groups, undefined);
    assert.equal(typeof tg.status, 'function');
    assert.equal(wa.status, undefined);
  });
}

(async () => {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║            WORKER DEPENDENCY PROXY TESTS                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  await testDepProxy();
  await testDepProxyEvents();
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
