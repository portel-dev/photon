# Observability

Photon ships with OpenTelemetry instrumentation baked in — traces, metrics,
and logs are emitted automatically during every tool call. By default the
instrumentation is a no-op. Set one environment variable and install the
OTel SDK to route everything to any OTLP-compatible backend
(Jaeger, Grafana Tempo, SigNoz, Honeycomb, DataDog, …).

## Quick start

```bash
# 1. Install the OTel SDK as a peer dep of your deployment
npm install @opentelemetry/sdk-node @opentelemetry/api \
            @opentelemetry/exporter-trace-otlp-http \
            @opentelemetry/exporter-metrics-otlp-http \
            @opentelemetry/exporter-logs-otlp-http \
            @opentelemetry/resources \
            @opentelemetry/semantic-conventions

# 2. Point at a collector
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_SERVICE_NAME=my-photon-service

# 3. Run anything — CLI, MCP server, Beam — they all export now
photon cli kanban stats
photon beam
photon mcp my-photon
```

That is the entire setup. Photon's CLI entry point calls `initOtelSdk()`
before any command runs, so the SDK is live before the first span is
created.

## What gets exported

### Traces

| Span | Attributes |
|------|------------|
| `gen_ai.tool.call {photon}.{tool}` | `gen_ai.tool.name`, `gen_ai.agent.name`, `gen_ai.operation.name`, `photon.instance`, `photon.caller`, `photon.trace_id`, `photon.stateful` |
| `gen_ai.agent.invoke {photon}` | `gen_ai.agent.name`, `gen_ai.operation.name`, `gen_ai.agent.description` |

- Error spans auto-set `sampling.priority=1` so they survive head-based sampling.
- `recordException` captures the full stack trace via `Error.cause`.
- `_meta.traceparent` on a tool call makes the new span a child of the
  incoming W3C context — distributed traces chain automatically.
- Nested `this.call()` propagates trace context via `_meta.traceparent`,
  so multi-photon workflows show up as one connected trace.

### Metrics

| Instrument | Type | Unit | Attributes |
|------------|------|------|------------|
| `photon.tool.duration` | histogram | ms | `gen_ai.agent.name`, `gen_ai.tool.name`, `status`, `photon.stateful`, `photon.error_type` |
| `photon.tool.calls` | counter | 1 | same |
| `photon.tool.errors` | counter | 1 | same |
| `photon.circuit_breaker.transitions` | counter | 1 | `gen_ai.agent.name`, `gen_ai.tool.name`, `from`, `to`, `photon.instance` |
| `photon.rate_limit.rejections` | counter | 1 | `gen_ai.agent.name`, `gen_ai.tool.name`, `photon.instance` |

### Structured error responses

When a tool call fails, the MCP response sets `isError: true` and attaches
a machine-readable payload so agents can make typed retry decisions:

```json
{
  "content": [{ "type": "text", "text": "Tool Error: add ..." }],
  "isError": true,
  "structuredContent": {
    "error": {
      "type": "circuit_open",
      "retryable": true,
      "message": "Circuit open: add has failed 5 consecutive times. Resets in 12s"
    }
  },
  "_meta": { "photon": { "type": "...", "retryable": true, "message": "..." } }
}
```

Error `type` values: `validation_error`, `timeout_error`, `network_error`,
`permission_error`, `not_found_error`, `circuit_open`, `rate_limited`,
`implementation_error`, `runtime_error`. `retryable` is `true` for transient failures
(circuit_open, timeout, network) and `false` for deterministic ones
(validation, permission, not_found).

### Logs

Every record emitted by the photon `Logger` is forwarded to the OTel logs
bridge with severity mapped to the standard scale and ambient context
auto-attached: `photon.name`, `photon.tool`, `photon.trace_id`,
`photon.caller_id`. This gives trace-log correlation in any OTLP backend
without a pino dependency.

## Running a local collector

For development, the easiest stack is Grafana's OTel-LGTM image — it
includes Tempo (traces), Mimir (metrics), and Loki (logs) behind a single
Grafana pane:

```bash
docker run -p 3000:3000 -p 4317:4317 -p 4318:4318 \
  --rm -ti grafana/otel-lgtm
```

Then `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` and open
[http://localhost:3000](http://localhost:3000). Every tool call will show
up in the "Explore" view under the `photon` service.

For Jaeger-only traces:

```bash
docker run -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Master switch. Unset = SDK stays disabled. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc`, `http/protobuf`, or `http/json`. Defaults per SDK. |
| `OTEL_SERVICE_NAME` | Service name attached to every record. |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes (e.g. `deployment.environment=prod`). |
| `OTEL_TRACES_SAMPLER` | Override the default sampler. Error spans are always kept. |
| `OTEL_LOG_LEVEL` | SDK's own log level. |

These are standard OTel variables; Photon doesn't invent any of them.

## Philosophy

Photon's instrumentation is intentionally zero-dependency: the runtime
only imports `@opentelemetry/*` via dynamic `import()` inside `try/catch`,
so unused installs stay tiny. The value-add of this guide is that once
you do install the SDK and set one env var, every promise in PROMISES.md
Intent 10 becomes observable with no photon-specific configuration.
