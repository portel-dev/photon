# Photon

> **Singular focus. Precise target.**

![Photon Logo](https://github.com/portel-dev/photon-mcp/raw/main/assets/photon-logo.png)

Laser-focused TypeScript modules powered by a universal runtime.

---

## What is Photon?

**Photons** are TypeScript modules with **singular focus** - each does ONE thing exceptionally well.

The **Photon Runtime** delivers **precise targeting** across any interface:
- 🤖 **MCP servers** - for AI assistants
- 💻 **CLI tools** - for terminal workflows *(coming soon)*
- **...**

Write focused business logic once. Deploy it everywhere.

---

## Quick Start

### Install
```bash
npm install -g @portel/photon
```

### Add a Photon
```bash
photon add filesystem
```

### Run as MCP Server
```bash
photon mcp filesystem
```

### Use as CLI *(coming soon)*
```bash
photon cli filesystem read --path file.txt
```

---

## Why Photon?

| Feature | Benefit |
|---------|---------|
| 🎯 **Singular Focus** | Each photon does ONE thing exceptionally well |
| 🔌 **Universal Runtime** | Same code, multiple interfaces (MCP, CLI, ...) |
| 📦 **Instant Marketplace** | 16+ production-ready photons, zero configuration |
| ⚡ **Auto-Dependencies** | Runtime handles installation automatically |
| 📄 **Single-File Design** | Easy to read, fork, and customize |

---

## Philosophy

A **photon** is the smallest unit of light, delivering **singular focus** to a **precise target**.

Each Photon module embodies this principle:
- **Singular focus** - One responsibility, executed flawlessly
- **Precise target** - Clear purpose, clean API
- **Universal delivery** - Write once, use everywhere

---

## Available Photons

Production-ready photons from **[portel-dev/photons](https://github.com/portel-dev/photons)**:

| Photon | Focus | Tools |
|--------|-------|-------|
| **AWS S3** | Cloud object storage | 11 |
| **Docker** | Container management | 10 |
| **Email** | SMTP and IMAP operations | 8 |
| **Fetch** | Web content with readability extraction | 2 |
| **Filesystem** | File and directory operations | 13 |
| **Git** | Local repository management | 11 |
| **GitHub Issues** | Issue tracking | 7 |
| **Google Calendar** | Calendar integration | 9 |
| **Jira** | Project management | 10 |
| **Memory** | Knowledge graph persistence | 10 |
| **MongoDB** | NoSQL database | 13 |
| **PostgreSQL** | SQL database | 7 |
| **Redis** | In-memory data store | 18 |
| **Slack** | Workspace integration | 7 |
| **SQLite** | Local SQL database | 9 |
| **Time** | Timezone operations | 3 |

Browse and install:
```bash
photon list           # See all available photons
photon add postgres   # Install any photon
photon search git     # Search by keyword
```

---

## Create Your Own

### Write Focused Business Logic

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

### Photon Enables Everything Else

```bash
# Run as MCP server
photon mcp analytics

# Use as CLI (coming soon)
photon cli analytics revenue --start-date 2024-01-01 --end-date 2024-12-31

# More interfaces coming...
```

**What Photon handles automatically:**
- ✅ TypeScript compilation
- ✅ Schema generation from types
- ✅ MCP protocol implementation
- ✅ Environment variable mapping
- ✅ Dependency installation
- ✅ Hot reload in dev mode
- ✅ CLI integration (coming)

**You focus on:** Your business logic
**Photon handles:** Everything else

---

## How It Works

### 1. Convention = Automation

**File Name → MCP Name**
```typescript
// analytics.photon.ts → "analytics" MCP
```

**Class Methods → Tools**
```typescript
async revenue() {}      // → "revenue" tool
async topCustomers() {} // → "topCustomers" tool
```

**TypeScript Types → Schemas**
```typescript
async create(params: { title: string; priority: number }) {}
// Auto-generates JSON schema from TypeScript types
```

**JSDoc → Descriptions**
```typescript
/**
 * Get revenue by date range
 * @param startDate Start date (YYYY-MM-DD)
 */
// Photon extracts tool descriptions automatically
```

**Constructor → Configuration**
```typescript
constructor(private host: string, private database: string) {}
// Maps to: ANALYTICS_HOST, ANALYTICS_DATABASE
```

### 2. Zero-Setup Dependencies

```typescript
/**
 * @dependencies axios@^1.6.0, lodash@^4.17.21
 */
// Photon auto-installs on first run. No manual npm install needed.
```

### 3. Single-File Distribution

- One `.ts` file = one photon
- Easy to customize: just edit the file
- Easy to share: copy file or push to git
- Git-friendly, version controllable

---

## Commands

### Run MCP Server

```bash
# Production mode
photon mcp calculator

# Development mode (hot reload)
photon mcp calculator --dev
```

### List and Inspect Photons

```bash
# List all photons
photon get

# Show details for one
photon get calculator

# Get MCP config for Claude Desktop
photon get calculator --mcp
```

### Create New Photon

```bash
photon init calculator
```

Creates `calculator.photon.ts` in `~/.photon/` (accessible from anywhere).

**Custom directory:**
```bash
photon --working-dir ./my-photons init calculator
```

### Validate Photon

```bash
photon validate calculator
```

Validates syntax and extracts schemas without running.

---

## Marketplace System

### Install from Marketplace

```bash
# Install from default marketplace (portel-dev/photons)
photon add github-issues
photon add sqlite
photon add memory

# Search for photons
photon search slack
```

### Create Your Marketplace

**For enterprises and teams:**

```bash
# 1. Organize your photons
mkdir company-photons && cd company-photons
cp ~/.photon/*.photon.ts .

# 2. Generate marketplace manifest
photon sync marketplace

# 3. Push to GitHub
git init
git add .
git commit -m "Initial marketplace"
git push origin main

# 4. Share with team
# Team members run: photon marketplace add company/photons
```

### Manage Marketplaces

```bash
# List all marketplaces
photon marketplace list

# Add marketplace - Multiple formats supported:
photon marketplace add username/my-photons           # GitHub shorthand
photon marketplace add https://github.com/user/repo  # HTTPS
photon marketplace add git@github.com:user/repo.git  # SSH
photon marketplace add https://example.com/photons   # Direct URL
photon marketplace add ./my-local-photons            # Local path

# Remove marketplace
photon marketplace remove my-photons

# Search across all marketplaces
photon search github
```

### Upgrade Photons

```bash
# Upgrade all photons
photon upgrade

# Upgrade specific photon
photon upgrade filesystem
```

**Features:**
- Version tracking
- Modification detection (SHA-256 hash)
- Marketplace attribution
- Integrity verification

---

## Advanced Features

### Lifecycle Hooks

```typescript
export default class MyPhoton {
  async onInitialize() {
    // Called when photon is loaded
    console.error('Initialized');
  }

  async onShutdown() {
    // Called on shutdown
    console.error('Shutting down');
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

```typescript
export default class MyPhoton {
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

---

## Integration with Claude Desktop

```bash
# Get MCP config
photon get calculator --mcp
```

Copy the output to your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Example config:
```json
{
  "mcpServers": {
    "calculator": {
      "command": "photon",
      "args": ["mcp", "calculator"]
    }
  }
}
```

---

## Examples

The repository includes example photons in the `examples/` directory:

### Content (Templates & Static)
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

---

## FAQ

### Do I need to extend a base class?

No! Just export any class with async methods.

### How are parameters validated?

Photon extracts JSON schemas from your TypeScript types. MCP clients validate parameters before calling your tools.

### Can I use external packages?

Yes! Dependencies are **auto-installed** from JSDoc `@dependencies` tags.

### How does hot reload work?

In `--dev` mode, Photon watches your `.photon.ts` file and recompiles on save.

### Where are compiled files cached?

`~/.cache/photon-mcp/compiled/`

### Where are my photons stored?

**Default:** `~/.photon/`
**Custom:** Use `--working-dir` flag

---

## Roadmap

- [x] **MCP Server Interface** - AI assistant integration
- [ ] **CLI Tool Interface** - Terminal workflows
- [ ] **More interfaces coming...**

---

## Contributing

Contributions welcome! Please open issues and PRs at [github.com/portel-dev/photon-mcp](https://github.com/portel-dev/photon-mcp).

---

## License

MIT © Portel

---

## Related Projects

- **[photons](https://github.com/portel-dev/photons)** - Official marketplace with 16+ production-ready photons
- **@modelcontextprotocol/sdk** - Official MCP TypeScript SDK

---

**Built with singular focus. Deployed with precise targeting.**

Made with ⚛️ by Portel
