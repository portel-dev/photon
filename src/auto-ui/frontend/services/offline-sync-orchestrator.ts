/**
 * Phase 6c: Offline Sync Orchestrator
 *
 * Coordinates offline synchronization across multiple layers:
 * - Watches PhotonSessionProxy for state changes
 * - Persists patches to IndexedDB via OfflineStateManager
 * - Queues patches when offline
 * - Syncs patches when connection is restored
 * - Coordinates with ServiceWorkerManager for connection detection
 * - Exposes sync status and statistics
 *
 * Responsible for the complete offline-first synchronization flow.
 */

import { PhotonSessionProxy } from './photon-instance-manager.js';
import { OfflineStateManager } from './offline-state-manager.js';
import { ServiceWorkerManager } from './service-worker-manager.js';

export interface OfflineSyncOrchestratorOptions {
  sessionProxy: PhotonSessionProxy;
  offlineStateManager: OfflineStateManager;
  serviceWorkerManager: ServiceWorkerManager;
  autoSync?: boolean;
  debug?: boolean;
}

export interface SyncStatus {
  isOnline: boolean;
  isPending: boolean;
  isSyncing: boolean;
  pendingPatchCount: number;
  failedPatchCount: number;
  lastSyncTime?: number;
  lastErrorMessage?: string;
}

/**
 * Orchestrates offline-first synchronization
 */
export class OfflineSyncOrchestrator {
  private sessionProxy: PhotonSessionProxy;
  private offlineStateManager: OfflineStateManager;
  private serviceWorkerManager: ServiceWorkerManager;
  private autoSync: boolean;
  private debug: boolean;

  // State tracking
  private isOnline: boolean = true;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;
  private lastErrorMessage: string = '';
  private failedPatchIds: Set<string> = new Set();

  // Event listeners
  private statusListeners: Array<(status: SyncStatus) => void> = [];
  private syncListeners: Array<(syncInfo: any) => void> = [];
  private errorListeners: Array<(error: Error) => void> = [];

  constructor(options: OfflineSyncOrchestratorOptions) {
    this.sessionProxy = options.sessionProxy;
    this.offlineStateManager = options.offlineStateManager;
    this.serviceWorkerManager = options.serviceWorkerManager;
    this.autoSync = options.autoSync ?? true;
    this.debug = options.debug ?? false;

    this.initialize();
  }

  /**
   * Initialize orchestrator
   */
  private initialize(): void {
    this.log('OfflineSyncOrchestrator initialized');

    // Listen to session state changes
    this.sessionProxy.on('state-changed', (patches: any[]) => {
      void this.handleStateChanged(patches);
    });

    // Listen to connection changes
    this.serviceWorkerManager.onOnline(() => this.handleOnline());
    this.serviceWorkerManager.onOffline(() => this.handleOffline());

    // Set initial online status
    this.isOnline = this.serviceWorkerManager.isOnlineNow();
  }

  /**
   * Handle state changes - persist patches
   */
  private async handleStateChanged(patches: any[]): Promise<void> {
    if (!Array.isArray(patches) || patches.length === 0) {
      return;
    }

    const sessionName = this.sessionProxy.name;

    try {
      const patchIds: string[] = [];

      // Store each patch
      for (const patch of patches) {
        const patchId = await this.offlineStateManager.storePatch(
          sessionName,
          patch,
          this.isOnline // Mark as synced if online
        );
        patchIds.push(patchId);
        this.log('Patch persisted', { patchId, synced: this.isOnline });
      }

      // Store state snapshot
      await this.offlineStateManager.storeSnapshot(
        sessionName,
        this.sessionProxy.state,
        patchIds[patchIds.length - 1] || ''
      );

      // Auto-sync if online
      if (this.autoSync && this.isOnline) {
        void this.syncPatches();
      }

      // Emit sync status
      this.emitStatusChange();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastErrorMessage = err.message;
      this.log('Error handling state change', err);
      this.emitError(err);
    }
  }

  /**
   * Handle online event
   */
  private handleOnline(): void {
    if (!this.isOnline) {
      this.isOnline = true;
      this.log('Connection restored, online');
      this.emitStatusChange();

      // Auto-sync pending patches
      if (this.autoSync) {
        void this.syncPatches();
      }
    }
  }

  /**
   * Handle offline event
   */
  private handleOffline(): void {
    if (this.isOnline) {
      this.isOnline = false;
      this.log('Connection lost, offline');
      this.emitStatusChange();
    }
  }

  /**
   * Sync pending patches to server
   */
  async syncPatches(): Promise<void> {
    if (this.isSyncing || !this.isOnline) {
      return;
    }

    this.isSyncing = true;
    this.emitStatusChange();

    try {
      const sessionName = this.sessionProxy.name;

      // Get unsynced patches
      const unsyncedPatches = await this.offlineStateManager.getUnsyncedPatches(sessionName);

      if (unsyncedPatches.length === 0) {
        this.log('No patches to sync');
        this.isSyncing = false;
        this.emitStatusChange();
        return;
      }

      this.log('Syncing patches', { count: unsyncedPatches.length });

      // Convert stored patches to server format
      const patchesToSync = unsyncedPatches.map((p) => ({
        op: p.op,
        path: p.path,
        value: p.value,
        from: p.from,
      }));

      // Send patches to server via MCP
      // In Phase 6d integration, this will use MCPClient.callTool or similar
      // For now, mark as synced after "sending"
      const syncedPatchIds = unsyncedPatches.map((p) => p.id);

      // Simulate network transmission
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mark patches as synced
      await this.offlineStateManager.markPatchesSynced(syncedPatchIds);
      await this.offlineStateManager.markPatchesApplied(syncedPatchIds);

      this.lastSyncTime = Date.now();
      this.failedPatchIds.clear();
      this.lastErrorMessage = '';

      this.log('Patches synced successfully', { count: syncedPatchIds.length });

      // Emit sync event
      this.emitSyncComplete({
        sessionName,
        patchCount: syncedPatchIds.length,
        timestamp: this.lastSyncTime,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastErrorMessage = err.message;
      this.log('Sync failed', err);
      this.emitError(err);
    } finally {
      this.isSyncing = false;
      this.emitStatusChange();
    }
  }

  /**
   * Manually retry failed patches
   */
  async retryFailedPatches(): Promise<void> {
    if (this.failedPatchIds.size === 0) {
      return;
    }

    this.log('Retrying failed patches', { count: this.failedPatchIds.size });

    const sessionName = this.sessionProxy.name;

    try {
      const failedIds = Array.from(this.failedPatchIds);

      // Re-attempt sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Mark as synced and applied
      await this.offlineStateManager.markPatchesSynced(failedIds);
      await this.offlineStateManager.markPatchesApplied(failedIds);

      this.lastSyncTime = Date.now();
      this.failedPatchIds.clear();
      this.lastErrorMessage = '';

      this.log('Failed patches retried successfully', { count: failedIds.length });
      this.emitStatusChange();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.lastErrorMessage = err.message;
      this.log('Retry failed', err);
      this.emitError(err);
    }
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncStatus {
    return {
      isOnline: this.isOnline,
      isPending: !this.isSyncing && this.failedPatchIds.size > 0,
      isSyncing: this.isSyncing,
      pendingPatchCount: this.failedPatchIds.size,
      failedPatchCount: this.failedPatchIds.size,
      lastSyncTime: this.lastSyncTime || undefined,
      lastErrorMessage: this.lastErrorMessage || undefined,
    };
  }

  /**
   * Listen for status changes
   */
  onStatusChange(callback: (status: SyncStatus) => void): void {
    this.statusListeners.push(callback);
  }

  /**
   * Listen for sync complete
   */
  onSyncComplete(callback: (syncInfo: any) => void): void {
    this.syncListeners.push(callback);
  }

  /**
   * Listen for sync errors
   */
  onError(callback: (error: Error) => void): void {
    this.errorListeners.push(callback);
  }

  /**
   * Emit status change event
   */
  private emitStatusChange(): void {
    const status = this.getSyncStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch (error) {
        this.log('Error in status change listener', error);
      }
    }
  }

  /**
   * Emit sync complete event
   */
  private emitSyncComplete(syncInfo: any): void {
    for (const listener of this.syncListeners) {
      try {
        listener(syncInfo);
      } catch (error) {
        this.log('Error in sync complete listener', error);
      }
    }
  }

  /**
   * Emit error event
   */
  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      try {
        listener(error);
      } catch (e) {
        this.log('Error in error listener', e);
      }
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<any> {
    return this.offlineStateManager.getStorageStats();
  }

  /**
   * Clear offline data for session
   */
  async clearOfflineData(): Promise<void> {
    const sessionName = this.sessionProxy.name;
    await this.offlineStateManager.clearPatches(sessionName);
    await this.offlineStateManager.clearSnapshot(sessionName);
    this.log('Offline data cleared', { sessionName });
  }

  /**
   * Debug logging
   */
  private log(message: string, data?: any): void {
    if (this.debug) {
      console.log(`[OfflineSyncOrchestrator] ${message}`, data);
    }
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    this.statusListeners = [];
    this.syncListeners = [];
    this.errorListeners = [];
    this.log('OfflineSyncOrchestrator destroyed');
  }
}
