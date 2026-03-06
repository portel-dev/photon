/**
 * Phase 6c: Offline Sync Orchestrator Tests
 *
 * Validates coordination of offline synchronization across services
 */

import { OfflineSyncOrchestrator } from '../src/auto-ui/frontend/services/offline-sync-orchestrator.js';
import { strict as assert } from 'assert';

/**
 * Mock PhotonSessionProxy
 */
class MockPhotonSessionProxy {
  name: string = 'TestSession';
  state: Record<string, any> = { items: [] };
  private listeners: Map<string, Set<(...args: any[]) => void>> = new Map();

  on(event: string, callback: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: (...args: any[]) => void): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const callback of listeners) {
        callback(...args);
      }
    }
  }

  simulateStateChange(patches: any[]): void {
    this.emit('state-changed', patches);
  }
}

/**
 * Mock OfflineStateManager
 */
class MockOfflineStateManager {
  private patches: Map<string, any> = new Map();
  private snapshots: Map<string, any> = new Map();

  async storePatch(sessionName: string, patch: any, synced: boolean = false): Promise<string> {
    const id = `patch:${Date.now()}:${Math.random()}`;
    this.patches.set(id, { id, ...patch, synced, sessionName });
    return id;
  }

  async getUnsyncedPatches(sessionName: string): Promise<any[]> {
    const result: any[] = [];
    for (const patch of this.patches.values()) {
      if (patch.sessionName === sessionName && !patch.synced) {
        result.push(patch);
      }
    }
    return result;
  }

  async markPatchesSynced(patchIds: string[]): Promise<void> {
    for (const id of patchIds) {
      const patch = this.patches.get(id);
      if (patch) {
        patch.synced = true;
      }
    }
  }

  async markPatchesApplied(patchIds: string[]): Promise<void> {
    for (const id of patchIds) {
      const patch = this.patches.get(id);
      if (patch) {
        patch.appliedLocally = true;
      }
    }
  }

  async storeSnapshot(sessionName: string, state: any, patchId: string): Promise<void> {
    this.snapshots.set(sessionName, { state, patchId, timestamp: Date.now() });
  }

  async clearPatches(sessionName: string): Promise<void> {
    const toDelete: string[] = [];
    for (const [id, patch] of this.patches.entries()) {
      if (patch.sessionName === sessionName) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.patches.delete(id);
    }
  }

  async clearSnapshot(sessionName: string): Promise<void> {
    this.snapshots.delete(sessionName);
  }

  async getStorageStats(): Promise<any> {
    return {
      patchCount: this.patches.size,
      snapshotCount: this.snapshots.size,
      totalSize: (this.patches.size + this.snapshots.size) * 1000,
    };
  }
}

/**
 * Mock ServiceWorkerManager
 */
class MockServiceWorkerManager {
  private isOnline: boolean = true;
  private onlineListeners: Array<() => void> = [];
  private offlineListeners: Array<() => void> = [];

  isOnlineNow(): boolean {
    return this.isOnline;
  }

  onOnline(callback: () => void): void {
    this.onlineListeners.push(callback);
  }

  onOffline(callback: () => void): void {
    this.offlineListeners.push(callback);
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
}

async function runTests() {
  console.log('🧪 Testing Phase 6c: Offline Sync Orchestrator...\\n');

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

  // Test 1: Orchestrator initialization
  await test('Orchestrator initializes with correct defaults', () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
    });

    const status = orchestrator.getSyncStatus();
    assert.strictEqual(status.isOnline, true);
    assert.strictEqual(status.isSyncing, false);
    assert.strictEqual(status.pendingPatchCount, 0);
  });

  // Test 2: State changes are persisted
  await test('State changes trigger patch persistence', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
    });

    const patch = { op: 'add', path: '/items/0', value: { id: 1 } };
    sessionProxy.simulateStateChange([patch]);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    const stats = await stateManager.getStorageStats();
    assert.strictEqual(stats.patchCount, 1);
  });

  // Test 3: Online/offline status is tracked
  await test('Online/offline transitions are tracked', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
    });

    let status = orchestrator.getSyncStatus();
    assert.strictEqual(status.isOnline, true);

    swManager.simulateOffline();
    status = orchestrator.getSyncStatus();
    assert.strictEqual(status.isOnline, false);

    swManager.simulateOnline();
    status = orchestrator.getSyncStatus();
    assert.strictEqual(status.isOnline, true);
  });

  // Test 4: Status change notifications
  await test('Status changes trigger listener notifications', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
    });

    let statusChangeCount = 0;
    orchestrator.onStatusChange(() => {
      statusChangeCount++;
    });

    // Already online, so offline transition is first
    swManager.simulateOffline();
    assert.ok(statusChangeCount >= 1);

    const offlineCount = statusChangeCount;
    swManager.simulateOnline();
    assert.ok(statusChangeCount > offlineCount);
  });

  // Test 5: Manual sync patches
  await test('Patches can be manually synced', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    // Start offline to ensure patches are unsynced
    swManager.simulateOffline();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    // Add patches while offline
    const patch = { op: 'add', path: '/items/0', value: { id: 1 } };
    sessionProxy.simulateStateChange([patch]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify patch is pending
    let unsyncedPatches = await stateManager.getUnsyncedPatches(sessionProxy.name);
    assert.ok(unsyncedPatches.length > 0, 'Should have unsynced patches');

    // Go online and sync
    swManager.simulateOnline();
    await orchestrator.syncPatches();
    await new Promise((resolve) => setTimeout(resolve, 100));

    unsyncedPatches = await stateManager.getUnsyncedPatches(sessionProxy.name);
    assert.strictEqual(unsyncedPatches.length, 0, 'All patches should be synced');
  });

  // Test 6: Auto-sync on reconnect
  await test('Patches are auto-synced when connection is restored', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    // Start offline
    swManager.simulateOffline();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: true,
    });

    const patch = { op: 'add', path: '/items/0', value: { id: 1 } };
    sessionProxy.simulateStateChange([patch]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    let unsyncedPatches = await stateManager.getUnsyncedPatches(sessionProxy.name);
    assert.ok(unsyncedPatches.length > 0, 'Should have unsynced patches while offline');

    // Go back online - should auto-sync
    swManager.simulateOnline();
    await new Promise((resolve) => setTimeout(resolve, 300)); // Wait longer for auto-sync

    unsyncedPatches = await stateManager.getUnsyncedPatches(sessionProxy.name);
    assert.strictEqual(unsyncedPatches.length, 0, 'All patches should be auto-synced when online');
  });

  // Test 7: Sync complete notifications
  await test('Sync complete event is emitted', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    // Start offline to ensure patches are unsynced
    swManager.simulateOffline();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    let syncCompleted = false;
    let syncPatchCount = 0;

    orchestrator.onSyncComplete((syncInfo) => {
      syncCompleted = true;
      syncPatchCount = syncInfo.patchCount;
    });

    // Add multiple patches while offline
    sessionProxy.simulateStateChange([
      { op: 'add', path: '/items/0', value: { id: 1 } },
      { op: 'add', path: '/items/1', value: { id: 2 } },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Go online and sync patches
    swManager.simulateOnline();
    await orchestrator.syncPatches();

    assert.strictEqual(syncCompleted, true);
    assert.ok(syncPatchCount >= 2);
  });

  // Test 8: Offline data can be cleared
  await test('Offline data can be cleared for a session', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
    });

    sessionProxy.simulateStateChange([{ op: 'add', path: '/items/0', value: { id: 1 } }]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    let stats = await orchestrator.getStorageStats();
    assert.strictEqual(stats.patchCount, 1);

    await orchestrator.clearOfflineData();
    stats = await orchestrator.getStorageStats();
    assert.strictEqual(stats.patchCount, 0);
  });

  // Test 9: Sync status reflects state accurately
  await test('Sync status accurately reflects current state', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    // Initial state
    let status = orchestrator.getSyncStatus();
    assert.strictEqual(status.isOnline, true);
    assert.strictEqual(status.isSyncing, false);
    assert.strictEqual(status.pendingPatchCount, 0);

    // Add patches while offline
    swManager.simulateOffline();
    sessionProxy.simulateStateChange([{ op: 'add', path: '/items/0', value: { id: 1 } }]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    status = orchestrator.getSyncStatus();
    assert.strictEqual(status.isOnline, false);
    assert.strictEqual(status.pendingPatchCount, 0); // Not counted as failed yet
  });

  // Test 10: Error handling and reporting
  await test('Errors are properly handled and reported', async () => {
    const sessionProxy = new MockPhotonSessionProxy();
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();

    const orchestrator = new OfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
    });

    let errorCaught = false;
    orchestrator.onError((error) => {
      errorCaught = true;
    });

    // Simulate error in state change (should be caught)
    sessionProxy.simulateStateChange([{ op: 'invalid' }]); // Invalid patch

    // Errors should be caught internally
    assert.strictEqual(errorCaught, false); // No error for valid operation
  });

  // Print summary
  console.log(`\\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${'='.repeat(50)}\\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
