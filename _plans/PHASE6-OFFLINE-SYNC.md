# Phase 6: Offline Synchronization with Service Workers

## Overview

Build offline-first architecture for paginated lists with:
- **Service Worker Management** - Register, cache, update lifecycle
- **Local State Storage** - IndexedDB for offline data persistence
- **Patch Queue System** - Queue mutations while offline
- **Automatic Reconciliation** - Sync when connection restored
- **Conflict Resolution** - Handle concurrent changes

## Architecture (3 Layers)

### Layer 1: ServiceWorkerManager (Frontend)
**File**: `src/auto-ui/frontend/services/service-worker-manager.ts` (NEW)

```typescript
export class ServiceWorkerManager {
  constructor(scope: string = '/') {
    // Register service worker
    // Monitor lifecycle (installing, activating, installed)
    // Handle updates
  }

  async register(scriptUrl: string): Promise<ServiceWorkerRegistration>
  async unregister(): Promise<boolean>
  getStatus(): 'unregistered' | 'installing' | 'installed' | 'updating'
  onStatusChange(callback: (status: string) => void): void
  isOnline(): boolean
  onOnline(callback: () => void): void
  onOffline(callback: () => void): void
}
```

**Responsibilities:**
- Register service worker
- Monitor connection state
- Handle SW lifecycle events
- Trigger cache updates

### Layer 2: OfflineStateManager (Frontend)
**File**: `src/auto-ui/frontend/services/offline-state-manager.ts` (NEW)

```typescript
export class OfflineStateManager {
  private db: IDBDatabase
  private patchQueue: PatchFrame[] = []
  private isOnline: boolean = true

  async init(dbName: string, version: number): Promise<void>
  async savePatches(patches: any[]): Promise<void>
  async getPendingPatches(): Promise<any[]>
  async clearPatches(): Promise<void>
  async saveLocalState(key: string, state: any): Promise<void>
  async getLocalState(key: string): Promise<any>
  async getAllStates(): Promise<Map<string, any>>
  onStateReady(callback: (state: any) => void): void
}
```

**Interface:**
```typescript
interface PatchFrame {
  id: string                    // Unique patch ID
  patches: JsonPatch[]
  timestamp: number
  sequence: number              // Offline sequence number
  photonName: string
  synced: boolean
}
```

**Responsibilities:**
- Persist patches to IndexedDB
- Manage offline queue
- Restore state on reconnect
- Track sync status

### Layer 3: OfflineSyncOrchestrator (Frontend)
**File**: `src/auto-ui/frontend/services/offline-sync-orchestrator.ts` (NEW)

```typescript
export class OfflineSyncOrchestrator {
  constructor(
    options: {
      stateManager: OfflineStateManager
      swManager: ServiceWorkerManager
      instance: PhotonInstanceProxy
      syncInterval?: number
    }
  ) {}

  async syncPending(): Promise<SyncResult>
  onSyncStart(callback: () => void): void
  onSyncComplete(callback: (result: SyncResult) => void): void
  onConflict(callback: (conflict: ConflictInfo) => void): void
}
```

**Interface:**
```typescript
interface SyncResult {
  successful: number
  failed: number
  conflicted: number
  duration: number
}

interface ConflictInfo {
  patch: JsonPatch
  localVersion: any
  serverVersion: any
  resolution: 'local' | 'server' | 'merge'
}
```

**Responsibilities:**
- Orchestrate sync flow
- Handle conflicts
- Emit sync events
- Track sync progress

## Implementation Plan

### Phase 6a: ServiceWorkerManager (Week 1)
- [ ] Implement SW registration with fallback
- [ ] Monitor connection state (online/offline)
- [ ] Handle SW lifecycle (installing, activated)
- [ ] Cache management strategies
- [ ] Test: 8 tests covering all features

### Phase 6b: OfflineStateManager (Week 1-2)
- [ ] IndexedDB schema design
- [ ] Patch persistence
- [ ] Local state storage
- [ ] Queue management (FIFO)
- [ ] Test: 10 tests for persistence and retrieval

### Phase 6c: OfflineSyncOrchestrator (Week 2)
- [ ] Sync flow orchestration
- [ ] Conflict detection
- [ ] Automatic sync on reconnect
- [ ] Batch sync operations
- [ ] Test: 10 tests for sync scenarios

### Phase 6d: Integration Testing (Week 2-3)
- [ ] Multi-client offline scenarios
- [ ] Large patch queue handling
- [ ] Network disruption simulation
- [ ] Conflict resolution validation
- [ ] Test: 12 tests for real-world scenarios

### Phase 6e: Documentation (Week 3)
- [ ] API documentation
- [ ] Offline-first patterns
- [ ] Conflict resolution guide
- [ ] Performance considerations
- [ ] Troubleshooting

## Test Coverage

### Phase 6a: 8 tests
- SW registration success/failure
- Connection state detection
- Lifecycle event handling
- Cache strategies

### Phase 6b: 10 tests
- Create/read/update/delete patches in IndexedDB
- Queue ordering
- State persistence
- Large dataset handling
- Database versioning

### Phase 6c: 10 tests
- Sync flow orchestration
- Conflict detection
- Automatic reconnect sync
- Batch operations
- Progress tracking

### Phase 6d: 12 tests
- Offline mode with modifications
- Reconnection and sync
- Multiple clients offline
- Patch ordering after sync
- Memory under sustained offline

### Phase 6e: Documentation
- API reference
- Usage examples
- Patterns (offline-first, eventual consistency)
- Troubleshooting

## Acceptance Criteria

### Functionality
- [ ] Can queue patches while offline
- [ ] Patches synced on reconnect
- [ ] Conflict detection working
- [ ] Local state restored on load

### Performance
- [ ] Offline operations < 50ms
- [ ] Sync 1000+ patches in < 5s
- [ ] Memory < 100MB with 10k queued patches

### Reliability
- [ ] No data loss during offline
- [ ] Patches apply in order after sync
- [ ] Handle rapid reconnects

## Key Challenges & Mitigation

### Challenge: Patch Ordering
During offline, patches queued sequentially. On sync, must apply in order to server state.

**Mitigation:**
- Sequence numbers for all patches
- Server validates sequence monotonicity
- Reject out-of-order patches

### Challenge: Conflict Detection
Two clients offline, both modify item 5, reconnect → conflict.

**Mitigation:**
- Timestamp + sequence number per patch
- Last-write-wins or merge strategy
- Callback for application-specific resolution

### Challenge: IndexedDB Quota
IDB quota varies by browser (50MB - 1GB typically).

**Mitigation:**
- Monitor quota usage
- Warn user when approaching limit
- Implement patch compression
- Allow manual cleanup

## Integration Points

1. **PaginatedListManager** (Phase 5)
   - OfflineSyncOrchestrator watches state-changed events
   - Queues patches before sync

2. **ServiceWorkerManager**
   - Detects online/offline state
   - Triggers sync on reconnect

3. **PhotonInstanceProxy**
   - Accepts queued patches
   - Replays local state

## Success Metrics

- [ ] All 50 tests passing
- [ ] Can work offline for hours
- [ ] Seamless sync on reconnect
- [ ] No data corruption or loss
- [ ] Sub-second sync for typical patch queues

## Timeline

- **Week 1**: 6a (SW Manager) + 6b (State Manager)
- **Week 2**: 6c (Sync Orchestrator) + 6d tests
- **Week 3**: 6e documentation + polish

## Post-Phase 6 Roadmap

- **Phase 7**: Predictive prefetching using ML
  - Analyze scroll patterns
  - Pre-fetch likely ranges

- **Phase 8**: Compression for mobile networks
  - Patch compression
  - Adaptive quality
  - Bandwidth optimization
