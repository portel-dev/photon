/**
 * Subscription/notify wiring for `resources/subscribe`.
 *
 * The full MCP wire path is exercised in cross-transport smoke tests; here we
 * pin the unit-level contract:
 *
 *   1. `SubscriptionRegistry.notify(uri)` fans out to every sink subscribed
 *      to the *exact* URI (no template matching — the spec is exact).
 *   2. `unsubscribe(sink, uri)` removes only that pair; other sinks/uris are
 *      untouched.
 *   3. `disconnect(sink)` purges every subscription for that sink in one shot
 *      (used by the SSE close handler).
 *   4. A failing sink does not block other sinks from receiving the notify.
 *   5. PhotonLoader's `setResourceUpdateNotifier(fn)` wires
 *      `this.notifyResourceUpdated(uri)` in a loaded photon to fire `fn(uri)`.
 *
 * Together these assertions cover the contract every transport relies on:
 * subscriptions outlive the originating tool call, sessions clean up on
 * disconnect, and one bad subscriber never blocks the rest.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhotonLoader } from '../dist/loader.js';
import { SubscriptionRegistry } from '../dist/resource-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('SubscriptionRegistry', () => {
  it('fans out notify to every subscriber on the exact URI', async () => {
    const reg = new SubscriptionRegistry();
    const a: string[] = [];
    const b: string[] = [];
    const sinkA = (uri: string) => void a.push(uri);
    const sinkB = (uri: string) => void b.push(uri);
    reg.subscribe(sinkA, 'person://alice');
    reg.subscribe(sinkB, 'person://alice');
    reg.subscribe(sinkA, 'team://about');

    await reg.notify('person://alice');
    expect(a).toEqual(['person://alice']);
    expect(b).toEqual(['person://alice']);

    await reg.notify('team://about');
    expect(a).toEqual(['person://alice', 'team://about']);
    expect(b).toEqual(['person://alice']);
  });

  it('does not fire on URIs nobody subscribed to', async () => {
    const reg = new SubscriptionRegistry();
    const a: string[] = [];
    reg.subscribe((uri) => void a.push(uri), 'person://alice');
    await reg.notify('person://bob');
    expect(a).toEqual([]);
  });

  it('keys subscriptions by exact URI, not template (per MCP spec)', async () => {
    const reg = new SubscriptionRegistry();
    const a: string[] = [];
    reg.subscribe((uri) => void a.push(uri), 'person://{slug}');
    // A subscribe to the *template* form should NOT fire when the resolved
    // URI differs — clients subscribe to exact URIs, never templates.
    await reg.notify('person://alice');
    expect(a).toEqual([]);
  });

  it('unsubscribe removes only the (sink, uri) pair', async () => {
    const reg = new SubscriptionRegistry();
    const hits: string[] = [];
    const sink = (uri: string) => void hits.push(uri);
    reg.subscribe(sink, 'a://1');
    reg.subscribe(sink, 'b://2');
    reg.unsubscribe(sink, 'a://1');
    await reg.notify('a://1');
    await reg.notify('b://2');
    expect(hits).toEqual(['b://2']);
  });

  it('disconnect purges every subscription for one sink', async () => {
    const reg = new SubscriptionRegistry();
    const a: string[] = [];
    const b: string[] = [];
    const sinkA = (uri: string) => void a.push(uri);
    const sinkB = (uri: string) => void b.push(uri);
    reg.subscribe(sinkA, 'a://1');
    reg.subscribe(sinkA, 'b://2');
    reg.subscribe(sinkB, 'a://1');
    reg.disconnect(sinkA);

    await reg.notify('a://1');
    await reg.notify('b://2');
    expect(a).toEqual([]);
    expect(b).toEqual(['a://1']);
  });

  it('isolates failing sinks from blocking healthy ones', async () => {
    const reg = new SubscriptionRegistry();
    const hits: string[] = [];
    reg.subscribe(() => {
      throw new Error('dead transport');
    }, 'a://1');
    reg.subscribe((uri) => void hits.push(uri), 'a://1');
    await reg.notify('a://1');
    expect(hits).toEqual(['a://1']);
  });
});

describe('this.notifyResourceUpdated injection', () => {
  it('routes through the loader-installed notifier', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'resources-parity.photon.ts');
    const loader = new PhotonLoader();
    const captured: string[] = [];
    loader.setResourceUpdateNotifier((uri: string) => void captured.push(uri));
    const mcp = (await loader.loadFile(fixture)) as any;

    // The instance — installed by loadFile — must have notifyResourceUpdated.
    const instance = mcp.instance;
    expect(typeof instance.notifyResourceUpdated).toBe('function');

    instance.notifyResourceUpdated('person://alice');
    // Fired synchronously through the closure-captured notifier.
    expect(captured).toEqual(['person://alice']);
  });

  it('is a no-op when no notifier is wired (CLI / unit-test path)', async () => {
    const fixture = path.join(__dirname, 'fixtures', 'resources-parity.photon.ts');
    const loader = new PhotonLoader();
    // No setResourceUpdateNotifier — simulate CLI execution.
    const mcp = (await loader.loadFile(fixture)) as any;
    const instance = mcp.instance;
    expect(typeof instance.notifyResourceUpdated).toBe('function');
    // Must not throw.
    expect(() => instance.notifyResourceUpdated('person://alice')).not.toThrow();
  });
});
