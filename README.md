
![Photon Logo](https://raw.githubusercontent.com/portel-dev/photon/refs/heads/main/assets/photon-logo.png)

[![npm version](https://badgen.net/npm/v/@portel/photon)](https://www.npmjs.com/package/@portel/photon)
[![npm downloads](https://badgen.net/npm/dm/@portel/photon)](https://www.npmjs.com/package/@portel/photon)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)

# Photon

**Universal runtime that turns single-file TypeScript into MCP server, CLI, and more.**

Photon TS files are Single file. Zero boilerplate. Pure business logic.

---

## TL;DR

**The Problem with MCPs Today:**

- Popular MCPs don't exactly match your specific requirements
- **Security risk**: Malicious MCPs can steal your data through prompt injection—not just credentials
- Scattered across 4-6 files, making security audits impractical
- Too complex to fork and customize safely

**Photon's Solution:** Single-file TypeScript format. Pure business logic, zero boilerplate. Fork-first design where every `.photon.ts` is trivial to audit and customize.

Think of it like **NPM and Node, but for MCP**.

### Write Once, Use Everywhere

The same `.photon.ts` file automatically becomes:
- 🤖 **MCP Server** - Tools for Claude Desktop, Cursor, and AI assistants
- 💻 **CLI Tool** - Beautiful command-line interface for humans
- 🔌 **Platform Integrations** - NCP, Lumina, and future runtimes

```bash
# Same file, multiple interfaces:
photon mcp analytics              # Run as MCP server for AI
photon cli analytics revenue      # Use as CLI tool for humans
```

**Zero extra code. Pure business logic. Infinite deployment targets.**

### The Photon Ecosystem Flywheel

![Photon Ecosystem](https://raw.githubusercontent.com/portel-dev/photon/refs/heads/main/assets/photon-ecosystem.png)

The ecosystem creates a virtuous cycle: AI generates photons → Runtime executes them → Community shares → AI gets smarter.

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

### Use It Everywhere

That single file now works as both an **MCP server** and a **CLI tool**:

```bash
# As an MCP server (for AI assistants)
photon mcp analytics
# → Claude Desktop can now call revenue() as a tool

# As a CLI (for humans)
photon cli analytics revenue --startDate 2024-01-01 --endDate 2024-12-31
# → Beautiful formatted output:
# ┌────────────┬──────────┐
# │ Date       │ Revenue  │
# ├────────────┼──────────┤
# │ 2024-01-01 │ $12,450  │
# │ 2024-01-02 │ $15,320  │
# └────────────┴──────────┘
```

**Same code. Same logic. Two interfaces. Zero duplication.**

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

### 🔒 Security Through Transparency

Prompt injection attacks are the new supply-chain threat. A malicious MCP can manipulate AI responses to exfiltrate your entire conversation history—not just credentials.

**One file = one audit:**

- Read 40 lines, understand everything
- No hidden code scattered across imports
- Fork and verify in minutes, not hours
- Trust through transparency, not reputation

When you can't trust a photon, you can **safely fork and audit it**. Traditional MCPs with scattered logic? Nearly impossible to verify.

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

### Launch Beam UI

```bash
photon
```

This opens Beam in your browser - a visual control panel where you can browse marketplaces, install photons, run methods, and configure settings. No CLI knowledge required.

### Use Ready-Made Photons

The [**official Photon marketplace**](https://github.com/portel-dev/photons) comes pre-configured with 16+ production-ready photons:

```bash
# Browse all photons
photon info

# Install any photon (filesystem, git, postgres, mongodb, slack, etc.)
photon add filesystem

# or else copy your own .photon.ts file to 
# .photon folder in your user folder 

# Call info command with mcp option
photon info filesystem --mcp
# Get client config json
{
  "filesystem": {
    "command": "photon",
    "args": [
      "mcp",
      "filesystem"
    ],
    "env": {
      "FILESYSTEM_WORKDIR": "/Users/arul/Documents",
      "FILESYSTEM_MAX_FILE_SIZE": "10485760",
      "FILESYSTEM_ALLOW_HIDDEN": "false"
    }
  }
}
# Add to your client 
```

### Build Photons with AI

Use the [**photon-skill**](https://github.com/portel-dev/photon-skill) for Claude Desktop or Claude Code to generate `.photon.ts` files:
- Single TypeScript files with metadata
- AI understands complete context in one file
- Zero boilerplate, just business logic

### Diagnose your environment

Keep your runtime healthy:

```bash
# Full environment & port check
photon doctor
photon doctor jira  # adds env-var + cache diagnostics for `jira`

# Structured logs for MCP servers
photon mcp jira --log-level debug --json-logs
```

`photon doctor` surfaces Node/npm health, working-directory status, marketplace conflicts, port availability, and Photon-specific env recommendations with actionable fixes.

### Add Your Own Marketplace

```bash
# Add custom marketplace from GitHub
photon marketplace add your-org/your-photons

# Install from your marketplace
photon add your-custom-tool
```

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
| **CLI Interface** | Write separate code | Automatic from same code |
| **Deployment Targets** | MCP only | MCP, CLI, NCP, Lumina, APIs... |

[See detailed comparison →](COMPARISON.md)

---

## CLI Interface

Every photon automatically provides a beautiful CLI interface with zero additional code. The same business logic that powers your MCP tools becomes instantly available from the terminal.

### Quick Example

```bash
# List all methods
photon cli lg-remote

# Call methods with natural syntax
photon cli lg-remote volume 50
photon cli lg-remote volume +5
photon cli lg-remote channel 7
photon cli lg-remote app netflix

# Get method help
photon cli lg-remote volume --help
```

### Beautiful Output Formats

Photon automatically formats output based on data structure:

**Tables** - Key-value pairs and flat objects:
```bash
$ photon cli lg-remote volume
┌─────────┬────┐
│ volume  │ 45 │
├─────────┼────┤
│ muted   │ no │
├─────────┼────┤
│ maxVol  │ 100│
└─────────┴────┘
```

**Lists** - Arrays of items:
```bash
$ photon cli lg-remote apps
• Netflix (netflix)
• YouTube (youtube.leanback.v4)
• HDMI1 (com.webos.app.hdmi1)
• Disney+ (disney)
```

**Trees** - Hierarchical data (shown as formatted JSON)
**Primitives** - Simple values displayed directly

### Format System

Photon uses a smart format system with 5 standard types:

1. **`primitive`** - String, number, boolean
2. **`table`** - Flat object or array of flat objects
3. **`tree`** - Nested/hierarchical data
4. **`list`** - Array of simple items
5. **`none`** - No return value (void operations)

**Hint the format** (optional):
```typescript
/**
 * Get current volume
 * @format table
 */
async volume() {
  return this._request('ssap://audio/getVolume');
}
```

**Auto-detection**: If no `@format` tag is provided, Photon automatically detects the best format based on the return value structure.

### CLI Command Reference

#### `photon cli <photon-name> [method] [args...]`

**List all methods:**
```bash
photon cli lg-remote
```

**Call a method:**
```bash
# No parameters
photon cli lg-remote status

# Single parameter
photon cli lg-remote volume 50

# Multiple parameters
photon cli lg-remote search query "breaking bad" limit 10

# Relative adjustments
photon cli lg-remote volume +5
photon cli lg-remote channel +1
```

**Get method help:**
```bash
photon cli lg-remote volume --help
```

**Raw JSON output:**
```bash
photon cli lg-remote volume --json
```

### One Codebase, Multiple Interfaces

The beauty of Photon's design: **improvements to business logic automatically work across all interfaces**.

Write your logic once:
```typescript
async volume(params?: { level?: number | string } | number | string) {
  // Handle relative adjustments
  if (typeof level === 'string' && level.startsWith('+')) {
    const delta = parseInt(level);
    const current = await this._getCurrentVolume();
    const newVolume = current + delta;
    await this._setVolume(newVolume);
  }
  // ... rest of logic
  return this._getCurrentVolume(); // Always return current state
}
```

**Works everywhere:**
- ✅ **MCP**: Claude Desktop, Cursor, etc.
- ✅ **CLI**: `photon cli lg-remote volume +5`
- ✅ **Future interfaces**: HTTP, WebSocket, etc.

### Context-Aware Error Messages

Photons can provide helpful, context-aware errors:

```bash
$ photon cli lg-remote channels
❌ Error: TV channels not available. Currently on HDMI1.
   Switch to a TV tuner input to access channels.
```

The same error quality appears in MCP tools—because it's the same code.

### Exit Codes

The CLI properly returns exit codes for automation:
- **0**: Success
- **1**: Error (tool execution failed, invalid parameters, etc.)

Perfect for shell scripts and CI/CD:
```bash
if photon cli lg-remote volume 50; then
  echo "Volume set successfully"
else
  echo "Failed to set volume"
  exit 1
fi
```

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
photon info            # See all available photons
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

#### `photon cli <photon-name> [method] [args...]`
Run photon methods directly from the command line.

```bash
# List all available methods
photon cli calculator

# Call a method with arguments
photon cli calculator add 5 10

# Get method-specific help
photon cli calculator add --help

# Output raw JSON instead of formatted output
photon cli calculator add 5 10 --json
```

**Arguments:**
- Arguments are automatically coerced to expected types (string, number, boolean)
- Strings starting with `+` or `-` are preserved for relative adjustments
- Arrays and objects can be passed as JSON strings

**Options:**
- `--help` - Show help for the photon or specific method
- `--json` - Output raw JSON instead of formatted output

**Exit Codes:**
- `0` - Success
- `1` - Error (invalid arguments, execution failure, etc.)

**Resuming Workflows:**

Long-running workflows that use checkpoints can be resumed if interrupted:

```bash
# First run - workflow gets interrupted
photon cli report-generator generate week 52
# Output: Starting workflow...
#         [Step 1/3] Collecting data...
#         ^C (interrupted)
#         Run ID: run_abc123_xyz

# Resume from where it left off
photon cli report-generator generate week 52 --resume run_abc123_xyz
# Output: Resuming from step 2 of workflow...
#         [Step 2/3] Analyzing data...
#         [Step 3/3] Generating report...
#         Done!
```

Workflows automatically become stateful when they yield checkpoints. See [Stateful Workflows](https://github.com/portel-dev/photon-core#stateful-workflows-checkpoint-pattern) for implementation details.

**Examples:**

```bash
# Smart home control
photon cli lg-remote volume 50
photon cli lg-remote volume +5      # Relative adjustment
photon cli lg-remote channel 7
photon cli lg-remote app netflix

# Database queries
photon cli postgres query "SELECT * FROM users LIMIT 10"

# File operations
photon cli filesystem read-file path "/home/user/document.txt"

# Git operations
photon cli git commit message "feat: add new feature"
```

### Inspect & Configure

#### `photon info [name]`
List all photons or show details for a specific one.

```bash
# List all installed photons
photon info

# Show details for one photon
photon info calculator

# Get MCP client configuration
photon info calculator --mcp
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

# Generate Claude Code plugin files too
photon sync marketplace --claude-code
```

**Options:**
- `--claude-code` - Also generate Claude Code plugin files (`.claude-plugin/`)
- `--name <name>` - Override marketplace name
- `--description <desc>` - Set marketplace description
- `--owner <owner>` - Set owner name

Used when creating your own marketplace. See [Marketplace System](#marketplace-system) and [Claude Code Plugins](#claude-code-plugins).

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

# 2. Generate marketplace manifest (and optionally Claude Code plugin)
photon sync marketplace --claude-code

# 3. Push to GitHub/Git
git init
git add .
git commit -m "Initial marketplace"
git push origin main

# 4. Team members install (via CLI or Claude Code)
photon marketplace add company/photons
photon add internal-crm
photon add analytics-db
```

**Benefits:**

- 🔒 **Secure**: Your code, your infrastructure, your control
- 📦 **Easy**: Single-file photons are trivial to maintain
- 🎯 **Focused**: Build exact tools for your workflows
- 📊 **Traceable**: Git-based versioning and attribution
- 🔌 **Dual Distribution**: With `--claude-code`, also works as Claude Code plugin

> **Tip:** Use `--claude-code` flag to enable installation via both Photon CLI and Claude Code plugin manager. See [Claude Code Plugins](#claude-code-plugins) for details.

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

## Claude Code Plugins

Photon marketplaces can be automatically published as **Claude Code plugins**, enabling users to install individual photons directly from Claude Code's plugin manager.

### Why Dual Distribution?

One marketplace, two distribution channels:

**Via Photon CLI:**
```bash
photon add filesystem
photon add git
```

**Via Claude Code Plugin:**
```bash
/plugin marketplace add your-org/your-marketplace
/plugin install filesystem@your-marketplace
/plugin install git@your-marketplace
```

**Benefits:**
- 🎯 **Granular Installation**: Claude Code users can install only the photons they need
- 🔄 **Auto-Sync**: Plugin stays in sync with your marketplace
- ⚡ **Zero Config**: Photon CLI auto-installs on first use
- 🛡️ **Secure**: Credentials never shared with AI (interactive setup available)
- 📦 **Same Source**: One marketplace serves both CLI and plugin users

### Generate Plugin Files

When creating your marketplace, add the `--claude-code` flag:

```bash
# In your marketplace directory
photon sync marketplace --claude-code
```

This generates:
- `.claude-plugin/marketplace.json` - Plugin manifest with individual photon entries
- `.claude-plugin/hooks.json` - SessionStart hook to auto-install Photon CLI
- `.claude-plugin/scripts/check-photon.sh` - Auto-installer script
- `.claude-plugin/scripts/setup-photon.sh` - Interactive credential setup tool

### What Gets Generated

**Individual Plugins:** Each photon becomes a separate installable plugin in Claude Code:

```json
{
  "name": "your-marketplace",
  "plugins": [
    {
      "name": "filesystem",
      "description": "Filesystem - File and directory operations",
      "mcpServers": {
        "filesystem": {
          "command": "photon",
          "args": ["mcp", "filesystem"]
        }
      }
    }
    // ... one entry per photon
  ]
}
```

**Auto-Install Hook:** When users install your plugin, Claude Code automatically:
1. Checks if `photon` CLI is installed
2. Installs it globally via npm if missing
3. Makes all photon tools available immediately

### Example: Official Photons Marketplace

The [official photons marketplace](https://github.com/portel-dev/photons) uses this approach:

```bash
# In the photons repo
photon sync marketplace --claude-code
git commit -m "chore: update marketplace"
git push
```

Users can then install via Claude Code:
```bash
/plugin marketplace add portel-dev/photons
/plugin install knowledge-graph@photons-marketplace
/plugin install git@photons-marketplace
```

### Automated Git Hooks

Add this to your `.git/hooks/pre-commit` to auto-sync:

```bash
#!/bin/bash
photon sync marketplace --claude-code
git add .marketplace/ .claude-plugin/ README.md *.md
```

Now your marketplace AND plugin files stay in sync automatically.

### Distribution Strategy

**Recommended approach:**

1. **Commit both** `.marketplace/` and `.claude-plugin/` to your repo
2. **Single command** keeps them in sync
3. **Users choose** their preferred installation method
4. **Same photons**, whether via CLI or Claude Code

**Result:** Maximum reach with minimal maintenance.

---

## Advanced Features

### Calling External MCPs (`@mcp` Declarations)

Photons can call external MCPs using the `@mcp` declaration syntax. Dependencies are auto-injected as instance properties:

```typescript
/**
 * Project Manager - Combines GitHub and Jira
 * @mcp github anthropics/mcp-server-github
 * @mcp jira npm:@anthropic/mcp-server-jira
 */
export default class ProjectManager {
  /**
   * Sync GitHub issues to Jira
   */
  async syncIssues(params: { repo: string; project: string }) {
    // this.github and this.jira are auto-injected!
    const issues = await this.github.list_issues({ repo: params.repo });

    for (const issue of issues) {
      await this.jira.create_issue({
        project: params.project,
        summary: issue.title,
        description: issue.body
      });
    }

    return { synced: issues.length };
  }
}
```

**Source Formats (Marketplace-style):**

| Format | Example | Description |
|--------|---------|-------------|
| GitHub shorthand | `anthropics/mcp-server-github` | Runs via `npx -y @anthropics/mcp-server-github` |
| npm package | `npm:@scope/package` | Runs via `npx -y @scope/package` |
| HTTP URL | `http://localhost:3000/mcp` | Connects via SSE transport |
| WebSocket | `ws://localhost:8080/mcp` | Connects via WebSocket transport |
| Local path | `./my-local-mcp` | Runs via `node ./my-local-mcp` |

**Multiple Transports:**

```typescript
/**
 * @mcp github anthropics/mcp-server-github       // stdio (local process)
 * @mcp api http://api.example.com/mcp            // SSE (HTTP)
 * @mcp realtime ws://realtime.example.com/mcp    // WebSocket
 */
```

The injected MCP clients support all official SDK transports: stdio, SSE, streamable-http, and websocket.

---

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

## Beam UI

Beam is a visual control panel for managing photons. Launch it with:

```bash
photon beam
# or just
photon
```

**Features:**
- 📦 **Photon Browser** - View all installed photons and their tools
- 🛒 **Marketplace** - Browse and install photons from any configured marketplace
- ▶️ **Method Runner** - Execute photon methods with a visual interface
- ⚙️ **Settings** - Configure environment variables and preferences
- 📊 **Real-time Updates** - See live changes via pub/sub channels

Beam runs as a local web server and opens in your default browser. It communicates with photon daemons via WebSocket for real-time updates.

---

## Daemon Protocol

Photon includes a daemon infrastructure for advanced inter-process communication. This enables real-time coordination between CLI tools, MCP servers, and the Beam UI.

### Overview

The daemon provides four key capabilities:

| Feature | Description |
|---------|-------------|
| **Pub/Sub Channels** | Real-time cross-process messaging |
| **Distributed Locks** | Coordinate exclusive access to resources |
| **Scheduled Jobs** | Cron-like background task execution |
| **Webhooks** | HTTP endpoints for external service integration |

### How It Works

```
┌─────────────────┐     ┌───────────────────────────────────┐     ┌────────────────┐
│  Photon Tool    │────▶│   Daemon                          │────▶│  BEAM UI       │
│  (MCP/Claude)   │     │   ~/.photon/daemons/kanban.sock   │     │  (WebSocket)   │
└─────────────────┘     └───────────────────────────────────┘     └────────────────┘
        │                             ▲                                    │
        │                             │                                    │
        └─────── emit({ channel }) ───┴──── subscribe(channel) ────────────┘
```

When Claude moves a Kanban task via MCP, the daemon broadcasts the change to all subscribers (including Beam UI), enabling real-time updates across all connected clients.

### Pub/Sub Messaging

Broadcast messages across processes in real-time:

```typescript
// In a photon method - publish to a channel
async moveTask(params: { taskId: string; column: string }) {
  // ... move task logic ...

  // Broadcast to all subscribers
  this.emit({
    channel: `board:${this.boardName}`,
    event: 'task-moved',
    data: { taskId: params.taskId, newColumn: params.column }
  });

  return { success: true };
}
```

**Use Cases:**
- Real-time UI updates when data changes
- Cross-tool coordination
- Live dashboards and monitoring

### Distributed Locks

Coordinate exclusive access to shared resources:

```typescript
import { acquireLock, releaseLock } from '@portel/photon/daemon/client';

const acquired = await acquireLock('kanban', 'board:default:write', 30000);

if (acquired) {
  try {
    // Do exclusive work...
  } finally {
    await releaseLock('kanban', 'board:default:write');
  }
}
```

**Features:**
- Auto-expiration (default 30s timeout)
- Session-bound (only holder can release)
- Re-entrant (same session can re-acquire)

### Scheduled Jobs

Cron-like background task execution:

```typescript
import { scheduleJob, unscheduleJob, listJobs } from '@portel/photon/daemon/client';

// Schedule a daily cleanup
await scheduleJob(
  'kanban',
  'daily-cleanup',
  'cleanupOldTasks',
  '0 0 * * *',  // Daily at midnight
  { maxAge: 604800 }  // 7 days
);

// List all scheduled jobs
const jobs = await listJobs('kanban');

// Remove a job
await unscheduleJob('kanban', 'daily-cleanup');
```

**Cron Syntax:**
```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
* * * * *
```

### Webhooks

HTTP endpoints for external services (GitHub, Stripe, etc.):

```typescript
// In your photon
async handleGithubPush(params: {
  ref: string;
  commits: Array<{ message: string }>;
}) {
  const branch = params.ref.replace('refs/heads/', '');

  this.emit({
    channel: 'github:updates',
    event: 'push',
    data: { branch, commitCount: params.commits.length }
  });

  return { processed: true };
}
```

Configure your webhook URL:
```
POST http://localhost:3457/webhook/handleGithubPush
X-Webhook-Secret: your-secret-token
```

### Limitations

- **Local only**: Unix sockets work on a single machine
- **No persistence**: Messages are not stored; missed messages are lost
- **Memory-based**: All subscriptions and jobs are in-memory

For production/cloud deployments, use Redis or HTTP channel brokers in `@portel/photon-core`.

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
   ┌─────────────-─┐
   │ stdio/JSON-RPC│  ← Communicates with MCP clients
   └─────────────-─┘    (Claude Desktop, Cursor, Zed, etc.)
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

### ✅ MCP Servers & CLI Interface (Available Now)

**MCP Servers:**
Build and run photons as MCP servers for AI assistants. Works with Claude Desktop, Cursor, Zed, Continue, Cline, and any MCP-compatible client.

**CLI Interface:**
Run photon methods directly from the command line with beautiful formatted output. Every photon automatically becomes a CLI tool with zero additional code.

**Write once, deploy everywhere:** The same business logic powers both your MCP tools and CLI commands.

### 🔌 Ecosystem Integrations

Photon files are first-class citizens across multiple platforms:

#### NCP - Intelligent MCP Orchestration

[NCP](https://github.com/portel-dev/ncp) runs as an MCP client hosting many MCPs intelligently, while acting as an MCP server for any client. Photon files integrate seamlessly as context providers.

```bash
# Photons work natively with NCP
ncp add analytics.photon.ts
```

NCP enables sophisticated MCP orchestration patterns, and `.photon.ts` files are designed to work seamlessly in this environment.

#### Lumina - Anything API Server *(Coming Soon)*

Turn any photon into a production API endpoint with zero configuration.

```bash
# Same photon, now an HTTP API
lumina serve analytics.photon.ts
# → POST /revenue with JSON params
# → GET /status
# → Full REST API from your photon methods
```

Lumina will make photons available as HTTP/WebSocket endpoints, enabling web apps, mobile clients, and traditional API consumers to use the same business logic.

#### Future Platforms

The `.photon.ts` format is designed to be consumed by any runtime:
- WebSocket servers
- Serverless functions (AWS Lambda, Cloudflare Workers)
- Native desktop applications
- Browser extensions
- GraphQL servers

**One file. Many platforms. Pure business logic.**

---

Photon's framework-agnostic design enables future deployment targets. More on the way.

---

## Documentation

### User Guides
- **[GUIDE.md](GUIDE.md)** - Complete tutorial for creating photons
- **[ADVANCED.md](ADVANCED.md)** - Lifecycle hooks, performance, production deployment
- **[PHOTON_BEST_PRACTICES.md](PHOTON_BEST_PRACTICES.md)** - Best practices and patterns
- **[DOCBLOCK-TAGS.md](DOCBLOCK-TAGS.md)** - JSDoc tag reference
- **[NAMING-CONVENTIONS.md](NAMING-CONVENTIONS.md)** - Naming guidelines
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues and solutions

### Development & Contributing
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Architecture overview and contributing guide
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

<!-- PHOTON_MARKETPLACE_START -->
# photon

> **Singular focus. Precise target.**

**Photons** are single-file TypeScript MCP servers that supercharge AI assistants with focused capabilities. Each photon delivers ONE thing exceptionally well - from filesystem operations to cloud integrations.

Built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction), photons are:
- 📦 **One-command install** via [Photon CLI](https://github.com/portel-dev/photon)
- 🎯 **Laser-focused** on singular capabilities
- ⚡ **Zero-config** with auto-dependency management
- 🔌 **Universal** - works with Claude Desktop, Claude Code, and any MCP client

## 📦 Available Photons

| Photon | Focus | Tools | Details |
|--------|-------|-------|---------|
| **Test Ui** | Test Custom UI | 1 | [View →](test-ui.md) |


**Total:** 1 photons ready to use

---

## 🚀 Quick Start

### 1. Install Photon

```bash
npm install -g @portel/photon
```

### 2. Add Any Photon

```bash
photon add filesystem
photon add git
photon add aws-s3
```

### 3. Use It

```bash
# Run as MCP server
photon mcp filesystem

# Get config for your MCP client
photon get filesystem --mcp
```

Output (paste directly into your MCP client config):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "photon",
      "args": ["mcp", "filesystem"]
    }
  }
}
```

Add the output to your MCP client's configuration. **Consult your client's documentation** for setup instructions.

**That's it!** Your AI assistant now has 1 focused tools at its fingertips.

---

## 🎨 Claude Code Integration

This marketplace is also available as a **Claude Code plugin**, enabling seamless installation of individual photons directly from Claude Code's plugin manager.

### Install as Claude Code Plugin

```bash
# In Claude Code, run:
/plugin marketplace add portel-dev/photons
```

Once added, you can install individual photons:

```bash
# Install specific photons you need
/plugin install filesystem@photons-marketplace
/plugin install git@photons-marketplace
/plugin install knowledge-graph@photons-marketplace
```

### Benefits of Claude Code Plugin

- **🎯 Granular Installation**: Install only the photons you need
- **🔄 Auto-Updates**: Plugin stays synced with marketplace
- **⚡ Zero Config**: Photon CLI auto-installs on first use
- **🛡️ Secure**: No credentials shared with AI (interactive setup available)
- **📦 Individual MCPs**: Each photon is a separate installable plugin

### How This Plugin Is Built

This marketplace doubles as a Claude Code plugin through automatic generation:

```bash
# Generate marketplace AND Claude Code plugin files
photon maker sync --claude-code
```

This single command:
1. Scans all `.photon.ts` files
2. Generates `.marketplace/photons.json` manifest
3. Creates `.claude-plugin/marketplace.json` for Claude Code
4. Generates documentation for each photon
5. Creates auto-install hooks for seamless setup

**Result**: One source of truth, two distribution channels (Photon CLI + Claude Code).

---

## ⚛️ What Are Photons?

**Photons** are laser-focused modules - each does ONE thing exceptionally well:
- 📁 **Filesystem** - File operations
- 🐙 **Git** - Repository management
- ☁️ **AWS S3** - Cloud storage
- 📅 **Google Calendar** - Calendar integration
- 🕐 **Time** - Timezone operations
- ... and more

Each photon delivers **singular focus** to a **precise target**.

**Key Features:**
- 🎯 Each photon does one thing perfectly
- 📦 1 production-ready photons available
- ⚡ Auto-installs dependencies
- 🔧 Works out of the box
- 📄 Single-file design (easy to fork and customize)

## 🎯 The Value Proposition

### Before Photon

For each MCP server:
1. Find and clone the repository
2. Install dependencies manually
3. Configure environment variables
4. Write MCP client config JSON by hand
5. Repeat for every server

### With Photon

```bash
# Install from marketplace
photon add filesystem

# Get MCP config
photon get filesystem --mcp
```

Output (paste directly into your MCP client config):
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "photon",
      "args": ["mcp", "filesystem"]
    }
  }
}
```

**That's it.** No dependencies, no environment setup, no configuration files.

**Difference:**
- ✅ One CLI, one command
- ✅ Zero configuration
- ✅ Instant installation
- ✅ Auto-dependencies
- ✅ Consistent experience

## 💡 Use Cases

**For Claude Users:**
```bash
photon add filesystem git github-issues
photon get --mcp  # Get config for all three
```
Add to Claude Desktop → Now Claude can read files, manage repos, create issues

**For Teams:**
```bash
photon add postgres mongodb redis
photon get --mcp
```
Give Claude access to your data infrastructure

**For Developers:**
```bash
photon add docker git slack
photon get --mcp
```
Automate your workflow through AI

## 🔍 Browse & Search

```bash
# List all photons
photon get

# Search by keyword
photon search calendar

# View details
photon get google-calendar

# Upgrade all
photon upgrade
```

## 🏢 For Enterprises

Create your own marketplace:

```bash
# 1. Organize photons
mkdir company-photons && cd company-photons

# 2. Generate marketplace
photon maker sync

# 3. Share with team
git push origin main

# Team members use:
photon marketplace add company/photons
photon add your-internal-tool
```

---

**Built with singular focus. Deployed with precise targeting.**

Made with ⚛️ by [Portel](https://github.com/portel-dev)

<!-- PHOTON_MARKETPLACE_END -->
