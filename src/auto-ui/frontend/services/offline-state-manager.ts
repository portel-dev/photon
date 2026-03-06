/**
 * Phase 6b: Offline State Manager
 *
 * Manages offline state persistence using IndexedDB:
 * - Persists patches received from server
 * - Maintains local state snapshots
 * - Tracks synchronized state checkpoints
 * - Manages patch queue for retry on reconnect
 *
 * Responsible for durable storage layer enabling offline-first synchronization.
 */

export interface StoredPatch {
  id: string;
  sessionName: string;
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: any;
  from?: string;
  timestamp: number;
  synced: boolean;
  appliedLocally: boolean;
}

export interface StateSnapshot {
  sessionName: string;
  data: Record<string, any>;
  timestamp: number;
  patchId: string; // ID of the last patch applied
}

export interface OfflineStateManagerOptions {
  dbName?: string;
  version?: number;
  debug?: boolean;
}

/**
 * Manages offline state persistence via IndexedDB
 */
export class OfflineStateManager {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private version: number;
  private debug: boolean;
  private initPromise: Promise<void>;
  private readonly PATCHES_STORE = 'patches';
  private readonly SNAPSHOTS_STORE = 'snapshots';
  private readonly METADATA_STORE = 'metadata';
  private patchCounter = 0;

  constructor(options: OfflineStateManagerOptions = {}) {
    this.dbName = options.dbName ?? 'photon-offline';
    this.version = options.version ?? 1;
    this.debug = options.debug ?? false;

    this.initPromise = this.initialize();
  }

  /**
   * Initialize IndexedDB connection
   */
  private async initialize(): Promise<void> {
    if (!('indexedDB' in window)) {
      this.log('IndexedDB not supported');
      throw new Error('IndexedDB not supported in this browser');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        const error = new Error(
          `Failed to open IndexedDB: ${request.error?.message || 'Unknown error'}`
        );
        this.log('Failed to open IndexedDB', error);
        reject(error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.log('IndexedDB initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        this.createStores(db);
      };
    });
  }

  /**
   * Create object stores on first open
   */
  private createStores(db: IDBDatabase): void {
    // Patches store - indexed by sessionName and synced status
    if (!db.objectStoreNames.contains(this.PATCHES_STORE)) {
      const patchStore = db.createObjectStore(this.PATCHES_STORE, { keyPath: 'id' });
      patchStore.createIndex('sessionName', 'sessionName', { unique: false });
      patchStore.createIndex('synced', 'synced', { unique: false });
      patchStore.createIndex('sessionNameSynced', ['sessionName', 'synced'], {
        unique: false,
      });
      patchStore.createIndex('timestamp', 'timestamp', { unique: false });
      this.log('Created patches store');
    }

    // Snapshots store - one per session
    if (!db.objectStoreNames.contains(this.SNAPSHOTS_STORE)) {
      const snapshotStore = db.createObjectStore(this.SNAPSHOTS_STORE, {
        keyPath: 'sessionName',
      });
      snapshotStore.createIndex('timestamp', 'timestamp', { unique: false });
      this.log('Created snapshots store');
    }

    // Metadata store - configuration and checkpoint tracking
    if (!db.objectStoreNames.contains(this.METADATA_STORE)) {
      db.createObjectStore(this.METADATA_STORE, { keyPath: 'key' });
      this.log('Created metadata store');
    }
  }

  /**
   * Ensure DB is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    await this.initPromise;
    if (!this.db) {
      throw new Error('IndexedDB not initialized');
    }
  }

  /**
   * Store a patch received from server
   */
  async storePatch(sessionName: string, patch: any, synced: boolean = false): Promise<string> {
    await this.ensureInitialized();

    const id = `${sessionName}:${Date.now()}:${++this.patchCounter}`;
    const storedPatch: StoredPatch = {
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

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.PATCHES_STORE], 'readwrite');
      const store = tx.objectStore(this.PATCHES_STORE);
      const request = store.add(storedPatch);

      request.onerror = () =>
        reject(new Error(`IndexedDB request failed: ${request.error?.message || 'Unknown error'}`));
      request.onsuccess = () => {
        this.log('Patch stored', { id, sessionName });
        resolve(id);
      };
    });
  }

  /**
   * Get unsynced patches for a session
   */
  async getUnsyncedPatches(sessionName: string): Promise<StoredPatch[]> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.PATCHES_STORE], 'readonly');
      const store = tx.objectStore(this.PATCHES_STORE);
      const index = store.index('sessionNameSynced');
      const range = IDBKeyRange.only([sessionName, false]);
      const request = index.getAll(range);

      request.onerror = () =>
        reject(new Error(`IndexedDB request failed: ${request.error?.message || 'Unknown error'}`));
      request.onsuccess = () => {
        const patches = (request.result as StoredPatch[]).sort((a, b) => a.timestamp - b.timestamp);
        this.log('Retrieved unsynced patches', { sessionName, count: patches.length });
        resolve(patches);
      };
    });
  }

  /**
   * Mark patches as synced
   */
  async markPatchesSynced(patchIds: string[]): Promise<void> {
    if (patchIds.length === 0) {
      return;
    }

    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.PATCHES_STORE], 'readwrite');
      const store = tx.objectStore(this.PATCHES_STORE);

      let completed = 0;
      let hasError = false;

      for (const id of patchIds) {
        const getRequest = store.get(id);

        getRequest.onerror = () => {
          hasError = true;
          reject(
            new Error(`Failed to get patch ${id}: ${getRequest.error?.message || 'Unknown error'}`)
          );
        };

        getRequest.onsuccess = () => {
          const patch = getRequest.result as StoredPatch | undefined;
          if (patch) {
            patch.synced = true;
            const updateRequest = store.put(patch);

            updateRequest.onerror = () => {
              hasError = true;
              reject(
                new Error(
                  `Failed to update patch ${id}: ${updateRequest.error?.message || 'Unknown error'}`
                )
              );
            };

            updateRequest.onsuccess = () => {
              completed++;
              if (completed === patchIds.length && !hasError) {
                this.log('Patches marked as synced', { count: patchIds.length });
                resolve();
              }
            };
          } else {
            completed++;
            if (completed === patchIds.length && !hasError) {
              resolve();
            }
          }
        };
      }
    });
  }

  /**
   * Mark patches as applied locally
   */
  async markPatchesApplied(patchIds: string[]): Promise<void> {
    if (patchIds.length === 0) {
      return;
    }

    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.PATCHES_STORE], 'readwrite');
      const store = tx.objectStore(this.PATCHES_STORE);

      let completed = 0;
      let hasError = false;

      for (const id of patchIds) {
        const getRequest = store.get(id);

        getRequest.onerror = () => {
          hasError = true;
          reject(
            new Error(`Failed to get patch ${id}: ${getRequest.error?.message || 'Unknown error'}`)
          );
        };

        getRequest.onsuccess = () => {
          const patch = getRequest.result as StoredPatch | undefined;
          if (patch) {
            patch.appliedLocally = true;
            const updateRequest = store.put(patch);

            updateRequest.onerror = () => {
              hasError = true;
              reject(
                new Error(
                  `Failed to update patch ${id}: ${updateRequest.error?.message || 'Unknown error'}`
                )
              );
            };

            updateRequest.onsuccess = () => {
              completed++;
              if (completed === patchIds.length && !hasError) {
                this.log('Patches marked as applied', { count: patchIds.length });
                resolve();
              }
            };
          } else {
            completed++;
            if (completed === patchIds.length && !hasError) {
              resolve();
            }
          }
        };
      }
    });
  }

  /**
   * Store a state snapshot
   */
  async storeSnapshot(
    sessionName: string,
    state: Record<string, any>,
    patchId: string
  ): Promise<void> {
    await this.ensureInitialized();

    const snapshot: StateSnapshot = {
      sessionName,
      data: JSON.parse(JSON.stringify(state)),
      timestamp: Date.now(),
      patchId,
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.SNAPSHOTS_STORE], 'readwrite');
      const store = tx.objectStore(this.SNAPSHOTS_STORE);
      const request = store.put(snapshot);

      request.onerror = () =>
        reject(new Error(`IndexedDB request failed: ${request.error?.message || 'Unknown error'}`));
      request.onsuccess = () => {
        this.log('Snapshot stored', { sessionName, patchId });
        resolve();
      };
    });
  }

  /**
   * Get latest state snapshot
   */
  async getSnapshot(sessionName: string): Promise<StateSnapshot | null> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.SNAPSHOTS_STORE], 'readonly');
      const store = tx.objectStore(this.SNAPSHOTS_STORE);
      const request = store.get(sessionName);

      request.onerror = () =>
        reject(new Error(`IndexedDB request failed: ${request.error?.message || 'Unknown error'}`));
      request.onsuccess = () => {
        const snapshot = request.result as StateSnapshot | undefined;
        if (snapshot) {
          this.log('Snapshot retrieved', { sessionName });
        }
        resolve(snapshot || null);
      };
    });
  }

  /**
   * Clear all patches for a session
   */
  async clearPatches(sessionName: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.PATCHES_STORE], 'readwrite');
      const store = tx.objectStore(this.PATCHES_STORE);
      const index = store.index('sessionName');
      const range = IDBKeyRange.only(sessionName);
      const request = index.openCursor(range);

      request.onerror = () =>
        reject(new Error(`IndexedDB request failed: ${request.error?.message || 'Unknown error'}`));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          this.log('Patches cleared', { sessionName });
          resolve();
        }
      };
    });
  }

  /**
   * Clear snapshot for a session
   */
  async clearSnapshot(sessionName: string): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.SNAPSHOTS_STORE], 'readwrite');
      const store = tx.objectStore(this.SNAPSHOTS_STORE);
      const request = store.delete(sessionName);

      request.onerror = () =>
        reject(new Error(`IndexedDB request failed: ${request.error?.message || 'Unknown error'}`));
      request.onsuccess = () => {
        this.log('Snapshot cleared', { sessionName });
        resolve();
      };
    });
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    patchCount: number;
    snapshotCount: number;
    totalSize: number;
  }> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.PATCHES_STORE, this.SNAPSHOTS_STORE], 'readonly');
      const patchStore = tx.objectStore(this.PATCHES_STORE);
      const snapshotStore = tx.objectStore(this.SNAPSHOTS_STORE);

      const patchCountRequest = patchStore.count();
      const snapshotCountRequest = snapshotStore.count();

      let patchCount = 0;
      let snapshotCount = 0;

      patchCountRequest.onerror = () =>
        reject(
          new Error(
            `Failed to count patches: ${patchCountRequest.error?.message || 'Unknown error'}`
          )
        );
      patchCountRequest.onsuccess = () => {
        patchCount = patchCountRequest.result;

        snapshotCountRequest.onerror = () =>
          reject(
            new Error(
              `Failed to count snapshots: ${snapshotCountRequest.error?.message || 'Unknown error'}`
            )
          );
        snapshotCountRequest.onsuccess = () => {
          snapshotCount = snapshotCountRequest.result;
          this.log('Storage stats retrieved', { patchCount, snapshotCount });
          resolve({
            patchCount,
            snapshotCount,
            totalSize: (patchCount + snapshotCount) * 1000, // Rough estimate
          });
        };
      };
    });
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    await this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(
        [this.PATCHES_STORE, this.SNAPSHOTS_STORE, this.METADATA_STORE],
        'readwrite'
      );

      const patchRequest = tx.objectStore(this.PATCHES_STORE).clear();
      const snapshotRequest = tx.objectStore(this.SNAPSHOTS_STORE).clear();
      const metadataRequest = tx.objectStore(this.METADATA_STORE).clear();

      patchRequest.onerror = () =>
        reject(
          new Error(`Failed to clear patches: ${patchRequest.error?.message || 'Unknown error'}`)
        );
      snapshotRequest.onerror = () =>
        reject(
          new Error(
            `Failed to clear snapshots: ${snapshotRequest.error?.message || 'Unknown error'}`
          )
        );
      metadataRequest.onerror = () =>
        reject(
          new Error(
            `Failed to clear metadata: ${metadataRequest.error?.message || 'Unknown error'}`
          )
        );

      tx.onerror = () =>
        reject(new Error(`Transaction failed: ${tx.error?.message || 'Unknown error'}`));
      tx.oncomplete = () => {
        this.log('All data cleared');
        resolve();
      };
    });
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[OfflineStateManager] ${message}`, data);
    }
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    if (this.db) {
      this.db.close();
      this.log('OfflineStateManager destroyed');
    }
  }
}
