# Custom UI Development Guide

Build rich interactive UIs for your photons using the window.photon API.

---

## Table of Contents

- [Overview](#overview)
- [MCP Apps Extension (SEP-1865)](#mcp-apps-extension-sep-1865)
- [Platform Compatibility](#platform-compatibility)
- [Window.photon API](#windowphoton-api)
- [Theming](#theming)
- [State Management](#state-management)
- [Tool Invocation](#tool-invocation)
- [Real-time Updates](#real-time-updates)
- [Examples](#examples)

---

## Overview

Photon custom UIs run in iframes and communicate with the host (BEAM, Claude Desktop, ChatGPT) via postMessage. The platform bridge automatically injects compatible APIs for:

- **MCP Apps Extension (SEP-1865)** - Standard protocol for MCP UIs
- **ChatGPT Apps SDK** - window.openai compatibility
- **Claude Artifacts** - Theme synchronization

---

## MCP Apps Extension (SEP-1865)

The [MCP Apps Extension](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/1865) defines a standard protocol for rendering UIs in MCP-compatible clients.

### Initialization

When your UI loads, it receives a `ui/initialize` message:

```json
{
  "jsonrpc": "2.0",
  "method": "ui/initialize",
  "params": {
    "hostContext": {
      "name": "beam",
      "version": "1.5.0"
    },
    "hostCapabilities": {
      "toolCalling": true,
      "resourceReading": true,
      "elicitation": true
    },
    "containerDimensions": {
      "mode": "responsive",
      "width": 800,
      "height": 600
    },
    "theme": {
      "--color-bg": "#0d0d0d",
      "--color-text": "#e6e6e6"
    }
  }
}
```

### Ready Signal

Your UI must signal readiness:

```javascript
window.parent.postMessage({
  jsonrpc: '2.0',
  method: 'ui/ready',
  params: {}
}, '*');
```

---

## Platform Compatibility

BEAM injects APIs for multiple platforms, so your UI works everywhere:

| Platform | API | Auto-Injected |
|----------|-----|---------------|
| BEAM | window.photon | Yes |
| BEAM | window.openai | Yes |
| BEAM | window.mcp | Yes |
| ChatGPT | window.openai | Native |
| Claude | postMessage | Native |

---

## Window.photon API

The primary API for custom UIs in BEAM.

### Properties

```typescript
interface PhotonAPI {
  // Tool input/output
  readonly toolInput: Record<string, any>;   // Input parameters
  readonly toolOutput: any;                   // Last result
  readonly widgetState: any;                  // Persisted state

  // Context
  readonly theme: 'light' | 'dark';
  readonly locale: string;
  readonly photon: string;                    // Photon name
  readonly method: string;                    // Current method
  readonly isChatGPT: boolean;                // Running in ChatGPT?
}
```

### Methods

```typescript
// State persistence (survives page reload)
setWidgetState(state: any): void;

// Tool invocation
callTool(name: string, args: Record<string, any>): Promise<any>;
invoke(name: string, args: Record<string, any>): Promise<any>; // Alias

// Generic event subscription (returns unsubscribe function)
on(eventName: string, callback: (data: any) => void): () => void;

// Follow-up message
sendFollowUpMessage(message: string): void;
```

### Mirrored Class API

Each photon gets a mirrored object at `window.photon.{photonName}`:

```typescript
// For a photon named "kanban":
window.photon.kanban = {
  // onEventName → subscribes to 'eventName'
  onTaskMove(cb): () => void,    // subscribes to 'taskMove' event
  onTaskCreate(cb): () => void,  // subscribes to 'taskCreate' event
  // ... any event name works (convention: on + PascalCase)

  // methodName → calls server tool
  taskMove(args): Promise<any>,   // calls photon.callTool('taskMove', args)
  taskCreate(args): Promise<any>, // calls photon.callTool('taskCreate', args)
  // ... any method name works
};
```

**Usage pattern:**
```javascript
// Server code:                    // Client code:
this.emit('taskMove', data);   →   kanban.onTaskMove(cb)
taskMove(params) { ... }       →   kanban.taskMove(params)
```

### Event Subscriptions

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// MIRRORED CLASS API (Recommended for real-time sync)
// ═══════════════════════════════════════════════════════════════════════════

// Subscribe to specific events using the mirrored API
// Server: this.emit('taskMove', data)
// Client: photon.kanban.onTaskMove(callback)
photon.kanban.onTaskMove((data) => {
  moveTaskInUI(data.taskId, data.column);
});

photon.kanban.onTaskCreate((data) => {
  addTaskToUI(data.task);
});

// Call server methods
await photon.kanban.taskMove({ id: 'task-1', column: 'Done' });

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC EVENT SUBSCRIPTION
// ═══════════════════════════════════════════════════════════════════════════

// Subscribe to any event by name
const unsubscribe = photon.on('taskMove', (data) => {
  console.log('Task moved:', data);
});

// Cleanup when done
unsubscribe();

// ═══════════════════════════════════════════════════════════════════════════
// BUILT-IN EVENT TYPES
// ═══════════════════════════════════════════════════════════════════════════

// Progress updates (0-1 value)
photon.onProgress((event) => {
  console.log(`${event.value * 100}%: ${event.message}`);
});

// Status messages
photon.onStatus((event) => {
  console.log(`Status: ${event.message}`);
});

// Stream data
photon.onStream((event) => {
  console.log(`Chunk: ${event.chunk}`);
});

// All emit events (includes custom events)
photon.onEmit((event) => {
  console.log(`Event: ${event.event}`, event.data);
});

// Final result
photon.onResult((result) => {
  console.log('Complete:', result);
});

// Theme changes
photon.onThemeChange((theme) => {
  document.body.className = theme;
});
```

---

## Theming

### CSS Variables

The host injects CSS variables for consistent theming:

```css
:root {
  /* Background */
  --color-bg: #0d0d0d;
  --color-bg-elevated: #1a1a1a;
  --color-bg-subtle: #262626;

  /* Text */
  --color-text: #e6e6e6;
  --color-text-muted: #999999;
  --color-text-subtle: #666666;

  /* Accent */
  --color-accent: #6366f1;
  --color-accent-hover: #818cf8;

  /* Status */
  --color-success: #22c55e;
  --color-warning: #eab308;
  --color-error: #ef4444;

  /* Borders */
  --color-border: #333333;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
}
```

### Theme Detection

```typescript
// Listen for theme changes
photon.onThemeChange((theme) => {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
});

// Or use CSS
@media (prefers-color-scheme: dark) {
  :root { /* dark theme */ }
}

@media (prefers-color-scheme: light) {
  :root { /* light theme */ }
}
```

---

## State Management

### Persisted Widget State

State persists across page reloads and sessions:

```typescript
// Save state
photon.setWidgetState({
  selectedTab: 'settings',
  filters: ['active', 'pending']
});

// Read current state
const state = photon.widgetState;

// Listen for state restoration
window.addEventListener('photon:state-restored', (event) => {
  const state = event.detail;
  renderWithState(state);
});
```

### Tool Input

Access parameters passed to the tool:

```typescript
// Read input
const { query, limit } = photon.toolInput;

// Use in UI
document.getElementById('search').value = query || '';
```

---

## Tool Invocation

### Basic Call

```typescript
try {
  const result = await photon.callTool('search', {
    query: 'typescript',
    limit: 10
  });
  console.log('Results:', result);
} catch (error) {
  console.error('Tool failed:', error.message);
}
```

### With Loading State

```typescript
const searchBtn = document.getElementById('search-btn');

searchBtn.onclick = async () => {
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';

  try {
    const results = await photon.callTool('search', {
      query: document.getElementById('query').value
    });
    renderResults(results);
  } catch (error) {
    showError(error.message);
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
};
```

---

## Real-time Updates

### Cross-Client Sync

Photon enables real-time sync between Beam, Claude Desktop, and any MCP Apps-compatible client using standard MCP protocol.

**How it works:**
1. Server emits: `this.emit('taskMove', data)`
2. Photon sends standard `ui/notifications/host-context-changed` with embedded `_photon` data
3. Claude Desktop (and other hosts) forward this standard notification
4. Photon bridge extracts `_photon` and routes to your event handlers

### Mirrored API (Recommended)

The cleanest way to handle real-time events:

```typescript
// Subscribe to specific events
// Pattern: photon.{photonName}.on{EventName}(callback)
photon.kanban.onTaskMove((data) => {
  moveTaskInUI(data.taskId, data.column);
});

photon.kanban.onTaskCreate((data) => {
  addTaskToUI(data.task);
});

photon.kanban.onBoardUpdate((data) => {
  refreshBoard(data);
});

// Call methods (same pattern)
await photon.kanban.taskMove({ id: 'task-1', column: 'Done' });
```

### Generic Event Subscription

For dynamic event names or catching all events:

```typescript
// Subscribe to any event by name
photon.on('taskMove', (data) => {
  handleTaskMove(data);
});

// Listen for ALL events
photon.onEmit((event) => {
  console.log(`Event: ${event.event}`, event.data);

  switch (event.event) {
    case 'taskMove':
      moveTaskInUI(event.data.taskId, event.data.column);
      break;
    case 'taskCreate':
      addTaskToUI(event.data.task);
      break;
  }
});
```

### Notify Viewing (for subscription management)

Tell the host what resource you're viewing (enables ref-counted subscriptions):

```typescript
window.parent.postMessage({
  type: 'photon:viewing',
  itemId: 'my-board'
}, '*');
```

### Progress Visualization

```html
<div class="progress-bar">
  <div class="progress-fill" id="progress"></div>
  <span class="progress-text" id="progress-text">0%</span>
</div>

<script>
photon.onProgress((event) => {
  const pct = Math.round(event.value * 100);
  document.getElementById('progress').style.width = pct + '%';
  document.getElementById('progress-text').textContent =
    event.message || `${pct}%`;
});
</script>
```

---

## Examples

### Minimal Custom UI

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: system-ui;
      background: var(--color-bg, #0d0d0d);
      color: var(--color-text, #e6e6e6);
      padding: 20px;
    }
    button {
      background: var(--color-accent, #6366f1);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>My Custom UI</h1>
  <button id="action">Run Tool</button>
  <pre id="result"></pre>

  <script>
    document.getElementById('action').onclick = async () => {
      const result = await window.photon.callTool('myMethod', {});
      document.getElementById('result').textContent =
        JSON.stringify(result, null, 2);
    };
  </script>
</body>
</html>
```

### React Integration

```tsx
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    photon: {
      toolInput: Record<string, any>;
      widgetState: any;
      setWidgetState: (state: any) => void;
      callTool: (name: string, args: any) => Promise<any>;
      on: (event: string, cb: (data: any) => void) => () => void;
      onProgress: (cb: (e: any) => void) => () => void;
      onResult: (cb: (r: any) => void) => () => void;
      theme: 'light' | 'dark';
      // Mirrored API (dynamic per photon)
      [photonName: string]: any;
    };
  }
}

export function usePhoton() {
  const [input] = useState(() => window.photon.toolInput);
  const [state, setState] = useState(() => window.photon.widgetState || {});
  const [theme] = useState(() => window.photon.theme);

  const updateState = (newState: any) => {
    setState(newState);
    window.photon.setWidgetState(newState);
  };

  return { input, state, updateState, theme, callTool: window.photon.callTool };
}

// Hook for real-time event subscription
export function usePhotonEvent(eventName: string, callback: (data: any) => void) {
  useEffect(() => {
    const unsubscribe = window.photon.on(eventName, callback);
    return unsubscribe;
  }, [eventName, callback]);
}

function KanbanApp() {
  const [tasks, setTasks] = useState<any[]>([]);

  // Subscribe to real-time events using mirrored API
  useEffect(() => {
    const kanban = window.photon.kanban;

    const unsub1 = kanban.onTaskMove((data: any) => {
      setTasks(prev => prev.map(t =>
        t.id === data.taskId ? { ...t, column: data.column } : t
      ));
    });

    const unsub2 = kanban.onTaskCreate((data: any) => {
      setTasks(prev => [...prev, data.task]);
    });

    return () => { unsub1(); unsub2(); };
  }, []);

  const moveTask = async (taskId: string, column: string) => {
    await window.photon.kanban.taskMove({ id: taskId, column });
  };

  return (
    <div>
      {tasks.map(task => (
        <div key={task.id}>
          {task.title} ({task.column})
          <button onClick={() => moveTask(task.id, 'Done')}>Done</button>
        </div>
      ))}
    </div>
  );
}
```

---

## ChatGPT Apps SDK Compatibility

BEAM implements the ChatGPT Apps SDK for compatibility:

```typescript
// These work in BEAM just like ChatGPT
window.openai.theme;          // 'light' | 'dark'
window.openai.toolInput;      // Tool parameters
window.openai.callTool(name, args);  // Invoke tool
window.openai.setWidgetState(state); // Persist state
window.openai.uploadFile(file);      // Upload file
window.openai.getFileDownloadUrl({ fileId }); // Get file URL
window.openai.requestModal({ template, params }); // Show modal
window.openai.openExternal({ href }); // Open link
```

---

## Next Steps

- [GUIDE.md](GUIDE.md) - Full development guide
- [DEPLOYMENT.md](DEPLOYMENT.md) - Deploy your photon
- [SECURITY.md](SECURITY.md) - Security best practices
