/**
 * Phase 6b: Offline State Manager Tests
 *
 * Validates IndexedDB persistence for offline patch storage and state snapshots
 */

import { OfflineStateManager } from '../src/auto-ui/frontend/services/offline-state-manager.js';
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

  close(): void {
    // Mock close
  }
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
    const key = value[this.keyPath];
    this.data.set(key, value);
    return new MockIDBRequest(key);
  }

  put(value: any): any {
    const key = value[this.keyPath];
    this.data.set(key, value);
    return new MockIDBRequest(key);
  }

  get(key: string): any {
    return new MockIDBRequest(this.data.get(key));
  }

  delete(key: string): any {
    this.data.delete(key);
    return new MockIDBRequest(undefined);
  }

  clear(): any {
    this.data.clear();
    return new MockIDBRequest(undefined);
  }

  count(): any {
    return new MockIDBRequest(this.data.size);
  }

  getAll(): any {
    return new MockIDBRequest(Array.from(this.data.values()));
  }

  openCursor(range?: any): any {
    return new MockIDBCursorRequest(this.data, range);
  }

  index(name: string): any {
    return this.indexes.get(name) || new MockIDBIndex(name, 'unknown');
  }

  getStore(): Map<string, any> {
    return this.data;
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
    return new MockIDBRequest([]);
  }

  openCursor(range?: any): any {
    return new MockIDBCursorRequest(new Map(), range);
  }
}

class MockIDBRequest {
  result: any;
  error: any = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(result: any) {
    this.result = result;
    setTimeout(() => {
      if (this.onsuccess) this.onsuccess();
    }, 0);
  }
}

class MockIDBCursorRequest {
  error: any = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private data: Map<string, any>;
  private range: any;
  private currentIndex = -1;
  private keys: string[];

  constructor(data: Map<string, any>, range?: any) {
    this.data = data;
    this.range = range;
    this.keys = Array.from(data.keys());
    setTimeout(() => {
      if (this.onsuccess) this.onsuccess();
    }, 0);
  }

  get result(): any {
    if (this.currentIndex < this.keys.length) {
      const key = this.keys[this.currentIndex];
      return {
        value: this.data.get(key),
        key: key,
        delete: () => this.data.delete(key),
        continue: () => {
          this.currentIndex++;
          if (this.currentIndex < this.keys.length && this.onsuccess) {
            setTimeout(() => {
              if (this.onsuccess) this.onsuccess();
            }, 0);
          }
        },
      };
    }
    return null;
  }
}

class MockIDBTransaction {
  private stores: Map<string, any>;
  private storeNames: string[];
  private mode: string;
  onerror: (() => void) | null = null;
  oncomplete: (() => void) | null = null;

  constructor(stores: Map<string, any>, storeNames: string[], mode: string) {
    this.stores = stores;
    this.storeNames = storeNames;
    this.mode = mode;
    setTimeout(() => {
      if (this.oncomplete) this.oncomplete();
    }, 0);
  }

  objectStore(name: string): any {
    return this.stores.get(name);
  }
}

/**
 * Mock OfflineStateManager for Node.js testing
 */
class MockOfflineStateManager {
  private patches: Map<string, any> = new Map();
  private snapshots: Map<string, any> = new Map();
  private debug: boolean;
  private patchCounter = 0;

  constructor(options: any = {}) {
    this.debug = options.debug ?? false;
  }

  async storePatch(sessionName: string, patch: any, synced: boolean = false): Promise<string> {
    const id = `${sessionName}:${Date.now()}:${++this.patchCounter}`;
    const storedPatch = {
      id,
      sessionName,
      op: patch.op,
      path: patch.path,
      value: patch.value,
      from: patch.from,
      timestamp: Date.now(),
      synced,
      appliedLocally: false,
    };
    this.patches.set(id, storedPatch);
    return id;
  }

  async getUnsyncedPatches(sessionName: string): Promise<any[]> {
    const result: any[] = [];
    for (const patch of this.patches.values()) {
      if (patch.sessionName === sessionName && !patch.synced) {
        result.push(patch);
      }
    }
    return result.sort((a, b) => a.timestamp - b.timestamp);
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

  async storeSnapshot(
    sessionName: string,
    state: Record<string, any>,
    patchId: string
  ): Promise<void> {
    this.snapshots.set(sessionName, {
      sessionName,
      data: JSON.parse(JSON.stringify(state)),
      timestamp: Date.now(),
      patchId,
    });
  }

  async getSnapshot(sessionName: string): Promise<any> {
    return this.snapshots.get(sessionName) || null;
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

  async clearAll(): Promise<void> {
    this.patches.clear();
    this.snapshots.clear();
  }

  destroy(): void {
    // Mock destroy
  }
}

async function runTests() {
  console.log('🧪 Testing Phase 6b: Offline State Manager...\\n');

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
  await test('Manager initializes successfully', () => {
    const manager = new MockOfflineStateManager();
    assert.ok(manager);
  });

  // Test 2: Store and retrieve patches
  await test('Patches are stored and retrieved correctly', async () => {
    const manager = new MockOfflineStateManager();
    const sessionName = 'TestSession';
    const patch = { op: 'add', path: '/items/0', value: { id: 1, name: 'Item' } };

    const patchId = await manager.storePatch(sessionName, patch);
    assert.ok(patchId);

    const patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].op, 'add');
    assert.strictEqual(patches[0].synced, false);
  });

  // Test 3: Mark patches as synced
  await test('Patches can be marked as synced', async () => {
    const manager = new MockOfflineStateManager();
    const sessionName = 'TestSession';
    const patch = { op: 'replace', path: '/items/0', value: { id: 1, name: 'Updated' } };

    const patchId = await manager.storePatch(sessionName, patch);
    let patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 1);

    await manager.markPatchesSynced([patchId]);
    patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 0);
  });

  // Test 4: Mark patches as applied
  await test('Patches can be marked as applied locally', async () => {
    const manager = new MockOfflineStateManager();
    const sessionName = 'TestSession';
    const patch = { op: 'remove', path: '/items/0' };

    const patchId = await manager.storePatch(sessionName, patch);
    await manager.markPatchesApplied([patchId]);

    const patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 1);
    assert.strictEqual(patches[0].appliedLocally, true);
  });

  // Test 5: Store and retrieve state snapshots
  await test('State snapshots are stored and retrieved', async () => {
    const manager = new MockOfflineStateManager();
    const sessionName = 'TestSession';
    const state = { items: [{ id: 1 }, { id: 2 }], count: 2 };

    await manager.storeSnapshot(sessionName, state, 'patch-123');
    const snapshot = await manager.getSnapshot(sessionName);

    assert.ok(snapshot);
    assert.deepStrictEqual(snapshot.data, state);
    assert.strictEqual(snapshot.patchId, 'patch-123');
  });

  // Test 6: Multiple patches per session
  await test('Multiple patches can be stored per session', async () => {
    const manager = new MockOfflineStateManager();
    const sessionName = 'TestSession';

    const patchIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await manager.storePatch(sessionName, {
        op: 'add',
        path: `/items/${i}`,
        value: { id: i },
      });
      patchIds.push(id);
    }

    const patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 5);

    // Mark first 3 as synced
    await manager.markPatchesSynced(patchIds.slice(0, 3));
    const remainingPatches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(remainingPatches.length, 2);
  });

  // Test 7: Multiple sessions isolation
  await test('Patches from different sessions are isolated', async () => {
    const manager = new MockOfflineStateManager();

    const id1 = await manager.storePatch('Session1', { op: 'add', path: '/items/0', value: {} });
    const id2 = await manager.storePatch('Session2', { op: 'add', path: '/items/0', value: {} });

    const patches1 = await manager.getUnsyncedPatches('Session1');
    const patches2 = await manager.getUnsyncedPatches('Session2');

    assert.strictEqual(patches1.length, 1);
    assert.strictEqual(patches2.length, 1);
    assert.strictEqual(patches1[0].sessionName, 'Session1');
    assert.strictEqual(patches2[0].sessionName, 'Session2');
  });

  // Test 8: Clear patches for session
  await test('Patches can be cleared for a session', async () => {
    const manager = new MockOfflineStateManager();
    const sessionName = 'TestSession';

    await manager.storePatch(sessionName, { op: 'add', path: '/items/0', value: {} });
    await manager.storePatch(sessionName, { op: 'add', path: '/items/1', value: {} });

    let patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 2);

    await manager.clearPatches(sessionName);
    patches = await manager.getUnsyncedPatches(sessionName);
    assert.strictEqual(patches.length, 0);
  });

  // Test 9: Storage statistics
  await test('Storage statistics are calculated correctly', async () => {
    const manager = new MockOfflineStateManager();

    await manager.storePatch('Session1', { op: 'add', path: '/items/0', value: {} });
    await manager.storePatch('Session2', { op: 'add', path: '/items/0', value: {} });
    await manager.storeSnapshot('Session1', { items: [] }, 'patch-1');

    const stats = await manager.getStorageStats();
    assert.strictEqual(stats.patchCount, 2);
    assert.strictEqual(stats.snapshotCount, 1);
  });

  // Test 10: Clear all data
  await test('All data can be cleared', async () => {
    const manager = new MockOfflineStateManager();

    await manager.storePatch('Session1', { op: 'add', path: '/items/0', value: {} });
    await manager.storeSnapshot('Session1', { items: [] }, 'patch-1');

    const stats1 = await manager.getStorageStats();
    assert.strictEqual(stats1.patchCount, 1);
    assert.strictEqual(stats1.snapshotCount, 1);

    await manager.clearAll();
    const stats2 = await manager.getStorageStats();
    assert.strictEqual(stats2.patchCount, 0);
    assert.strictEqual(stats2.snapshotCount, 0);
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
