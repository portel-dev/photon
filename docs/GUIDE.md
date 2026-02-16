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
11. [Configuration Convention](#configuration-convention)
12. [Reactive Collections](#reactive-collections)
13. [Real-Time Sync](#real-time-sync)
14. [Common Patterns](#common-patterns)
15. [CLI Command Reference](#cli-command-reference)
16. [Testing and Development](#testing-and-development)
17. [Deployment](#deployment)
18. [How Photon Works](#how-photon-works)
19. [Best Practices](#best-practices)
20. [Troubleshooting](#troubleshooting)

---

## Quick Start



The fastest way to use Photon is via the **Beam**, a visual dashboard for managing your MCPs.

### 1. Install & Launch
Install the global package and run the `photon` command to open the dashboard in the web browser:

```bash
npm install -g @portel/photon
photon
```

### 2. Create an MCP
Ready to code? Create a new tool in seconds:

```bash
# 1. Generate template
photon maker new my-tool

# 2. Edit ~/.photon/my-tool.photon.ts
export default class MyTool {
  async greet(params: { name: string }) {
    return `Hello, ${params.name}!`;
  }
}

# 3. Run in dev mode
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

Photon uses JSDoc-style docblock tags to extract metadata, configure tools, and generate documentation.

### Class-Level Tags
Place these in the JSDoc comment at the top of your `.photon.ts` file.

| Tag | Usage | Example |
|---|---|---|
| `@version` | Photon version | `@version 1.0.0` |
| `@author` | Author name | `@author Jane Doe` |
| `@license` | License type | `@license MIT` |
| `@repository` | Source repository URL | `@repository github.com/user/repo` |
| `@homepage` | Project homepage | `@homepage example.com` |
| `@runtime` | **Required** runtime version range | `@runtime ^1.5.0` |
| `@dependencies` | NPM packages to auto-install | `@dependencies axios@^1.0.0` |
| `@mcp` | Inject MCP dependency | `@mcp github anthropics/mcp` |
| `@photon` | Inject Photon dependency | `@photon utils ./utils.photon.ts` |
| `@stateful` | Enable stateful mode | `@stateful true` |
| `@idleTimeout` | Idle timeout in ms | `@idleTimeout 300000` |
| `@ui` | Define UI template asset | `@ui main ./ui/index.html` |
| `@prompt` | Define prompt asset | `@prompt system ./prompts/sys.txt` |
| `@resource` | Define resource asset | `@resource data ./data.json` |

### Method-Level Tags
Place these immediately preceding a tool method.

| Tag | Usage | Example |
|---|---|---|
| `@param` | Describe parameter | `@param name User name` |
| `@returns` | Describe return value | `@returns The result` |
| `@example` | Provide usage example | `@example await tool.run()` |
| `@format` | Output format hint | `@format table` |
| `@icon` | Tool icon (emoji/name) | `@icon 🧮` |
| `@autorun` | Auto-run in UI | `@autorun` |
| `@ui` | Link to UI template | `@ui main` |

### Daemon Tags (Advanced)
Enable background features handled by the Photon Daemon.

| Tag | Usage | Example |
|---|---|---|
| `@webhook` | Expose as HTTP webhook | `@webhook stripe` |
| `@scheduled` | Cron schedule | `@scheduled 0 0 * * *` |
| `@locked` | Distributed lock | `@locked resource:write` |

### Inline Parameter Tags
Use these *within* `@param` descriptions for validation and UI generation.

| Tag | functionality | Example |
|---|---|---|
| `{@min N}` | Minimum value | `@param age {@min 18}` |
| `{@max N}` | Maximum value | `@param score {@max 100}` |
| `{@pattern R}` | Regex pattern | `@param code {@pattern ^[A-Z]{3}$}` |
| `{@choice A,B}` | Enum/Choice | `@param color {@choice red,blue}` |
| `{@field T}` | HTML input type | `@param bio {@field textarea}` |
| `{@format T}` | Data format | `@param email {@format email}` |
| `{@example V}` | Example value | `@param city {@example London}` |
| `{@label L}` | Custom UI label | `@param id {@label User ID}` |

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
 | `grid` | Formats results as a visual grid | Arrays of objects/images |
 | `card` | Formats result as a detailed card | Single object |
 | `tree` | Formats results as a hierarchy | Nested objects/JSON |
 | `none` | Raw JSON output | Complex data without specific shape |
 
 ### Content & Code Formats
 Content hints specify the syntax for text coloring and highlighting.
 
 - **Content Types**: `json`, `markdown`, `yaml`, `xml`, `html`, `mermaid`
 - **Code Blocks**: `code` (generic) or `code:language` (e.g., `code:typescript`)
 
 ### Advanced Layout Hints
 For `list`, `table`, and `grid` formats, you can specify layout hints using nested syntax:
 
 ```typescript
 /**
  * @format list {@title name, @subtitle email, @icon avatar}
  */
 ```
 
 | Hint | Description |
 |---|---|
 | `@title field` | Primary display text |
 | `@subtitle field` | Secondary display text |
 | `@icon field` | Leading icon/image |
 | `@badge field` | Status badge |
 | `@columns N` | Grid column count |
 | `@style S` | Style: `plain`, `grouped`, `inset` |
 
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

Photon uses constructor parameters as the single injection point for all dependencies: environment variables, MCP clients, photon instances, and persisted state. See [Constructor Injection](core/CONSTRUCTOR-INJECTION.md) for the complete reference.

### Declaring Dependencies
Use `@mcp` and `@photon` tags at the class level to declare external dependencies.

```typescript
/**
 * @mcp github anthropics/mcp-server-github
 * @mcp storage filesystem
 */
export default class Manager {
  constructor(
    private apiKey: string,  // Env var: MANAGER_API_KEY
    private github: any,     // Injected from @mcp github
    private storage: any     // Injected from @mcp storage
  ) {}
}
```

### Injection Rules
- **Primitive parameters** (`string`, `number`, `boolean`) → mapped to environment variables
- **Non-primitive parameters** matching an `@mcp` declaration → MCP client proxy
- **Non-primitive parameters** matching a `@photon` declaration → loaded photon instance
- **Non-primitive parameters** with defaults on `@stateful` photons → restored from persisted state

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

### MCP Apps Compatibility (SEP-1865)

Photon implements the **MCP Apps Extension (SEP-1865)**, the official standard for interactive UIs in MCP. This means:

1. **`ui://` Resource URIs**: Tools with linked UIs expose `_meta.ui.resourceUri` pointing to `ui://photon-name/ui-id`
2. **JSON-RPC Protocol**: UI iframes communicate via standard `ui/initialize`, `ui/ready`, and `tools/call` messages
3. **Cross-Platform Support**: UIs built for Claude, ChatGPT, or any MCP Apps-compatible host work in Photon

#### Protocol Messages

| Message | Direction | Purpose |
|---------|-----------|---------|
| `ui/initialize` | Host → App | Initialize with theme, capabilities, dimensions |
| `ui/ready` | App → Host | App is ready to receive data |
| `tools/call` | App → Host | Request tool execution from the UI |
| `ui/notifications/tool-result` | Host → App | Push tool result to UI |

#### Client APIs

Photon injects three APIs into UI iframes for maximum compatibility:

```javascript
// 1. Photon Bridge (recommended)
window.photon.callTool('search', { query: 'test' });
window.photon.onResult(data => console.log(data));
window.photon.theme; // 'light' | 'dark'

// 2. OpenAI Apps SDK compatible
window.openai.callTool('search', { query: 'test' });
window.openai.theme;
window.openai.setWidgetState({ count: 1 });

// 3. Generic MCP Bridge
window.mcp.requestToolCall('search', { query: 'test' });
```

#### Building Compatible UIs

UIs that work with the official MCP Apps SDK (`@modelcontextprotocol/ext-apps`) will work in Photon without modification:

```typescript
// Using official MCP Apps SDK
import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'My App', version: '1.0.0' });
app.connect();
app.ontoolresult = (result) => {
  // Handle result
};
```

Or use Photon's native API:

```javascript
// Using Photon Bridge (no external dependency)
window.photon.onResult(result => {
  document.getElementById('output').textContent = result;
});
```

#### Resources

- [MCP Apps Specification](https://modelcontextprotocol.io/docs/extensions/apps)
- [SEP-1865 GitHub](https://github.com/modelcontextprotocol/ext-apps)
- [Platform Compatibility Source](./src/auto-ui/platform-compat.ts)

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

### Stateful Persistence via Constructor

For simpler stateful photons that don't need generators or checkpoints, `@stateful true` combined with constructor defaults gives you automatic persistence across daemon restarts:

```typescript
/**
 * @stateful true
 */
export default class List {
  items: string[];
  constructor(items: string[] = []) {
    this.items = items;
  }

  add(item: string): void {
    this.items.push(item);
    // Reactive array auto-persists state to disk
  }

  getAll(): string[] {
    return this.items;
  }
}
```

The runtime snapshots non-primitive constructor parameters on every mutation and restores them via constructor injection on restart. See [Constructor Injection](core/CONSTRUCTOR-INJECTION.md) for the full design.

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

## Configuration Convention

The `configure()` method is a by-convention pattern for photon configuration. Similar to how `main()` makes a photon a UI application, `configure()` makes it a configurable photon.

### Why Use configure()?

When a photon needs persistent settings that:
- Are shared across all instances (MCP, Beam UI, CLI)
- Should be collected once during install/setup
- Need to work alongside environment variables

### Basic Pattern

```typescript
import { PhotonMCP, loadPhotonConfig, savePhotonConfig } from '@portel/photon-core';

interface MyConfig {
  apiEndpoint: string;
  maxRetries?: number;
  enableCache?: boolean;
}

export default class MyService extends PhotonMCP {
  /**
   * Configure this photon
   *
   * Set your API endpoint and options. This is stored persistently
   * so all instances use the same configuration.
   */
  async configure(params: {
    /** The API endpoint URL */
    apiEndpoint: string;
    /** Max retry attempts (default: 3) */
    maxRetries?: number;
    /** Enable response caching */
    enableCache?: boolean;
  }): Promise<{ success: boolean; config: MyConfig }> {
    const config: MyConfig = {
      apiEndpoint: params.apiEndpoint,
      maxRetries: params.maxRetries ?? 3,
      enableCache: params.enableCache ?? true,
    };

    savePhotonConfig('my-service', config);
    return { success: true, config };
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<MyConfig & { configPath: string }> {
    const config = loadPhotonConfig<MyConfig>('my-service', {
      apiEndpoint: '',
      maxRetries: 3,
      enableCache: true,
    });
    return {
      ...config,
      configPath: getPhotonConfigPath('my-service'),
    };
  }

  // Use config in your methods
  async fetchData() {
    const config = loadPhotonConfig<MyConfig>('my-service');
    const response = await fetch(config.apiEndpoint);
    // ...
  }
}
```

### How It Works

| Aspect | Description |
|--------|-------------|
| Storage | `~/.photon/{photonName}/config.json` |
| Scope | Shared across all instances |
| Detection | Schema extractor finds `configure()` method |
| Tools | Neither `configure()` nor `getConfig()` appear as MCP tools |

### Configuration Utilities

```typescript
import {
  loadPhotonConfig,    // Load config with defaults
  savePhotonConfig,    // Save config
  hasPhotonConfig,     // Check if configured
  getPhotonConfigPath, // Get config file path
  deletePhotonConfig,  // Remove config
} from '@portel/photon-core';

// Load with defaults
const config = loadPhotonConfig('my-photon', { theme: 'dark' });

// Save config
savePhotonConfig('my-photon', { theme: 'light', fontSize: 14 });

// Check if configured
if (!hasPhotonConfig('my-photon')) {
  console.log('Please run configure() first');
}
```

### Combined Setup: Environment Variables + Configuration

During install or reconfigure, both are collected together:

```typescript
/**
 * My API Client
 *
 * @env API_KEY - Your secret API key
 */
export default class ApiClient extends PhotonMCP {
  constructor(private apiKey: string) {
    super();
  }

  /**
   * Configure additional settings
   */
  async configure(params: {
    /** API endpoint URL */
    endpoint: string;
    /** Request timeout in ms */
    timeout?: number;
  }) {
    savePhotonConfig('api-client', params);
    return { success: true };
  }
}
```

Setup flow:
1. User installs photon
2. Framework detects: `apiKey` (env var) + `endpoint`, `timeout` (config)
3. Single setup UI collects all values
4. Env vars saved to `.env`, config to `~/.photon/api-client/config.json`

### Convention Methods Summary

| Method | Purpose | Appears as Tool? |
|--------|---------|------------------|
| `main()` | UI entry point | ✓ Yes |
| `configure()` | Persistent configuration | ✗ No |
| `getConfig()` | Read configuration | ✗ No |
| `onInitialize()` | Startup lifecycle | ✗ No |
| `onShutdown()` | Shutdown lifecycle | ✗ No |

### Reconfiguration

Already-configured photons can be reconfigured at any time. In Beam, users click the config icon on an installed photon to edit its settings. On the CLI, run the configure method again.

When you reconfigure, new values are merged with existing ones. If your config had `{ endpoint: "https://old.api.com", timeout: 5000 }` and you only submit a new `endpoint`, the `timeout` stays put. No data lost, no surprises.

Under the hood, Beam calls `reloadFile` after saving the updated config, which recompiles the photon and picks up the new values without restarting the server. It is, genuinely, that simple.

---

## Reactive Collections

Photon can make your plain arrays reactive, which means mutations like `.push()` and `.splice()` automatically emit events. No decorators, no wrapper functions, no "please remember to call `notifyListeners()`." You just write normal TypeScript.

There are three levels, depending on how much you want.

### Truly Zero Effort

If your class extends `PhotonMCP` and has array properties, the compiler does everything:

```typescript
import { PhotonMCP } from '@portel/photon-core';

interface Task {
  id: string;
  text: string;
}

export default class TodoList extends PhotonMCP {
  items: Task[] = [];  // Completely normal TypeScript

  async add(params: { text: string }) {
    this.items.push({ id: crypto.randomUUID(), text: params.text });
    // Auto-emits 'items:added'. You wrote zero extra code.
  }

  async remove(params: { id: string }) {
    const idx = this.items.findIndex(t => t.id === params.id);
    if (idx !== -1) this.items.splice(idx, 1);
    // Auto-emits 'items:removed'
  }
}
```

The compiler detects `extends PhotonMCP` plus array properties, and auto-injects the reactive wiring at build time. Your source stays clean.

### Level 1: Explicit Import

If you prefer being explicit about what is happening (or your class does not extend PhotonMCP), import `Array` from photon-core. It shadows the global `Array` with a reactive version:

```typescript
import { Array } from '@portel/photon-core';

interface Task {
  id: string;
  text: string;
}

export default class TodoList {
  items: Array<Task> = [];

  async add(params: { text: string }) {
    this.items.push({ id: crypto.randomUUID(), text: params.text });
    // Auto-emits 'items:added'
  }
}
```

Same result, just more visible. The `= []` initializer gets transformed to `= new Array()` at compile time.

### Level 2: Rich Collections

For cases where you need query methods (filtering, sorting, grouping), use `Collection<T>`. Think of it as a reactive array that also happens to have opinions about data access:

```typescript
import { Collection } from '@portel/photon-core';

interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

export default class ProductCatalog extends PhotonMCP {
  products = new Collection<Product>();

  async inStock() {
    return this.products.where('stock', '>', 0);
  }

  async byCategory(params: { category: string }) {
    return this.products
      .where('category', params.category)
      .sortBy('price');
  }

  async summary() {
    return {
      total: this.products.count(),
      categories: this.products.groupBy('category'),
      avgPrice: this.products.avg('price'),
    };
  }
}
```

Collections give you convenience methods like `.where()`, `.pluck()`, `.groupBy()`, `.sortBy()`, `.avg()`, and `.count()`. They also provide rendering hints for auto-UI (tables, cards, charts). And they are still reactive, so mutations emit events just like plain arrays.

### How It Works

The magic is split between compile time and runtime:

1. **Compile time**: The Photon compiler sees `= []` on class properties and transforms it to `= new Array()` (the reactive version, not the global one). For `extends PhotonMCP` classes, the import is auto-injected.

2. **Runtime**: After the class is instantiated, the loader inspects instance properties. For any `ReactiveArray`, it auto-wires:
   - `_propertyName` to the property key (so events know their source)
   - `_emitter` bound to `instance.emit.bind(instance)` (so events flow through the photon's event system)

3. **You**: Write `this.items.push(thing)` and move on with your life.

---

## Real-Time Sync

Photon methods can push updates to all connected clients in real time. This is how a kanban board updated in Claude Desktop also updates in Beam, or how a long-running task can stream progress without anyone polling.

### Emitting Events

Any method can call `this.emit()` to broadcast data:

```typescript
export default class KanbanBoard extends PhotonMCP {
  async move(params: { taskId: string; column: string }) {
    await this.updateTask(params.taskId, { column: params.column });

    // Push update to every connected client
    this.emit('board:updated', {
      taskId: params.taskId,
      column: params.column,
    });

    return { success: true };
  }
}
```

### Event Flow

The path from `this.emit()` to a browser tab is short but crosses a few boundaries:

```
this.emit('board:updated', data)
       │
       ▼
  Daemon pub/sub (Unix socket)
       │
       ▼
  SSE push to all connected clients
       │
       ▼
  Beam tab, Claude Desktop, other Beam tabs...
```

Every client subscribed to that photon's channel gets the event. If you have Beam open in two browser tabs and Claude Desktop running, all three update simultaneously.

### Receiving Events in Custom UIs

If your photon has a `@ui` template, the bridge API gives you a callback:

```javascript
// Inside your @ui HTML template
window.photon.onEmit((event) => {
  if (event.emit === 'board:updated') {
    // Re-render the board with new data
    renderBoard(event.data);
  }
});
```

That is the entire client-side setup. The bridge handles SSE subscription, reconnection, and message parsing.

### Reactive Collections + Real-Time Sync

These two features compose naturally. When a reactive array emits `items:added`, that event flows through the same daemon pub/sub pipeline:

```typescript
export default class TodoList extends PhotonMCP {
  items: Task[] = [];

  async add(params: { text: string }) {
    this.items.push({ id: crypto.randomUUID(), text: params.text });
    // 'items:added' auto-emits → daemon → SSE → all clients
  }
}
```

No explicit `this.emit()` needed. The reactive array handles it.

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
| `photon sse <name>` | Launch a single-tenant SSE server for browser or remote access. |
| `photon beam` | Open an interactive web UI for all your installed Photons (formerly playground). |
| `photon serve` | Start a local multi-tenant MCP server host for development. |
| `photon host <command>` | Manage cloud hosting: `deploy` (ship to cloud) or `preview` (run local sim). |

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

### Advanced
| Command | Usage |
|---|---|
| `photon test [name]` | Run test methods defined in your Photons (supports unit/integration). |
| `photon alias <name>` | Create a global CLI alias for a Photon (e.g. `run-my-tool`). |
| `photon marketplace` | Manage marketplace sources (add/remove git repos). |

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
photon maker validate my-tool
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
photon maker validate my-tool
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

Test your Photon locally in a simulated Cloudflare environment:
```bash
photon host preview cf my-tool
```

Deploy your Photon to the edge with Cloudflare Workers:
```bash
photon host deploy cloudflare my-tool
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

### Photon ID

Every photon instance is assigned a unique 12-character hash ID based on its file path:

```typescript
// Generated from path using SHA-256
// Path: /Users/you/.photon/kanban.photon.ts
// ID:   f5c5ee47905e

import { createHash } from 'crypto';

function generatePhotonId(photonPath: string): string {
  return createHash('sha256').update(photonPath).digest('hex').slice(0, 12);
}
```

**Why hashed IDs?**
- **Unique across systems**: Different installations get different IDs
- **Stable**: Same path always produces same ID
- **Multi-tenant safe**: No collisions between different users or projects
- **Short**: 12 characters is enough for practical uniqueness

**Where IDs are used:**
- **Channel subscriptions**: `{photonId}:{itemId}` format for daemon pub/sub
- **MCP responses**: `x-photon-id` header in tools/list
- **PhotonInfo**: `id` field in photon metadata

**Access in code:**

```typescript
// In your photon (via PhotonMCP base class)
export default class MyPhoton extends PhotonMCP {
  async myMethod() {
    console.log('My ID:', this.photonId);  // e.g., "f5c5ee47905e"
  }
}

// In Custom UI (via bridge)
const photonId = window.photon.photonId;
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

### Cache and Resilience

Photon caches compiled artifacts and installed dependencies so repeated startups are fast. Here is where things live and what happens when they go stale.

**Dependency cache**: `~/.cache/photon-mcp/dependencies/{cacheKey}/`

Each photon's `@dependencies` get their own isolated `node_modules`. The cache key is derived from the dependency list, so changing your `@dependencies` tag naturally creates a fresh cache.

**Auto-invalidation on photon-core updates**: The cache tracks the *resolved* version of `@portel/photon-core` (not the semver range). If you upgrade photon-core from 2.5.3 to 2.5.4, the next run detects the mismatch and rebuilds the dependency cache automatically. No manual intervention, no mysterious "it works on my machine" moments.

**Daemon auto-restart**: If the daemon process has crashed or become unreachable (ECONNREFUSED), the next CLI command automatically restarts it and retries the operation. You might notice a slightly longer first response, but that is the only visible sign.

**Manual cache clearing**: When all else fails:
```bash
photon clear-cache
```

This wipes compiled artifacts and dependency caches. The next run rebuilds everything from scratch.

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
photon maker validate my-tool
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
photon maker validate my-tool
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
3. **Validate:** Use `photon maker validate my-tool`
4. **GitHub Issues:** https://github.com/portel-dev/photon/issues
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
4. Deploy to Claude Desktop: `photon info my-tool --mcp`

Happy building! 🚀
