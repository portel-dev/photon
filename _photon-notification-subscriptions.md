# Photon Notification Subscriptions & Message Counts

**Status:** Design proposal
**Date:** 2026-03-06

---

## Problem

Current notification system broadcasts all notifications. But:
- Not all events are important to every photon
- Wasted bandwidth on irrelevant notifications
- No way to customize what "important" means per photon
- Sidebar message count doesn't distinguish signal from noise

---

## Solution: Declarative Notification Subscriptions

### 1. Photon Declares What It Cares About

Inside photon source code:

```typescript
/**
 * @description Chat photon
 * @stateful
 * @notify-on mentions, system-alerts, user-online
 */
export default class Chat {
  messages: Message[] = [];

  // Method that generates notification
  addMessage(text: string, from: string) {
    const msg = { id: uuid(), text, from };
    this.messages.push(msg);

    // Check if this should trigger notification
    if (text.includes('@channel') || text.includes('@critical')) {
      return {
        ...msg,
        __notification: {
          type: 'mention',
          priority: 'critical'
        }
      };
    }

    return msg;
  }
}
```

### 2. Schema Extraction: Parse @notify-on Tags

**File:** `src/shared/schema-extractor.ts`

```typescript
interface NotificationSubscription {
  photon: string;
  instance: string;
  watchFor: string[]; // ['mentions', 'deadlines', 'errors']
  notifyWhen: {
    type: 'mention' | 'deadline' | 'error' | 'custom';
    priority: 'critical' | 'warning' | 'info';
    filter?: string; // optional: "< 1 hour"
  }[];
}

function extractNotificationSubscriptions(source: string): NotificationSubscription {
  // Parse @notify-on tag from docstring
  const notifyMatch = source.match(/@notify-on\s+([\w\s,]+)/);
  if (!notifyMatch) return null;

  const watchFor = notifyMatch[1]
    .split(',')
    .map(s => s.trim());

  return {
    photon: extractPhotonName(source),
    watchFor,
    // Match notification metadata in methods
    notifyWhen: extractNotificationMetadata(source)
  };
}

// Extract __notification metadata from methods
function extractNotificationMetadata(source: string) {
  const notifications = [];
  const typeMatches = source.matchAll(/__notification:\s*\{([^}]+)\}/g);

  for (const match of typeMatches) {
    notifications.push(parseNotificationMetadata(match[1]));
  }

  return notifications;
}
```

### 3. Beam Filters Notifications by Subscription

**File:** `src/auto-ui/beam.ts`

```typescript
interface BeamSession {
  activePhoton?: string;
  photonSubscriptions: Map<string, NotificationSubscription>;
  messageCount: Map<string, number>; // photon -> unread count
}

// On startup: Extract and store notification subscriptions
const photons = loadPhotons();
for (const photon of photons) {
  const schema = extractSchema(photon.source);
  const subscription = schema.notificationSubscriptions;

  if (subscription) {
    session.photonSubscriptions.set(photon.name, subscription);
  }
}

// When notification arrives
subscribeChannel(
  photon.name,
  `${photon.name}:default:notifications`,
  (message) => {
    // Check: does this photon care about this notification?
    const subscription = session.photonSubscriptions.get(photon.name);

    if (shouldNotify(message, subscription)) {
      // YES: Broadcast to client + increment message count
      session.messageCount.set(
        photon.name,
        (session.messageCount.get(photon.name) || 0) + 1
      );

      broadcastNotification('photon/notification', {
        photon: photon.name,
        messageCount: session.messageCount.get(photon.name),
        ...message
      });
    }
    // NO: Ignore notification (not in subscription)
  }
);

function shouldNotify(message, subscription): boolean {
  if (!subscription || !subscription.watchFor) return false;

  // Check if message type matches any watch-for
  return subscription.watchFor.some(
    (watch) => message.type === watch || message.tags?.includes(watch)
  );
}
```

### 4. Frontend: Message Count on Sidebar

```typescript
interface PhotonBadge {
  photon: string;
  messageCount: number;
  priority: 'critical' | 'warning' | 'info';
  unread: boolean;
}

// Maintain per-photon message count
const badges: Map<string, PhotonBadge> = new Map();

// On notification
eventSource.addEventListener('photon/notification', (e) => {
  const { photon, messageCount, priority } = JSON.parse(e.data).params;

  // Update sidebar badge
  badges.set(photon, {
    photon,
    messageCount,
    priority,
    unread: true
  });

  updateSidebar(badges);
});

// When user clicks photon
function switchToPhoton(photonName) {
  switchActive(photonName);

  // Mark as read
  const badge = badges.get(photonName);
  if (badge) {
    badge.unread = false;
    // Clear message count
    sendToServer({
      method: 'clear-message-count',
      photon: photonName
    });
  }

  updateSidebar(badges);
}
```

### 5. Sidebar Display

```
📊 Dashboard        0
📋 Tasks           12  ← 12 messages waiting
💬 Chat             5  ← 5 messages waiting
📌 Boards           0
🔔 Notifications  ●    ← Critical (no count, just alert)
```

**Colors/Icons:**
- 🔴 Critical (red) - auto-switch + sound
- 🟡 Warning (orange) - message count shown
- ⚪ Info (gray) - silent badge

---

## Data Flow: Per-Photon Subscriptions

### Setup (Startup)
```
1. Load all photons
   ↓
2. Extract source code
   ↓
3. Parse @notify-on tags:
   @notify-on mentions, deadlines, errors
   ↓
4. Store subscription per photon:
   chat: { watchFor: ['mentions'] }
   tasks: { watchFor: ['deadlines'] }
   alerts: { watchFor: ['errors'] }
```

### Runtime (User viewing Board, Alert Happens)
```
Time 0s:
  User: viewing "boards" photon
  MessageCounts:
    tasks: 2    ← Some old messages waiting
    chat: 0
    alerts: 0

Time 5s:
  Task deadline happens in alerts photon
  Daemon publishes to: alerts:default:notifications
    {
      type: 'deadline',
      priority: 'warning',
      message: 'Task XYZ due in 1 hour'
    }
   ↓
  Beam checks: does "alerts" photon subscribe to "deadline"?
  Subscription: alerts.watchFor = ['errors', 'custom']
  Match? NO (deadline not in watchFor)
  ↓
  Do nothing (notification filtered out) ✓

Time 10s:
  Production error in alerts photon
  Daemon publishes to: alerts:default:notifications
    {
      type: 'error',
      priority: 'critical',
      message: 'API down: 500 errors'
    }
   ↓
  Beam checks: does "alerts" photon subscribe to "error"?
  Subscription: alerts.watchFor = ['errors', 'custom']
  Match? YES
  ↓
  Increment message count:
    alerts: 0 → 1
  ↓
  Broadcast to client:
    { photon: 'alerts', messageCount: 1, priority: 'critical' }
  ↓
  Frontend updates sidebar:
    🔔 Alerts  ● ← Shows critical badge
```

---

## Photon Developer API

### Declare Notification Interests

```typescript
/**
 * @description Task management with deadline alerts
 * @stateful
 * @notify-on deadline, assignment, completion
 */
export default class Tasks {
  tasks: Task[] = [];

  addTask(title: string, dueDate: number) {
    const task = { id: uuid(), title, dueDate };
    this.tasks.push(task);
    return task;
  }

  // Automatically triggers notification if dueDate < 1 hour
  checkDeadlines() {
    for (const task of this.tasks) {
      const timeLeft = task.dueDate - Date.now();
      if (timeLeft < 3600000) {
        // This gets caught by @notify-on deadline
        return {
          __notification: {
            type: 'deadline',
            priority: 'warning'
          },
          task
        };
      }
    }
  }
}
```

### Optional: Fine-grained Filters

```typescript
/**
 * @notify-on deadline<1hour, high-priority-tasks, @mentions
 */
export default class Tasks {
  checkDeadlines(filter?: string) {
    // Only notify about deadlines < 1 hour (matched by filter)
    for (const task of this.tasks) {
      const timeLeft = task.dueDate - Date.now();
      if (timeLeft < 3600000) { // < 1 hour
        return {
          __notification: {
            type: 'deadline',
            priority: task.priority === 'high' ? 'warning' : 'info'
          }
        };
      }
    }
  }
}
```

---

## Message Count Persistence

### Per-Session Message Count

```typescript
// Beam maintains count per session per photon
class BeamSession {
  messageCount: Map<string, number>;  // photon → count

  incrementMessageCount(photon: string) {
    this.messageCount.set(photon, (this.messageCount.get(photon) || 0) + 1);
    return this.messageCount.get(photon);
  }

  clearMessageCount(photon: string) {
    this.messageCount.set(photon, 0);
  }
}

// Clear when user views photon
app.post('/api/beam/clear-message-count', (req, res) => {
  const { photon } = req.body;
  const sessionId = req.headers['mcp-session-id'];
  const session = sessions.get(sessionId);

  if (session) {
    session.clearMessageCount(photon);
    res.json({ success: true });
  }
});
```

### Sync to Frontend

```json
{
  "method": "photon/message-counts",
  "params": {
    "counts": {
      "chat": 5,
      "tasks": 12,
      "alerts": 1,
      "boards": 0
    }
  }
}
```

Frontend maintains local badge state.

---

## Architecture: Three-Tier Notification System

```
Layer 1: Photon Declaration
  @notify-on mentions, deadlines, errors
  (What matters to this photon)

Layer 2: Server-Side Filtering
  Beam stores subscriptions
  Filters incoming notifications
  Increments message count only if subscribed
  (Only send relevant events)

Layer 3: Client UI
  Sidebar badges with message counts
  Visual indicator of what's waiting
  Click → switch + clear count
  (User knows what needs attention)
```

---

## Benefits

| Before | After |
|--------|-------|
| All notifications broadcasted | Only subscribed notifications sent |
| No message counts | Sidebar shows counts per photon |
| Hard to ignore noise | Signal-to-noise ratio optimized |
| "What's important?" | Each photon declares what matters |
| Wasted bandwidth | Targeted notifications |

---

## Example: Realistic Setup

### Chat Photon
```typescript
/**
 * @notify-on mentions, private-messages
 */
export default class Chat {
  // Only notifications for @mentions and direct messages
}
```
→ Sidebar shows: `💬 Chat 3` (3 waiting messages)

### Task Photon
```typescript
/**
 * @notify-on deadline<1hour, assigned-to-me, blocked
 */
export default class Tasks {
  // Only notifications for imminent deadlines, my tasks, blockers
}
```
→ Sidebar shows: `📋 Tasks 8` (8 critical items waiting)

### Monitoring Photon
```typescript
/**
 * @notify-on error, cpu>90%, memory>85%
 */
export default class Monitoring {
  // Only system critical alerts
}
```
→ Sidebar shows: `🔔 Monitoring ●` (critical alert)

### Analytics Photon
```typescript
/**
 * @notify-on (none)
 */
export default class Analytics {
  // No notifications - this photon isn't interrupt-driven
}
```
→ Sidebar shows: `📊 Analytics` (no badge)

---

## Implementation Checklist

- [ ] Add `@notify-on` tag parsing to SchemaExtractor
- [ ] Extract `__notification` metadata from method returns
- [ ] Beam: Store NotificationSubscription per photon
- [ ] Beam: Implement shouldNotify() filtering
- [ ] Beam: Track messageCount per photon per session
- [ ] API: POST /api/beam/clear-message-count
- [ ] Frontend: Display message counts on sidebar
- [ ] Frontend: Update counts on notification
- [ ] Frontend: Clear counts when photon becomes active
- [ ] Docs: @notify-on tag reference for developers
- [ ] Test: Verify filtering works correctly

---

## Integration with Existing Systems

### Works with Active-Photon Optimization
```
state-changed: Only active photon (bandwidth efficient)
notifications: All photons, but FILTERED by subscription (relevant only)
```

### Works with Notification Priorities
```
Critical notifications: auto-switch regardless of subscription
Subscribed notifications: add to message count
Non-subscribed notifications: filtered out silently
```

---

## Summary

**Three-tier notification system:**

1. **Photon declares** what events are important (`@notify-on`)
2. **Server filters** notifications based on subscriptions
3. **Sidebar shows** message counts per photon

Result:
- ✅ No noise (only subscribed notifications sent)
- ✅ Clear priorities (badges show what needs attention)
- ✅ Efficient bandwidth (non-subscribed events filtered server-side)
- ✅ User stays informed (message counts always visible)
