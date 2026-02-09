# Advanced Photon Guide

Deep dive into Photon's advanced features, patterns, and best practices.

## Table of Contents

- [Lifecycle Hooks](#lifecycle-hooks)
- [Advanced Type Patterns](#advanced-type-patterns)
- [Manual Schema Overrides](#manual-schema-overrides)
- [Performance Optimization](#performance-optimization)
- [Error Handling Strategies](#error-handling-strategies)
- [Testing MCPs](#testing-mcps)
- [Production Deployment](#production-deployment)
- [Custom Marketplace Setup](#custom-marketplace-setup)
- [Integration Patterns](#integration-patterns)

---

## Lifecycle Hooks

### onInitialize()

Called once when MCP starts. Use for setup tasks.

```typescript
export default class Database {
  private connection?: DatabaseConnection;

  constructor(
    private connectionString: string,
    private poolSize: number = 10
  ) {}

  async onInitialize() {
    console.error('Establishing database connection...');

    this.connection = await createConnection({
      url: this.connectionString,
      pool: {
        min: 2,
        max: this.poolSize,
      },
    });

    // Test connection
    await this.connection.query('SELECT 1');
    console.error('Database connected successfully');
  }

  async query(params: { sql: string }) {
    if (!this.connection) {
      throw new Error('Database not initialized');
    }
    return await this.connection.query(params.sql);
  }
}
```

**Best Practices**:
- ✅ DO: Establish connections, load configuration
- ✅ DO: Throw errors if initialization fails
- ✅ DO: Add logging for debugging
- ❌ DON'T: Do expensive operations that aren't required
- ❌ DON'T: Load large datasets into memory

### onShutdown()

Called when MCP is stopping. Clean up resources.

```typescript
export default class WebSocket {
  private connections: Connection[] = [];
  private timers: NodeJS.Timer[] = [];

  async onShutdown() {
    console.error('Shutting down gracefully...');

    // Clear timers
    this.timers.forEach(timer => clearInterval(timer));

    // Close connections
    await Promise.all(
      this.connections.map(conn =>
        conn.close().catch(err =>
          console.error('Error closing connection:', err)
        )
      )
    );

    console.error('Shutdown complete');
  }
}
```

**Critical for**:
- Database connections
- File handles
- WebSocket connections
- Timers/intervals
- Child processes

---

## Advanced Type Patterns

### Nested Objects

```typescript
export default class UserManagement {
  /**
   * Create a new user with profile
   * @param user User details including profile information
   */
  async createUser(params: {
    user: {
      name: string;
      email: string;
      profile: {
        bio?: string;
        avatar?: string;
        social: {
          twitter?: string;
          github?: string;
        };
      };
    };
  }) {
    // Full type safety with nested validation
    return {
      id: generateId(),
      ...params.user,
    };
  }
}
```

### Union Types

```typescript
/**
 * Process data with multiple input formats
 * @param input Either JSON string or object
 */
async processData(params: {
  input: string | { data: any };
  format: 'json' | 'yaml' | 'xml';
}) {
  // Photon generates: anyOf: [{ type: 'string' }, { type: 'object' }]
  const data = typeof params.input === 'string'
    ? JSON.parse(params.input)
    : params.input;

  return convertFormat(data, params.format);
}
```

### Arrays with Constraints

```typescript
/**
 * Batch process items
 * @param items Array of items to process (max 100)
 */
async batchProcess(params: {
  items: Array<{
    id: string;
    data: any;
  }>;
}) {
  if (params.items.length > 100) {
    throw new Error('Maximum 100 items per batch');
  }

  return await Promise.all(
    params.items.map(item => this.processItem(item))
  );
}
```

### Enums with Literal Types

```typescript
/**
 * Set log level
 * @param level Log level (debug, info, warn, error)
 */
async setLogLevel(params: {
  level: 'debug' | 'info' | 'warn' | 'error';
}) {
  // Photon generates enum constraint
  logger.setLevel(params.level);
  return { level: params.level };
}
```

---

## Manual Schema Overrides

When TypeScript's auto-extraction doesn't cover edge cases (complex imported types, type aliases, or dynamic schemas), you can manually specify schemas using a `.schema.json` file.

### When to Use

Use manual overrides when:
- Using complex imported types that can't be inlined
- Type aliases that reference external definitions
- Dynamic schemas that vary at runtime
- Third-party types from libraries
- Schemas with advanced JSON Schema features

### Format

Create a `.schema.json` file next to your `.photon.ts` MCP file:

```
my-mcp.photon.ts
my-mcp.schema.json  ← Manual schema override
```

### Schema Structure

```json
{
  "tools": [
    {
      "name": "toolName",
      "description": "Tool description",
      "inputSchema": {
        "type": "object",
        "properties": {
          "param": { "type": "string" }
        },
        "required": ["param"]
      }
    }
  ],
  "templates": [
    {
      "name": "templateName",
      "description": "Template description",
      "inputSchema": { /* ... */ }
    }
  ],
  "statics": [
    {
      "name": "staticName",
      "uri": "static://path",
      "description": "Static resource description",
      "mimeType": "application/json",
      "inputSchema": { /* ... */ }
    }
  ]
}
```

### Example: Complex Type Alias

```typescript
// my-mcp.photon.ts
import { ComplexFilter } from './types'; // Can't be auto-extracted

export default class SearchMCP {
  /**
   * Search with complex filters
   */
  async search(params: {
    query: string;
    filters: ComplexFilter; // Type alias - won't auto-extract properly
  }) {
    // Implementation
  }
}
```

```json
// my-mcp.schema.json
{
  "tools": [
    {
      "name": "search",
      "description": "Search with complex filters",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Search query"
          },
          "filters": {
            "type": "object",
            "description": "Advanced filter options",
            "properties": {
              "tags": {
                "type": "array",
                "items": { "type": "string" }
              },
              "dateRange": {
                "type": "object",
                "properties": {
                  "from": { "type": "string", "format": "date" },
                  "to": { "type": "string", "format": "date" }
                }
              },
              "score": {
                "type": "number",
                "minimum": 0,
                "maximum": 100
              }
            }
          }
        },
        "required": ["query"]
      }
    }
  ]
}
```

### Partial Override

You can override specific tools while auto-extracting others:

```json
{
  "tools": [
    {
      "name": "complexTool",
      "inputSchema": { /* manual schema */ }
    }
    // Other tools will be auto-extracted
  ]
}
```

### Validation

Photon validates that:
- Tool/template/static names exist in your TypeScript class
- Schema follows JSON Schema Draft 2020-12
- Required fields are present

### Limitations

- Must manually keep schema in sync with code
- No TypeScript type checking for schema
- Overridden tools skip auto-extraction entirely

### Best Practices

1. **Document why**: Add a comment explaining why manual override is needed
   ```json
   {
     "tools": [{
       "name": "complexQuery",
       "description": "Uses imported GraphQL types that can't be auto-extracted",
       "inputSchema": { /* ... */ }
     }]
   }
   ```

2. **Validate regularly**: Test that manual schemas match actual implementation
   ```bash
   photon mcp my-mcp --validate
   ```

3. **Keep it minimal**: Only override what's necessary, let auto-extraction handle the rest

4. **Version control**: Commit both `.photon.ts` and `.schema.json` together

5. **Use TypeScript for simple cases**: Inline types when possible instead of manual overrides

---

## Performance Optimization

### Lazy Loading

```typescript
export default class AIService {
  private model?: LargeModel;

  // ❌ Slow - loads 2GB model at startup
  async onInitialize() {
    this.model = await loadLargeModel();
  }

  // ✅ Fast - loads on first use
  private async getModel() {
    if (!this.model) {
      console.error('Loading model...');
      this.model = await loadLargeModel();
      console.error('Model loaded');
    }
    return this.model;
  }

  async predict(params: { input: string }) {
    const model = await this.getModel();
    return await model.predict(params.input);
  }
}
```

### Connection Pooling

```typescript
export default class DatabaseOptimized {
  private pool: Pool;

  constructor(private dbUrl: string) {
    // Create pool immediately (cheap)
    this.pool = new Pool({
      connectionString: this.dbUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async query(params: { sql: string }) {
    // Reuse connections from pool
    const client = await this.pool.connect();
    try {
      const result = await client.query(params.sql);
      return { rows: result.rows };
    } finally {
      client.release(); // Return to pool
    }
  }

  async onShutdown() {
    await this.pool.end();
  }
}
```

### Caching Strategies

```typescript
export default class API {
  private cache = new Map<string, { data: any; expires: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetch data with caching
   * @param endpoint API endpoint to fetch
   */
  async fetch(params: { endpoint: string }) {
    const cached = this.cache.get(params.endpoint);

    if (cached && cached.expires > Date.now()) {
      console.error('Cache hit:', params.endpoint);
      return cached.data;
    }

    console.error('Cache miss, fetching:', params.endpoint);
    const data = await this.fetchFromAPI(params.endpoint);

    this.cache.set(params.endpoint, {
      data,
      expires: Date.now() + this.CACHE_TTL,
    });

    // Limit cache size
    if (this.cache.size > 100) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }

    return data;
  }
}
```

### Batch Operations

```typescript
export default class BatchProcessor {
  private queue: Array<{ id: string; data: any }> = [];
  private batchTimer?: NodeJS.Timeout;

  /**
   * Add item to processing queue
   * @param item Item to process
   */
  async addItem(params: { id: string; data: any }) {
    this.queue.push(params);

    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Process after 100ms or when 50 items queued
    if (this.queue.length >= 50) {
      await this.processBatch();
    } else {
      this.batchTimer = setTimeout(() => this.processBatch(), 100);
    }

    return { queued: true, position: this.queue.length };
  }

  private async processBatch() {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, 50);
    console.error(`Processing batch of ${batch.length} items`);

    await this.processItems(batch);
  }
}
```

---

## Error Handling Strategies

### Graceful Degradation

```typescript
export default class MultiSourceData {
  constructor(
    private primaryAPI: string,
    private fallbackAPI: string
  ) {}

  /**
   * Fetch data with automatic fallback
   * @param id Data ID
   */
  async getData(params: { id: string }) {
    try {
      return await this.fetchFromPrimary(params.id);
    } catch (primaryError) {
      console.error('Primary API failed, trying fallback:', primaryError);

      try {
        const data = await this.fetchFromFallback(params.id);
        return {
          ...data,
          source: 'fallback',
          warning: 'Using fallback data source',
        };
      } catch (fallbackError) {
        throw new Error(
          `Both primary and fallback failed. ` +
          `Primary: ${primaryError.message}, ` +
          `Fallback: ${fallbackError.message}`
        );
      }
    }
  }
}
```

### Retry with Exponential Backoff

```typescript
export default class ResilientAPI {
  /**
   * Fetch with retry logic
   * @param url URL to fetch
   */
  async fetchWithRetry(params: { url: string }) {
    const maxRetries = 3;
    let lastError: Error;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fetch(params.url).then(r => r.json());
      } catch (error: any) {
        lastError = error;

        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.error(`Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`Failed after ${maxRetries} attempts: ${lastError!.message}`);
  }
}
```

### Input Validation

```typescript
export default class ValidatedAPI {
  /**
   * Create user with validation
   * @param email User email address
   * @param age User age (18-120)
   */
  async createUser(params: { email: string; age: number }) {
    // Validate email
    if (!params.email.includes('@')) {
      throw new Error('Invalid email format');
    }

    // Validate age
    if (params.age < 18 || params.age > 120) {
      throw new Error('Age must be between 18 and 120');
    }

    return await this.saveUser(params);
  }
}
```

---

## Testing MCPs

### Unit Testing

```typescript
// my-mcp.test.ts
import { describe, it, expect } from 'vitest';

// Import your MCP class
import MCP from './my-mcp.photon.js';

describe('MyMCP', () => {
  it('should calculate correctly', async () => {
    const mcp = new MCP();
    const result = await mcp.calculate({ expression: '2 + 2' });
    expect(result.result).toBe(4);
  });

  it('should handle errors', async () => {
    const mcp = new MCP();
    await expect(
      mcp.calculate({ expression: 'invalid' })
    ).rejects.toThrow();
  });
});
```

### Integration Testing

```typescript
// Integration test with actual MCP server
import { PhotonServer } from '@portel/photon/server';
import { Client } from '@modelcontextprotocol/sdk/client';

describe('MCP Integration', () => {
  let server: PhotonServer;
  let client: Client;

  beforeAll(async () => {
    server = new PhotonServer({
      filePath: './my-mcp.photon.ts',
    });
    await server.start();

    client = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
    // Connect client to server...
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should list tools', async () => {
    const response = await client.listTools();
    expect(response.tools).toHaveLength(3);
  });
});
```

---

## Production Deployment

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install Photon globally
RUN npm install -g @portel/photon

# Copy MCP file
COPY my-mcp.photon.ts .

# Set environment variables
ENV MY_MCP_API_KEY=""
ENV NODE_ENV=production

# Start MCP
CMD ["photon", "mcp", "my-mcp"]
```

### Process Manager (PM2)

```json
// ecosystem.config.json
{
  "apps": [
    {
      "name": "github-mcp",
      "script": "photon",
      "args": ["mcp", "github-issues"],
      "env": {
        "GITHUB_ISSUES_TOKEN": "your-token",
        "NODE_ENV": "production"
      },
      "instances": 1,
      "autorestart": true,
      "watch": false,
      "max_memory_restart": "500M"
    }
  ]
}
```

```bash
# Deploy with PM2
pm2 start ecosystem.config.json
pm2 save
pm2 startup
```

### Health Checks

```typescript
export default class HealthMonitored {
  private healthy = true;
  private lastCheck = Date.now();

  async onInitialize() {
    // Start health check interval
    setInterval(() => this.checkHealth(), 30000);
  }

  private async checkHealth() {
    try {
      // Check dependencies
      await this.testConnection();
      this.healthy = true;
      this.lastCheck = Date.now();
    } catch (error) {
      console.error('Health check failed:', error);
      this.healthy = false;
    }
  }

  /**
   * Get health status
   */
  async health() {
    return {
      healthy: this.healthy,
      lastCheck: this.lastCheck,
      uptime: process.uptime(),
    };
  }
}
```

---

## Custom Marketplace Setup

### Creating a Marketplace

```bash
# 1. Create repository
mkdir my-company-mcps
cd my-company-mcps
git init

# 2. Create marketplace manifest
mkdir .marketplace
cat > .marketplace/photons.json << 'EOF'
{
  "name": "my-company-mcps",
  "version": "1.0.0",
  "description": "Internal MCPs for My Company",
  "owner": {
    "name": "My Company",
    "url": "https://example.com"
  },
  "photons": []
}
EOF

# 3. Add MCPs
cat > analytics.photon.ts << 'EOF'
/**
 * Analytics MCP
 * @version 1.0.0
 */
export default class Analytics {
  async getMetrics(params: { period: string }) {
    return { metrics: [] };
  }
}
EOF

# 4. Update manifest (can be automated)
cat > .marketplace/photons.json << 'EOF'
{
  "name": "my-company-mcps",
  "photons": [
    {
      "name": "analytics",
      "version": "1.0.0",
      "description": "Company analytics queries",
      "source": "../analytics.photon.ts",
      "tools": ["getMetrics"]
    }
  ]
}
EOF

# 5. Commit and push
git add .
git commit -m "Add analytics MCP"
git push origin main
```

### Using Private Marketplace

```bash
# Add marketplace
photon marketplace add my-company/mcps

# Or with authentication for private repos
photon marketplace add https://github-token@github.com/my-company/mcps.git

# List and install
photon add analytics --marketplace my-company-mcps
```

---

## Integration Patterns

### Database Integration

```typescript
/**
 * @dependencies pg@^8.11.0
 */
import { Pool } from 'pg';

export default class Postgres {
  private pool: Pool;

  constructor(private connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  /**
   * Execute SQL query
   * @param sql SQL query to execute
   */
  async query(params: { sql: string }) {
    const result = await this.pool.query(params.sql);
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  }

  async onShutdown() {
    await this.pool.end();
  }
}
```

### REST API Integration

```typescript
/**
 * @dependencies axios@^1.6.0
 */
import axios, { AxiosInstance } from 'axios';

export default class APIClient {
  private client: AxiosInstance;

  constructor(
    private baseURL: string,
    private apiKey: string
  ) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * GET request
   * @param endpoint API endpoint
   */
  async get(params: { endpoint: string }) {
    const response = await this.client.get(params.endpoint);
    return response.data;
  }

  /**
   * POST request
   * @param endpoint API endpoint
   * @param data Request body
   */
  async post(params: { endpoint: string; data: any }) {
    const response = await this.client.post(params.endpoint, params.data);
    return response.data;
  }
}
```

### External WebSocket Services

Connect to external WebSocket APIs (stock tickers, chat services, etc.):

> **Note:** This is for photons consuming external WebSocket services. Beam's internal architecture uses SSE via MCP Streamable HTTP—see [ARCHITECTURE.md](../core/ARCHITECTURE.md).

```typescript
/**
 * @dependencies ws@^8.16.0
 */
import WebSocket from 'ws';

export default class RealtimeData {
  private ws?: WebSocket;
  private messageQueue: any[] = [];

  constructor(private wsUrl: string) {}

  async onInitialize() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('message', (data) => {
      this.messageQueue.push(JSON.parse(data.toString()));
    });

    await new Promise((resolve, reject) => {
      this.ws!.on('open', resolve);
      this.ws!.on('error', reject);
    });
  }

  /**
   * Get latest messages
   */
  async getMessages() {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return { messages };
  }

  async onShutdown() {
    this.ws?.close();
  }
}
```

---

## Best Practices Summary

### DO ✅

- Use TypeScript types for all parameters
- Add JSDoc comments for all tools
- Implement `onShutdown()` for resource cleanup
- Validate inputs before processing
- Use connection pooling for databases
- Cache expensive operations
- Log errors with context
- Test with real data
- Use semantic versioning

### DON'T ❌

- Store secrets in code
- Load large data at startup
- Use global mutable state
- Ignore errors
- Block the event loop
- Leave connections open
- Use synchronous APIs
- Hardcode URLs/endpoints
- Skip error handling

---

## Performance Targets

- **Startup time**: < 2 seconds
- **First request**: < 500ms
- **Subsequent requests**: < 100ms
- **Memory usage**: < 100MB for simple MCPs
- **Connection pool**: 5-20 connections
- **Cache hit rate**: > 80% for cacheable data

---

## Further Reading

- [MCP Protocol Specification](https://modelcontextprotocol.io/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Photon Examples](./examples/)
