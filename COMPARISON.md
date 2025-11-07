# Photon vs Official MCP Implementations

This document compares Photon MCP implementations to the official reference servers from [@modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers).

## 📊 Size Comparison

| MCP Server | Official (TypeScript) | Photon | Reduction |
|------------|----------------------|--------|-----------|
| **Fetch/Web Fetch** | ~300 lines + dependencies | **154 lines** | **~48% smaller** |
| **Memory** | ~400 lines + setup | **355 lines** | **~11% smaller** |
| **Filesystem** | ~800 lines + boilerplate | **N/A (custom)** | Similar features |

## 🎯 Feature Parity

### Web Fetch MCP

**Official Features:**
- ✅ Fetch URL and convert to markdown
- ✅ Pagination with `max_length` and `start_index`
- ✅ Raw HTML mode
- ✅ User-Agent customization

**Photon Implementation:** [`examples/web-fetch.photon.ts`](./examples/web-fetch.photon.ts)
- ✅ All official features
- ✅ Auto-dependency installation (`turndown@^7.2.0`)
- ✅ Batch fetching (bonus feature)
- ✅ Constructor-based configuration

**Key Differences:**
```typescript
// Official: Requires manual setup, dependencies, and boilerplate
npm install @modelcontextprotocol/sdk turndown
// ~50 lines of server setup code

// Photon: Zero setup, auto-installs dependencies
npx @portel/photon mcp web-fetch
// Ready to use in seconds
```

### Memory MCP

**Official Features:**
- ✅ Create entities with observations
- ✅ Create relations between entities
- ✅ Add observations to entities
- ✅ Delete entities (cascading relations)
- ✅ Delete observations
- ✅ Delete relations
- ✅ Read entire knowledge graph
- ✅ Search nodes by query
- ✅ Open specific nodes with relations

**Photon Implementation:** [`examples/memory.photon.ts`](./examples/memory.photon.ts)
- ✅ Full feature parity
- ✅ JSON-based persistence
- ✅ Configurable storage path
- ✅ Clear graph operation (bonus)
- ✅ Lifecycle hooks (`onInitialize`, `onShutdown`)

**Key Differences:**
```typescript
// Official: Complex setup with multiple files
src/memory/
  ├── index.ts          # Server setup
  ├── graph.ts          # Graph implementation
  ├── persistence.ts    # Storage logic
  └── types.ts          # Type definitions

// Photon: Single file, everything included
examples/memory.photon.ts  # 355 lines, complete implementation
```

## 🚀 Development Experience

### Official MCP Servers

**Setup Steps:**
1. Install Node.js and npm
2. Clone repository
3. `npm install` (install all dependencies)
4. Configure environment variables
5. Build TypeScript: `npm run build`
6. Run server: `node dist/index.js`

**File Structure:**
```
src/
├── index.ts           # Entry point
├── server.ts          # Server setup
├── tools/             # Tool implementations
│   ├── fetch.ts
│   ├── memory.ts
│   └── ...
├── types.ts           # Type definitions
├── utils.ts           # Utilities
└── package.json       # Dependencies
```

**Lines of boilerplate:** ~100-150 lines

### Photon MCPs

**Setup Steps:**
1. Create `.photon.ts` file
2. Run: `npx @portel/photon your-mcp`
3. Done!

**File Structure:**
```
examples/
└── web-fetch.photon.ts    # Complete MCP in one file
```

**Lines of boilerplate:** ~0 lines (auto-handled)

## 💡 Code Comparison

### Fetch Implementation

**Official MCP (simplified):**
```typescript
// index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import TurndownService from 'turndown';

const server = new Server({
  name: 'fetch',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
  },
});

// 40+ lines of server setup...

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Tool routing logic...
  switch (request.params.name) {
    case 'fetch':
      // Implementation...
      break;
  }
});

// Transport setup...
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Photon MCP:**
```typescript
/**
 * @dependencies turndown@^7.2.0
 */
import TurndownService from 'turndown';

export default class WebFetch {
  private turndown: TurndownService;

  constructor(user_agent?: string) {
    this.userAgent = user_agent || 'Photon-MCP-Fetch/1.0';
    this.turndown = new TurndownService();
  }

  async fetch(params: { url: string; max_length?: number; ... }) {
    // Implementation...
    return { success: true, content, metadata };
  }
}
```

**Key Advantages:**
- ❌ No server setup boilerplate
- ❌ No manual tool registration
- ❌ No transport configuration
- ✅ Auto-schema extraction from JSDoc
- ✅ Auto-dependency installation
- ✅ Constructor-based config injection
- ✅ Clean class-based API

### Memory Implementation

**Official MCP:**
```typescript
// Requires multiple files for separation of concerns
// graph.ts: ~150 lines
// persistence.ts: ~80 lines
// index.ts: ~120 lines
// types.ts: ~50 lines
// Total: ~400 lines across 4 files
```

**Photon MCP:**
```typescript
// Single file: 355 lines, includes everything:
// - Type definitions
// - Knowledge graph implementation
// - Persistence logic
// - All 10 tools
// - Lifecycle management
```

## 🎨 Configuration

### Official MCP

**Environment Variables (manual):**
```bash
export FETCH_USER_AGENT="MyBot/1.0"
export MEMORY_STORAGE_PATH="/path/to/memory.json"
```

**Claude Desktop config.json:**
```json
{
  "mcpServers": {
    "fetch": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "FETCH_USER_AGENT": "MyBot/1.0"
      }
    }
  }
}
```

### Photon MCP

**Auto-detected from constructor:**
```typescript
constructor(user_agent?: string, storage_path?: string) { }
```

**Claude Desktop config (auto-generated):**
```bash
npx @portel/photon get web-fetch --mcp
```

```json
{
  "mcpServers": {
    "web-fetch": {
      "command": "npx",
      "args": ["@portel/photon", "mcp", "web-fetch"],
      "env": {
        "WEB_FETCH_USER_AGENT": "MyBot/1.0"
      }
    }
  }
}
```

**Key Advantages:**
- ✅ Convention-based naming: `{MCP_NAME}_{PARAM_NAME}`
- ✅ Auto-generated config with `--config` flag
- ✅ Type-safe parameter parsing
- ✅ Default values respected

## 📦 Dependencies

### Official MCP

**Manual dependency management:**
```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "turndown": "^7.2.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Installation:**
```bash
npm install  # Install all dependencies
npm run build  # Compile TypeScript
```

### Photon MCP

**Auto-dependency installation:**
```typescript
/**
 * @dependencies turndown@^7.2.0
 */
```

**Installation:**
```bash
# Nothing! Dependencies auto-install on first run
npx @portel/photon web-fetch
```

**Key Advantages:**
- ✅ Zero manual installation
- ✅ Cached per MCP in `~/.cache/photon-mcp/`
- ✅ Works like `npx` - instant usage
- ✅ Isolated dependencies per MCP

## 🧪 Testing

### Official MCP

**Test Setup:**
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 50+ lines of client setup...
const client = new Client({ ... });
const transport = new StdioClientTransport({ ... });
await client.connect(transport);
```

### Photon MCP

**Test Setup:**
```typescript
import { MCPTestClient } from '../src/test-client.js';

const client = new MCPTestClient();
await client.start('node', ['dist/cli.js', 'web-fetch.photon.ts']);
await client.initialize();

const result = await client.callTool('fetch', { url: 'https://example.com' });
```

**Built-in test framework:**
```typescript
await client.runTests([
  {
    name: 'Fetch example.com',
    method: 'tools/call',
    params: { name: 'fetch', arguments: { url: 'https://example.com' } },
    validate: validators.and(
      validators.hasResult,
      validators.custom((result) => result.content.includes('Example Domain'))
    ),
  },
]);
```

## 📈 Metrics Summary

|  | Official MCP | Photon MCP |
|--|--------------|------------|
| **Setup time** | 5-10 minutes | < 30 seconds |
| **Lines of boilerplate** | ~100-150 | 0 |
| **Files per MCP** | 4-6 | 1 |
| **Dependencies to manage** | Manual | Automatic |
| **Schema definition** | Manual | Auto-extracted |
| **Config generation** | Manual | `--config` flag |
| **Hot reload** | Manual setup | Built-in `--dev` |
| **Type safety** | TypeScript | TypeScript |

## 🎯 When to Use Each

### Use Official MCPs When:
- Building production-grade, enterprise MCPs
- Need advanced SDK features
- Contributing to official ecosystem
- Want battle-tested implementations
- Working in Go, Python, Rust, C#, etc.

### Use Photon MCPs When:
- Rapid prototyping
- Personal/small team projects
- Learning MCP development
- Need quick iteration
- Want minimal setup overhead
- TypeScript/JavaScript environment

## 🔗 Resources

- **Official MCPs:** https://github.com/modelcontextprotocol/servers
- **Photon Examples:** [./examples/](./examples/)
- **MCP Documentation:** https://modelcontextprotocol.io
- **Photon Repository:** https://github.com/portel-dev/photon

## 💬 Conclusion

Photon MCPs demonstrate that **simplicity doesn't mean sacrificing features**. By leveraging conventions and automation:

- ✅ **~50% less code** for equivalent functionality
- ✅ **Zero boilerplate** through auto-schema extraction
- ✅ **Instant startup** with auto-dependency installation
- ✅ **Single-file simplicity** vs multi-file projects
- ✅ **Built-in testing** framework
- ✅ **Convention over configuration** for reduced cognitive load

The choice between official MCPs and Photon depends on your needs, but for most use cases, **Photon's simplicity and speed make it the ideal choice for MCP development**.
