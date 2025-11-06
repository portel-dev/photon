# Photon MCP

> **Singular focus. Precise target.**

**Zero-install CLI for running single-file TypeScript MCPs**

Photon lets you create Model Context Protocol (MCP) servers using a single TypeScript file. No configuration, no decorators, no base classes required—just write a class with async methods and you're done.

Why laser-focused bulky AI toolsets when you can photon-focus at exactly what you need?

## Features

- 🚀 **Zero Install** - Run with `npx photon` (no global installation)
- 📝 **Single File** - One `.photon.ts` file = one MCP server
- 📦 **Auto Dependencies** - Automatic npm package installation from JSDoc tags
- 🔄 **Hot Reload** - Dev mode with automatic reloading on file changes
- 🎯 **Convention Over Configuration** - Auto-discover tools from class methods
- 📊 **Auto Schema Extraction** - Generate JSON schemas from TypeScript types
- 🛠️ **Simple API** - Just export a class with async methods
- 🔌 **MCP Compatible** - Works with Claude Desktop, Cursor, Windsurf, etc.

## Installation

### Option 1: Global Install (Recommended)

```bash
npm install -g @portel/photon
```

Then use the `photon` command directly:

```bash
photon calculator.photon.ts --dev
```

### Option 2: Zero Install (npx)

No installation needed—run directly with npx:

```bash
npx @portel/photon calculator.photon.ts --dev
```

## Quick Start

### Create a new Photon MCP

```bash
photon init calculator
```

MCPs are stored in `~/.photon/` by default and can be run from any directory!

This creates `calculator.photon.ts`:

```typescript
export default class Calculator {
  /**
   * Add two numbers together
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }
}
```

### Run in development mode

```bash
npx photon calculator.photon.ts --dev

# Or omit the extension:
npx photon calculator --dev
```

### Use with Claude Desktop

```bash
npx @portel/photon calculator --config
```

This outputs the config to add to Claude Desktop:

```json
{
  "calculator": {
    "command": "npx",
    "args": ["@portel/photon", "/absolute/path/to/calculator.photon.ts"]
  }
}
```

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS).

## 📦 Production-Ready MCPs

We maintain a registry of production-ready Photon MCPs at **[portel-dev/photons](https://github.com/portel-dev/photons)**:

- **GitHub Issues** - Manage GitHub repository issues (7 tools)
- **Slack** - Slack workspace integration (7 tools)
- **PostgreSQL** - Database operations with connection pooling (9 tools)
- **SQLite** - Local database operations (9 tools)
- **Web Fetch** - Web content fetching with markdown conversion (2 tools)
- **Memory** - Knowledge graph persistent memory (10 tools)

**Quick Install:**

```bash
# Install GitHub Issues MCP
curl -o ~/.photon/github-issues.photon.ts https://raw.githubusercontent.com/portel-dev/photons/main/github-issues.photon.ts

# Configure and run
export GITHUB_ISSUES_TOKEN="ghp_your_token"
photon github-issues --config
```

See the [Photons Registry](https://github.com/portel-dev/photons) for full documentation on each MCP.

## How It Works

Photon uses **convention over configuration**:

1. **File name** → MCP name
   `calculator.photon.ts` → `calculator` MCP

2. **Class name** → MCP name (alternative)
   `class Calculator` → `calculator` MCP

3. **Public async methods** → Tools
   ```typescript
   async add(...) { }  // → "add" tool
   async subtract(...) { }  // → "subtract" tool
   ```

4. **JSDoc comments** → Tool descriptions
   ```typescript
   /**
    * Add two numbers together  ← Tool description
    * @param a First number      ← Parameter description
    * @param b Second number
    */
   ```

5. **TypeScript types** → JSON schemas
   ```typescript
   async add(params: { a: number; b: number })
   // → inputSchema: { type: "object", properties: { a: { type: "number" }, ... } }
   ```

## Commands

### Run MCP Server

```bash
# Production mode (for MCP clients)
photon calculator

# Development mode (hot reload)
photon calculator --dev

# Generate Claude Desktop config
photon calculator --config
```

All MCPs are referenced by name only—no paths, no extensions!

### Create New MCP

```bash
photon init calculator
```

Creates `calculator.photon.ts` in `~/.photon/` (accessible from anywhere).

**Custom directory:**
```bash
photon --working-dir ./my-mcps init calculator
```

### List MCPs

```bash
photon list

# Or in custom directory
photon --working-dir ./my-mcps list
```

### Validate MCP

```bash
photon validate calculator
```

Validates syntax and extracts schemas without running.

### Working Directory

All commands use `~/.photon/` by default. Override with `--working-dir`:

```bash
photon --working-dir ./project-mcps init my-tool
photon --working-dir ./project-mcps list
photon --working-dir ./project-mcps my-tool --dev
```

## Writing Photon MCPs

### Basic Example

```typescript
export default class MyMCP {
  /**
   * Echo a message
   * @param message The message to echo
   */
  async echo(params: { message: string }) {
    return `Echo: ${params.message}`;
  }
}
```

### Lifecycle Hooks (Optional)

```typescript
export default class MyMCP {
  /**
   * Called when MCP is loaded
   */
  async onInitialize() {
    console.error('[my-mcp] Initialized');
  }

  /**
   * Called when MCP is shutting down
   */
  async onShutdown() {
    console.error('[my-mcp] Shutting down');
  }

  async myTool(params: { input: string }) {
    return `Processed: ${params.input}`;
  }
}
```

### Return Values

Photon accepts multiple return formats:

```typescript
// String
async tool1(params: {}) {
  return "Result as string";
}

// Object (will be JSON stringified)
async tool2(params: {}) {
  return { result: 42, status: "ok" };
}

// Success/content format
async tool3(params: {}) {
  return {
    success: true,
    content: "Tool executed successfully"
  };
}

// Success/error format
async tool4(params: {}) {
  return {
    success: false,
    error: "Something went wrong"
  };
}
```

### TypeScript Type Support

Photon extracts JSON schemas from TypeScript types:

```typescript
export default class AdvancedMCP {
  /**
   * Process data with various types
   * @param name User name
   * @param age User age
   * @param tags Optional tags
   * @param settings Configuration object
   */
  async process(params: {
    name: string;
    age: number;
    tags?: string[];  // Optional array
    settings: {
      enabled: boolean;
      count: number;
    };
  }) {
    return { processed: true };
  }
}
```

### Private Methods

Methods starting with `_` are private and won't become tools:

```typescript
export default class MyMCP {
  // Public tool
  async publicTool(params: {}) {
    return this._helperMethod();
  }

  // Private helper (NOT a tool)
  async _helperMethod() {
    return "This won't be exposed as a tool";
  }
}
```

## Examples

The repository includes three example Photon MCPs:

### Calculator

```bash
npx photon examples/calculator --dev
```

Basic arithmetic operations: `add`, `subtract`, `multiply`, `divide`, `power`

### String Utilities

```bash
npx photon examples/string --dev
```

Text manipulation: `uppercase`, `lowercase`, `slugify`, `reverse`, `wordCount`, `split`, `replace`, `titleCase`, `substring`

### Workflow

```bash
npx photon examples/workflow --dev
```

Task management: `list`, `get`, `create`, `updateStatus`, `delete`, `validate`

## Development Workflow

### Standard Workflow (Default: ~/.photon)

```bash
# 1. Create MCP
photon init my-tool

# 2. Edit ~/.photon/my-tool.photon.ts
export default class MyTool {
  async greet(params: { name: string }) {
    return `Hello, ${params.name}!`;
  }
}

# 3. Test from anywhere
cd ~/Documents  # Or any directory
photon my-tool --dev  # Works from anywhere!

# 4. Validate
photon validate my-tool

# 5. List all your MCPs
photon list

# 6. Keep MCPs up to date
photon upgrade --check  # Check for updates
photon upgrade          # Upgrade all MCPs
```

### Installing MCPs from Registries

Photon supports multiple MCP registries (similar to npm or Claude Code plugins):

```bash
# Install from registry
photon install github-issues

# Search for MCPs
photon registry:search slack

# List all registries
photon registry:list
```

### Managing Registries

**Add any GitHub repository as a registry** (just like Claude Code plugins):

```bash
# List all registries
photon registry:list

# Add custom registry (shorthand)
photon registry:add username/my-mcps

# Or use full GitHub URL
photon registry:add https://github.com/username/my-mcps

# Or with .git extension
photon registry:add https://github.com/username/my-mcps.git

# Remove registry (uses repo name)
photon registry:remove my-mcps

# Enable/disable registries
photon registry:enable my-mcps
photon registry:disable my-mcps

# Search across all enabled registries
photon registry:search github
```

**How it works:**
- Just provide `username/repo` or GitHub URL
- Registry name is automatically derived from repo name
- URLs are automatically converted to raw.githubusercontent.com
- Defaults to `/main` branch

**Examples:**
```bash
# Add your company's MCPs
photon registry:add acme-corp/mcps

# Add community MCPs
photon registry:add awesome-mcp/registry

# Add personal MCPs
photon registry:add myusername/my-photon-mcps
```

**Default Registry:** `photons` from `portel-dev/photons`

**Registry Config:** Stored in `~/.config/photon/registries.json`

```json
{
  "registries": [
    {
      "name": "photons",
      "url": "https://raw.githubusercontent.com/portel-dev/photons/main",
      "enabled": true
    },
    {
      "name": "my-mcps",
      "url": "https://raw.githubusercontent.com/username/my-mcps/main",
      "enabled": true
    }
  ]
}
```

### Keeping MCPs Updated

Photon automatically checks for updates across all enabled registries:

```bash
# Check for updates
photon upgrade --check

# Upgrade all MCPs
photon upgrade

# Upgrade specific MCP
photon upgrade github-issues
```

**Version information** is extracted from `@version` tags in MCP doc comments:

```typescript
/**
 * GitHub Issues MCP
 * @version 1.0.0
 * @author Portel
 */
```

When you run `photon upgrade`, it:
1. Extracts local version from `@version` tag
2. Searches all enabled registries for remote version
3. Compares versions (semver)
4. Downloads and updates if newer version available

### Project-Specific Workflow (Custom Directory)

```bash
# 1. Set up project MCPs directory
cd ~/my-project
mkdir mcps

# 2. Create and use MCPs in that directory
photon --working-dir ./mcps init project-tool
photon --working-dir ./mcps project-tool --dev

# 3. List project MCPs
photon --working-dir ./mcps list
```

### Add to Claude Desktop

```bash
photon my-tool --config
```

Copy the output to `claude_desktop_config.json` and restart Claude Desktop.

## FAQ

### Do I need to extend a base class?

No! Just export any class with async methods. Optionally, you can extend `PhotonMCP` for helper methods, but it's not required.

### How are parameters validated?

Photon extracts JSON schemas from your TypeScript types. MCP clients validate parameters before calling your tools.

### Can I use external packages?

Yes! Dependencies are **auto-installed** from JSDoc tags:

```typescript
/**
 * Fetch MCP - HTTP client utilities
 * @dependencies axios@^1.6.0
 */
import axios from 'axios';

export default class FetchMCP {
  async fetch(params: { url: string }) {
    const response = await axios.get(params.url);
    return response.data;
  }
}
```

**How it works:**
- Photon parses `@dependencies` tags from JSDoc comments
- Auto-installs to `~/.cache/photon-mcp/dependencies/{mcp-name}/`
- Works like `npx` or Python's `uv` - zero manual setup
- Cached per MCP, isolated from other MCPs
- Only installs once, reuses on subsequent runs

**Formats supported:**
```typescript
@dependencies axios@^1.0.0                    // Single dependency
@dependencies axios@^1.0.0, date-fns@^2.0.0  // Multiple on one line
@dependencies @octokit/rest@^3.1.0           // Scoped packages
```

No manual `npm install` needed!

### How does hot reload work?

In `--dev` mode, Photon watches your `.photon.ts` file. When you save changes:
1. File is recompiled with esbuild
2. Class is reloaded
3. Schemas are re-extracted
4. Server continues running with new code

### Where are compiled files cached?

`~/.cache/photon-mcp/compiled/`

Cache is content-based—if you edit your file, a new cache entry is created.

### Where are my MCPs stored?

**Default location:** `~/.photon/`
- Created with: `photon init calculator`
- Accessible from anywhere: `photon calculator --dev`

**Custom location:** Use `--working-dir`
- Create: `photon --working-dir ./mcps init tool`
- Run: `photon --working-dir ./mcps tool --dev`

Use default (`~/.photon/`) for personal tools, custom directories for project-specific MCPs.

### Can I pre-generate schemas?

Yes! Create a `.photon.schema.json` file next to your `.photon.ts`:

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

This is useful for bundled/packaged MCPs where TypeScript sources aren't included.

## Architecture

```
┌─────────────────┐
│ .photon.ts file │
└────────┬────────┘
         │
         ↓
   ┌─────────────┐
   │   Loader    │ ← Compiles TypeScript with esbuild
   └─────┬───────┘   Loads class dynamically
         │
         ↓
 ┌──────────────────┐
 │ Schema Extractor │ ← Parses JSDoc + TypeScript types
 └────────┬─────────┘   Generates JSON schemas
          │
          ↓
  ┌───────────────┐
  │  MCP Server   │ ← Implements MCP protocol
  └───────┬───────┘   Using @modelcontextprotocol/sdk
          │
          ↓
  ┌──────────────┐
  │ stdio/JSON-RPC│ ← Communicates with MCP clients
  └──────────────┘   (Claude Desktop, Cursor, etc.)
```

## Comparison with Other MCP Frameworks

| Feature | Photon | Traditional MCP Server | MicroMCP (gateway) |
|---------|--------|------------------------|---------------------|
| File count | 1 | Multiple | Multiple |
| Configuration | None | Extensive | Extensive |
| Base classes | Optional | Required | Required |
| Schema generation | Automatic | Manual | Manual |
| Hot reload | Built-in | Manual setup | No |
| Use case | Rapid prototyping | Enterprise apps | Multi-service composition |

## Contributing

Contributions welcome! Please open issues and PRs at [github.com/portel-dev/photon-mcp](https://github.com/portel-dev/photon-mcp).

## License

MIT © Portel

## Related Projects

- **NCP** - MCP orchestration platform that uses Photon for internal MCPs
- **@modelcontextprotocol/sdk** - Official MCP TypeScript SDK

---

**Made with ⚛️ by Portel**
