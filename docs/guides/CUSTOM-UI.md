# Custom UI Development Guide

Build rich interactive UIs for your photons. A global named after your photon file is auto-injected into the iframe — call methods and subscribe to events directly (e.g., `kanban.onTaskMove(cb)`).

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
- [Using Auto UI Renderers (photon.render)](#using-auto-ui-renderers-photonrender)
- [Declarative Templates (.photon.html)](#declarative-templates-photonhtml)
- [TSX Views (.tsx)](#tsx-views-tsx)

---

## Overview

Photon custom UIs run in iframes and communicate with the host (BEAM, Claude Desktop, ChatGPT) via postMessage. The platform bridge automatically injects compatible APIs for:

- **MCP Apps Extension (SEP-1865)** - Standard protocol for MCP UIs
- **ChatGPT Apps SDK** - window.openai compatibility
- **Claude Artifacts** - Theme synchronization

---

## Sandbox Constraints

Photon UIs are loaded into a sandboxed `blob:` iframe so the same HTML works in **every** MCP client (Beam, Claude Desktop, ChatGPT, Cursor, future clients). Portability is the whole point — but the sandbox has real limits that matter if you try to run heavy browser features like client-side AI models, WebRTC, or WebGPU.

### What doesn't work inside the iframe

- **Cross-origin `fetch()`** — the iframe origin is `null`/opaque, so many CDNs reject CORS preflight. Loading model weights from HuggingFace, jsdelivr, unpkg often fails.
- **SharedArrayBuffer / threaded WASM** — requires `Cross-Origin-Isolated`, which needs COOP/COEP headers the host client does not set. Rules out WebLLM and threaded ONNX Runtime.
- **WebGPU, camera, microphone** — gated by Permissions-Policy on the parent iframe; not guaranteed across clients.
- **Dynamic `import()` of remote ESM / `importScripts` over http(s)** — often blocked from `blob:` contexts.
- **Persistent IndexedDB / Cache Storage** — scoped to the opaque origin, so models may re-download each session.

These are **host-imposed** constraints, not photon-runtime bugs. Changing them would either break portability or require every MCP client to adopt COOP/COEP, which is out of our control.

### Choosing a strategy (photon author's call)

If your photon needs capabilities that bump into the sandbox, pick one of these up front:

1. **Run it on the backend (recommended default).** Do the work in a photon method using Node/Bun libraries (`onnxruntime-node`, `@xenova/transformers`, `sharp`, etc.) and return results to the UI. Works in every MCP client, model cached on disk, no sandbox friction. Trade-off: no live webcam/audio stream without round-trips.

2. **Proxy assets through a photon method.** Expose a method that returns model weights / remote resources as bytes. The UI calls it via the injected bridge instead of `fetch()`, sidestepping CORS from `blob:`. Portable, but slower first load.

3. **Inline small assets as data URIs.** For models or datasets under a few MB (face/pose detection, small classifiers, fonts), base64-embed them in the UI HTML. Zero fetches, fully portable, ugly diff.

4. **Accept single-threaded WASM.** Most detection-class models (MediaPipe Tasks, small ONNX via transformers.js) run fine single-threaded inside the sandbox. Slower than WebGPU/threads but fully portable.

5. **Beam-only enhancement.** If and only if a feature genuinely cannot work under the sandbox and is acceptable as a Beam-only feature, document that clearly in the photon's README. Do not design the core experience around it — the photon must still work in other MCP clients.

**Rule of thumb:** if in doubt, do it on the backend. The `@ui` HTML is a renderer, not an application runtime.

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
| BEAM | `{photonName}` global (e.g., `kanban`, `chess`) | Yes |
| BEAM | `photon` low-level bridge | Yes |
| BEAM | `openai` (ChatGPT compat) | Yes |
| ChatGPT | `openai` | Native |
| Claude | postMessage | Native |

---

## Photon Bridge API

Two APIs are injected into your custom UI iframe:

1. **`{photonName}`** (recommended) — A clean global named after your photon file. Call methods and subscribe to events directly: `kanban.taskMove(args)`, `kanban.onTaskMove(cb)`.
2. **`photon`** — The low-level bridge with full control over tool I/O, progress, streaming, elicitation, and state.

No `window.` prefix needed — both are available as bare globals.

### Low-level bridge (`photon`)

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

// Follow-up message
sendFollowUpMessage(message: string): void;

// Event subscriptions (each returns an unsubscribe function)
onProgress(cb: (event: { value: number; message?: string }) => void): () => void;
onStatus(cb: (event: { message: string }) => void): () => void;
onStream(cb: (event: { chunk: string }) => void): () => void;
onEmit(cb: (event: { emit: string; data?: any }) => void): () => void;
onResult(cb: (result: any) => void): () => void;
onError(cb: (error: any) => void): () => void;
onThemeChange(cb: (theme: 'light' | 'dark') => void): () => void;
onToolInputPartial(cb: (partial: any) => void): () => void;
onToolInput(cb: (input: any) => void): () => void;
onElicitation(handler: (event: any) => Promise<any>): () => void;
onTeardown(handler: () => void): () => void;

// Model context update (MCP Apps Extension)
updateModelContext(opts: { content?: string; structuredContent?: any }): Promise<void>;

// Toast notifications (displayed in host UI)
showToast(message: string, type?: 'info' | 'success' | 'warning' | 'error', duration?: number): void;

// Safe area insets (for mobile-aware layouts)
readonly safeAreaInsets: { top: number; bottom: number; left: number; right: number };
```

> **Note:** State restoration uses a DOM event, not the `window.photon` API:
> `window.addEventListener('photon:state-restored', (event) => { /* event.detail contains state */ })`

### Photon global (recommended)

Each photon gets a global named after the `.photon.ts` file. No `window.` prefix needed:

```typescript
// For kanban.photon.ts:
kanban = {
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
// DIRECT WINDOW API (Recommended for real-time sync)
// ═══════════════════════════════════════════════════════════════════════════

// Subscribe to specific events using the direct window API
// Server: this.emit('taskMove', data)
// Client: kanban.onTaskMove(callback)
kanban.onTaskMove((data) => {
  moveTaskInUI(data.taskId, data.column);
});

kanban.onTaskCreate((data) => {
  addTaskToUI(data.task);
});

// Call server methods
await kanban.taskMove({ id: 'task-1', column: 'Done' });

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

// ═══════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

// Show a toast in the host Beam UI (not inside the iframe)
photon.showToast('Changes saved!', 'success');
photon.showToast('Upload failed', 'error', 5000);
photon.showToast('Processing...', 'info', 2000);
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

### Direct Window API (Recommended)

The cleanest way to handle real-time events:

```typescript
// Subscribe to specific events
// Pattern: {photonName}.on{EventName}(callback)
kanban.onTaskMove((data) => {
  moveTaskInUI(data.taskId, data.column);
});

kanban.onTaskCreate((data) => {
  addTaskToUI(data.task);
});

kanban.onBoardUpdate((data) => {
  refreshBoard(data);
});

// Call methods (same pattern)
await kanban.taskMove({ id: 'task-1', column: 'Done' });
```

### Generic Event Subscription

For catching all events:

```typescript
// Listen for ALL events
photon.onEmit((event) => {
  console.log(`Event: ${event.emit}`, event.data);

  switch (event.emit) {
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

## Sharing a UI Across Methods

Multiple methods can share the same HTML template by referencing the same `@ui` asset ID. The first method tagged becomes the primary (used for app detection); all tagged methods render their results in the same UI.

```typescript
/**
 * @ui dashboard ./ui/dashboard.html
 */
export default class Analytics {
  /** @ui dashboard */
  async overview() { return { visits: 1000, bounceRate: 0.3 }; }

  /** @ui dashboard */
  async realtime() { return { activeUsers: 42 }; }

  /** @ui dashboard */
  async funnel({ step }: { step: string }) { return { conversion: 0.12 }; }
}
```

All three methods render inside `dashboard.html`. The UI receives whichever method's result via `onResult` and can distinguish them by shape or by inspecting the data.

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
    // 'my-photon' global is auto-injected (named after your .photon.ts file)
    document.getElementById('action').onclick = async () => {
      const result = await window['my-photon'].myMethod();
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
      onProgress: (cb: (e: any) => void) => () => void;
      onEmit: (cb: (e: { emit: string; data?: any }) => void) => () => void;
      onResult: (cb: (r: any) => void) => () => void;
      onError: (cb: (err: any) => void) => () => void;
      onThemeChange: (cb: (theme: 'light' | 'dark') => void) => () => void;
      theme: 'light' | 'dark';
    };
    // Direct window API (e.g., window.kanban)
    [photonName: string]: any;
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

// Hook for real-time emit events
export function usePhotonEmit(callback: (event: { emit: string; data?: any }) => void) {
  useEffect(() => {
    const unsubscribe = window.photon.onEmit(callback);
    return unsubscribe;
  }, [callback]);
}

function KanbanApp() {
  const [tasks, setTasks] = useState<any[]>([]);

  // Subscribe to real-time events using direct window API
  useEffect(() => {
    const kanban = window.kanban;

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
    await window.kanban.taskMove({ id: taskId, column });
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

## Using Auto UI Renderers (photon.render)

Custom UIs don't have to build everything from scratch. `photon.render()` lets you use the same format renderers that auto UI uses — tables, charts, gauges, badges, and more — inside your own layout.

### Quick Start

```javascript
// 1. Get data from a method
const data = await showcase.cpu();

// 2. Render it using a format
photon.render(document.getElementById('gauge'), data, 'gauge');
```

That's it. The renderer handles theming, formatting, and interactivity automatically.

### API

```typescript
photon.render(container: HTMLElement, data: any, format: string, opts?: object): void
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `container` | `HTMLElement` | DOM element to render into (innerHTML is replaced) |
| `data` | `any` | Data to visualize — shape depends on format |
| `format` | `string` | Format type (see table below) |
| `opts` | `object?` | Optional overrides (columns, min/max, labels, etc.) |

### Available Formats

| Format | Data Shape | Description |
|--------|-----------|-------------|
| `table` | `Array<object>` | Sortable table with auto-detected columns |
| `gauge` | `{ value, max, label?, unit? }` | SVG semicircular gauge with color gradient |
| `metric` | `{ value, label?, delta?, trend? }` | Large KPI display with trend arrow |
| `stat-group` | `Array<{ label, value, delta?, trend?, prefix?, suffix? }>` | Row of KPI stat cards |
| `progress` | `{ value, max?, label? }` | Animated progress bar with percentage |
| `chart:bar` | `Array<object>` | Bar chart (auto-detects label/value fields) |
| `chart:hbar` | `Array<object>` | Horizontal bar chart (same shape as `chart:bar`) |
| `chart:line` | `Array<object>` | Line chart (auto-detects time series) |
| `chart:pie` | `Array<object>` | Pie chart |
| `chart:area` | `Array<object>` | Area chart (line with fill) |
| `chart:donut` | `Array<object>` | Donut chart |
| `chart:radar` | `Array<object>` | Radar chart displaying multivariate data |
| `sparkline` | `Array<number>` | Minimalist inline line chart without axes |
| `ring` | `{ value, max?, label? }` | Circular progress indicator |
| `timeline` | `Array<{ time, event, details? }>` | Chronological event list with dots and lines |
| `alert` | `{ title?, description, variant?, icon? }` | Callout box for important information |
| `badge` | `string` | Colored status badge (auto-detects variant) |
| `list` | `Array<{ name, subtitle?, status? }>` | iOS-style list rows with optional badges |
| `kv` / `card` | `object` | Key-value pairs in alternating rows |
| `steps` / `stepper` | `Array<{ label, status, detail? }>` | Step-by-step progress indicator |
| `kanban` | `{ columns: [{ title, items: [{ title, assignee?, priority? }] }] }` | Kanban board with columns and cards |
| `comparison` | `{ items: [{ name, ...props }], highlight? }` | Side-by-side property comparison |
| `diff` | unified diff string or `{ before, after, filename? }` | Diff viewer with added/removed highlighting |
| `log` | `Array<{ level, message, timestamp?, source? }>` | Structured log viewer with level coloring |
| `embed` | URL string or `{ url, title? }` | Embed an external URL in an iframe |
| `heatmap` | `{ rows, cols, values }` or `[{ rowKey, colKey, value }]` | Color-intensity activity heatmap |
| `calendar` | `Array<{ title, start, end?, allDay?, color? }>` | Monthly/weekly calendar view with events |
| `map` | `Array<{ lat, lng, label?, popup? }>` | Interactive map with markers |
| `network` / `graph` | `{ nodes: [{ id, label, group? }], edges: [{ from, to, label? }] }` | Node-edge graph diagram |
| `cron` | cron string or `{ expression, description? }` | Human-readable cron expression display |
| `image` | URL string, `{ src, caption? }`, or array | Single image or image list with captions |
| `carousel` | `Array<{ src, caption? }>` | Horizontally scrolling image carousel |
| `gallery` | `Array<{ src, caption?, full? }>` | Thumbnail grid with lightbox expand |
| `masonry` | `Array<{ src, caption? }>` | Pinterest-style masonry image grid |
| `hero` | `{ title, subtitle?, image?, cta?, url? }` | Full-width hero section |
| `banner` | `{ message, type?, icon? }` | Dismissable notification banner |
| `empty` / `empty-state` | `{ title?, description?, icon?, action? }` | Centralized empty state placeholder |
| `accordion` | `Array<{ title, content }>` | Collapsible list of items |
| `feed` | `Array<{ user, action, target?, timestamp?, details? }>` | Rich activity stream with avatars and details |
| `tabs` | `Array<{ title, content }>` or `object` | Tabbed navigation panels |
| `tree` | `object` or `Array` | Collapsible JSON-like structural tree viewer |
| `datatable` | `Array<object>` | Interactive table with search, sort, and pagination |
| `quote` | `{ text, author?, source?, avatar? }` | Styled pull-quote with attribution |
| `profile` | `{ name, avatar?, role?, bio?, stats? }` | User profile card with avatar and stats |
| `feature-grid` | `Array<{ icon, title, description }>` | Marketing feature grid |
| `invoice` / `receipt` | `{ items: [{ description, quantity, rate, amount }], total, ... }` | Itemized invoice with totals |
| `markdown` | `string` | Basic markdown rendering (headings, bold, code, lists) |
| `code` | `string` | Syntax-highlighted code (keywords, strings, numbers, comments) |
| `json` | `any` | Pretty-printed JSON in a `<pre>` block |

### Data Shape Examples

```javascript
// Gauge — value within a range
photon.render(el, { value: 73, max: 100, label: 'CPU Usage', unit: '%' }, 'gauge');

// Metric — big number with trend
photon.render(el, { value: 14283, label: 'Active Users', delta: 842, trend: 'up' }, 'metric');

// Table — array of objects (columns auto-detected from keys)
photon.render(el, [
  { name: 'Alice', role: 'Admin', status: 'Active' },
  { name: 'Bob',   role: 'Editor', status: 'Offline' },
], 'table');

// Chart — array with string + numeric fields
photon.render(el, [
  { month: 'Jan', revenue: 12400, costs: 8200 },
  { month: 'Feb', revenue: 15800, costs: 9100 },
], 'chart:bar');

// Badge — auto-detects color from text
photon.render(el, 'Active', 'badge');    // green
photon.render(el, 'Degraded', 'badge');  // yellow
photon.render(el, 'Offline', 'badge');   // red

// Timeline — chronological events
photon.render(el, [
  { time: '2026-03-18T08:00:00Z', event: 'Deploy started', details: 'v2.4.1' },
  { time: '2026-03-18T08:05:00Z', event: 'Deploy live', details: 'All regions healthy' },
], 'timeline');
```

### Options

Some renderers accept options to override auto-detection:

```javascript
// Table — specify which columns to show
photon.render(el, data, 'table', { columns: ['name', 'status'] });

// Gauge — override min/max range
photon.render(el, { value: 4.2 }, 'gauge', { min: 0, max: 16, label: 'Memory', unit: 'GB' });

// Chart — specify axis fields
photon.render(el, data, 'chart:line', { x: 'timestamp', y: 'temperature' });
```

### Full Dashboard Pattern

The typical pattern combines `window[photonName]` for data and `photon.render()` for visualization:

```html
<div id="cpu-gauge"></div>
<div id="users-table"></div>

<script>
  // Reference your photon by name
  const monitor = window['system-monitor'];

  // Load data and render
  async function refresh() {
    const cpu = await monitor.cpu();
    photon.render(document.getElementById('cpu-gauge'), cpu, 'gauge');

    const users = await monitor.users();
    photon.render(document.getElementById('users-table'), users, 'table');
  }

  refresh();

  // Live updates via events
  monitor.onCpuUpdate((data) => {
    photon.render(document.getElementById('cpu-gauge'), data, 'gauge');
  });
</script>
```

### Theme Awareness

Renderers auto-detect dark/light mode from the host theme. Colors, borders, and text adjust automatically — no extra configuration needed.

### Lazy Loading

`photon.render()` lazy-loads the renderer library on first call. Chart formats further lazy-load Chart.js from CDN. The initial call may have a brief delay; subsequent calls are instant.

### Example Photon

See [render-showcase.photon.ts](https://github.com/portel-dev/photon-examples/blob/main/render-showcase.photon.ts) for a complete working example with all 11 format types rendered in a custom dashboard.

---

## Declarative Templates (.photon.html)

For UIs that display method results, you can skip JavaScript entirely. Use the `.photon.html` file extension to opt into **declarative mode** — inspired by [Datastar](https://data-star.dev/)'s SSE-first hypermedia approach, but with metadata-driven auto-inference.

Where Datastar uses explicit `@get('/url')` actions, photon auto-resolves method metadata from your docblock tags — format, reactivity, and refresh are inferred automatically.

### Two Modes

| Extension | Mode | What happens |
|-----------|------|-------------|
| `dashboard.html` | **Full control** | Bridge injected, you write all JavaScript |
| `dashboard.photon.html` | **Declarative** | Auto-wrapped with base CSS, data attributes bind to methods |
| `dashboard.tsx` | **Component** | TSX compiled with built-in JSX runtime, bundled into HTML |
| `dashboard.photon.tsx` | **Declarative + TSX** | Declarative mode with TSX components |

Priority: `.photon.html` > `.photon.tsx` > `.html` > `.tsx`

### Quick Start

```html
<!-- ~/.photon/my-app/ui/dashboard.photon.html -->
<h1>System Monitor</h1>
<div data-method="cpu"></div>
<div data-method="memory"></div>
<div data-method="requests"></div>
```

That's it — no `<html>`, no `<head>`, no `<script>`. The runtime wraps the fragment with base styles, injects the bridge, and binds elements automatically. Each `data-method` element auto-resolves:

- **Format** from the method's `@format` tag (table, gauge, chart:bar, etc.)
- **Live updates** from `@stateful` on the class
- **Refresh interval** from `@scheduled` / `@cron` on the method
- **Trigger** from element type (buttons → click, divs → load)

### How It Works

Given a photon like this:

```typescript
/**
 * @stateful
 */
export default class Monitor {
  /** @format gauge */
  async cpu() { return { value: 73, max: 100, label: 'CPU', unit: '%' }; }

  /** @format table */
  async requests() { return [{ path: '/api', count: 1420 }]; }

  /** @scheduled "*/5 * * * *" */
  async health() { return { status: 'healthy', uptime: '14d' }; }

  async restart() { return { message: 'Restarted successfully' }; }
}
```

The declarative template only needs `data-method`:

```html
<div data-method="cpu"></div>          <!-- gauge (from @format), live (from @stateful) -->
<div data-method="requests"></div>     <!-- table (from @format), live (from @stateful) -->
<div data-method="health"></div>       <!-- polls every 60s (from @scheduled) -->
<button data-method="restart" data-target="#status">Restart</button>  <!-- click trigger (button) -->
<span id="status"></span>
```

### The `data-method` Attribute

`data-method` is the only required attribute. It specifies which photon method to call. Everything else is auto-inferred from metadata or element type:

| What | Auto-inferred from | Manual override |
|------|-------------------|-----------------|
| **Format** | `@format` tag on the method | `data-format="gauge"` |
| **Live updates** | `@stateful` tag on the class | `data-live` |
| **Refresh** | `@scheduled` / `@cron` tag | `data-refresh="5s"` |
| **Trigger** | Element type: `<button>` → click, `<div>` → load | `data-trigger="click"` |

### Optional Override Attributes

Use these only when you need to deviate from the method's metadata:

| Attribute | Purpose | Default |
|-----------|---------|---------|
| `data-method` | Which method to call | *(required)* |
| `data-format` | Override format renderer | From `@format` tag |
| `data-target` | CSS selector — where to render the result | Self |
| `data-swap` | How to replace content | `innerHTML` |
| `data-trigger` | When to fire the method call | Auto: button→click, div→load |
| `data-args` | JSON parameters to pass | `{}` |
| `data-field` | Extract a nested field from the result | — |
| `data-live` | Force live mode | Auto from `@stateful` |
| `data-refresh` | Force polling interval | Auto from `@scheduled` |

#### Swap Modes

The `data-swap` attribute controls how results replace content (same as [htmx swap](https://htmx.org/docs/#swapping)):

| Value | Behavior |
|-------|----------|
| `innerHTML` | Replace inner content of target *(default)* |
| `outerHTML` | Replace the entire target element |
| `beforebegin` | Insert before the target element |
| `afterbegin` | Insert at the start of the target |
| `beforeend` | Append to the end of the target |
| `afterend` | Insert after the target element |

### Examples

**Minimal — just the method name:**
```html
<div data-method="cpu"></div>
```

**Button triggers a method, result renders elsewhere:**
```html
<button data-method="restart" data-target="#output">Restart Server</button>
<div id="output"></div>
```

**Extract a specific field:**
```html
<span data-method="stats" data-field="users.active"></span>
```

**Override format for a different visualization:**
```html
<div data-method="requests" data-format="chart:bar"></div>
```

**Append results to a log:**
```html
<button data-method="generate" data-target="#log" data-swap="beforeend">Generate</button>
<div id="log"></div>
```

**Pass arguments:**
```html
<button data-method="deploy" data-args='{"env":"production"}' data-target="#status">
  Deploy to Production
</button>
<span id="status"></span>
```

### Full Dashboard Example

```html
<!-- monitor/ui/dashboard.photon.html -->
<style>
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .full { grid-column: 1 / -1; }
</style>

<h1>System Dashboard</h1>

<div class="grid">
  <div data-method="cpu"></div>
  <div data-method="memory"></div>
  <div class="full" data-method="requests"></div>
</div>

<h2>Actions</h2>
<button data-method="restart" data-target="#action-result">Restart</button>
<button data-method="clearCache" data-target="#action-result">Clear Cache</button>
<div id="action-result"></div>
```

No JavaScript. The gauge renders because `cpu()` has `@format gauge`. The table renders because `requests()` has `@format table`. Live updates flow because the class is `@stateful`. Buttons trigger on click because they're `<button>` elements.

### Loading State

Elements automatically get the `photon-loading` CSS class while a method call is in flight. Style it for visual feedback:

```css
.photon-loading {
  opacity: 0.6;
  pointer-events: none;
}
```

### When to Use Each Mode

- **`.photon.html`** — Dashboards, status displays, simple data views, action buttons. No JavaScript needed.
- **`.html`** — Interactive UIs, custom event handling, complex layouts.
- **`.tsx`** — Component-based UIs with TypeScript, composition, and imports. Best for complex views.

---

## TSX Views (.tsx)

Write view files as TSX components. A built-in JSX runtime (~1KB) maps `h()` calls directly to DOM elements — no React, no Preact, no virtual DOM.

### Quick Start

```
my-app/
  my-app.photon.ts
  my-app/
    ui/
      dashboard.tsx      # ← TSX view
```

```tsx
// my-app/ui/dashboard.tsx

function Card({ title, value }: { title: string; value: number }) {
  return (
    <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--color-surface, #1e1e2e)' }}>
      <div style={{ fontSize: '13px', color: 'var(--color-muted, #888)' }}>{title}</div>
      <div style={{ fontSize: '28px', fontWeight: 'bold' }}>{value.toLocaleString()}</div>
    </div>
  );
}

function Dashboard({ items }: { items: Array<{ title: string; value: number }> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', padding: '24px' }}>
      {items.map(item => <Card title={item.title} value={item.value} />)}
    </div>
  );
}

// Mount to the auto-provided #root div
render(<Dashboard items={[{ title: 'Users', value: 42 }]} />, '#root');
```

Link it in your photon:

```ts
/**
 * @ui dashboard ./ui/dashboard.tsx
 */
export default class MyApp {
  /** @ui dashboard */
  async dashboard() {
    return { items: [{ title: 'Users', value: 42 }] };
  }
}
```

### Built-in JSX Runtime

Available globally in every TSX view (no imports needed):

| Function | Description |
|----------|-------------|
| `h(type, props, ...children)` | JSX factory — returns real DOM nodes |
| `Fragment` | Document fragment for `<>...</>` syntax |
| `render(element, container)` | Mount element to a container (selector string or DOM node) |

Supports: `className`, `htmlFor`, `style` objects, `onClick`/`on*` event handlers, `dangerouslySetInnerHTML`, boolean attributes.

### Using React or Preact Instead

Add a `tsconfig.json` in your `ui/` folder to override the built-in runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```

Then install the framework in your photon's directory (`npm i preact`). The TSX compiler will use it instead of the built-in runtime.

### Bridge Integration

TSX views run in the same iframe sandbox as HTML views. The photon bridge is injected automatically:

```tsx
// Listen for tool results from the bridge
window.addEventListener('message', (event) => {
  if (event.data?.method === 'ui/notifications/tool-result') {
    const data = event.data.params.result;
    render(<Dashboard items={data.items} />, '#root');
  }
});
```

### How It Works

TSX files are compiled on-demand via esbuild when first requested (not at startup). The result is cached by file mtime, so edits are picked up on the next request. The compiled output is a self-contained HTML document with all imports bundled inline — no external dependencies at runtime.

---

## Auto-Form Input Widgets

When a photon method has `@param` tags, Beam renders an auto-form so users can fill in values before invoking the tool. The `{@format}` inline tag controls which input widget appears for each field.

### Enhanced Basic Inputs

These are auto-detected from the parameter **name** or set explicitly with `{@format}`.

| Format | Widget | Auto-detected names |
|--------|--------|---------------------|
| `password` / `secret` | Masked text + show/hide eye toggle | `password`, `secret`, `token`, `apikey` |
| `email` | `type="email"` | `email` |
| `url` | `type="url"` + live "open link" button | `url`, `website`, `homepage` |
| `phone` / `tel` | `type="tel"` | `phone`, `tel`, `mobile` |
| `color` | Color swatch + hex input side by side | `color`, `colour` |
| `search` | `type="search"` | `search`, `query`, `q` |

### Rich Input Components

These require explicit `{@format}` in the `@param` docblock.

| Format | Widget |
|--------|--------|
| `tags` | Chip/pill input — Enter or comma adds a chip, Backspace removes last, deduplicates. Also auto-detected for `string[]` params. |
| `rating` | 1–5 star picker with hover preview. Pair with `{@multipleOf 0.5}` for half-stars. Auto-detected: `rating`, `stars`. |
| `segmented` | Horizontal pill bar for enum params (2–4 choices). Pair with `{@choice a,b,c}`. |
| `radio` | Vertical radio buttons for enum params. Pair with `{@choice a,b,c}`. |
| `code` / `code:lang` | Code editor — line numbers, tab-indent (2 spaces), char/line count. Append language: `code:typescript`, `code:python`, `code:css`. |
| `markdown` | Split-pane editor with toolbar (Bold, Italic, Code, Link, Heading, List, Quote), Write/Split/Preview modes, word count. |

### Date & Time Pickers

Custom calendar replaces the native browser date input. Supports typed input (`"2026-03-20"`, `"Mar 20 2026"`, `"03/20/2026"`), Today and Clear buttons, and a 3-layer drill-down: click month name → month grid, click year → year grid with decade paging.

**Smart positioning:** params named `birthday` / `dob` open the year picker ~25 years back. Params named `expiry` / `expires` start 2 years forward.

| Format | Widget |
|--------|--------|
| `date` | Calendar date picker |
| `date-time` | Calendar + hour:minute inputs |
| `time` | Time text input |
| `date-range` | Two date pickers side by side |
| `datetime-range` | Two date-time pickers side by side |

### Example

```typescript
/**
 * Register a new user
 * @param name Full name
 * @param email Email address {@format email}
 * @param password Account password {@format password}
 * @param birthday Date of birth {@format date}
 * @param phone Phone number {@format phone}
 * @param website Personal website {@format url}
 * @param color Preferred color {@format color}
 * @param tags Interest tags {@format tags}
 * @param rating Experience level (1-5) {@format rating}
 * @param role User role {@choice admin,user,guest} {@format segmented}
 * @param bio About yourself {@format markdown}
 * @param code Custom CSS {@format code:css}
 */
async register(params: { ... }): Promise<User> { ... }
```

For the complete list of formats and their validation behavior, see [DOCBLOCK-TAGS.md](../reference/DOCBLOCK-TAGS.md#input-widget-formats).

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

- [GUIDE.md](../GUIDE.md) - Full development guide
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deploy your photon
- [SECURITY.md](../../SECURITY.md) - Security best practices
