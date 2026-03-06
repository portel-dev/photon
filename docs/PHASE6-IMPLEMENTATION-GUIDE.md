# Phase 6 Implementation Guide

Quick start for integrating offline-first synchronization into your Photon application.

## Quick Start (5 minutes)

### 1. Import the Services

```typescript
import { OfflineStateManager } from '../services/offline-state-manager.js';
import { ServiceWorkerManager } from '../services/service-worker-manager.js';
import { OfflineSyncOrchestrator } from '../services/offline-sync-orchestrator.js';
import { initializeGlobalPhotonSession } from '../services/photon-instance-manager.js';
```

### 2. Initialize Services

```typescript
// Create service instances
const swManager = new ServiceWorkerManager({ scope: '/' });
const stateManager = new OfflineStateManager();

// Register service worker
await swManager.register('/sw.js');

// Initialize session proxy (receives initial state from server)
const sessionProxy = initializeGlobalPhotonSession('boards', serverState);

// Create orchestrator (ties everything together)
const orchestrator = new OfflineSyncOrchestrator({
  sessionProxy,
  offlineStateManager: stateManager,
  serviceWorkerManager: swManager,
  autoSync: true  // Auto-sync when coming online
});
```

### 3. Handle Sync Events

```typescript
// Show sync status in UI
orchestrator.onStatusChange((status) => {
  const icon = status.isOnline ? '🟢' : '🔴';
  const pending = status.pendingPatchCount > 0 ? ` (${status.pendingPatchCount} pending)` : '';
  updateStatusUI(`${icon} ${status.isSyncing ? 'Syncing...' : 'Ready'}${pending}`);
});

// Notify on successful sync
orchestrator.onSyncComplete((syncInfo) => {
  showToast(`✅ Synced ${syncInfo.patchCount} changes`);
});

// Handle sync errors
orchestrator.onError((error) => {
  showToast(`❌ Sync failed: ${error.message}`, 'error');
});
```

### 4. Use the Proxy Normally

```typescript
// State changes are automatically persisted and synced
sessionProxy.state.items.push({ id: 1, text: 'New item' });

// Get current status anytime
const status = orchestrator.getSyncStatus();
if (status.pendingPatchCount > 0) {
  console.log(`${status.pendingPatchCount} changes waiting to sync`);
}
```

That's it! Your app now has offline-first synchronization.

---

## Common Patterns

### Pattern 1: Show Offline Banner

```typescript
let isOnline = true;

orchestrator.onStatusChange((status) => {
  isOnline = status.isOnline;
  const banner = document.getElementById('offline-banner');
  banner.style.display = isOnline ? 'none' : 'block';
});
```

### Pattern 2: Disable UI When Syncing

```typescript
orchestrator.onStatusChange((status) => {
  const submitBtn = document.getElementById('submit');
  submitBtn.disabled = status.isSyncing || !status.isOnline;
});
```

### Pattern 3: Retry Failed Syncs

```typescript
// Automatic retry on reconnect (if autoSync: true)
// OR manual retry button:

document.getElementById('retry-btn').addEventListener('click', async () => {
  await orchestrator.retryFailedPatches();
  showToast('Retrying sync...');
});
```

### Pattern 4: Monitor Storage

```typescript
async function checkStorage() {
  const stats = await orchestrator.getStorageStats();
  console.log(`Storage: ${stats.patchCount} patches, ${(stats.totalSize / 1024 / 1024).toFixed(2)}MB`);

  // Clean up if needed
  if (stats.totalSize > 50 * 1024 * 1024) { // 50MB
    await orchestrator.clearOfflineData();
  }
}

// Check periodically
setInterval(checkStorage, 60000);
```

### Pattern 5: Manual Sync Trigger

```typescript
document.getElementById('sync-now-btn').addEventListener('click', async () => {
  showToast('Syncing...');
  try {
    await orchestrator.syncPatches();
  } catch (error) {
    showToast(`Sync failed: ${error.message}`, 'error');
  }
});
```

---

## Common Configurations

### Conservative (Manual Sync Only)

```typescript
const orchestrator = new OfflineSyncOrchestrator({
  sessionProxy,
  offlineStateManager: stateManager,
  serviceWorkerManager: swManager,
  autoSync: false  // User must manually sync
});
```

Good for: Apps that need explicit sync control (financial apps, etc.)

### Aggressive (Auto Everything)

```typescript
const orchestrator = new OfflineSyncOrchestrator({
  sessionProxy,
  offlineStateManager: stateManager,
  serviceWorkerManager: swManager,
  autoSync: true  // Automatic sync on reconnect
});
```

Good for: Real-time collaborative apps (docs, boards, etc.)

### Debug Mode

```typescript
const swManager = new ServiceWorkerManager({ debug: true });
const stateManager = new OfflineStateManager({ debug: true });
const orchestrator = new OfflineSyncOrchestrator({
  sessionProxy,
  offlineStateManager: stateManager,
  serviceWorkerManager: swManager,
  debug: true
});

// Logs will appear in console:
// [ServiceWorkerManager] Online
// [OfflineStateManager] Patch stored
// [OfflineSyncOrchestrator] Syncing patches...
```

---

## Multi-Photon Setup

For applications with multiple stateful photons:

```typescript
const managers = new Map();

async function initializePhoton(photonName, initialState) {
  const swManager = new ServiceWorkerManager();
  const stateManager = new OfflineStateManager({
    dbName: `photon-offline-${photonName}`
  });
  const sessionProxy = initializeGlobalPhotonSession(photonName, initialState);

  const orchestrator = new OfflineSyncOrchestrator({
    sessionProxy,
    offlineStateManager: stateManager,
    serviceWorkerManager: swManager,
    autoSync: true
  });

  managers.set(photonName, orchestrator);
  return orchestrator;
}

// Initialize multiple photons
await initializePhoton('boards', boardsState);
await initializePhoton('tasks', tasksState);
await initializePhoton('calendar', calendarState);

// Sync all
async function syncAll() {
  for (const [name, orchestrator] of managers) {
    console.log(`Syncing ${name}...`);
    await orchestrator.syncPatches();
  }
}
```

---

## Error Handling Patterns

### Pattern 1: Graceful Degradation

```typescript
orchestrator.onError((error) => {
  // Log for debugging
  console.error('Sync error:', error);

  // Continue working anyway - local changes are safe
  // Retry will happen automatically on next online event

  // Only show critical errors to user
  if (error.message.includes('quota')) {
    showToast('Storage full. Please sync and clear old data.', 'error');
  }
});
```

### Pattern 2: Retry with Backoff

```typescript
let retryCount = 0;
const maxRetries = 3;

orchestrator.onError(async (error) => {
  if (retryCount < maxRetries) {
    retryCount++;
    const delay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
    console.log(`Retrying in ${delay}ms...`);
    setTimeout(() => orchestrator.retryFailedPatches(), delay);
  }
});

orchestrator.onSyncComplete(() => {
  retryCount = 0; // Reset on success
});
```

### Pattern 3: Sync to External Service

```typescript
orchestrator.onSyncComplete(async (syncInfo) => {
  // After syncing to server, also sync to another service
  try {
    await fetch('/api/sync-secondary', {
      method: 'POST',
      body: JSON.stringify({ photon: syncInfo.sessionName, patches: syncInfo.patchCount })
    });
  } catch (error) {
    console.error('Secondary sync failed:', error);
    // Don't retry - patches are already safe on primary server
  }
});
```

---

## Stateful Photon Integration

For @stateful photons with instance management:

```typescript
// User selects a board instance
async function selectBoard(boardId) {
  // Call photon's _use method to switch instances
  const response = await mcpClient.callTool('boards/_use', { name: boardId });

  // Server sends initial state for that instance
  const sessionProxy = initializeGlobalPhotonSession('boards', response.initialState);

  // Create orchestrator for this instance
  const orchestrator = new OfflineSyncOrchestrator({
    sessionProxy,
    offlineStateManager: new OfflineStateManager(),
    serviceWorkerManager: swManager,
    autoSync: true
  });

  // Now all changes to this instance are synced
  return orchestrator;
}
```

---

## Testing Your Integration

### Unit Test Template

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { OfflineSyncOrchestrator } from '../services/offline-sync-orchestrator.js';

describe('Offline Sync', () => {
  let orchestrator;

  beforeEach(() => {
    orchestrator = new OfflineSyncOrchestrator({
      sessionProxy: mockSessionProxy,
      offlineStateManager: mockStateManager,
      serviceWorkerManager: mockSwManager,
      autoSync: false
    });
  });

  it('syncs patches when online', async () => {
    const statusChanges = [];
    orchestrator.onStatusChange((status) => {
      statusChanges.push(status);
    });

    // Trigger state change
    mockSessionProxy.simulateStateChange([{
      op: 'add', path: '/items/0', value: { id: 1 }
    }]);

    // Verify patch was stored
    let unsynced = await mockStateManager.getUnsyncedPatches('TestPhoton');
    expect(unsynced.length).toBe(1);

    // Sync and verify
    await orchestrator.syncPatches();
    unsynced = await mockStateManager.getUnsyncedPatches('TestPhoton');
    expect(unsynced.length).toBe(0);
  });
});
```

### Manual Testing Checklist

- [ ] **Offline writes**: Go offline, make changes, verify they're stored
- [ ] **Online sync**: Come online, verify changes sync automatically
- [ ] **Status events**: Verify status change events fire correctly
- [ ] **Rapid transitions**: Toggle online/offline quickly, no data loss
- [ ] **Large changes**: Verify large changesets don't block UI
- [ ] **Storage limits**: Verify storage quota is respected
- [ ] **Error recovery**: Verify errors are recoverable
- [ ] **Multiple tabs**: Verify multiple tabs stay in sync
- [ ] **Service worker**: Verify SW lifecycle works correctly

---

## Debugging Tips

### Enable Verbose Logging

```typescript
// In DevTools console:
const orchestrator = window.__photonOrchestratorDebug;
orchestrator.debug = true;
```

### Check IndexedDB

```javascript
// In DevTools > Application > IndexedDB:
// Database: photon-offline
// Stores: patches, snapshots, metadata
// Check patch contents and sync status
```

### Monitor Service Worker

```javascript
// In DevTools > Application > Service Workers:
// Check registration status, update availability
// View messages in console
```

### Trace State Changes

```typescript
const originalEmit = sessionProxy.emit.bind(sessionProxy);
sessionProxy.emit = function(event, ...args) {
  if (event === 'state-changed') {
    console.log('🔄 State changed:', args[0]);
  }
  return originalEmit(event, ...args);
};
```

---

## Performance Tips

1. **Batch writes** - Group multiple state changes before transmitting
2. **Snapshot periodically** - Don't rely only on patches for recovery
3. **Clean up old data** - Implement archive/cleanup strategy
4. **Monitor storage** - Watch IndexedDB quota usage
5. **Tune page size** - ViewportManager.pageSize for paginated data
6. **Use compression** - Gzip patches before storage (future enhancement)

---

## Migration from Non-Offline App

If adding offline support to an existing app:

1. **Don't break existing code** - Keep PhotonInstanceProxy imports working (backward compat aliases)
2. **Add opt-in** - Let features opt into offline support
3. **Test thoroughly** - Offline adds complexity, needs careful testing
4. **Plan storage** - Know your data size and quota limits
5. **User education** - Explain what "offline mode" means in your context

---

## Need Help?

- See `docs/PHASE6-OFFLINE-SYNC.md` for complete API reference
- Check `tests/phase6*.test.ts` for working examples
- Run with `debug: true` to see detailed logging
- Review service-worker-manager.ts source for implementation details
