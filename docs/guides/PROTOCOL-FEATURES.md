# Protocol Features Guide

Seven protocol features that make your photons discoverable, observable, and interoperable with external agents and UIs.

## AG-UI Events

AG-UI (Agent-to-UI) maps photon yields to a standard event protocol that external UIs can consume.

**How it works:** The AG-UI adapter wraps your photon's output handler. String yields become `TEXT_MESSAGE` events, progress yields become `STEP` events, and the final return value becomes a `STATE_SNAPSHOT`.

```typescript
export default class MyAgent {
  /**
   * Stream text to AG-UI clients
   */
  async *stream(params: { topic: string }) {
    // String yields → TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT
    yield `Researching ${params.topic}...`;
    yield `Here are the findings on ${params.topic}.`;

    // Progress yields → STEP_STARTED / STEP_FINISHED
    yield { emit: 'progress', value: 0.5, message: 'Analyzing' };
    yield { emit: 'progress', value: 1.0, message: 'Done' };

    // Return value → STATE_SNAPSHOT
    return { topic: params.topic, status: 'complete' };
  }
}
```

**Yield-to-event mapping:**

| Photon yield | AG-UI event |
|---|---|
| `yield "text"` | `TEXT_MESSAGE_CONTENT` |
| `yield { emit: 'progress', value: 0.5 }` | `STEP_STARTED` |
| `yield { emit: 'progress', value: 1.0 }` | `STEP_FINISHED` |
| `yield { channel, event, data }` | `STATE_DELTA` (JSON Patch) |
| `yield { emit: 'render', ... }` | `CUSTOM` event |
| `return { ... }` | `STATE_SNAPSHOT` |

**When to use:** When your photon needs to stream results to CopilotKit, AG-UI-compatible UIs, or other agent frameworks that consume the AG-UI event protocol.

---

## Bidirectional State

Frontend widget state flows into your photon methods automatically. The bridge injects `_clientState` into tool call arguments, and the loader extracts it onto `this._clientState`.

```typescript
export default class ContextAware {
  /**
   * Suggest items based on what the user has selected in the UI
   */
  async suggest(params: { query: string }) {
    // Access frontend widget state
    const state = (this as any)._clientState;

    if (state?.selectedItems?.length > 0) {
      return {
        suggestions: `Based on your ${state.selectedItems.length} selections...`,
        viewMode: state.viewMode || 'list',
      };
    }

    return { suggestions: `General results for "${params.query}"` };
  }
}
```

**Frontend side:**
```javascript
// In your @ui template
window.photon.setWidgetState({ selectedItems: ['a', 'b'], viewMode: 'grid' });
// Next tool call automatically includes this state
```

**When to use:** When photon methods need context from the frontend UI — selected items, current view mode, scroll position, form state, etc.

---

## Persistent Approvals

Human-in-the-loop confirmations that survive page navigation and server restarts. Approvals are stored as JSON files in `~/.photon/approvals/`.

```typescript
import { io } from '@portel/photon-core';

export default class DeployPipeline {
  /**
   * Deploy a service with persistent approval gate
   * @destructive
   */
  async *deploy(params: { service: string; version: string }) {
    yield io.emit.status(`Preparing ${params.service} v${params.version}...`);

    // Persistent confirmation — survives navigation/restart
    const approved: boolean = yield io.ask.confirm(
      `Deploy ${params.service} v${params.version} to production?`,
      {
        persistent: true,
        destructive: true,
        expires: '24h',
      }
    );

    if (!approved) {
      return { status: 'cancelled' };
    }

    yield io.emit.progress(0.5, 'Deploying...');
    yield io.emit.progress(1.0, 'Complete');

    return { status: 'deployed', service: params.service, version: params.version };
  }
}
```

**Key options:**
- `persistent: true` — approval survives navigation/restart
- `destructive: true` — UI shows red/danger styling
- `expires: '24h'` — auto-reject after duration (supports `m`, `h`, `d`)

**When to use:** For destructive operations (deploys, deletions, billing changes) where you need an audit trail and the approval might not happen immediately.

---

## MCP Tasks

Fire-and-forget async operations with progress polling. The client gets a task ID immediately and polls for completion.

```typescript
export default class BackgroundJob {
  /**
   * Process items in the background
   *
   * Designed for tasks/create — returns immediately with task ID,
   * client polls tasks/get for progress.
   */
  async *process(params: { items: string[] }) {
    const total = params.items.length;

    for (let i = 0; i < total; i++) {
      yield io.emit.progress(i / total, `Processing ${params.items[i]}...`);
      // Simulate work
      await new Promise(r => setTimeout(r, 100));
    }

    yield io.emit.progress(1.0, 'All items processed');

    return {
      processed: total,
      results: params.items.map(item => ({ item, status: 'done' })),
    };
  }
}
```

**Task lifecycle:**

```
tasks/create → { taskId }     (client gets ID immediately)
tasks/get    → { state: 'working', progress: 0.5 }
tasks/get    → { state: 'completed', result: {...} }
```

**Task states:** `working` → `completed` | `failed` | `cancelled`

**When to use:** For long-running operations (data processing, report generation, bulk imports) where the client shouldn't block waiting for a response.

---

## Server Cards

Auto-generated metadata at `GET /.well-known/mcp-server` that describes your server's capabilities without requiring an MCP connection.

```typescript
/**
 * Weather Data Service
 *
 * Provides real-time weather data for any location.
 *
 * @version 2.1.0
 * @stateful
 */
export default class Weather {
  /** Get current weather for a city */
  async current(params: { city: string }) { /* ... */ }

  /** Get 5-day forecast */
  async forecast(params: { city: string; days?: number }) { /* ... */ }
}
```

**Generated Server Card:**

```json
{
  "name": "photon-beam",
  "version": "1.9.0",
  "protocol": "mcp",
  "transport": [{ "type": "streamable-http", "url": "http://localhost:3000/mcp" }],
  "capabilities": ["tools"],
  "tools": [
    { "name": "weather/current", "description": "Get current weather for a city" },
    { "name": "weather/forecast", "description": "Get 5-day forecast" }
  ],
  "photons": [{
    "name": "weather",
    "description": "Provides real-time weather data for any location.",
    "methods": ["current", "forecast"],
    "stateful": true
  }]
}
```

No code changes needed — the card is generated from your existing photon metadata.

**When to use:** For MCP server discovery — registries, IDEs, and agent orchestrators can learn about your server without connecting.

---

## A2A Agent Cards

Auto-generated at `GET /.well-known/agent.json`, following Google's A2A (Agent-to-Agent) protocol. Photon methods map to A2A skills, and capabilities are inferred from your tags.

```typescript
/**
 * Data Analysis Agent
 *
 * Analyzes datasets and generates insights.
 *
 * @stateful
 */
export default class Analyst {
  /**
   * Analyze a dataset
   * @param source Data source URL or path
   */
  async analyze(params: { source: string }) { /* ... */ }

  /**
   * Generate a summary report
   * @param format Output format: pdf, html, or markdown
   */
  async report(params: { format: string }) { /* ... */ }
}
```

**Generated Agent Card:**

```json
{
  "name": "analyst",
  "description": "Analyzes datasets and generates insights.",
  "url": "http://localhost:3000",
  "version": "1.0.0",
  "capabilities": [
    { "name": "tool_execution", "description": "Executes tools via MCP protocol" },
    { "name": "stateful", "description": "Maintains state across interactions" },
    { "name": "streaming", "description": "Supports streaming responses via SSE" },
    { "name": "ag-ui", "description": "Supports AG-UI protocol for agent-to-agent UI" }
  ],
  "skills": [
    { "id": "analyst/analyze", "name": "analyst analyze", "description": "Analyze a dataset" },
    { "id": "analyst/report", "name": "analyst report", "description": "Generate a summary report" }
  ]
}
```

**Capability detection:**
- `@stateful` → `stateful` capability
- Methods with tools → `tool_execution`
- SSE transport → `streaming` (always on)
- AG-UI adapter → `ag-ui` (always on in Beam)

**When to use:** When other agents need to discover and invoke your photon's capabilities. Works with Google A2A orchestrators, LangChain agent frameworks, and any A2A-compatible client.

---

## OTel GenAI

Optional observability following CNCF OpenTelemetry GenAI semantic conventions. Install `@opentelemetry/api` and get auto-instrumented spans — zero code changes.

```bash
# Opt-in: install the OTel API
npm install @opentelemetry/api
```

```typescript
import { startToolSpan, isTracingEnabled } from '../src/telemetry/otel.js';

// In your photon or middleware:
const span = startToolSpan('my-photon', 'analyze', { source: 'data.csv' });
try {
  const result = await doWork();
  span.setStatus('OK');
  return result;
} catch (err) {
  span.setStatus('ERROR', err.message);
  throw err;
} finally {
  span.end();
}
```

**What gets traced:**

| Span | Attributes |
|------|-----------|
| `gen_ai.tool.call {photon}.{tool}` | `gen_ai.tool.name`, `gen_ai.agent.name`, `gen_ai.operation.name` |
| `gen_ai.agent.invoke {photon}` | `gen_ai.agent.name`, `gen_ai.operation.name` |

**Zero-cost when disabled:** Without `@opentelemetry/api` installed, all span functions return no-op objects. No performance overhead, no errors.

```typescript
import { isTracingEnabled } from '../src/telemetry/otel.js';

// Check at runtime
if (isTracingEnabled()) {
  console.log('OTel tracing is active');
}
```

**When to use:** When you need production observability — latency tracking, error rates, request tracing across distributed systems. Works with Jaeger, Zipkin, Datadog, Grafana Tempo, and any OTel-compatible backend.
