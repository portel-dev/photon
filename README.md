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

### MCP Capabilities Supported

Photon implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) with full support for:

- ✅ **Tools** - Execute operations and commands (`listChanged: true`)
- ✅ **Prompts** (Templates) - Reusable text generation with variables (`listChanged: true`)
- ✅ **Resources** (Static) - Read-only content and data (`listChanged: true`)
- ✅ **Hot Reload Notifications** - Sends `list_changed` events to clients in dev mode

When running in `--dev` mode, Photon automatically sends MCP notifications when your code changes:
- `notifications/tools/list_changed` - Tools updated
- `notifications/prompts/list_changed` - Templates updated
- `notifications/resources/list_changed` - Static resources updated

This allows MCP clients like Claude Desktop to automatically refresh without restart.

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
npx photon mcp calculator --dev

# Or with file path:
npx photon mcp calculator.photon.ts --dev
```

### Use with Claude Desktop

```bash
npx @portel/photon get calculator --mcp
```

This outputs the MCP config to add to Claude Desktop:

```json
{
  "calculator": {
    "command": "npx",
    "args": ["@portel/photon", "mcp", "calculator"]
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
# Add from marketplace
photon add github-issues

# Configure and run
export GITHUB_ISSUES_TOKEN="ghp_your_token"
photon get github-issues --mcp
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
photon mcp calculator

# Development mode (hot reload)
photon mcp calculator --dev
```

### List and Inspect Photons

```bash
# List all Photons
photon get

# Show details for one
photon get calculator

# Get MCP config for all Photons
photon get --mcp

# Get MCP config for one Photon
photon get calculator --mcp
```

### Create New Photon

```bash
photon init calculator
```

Creates `calculator.photon.ts` in `~/.photon/` (accessible from anywhere).

**Custom directory:**
```bash
photon --working-dir ./my-mcps init calculator
```

### Validate Photon

```bash
photon validate calculator
```

Validates syntax and extracts schemas without running.

### Working Directory

All commands use `~/.photon/` by default. Override with `--working-dir`:

```bash
photon --working-dir ./project-mcps init my-tool
photon --working-dir ./project-mcps get
photon --working-dir ./project-mcps mcp my-tool --dev
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
    console.error('Initialized');
  }

  /**
   * Called when MCP is shutting down
   */
  async onShutdown() {
    console.error('Shutting down');
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

### Templates (MCP Prompts)

Templates are reusable text generation patterns with variable substitution. They map to:
- **MCP Prompts** (slash commands in Claude Desktop)
- **HTTP Template Endpoints** (POST endpoints)
- **CLI Help Generators**

Mark a method as a Template using the `@Template` JSDoc tag and `Template` return type:

```typescript
import { Template, asTemplate } from '@portel/photon';

export default class MyMCP {
  /**
   * Generate a code review prompt
   * @Template
   * @param language Programming language
   * @param code Code to review
   */
  async codeReview(params: { language: string; code: string }): Promise<Template> {
    const prompt = `Review this ${params.language} code:\n\`\`\`\n${params.code}\n\`\`\``;
    return asTemplate(prompt);
  }
}
```

**Advanced Template with Messages:**

```typescript
import { TemplateResponse } from '@portel/photon';

/**
 * Generate a commit message with examples
 * @Template
 * @param type Type of change (feat, fix, docs)
 */
async commitPrompt(params: { type: string }): Promise<TemplateResponse> {
  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `I need a ${params.type} commit message` }
      },
      {
        role: 'assistant',
        content: { type: 'text', text: 'Here are some examples...' }
      }
    ]
  };
}
```

### Static Resources (MCP Resources)

Static resources expose read-only content and data. They map to:
- **MCP Resources** (context data in Claude Desktop)
- **HTTP GET Endpoints**
- **CLI Read Commands**

Mark a method as Static using the `@Static` JSDoc tag with a URI pattern:

```typescript
import { Static, asStatic } from '@portel/photon';

export default class MyMCP {
  /**
   * Get API documentation
   * @Static api://docs
   * @mimeType text/markdown
   */
  async apiDocs(params: {}): Promise<Static> {
    const docs = `# API Documentation\n\n...`;
    return asStatic(docs);
  }

  /**
   * Get README for a project type
   * @Static readme://{projectType}
   * @mimeType text/markdown
   * @param projectType Type of project (api, library, cli)
   */
  async readme(params: { projectType: string }): Promise<Static> {
    const content = `# ${params.projectType} Project\n\n...`;
    return asStatic(content);
  }
}
```

**URI Patterns:**
- **Static URI**: `@Static api://docs` - No parameters, returned in `resources/list`
- **URI Template**: `@Static readme://{projectType}` - Has parameters, returned in `resources/templates/list`
- Parameters are extracted from URI and passed to the method

**How Clients Use URI Templates:**
1. Client requests `resources/templates/list`
2. Sees template: `readme://{projectType}`
3. Extracts variable name: `projectType`
4. Prompts user for value (or autocompletes)
5. Substitutes to create URI: `readme://api`
6. Calls `resources/read` with resolved URI
7. Server parses parameters and returns rendered content

**MIME Types:**
- `text/plain` (default)
- `text/markdown`
- `application/json`
- Any standard MIME type

**Caching:**
- Each unique resolved URI is cacheable by the client
- `readme://api` and `readme://library` are cached separately
- Cache invalidated when `notifications/resources/list_changed` is sent

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

The repository includes example Photon MCPs:

### Content (Templates & Static)

```bash
npx photon --working-dir examples mcp content --dev
```

Demonstrates Templates (MCP Prompts) and Static resources (MCP Resources):
- **Templates**: `codeReview`, `prDescription`, `commitPrompt`
- **Statics**: `apiDocs`, `configReference`, `readmeTemplate`
- **Tools**: `wordCount`

### Calculator

```bash
npx photon --working-dir examples mcp math --dev
```

Basic arithmetic operations: `add`, `subtract`, `multiply`, `divide`, `power`

### String Utilities

```bash
npx photon --working-dir examples mcp text --dev
```

Text manipulation: `uppercase`, `lowercase`, `slugify`, `reverse`, `wordCount`, `split`, `replace`, `titleCase`, `substring`

### Workflow

```bash
npx photon --working-dir examples mcp workflow --dev
```

Task management: `list`, `get`, `create`, `updateStatus`, `delete`, `validate`

## Development Workflow

### Standard Workflow (Default: ~/.photon)

```bash
# 1. Create Photon
photon init my-tool

# 2. Edit ~/.photon/my-tool.photon.ts
export default class MyTool {
  async greet(params: { name: string }) {
    return `Hello, ${params.name}!`;
  }
}

# 3. Test from anywhere
cd ~/Documents  # Or any directory
photon mcp my-tool --dev  # Works from anywhere!

# 4. Validate
photon validate my-tool

# 5. List all your Photons
photon get

# 6. Get MCP config
photon get my-tool --mcp
```

### Installing Photons from Marketplaces

Photon supports multiple marketplaces (similar to npm or Claude Code plugins):

```bash
# Add Photon from marketplace
photon add github-issues

# Search for Photons
photon search slack

# List all marketplaces
photon marketplace list
```

### Managing Marketplaces

**Add any GitHub repository as a marketplace** (just like Claude Code plugins):

```bash
# List all marketplaces
photon marketplace list

# Add marketplace - Multiple formats supported:

# 1. GitHub shorthand
photon marketplace add username/my-photons

# 2. GitHub HTTPS
photon marketplace add https://github.com/username/my-photons

# 3. GitHub SSH
photon marketplace add git@github.com:username/my-photons.git

# 4. Direct URL
photon marketplace add https://example.com/photons

# 5. Local filesystem path
photon marketplace add ./my-local-photons
photon marketplace add ~/Documents/my-photons

# Remove marketplace
photon marketplace remove my-photons

# Search across all marketplaces
photon search github
```

**Marketplace Structure:**
```
repo/
├── .marketplace/
│   └── photons.json          # Marketplace manifest
├── calculator.photon.ts       # Photon files in root
├── weather.photon.ts
└── github-issues.photon.ts
```

**Manifest Format (`.marketplace/photons.json`):**
```json
{
  "name": "my-photons",
  "description": "Collection of useful Photons",
  "photons": [
    {
      "name": "calculator",
      "version": "1.0.0",
      "description": "Basic arithmetic operations",
      "source": "../calculator.photon.ts",
      "hash": "sha256:abc123...",
      "tools": ["add", "subtract", "multiply", "divide"]
    }
  ]
}
```

**Create Your Own Marketplace:**
```bash
# 1. Organize your Photons
mkdir my-photons && cd my-photons
cp ~/.photon/*.photon.ts .

# 2. Generate marketplace manifest
photon marketplace init

# 3. Push to GitHub
git init
git add .
git commit -m "Initial marketplace"
git push origin main

# 4. Share with others
# Users can now: photon marketplace add username/my-photons
```

**Default Marketplace:** `photons` from `portel-dev/photons`

**Marketplace Config:** Stored in `~/.config/photon/marketplaces.json`

```json
{
  "marketplaces": [
    {
      "name": "photons",
      "url": "https://raw.githubusercontent.com/portel-dev/photons/main"
    },
    {
      "name": "my-photons",
      "url": "https://raw.githubusercontent.com/username/my-photons/main"
    }
  ]
}
```

### Metadata and Integrity

Photon tracks installation metadata for each Photon:

```bash
# View metadata
photon get github-issues

# Output shows:
# Version: 1.0.0
# Marketplace: photons (https://github.com/portel-dev/photons)
# Installed: 1/1/2025
# Status: ⚠️ Modified locally  # If you edited the file
```

**Features:**
- **Version tracking** - Know which version you have installed
- **Modification detection** - SHA-256 hash comparison alerts you to local changes
- **Marketplace attribution** - See where each Photon came from
- **Integrity verification** - Detect tampering or corruption

### Project-Specific Workflow (Custom Directory)

```bash
# 1. Set up project Photons directory
cd ~/my-project
mkdir mcps

# 2. Create and use Photons in that directory
photon --working-dir ./mcps init project-tool
photon --working-dir ./mcps mcp project-tool --dev

# 3. List project Photons
photon --working-dir ./mcps get
```

### Add to Claude Desktop

```bash
photon get my-tool --mcp
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
