# Phase 6: Offline-First Synchronization Architecture

## Overview

Phase 6 implements a complete offline-first synchronization system for Photon, enabling seamless state synchronization across online/offline transitions. The architecture uses three coordinated layers:

1. **ServiceWorkerManager** (6a) - Connection detection and cache management
2. **OfflineStateManager** (6b) - Durable patch persistence via IndexedDB
3. **OfflineSyncOrchestrator** (6c) - High-level coordination and event notifications

## Architecture Diagram

```
┌─────────────────────────────────────┐
│   Application (Beam UI)             │
│   - PhotonSessionProxy              │
│   - State change events             │
└────────────┬────────────────────────┘
             │
┌────────────▼────────────────────────────────────────┐
│   OfflineSyncOrchestrator (Phase 6c)                │
│   - Watches state changes                           │
│   - Manages patch persistence                       │
│   - Triggers auto-sync on reconnect                 │
│   - Event notifications                            │
└────┬──────────────┬──────────────────┬──────────────┘
     │              │                  │
┌────▼──────┐ ┌────▼───────────┐ ┌────▼──────────┐
│PhotonSession
│Proxy        │ │OfflineState   │ │ServiceWorker  │
│             │ │Manager        │ │Manager        │
│ - state     │ │ (Phase 6b)    │ │ (Phase 6a)    │
│ - patches   │ │ IndexedDB     │ │ SW lifecycle  │
│ - events    │ │ persistence   │ │ Connection    │
│             │ │               │ │ detection     │
└─────────────┘ └───────┬───────┘ └────┬──────────┘
                        │               │
                   ┌────▼───────────────▼─────┐
                   │  Browser APIs             │
                   │  - IndexedDB              │
                   │  - ServiceWorker API      │
                   │  - navigator.onLine       │
                   │  - Cache API              │
                   └───────────────────────────┘
```

## Components

### Phase 6a: ServiceWorkerManager

**File:** `src/auto-ui/frontend/services/service-worker-manager.ts`

Manages service worker lifecycle and connection state detection.

#### Responsibilities
- Service worker registration and unregistration
- Online/offline state monitoring via `navigator.onLine`
- Periodic update checks (hourly)
- Cache operations (clear, precache, size estimation)
- Skip-waiting for immediate updates

#### Key Methods
```typescript
async register(scriptUrl: string): Promise<ServiceWorkerRegistration>
async unregister(): Promise<boolean>
isOnlineNow(): boolean
onOnline(callback: () => void): void
onOffline(callback: () => void): void
onStatusChange(callback: (status: ServiceWorkerStatus) => void): void
async clearCache(): Promise<boolean>
async getCacheSize(): Promise<number>
async precache(urls: string[]): Promise<void>
postMessage(message: any): void
```

#### Events
- `online` - Connection restored
- `offline` - Connection lost
- `status-changed` - Status changed (installing, installed, updating, etc.)
- `update-available` - New service worker waiting

#### Usage Example
```typescript
const swManager = new ServiceWorkerManager({
  scope: '/',
  debug: false
});

await swManager.register('/sw.js');

swManager.onOnline(() => {
  console.log('Back online!');
});

swManager.onOffline(() => {
  console.log('Offline mode');
});

swManager.onStatusChange((status) => {
  console.log('SW status:', status);
});
```

---

### Phase 6b: OfflineStateManager

**File:** `src/auto-ui/frontend/services/offline-state-manager.ts`

Provides durable storage for patches and state snapshots using IndexedDB.

#### Responsibilities
- Async IndexedDB initialization
- Patch storage with sync/applied tracking
- State snapshot management
- Session isolation
- Storage statistics

#### Object Stores
1. **patches** - Stores JSON Patch objects with metadata
   - Index by sessionName
   - Index by synced status
   - Index by timestamp

2. **snapshots** - Full state snapshots (one per session)
   - Keyed by sessionName
   - Indexed by timestamp

3. **metadata** - Configuration and checkpoint tracking

#### StoredPatch Structure
```typescript
interface StoredPatch {
  id: string;                    // Unique patch identifier
  sessionName: string;           // Session name (photon name)
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;                  // JSON Pointer path
  value?: any;                   // New value (for add, replace)
  from?: string;                 // Source path (for move, copy)
  timestamp: number;             // When patch was stored
  synced: boolean;               // Whether sent to server
  appliedLocally: boolean;       // Whether applied to local state
}
```

#### Key Methods
```typescript
async storePatch(
  sessionName: string,
  patch: any,
  synced?: boolean
): Promise<string>

async getUnsyncedPatches(sessionName: string): Promise<StoredPatch[]>

async markPatchesSynced(patchIds: string[]): Promise<void>

async markPatchesApplied(patchIds: string[]): Promise<void>

async storeSnapshot(
  sessionName: string,
  state: Record<string, any>,
  patchId: string
): Promise<void>

async getSnapshot(sessionName: string): Promise<StateSnapshot | null>

async getStorageStats(): Promise<{
  patchCount: number;
  snapshotCount: number;
  totalSize: number;
}>

async clearPatches(sessionName: string): Promise<void>
async clearSnapshot(sessionName: string): Promise<void>
async clearAll(): Promise<void>
```

#### Usage Example
```typescript
const stateManager = new OfflineStateManager({
  dbName: 'photon-offline',
  version: 1,
  debug: false
});

// Store a patch
const patchId = await stateManager.storePatch(
  'boards',
  { op: 'add', path: '/items/0', value: { id: 1 } },
  false // Not yet synced
);

// Get unsynced patches
const unsyncedPatches = await stateManager.getUnsyncedPatches('boards');

// Mark as synced
await stateManager.markPatchesSynced([patchId]);

// Store state snapshot
await stateManager.storeSnapshot('boards', state, patchId);

// Check storage
const stats = await stateManager.getStorageStats();
console.log(`${stats.patchCount} patches, ${stats.snapshotCount} snapshots`);
```

---

### Phase 6c: OfflineSyncOrchestrator

**File:** `src/auto-ui/frontend/services/offline-sync-orchestrator.ts`

High-level coordinator for offline synchronization.

#### Responsibilities
- Watches PhotonSessionProxy state changes
- Persists patches to IndexedDB
- Manages patch queue when offline
- Auto-syncs patches when connection restored
- Event notifications for status, sync, and errors

#### SyncStatus Structure
```typescript
interface SyncStatus {
  isOnline: boolean;           // Current online status
  isPending: boolean;          // Has pending patches
  isSyncing: boolean;          // Currently syncing
  pendingPatchCount: number;   // Number of unsynced patches
  failedPatchCount: number;    // Number of failed patches
  lastSyncTime?: number;       // Unix timestamp of last successful sync
  lastErrorMessage?: string;   // Error message from last failure
}
```

#### Key Methods
```typescript
getSyncStatus(): SyncStatus

async syncPatches(): Promise<void>

async retryFailedPatches(): Promise<void>

async getStorageStats(): Promise<{
  patchCount: number;
  snapshotCount: number;
  totalSize: number;
}>

async clearOfflineData(): Promise<void>

onStatusChange(callback: (status: SyncStatus) => void): void
onSyncComplete(callback: (syncInfo: any) => void): void
onError(callback: (error: Error) => void): void
```

#### Events
- `status-changed` - Sync status changed (emitted frequently)
- `sync-complete` - Patches successfully synced to server
- `error` - Synchronization error occurred

#### Usage Example
```typescript
const orchestrator = new OfflineSyncOrchestrator({
  sessionProxy: sessionProxy,
  offlineStateManager: stateManager,
  serviceWorkerManager: swManager,
  autoSync: true,  // Auto-sync on reconnect
  debug: false
});

// Listen to status changes
orchestrator.onStatusChange((status) => {
  console.log('Sync status:', status);
  if (status.isOnline && status.pendingPatchCount === 0) {
    console.log('✅ Fully synced');
  }
});

// Listen to sync completion
orchestrator.onSyncComplete((syncInfo) => {
  console.log(`✅ Synced ${syncInfo.patchCount} patches`);
});

// Listen to errors
orchestrator.onError((error) => {
  console.error('Sync error:', error.message);
});

// Manual sync trigger
await orchestrator.syncPatches();

// Check current status
const status = orchestrator.getSyncStatus();
console.log(`Online: ${status.isOnline}, Pending: ${status.pendingPatchCount}`);
```

---

## Integration Guide

### Setup with Beam UI

```typescript
import { PhotonSessionProxy, initializeGlobalPhotonSession } from './services/photon-instance-manager.js';
import { OfflineStateManager } from './services/offline-state-manager.js';
import { ServiceWorkerManager } from './services/service-worker-manager.js';
import { OfflineSyncOrchestrator } from './services/offline-sync-orchestrator.js';

// 1. Initialize ServiceWorkerManager
const swManager = new ServiceWorkerManager({ scope: '/' });
await swManager.register('/sw.js');

// 2. Initialize OfflineStateManager
const stateManager = new OfflineStateManager();

// 3. Initialize PhotonSessionProxy (from server response)
const sessionProxy = initializeGlobalPhotonSession('boards', initialState);

// 4. Set up OfflineSyncOrchestrator
const orchestrator = new OfflineSyncOrchestrator({
  sessionProxy,
  offlineStateManager: stateManager,
  serviceWorkerManager: swManager,
  autoSync: true
});

// 5. Bind to UI
orchestrator.onStatusChange((status) => {
  updateUI({
    isOnline: status.isOnline,
    syncing: status.isSyncing,
    pendingChanges: status.pendingPatchCount
  });
});

// Application continues normally
// State changes are automatically persisted and synced
```

### Service Worker Integration

The service worker should handle:

1. **Background sync** - Use Background Sync API to sync when coming online
2. **Offline responses** - Serve cached responses when offline
3. **Message handling** - Process messages from MCPClient

Example service worker:

```typescript
// sw.ts
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Return cached responses for offline
  event.respondWith(
    caches.match(event.request).then(response =>
      response || fetch(event.request)
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data.type === 'SYNC_OFFLINE_QUEUE') {
    // Trigger sync from MCPClient
    event.ports[0].postMessage({ synced: true });
  }
});
```

---

## State Synchronization Flow

### Online Scenario
```
User action
    ↓
State change event (PhotonSessionProxy)
    ↓
OfflineSyncOrchestrator detects change
    ↓
Store patch in IndexedDB
    ↓
Auto-sync to server (if online)
    ↓
Patch marked as synced
    ↓
Emit sync-complete event
```

### Offline Scenario
```
User action (offline)
    ↓
State change event
    ↓
OfflineSyncOrchestrator detects change
    ↓
Store patch in IndexedDB (synced=false)
    ↓
Queue for later sync
    ↓
User comes online
    ↓
ServiceWorkerManager detects online
    ↓
OfflineSyncOrchestrator triggers auto-sync
    ↓
Send queued patches to server
    ↓
Mark patches as synced
    ↓
Emit sync-complete event
```

---

## Multi-Client Synchronization

When multiple clients update the same photon instance:

1. **Client A** goes offline, makes changes → Stored in IndexedDB
2. **Client B** (online) makes changes → Synced to server
3. **Server** broadcasts patches to all clients via state-changed events
4. **Client A** receives patches from server, applies them
5. **Client A** comes online → Syncs its queued patches
6. **Server** handles merge/conflict resolution (application-specific)

### Patch Ordering

Patches are stored with timestamps and ordered during sync:
- Server patches have precedence (they're the source of truth)
- Local queued patches are applied after server patches
- Conflict resolution is application-specific (last-write-wins, custom logic, etc.)

---

## Performance Considerations

### Storage Limits
- IndexedDB quota varies by browser (typically 50MB-1GB)
- Monitor storage via `getStorageStats()`
- Implement cleanup strategy:
  ```typescript
  const stats = await orchestrator.getStorageStats();
  if (stats.totalSize > STORAGE_THRESHOLD) {
    // Clean up old snapshots or patches
    await stateManager.clearPatches(oldSessionName);
  }
  ```

### Patch Batching
- Patches are batched via microtask to prevent excessive DOM updates
- Large change sets are stored atomically
- Snapshots are created periodically for recovery points

### Network Efficiency
- Only unsynced patches are transmitted
- Patches are deduplicated (same operation twice = single transmission)
- Compression can be applied at transport layer

---

## Error Handling

### Common Scenarios

1. **IndexedDB Quota Exceeded**
   ```typescript
   orchestrator.onError((error) => {
     if (error.message.includes('quota')) {
       // Clear old offline data
       await orchestrator.clearOfflineData();
     }
   });
   ```

2. **Sync Failure**
   ```typescript
   orchestrator.onError((error) => {
     console.error('Sync failed:', error);
     // Auto-retry on next online event
     // Or manual retry:
     await orchestrator.retryFailedPatches();
   });
   ```

3. **Merge Conflicts**
   - Application should implement conflict resolution
   - Use timestamps or version numbers
   - Consider operational transformation for complex cases

---

## Testing

### Unit Tests
- Phase 6a: 10 tests for ServiceWorkerManager
- Phase 6b: 10 tests for OfflineStateManager
- Phase 6c: 10 tests for OfflineSyncOrchestrator

Run tests:
```bash
npm run test:phase6a
npm run test:phase6b
npm run test:phase6c
```

### Integration Testing (Phase 6d)
- Multi-client scenarios
- Network simulation (online/offline transitions)
- Real MCPClient integration
- Performance benchmarks

### Manual Testing Checklist
- [ ] Go offline, make changes, verify IndexedDB storage
- [ ] Come online, verify auto-sync and state consistency
- [ ] Rapid online/offline transitions work correctly
- [ ] Large changesets don't cause browser hang
- [ ] Storage quota is respected
- [ ] Sync events fire correctly
- [ ] Error conditions are handled gracefully

---

## Troubleshooting

### Patches Not Syncing
1. Check ServiceWorkerManager.isOnlineNow()
2. Verify MCPClient connection
3. Check OfflineStateManager for unsynced patches
4. Look for errors in orchestrator.onError() callback

### High Storage Usage
1. Check snapshot retention policy
2. Clear old patches: `await orchestrator.clearOfflineData()`
3. Monitor with `getStorageStats()`

### Conflicts Between Clients
1. Implement application-level conflict resolution
2. Consider operational transformation or CRDT
3. Use timestamps for last-write-wins strategy
4. Server should enforce consistency guarantees

---

## Future Enhancements

- **Compression** - Compress patches before storage
- **Encryption** - Encrypt sensitive data in IndexedDB
- **CRDT** - Conflict-free replicated data types
- **Oplog** - Operational log for audit trail
- **Replication** - Multi-device synchronization
- **Selective Sync** - Choose which properties to sync

---

## API Reference

See individual component files for full API documentation:
- `src/auto-ui/frontend/services/service-worker-manager.ts`
- `src/auto-ui/frontend/services/offline-state-manager.ts`
- `src/auto-ui/frontend/services/offline-sync-orchestrator.ts`
