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

// Follow-up message
sendFollowUpMessage(message: string): void;
```

### Event Subscriptions

```typescript
// Progress updates (0-1 value)
const unsubscribe = photon.onProgress((event) => {
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

// All emit events
photon.onEmit((event) => {
  console.log(`Event: ${event.emit}`, event);
});

// Final result
photon.onResult((result) => {
  console.log('Complete:', result);
});

// Errors
photon.onError((error) => {
  console.error('Error:', error.message);
});

// Theme changes
photon.onThemeChange((theme) => {
  document.body.className = theme;
});

// Elicitation (ask for user input)
photon.onElicitation((ask) => {
  // Return promise with user's response
  return prompt(ask.message);
});

// Cleanup on unmount
unsubscribe();
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

### Subscribing to Channels

For photons that emit real-time updates:

```typescript
// Notify host what resource we're viewing
window.parent.postMessage({
  type: 'photon:viewing',
  itemId: 'my-board'
}, '*');

// Listen for updates
photon.onEmit((event) => {
  if (event.emit === 'task-created') {
    addTaskToUI(event.task);
  } else if (event.emit === 'task-moved') {
    moveTaskInUI(event.taskId, event.column);
  }
});
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
      onProgress: (cb: (e: any) => void) => () => void;
      onResult: (cb: (r: any) => void) => () => void;
      theme: 'light' | 'dark';
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

function App() {
  const { input, state, updateState, callTool } = usePhoton();
  const [results, setResults] = useState(null);

  const handleSearch = async () => {
    const data = await callTool('search', { query: input.query });
    setResults(data);
  };

  return (
    <div>
      <button onClick={handleSearch}>Search</button>
      {results && <pre>{JSON.stringify(results, null, 2)}</pre>}
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
