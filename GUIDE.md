# Photon MCP Developer Guide

Complete guide to creating `.photon.ts` files and understanding how Photon works.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Creating Your First MCP](#creating-your-first-mcp)
3. [Constructor Configuration](#constructor-configuration)
4. [Writing Tool Methods](#writing-tool-methods)
5. [Docblock Tags](#docblock-tags)
6. [Return Formatting](#return-formatting)
7. [Dependency Injection](#dependency-injection)
8. [Assets and UI](#assets-and-ui)
9. [Advanced Workflows](#advanced-workflows)
10. [Lifecycle Hooks](#lifecycle-hooks)
11. [Common Patterns](#common-patterns)
12. [CLI Command Reference](#cli-command-reference)
13. [Testing and Development](#testing-and-development)
14. [Deployment](#deployment)
15. [How Photon Works](#how-photon-works)
16. [Best Practices](#best-practices)
17. [Troubleshooting](#troubleshooting)

---

## Quick Start

Create your first MCP in 3 steps:

```bash
# 1. Create new MCP
photon maker new my-tool

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
- `boolean` - "true"/"1" → `true`, "false"/"0" → `false`

### Documentation

To provide descriptions for these parameters in the CLI and MCP help, use a `Configuration:` section in your class-level JSDoc:

```typescript
/**
 * Filesystem MCP
 * 
 * Configuration:
 * - workdir: Path to the working directory
 * - maxFileSize: Maximum file size in bytes
 */
export default class Filesystem {
  constructor(private workdir: string, private maxFileSize: number) {}
}
```

> [!NOTE]
> Arrays (`string[]`, etc.) are not yet supported for direct environment variable mapping in the constructor. Use interactive elicitation in tool methods for complex user input.

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

## Docblock Tags

Photon uses JSDoc tags to extract rich metadata and configure runtime behavior.

### Class-Level Tags
Place these in the main JSDoc comment at the top of your `.photon.ts` file.

| Tag | Usage |
|---|---|
| `@version` | Specifies Photon version (e.g., `1.0.0`) |
| `@author` | Specifies the author |
| `@license` | Specifies the license (e.g., `MIT`) |
| `@repository` | Link to source repository |
| `@homepage` | Link to project homepage |
| `@dependencies` | NPM dependencies to auto-install (`axios@^1.0.0, lodash`) |
| `@mcps` | MCP dependencies for injection and diagramming |
| `@photons` | Photon dependencies for injection and diagramming |
| `@stateful` | Set to `true` for stateful workflows (default: `false`) |
| `@idleTimeout` | Idle timeout in ms before process exit |
| `@mcp` | Declare an MCP dependency source |
| `@photon` | Declare another Photon dependency source |
| `@ui` | Define a UI template asset for MCP Apps |
| `@prompt` | Define a static prompt asset |
| `@resource` | Define a static resource asset |

### Method-Level Tags
Place these immediately preceding a tool method.

| Tag | Usage |
|---|---|
| `@param` | Describes a parameter for MCP/CLI help |
| `@example` | Provides a code example for the tool |
| `@format` | Output format hint (see [Return Formatting](#return-formatting)) |
| `@ui` | Link tool to a class-level UI asset |

### Parameter Validation Tags
Inline tags within `@param` descriptions to add schema constraints.

| Tag | Usage | Example |
|---|---|---|
| `{@min N}` | Minimum value | `* @param age Age {@min 0}` |
| `{@max N}` | Maximum value | `* @param score Score {@max 100}` |
| `{@format T}` | Data format | `* @param email Email {@format email}` |
| `{@pattern R}` | Regex pattern | `* @param zip Zip {@pattern ^[0-9]{5}$}` |
| `{@example V}` | Parameter example | `* @param city City {@example London}` |

---

## Return Formatting

Photon allows hinting the data shape and type of return values using the `@format` tag. This helps the CLI and Web interfaces render the data optimally.

### Structural Formats
Structural hints tell Photon how to organize the data table or tree.

| Format | Description | Used For |
|---|---|---|
| `primitive` | Formats result as a single value | Strings, numbers, booleans |
| `table` | Formats results as a grid | Arrays of objects |
| `list` | Formats results as a bulleted list | Arrays of primitives |
| `tree` | Formats results as a hierarchy | Nested objects/JSON |
| `none` | Raw JSON output | Complex data without specific shape |

### Content & Code Formats
Content hints specify the syntax for text coloring and highlighting.

- **Content Types**: `json`, `markdown`, `yaml`, `xml`, `html`
- **Code Blocks**: `code` (generic) or `code:language` (e.g., `code:typescript`)

**Example:**
```typescript
/**
 * List files in directory
 * @format table
 */
async ls(params: { path: string }) {
  return await this._listFiles(params.path);
}

/**
 * Get system report
 * @format markdown
 */
async report() {
  return "# System Status\n- CPU: 10%\n- RAM: 4GB";
}
```

---

## Dependency Injection

Photon makes it easy to compose complex workflows by injecting other MCPs or Photons directly into your class instances.

### Declaring Dependencies
Use `@mcp` and `@photon` tags at the class level to declare external dependencies.

```typescript
/**
 * @mcp github anthropics/mcp-server-github
 * @mcp storage filesystem
 */
export default class Manager {
  constructor(
    private github: any, // Injected from @mcp github
    private fs: any      // Injected from @mcp storage
  ) {}
}
```

### Injection Rules
- **Non-primitive parameters** in the constructor that match a declared dependency name are automatically injected.
- The name in the constructor must match the first argument of the `@mcp` or `@photon` tag.

---

## Assets and UI

Photon supports "MCP Apps" by allowing you to bundle UI templates, prompts, and static resources directly with your Photon server.

### Declaring Assets
Use `@ui`, `@prompt`, and `@resource` tags at the class level to link local files as assets.

```typescript
/**
 * @ui dashboard ./ui/dashboard.html
 * @prompt welcome ./prompts/welcome-message.txt
 * @resource data ./assets/data.json
 */
export default class MyApp {
  /**
   * Show the main dashboard
   * @ui dashboard
   */
  async showDashboard() {
    return { success: true };
  }
}
```

### Linking UI to Tools
Use the method-level `@ui` tag to specify which UI template should be rendered when a tool is invoked in a compatible interface (like the Photon Playground or a custom web UI).

---

## Advanced Workflows

Photon supports interactive and stateful workflows using `async` generators and the `ask`/`emit` pattern.

### Interactive Tools (ask/emit)
Use the `ask`/`emit` pattern to create interactive CLI tools or conversational MCPs.

```typescript
export default class InteractiveTool {
  async *survey() {
    // Emit progress
    yield { emit: 'progress', value: 0.2, message: 'Starting survey...' };

    // Ask for text
    const name = yield { ask: 'text', message: 'What is your name?' };

    // Ask for confirmation
    const confirm = yield { ask: 'confirm', message: `Is ${name} correct?` };

    if (!confirm) return "Aborted";

    // Ask for selection
    const color = yield { 
      ask: 'select', 
      message: 'Favorite color?', 
      options: ['Red', 'Green', 'Blue'] 
    };

    yield { emit: 'progress', value: 1.0, message: 'Done!' };
    return `Name: ${name}, Favorite Color: ${color}`;
  }
}
```

### Stateful Workflows
Mark a class as `@stateful` and use `checkpoint` yields to persist state across sessions. This is ideal for long-running workflows or tasks that require manual approval.

```typescript
/**
 * @stateful true
 */
export default class Workflow {
  async *execute(params: { task: string }) {
    console.error("Starting task:", params.task);

    // Initial work
    const step1 = await someAsyncWork();

    // Persist state here. If process restarts, it resumes from here.
    yield { checkpoint: 'step1_complete', data: { step1 } };

    // Next step
    const step2 = await nextWork(step1);
    
    return { step1, step2 };
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

## CLI Command Reference

Photon provides a comprehensive suite of commands for running, managing, and developing MCPs.

### Runtime Commands
| Command | Usage |
|---|---|
| `photon mcp <name>` | Run a Photon as an MCP server. Use `--dev` for hot-reload. |
| `photon cli <photon> [method]` | Execute Photon methods directly from the command line. |
| `photon serve <name>` | Launch an SSE server for browser or remote access. |
| `photon playground` | Open an interactive web UI for all your installed Photons. |

### Management Commands
| Command | Usage |
|---|---|
| `photon add <name>` | Install a Photon from the marketplace. |
| `photon remove <name>` | Remove an installed Photon. |
| `photon upgrade [name]` | Upgrade Photon(s) to the latest version. |
| `photon info [name]` | Show detailed metadata and configuration for a Photon. |
| `photon search <query>` | Search enabled marketplaces for Photons. |

### Developer Tools (maker)
| Command | Usage |
|---|---|
| `photon maker new <name>` | Create a new Photon from the default template. |
| `photon maker validate <name>` | Validate syntax, schemas, and dependencies. |
| `photon maker sync` | Generate `photons.json` manifest for a marketplace. |
| `photon maker init` | Set up a marketplace with auto-sync git hooks. |
| `photon maker diagram <name>` | Generate a Mermaid dependency/flow diagram. |

### Maintenance
| Command | Usage |
|---|---|
| `photon doctor` | Diagnose your environment (Node, npm, ports, config). |
| `photon update` | Refresh marketplace indexes and check for CLI updates. |
| `photon clear-cache` | Clear compiled Photon artifacts. |

---

## Testing and Development

### Local Development

**1. Create MCP:**
```bash
photon maker new my-tool
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

### Cloudflare Workers

Deploy your Photon to the edge with Cloudflare Workers:

```bash
photon deploy cloudflare my-tool
```

This will:
1. Generate an optimized bundle.
2. Create a `wrangler.toml` configuration.
3. Deploy the service to your Cloudflare account.

Use `--dev` to enable the interactive playground in the deployed worker.

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

1. Create your first MCP: `photon maker new my-tool`
2. Study examples: `examples/` directory
3. Test in dev mode: `photon mcp my-tool --dev`
4. Deploy to Claude Desktop: `photon mcp my-tool --config`

Happy building! 🚀
