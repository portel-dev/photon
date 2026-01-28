# Photon Deployment Guide

Production deployment strategies for photon applications.

---

## Table of Contents

- [Overview](#overview)
- [Deployment Targets](#deployment-targets)
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
| Docker | Self-hosted, full control | Horizontal with orchestrator |
| Cloudflare Workers | Edge computing, global low latency | Automatic |
| AWS Lambda | Serverless, pay-per-use | Automatic |
| Systemd | Traditional VPS, always-on services | Manual/VM autoscaling |

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

Photons can be deployed to Cloudflare Workers for edge computing.

### Generate Worker Bundle

```bash
photon host deploy my-photon --target cloudflare
```

### Manual Setup

1. Create a `wrangler.toml`:

```toml
name = "my-photon-worker"
main = "dist/worker.js"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

# For KV storage
[[kv_namespaces]]
binding = "PHOTON_KV"
id = "your-kv-id"
```

2. Build the worker bundle:

```bash
photon host build my-photon --target cloudflare --output dist/worker.js
```

3. Deploy:

```bash
npx wrangler deploy
```

### Limitations

- No filesystem access (use KV or R2 for storage)
- 50ms CPU limit on free tier
- Bundle size limit of 1MB compressed

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

- [SECURITY.md](SECURITY.md) - Security hardening guide
- [GUIDE.md](GUIDE.md) - Development guide
- [ADVANCED.md](ADVANCED.md) - Advanced patterns
