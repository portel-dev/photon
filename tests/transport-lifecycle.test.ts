import assert from 'node:assert/strict';
import { TransportLifecycle } from '../src/mcp/transport-lifecycle.js';

interface Session {
  id: string;
  lastActivity: Date;
}

class FakeScheduler {
  callbacks = new Map<object, () => void>();
  setCalls = 0;
  clearCalls = 0;
  unrefCalls = 0;

  setInterval(callback: () => void, _delayMs: number): object {
    const handle = {};
    this.callbacks.set(handle, callback);
    this.setCalls++;
    return handle;
  }

  clearInterval(handle: object): void {
    this.callbacks.delete(handle);
    this.clearCalls++;
  }

  unref(_handle: object): void {
    this.unrefCalls++;
  }

  tick(): void {
    for (const callback of this.callbacks.values()) callback();
  }
}

let now = 1_000;
const scheduler = new FakeScheduler();
const expired: string[] = [];
const closed: string[] = [];
const lifecycle = new TransportLifecycle<Session>({
  idleTimeoutMs: 100,
  cleanupIntervalMs: 10,
  clock: { now: () => now },
  scheduler,
  onExpired: (session) => expired.push(session.id),
  onClose: (session) => closed.push(session.id),
});

lifecycle.set('active', { id: 'active', lastActivity: new Date(now) });
lifecycle.set('idle', { id: 'idle', lastActivity: new Date(now - 101) });
assert.equal(scheduler.setCalls, 0, 'constructing a lifecycle must not start maintenance');

lifecycle.start();
lifecycle.start();
assert.equal(scheduler.setCalls, 1, 'start must be idempotent');
assert.equal(scheduler.unrefCalls, 1);

scheduler.tick();
assert.equal(lifecycle.has('idle'), false);
assert.deepEqual(expired, ['idle']);
assert.equal(lifecycle.has('active'), true);

now += 50;
lifecycle.get('active')!.lastActivity = new Date(now);
now += 50;
scheduler.tick();
assert.equal(lifecycle.has('active'), true, 'recent activity must prevent expiry');

lifecycle.close();
lifecycle.close();
assert.equal(scheduler.clearCalls, 1, 'close must clear the timer once');
assert.deepEqual(closed, ['active']);
assert.equal(lifecycle.size, 0);
assert.equal(scheduler.callbacks.size, 0);

// A closed lifecycle can be reused explicitly by its owner, and a new start
// still creates only one maintenance handle.
lifecycle.set('new', { id: 'new', lastActivity: new Date(now) });
lifecycle.start();
lifecycle.start();
assert.equal(scheduler.setCalls, 2);
lifecycle.close();
assert.deepEqual(closed, ['active', 'new']);

console.log('transport lifecycle tests passed');
