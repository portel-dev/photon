# Photon MCP Developer Guide

Complete guide to creating `.photon.ts` files and understanding how Photon works.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Creating Your First MCP](#creating-your-first-mcp)
3. [Constructor Configuration](#constructor-configuration)
4. [Writing Tool Methods](#writing-tool-methods)
5. [Lifecycle Hooks](#lifecycle-hooks)
6. [Common Patterns](#common-patterns)
7. [Testing and Development](#testing-and-development)
8. [Deployment](#deployment)
9. [How Photon Works](#how-photon-works)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)

---

## Quick Start

Create your first MCP in 3 steps:

```bash
# 1. Create new MCP
photon init my-tool

# 2. Edit ~/.photon/my-tool.photon.ts
export default class MyTool {
  async greet(params: { name: string }) {
    return `Hello, ${params.name}!`;
  }
}

# 3. Test it
photon mcp my-tool --dev
```

That's it! Your MCP is now running and ready to use.

---

## Creating Your First MCP

### File Structure

A Photon MCP is a **single TypeScript file** with this minimal structure:

```typescript
export default class MyMCP {
  async toolName(params: { input: string }) {
    return `Result: ${params.input}`;
  }
}
```

### Naming Conventions

The MCP name comes from:
1. **File name** (preferred): `calculator.photon.ts` → `calculator`
2. **Class name** (fallback): `class Calculator` → `calculator`

### Complete Example

Here's a real-world example with all features:

```typescript
/**
 * Calculator - Basic arithmetic operations
 *
 * Provides mathematical calculations: add, subtract, multiply, divide.
 * Useful for numerical computations and data processing.
 *
 * Dependencies: None
 *
 * @version 1.0.0
 * @author Your Name
 */

export default class Calculator {
  // Optional lifecycle hook
  async onInitialize() {
    console.error('Ready to calculate');
  }

  /**
   * Add two numbers together
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }

  /**
   * Subtract b from a
   * @param a First number
   * @param b Number to subtract
   */
  async subtract(params: { a: number; b: number }) {
    return params.a - params.b;
  }

  // Private helper (not exposed as tool)
  private _validate(value: number) {
    if (isNaN(value)) throw new Error('Invalid number');
  }
}
```

---

## Constructor Configuration

### Basic Pattern

Constructor parameters automatically map to **environment variables**:

```typescript
export default class Filesystem {
  constructor(
    private workdir: string = join(homedir(), 'Documents'),
    private maxFileSize: number = 10485760,
    private allowHidden: boolean = false
  ) {
    // Validate configuration
    if (!existsSync(workdir)) {
      throw new Error(`Working directory does not exist: ${workdir}`);
    }
  }
}
```

### Environment Variable Mapping

Pattern: `{MCP_NAME}_{PARAM_NAME}` in SCREAMING_SNAKE_CASE

| Constructor Parameter | Environment Variable |
|-----------------------|----------------------|
| `workdir` | `FILESYSTEM_WORKDIR` |
| `maxFileSize` | `FILESYSTEM_MAX_FILE_SIZE` |
| `allowHidden` | `FILESYSTEM_ALLOW_HIDDEN` |

### Type Conversion

Photon automatically converts environment variable strings:

```typescript
constructor(
  private port: number = 3000,          // "8080" → 8080
  private enabled: boolean = false,     // "true" → true
  private tags: string[] = [],          // Not supported yet
) {}
```

**Supported types:**
- `string` - No conversion
- `number` - Parsed with `Number()`
- `boolean` - "true" → `true`, anything else → `false`

### Smart Defaults

Use platform-aware defaults:

```typescript
import { homedir } from 'os';
import { join } from 'path';

constructor(
  // Cross-platform Documents folder
  private workdir: string = join(homedir(), 'Documents'),

  // Reasonable file size limit (10MB)
  private maxFileSize: number = 10485760,

  // Conservative security default
  private allowHidden: boolean = false
) {}
```

### Required Parameters

For required config, omit defaults and throw clear errors:

```typescript
constructor(
  private apiKey: string,
  private endpoint: string
) {
  if (!apiKey || !endpoint) {
    throw new Error('API key and endpoint are required');
  }
}
```

**User experience:** When users run `photon my-tool --config`, they see:

```json
{
  "env": {
    "MY_TOOL_API_KEY": "<your-api-key>",
    "MY_TOOL_ENDPOINT": "<your-endpoint>"
  }
}
```

### Configuration Examples

**API Client:**
```typescript
constructor(
  private baseUrl: string = 'https://api.example.com',
  private timeout: number = 5000,
  private apiKey?: string  // Optional authentication
) {}
```

**Database:**
```typescript
constructor(
  private dbPath: string = join(homedir(), '.myapp', 'data.db'),
  private readonly: boolean = false
) {
  if (!existsSync(dirname(dbPath))) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
}
```

**Git Operations:**
```typescript
constructor(
  private repoPath: string = process.cwd(),
  private autoCommit: boolean = false
) {
  if (!existsSync(join(repoPath, '.git'))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}
```

---

## Writing Tool Methods

### Method Signature

Every tool is an **async method** with a single `params` object:

```typescript
async methodName(params: {
  requiredParam: string;
  optionalParam?: number;
  arrayParam?: string[];
  objectParam: {
    nested: boolean;
  };
}) {
  return result;
}
```

### JSDoc Documentation

JSDoc comments become tool descriptions in MCP:

```typescript
/**
 * Read file contents from the filesystem
 * @param path Path to file (relative to working directory)
 * @param encoding File encoding (default: utf-8)
 */
async read(params: { path: string; encoding?: string }) {
  // Implementation
}
```

**What MCP clients see:**
- Tool name: `read`
- Description: "Read file contents from the filesystem"
- Parameters:
  - `path` (required): "Path to file (relative to working directory)"
  - `encoding` (optional): "File encoding (default: utf-8)"

### Return Values

Photon accepts multiple return formats:

```typescript
// 1. Simple value (string, number, boolean)
async tool1(params: {}) {
  return "Success";
}

// 2. Object (auto-stringified to JSON)
async tool2(params: {}) {
  return { result: 42, status: "ok" };
}

// 3. Success/error format (recommended)
async tool3(params: {}) {
  try {
    // Do work
    return { success: true, result: data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// 4. MCP content format
async tool4(params: {}) {
  return {
    content: [
      { type: "text", text: "Result data" }
    ]
  };
}
```

### Error Handling

Handle errors gracefully:

```typescript
async readFile(params: { path: string }) {
  try {
    // Validate input
    if (!params.path) {
      return { success: false, error: 'Path is required' };
    }

    // Resolve path safely
    const fullPath = this._resolvePath(params.path);

    // Perform operation
    const content = await readFile(fullPath, 'utf-8');

    return {
      success: true,
      content,
      path: fullPath
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

### TypeScript Type Support

Photon extracts JSON schemas from TypeScript types:

```typescript
async process(params: {
  // Primitives
  name: string;
  age: number;
  active: boolean;

  // Optional
  nickname?: string;

  // Arrays
  tags: string[];
  scores?: number[];

  // Objects
  settings: {
    theme: string;
    notifications: boolean;
  };

  // Union types (as strings in schema)
  status: 'active' | 'inactive' | 'pending';
}) {
  return { processed: true };
}
```

**Current limitations:**
- No support for complex union types beyond string literals
- No support for generics or mapped types
- Use interfaces/types for complex nested objects

### Private Methods

Methods starting with `_` or marked `private` are **not exposed as tools**:

```typescript
export default class MyMCP {
  // Public tool
  async publicMethod(params: { input: string }) {
    return this._helper(params.input);
  }

  // Private helper (NOT a tool)
  private _helper(input: string) {
    return input.toUpperCase();
  }

  // Also private (NOT a tool)
  async _privateMethod() {
    return "Not exposed";
  }
}
```

---

## Lifecycle Hooks

Photon supports two optional lifecycle hooks:

### onInitialize

Called once when the MCP server starts:

```typescript
async onInitialize() {
  console.error('Starting up...');
  console.error(`Working directory: ${this.workdir}`);

  // Initialize resources
  await this._connectDatabase();
  await this._loadConfig();

  console.error('✅ Ready');
}
```

**Use cases:**
- Log configuration
- Validate environment
- Initialize connections
- Load resources

### onShutdown

Called when the MCP server is shutting down:

```typescript
async onShutdown() {
  console.error('Shutting down...');

  // Clean up resources
  await this.db?.close();
  await this.httpClient?.dispose();

  console.error('✅ Shutdown complete');
}
```

**Use cases:**
- Close database connections
- Clean up temp files
- Flush caches
- Save state

### Complete Example

```typescript
import Database from 'better-sqlite3';

export default class SqliteMCP {
  private db?: Database.Database;

  constructor(private dbPath: string = join(homedir(), 'data.db')) {}

  async onInitialize() {
    console.error(`Opening database: ${this.dbPath}`);
    this.db = new Database(this.dbPath);
    console.error('✅ Database ready');
  }

  async onShutdown() {
    console.error('Closing database...');
    this.db?.close();
    console.error('✅ Database closed');
  }

  async query(params: { sql: string }) {
    if (!this.db) throw new Error('Database not initialized');
    const result = this.db.prepare(params.sql).all();
    return { success: true, rows: result };
  }
}
```

---

## Common Patterns

### Filesystem Operations

```typescript
import { readFile, writeFile, readdir } from 'fs/promises';
import { join, resolve, relative } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

export default class Filesystem {
  constructor(
    private workdir: string = join(homedir(), 'Documents'),
    private maxFileSize: number = 10485760
  ) {
    if (!existsSync(workdir)) {
      throw new Error(`Directory does not exist: ${workdir}`);
    }
  }

  async read(params: { path: string }) {
    const fullPath = this._resolvePath(params.path);
    const content = await readFile(fullPath, 'utf-8');
    return { success: true, content };
  }

  async write(params: { path: string; content: string }) {
    const fullPath = this._resolvePath(params.path);
    await writeFile(fullPath, params.content, 'utf-8');
    return { success: true, path: fullPath };
  }

  // Security: prevent directory traversal
  private _resolvePath(path: string): string {
    const resolved = resolve(this.workdir, path);
    const rel = relative(this.workdir, resolved);

    if (rel.startsWith('..')) {
      throw new Error('Access denied: path outside working directory');
    }

    return resolved;
  }
}
```

### HTTP Requests

```typescript
export default class Fetch {
  constructor(
    private timeout: number = 5000,
    private maxRedirects: number = 5
  ) {}

  async get(params: { url: string; headers?: Record<string, string> }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(params.url, {
        method: 'GET',
        headers: params.headers,
        signal: controller.signal,
        redirect: 'follow'
      });

      const data = await response.text();

      return {
        success: true,
        status: response.status,
        data,
        headers: Object.fromEntries(response.headers)
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async post(params: {
    url: string;
    body: string | object;
    headers?: Record<string, string>;
  }) {
    const body = typeof params.body === 'string'
      ? params.body
      : JSON.stringify(params.body);

    const headers = {
      'Content-Type': 'application/json',
      ...params.headers
    };

    const response = await fetch(params.url, {
      method: 'POST',
      headers,
      body
    });

    return {
      success: response.ok,
      status: response.status,
      data: await response.text()
    };
  }
}
```

### Database Operations

```typescript
import Database from 'better-sqlite3';
import { join } from 'path';
import { homedir } from 'os';

export default class Sqlite {
  private db?: Database.Database;

  constructor(
    private dbPath: string = join(homedir(), 'data.db'),
    private readonly: boolean = false
  ) {}

  async onInitialize() {
    this.db = new Database(this.dbPath, {
      readonly: this.readonly
    });
    console.error(`Database ready: ${this.dbPath}`);
  }

  async onShutdown() {
    this.db?.close();
  }

  async query(params: { sql: string; params?: any[] }) {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare(params.sql);
      const rows = params.params
        ? stmt.all(...params.params)
        : stmt.all();

      return { success: true, rows };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async execute(params: { sql: string; params?: any[] }) {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const stmt = this.db.prepare(params.sql);
      const result = params.params
        ? stmt.run(...params.params)
        : stmt.run();

      return {
        success: true,
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
```

### Shell Commands

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default class Git {
  constructor(
    private repoPath: string = process.cwd(),
    private timeout: number = 10000
  ) {}

  async status(params: {}) {
    return this._exec('git status --porcelain');
  }

  async log(params: { count?: number }) {
    const count = params.count || 10;
    return this._exec(`git log -n ${count} --oneline`);
  }

  async commit(params: { message: string }) {
    return this._exec(`git commit -m "${params.message}"`);
  }

  private async _exec(command: string) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.repoPath,
        timeout: this.timeout
      });

      return {
        success: true,
        output: stdout || stderr
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
```

---

## Testing and Development

### Local Development

**1. Create MCP:**
```bash
photon init my-tool
```

**2. Edit file:**
```bash
# Opens ~/.photon/my-tool.photon.ts
code ~/.photon/my-tool.photon.ts
```

**3. Run in dev mode:**
```bash
photon mcp my-tool --dev
```

Dev mode features:
- ✅ Hot reload on file changes
- ✅ Detailed error messages
- ✅ Console logging visible

**4. Validate:**
```bash
photon validate my-tool
```

Shows:
- Tool count
- Schema extraction results
- Compilation errors

### Testing with MCP Inspector

Use the official MCP Inspector:

```bash
# Install globally
npm install -g @modelcontextprotocol/inspector

# Test your MCP
npx @modelcontextprotocol/inspector photon my-tool.photon.ts
```

### Manual Testing

Create a test script:

```typescript
// test.ts
import { join } from 'path';
import { homedir } from 'os';

async function test() {
  // Import your MCP class
  const { default: MyMCP } = await import('./my-tool.photon.ts');

  // Instantiate with test config
  const mcp = new MyMCP(join(homedir(), 'test-data'));

  // Initialize
  await mcp.onInitialize?.();

  // Test tools
  const result = await mcp.myTool({ input: 'test' });
  console.log('Result:', result);

  // Cleanup
  await mcp.onShutdown?.();
}

test().catch(console.error);
```

Run:
```bash
npx tsx test.ts
```

### Debugging

**Enable verbose logging:**
```typescript
async onInitialize() {
  console.error('Configuration:');
  console.error(JSON.stringify({
    workdir: this.workdir,
    enabled: this.enabled
  }, null, 2));
}
```

**Check environment variables:**
```bash
# List all environment variables
env | grep MY_TOOL

# Run with specific vars
MY_TOOL_WORKDIR=/tmp/test photon my-tool --dev
```

**Validate schemas:**
```bash
photon validate my-tool
```

---

## Deployment

### Claude Desktop

**1. Generate config:**
```bash
photon info my-tool --mcp
```

**Output:**
```json
{
  "mcpServers": {
    "my-tool": {
      "command": "npx",
      "args": ["@portel/photon", "mcp", "my-tool"],
      "env": {
        "MY_TOOL_WORKDIR": "~/Documents",
        "MY_TOOL_MAX_FILE_SIZE": "10485760"
      }
    }
  }
}
```

**2. Add to Claude Desktop config:**

macOS:
```bash
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Windows:
```bash
code %APPDATA%\Claude\claude_desktop_config.json
```

**3. Restart Claude Desktop**

### Claude Code CLI

Add to `.claude/claude.json`:

```json
{
  "mcpServers": {
    "my-tool": {
      "command": "photon",
      "args": ["mcp", "my-tool"],
      "env": {
        "MY_TOOL_WORKDIR": "${workspaceFolder}/data"
      }
    }
  }
}
```

### Cursor/Windsurf

Add to MCP settings:

```json
{
  "mcpServers": {
    "my-tool": {
      "command": "npx",
      "args": ["@portel/photon", "mcp", "my-tool"]
    }
  }
}
```

### Environment Variables

**Option 1: In MCP config (recommended):**
```json
{
  "my-tool": {
    "command": "photon",
    "args": ["mcp", "my-tool"],
    "env": {
      "MY_TOOL_API_KEY": "sk-...",
      "MY_TOOL_ENDPOINT": "https://api.example.com"
    }
  }
}
```

**Option 2: System environment:**
```bash
export MY_TOOL_API_KEY="sk-..."
photon mcp my-tool
```

**Option 3: .env file (not recommended for production):**
```bash
# .env
MY_TOOL_API_KEY=sk-...
```

---

## How Photon Works

Understanding Photon's internals helps debug issues and optimize performance.

### Architecture Overview

```
┌─────────────────────────────────────────┐
│         .photon.ts file                 │
│  export default class MyMCP { ... }     │
└────────────────┬────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────┐
│           Loader (loader.ts)            │
│  1. Compile TypeScript → JavaScript     │
│  2. Extract constructor parameters      │
│  3. Resolve environment variables       │
│  4. Instantiate class with config       │
└────────────────┬────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────┐
│      Schema Extractor (schema.ts)       │
│  1. Parse JSDoc comments                │
│  2. Extract TypeScript types            │
│  3. Generate JSON schemas               │
└────────────────┬────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────┐
│         MCP Server (server.ts)          │
│  1. Implement MCP protocol              │
│  2. List tools (from public methods)    │
│  3. Call tools (invoke class methods)   │
│  4. Handle lifecycle (init/shutdown)    │
└────────────────┬────────────────────────┘
                 │
                 ↓
┌─────────────────────────────────────────┐
│      stdio/JSON-RPC Transport           │
│  Communicate with MCP clients via       │
│  standard input/output                  │
└─────────────────────────────────────────┘
```

### Compilation Process

**1. Source → JavaScript:**
```typescript
// Input: calculator.photon.ts
export default class Calculator {
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }
}

// Output: Compiled JavaScript (ESM)
export default class Calculator {
  async add(params) {
    return params.a + params.b;
  }
}
```

**Tool:** esbuild (fast TypeScript compiler)

**Cache:** `~/.cache/photon-mcp/compiled/{hash}.js`

**2. Constructor Parameter Extraction:**
```typescript
// From source file (not compiled)
constructor(private workdir: string = '/default')

// Extracted parameters:
[
  {
    name: 'workdir',
    type: 'string',
    hasDefault: true,
    defaultValue: '/default'
  }
]
```

**3. Environment Variable Resolution:**
```typescript
// Parameter: workdir
// MCP name: filesystem
// Env var: FILESYSTEM_WORKDIR

const envValue = process.env.FILESYSTEM_WORKDIR;
const finalValue = envValue || defaultValue;
```

### Schema Extraction

**Input (TypeScript + JSDoc):**
```typescript
/**
 * Add two numbers together
 * @param a First number
 * @param b Second number
 */
async add(params: { a: number; b: number }) {
  return params.a + params.b;
}
```

**Output (JSON Schema):**
```json
{
  "name": "add",
  "description": "Add two numbers together",
  "inputSchema": {
    "type": "object",
    "properties": {
      "a": {
        "type": "number",
        "description": "First number"
      },
      "b": {
        "type": "number",
        "description": "Second number"
      }
    },
    "required": ["a", "b"]
  }
}
```

**Process:**
1. Parse JSDoc with regex
2. Extract TypeScript types from source
3. Map TS types → JSON Schema types
4. Combine descriptions with schemas

### MCP Protocol Implementation

**Tool listing:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "result": {
    "tools": [
      {
        "name": "add",
        "description": "Add two numbers together",
        "inputSchema": { ... }
      }
    ]
  }
}
```

**Tool call:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "add",
    "arguments": { "a": 5, "b": 3 }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      { "type": "text", "text": "8" }
    ]
  }
}
```

### Hot Reload

In `--dev` mode:

1. **Watch file:** `chokidar` monitors `.photon.ts`
2. **On change:**
   - Recompile with esbuild
   - Reload class dynamically
   - Re-extract schemas
   - Update tool registry
3. **Server continues:** No restart needed

---

## Best Practices

### Security

**1. Path Traversal Protection:**
```typescript
private _resolvePath(userPath: string): string {
  const resolved = resolve(this.workdir, userPath);
  const rel = relative(this.workdir, resolved);

  if (rel.startsWith('..') || resolve(rel) === rel) {
    throw new Error('Access denied: path outside working directory');
  }

  return resolved;
}
```

**2. Input Validation:**
```typescript
async process(params: { email: string }) {
  // Validate format
  if (!params.email.includes('@')) {
    return { success: false, error: 'Invalid email format' };
  }

  // Sanitize input
  const email = params.email.trim().toLowerCase();

  // Process safely
  return await this._processEmail(email);
}
```

**3. Command Injection Prevention:**
```typescript
// ❌ BAD: Direct string interpolation
async git(params: { message: string }) {
  await exec(`git commit -m "${params.message}"`); // Vulnerable!
}

// ✅ GOOD: Use parameterized commands
async git(params: { message: string }) {
  // Escape or use library
  const escaped = params.message.replace(/"/g, '\\"');
  await exec(`git commit -m "${escaped}"`);
}

// ✅ BETTER: Use child_process with args array
import { spawn } from 'child_process';
async git(params: { message: string }) {
  return new Promise((resolve) => {
    spawn('git', ['commit', '-m', params.message]);
  });
}
```

**4. File Size Limits:**
```typescript
async read(params: { path: string }) {
  const fullPath = this._resolvePath(params.path);
  const stats = await stat(fullPath);

  if (stats.size > this.maxFileSize) {
    return {
      success: false,
      error: `File too large: ${stats.size} bytes (max: ${this.maxFileSize})`
    };
  }

  return { success: true, content: await readFile(fullPath, 'utf-8') };
}
```

### Performance

**1. Lazy Initialization:**
```typescript
export default class Database {
  private db?: DatabaseConnection;

  async query(params: { sql: string }) {
    if (!this.db) {
      this.db = await this._connect();
    }
    return this.db.execute(params.sql);
  }
}
```

**2. Connection Pooling:**
```typescript
export default class HTTP {
  private agent?: Agent;

  constructor() {
    this.agent = new Agent({
      keepAlive: true,
      maxSockets: 10
    });
  }

  async fetch(params: { url: string }) {
    return fetch(params.url, { agent: this.agent });
  }
}
```

**3. Streaming Large Files:**
```typescript
async readLarge(params: { path: string }) {
  const stream = createReadStream(this._resolvePath(params.path));
  let content = '';

  for await (const chunk of stream) {
    content += chunk;
  }

  return { success: true, content };
}
```

### Error Handling

**1. Structured Errors:**
```typescript
async process(params: { input: string }) {
  try {
    // Validate
    if (!params.input) {
      return {
        success: false,
        error: 'Input is required',
        code: 'MISSING_INPUT'
      };
    }

    // Process
    const result = await this._process(params.input);

    return {
      success: true,
      result,
      timestamp: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    };
  }
}
```

**2. Graceful Degradation:**
```typescript
async fetch(params: { url: string }) {
  try {
    return await this._fetchWithRetry(params.url, 3);
  } catch (error) {
    // Log but don't crash
    console.error('Fetch failed:', error);
    return {
      success: false,
      error: 'Service temporarily unavailable'
    };
  }
}
```

### Documentation

**1. Comprehensive JSDoc:**
```typescript
/**
 * Search for text patterns in files (grep-like functionality)
 *
 * Recursively searches through files in the specified directory,
 * matching lines that contain the search pattern. Results include
 * file paths, line numbers, and matched content.
 *
 * @param pattern Text pattern to search for (case-sensitive)
 * @param path Directory to search in (relative to working directory, default: root)
 * @param filePattern Optional file pattern (e.g., "*.ts" for TypeScript files)
 * @returns List of matches with file, line number, and content
 */
async search(params: {
  pattern: string;
  path?: string;
  filePattern?: string;
}) {
  // Implementation
}
```

**2. File Header:**
```typescript
/**
 * Filesystem - File and directory operations
 *
 * Provides essential file system utilities: read, write, list, search, delete.
 * All paths are resolved relative to the configured working directory for security.
 *
 * Common use cases:
 * - Organize documents: "Categorize my documents by topic"
 * - Search files: "Find all PDFs about project planning"
 * - Bulk operations: "Move all .txt files to Archive folder"
 *
 * Configuration:
 * - workdir: Working directory (default: ~/Documents)
 * - maxFileSize: Max file size in bytes (default: 10MB)
 * - allowHidden: Allow hidden files (default: false)
 *
 * Dependencies: None (uses Node.js built-in fs)
 *
 * @version 2.0.0
 * @author Your Name
 * @license MIT
 */
```

---

## Troubleshooting

### Common Issues

**1. "Cannot find module" error:**

```
Error: Cannot find module 'my-dependency'
```

**Solution:** Install dependencies in the same directory:
```bash
cd ~/.photon
npm install my-dependency
```

**2. Environment variables not working:**

```
Error: API key is required
```

**Solution:** Check environment variable naming:
```bash
# For MCP named "my-tool" with parameter "apiKey"
export MY_TOOL_API_KEY="your-key"

# Or use --config to see correct names
photon my-tool --config
```

**3. Constructor validation fails:**

```
Error: Working directory does not exist: /invalid/path
```

**Solution:** The MCP loads but tools fail with helpful error. Users see:
```
Configuration Error: Working directory does not exist: /invalid/path

To configure this MCP, set environment variables:
  FILESYSTEM_WORKDIR=~/Documents

Or add to your MCP config:
{
  "env": {
    "FILESYSTEM_WORKDIR": "/path/to/docs"
  }
}
```

**4. Hot reload not working:**

**Solution:** Check file permissions and paths:
```bash
# Ensure file is writable
chmod +w ~/.photon/my-tool.photon.ts

# Check for syntax errors
photon validate my-tool
```

**5. Schema extraction fails:**

```
Warning: Could not extract schema for tool 'myTool'
```

**Solution:** Ensure proper TypeScript types:
```typescript
// ❌ BAD: No type annotations
async myTool(params) { }

// ✅ GOOD: Explicit types
async myTool(params: { input: string }) { }
```

### Debugging Tips

**1. Enable verbose logging:**
```typescript
async onInitialize() {
  console.error('[debug] Configuration:', this);
  console.error('[debug] Environment:', process.env);
}
```

**2. Validate schemas:**
```bash
photon validate my-tool
```

Shows:
- ✅ Tools found: 5
- ✅ Schemas extracted: 5
- ❌ Compilation errors

**3. Test compilation:**
```bash
# Compile manually
npx esbuild my-tool.photon.ts --bundle --platform=node --format=esm
```

**4. Check MCP protocol:**
```bash
# Use MCP Inspector
npx @modelcontextprotocol/inspector photon my-tool
```

**5. Verify environment:**
```bash
# List environment variables
env | grep MY_TOOL

# Test with specific values
MY_TOOL_DEBUG=true photon my-tool --dev
```

### Getting Help

1. **Check examples:** `examples/` directory has working MCPs
2. **Read logs:** stderr output shows detailed error messages
3. **Validate:** Use `photon validate my-tool`
4. **GitHub Issues:** https://github.com/portel-dev/photon-mcp/issues
5. **MCP Docs:** https://modelcontextprotocol.io/

---

## Advanced Topics

### Custom Type Mappings

For complex types, use JSDoc to guide schema generation:

```typescript
/**
 * Process user data
 * @param user User object with name, age, and email
 */
async process(params: {
  user: {
    name: string;
    age: number;
    email: string;
  }
}) {
  // Photon extracts nested object schema automatically
}
```

### Pre-generated Schemas

For bundled MCPs, create `.photon.schema.json`:

```json
[
  {
    "name": "add",
    "description": "Add two numbers",
    "inputSchema": {
      "type": "object",
      "properties": {
        "a": { "type": "number" },
        "b": { "type": "number" }
      },
      "required": ["a", "b"]
    }
  }
]
```

Photon will use this instead of extracting from source.

### Multi-File MCPs

While Photon is designed for single-file MCPs, you can import utilities:

```typescript
// helpers.ts
export function sanitize(input: string) {
  return input.trim().toLowerCase();
}

// my-tool.photon.ts
import { sanitize } from './helpers.js';

export default class MyTool {
  async process(params: { input: string }) {
    return sanitize(params.input);
  }
}
```

Compile with esbuild's bundling (automatic in Photon).

---

## Summary

**Key Takeaways:**

1. **Single File** - One `.photon.ts` = one MCP server
2. **No Config** - Convention over configuration
3. **Constructor → Env Vars** - Automatic config injection
4. **Public Methods → Tools** - No decorators needed
5. **JSDoc → Descriptions** - Documentation becomes MCP metadata
6. **TypeScript → JSON Schema** - Type safety built-in
7. **Lifecycle Hooks** - Optional `onInitialize` and `onShutdown`
8. **Hot Reload** - Dev mode for rapid iteration

**Next Steps:**

1. Create your first MCP: `photon init my-tool`
2. Study examples: `examples/` directory
3. Test in dev mode: `photon my-tool --dev`
4. Deploy to Claude Desktop: `photon my-tool --config`

Happy building! 🚀
