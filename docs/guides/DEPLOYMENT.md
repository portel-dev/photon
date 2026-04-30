# Photon Deployment Guide

Production deployment strategies for photon applications.

---

## Table of Contents

- [Overview](#overview)
- [Standalone Binary](#standalone-binary)
- [Docker Deployment](#docker-deployment)
- [Cloudflare Workers](#cloudflare-workers)
- [AWS Lambda](#aws-lambda)
- [Systemd Service](#systemd-service)
- [Environment Variables](#environment-variables)
- [Health Checks](#health-checks)
- [Monitoring](#monitoring)

---

## Overview

Photons can be deployed in multiple ways depending on your needs:

| Target | Best For | Scaling |
|--------|----------|---------|
| Standalone Binary | Zero-dependency distribution, air-gapped envs | Single binary per platform |
| Docker | Self-hosted, full control | Horizontal with orchestrator |
| Cloudflare Workers | Edge computing, global low latency | Automatic |
| AWS Lambda | Serverless, pay-per-use | Automatic |
| Systemd | Traditional VPS, always-on services | Manual/VM autoscaling |

---

## Standalone Binary

Compile any photon into a self-contained executable. The target machine needs no Node.js, no npm, no Photon runtime — just the binary.

### Build

```bash
photon build my-tool                    # Binary for current platform
photon build my-tool -o my-tool-bin     # Custom output name
photon build my-tool -t bun-linux-x64   # Cross-compile for Linux x64
photon build my-tool --with-app         # Embed Beam UI for desktop app mode
```

### What Gets Bundled

- The photon source and all `@dependencies`
- Transitive `@photon` dependencies (resolved recursively)
- The embedded Photon runtime
- Beam frontend assets (with `--with-app`)

### Cross-Compilation Targets

| Target | Platform |
|--------|----------|
| `bun-darwin-arm64` | macOS Apple Silicon |
| `bun-darwin-x64` | macOS Intel |
| `bun-linux-x64` | Linux x64 |
| `bun-linux-arm64` | Linux ARM64 |

### Limitations

- `@mcp` dependencies (external MCP servers) cannot be bundled — a warning is emitted
- `@cli` dependencies (system binaries like `ffmpeg`) must be present on the target machine
- Requires [Bun](https://bun.sh) installed on the build machine

### Distribution

The resulting binary is fully portable:

```bash
# Build on macOS, deploy to Linux server
photon build my-tool -t bun-linux-x64
scp my-tool user@server:/usr/local/bin/
ssh user@server my-tool sse --port 3000
```

---

## Docker Deployment

### Basic Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Install photon CLI
RUN npm install -g @portel/photon

# Copy your photon files
COPY *.photon.ts ./

# Expose MCP SSE port
EXPOSE 3000

# Run as MCP server with SSE transport
CMD ["photon", "sse", "my-photon"]
```

### Multi-Photon Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Install photon CLI
RUN npm install -g @portel/photon

# Copy all photons
COPY *.photon.ts ./

# Run Beam UI (serves multiple photons)
EXPOSE 3000
CMD ["photon", "beam", "--port", "3000"]
```

### Docker Compose

```yaml
version: '3.8'

services:
  photon:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LOG_LEVEL=info
    volumes:
      - photon-data:/app/.photon
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  photon-data:
```

### Production Recommendations

1. **Use multi-stage builds** to minimize image size
2. **Pin dependencies** with a lock file
3. **Run as non-root user** for security
4. **Mount volumes** for persistent data (e.g., SQLite databases)
5. **Set memory limits** appropriate for your workload

---

## Cloudflare Workers

Photons deploy to Cloudflare Workers via a Durable Objects bridge. Each photon instance maps 1:1 to a Durable Object (DO), giving it persistent state, hibernation, and edge-local execution without any infrastructure setup.

### Deploy

```bash
photon host deploy my-photon --target cloudflare
```

This compiles your photon, generates a `wrangler.toml`, and deploys via Wrangler in one step.

### What the CF Runtime Provides

| Capability | How it works on CF |
|------------|--------------------|
| `this.memory` | KV namespace auto-bound as `PHOTON_KV` |
| `this.schedule` | DO Alarm multiplexer - each scheduled method becomes an alarm |
| `this.call(otherPhoton)` | Sibling DO binding resolved by photon name |
| `this.sample` / `this.confirm` / `this.elicit` | Forwarded over the SSE response stream |
| `@get /path` / `@post /path` | Dispatched by the Worker fetch handler before MCP routing |
| `@env MY_KEY` | Read from `wrangler.toml` `[vars]` or CF Secrets |
| Workers AI (`@ai`) | `AI` binding auto-generated and injected |
| `@auth cf-access` | Each CF Access email maps to its own DO instance |

### Stateful Photons with Durable Objects

Photons with `@stateful` or `this.memory` automatically run inside a Durable Object for persistent state. The bridge handles routing:

```typescript
export default class TaskBoard {
  /**
   * Add a task to the board
   * @stateful
   */
  async addTask({ title }: { title: string }) {
    const tasks = (await this.memory.get<string[]>('tasks')) ?? [];
    tasks.push(title);
    await this.memory.set('tasks', tasks);
    return { tasks };
  }
}
```

No wrangler config changes needed - `photon host deploy` generates the DO binding automatically.

### Scheduled Methods on CF

`@scheduled` methods run as DO Alarms on Cloudflare rather than daemon cron jobs:

```typescript
/**
 * Sync external data hourly
 * @scheduled 0 * * * *
 */
async syncData() {
  // Runs as a DO Alarm on CF - no daemon needed
}
```

### HTTP Routes on CF

`@get` and `@post` tags work on Cloudflare deployments. The Worker fetch handler dispatches to the annotated method before falling through to MCP routing:

```typescript
/**
 * Public iCal feed
 * @get /calendar.ics
 */
async ical(request: Request): Promise<Response> {
  const events = await this.memory.get('events') ?? [];
  return new Response(buildICal(events), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
}
```

### Workers AI

If your photon uses an `@ai` constructor parameter, the `AI` binding is auto-generated in `wrangler.toml` and injected at runtime:

```typescript
export default class Summarizer {
  constructor(
    /** @ai */
    private ai: Ai
  ) {}

  async summarize({ text }: { text: string }) {
    return this.ai.run('@cf/meta/llama-3.1-8b-instruct', {
      prompt: `Summarize: ${text}`,
    });
  }
}
```

### Per-User Isolation with CF Access

Add `@auth cf-access` to route each authenticated Cloudflare Access user to their own DO instance:

```typescript
/**
 * Personal task board - one instance per user
 * @auth cf-access
 */
export default class PersonalBoard {
  // Each CF Access email gets its own isolated DO instance
}
```

### Manual wrangler.toml

`photon host deploy` generates this automatically, but if you need manual control:

```toml
name = "my-photon-worker"
main = "dist/worker.js"
compatibility_date = "2024-06-01"

[vars]
ENVIRONMENT = "production"

[[durable_objects.bindings]]
name = "PHOTON_DO"
class_name = "PhotonDurableObject"

[[migrations]]
tag = "v1"
new_classes = ["PhotonDurableObject"]

[[kv_namespaces]]
binding = "PHOTON_KV"
id = "your-kv-id"
```

### Limitations

- No filesystem access (use `this.memory` backed by KV or R2)
- CPU time limit per request (use DO hibernation for long-running work)
- Bundle size limit of 1 MB compressed

---

## AWS Lambda

### Generate Lambda Package

```bash
photon host deploy my-photon --target lambda
```

### Manual Setup with SAM

1. Create `template.yaml`:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  PhotonFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: handler.handler
      Runtime: nodejs20.x
      Timeout: 30
      MemorySize: 256
      Events:
        Api:
          Type: Api
          Properties:
            Path: /{proxy+}
            Method: ANY
```

2. Build and deploy:

```bash
sam build
sam deploy --guided
```

### Lambda Best Practices

1. **Cold start optimization**: Keep bundles small, minimize dependencies
2. **Connection reuse**: Use keep-alive for database connections
3. **Provisioned concurrency**: For consistent latency
4. **Layers**: Share dependencies across functions

---

## Systemd Service

For always-on deployment on Linux servers.

### Service File

Create `/etc/systemd/system/photon.service`:

```ini
[Unit]
Description=Photon MCP Server
After=network.target

[Service]
Type=simple
User=photon
Group=photon
WorkingDirectory=/opt/photon
Environment=NODE_ENV=production
Environment=LOG_LEVEL=info
ExecStart=/usr/bin/node /usr/local/bin/photon sse my-photon --port 3000
Restart=always
RestartSec=10

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/opt/photon/.photon

[Install]
WantedBy=multi-user.target
```

### Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable photon
sudo systemctl start photon
```

### View Logs

```bash
sudo journalctl -u photon -f
```

---

## Environment Variables

Photons support configuration via environment variables.

### Standard Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `LOG_LEVEL` | Log verbosity (error/warn/info/debug) | `info` |
| `PHOTON_DIR` | Data directory | `~/.photon` |

### Constructor Parameter Injection

Constructor parameters can be injected via environment variables:

```typescript
export default class MyPhoton {
  constructor(
    /** @env MY_API_KEY */
    private apiKey: string,
    /** @env MY_TIMEOUT */
    private timeout: number = 30000
  ) {}
}
```

Set via environment:

```bash
export MY_API_KEY=sk-xxx
export MY_TIMEOUT=60000
```

---

## Health Checks

Photon servers expose health endpoints for monitoring.

### SSE Transport

```bash
curl http://localhost:3000/health
```

### Beam UI

```bash
curl http://localhost:3000/health
```

Response:

```json
{
  "status": "ok",
  "uptime": 3600,
  "photons": 5
}
```

---

## Monitoring

### Structured Logging

Enable JSON logs for log aggregation:

```bash
photon sse my-photon --json-logs
```

Output format:

```json
{"level":"info","message":"Tool executed","tool":"search","duration":152,"timestamp":"2024-01-01T00:00:00.000Z"}
```

### Metrics

For production monitoring, consider:

1. **Prometheus**: Expose `/metrics` endpoint
2. **Datadog**: Use structured logs with trace IDs
3. **CloudWatch**: For AWS deployments

### Alerting

Set up alerts for:

- High error rates (>1% of requests)
- Slow tool execution (>5s p99)
- Memory usage (>80% of limit)
- Connection failures to external services

---

## Next Steps

- [SECURITY.md](../../SECURITY.md) - Security hardening guide
- [GUIDE.md](../GUIDE.md) - Development guide
- [ADVANCED.md](./ADVANCED.md) - Advanced patterns
