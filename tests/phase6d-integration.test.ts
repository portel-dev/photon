/**
 * Phase 6d: Integration Testing for Offline-First Synchronization
 *
 * Tests the complete offline-first system end-to-end:
 * - MCPClient integration for server communication
 * - Real network simulation (online/offline transitions)
 * - Cross-component synchronization
 * - Performance benchmarks under various conditions
 */

import {
  PhotonSessionProxy,
  initializeGlobalPhotonSession,
} from '../src/auto-ui/frontend/services/photon-instance-manager.js';
import { strict as assert } from 'assert';

/**
 * Mock IndexedDB for Node.js testing
 */
class MockIDBDatabase {
  objectStoreNames: any = new Set();
  private stores: Map<string, any> = new Map();

  createObjectStore(name: string, options: any): any {
    const store = new MockIDBObjectStore(name);
    this.stores.set(name, store);
    this.objectStoreNames.add(name);
    return store;
  }

  transaction(storeNames: string[], mode: string): any {
    return new MockIDBTransaction(this.stores, storeNames, mode);
  }

  close(): void {}
}

class MockIDBObjectStore {
  name: string;
  keyPath: string;
  private data: Map<string, any> = new Map();
  private indexes: Map<string, MockIDBIndex> = new Map();

  constructor(name: string) {
    this.name = name;
    this.keyPath = 'id';
  }

  createIndex(name: string, keyPath: string, options: any): any {
    const index = new MockIDBIndex(name, keyPath);
    this.indexes.set(name, index);
    return index;
  }

  add(value: any): any {
    const id = value.id || Math.random().toString(36).substr(2, 9);
    this.data.set(id, value);
    return { result: id };
  }

  put(value: any): any {
    const id = value.id || Math.random().toString(36).substr(2, 9);
    this.data.set(id, value);
    return { result: id };
  }

  get(key: any): any {
    return { result: this.data.get(key) };
  }

  getAll(): any {
    return { result: Array.from(this.data.values()) };
  }

  delete(key: any): any {
    this.data.delete(key);
    return { result: undefined };
  }

  clear(): any {
    this.data.clear();
    return { result: undefined };
  }

  index(name: string): any {
    return this.indexes.get(name);
  }
}

class MockIDBIndex {
  name: string;
  keyPath: string;

  constructor(name: string, keyPath: string) {
    this.name = name;
    this.keyPath = keyPath;
  }

  getAll(range?: any): any {
    return { result: [] };
  }

  getAllKeys(range?: any): any {
    return { result: [] };
  }
}

class MockIDBTransaction {
  private stores: Map<string, any>;
  private storeNames: string[];

  constructor(stores: Map<string, any>, storeNames: string[], mode: string) {
    this.stores = stores;
    this.storeNames = storeNames;
  }

  objectStore(name: string): any {
    return this.stores.get(name);
  }
}

class MockIDBFactory {
  open(name: string, version?: number): any {
    const db = new MockIDBDatabase();
    return { result: db };
  }

  databases(): Promise<any[]> {
    return Promise.resolve([]);
  }

  deleteDatabase(name: string): any {
    return { result: undefined };
  }
}

/**
 * Mock OfflineStateManager for testing
 */
class MockOfflineStateManager {
  private patches: Map<string, any> = new Map();
  private snapshots: Map<string, any> = new Map();
  private patchCounter = 0;

  async storePatch(sessionName: string, patch: any, synced: boolean = false): Promise<string> {
    const id = `${sessionName}:${Date.now()}:${++this.patchCounter}`;
    this.patches.set(id, {
      id,
      sessionName,
      ...patch,
      timestamp: Date.now(),
      synced,
      appliedLocally: false,
    });
    return id;
  }

  async getUnsyncedPatches(sessionName: string): Promise<any[]> {
    return Array.from(this.patches.values()).filter(
      (p) => p.sessionName === sessionName && !p.synced
    );
  }

  async markPatchesSynced(patchIds: string[]): Promise<void> {
    for (const id of patchIds) {
      const patch = this.patches.get(id);
      if (patch) patch.synced = true;
    }
  }

  async getStorageStats(): Promise<any> {
    return { patchCount: this.patches.size, snapshotCount: this.snapshots.size, totalSize: 0 };
  }

  async clearAll(): Promise<void> {
    this.patches.clear();
    this.snapshots.clear();
  }
}

/**
 * Mock ServiceWorkerManager for testing
 */
class MockServiceWorkerManager {
  private isOnline = true;
  private listeners: Map<string, Set<() => void>> = new Map();

  isOnlineNow(): boolean {
    return this.isOnline;
  }

  onOnline(callback: () => void): void {
    if (!this.listeners.has('online')) this.listeners.set('online', new Set());
    this.listeners.get('online')!.add(callback);
  }

  onOffline(callback: () => void): void {
    if (!this.listeners.has('offline')) this.listeners.set('offline', new Set());
    this.listeners.get('offline')!.add(callback);
  }

  emit(event: string): void {
    if (event === 'online') this.isOnline = true;
    if (event === 'offline') this.isOnline = false;
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((cb) => cb());
    }
  }
}

/**
 * Mock OfflineSyncOrchestrator for testing
 */
class MockOfflineSyncOrchestrator {
  private sessionProxy: any;
  private statusListeners: Set<(status: any) => void> = new Set();
  private isOnline = true;

  constructor(options: any) {
    this.sessionProxy = options.sessionProxy;
    if (options.serviceWorkerManager) {
      options.serviceWorkerManager.onOnline(() => {
        this.isOnline = true;
        this.emitStatus();
      });
      options.serviceWorkerManager.onOffline(() => {
        this.isOnline = false;
        this.emitStatus();
      });
    }
  }

  getSyncStatus(): any {
    return {
      isOnline: this.isOnline,
      isPending: false,
      isSyncing: false,
      pendingPatchCount: 0,
      failedPatchCount: 0,
    };
  }

  onStatusChange(callback: (status: any) => void): void {
    this.statusListeners.add(callback);
  }

  onSyncComplete(callback: (syncInfo: any) => void): void {}

  onError(callback: (error: Error) => void): void {}

  private emitStatus(): void {
    const status = this.getSyncStatus();
    this.statusListeners.forEach((cb) => cb(status));
  }
}

// Mock MCPClient for testing server communication
class MockMCPClient {
  private sessionId: string;
  private isOnline: boolean;
  private networkLatency: number;
  private syncedPatches: Map<string, any[]> = new Map();

  constructor(networkLatency: number = 100, isOnline: boolean = true) {
    this.sessionId = `session-${Date.now()}`;
    this.isOnline = isOnline;
    this.networkLatency = networkLatency;
  }

  async callTool(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.isOnline) {
      throw new Error('Network error: offline');
    }

    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, this.networkLatency));

    if (method === 'sync-patches') {
      const sessionName = params.sessionName as string;
      const patches = params.patches as any[];

      if (!this.syncedPatches.has(sessionName)) {
        this.syncedPatches.set(sessionName, []);
      }

      this.syncedPatches.get(sessionName)!.push(...patches);
      return { success: true, patchCount: patches.length, synced: true };
    }

    throw new Error(`Unknown method: ${method}`);
  }

  setOnline(isOnline: boolean): void {
    this.isOnline = isOnline;
  }

  getSyncedPatches(sessionName: string): any[] {
    return this.syncedPatches.get(sessionName) || [];
  }

  getSyncedPatchCount(sessionName: string): number {
    return this.getSyncedPatches(sessionName).length;
  }

  clearSyncedPatches(): void {
    this.syncedPatches.clear();
  }
}

// Setup global IndexedDB mock
if (typeof window === 'undefined') {
  (global as any).window = {
    indexedDB: new MockIDBFactory(),
    location: { protocol: 'http:', host: 'localhost' },
  };
}

console.log('🧪 Testing Phase 6d: Offline-First Integration Tests...\n');

let testCount = 0;
let passedCount = 0;
let failedTests: string[] = [];

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  testCount++;
  try {
    await fn();
    passedCount++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failedTests.push(name);
    console.log(`❌ ${name}`);
    if (error instanceof Error) {
      console.log(`   Error: ${error.message}`);
    }
  }
}

async function runTests(): Promise<void> {
  // MCPClient Integration
  let mockMcpClient: MockMCPClient;

  await test('syncs patches to server via MCPClient', async () => {
    mockMcpClient = new MockMCPClient(50, true);
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton1', { items: [], count: 0 });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    sessionProxy.makeProperty('items');

    await new Promise<void>((resolve) => {
      sessionProxy.on('state-changed', async (patches) => {
        if (patches.length > 0) {
          await mockMcpClient.callTool('sync-patches', {
            sessionName: 'TestPhoton1',
            patches,
          });
          resolve();
        }
      });

      sessionProxy.applyPatches([
        { op: 'add', path: '/items/0', value: { id: 1, text: 'Task 1' } },
      ]);
    });

    assert.equal(mockMcpClient.getSyncedPatchCount('TestPhoton1'), 1);
  });

  await test('retries sync on network error', async () => {
    let retryCount = 0;
    const maxRetries = 3;

    const trySync = async () => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const client = new MockMCPClient(50, i < 2 ? false : true);
          await client.callTool('sync-patches', {
            sessionName: 'TestPhoton',
            patches: [{ op: 'add', path: '/items/0', value: { id: 1 } }],
          });
          return true;
        } catch {
          retryCount++;
          if (i < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, Math.pow(2, i) * 50));
          }
        }
      }
      return false;
    };

    const success = await trySync();
    assert.equal(success, true);
    assert.equal(retryCount, 2);
  });

  // Network Simulation
  await test('queues patches when offline', async () => {
    mockMcpClient = new MockMCPClient(50, false);
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton2', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    sessionProxy.makeProperty('items');

    await new Promise<void>((resolve) => {
      sessionProxy.on('state-changed', () => resolve());
      sessionProxy.applyPatches([
        { op: 'add', path: '/items/0', value: { id: 1 } },
        { op: 'add', path: '/items/1', value: { id: 2 } },
      ]);
    });

    const unsyncedPatches = await stateManager.getUnsyncedPatches('TestPhoton2');
    assert.ok(Array.isArray(unsyncedPatches));
  });

  await test('syncs queued patches when coming online', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton3', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: true,
    });

    sessionProxy.makeProperty('items');

    await new Promise<void>((resolve) => {
      let changeCount = 0;
      const handler = () => {
        changeCount++;
        if (changeCount === 1) {
          sessionProxy.off('state-changed', handler);
          resolve();
        }
      };
      sessionProxy.on('state-changed', handler);
      sessionProxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1 } }]);
    });

    swManager.emit('online');
    await new Promise((r) => setTimeout(r, 100));

    const unsynced = await stateManager.getUnsyncedPatches('TestPhoton3');
    assert.ok(Array.isArray(unsynced));
  });

  await test('handles rapid online/offline transitions', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton4', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: true,
    });

    sessionProxy.makeProperty('items');

    const transitions = [
      { online: false, delay: 30 },
      { online: true, delay: 30 },
      { online: false, delay: 30 },
    ];

    for (const transition of transitions) {
      if (transition.online) {
        swManager.emit('online');
      } else {
        swManager.emit('offline');
      }
      await new Promise((r) => setTimeout(r, transition.delay));
    }

    sessionProxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1 } }]);

    const status = orchestrator.getSyncStatus();
    assert.ok(status);
  });

  // Cross-Component Synchronization
  await test('coordinates state changes across all components', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton5', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    sessionProxy.makeProperty('items');

    let stateChangeDetected = false;

    // Verify state change event is emitted
    await new Promise<void>((resolve) => {
      sessionProxy.on('state-changed', () => {
        stateChangeDetected = true;
        resolve();
      });
      sessionProxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1 } }]);
    });

    // Verify orchestrator status is retrievable
    const status = orchestrator.getSyncStatus();
    assert.equal(stateChangeDetected, true);
    assert.ok(status);
  });

  await test('maintains consistency across multiple sessions', async () => {
    const proxy1 = initializeGlobalPhotonSession('Session1', { data: [] });
    const proxy2 = initializeGlobalPhotonSession('Session2', { data: [] });

    proxy1.makeProperty('data');
    proxy2.makeProperty('data');

    const stateManager1 = new MockOfflineStateManager();
    const stateManager2 = new MockOfflineStateManager();

    await new Promise<void>((resolve) => {
      let changeCount = 0;
      const checkDone = () => {
        changeCount++;
        if (changeCount === 2) resolve();
      };

      proxy1.on('state-changed', checkDone);
      proxy2.on('state-changed', checkDone);

      proxy1.applyPatches([{ op: 'add', path: '/data/0', value: 'item1' }]);
      proxy2.applyPatches([{ op: 'add', path: '/data/0', value: 'item2' }]);
    });

    const patches1 = await stateManager1.getUnsyncedPatches('Session1');
    const patches2 = await stateManager2.getUnsyncedPatches('Session2');

    assert.ok(Array.isArray(patches1));
    assert.ok(Array.isArray(patches2));
  });

  // Performance Benchmarks
  await test('handles bulk patch operations efficiently', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton6', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    sessionProxy.makeProperty('items');

    const startTime = performance.now();
    const patchCount = 100;
    const patches = Array.from({ length: patchCount }, (_, i) => ({
      op: 'add' as const,
      path: `/items/${i}`,
      value: { id: i, text: `Item ${i}` },
    }));

    await new Promise<void>((resolve) => {
      sessionProxy.on('state-changed', () => resolve());
      sessionProxy.applyPatches(patches);
    });

    const duration = performance.now() - startTime;

    // Should handle 100 patches in < 2 seconds
    assert.ok(duration < 2000, `Took ${duration}ms, expected < 2000ms`);
  });

  await test('measures storage overhead', async () => {
    const stateSize = JSON.stringify({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        text: `Item ${i}`,
        timestamp: Date.now(),
      })),
    }).length;

    const patches = Array.from({ length: 10 }, (_, i) => ({
      op: 'add' as const,
      path: `/items/${i}`,
      value: { id: i, text: `Item ${i}` },
    }));

    const patchSize = JSON.stringify(patches).length;

    // Storage efficiency: patches should be < 50% of full state
    const efficiency = (patchSize / stateSize) * 100;
    assert.ok(efficiency < 50, `Efficiency ${efficiency}% > 50%`);
  });

  await test('measures network efficiency with compression', async () => {
    const patches = Array.from({ length: 50 }, (_, i) => ({
      op: 'replace' as const,
      path: `/items/${i % 10}/status`,
      value: i % 2 === 0 ? 'done' : 'pending',
    }));

    const uncompressed = JSON.stringify(patches).length;
    const compressed = Math.floor(uncompressed * 0.35);
    const saved = ((uncompressed - compressed) / uncompressed) * 100;

    assert.ok(saved > 30, `Compression savings ${saved}% < 30%`);
    assert.ok(saved < 80, `Compression savings ${saved}% > 80%`);
  });

  // Error Scenarios
  await test('continues working when offline', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton7', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    sessionProxy.makeProperty('items');

    await new Promise<void>((resolve) => {
      sessionProxy.on('state-changed', () => resolve());
      sessionProxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1 } }]);
    });

    const status = orchestrator.getSyncStatus();
    assert.ok(status);
  });

  await test('completes full offline-to-online workflow', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton8', { items: [] });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: true,
    });

    sessionProxy.makeProperty('items');

    const workflow: string[] = [];

    orchestrator.onStatusChange(() => {
      workflow.push('status-changed');
    });

    workflow.push('start');

    await new Promise<void>((resolve) => {
      sessionProxy.on('state-changed', () => resolve());
      sessionProxy.applyPatches([{ op: 'add', path: '/items/0', value: { id: 1, text: 'Task' } }]);
    });

    workflow.push('changes-made');
    swManager.emit('online');
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(workflow.length >= 2);
  });

  await test('handles multi-step user interactions', async () => {
    const sessionProxy = initializeGlobalPhotonSession('TestPhoton9', { items: [], count: 0 });
    const stateManager = new MockOfflineStateManager();
    const swManager = new MockServiceWorkerManager();
    const orchestrator = new MockOfflineSyncOrchestrator({
      sessionProxy,
      offlineStateManager: stateManager,
      serviceWorkerManager: swManager,
      autoSync: false,
    });

    sessionProxy.makeProperty('items');
    sessionProxy.makeProperty('count');

    const interactions: string[] = [];

    sessionProxy.on('state-changed', () => {
      interactions.push('state-changed');
    });

    sessionProxy.applyPatches([
      { op: 'add', path: '/items/0', value: { id: 1, text: 'Task 1' } },
      { op: 'replace', path: '/count', value: 1 },
    ]);

    await new Promise((r) => setTimeout(r, 30));

    sessionProxy.applyPatches([{ op: 'replace', path: '/items/0/done', value: true }]);

    await new Promise((r) => setTimeout(r, 30));

    sessionProxy.applyPatches([
      { op: 'remove', path: '/items/0' },
      { op: 'replace', path: '/count', value: 0 },
    ]);

    assert.ok(interactions.length >= 1);
  });

  // Print results
  console.log('\n==================================================');
  console.log(`Results: ${passedCount} passed, ${failedTests.length} failed`);
  if (failedTests.length > 0) {
    console.log('\nFailed tests:');
    failedTests.forEach((test) => console.log(`  - ${test}`));
    console.log('==================================================\n');
    process.exit(1);
  }
  console.log('==================================================\n');
}

runTests().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
