# Photon

**One file. Zero boilerplate. Pure business logic.**

Build MCP servers in a single TypeScript file — no infrastructure code required.

![Photon Logo](https://github.com/portel-dev/photon-mcp/raw/main/assets/photon-logo.png)

---

## The Problem

Traditional MCP servers scatter your logic across 4-6 files:

```
traditional-mcp/
├── server.ts         (50 lines of boilerplate)
├── transport.ts      (40 lines of setup)
├── schemas.ts        (40 lines of type definitions)
├── types.ts          (30 lines more types)
├── package.json      (dependencies)
└── business.ts       (20 lines of YOUR CODE)
```

**This creates real problems:**
- ❌ **For AI agents**: Scattered context across files makes understanding difficult
- ❌ **For humans**: Jump between files to understand one feature
- ❌ **For teams**: 200+ lines before you write business logic
- ❌ **For maintenance**: Changes require updating multiple files and configs

---

## The Solution

Photon puts everything in **one file**:

```typescript
/**
 * Analytics - Query company analytics database
 * @dependencies pg@^8.11.0
 */
import { Client } from 'pg';

export default class Analytics {
  private db: Client;

  constructor(
    private host: string,
    private database: string,
    private password: string
  ) {}

  async onInitialize() {
    this.db = new Client({
      host: this.host,
      database: this.database,
      password: this.password
    });
    await this.db.connect();
  }

  /**
   * Get revenue by date range
   * @param startDate Start date (YYYY-MM-DD)
   * @param endDate End date (YYYY-MM-DD)
   */
  async revenue(params: { startDate: string; endDate: string }) {
    const result = await this.db.query(
      'SELECT date, SUM(amount) FROM orders WHERE date BETWEEN $1 AND $2 GROUP BY date',
      [params.startDate, params.endDate]
    );
    return result.rows;
  }
}
```

**40 lines. One file. Production-ready.**

---

## Why One File Changes Everything

### 🤖 AI-Native Design

AI agents can now understand your entire MCP in one context:

```bash
# AI can read, understand, and suggest improvements
"Read my analytics.photon.ts and explain how it works"
"Review this photon for security issues"
"Add error handling to this photon"
```

Traditional MCPs require AI to piece together scattered files — Photons give complete context.

### 👤 Human-Friendly

- **Understand**: Read one file, understand the whole system
- **Review**: Code reviews are one file, one story
- **Debug**: All logic in one place, no jumping around
- **Learn**: New team members read one file

### 🔧 Fork-First Philosophy

Every photon is designed to be customized:

```bash
# Copy, modify, done — no build configs to update
cp ~/.photon/jira.photon.ts ~/.photon/my-jira.photon.ts
# Edit my-jira.photon.ts however you want
photon mcp my-jira  # Works immediately
```

**Use cases:**
- Add company-specific authentication
- Customize business logic
- Merge multiple photons
- Experiment without breaking originals

### 📦 Zero-Friction Dependencies

Dependencies are auto-installed via JSDoc (like `npx` or `uv`):

```typescript
/**
 * @dependencies axios@^1.6.0, lodash@^4.17.21
 */
```

No manual `npm install`. No `package.json`. Photon handles it.

---

## Quick Start

### Install

```bash
npm install -g @portel/photon
```

### Use Ready-Made Photons

```bash
# Browse 16+ production-ready photons
photon get

# Install any photon
photon add filesystem

# Run as MCP server
photon mcp filesystem
```

### Integrate with Your MCP Client

```bash
# Get configuration for any MCP client
photon get filesystem --mcp
```

Add the output to your MCP client's config file. **Consult your client's documentation** for setup instructions.

**MCP clients include:** Claude Desktop, Cursor, Zed, Continue, Cline, and more.

---

## The Value Proposition

| Metric | Traditional MCP | Photon |
|--------|-----------------|--------|
| **Setup Time** | 40 minutes | 5 minutes |
| **Lines of Code** | 200+ | ~40 |
| **Files Needed** | 4-6 files | 1 file |
| **Boilerplate** | Manual | Auto-handled |
| **Schema Generation** | Manual | Automatic from TypeScript |
| **Dependencies** | Manual npm install | Auto-installed from @dependencies |
| **Hot Reload** | Configure yourself | Built-in with --dev |
| **AI Context** | Scattered | Single file |

[See detailed comparison →](COMPARISON.md)

---

## How Photon Works

### Convention = Automation

**File Name → MCP Name**
```typescript
// analytics.photon.ts → "analytics" MCP
```

**Class Methods → Tools**
```typescript
async revenue() {}      // → "revenue" tool
async topCustomers() {} // → "topCustomers" tool
```

**TypeScript Types → JSON Schemas**
```typescript
async create(params: { title: string; priority: number }) {}
// Photon auto-generates JSON schema from TypeScript types
```

**JSDoc → Tool Descriptions**
```typescript
/**
 * Get revenue by date range
 * @param startDate Start date (YYYY-MM-DD)
 */
// Photon extracts descriptions automatically
```

**Constructor Parameters → Environment Variables**
```typescript
constructor(private host: string, private database: string) {}
// Maps to: ANALYTICS_HOST, ANALYTICS_DATABASE
```

**JSDoc @dependencies → Auto-Install**
```typescript
/**
 * @dependencies pg@^8.11.0, lodash@^4.17.21
 */
// Photon auto-installs on first run (like npx or uv)
```

---

## Available Photons

Production-ready photons from **[portel-dev/photons](https://github.com/portel-dev/photons)**:

| Category | Photons | Total Tools |
|----------|---------|-------------|
| **Databases** | PostgreSQL (7), MongoDB (13), Redis (18), SQLite (9) | 47 |
| **Infrastructure** | AWS S3 (11), Docker (10), Filesystem (13) | 34 |
| **Development** | Git (11), GitHub Issues (7) | 18 |
| **Communication** | Email (8), Slack (7) | 15 |
| **Productivity** | Google Calendar (9), Jira (10) | 19 |
| **Utilities** | Fetch (2), Time (3), Memory (10) | 15 |

**Total: 16 photons, 148 focused tools**

Browse and install:
```bash
photon get            # See all available photons
photon add postgres   # Install any photon
photon search git     # Search by keyword
```

---

## Create Your Own Photon

### 1. Initialize

```bash
photon init analytics
```

Creates `analytics.photon.ts` in `~/.photon/` (accessible from anywhere).

**Custom directory:**
```bash
photon --working-dir ./my-photons init analytics
```

### 2. Write Business Logic

```typescript
/**
 * Analytics - Query company analytics database
 * @dependencies pg@^8.11.0
 */
import { Client } from 'pg';

export default class Analytics {
  private db: Client;

  constructor(
    private host: string,
    private database: string,
    private password: string
  ) {}

  async onInitialize() {
    this.db = new Client({
      host: this.host,
      database: this.database,
      password: this.password
    });
    await this.db.connect();
  }

  /**
   * Get revenue by date range
   * @param startDate Start date (YYYY-MM-DD)
   * @param endDate End date (YYYY-MM-DD)
   */
  async revenue(params: { startDate: string; endDate: string }) {
    const result = await this.db.query(
      'SELECT date, SUM(amount) FROM orders WHERE date BETWEEN $1 AND $2 GROUP BY date',
      [params.startDate, params.endDate]
    );
    return result.rows;
  }

  async onShutdown() {
    await this.db.end();
  }
}
```

### 3. Run

```bash
# Development mode (hot reload)
photon mcp analytics --dev

# Production mode
photon mcp analytics
```

**That's it!** Photon handles:
- ✅ TypeScript compilation (via esbuild)
- ✅ Schema generation from types
- ✅ MCP protocol implementation
- ✅ Environment variable mapping
- ✅ Dependency installation (@dependencies)
- ✅ Hot reload in dev mode

**You focus on:** Your business logic
**Photon handles:** Everything else

---

## Commands Reference

### Global Options

```bash
--working-dir <dir>   # Use custom directory instead of ~/.photon
-V, --version         # Show version number
-h, --help            # Show help
```

### Development Commands

#### `photon init <name>`
Create a new `.photon.ts` file from template.

```bash
# Create in default directory (~/.photon)
photon init calculator

# Create in custom directory
photon --working-dir ./my-photons init calculator
```

#### `photon validate <name>`
Validate syntax and extract schemas without running.

```bash
photon validate calculator
```

Useful for:
- Checking syntax errors
- Testing schema generation
- CI/CD validation

### Running Photons

#### `photon mcp <name>`
Run a photon as an MCP server.

```bash
# Production mode
photon mcp calculator

# Development mode (hot reload on file changes)
photon mcp calculator --dev

# Validate configuration without running
photon mcp calculator --validate

# Show MCP configuration template
photon mcp calculator --config
```

**Options:**
- `--dev` - Enable hot reload for development
- `--validate` - Validate configuration without running server
- `--config` - Show configuration template and exit

### Inspect & Configure

#### `photon get [name]`
List all photons or show details for a specific one.

```bash
# List all installed photons
photon get

# Show details for one photon
photon get calculator

# Get MCP client configuration
photon get calculator --mcp
```

**Options:**
- `--mcp` - Output MCP server configuration for your client

### Marketplace Commands

#### `photon add <name>`
Install a photon from a marketplace.

```bash
# Install from any enabled marketplace
photon add filesystem

# Install from specific marketplace
photon add filesystem --marketplace portel-dev/photons
```

**Options:**
- `--marketplace <name>` - Specify which marketplace to use

#### `photon search <query>`
Search for photons across all enabled marketplaces.

```bash
photon search database
photon search git
```

#### `photon info <name>`
Show detailed information about a photon from marketplaces.

```bash
photon info postgres
```

Shows:
- Description
- Available tools
- Configuration requirements
- Marketplace source

#### `photon upgrade [name]`
Upgrade photons from marketplaces.

```bash
# Upgrade all photons
photon upgrade

# Upgrade specific photon
photon upgrade filesystem

# Check for updates without upgrading
photon upgrade --check
```

**Options:**
- `--check` - Only check for updates, don't install

#### `photon conflicts`
Show photons available in multiple marketplaces.

```bash
photon conflicts
```

Useful when same photon name exists in different marketplaces.

### Marketplace Management

#### `photon marketplace list`
List all configured marketplaces.

```bash
photon marketplace list
```

#### `photon marketplace add <repo>`
Add a new marketplace.

```bash
# GitHub shorthand
photon marketplace add username/repo

# Full HTTPS URL
photon marketplace add https://github.com/username/repo

# SSH URL
photon marketplace add git@github.com:username/repo.git

# Direct URL
photon marketplace add https://example.com/marketplace

# Local path
photon marketplace add ./my-local-marketplace
```

#### `photon marketplace remove <name>`
Remove a marketplace.

```bash
photon marketplace remove my-marketplace
```

#### `photon marketplace enable <name>`
Enable a previously disabled marketplace.

```bash
photon marketplace enable my-marketplace
```

#### `photon marketplace disable <name>`
Disable a marketplace without removing it.

```bash
photon marketplace disable my-marketplace
```

#### `photon marketplace update [name]`
Update marketplace metadata from remote.

```bash
# Update all marketplaces
photon marketplace update

# Update specific marketplace
photon marketplace update portel-dev/photons
```

### Advanced Commands

#### `photon sync marketplace [path]`
Generate marketplace manifest and documentation.

```bash
# Sync current directory
photon sync marketplace

# Sync specific directory
photon sync marketplace ./my-marketplace
```

Used when creating your own marketplace. See [Marketplace System](#marketplace-system).

#### `photon audit [name]`
Security audit of photon dependencies.

```bash
# Audit all photons
photon audit

# Audit specific photon
photon audit postgres
```

Checks for:
- Vulnerable dependencies
- Outdated packages
- Security advisories

---

## Marketplace System

### For Users: Install from Marketplace

```bash
# Install from official marketplace (portel-dev/photons)
photon add github-issues
photon add sqlite
photon add memory

# Search for photons
photon search slack
```

### For Teams: Create Your Marketplace

**Build an internal marketplace for your organization:**

```bash
# 1. Organize your photons
mkdir company-photons && cd company-photons
cp ~/.photon/*.photon.ts .

# 2. Generate marketplace manifest
photon sync marketplace

# 3. Push to GitHub/Git
git init
git add .
git commit -m "Initial marketplace"
git push origin main

# 4. Team members install
photon marketplace add company/photons
photon add internal-crm
photon add analytics-db
```

**Benefits:**
- 🔒 **Secure**: Your code, your infrastructure, your control
- 📦 **Easy**: Single-file photons are trivial to maintain
- 🎯 **Focused**: Build exact tools for your workflows
- 📊 **Traceable**: Git-based versioning and attribution

### Manage Marketplaces

```bash
# List all marketplaces
photon marketplace list

# Add marketplace (multiple formats supported)
photon marketplace add username/repo              # GitHub shorthand
photon marketplace add https://github.com/u/repo  # HTTPS
photon marketplace add git@github.com:u/repo.git  # SSH
photon marketplace add https://example.com/mkt    # Direct URL
photon marketplace add ./local-photons            # Local path

# Remove marketplace
photon marketplace remove <name>

# Search across all marketplaces
photon search <keyword>
```

---

## Advanced Features

### Lifecycle Hooks

```typescript
export default class MyPhoton {
  async onInitialize() {
    // Called when photon loads
    console.error('Photon initialized');
  }

  async onShutdown() {
    // Called on shutdown
    console.error('Photon shutting down');
  }

  async myTool(params: { input: string }) {
    return `Processed: ${params.input}`;
  }
}
```

### Templates (MCP Prompts)

```typescript
import { Template, asTemplate } from '@portel/photon';

export default class MyPhoton {
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

### Static Resources (MCP Resources)

```typescript
import { Static, asStatic } from '@portel/photon';

export default class MyPhoton {
  /**
   * Get API documentation
   * @Static api://docs
   * @mimeType text/markdown
   */
  async apiDocs(params: {}): Promise<Static> {
    const docs = `# API Documentation\n\n...`;
    return asStatic(docs);
  }
}
```

### Private Methods

Methods starting with `_` are private (not exposed as tools):

```typescript
export default class MyPhoton {
  // Public tool
  async publicTool(params: {}) {
    return this._helperMethod();
  }

  // Private helper (NOT exposed)
  async _helperMethod() {
    return "Internal logic only";
  }
}
```

---

## Integration with MCP Clients

Photon works with **any MCP client**:

- **Claude Desktop** (Anthropic)
- **Cursor** (IDE)
- **Zed** (IDE)
- **Continue** (VS Code extension)
- **Cline** (VS Code extension)
- ... and more

### Setup

```bash
# Get configuration for your MCP client
photon get <photon-name> --mcp
```

**Consult your MCP client's documentation** for:
- Config file location
- Configuration format
- Setup instructions

Example output:
```json
{
  "analytics": {
    "command": "photon",
    "args": ["mcp", "analytics"],
    "env": {
      "ANALYTICS_HOST": "localhost",
      "ANALYTICS_DATABASE": "company",
      "ANALYTICS_PASSWORD": "secret"
    }
  }
}
```

---

## Examples

The repository includes example photons in `examples/`:

### Content (Templates & Static Resources)
```bash
npx photon --working-dir examples mcp content --dev
```
Demonstrates Templates (MCP Prompts) and Static resources.

### Calculator
```bash
npx photon --working-dir examples mcp math --dev
```
Basic arithmetic operations.

### String Utilities
```bash
npx photon --working-dir examples mcp text --dev
```
Text manipulation tools.

### Workflow
```bash
npx photon --working-dir examples mcp workflow --dev
```
Task management system.

---

## Architecture

```
┌─────────────────────┐
│  .photon.ts file    │  ← Your single TypeScript file
└──────────┬──────────┘
           │
           ↓
   ┌───────────────┐
   │ Auto-Install  │  ← Reads @dependencies, installs packages
   └───────┬───────┘
           │
           ↓
   ┌───────────────┐
   │    Loader     │  ← Compiles TypeScript with esbuild
   └───────┬───────┘    Loads class dynamically
           │
           ↓
 ┌─────────────────────┐
 │  Schema Extractor   │  ← Parses JSDoc + TypeScript types
 └──────────┬──────────┘    Generates JSON schemas
            │
            ↓
    ┌──────────────┐
    │  MCP Server  │  ← Implements MCP protocol
    └──────┬───────┘    Using @modelcontextprotocol/sdk
           │
           ↓
   ┌──────────────┐
   │ stdio/JSON-RPC│  ← Communicates with MCP clients
   └──────────────┘    (Claude Desktop, Cursor, Zed, etc.)
```

---

## Philosophy

> **"Singular focus. Precise target."**

A **photon** is the smallest unit of light, delivering **singular focus** to a **precise target**.

Each Photon module embodies this principle:
- **Singular focus** - One responsibility, executed flawlessly
- **Precise target** - Clear purpose, clean API
- **Universal design** - Pure TypeScript, ready for future possibilities

---

## FAQ

### Do I need to extend a base class?

No! Just export any class with async methods. Photon handles the rest.

### How are parameters validated?

Photon extracts JSON schemas from your TypeScript types. MCP clients validate parameters before calling your tools.

### Can I use external packages?

Yes! Dependencies are **auto-installed** from JSDoc `@dependencies` tags (like `npx` or `uv`).

### How does hot reload work?

In `--dev` mode, Photon watches your `.photon.ts` file and recompiles on save.

### Where are compiled files cached?

`~/.cache/photon-mcp/compiled/`

### Where are my photons stored?

**Default:** `~/.photon/`
**Custom:** Use `--working-dir` flag

### Can I fork and customize photons?

Absolutely! That's the design. Copy any `.photon.ts` file, edit it, run it. No build config changes needed.

### How do I update photons?

```bash
photon upgrade        # Update all
photon upgrade <name> # Update specific photon
```

---

## Roadmap

### ✅ Version 1.0 - MCP Servers (Available Now)

Build and run photons as MCP servers for AI assistants. Works with Claude Desktop, Cursor, Zed, Continue, Cline, and any MCP-compatible client.

### 🔮 Future Versions

Photon's framework-agnostic design enables future deployment targets:
- **CLI tools** - Run photons as terminal commands
- **More targets** - Additional deployment options as the ecosystem grows

**The vision:** Write focused business logic once. As Photon evolves, deploy it to multiple targets.

---

## Documentation

- **[GUIDE.md](GUIDE.md)** - Complete tutorial for creating photons
- **[ADVANCED.md](ADVANCED.md)** - Lifecycle hooks, performance, production deployment
- **[COMPARISON.md](COMPARISON.md)** - Detailed comparison vs traditional MCP
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and solutions
- **[CHANGELOG.md](CHANGELOG.md)** - Version history

---

## Contributing

Contributions welcome! Please open issues and PRs at [github.com/portel-dev/photon-mcp](https://github.com/portel-dev/photon-mcp).

---

## Related Projects

- **[photons](https://github.com/portel-dev/photons)** - Official marketplace with 16+ production-ready photons
- **@modelcontextprotocol/sdk** - Official MCP TypeScript SDK

---

## License

MIT © Portel

---

**Built with singular focus. Deployed with precise targeting.**

Made with ⚛️ by [Portel](https://github.com/portel-dev)
