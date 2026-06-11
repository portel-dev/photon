# Protocol Features Guide

Seven protocol features that make your photons discoverable, observable, and interoperable with external agents and UIs.

## MCP Discovery Pagination

Photon exposes large workspaces through the standard MCP list operations:
`tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`, and
`tasks/list`. These methods support MCP cursor pagination.

Clients should treat `nextCursor` as opaque and keep requesting the same method
with `params.cursor` until the response omits `nextCursor`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": { "cursor": "opaque-server-token" }
}
```

Beam does this automatically. Custom MCP clients should do the same so every
tool, resource, template, prompt, and task remains visible in large photon
installations.

List responses also include additive cache metadata:

```json
{
  "tools": [],
  "nextCursor": "opaque-server-token",
  "ttlMs": 30000,
  "cacheScope": "private"
}
```

Older clients can ignore `ttlMs`, `cacheScope`, and `_meta`. Stateless clients
can use them to cache list responses safely without relying on a transport
session.

## Stateless MCP Compatibility

Photon supports both legacy sessionful MCP clients and newer stateless clients.
Legacy clients can keep using `initialize` plus `Mcp-Session-Id`. Stateless
clients should send per-request routing and identity details instead:

```http
Mcp-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: weather.current
X-Photon-App-Session-Id: psess_123
```

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "tools/call",
  "params": {
    "name": "weather.current",
    "arguments": { "city": "Singapore" },
    "_meta": {
      "io.modelcontextprotocol/clientInfo": {
        "name": "ChatGPT",
        "version": "future"
      },
      "photon/appSessionId": "psess_123"
    }
  }
}
```

Photon validates `Mcp-Method` against the JSON-RPC method for stateless
requests. When `Mcp-Name` is present and the request declares a `name` or `uri`,
Photon validates those too. This catches accidental proxy or cache mixups early.

Photon methods can read the normalized request context:

```typescript
export default class Weather {
  async current(params: { city: string }) {
    return {
      city: params.city,
      client: this.client?.clientName,
      protocol: this.client?.protocolVersion,
      appSession: this.request?.appSessionId,
    };
  }
}
```

`this.client` describes the current MCP client and negotiated mode. `this.request`
describes the current turn, including `appSessionId`, `appSessionSource`,
`traceparent`, caller identity, and the legacy transport session ID when one
exists internally. Photon still maintains internal state for subscriptions,
elicitation, sampling, and task routing; app authors should use `appSessionId`
when they need to associate multiple stateless turns from the same client UI.

Clients can discover Photon’s supported protocol versions and extension surface
with `server/discover`.

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

### A2UI v0.9 (declarative UI on AG-UI)

Methods tagged `@format a2ui` emit a valid [A2UI v0.9](https://a2ui.org) JSONL message sequence (`createSurface` → `updateComponents` → `updateDataModel`) derived from the return value. Each message rides as an AG-UI `CUSTOM` event with `name: 'a2ui.message'`, so any AG-UI consumer that also speaks A2UI can render the output without a Photon-specific integration. Google frames this as a "day-zero bridge" — AG-UI is the pipe, A2UI is the payload.

```typescript
/** @format a2ui */
async dashboard() {
  return [
    { title: 'API latency', value: '42ms', trend: '-5%' },
    { title: 'Error rate', value: '0.12%', trend: '+0.01%' },
  ];
}
```

Auto-mapping covers the common shapes (array of rows, single object, card with actions, primitive). For full control, return `{ __a2ui: true, components, data }` and emit the A2UI component tree verbatim. See [formats guide](../formats.md#declarative-ui-a2ui-v09) for the full matrix.

Current version is producer-side only: the runtime emits valid A2UI output but does not yet route `action` messages from the renderer back into photon methods, and does not ship a Beam-side A2UI renderer. Use an external A2UI consumer (web_core, Lit, React) or paste the stream into [A2UI Theater](https://a2ui-composer.ag-ui.com/theater) to render.

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

Human-in-the-loop confirmations that survive page navigation and server restarts. Approvals are stored as JSON files in `~/.photon/state/{photon}/approvals.json`.

```typescript
export default class DeployPipeline {
  /**
   * Deploy a service with persistent approval gate
   * @destructive
   */
  async *deploy(params: { service: string; version: string }) {
    yield { emit: 'status', message: `Preparing ${params.service} v${params.version}...` };

    // Persistent confirmation — survives navigation/restart
    const approved = yield {
      ask: 'confirm',
      message: `Deploy ${params.service} v${params.version} to production?`,
      persistent: true,
      destructive: true,
      expires: '24h',
    };

    if (!approved) {
      return { status: 'cancelled' };
    }

    yield { emit: 'progress', value: 0.5, message: 'Deploying...' };
    yield { emit: 'progress', value: 1.0, message: 'Complete' };

    return { status: 'deployed', service: params.service, version: params.version };
  }
}
```

**Key options:**
- `persistent: true` — approval survives navigation/restart
- `destructive: true` — UI shows red/danger styling
- `expires: '24h'` — auto-expire after duration (supports `m`, `h`, `d`); without it, asks time out after 5 minutes

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
      yield { emit: 'progress', value: i / total, message: `Processing ${params.items[i]}...` };
      // Simulate work
      await new Promise(r => setTimeout(r, 100));
    }

    yield { emit: 'progress', value: 1.0, message: 'All items processed' };

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
bun add @opentelemetry/api
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
