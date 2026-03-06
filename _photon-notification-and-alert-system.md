# Photon Notification & Alert System

**Status:** Design proposal
**Date:** 2026-03-06

---

## Problem

Current architecture only subscribes to ACTIVE photon to save bandwidth. But what about **important events in inactive photons**?

**Scenarios:**
- User viewing "boards" photon
- "chat" photon receives critical message: `@user you're needed`
- User doesn't see it (not subscribed)
- Critical notification missed ❌

---

## Solution: Dual-Channel Subscription Model

### Channel Types

**1. State-Changed Channel (Active only)**
```
boards:default:state-changed      ← Only if "boards" is active
chat:default:state-changed        ← Only if "chat" is active (not needed otherwise)
```
Purpose: Real-time UI updates
Cost: Bandwidth only for active photon

**2. Notification Channel (Always subscribed)**
```
boards:default:notifications      ← Always subscribed (low frequency)
chat:default:notifications        ← Always subscribed (low frequency)
tasks:default:notifications       ← Always subscribed (low frequency)
```
Purpose: Important alerts, state changes that need user attention
Cost: Minimal (notifications are rare compared to state changes)

---

## Notification Types

### 1. System Notification (Low Priority)
```json
{
  "type": "notification",
  "photon": "chat",
  "instance": "default",
  "priority": "info",
  "message": "New message in #general",
  "badge": 5
}
```
→ Show badge on photon icon, user decides when to switch

### 2. Alert Notification (Medium Priority)
```json
{
  "type": "notification",
  "photon": "tasks",
  "instance": "default",
  "priority": "warning",
  "message": "Task deadline in 1 hour",
  "action": "view_task"
}
```
→ Show toast/notification, user can snooze or navigate

### 3. Critical Notification (High Priority)
```json
{
  "type": "notification",
  "photon": "alerts",
  "instance": "default",
  "priority": "critical",
  "message": "Production alert: server down",
  "action": "auto_switch",
  "sound": true,
  "badge": "🔴"
}
```
→ Auto-switch photon, play sound, mark as urgent

---

## Implementation

### 1. Photon Methods for Emitting Notifications

Inside a @stateful photon:

```typescript
/**
 * @description Chat photon with notifications
 * @stateful
 */
export default class Chat {
  messages: Message[] = [];

  addMessage(text: string, from: string) {
    const msg = { id: uuid(), text, from, timestamp: Date.now() };
    this.messages.push(msg);

    // Important: notify other clients about mention
    if (text.includes('@') || this.isCritical(text)) {
      this.notify({
        type: 'notification',
        priority: text.includes('@critical') ? 'critical' : 'warning',
        message: `New message from ${from}`,
        action: 'view_message',
        data: { messageId: msg.id }
      });
    }

    return msg;
  }

  private notify(notification: any) {
    // Emit to notifications channel (not state-changed)
    if (typeof (this as any).emit === 'function') {
      (this as any).emit({
        channel: `${this.instanceName || 'default'}:notifications`,
        event: 'notification',
        data: notification
      });
    }
  }
}
```

### 2. Daemon Publishing Notifications

**File:** `src/daemon/server.ts`

```typescript
// When photon emits notification
if (message?.channel?.endsWith(':notifications')) {
  const photonName = extractPhotonName(message.channel);
  const instanceName = extractInstance(message.channel);

  // Publish to notifications channel (separate from state-changed)
  publishToChannel(
    `${photonName}:${instanceName}:notifications`,
    {
      type: 'notification',
      photon: photonName,
      instance: instanceName,
      timestamp: Date.now(),
      ...message.data
    },
    socket
  );
}
```

### 3. Beam Always-On Notification Subscription

**File:** `src/auto-ui/beam.ts`

```typescript
// At startup: Subscribe to ALL notification channels
// (regardless of active photon)
const statefulPhotons = photons.filter((p) => p.stateful && p.configured);

for (const photon of statefulPhotons) {
  for (const instanceName of getConfiguredInstances(photon)) {
    // State-changed: Only subscribe if active (optional, for efficiency)
    // subscribeChannel(`${photon.name}:${instanceName}:state-changed`, ...);

    // Notifications: Always subscribe (critical feature)
    subscribeChannel(
      photon.name,
      `${photon.name}:${instanceName}:notifications`,
      (message) => {
        // Broadcast to client REGARDLESS of active photon
        broadcastNotification('photon/notification', {
          photon: photon.name,
          ...message
        });
      }
    );
  }
}
```

### 4. Frontend Notification Handler

```typescript
// SSE message handler
eventSource.addEventListener('photon/notification', (e) => {
  const notification = JSON.parse(e.data).params;

  switch (notification.priority) {
    case 'critical':
      // Auto-switch + visual alert
      switchToPhoton(notification.photon);
      showAlert(notification.message, { sound: true });
      break;

    case 'warning':
      // Show toast, add badge
      showToast(notification.message);
      addPhotonBadge(notification.photon, notification.badge);
      break;

    case 'info':
      // Silent badge update
      addPhotonBadge(notification.photon, notification.badge);
      break;
  }

  // Log for audit
  console.log('[Notification]', notification);
});
```

---

## Data Flow

### Scenario: Important message in chat while viewing boards

```
Time 0s:
  User views: boards (active)
  Subscriptions:
    ✅ boards:default:state-changed (active)
    ✅ chat:default:notifications (always-on)
    ✅ tasks:default:notifications (always-on)

Time 5s:
  Chat message arrives: "@user call the police!"
  ↓
  Chat photon detects mention:
    this.notify({
      priority: 'critical',
      action: 'auto_switch',
      message: 'CRITICAL: @user call the police!'
    })
  ↓
  Daemon publishes to: chat:default:notifications
  ↓
  Beam receives (always listening!)
  ↓
  Beam broadcasts: { photon: "chat", priority: "critical", ... }
  ↓
  Frontend receives via SSE:
    1. Auto-switch to chat photon
    2. Play alert sound
    3. Highlight message
```

---

## Benefits vs Current Approach

| Aspect | Without Notifications | With Notifications |
|--------|---------------------|-------------------|
| **User awareness** | Missing events in inactive photons ❌ | Aware of all important events ✅ |
| **Bandwidth** | Minimal (only active) | Minimal (notifications are rare) |
| **UX** | "Why did I miss that?" | "I was notified immediately" |
| **Actionability** | Manual: switch photon | Auto-switch + alert |
| **Priority handling** | No distinction | Critical/warning/info |

---

## Three-Tier Notification Priority

### Tier 1: Critical (Auto-switch, Sound)
```
- Production alerts
- Security incidents
- Explicit mentions (@user)
- Task deadlines NOW
```

### Tier 2: Warning (Toast, Badge)
```
- Task due soon (2 hours)
- New message in active chat
- Queue reaching limit
```

### Tier 3: Info (Silent Badge)
```
- Background sync complete
- Data refresh
- Routine status updates
```

---

## Integration with Active-Photon Optimization

### Without Notifications: Subscribe only to active
```typescript
// Only subscribe to active photon
subscribeChannel(`${activePhoton}:default:state-changed`, ...);

// On switch: unsubscribe old, subscribe new
```

**Problem:** Miss notifications from inactive photons ❌

### With Notifications: Separate channels
```typescript
// State-changed: Only active photon (bandwidth efficient)
subscribeChannel(`${activePhoton}:default:state-changed`, ...);

// Notifications: ALL photons (always-on, low frequency)
for (const photon of allPhotons) {
  subscribeChannel(`${photon}:default:notifications`, ...);
}
```

**Result:** Notifications never missed ✅

---

## Photon Developer API

### Emit Standard Notification
```typescript
this.notify({
  priority: 'warning',
  message: 'Task due in 1 hour'
});
```

### Emit Alert with Auto-Switch
```typescript
this.notify({
  priority: 'critical',
  message: 'Production error',
  action: 'auto_switch',  // Switch to this photon
  sound: true,            // Play sound
  badge: '🔴'            // Custom badge
});
```

### Emit with Custom Action
```typescript
this.notify({
  priority: 'info',
  message: 'New data available',
  action: 'custom',
  actionData: { method: 'refresh', params: {} }
});
```

---

## Architecture Summary

```
Daemon Event Emission
  ├─ State-changed events (frequent)
  │   → photon:instance:state-changed
  │   → Only to active photon (bandwidth-efficient)
  │
  └─ Notifications (rare)
      → photon:instance:notifications
      → To ALL clients (important, low frequency)
      → Supports priority levels (critical → auto-switch)
      → Unaffected by active-photon subscription model
```

---

## Implementation Checklist

- [ ] Add `notify()` method to Photon base class
- [ ] Add notifications channel to daemon (alongside state-changed)
- [ ] Update Beam to always-subscribe to notifications
- [ ] Frontend: handle photon/notification events
- [ ] Implement auto-switch for critical notifications
- [ ] Add sound/badge support
- [ ] Test: verify notifications reach inactive photons
- [ ] Docs: notification API guide for developers

---

## Example: Real-World Use Cases

### Chat Photon with Mentions
```typescript
addMessage(text: string) {
  const msg = this.createMessage(text);

  if (text.includes('@channel') || text.includes('@critical')) {
    this.notify({
      priority: 'critical',
      message: `Important: ${text.slice(0, 50)}...`,
      action: 'auto_switch',
      sound: true
    });
  }

  this.messages.push(msg);
  return msg;
}
```

### Monitoring Photon with Alerts
```typescript
checkHealth() {
  const status = this.getSystemStatus();

  if (status.cpu > 95) {
    this.notify({
      priority: 'critical',
      message: `CPU Alert: ${status.cpu}%`,
      action: 'auto_switch',
      badge: '🔴'
    });
  }

  return status;
}
```

### Task Photon with Deadlines
```typescript
checkDeadlines() {
  for (const task of this.tasks) {
    const timeLeft = task.dueDate - Date.now();

    if (timeLeft < 3600000) { // 1 hour
      this.notify({
        priority: 'warning',
        message: `${task.title} due in ${Math.round(timeLeft / 60000)}m`,
        action: 'view_task'
      });
    }
  }
}
```

---

## Summary

**Notifications are a separate concern from state synchronization:**

| Channel | Frequency | Use Case | Subscription |
|---------|-----------|----------|--------------|
| `photon:instance:state-changed` | High | UI updates | Active photon only |
| `photon:instance:notifications` | Low | User alerts | All clients always |

This design:
- ✅ Never misses important events
- ✅ Efficient bandwidth (notifications are rare)
- ✅ Clean separation of concerns
- ✅ Supports priority-based auto-switch
- ✅ Works with active-photon optimization
