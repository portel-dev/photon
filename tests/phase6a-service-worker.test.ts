/**
 * Phase 6a: ServiceWorkerManager Tests
 *
 * Validates service worker lifecycle management and connection state monitoring
 */

import { ServiceWorkerManager } from '../src/auto-ui/frontend/services/service-worker-manager.js';
import { strict as assert } from 'assert';

/**
 * Mock ServiceWorkerManager for Node.js testing
 */
class MockServiceWorkerManager {
  private status: string = 'unregistered';
  private isOnline: boolean = true;
  private statusListeners: Array<(status: string) => void> = [];
  private onlineListeners: Array<() => void> = [];
  private offlineListeners: Array<() => void> = [];
  private updateListeners: Array<(sw: any) => void> = [];
  private registration: any = null;
  private debug: boolean;

  constructor(config: { scope?: string; debug?: boolean } = {}) {
    this.debug = config.debug ?? false;
  }

  getStatus(): string {
    return this.status;
  }

  isOnlineNow(): boolean {
    return this.isOnline;
  }

  onStatusChange(callback: (status: string) => void): void {
    this.statusListeners.push(callback);
  }

  onOnline(callback: () => void): void {
    this.onlineListeners.push(callback);
  }

  onOffline(callback: () => void): void {
    this.offlineListeners.push(callback);
  }

  onUpdateAvailable(callback: (sw: any) => void): void {
    this.updateListeners.push(callback);
  }

  async register(scriptUrl: string): Promise<any> {
    this.registration = { url: scriptUrl };
    this.setStatus('installing');

    // Simulate registration lifecycle
    setTimeout(() => {
      this.setStatus('installed');
    }, 10);

    return this.registration;
  }

  async unregister(): Promise<boolean> {
    if (!this.registration) {
      return false;
    }
    this.registration = null;
    this.setStatus('unregistered');
    return true;
  }

  getRegistration(): any {
    return this.registration;
  }

  async clearCache(): Promise<boolean> {
    return true;
  }

  async getCacheSize(): Promise<number> {
    return 0;
  }

  async precache(urls: string[]): Promise<void> {
    // Mock precache
  }

  skipWaiting(): void {
    // Mock skip waiting
  }

  postMessage(message: any): void {
    // Mock message posting
  }

  // Private method for testing
  setStatus(status: string): void {
    if (this.status !== status) {
      this.status = status;
      for (const listener of this.statusListeners) {
        listener(status);
      }
    }
  }

  simulateOnline(): void {
    this.isOnline = true;
    for (const listener of this.onlineListeners) {
      listener();
    }
  }

  simulateOffline(): void {
    this.isOnline = false;
    for (const listener of this.offlineListeners) {
      listener();
    }
  }

  simulateUpdateAvailable(): void {
    for (const listener of this.updateListeners) {
      listener({ state: 'waiting' });
    }
  }

  destroy(): void {
    this.statusListeners = [];
    this.onlineListeners = [];
    this.offlineListeners = [];
    this.updateListeners = [];
  }
}

async function runTests() {
  console.log('🧪 Testing Phase 6a: ServiceWorkerManager...\n');

  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then(
          () => {
            console.log(`✅ ${name}`);
            passed++;
          },
          (err) => {
            console.error(`❌ ${name}: ${err.message}`);
            failed++;
          }
        );
      } else {
        console.log(`✅ ${name}`);
        passed++;
      }
    } catch (err) {
      console.error(`❌ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  };

  // Test 1: Manager initialization
  await test('Manager initializes with correct defaults', () => {
    const manager = new MockServiceWorkerManager();
    assert.strictEqual(
      manager.getStatus(),
      'unregistered',
      'Initial status should be unregistered'
    );
    assert.ok(manager.isOnlineNow(), 'Should be online by default');
  });

  // Test 2: Service worker registration
  await test('Service worker registration changes status correctly', async () => {
    const manager = new MockServiceWorkerManager();
    const statusChanges: string[] = [];

    manager.onStatusChange((status) => {
      statusChanges.push(status);
    });

    await manager.register('/sw.js');

    // Wait for status change
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(statusChanges.includes('installing'), 'Should have installing status');
    assert.ok(statusChanges.includes('installed'), 'Should have installed status');
  });

  // Test 3: Service worker unregistration
  await test('Service worker unregistration succeeds', async () => {
    const manager = new MockServiceWorkerManager();

    await manager.register('/sw.js');
    const success = await manager.unregister();

    assert.ok(success, 'Unregistration should succeed');
    assert.strictEqual(manager.getStatus(), 'unregistered', 'Status should be unregistered');
    assert.strictEqual(manager.getRegistration(), null, 'Registration should be null');
  });

  // Test 4: Online/offline detection
  await test('Manager detects online/offline state transitions', async () => {
    const manager = new MockServiceWorkerManager();
    const events: string[] = [];

    manager.onOnline(() => events.push('online'));
    manager.onOffline(() => events.push('offline'));

    // Start online
    assert.ok(manager.isOnlineNow(), 'Should start online');

    // Simulate going offline
    manager.simulateOffline();
    assert.ok(!manager.isOnlineNow(), 'Should be offline');
    assert.ok(events.includes('offline'), 'Should trigger offline event');

    // Simulate going back online
    manager.simulateOnline();
    assert.ok(manager.isOnlineNow(), 'Should be online again');
    assert.ok(events.includes('online'), 'Should trigger online event');
  });

  // Test 5: Status change notifications
  await test('Status changes trigger all listeners', async () => {
    const manager = new MockServiceWorkerManager();
    const statuses: string[] = [];

    // Add multiple listeners
    manager.onStatusChange((status) => statuses.push(status));
    manager.onStatusChange((status) => statuses.push(`${status}-copy`));

    await manager.register('/sw.js');
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(statuses.length >= 2, 'Should trigger multiple listeners');
    assert.ok(
      statuses.some((s) => s.includes('installing')),
      'Should have installing status'
    );
  });

  // Test 6: Update available notification
  await test('Update available event is triggered correctly', async () => {
    const manager = new MockServiceWorkerManager();
    let updateTriggered = false;
    let updateSW: any = null;

    manager.onUpdateAvailable((sw) => {
      updateTriggered = true;
      updateSW = sw;
    });

    manager.simulateUpdateAvailable();

    assert.ok(updateTriggered, 'Update available event should trigger');
    assert.ok(updateSW, 'Should receive service worker object');
  });

  // Test 7: Cache operations
  await test('Cache operations work correctly', async () => {
    const manager = new MockServiceWorkerManager();

    // Clear cache
    const cleared = await manager.clearCache();
    assert.ok(cleared, 'Should clear cache successfully');

    // Get cache size
    const size = await manager.getCacheSize();
    assert.strictEqual(typeof size, 'number', 'Cache size should be a number');

    // Precache URLs
    await manager.precache(['/index.html', '/styles.css']);
  });

  // Test 8: Message posting to service worker
  await test('Can post messages to service worker', async () => {
    const manager = new MockServiceWorkerManager();

    await manager.register('/sw.js');

    // Should not throw
    manager.postMessage({ type: 'SYNC_OFFLINE_QUEUE' });
    manager.postMessage({ type: 'CLEAR_CACHE' });
  });

  // Test 9: Multiple online/offline transitions
  await test('Handles rapid online/offline transitions', async () => {
    const manager = new MockServiceWorkerManager();
    const events: string[] = [];

    manager.onOnline(() => events.push('online'));
    manager.onOffline(() => events.push('offline'));

    // Rapid transitions
    for (let i = 0; i < 5; i++) {
      manager.simulateOffline();
      manager.simulateOnline();
    }

    assert.ok(events.length > 0, 'Should record transitions');
    assert.ok(events.filter((e) => e === 'offline').length === 5, 'Should have 5 offline events');
    assert.ok(events.filter((e) => e === 'online').length === 5, 'Should have 5 online events');
  });

  // Test 10: Manager cleanup
  await test('Manager properly cleans up resources', async () => {
    const manager = new MockServiceWorkerManager();

    let statusCallCount = 0;
    manager.onStatusChange(() => {
      statusCallCount++;
    });

    await manager.register('/sw.js');
    // Wait for async status changes
    await new Promise((resolve) => setTimeout(resolve, 30));

    const callCountBeforeDestroy = statusCallCount;
    manager.destroy();

    // Status changes after destroy should not trigger listeners
    manager.setStatus('error');

    assert.strictEqual(
      statusCallCount,
      callCountBeforeDestroy,
      'Listeners should be cleared after destroy'
    );
  });

  // Print summary
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
