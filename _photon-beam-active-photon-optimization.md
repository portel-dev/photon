# Beam Active Photon Optimization

**Status:** Design proposal
**Date:** 2026-03-06

---

## Problem

Current Beam behavior:
```
Server subscribes to: boards:default:state-changed
Server subscribes to: list:default:state-changed
Server subscribes to: tasks:default:state-changed
(... for ALL stateful photons)
         ↓
Server broadcasts: "boards state-changed"
Server broadcasts: "list state-changed"
Server broadcasts: "tasks state-changed"
         ↓
Frontend filters: if (msg.photon === ACTIVE_PHOTON) ...process else ...ignore
```

**Issue:** Network traffic for all photons even though only ONE is visible/active.

---

## Solution: Dynamic Subscription Based on Active Photon

### Architecture

**Before:** Always-on subscriptions to all photons
```
Beam server (Startup)
  ├─ Subscribe: boards:default:state-changed
  ├─ Subscribe: list:default:state-changed
  ├─ Subscribe: tasks:default:state-changed
  └─ Broadcast ALL events to clients
```

**After:** Dynamic subscriptions based on active photon
```
Beam server
  ├─ (No subscriptions at startup)
  └─ Wait for frontend signal

Frontend: "User clicked boards photon"
  └─ Send: POST /api/beam/set-active-photon { photon: "boards" }
      ↓
  Beam: Unsubscribe from (if any)
  Beam: Subscribe to boards:default:state-changed
  Beam: Broadcast only boards events
      ↓
Frontend: "User clicked list photon"
  └─ Send: POST /api/beam/set-active-photon { photon: "list", lastUpdated: T }
      ↓
  Beam: Unsubscribe from boards:default:state-changed
  Beam: Subscribe to list:default:state-changed
  Beam: Check: is T recent? Send pending events OR "refresh" signal
```

### Handshake Flow

**Step 1: User switches to inactive photon**
```
Frontend → Beam: {
  "method": "set-active-photon",
  "photon": "boards",
  "lastUpdated": 1709846400000  // timestamp we last saw this photon
}
```

**Step 2: Beam responds with**

**Option A: State is fresh (within 5 min)**
```json
{
  "status": "sync",
  "pending": [
    { "method": "add", "params": {...}, "data": {...} },
    { "method": "move", "params": {...}, "data": {...} }
  ],
  "lastUpdated": 1709846415000
}
```
→ Frontend applies pending changes incrementally

**Option B: State is stale (> 5 min)**
```json
{
  "status": "refresh-needed",
  "reason": "stale-data"
}
```
→ Frontend calls `boards/main()` to fetch fresh state

**Step 3: Beam subscribes and streams events**
```
boards state-changed → broadcast to frontend (in real-time)
boards state-changed → broadcast to frontend
boards state-changed → broadcast to frontend
(only boards photon, not others)
```

---

## Implementation Phases

### Phase 1: Add Active Photon Tracking (Current)
```typescript
// src/auto-ui/beam.ts
interface BeamSession {
  activPhoton?: string;
  subscriptions: Map<string, SubscriptionHandle>;
}

// When request comes in with photon context:
session.activPhoton = extractPhotonFromRequest(req);
```

### Phase 2: Dynamic Subscription Management
```typescript
async function setActivePhoton(
  session: BeamSession,
  photonName: string,
  lastUpdated?: number
) {
  // Unsubscribe from previous photon
  if (session.activPhoton && session.subscriptions.has(session.activPhoton)) {
    session.subscriptions.get(session.activPhoton)?.unsubscribe();
  }

  session.activPhoton = photonName;

  // Check if state is fresh
  const channel = `${photonName}:default:state-changed`;
  const { events, refreshNeeded } = getEventsSince(channel, lastUpdated || 0);

  if (refreshNeeded) {
    // Tell frontend to fetch fresh state
    return { status: 'refresh-needed' };
  } else {
    // Return pending changes for frontend to replay
    return {
      status: 'sync',
      pending: events.map(e => e.message),
      lastUpdated: Date.now()
    };
  }

  // Subscribe to new photon's events
  subscribeChannel(
    photonName,
    channel,
    (message) => {
      broadcastNotification('photon/state-changed', {
        photon: photonName,
        ...message
      });
    }
  );
}
```

### Phase 3: Frontend Integration
```typescript
// In Beam UI iframe handler
let lastUpdated = {}; // photon -> timestamp map

document.addEventListener('photon-switched', (e) => {
  const { photon } = e.detail;

  // Tell Beam which photon is active
  fetch('/api/beam/set-active-photon', {
    method: 'POST',
    headers: { 'Mcp-Session-Id': sessionId },
    body: JSON.stringify({
      photon,
      lastUpdated: lastUpdated[photon]
    })
  })
  .then(res => res.json())
  .then(response => {
    if (response.status === 'refresh-needed') {
      // Call main() to get fresh state
      refreshPhotonUI(photon);
    } else {
      // Apply pending changes
      response.pending?.forEach(change => {
        applyPatch(currentState, change.patch);
      });
      lastUpdated[photon] = response.lastUpdated;
    }
  });
});
```

---

## Benefits

| Scenario | Before | After |
|----------|--------|-------|
| 5 photons, viewing 1 | 5 subscriptions, 5 event streams | 1 subscription, 1 event stream |
| Switch photons | Still sending 5 streams | Unsubscribe old, subscribe new |
| Bandwidth (5 photons) | 5x state-changed events | 1x state-changed events |
| Mobile battery | Higher drain (5 streams) | Lower drain (1 stream) |
| Stale detection | N/A | Automatic: timestamps tracked |

---

## Data Flow Example

**Scenario:** User has 3 photons open, viewing "boards", switches to "list"

### Before (All subscriptions)
```
Time 0s: Beam subscribes to boards, list, tasks
         ↓
Time 1s: Task list updated (user didn't see)
         → Broadcast "tasks state-changed" to frontend
         → Frontend: "ignore, not active"
         ↓
Time 2s: User clicks "boards" in sidebar (already active, no change)
         → Broadcast "boards state-changed"
         → Frontend: "process, update UI"
         ↓
Time 3s: User clicks "list" in sidebar (switch)
         → Still receiving: boards, list, tasks updates
         → Frontend: "only process list updates"
```

**Bandwidth wasted:** Tasks events, boards events when not active

### After (Active photon only)
```
Time 0s: Beam idle (no subscriptions)
         ↓
Time 1s: User views "boards" (clicks it)
         → Beam: Subscribe to boards:default:state-changed
         → Return pending changes since last viewed
         → Frontend: Apply pending, ready to go
         ↓
Time 2s: User clicks "list" in sidebar (switch)
         → Beam: Unsubscribe boards:default:state-changed
         → Check: was list viewed in last 5 min?
         → If yes: return pending changes
         → If no: signal "refresh-needed"
         → Beam: Subscribe to list:default:state-changed
         → Frontend: Either apply pending OR call main()
```

**Bandwidth saved:** Only active photon events transmitted

---

## Migration Path

### Backward Compatible
- Keep current "subscribe all" as default
- Add optional `/api/beam/set-active-photon` endpoint
- Frontend can opt-in to active-photon mode gradually

### Gradual Rollout
1. Add endpoint (phase 2 code)
2. Update frontend to use it (phase 3 code)
3. Monitor: Compare bandwidth before/after
4. If successful, make it default
5. Eventually remove "subscribe all" mode

---

## Related Systems

This integrates with:
- **Event buffer**: 5-min window enables stale detection
- **Timestamp tracking**: lastUpdated determines if refresh needed
- **Channel subscription**: Unsubscribe/resubscribe per photon
- **Pending events API**: Daemon's `getEventsSince()` returns pending

---

## Implementation Checklist

- [ ] Phase 1: Track activePhoton in BeamSession
- [ ] Phase 2: Implement setActivePhoton() endpoint
- [ ] Phase 3: Update Beam UI to call endpoint on photon switch
- [ ] Test: Monitor bandwidth reduction with 5+ photons
- [ ] Docs: Update frontend developers on new behavior
- [ ] Monitor: Track per-photon subscription churn (subscribe/unsubscribe rate)

---

## Summary

**Current:** Always subscribe to all → wasteful
**Optimal:** Subscribe only to active photon, dynamically switch → efficient

The daemon already supports the needed primitives:
- ✅ Per-instance channels for isolation
- ✅ Event buffer for stale detection
- ✅ `getEventsSince()` for pending changes

Just need to wire it up in Beam's subscription management layer.
