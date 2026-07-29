# Migrating MCP roots, sampling, and logging

MCP `2026-07-28` deprecates roots, sampling, and protocol logging. The
deprecation is annotation-only during the support window: Photon continues to
negotiate and run these features for protocol revisions that contain them.
New Photon code should use the replacement paths below.

Photon will not remove a compatibility feature on a Photon-only calendar.
Removal requires the feature to become eligible under the MCP feature lifecycle,
a separate MCP removal SEP, a newer negotiated protocol revision that omits the
feature, and passing Photon’s 2025 backward-compatibility suite.

## Tasks: use the negotiated 2026 extension

Photon keeps the legacy Tasks vocabulary for MCP 2025 clients. MCP 2026 uses
the separately negotiated `io.modelcontextprotocol/tasks` extension and a
smaller server-directed lifecycle.

For 2026:

1. declare the extension in
   `_meta["io.modelcontextprotocol/clientCapabilities"].extensions` on each
   request;
2. receive a task handle from `tools/call`;
3. poll the handle with `tasks/get`;
4. answer `inputRequests` with `tasks/update`;
5. cancel with `tasks/cancel`.

The legacy task-list and separate task-result operations do not exist in the
2026 extension. Completed output and protocol failure details are inlined in
`tasks/get`.

## Roots: make location an explicit input

`this.roots` remains available when a compatible client negotiates roots, but
roots are informational and are not an authorization boundary. Prefer one of:

- a tool argument when location varies per call;
- a resource URI when the server owns or exposes the content;
- constructor environment/server configuration when location is deployment
  configuration.

Before:

```ts
async index() {
  const workspace = this.roots[0]?.uri;
  return indexDirectory(new URL(workspace).pathname);
}
```

After, with an explicit tool argument:

```ts
async index(params: { directory: string }) {
  return indexDirectory(params.directory);
}
```

After, with a resource URI:

```ts
async index(params: { source: string }) {
  const source = new URL(params.source);
  if (source.protocol !== 'photon:') throw new Error('Unsupported source URI');
  return indexResource(source);
}
```

After, with deployment configuration:

```ts
export default class Search {
  constructor(private readonly workspace: string) {}

  async index() {
    return indexDirectory(this.workspace);
  }
}
```

## Sampling: call a model provider directly

`this.sample()` remains operational for 2025 clients and as Photon’s negotiated
2026 compatibility input path. It is host-dependent and may be unavailable.
For predictable production execution, use Photon’s dependency-free provider
adapters or implement the small `ModelProvider` interface.

OpenAI-compatible example:

```ts
import { OpenAICompatibleProvider, generateText } from '@portel/photon';

const model = new OpenAICompatibleProvider({
  apiKey: () => process.env.OPENAI_API_KEY!,
  model: 'gpt-5-mini',
});

export default class Summarizer {
  async summarize(params: { text: string }) {
    return {
      summary: await generateText(model, {
        prompt: `Summarize in one sentence:\n\n${params.text}`,
        maxTokens: 128,
      }),
    };
  }
}
```

Anthropic example:

```ts
import { AnthropicProvider } from '@portel/photon';

const model = new AnthropicProvider({
  apiKey: () => process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-5',
});

const result = await model.complete({
  systemPrompt: 'Be concise.',
  prompt: 'Summarize this document.',
});
```

Both adapters accept an injected `fetch` implementation, an abort signal,
per-call model overrides, and custom base URLs. API keys are resolved at call
time and are never included in adapter error messages.

## Logging: stderr locally, OpenTelemetry operationally

`logging/setLevel` remains available to MCP 2025 clients. In 2026,
`notifications/message` is request-scoped and Photon emits it only when the
current request includes `_meta["io.modelcontextprotocol/logLevel"]`. Do not
make MCP protocol logging the production telemetry channel.

For stdio servers, write human-readable diagnostics to stderr:

```ts
console.error('Search index loaded'); // safe: stdout remains MCP JSON only
```

For structured logs, traces, and metrics, configure OpenTelemetry:

```bash
bun add @opentelemetry/sdk-node @opentelemetry/api \
  @opentelemetry/exporter-trace-otlp-http
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-photon
photon mcp search
```

Photon validates and bounds inbound `traceparent`, `tracestate`, and `baggage`
before propagation across HTTP, loader, daemon, background-task, and external
MCP boundaries. Baggage is propagated as context but is never expanded into
metric labels.

See [Observability](observability.md) for collector configuration and exported
signals.
