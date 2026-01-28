
![Photon Logo](https://raw.githubusercontent.com/portel-dev/photon/refs/heads/main/assets/photon-logo.png)

[![npm version](https://badgen.net/npm/v/@portel/photon)](https://www.npmjs.com/package/@portel/photon)
[![npm downloads](https://badgen.net/npm/dm/@portel/photon)](https://www.npmjs.com/package/@portel/photon)
[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)

# Photon

**Tools for humans and AI to use together.**

> *Singular focus. Precise target.*

---

## The Vision

The future isn't humans OR AI working alone. It's **co-creation** — humans and AI exploring and building together, handing off context seamlessly, each contributing what they do best.

For this to work, the tools need to serve both equally.

**Photon makes this possible.** Write your business logic once. Both humans and AI get the same interface, the same tools, the same capabilities.

```
┌─────────────────┐         ┌─────────────────┐
│     Human       │         │       AI        │
│                 │         │                 │
│  Beam UI / CLI  │         │  Claude / MCP   │
└────────┬────────┘         └────────┬────────┘
         │                           │
         └───────────┬───────────────┘
                     ▼
            ┌─────────────────┐
            │    .photon.ts   │
            │  (Your Logic)   │
            └─────────────────┘
```

### The Ecosystem Flywheel

![Photon Ecosystem](https://raw.githubusercontent.com/portel-dev/photon/refs/heads/main/assets/photon-ecosystem.png)

AI generates photons → Runtime executes them → Community shares → AI gets smarter.

---

## TL;DR

**The Problem with MCPs Today:**

- Popular MCPs don't exactly match your specific requirements
- **Security risk**: Malicious MCPs can steal your data through prompt injection
- Scattered across 4-6 files, making security audits impractical
- Too complex to fork and customize safely

**Photon's Solution:** Single-file TypeScript. Pure business logic, zero boilerplate. Fork-first design where every `.photon.ts` is trivial to audit and customize.

### Write Once, Use Everywhere

The same `.photon.ts` file automatically becomes:
- **MCP Server** - Tools for Claude Desktop, Cursor, and AI assistants
- **CLI Tool** - Beautiful command-line interface for humans
- **Beam UI** - Visual interface for testing and configuration

```bash
# Same file, multiple interfaces:
photon mcp analytics              # Run as MCP server for AI
photon cli analytics revenue      # Use as CLI tool for humans
photon                            # Open Beam UI
```

---

## See It In Action

### Beam: The Human Interface to MCP

Beam is how humans interact with MCPs — the same way AI does.

![Beam Dashboard](https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-dashboard.png)
*Browse all your photons and their methods in one place*

![Beam Tool Form](https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-tool-form.png)
*Forms are auto-generated from your TypeScript types — required fields marked with **\***

### Test What AI Will See

Before AI touches your MCP, test it yourself:

![Tool Execution](https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-execute.png)
*Execute methods, see results — verify before deploying to AI*

### Browse and Install from Marketplace

![Beam Marketplace](https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-marketplace.png)
*Discover photons, one-click install, immediately available*

### How Configuration Works

Constructor parameters automatically become configuration — no setup code needed:

```typescript
export default class Analytics {
  constructor(
    private host: string,        // → ANALYTICS_HOST env var → Beam text field
    private database: string,    // → ANALYTICS_DATABASE    → Beam text field
    private password: string     // → ANALYTICS_PASSWORD    → Beam password field
  ) {}
}
```

Beam auto-generates forms from your constructor. Fill in the fields, click save — done.

---

## Why Personal MCPs Matter

| Generic MCP | Your Actual Need |
|-------------|------------------|
| 50 tools | 3 tools |
| Covers every edge case | Your specific workflow |
| Complex configuration | Simple, focused setup |
| Hard to audit | Easy to understand |

When an MCP tries to serve everyone, it becomes bloated. More tools means more noise for AI, larger attack surface, harder audits.

**Photon enables personal MCPs** — sleek, precise tools that do exactly what YOU need:

- **Fork any photon** → customize to your workflow
- **40 lines to read** → understand everything
- **Single file** → trivial to audit and maintain
- **Your tools, your way** → no waiting for upstream changes

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

- **For AI agents**: Scattered context across files makes understanding difficult
- **For humans**: Jump between files to understand one feature
- **For teams**: 200+ lines before you write business logic
- **For maintenance**: Changes require updating multiple files and configs

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

---

## How It Works

### Runtime Adapters

Photon separates your logic from the interface:

```
┌─────────────────────────────────────────────────────┐
│              .photon.ts                             │
│         (Pure business logic)                       │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│              Runtime Layer                          │
├─────────────┬─────────────┬─────────────┬───────────┤
│ MCP Adapter │ CLI Adapter │ Beam/HTTP   │ Future    │
│             │             │   Adapter   │ Adapters  │
└─────────────┴─────────────┴─────────────┴───────────┘
```

Today MCP is the standard. Tomorrow there could be something new. Your photon doesn't change — the runtime gets a new adapter.

### Convention = Automation

| What You Write | What Photon Does |
|----------------|------------------|
| File name: `analytics.photon.ts` | MCP name: `analytics` |
| Method: `async revenue()` | Tool: `revenue` |
| TypeScript types | JSON Schema (auto-generated) |
| JSDoc comments | Tool descriptions |
| Constructor params | Environment variables + Config UI |
| `@dependencies pg@^8.11.0` | Auto-install on first run |

---

## Quick Start

### 1. Install

```bash
npm install -g @portel/photon
```

### 2. Launch Beam

```bash
photon
```

Opens Beam in your browser — browse photons, configure settings, test tools.

### 3. Use Ready-Made Photons

```bash
# Browse all photons
photon info

# Install any photon
photon add filesystem

# Get MCP client configuration
photon info filesystem --mcp
```

### 4. Create Your Own

```bash
photon init my-tool
```

Edit `~/.photon/my-tool.photon.ts` and run:

```bash
photon mcp my-tool --dev   # Development with hot reload
photon cli my-tool         # Test via CLI
```

---

## The Co-Creation Workflow

### Building Together

```
Human writes skeleton  →  AI implements logic  →  Human reviews in Beam
      ↓                          ↓                        ↓
AI extends features    ←  Human customizes     ←  Both iterate
```

### Exploring Together

```
Human tests in Beam    →  Shares context with AI  →  AI continues exploration
      ↓                          ↓                          ↓
AI discovers patterns  →  Human validates          →  Repeat
```

### The Handoff

Human using CLI:
```bash
$ photon cli analytics revenue --startDate 2024-01-01 --endDate 2024-12-31
┌────────────┬──────────┐
│ Date       │ Revenue  │
├────────────┼──────────┤
│ 2024-01-01 │ $12,450  │
│ 2024-01-02 │ $15,320  │
└────────────┴──────────┘

# "Hey Claude, dig deeper into January 2nd..."
```

AI picks up seamlessly — same tool, same data, same interface.

---

## Why Single File?

### For Humans
- **Understand**: Read one file, understand everything
- **Review**: Code reviews are one file, one story
- **Audit**: Security review in minutes, not hours
- **Customize**: Fork, edit, done — no build configs

### For AI
- **Context**: Complete understanding in one read
- **Generate**: Create entire photons in one response
- **Modify**: Edit without multi-file coordination
- **Explain**: Full context for accurate explanations

### For Teams
- **Onboard**: New members read one file per tool
- **Maintain**: Changes are localized
- **Share**: Drop a file, it works
- **Standardize**: Same format everywhere

---

## CLI Interface

Every photon automatically provides a beautiful CLI interface:

```bash
# List all methods
photon cli lg-remote

# Call methods with natural syntax
photon cli lg-remote volume 50
photon cli lg-remote volume +5   # Relative adjustment
```

### Beautiful Output Formats

**Tables** - Key-value pairs:
```bash
$ photon cli lg-remote volume
┌─────────┬────┐
│ volume  │ 45 │
├─────────┼────┤
│ muted   │ no │
└─────────┴────┘
```

**Lists** - Arrays of items:
```bash
$ photon cli lg-remote apps
• Netflix (netflix)
• YouTube (youtube.leanback.v4)
• Disney+ (disney)
```

---

## Available Photons

Production-ready photons from **[portel-dev/photons](https://github.com/portel-dev/photons)**:

| Category | Photons | Tools |
|----------|---------|-------|
| **Databases** | PostgreSQL, MongoDB, Redis, SQLite | 47 |
| **Infrastructure** | AWS S3, Docker, Filesystem | 34 |
| **Development** | Git, GitHub Issues | 18 |
| **Communication** | Email, Slack | 15 |
| **Productivity** | Google Calendar, Jira | 19 |

```bash
photon info            # See all available
photon add postgres    # Install any photon
photon search git      # Search by keyword
```

---

## Marketplace

### Fork and Customize

```bash
# Copy to your local directory
cp ~/.photon/filesystem.photon.ts ~/.photon/my-filesystem.photon.ts

# Edit, remove tools you don't need, add custom logic
# Use your version
photon mcp my-filesystem
```

**40 lines. 5 minutes. Your custom tool.**

### Create Team Marketplaces

```bash
# Organize your photons
mkdir company-photons && cd company-photons

# Generate marketplace
photon sync marketplace --claude-code

# Share with team
git push origin main

# Team members install
photon marketplace add company/photons
photon add internal-crm
```

---

## Advanced Features

### Calling External MCPs

```typescript
/**
 * Project Manager - Combines GitHub and Jira
 * @mcp github anthropics/mcp-server-github
 * @mcp jira npm:@anthropic/mcp-server-jira
 */
export default class ProjectManager {
  async syncIssues(params: { repo: string; project: string }) {
    // this.github and this.jira are auto-injected!
    const issues = await this.github.list_issues({ repo: params.repo });
    for (const issue of issues) {
      await this.jira.create_issue({
        project: params.project,
        summary: issue.title
      });
    }
    return { synced: issues.length };
  }
}
```

### Daemon Protocol

Real-time coordination between CLI tools, MCP servers, and Beam UI:

| Feature | Description |
|---------|-------------|
| **Pub/Sub Channels** | Real-time cross-process messaging |
| **Distributed Locks** | Coordinate exclusive access |
| **Scheduled Jobs** | Cron-like background tasks |
| **Webhooks** | HTTP endpoints for external services |

```typescript
async moveTask(params: { taskId: string; column: string }) {
  // ... move task logic ...

  // Broadcast to all subscribers (Beam UI updates instantly)
  this.emit({
    channel: `board:${this.boardName}`,
    event: 'task-moved',
    data: { taskId: params.taskId, newColumn: params.column }
  });
}
```

---

## Commands Reference

### Running Photons

```bash
photon                    # Open Beam UI
photon mcp <name>         # Run as MCP server
photon mcp <name> --dev   # Run with hot reload
photon cli <name>         # List tools
photon cli <name> <tool>  # Execute tool
```

### Managing Photons

```bash
photon init <name>        # Create new photon
photon info               # List all photons
photon info <name> --mcp  # Get MCP client config
photon validate <name>    # Check for errors
```

### Marketplace

```bash
photon add <name>              # Install photon
photon search <query>          # Search marketplace
photon upgrade                 # Upgrade all
photon marketplace add <repo>  # Add marketplace
```

### Development

```bash
photon doctor             # Diagnose environment
photon sync marketplace   # Generate marketplace manifest
photon audit              # Security audit dependencies
```

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
    └──────┬───────┘
           │
           ↓
   ┌───────────────┐
   │ stdio/JSON-RPC│  ← Communicates with MCP clients
   └───────────────┘
```

---

## Roadmap

### Available Now
- **MCP Servers** - Works with Claude Desktop, Cursor, Zed, and any MCP client
- **CLI Interface** - Beautiful formatted output
- **Beam UI** - Visual interface for humans

### Ecosystem Integrations

**NCP** - [Intelligent MCP Orchestration](https://github.com/portel-dev/ncp)
```bash
ncp add analytics.photon.ts
```

**Lumina** - Anything API Server *(Coming Soon)*
```bash
lumina serve analytics.photon.ts
# → POST /revenue with JSON params
# → Full REST API from your photon methods
```

---

## Documentation

### Guides
- **[GUIDE.md](GUIDE.md)** - Complete tutorial
- **[ADVANCED.md](ADVANCED.md)** - Lifecycle, performance, deployment
- **[PHOTON_BEST_PRACTICES.md](PHOTON_BEST_PRACTICES.md)** - Patterns and practices

### Reference
- **[DOCBLOCK-TAGS.md](DOCBLOCK-TAGS.md)** - All JSDoc tags
- **[NAMING-CONVENTIONS.md](NAMING-CONVENTIONS.md)** - Naming guidelines
- **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)** - Common issues

### Deep Dives
- **[MCP Dependencies](docs/MCP-DEPENDENCIES.md)** - Consuming external MCPs
- **[Daemon Pub/Sub](docs/core/DAEMON-PUBSUB.md)** - Real-time messaging
- **[Auto-UI Architecture](docs/core/AUTO-UI-ARCHITECTURE.md)** - How Beam renders forms

---

## FAQ

### Do I need to extend a base class?
No! Just export any class with async methods.

### Can I use external packages?
Yes! Dependencies are auto-installed from `@dependencies` tags.

### Where are my photons stored?
Default: `~/.photon/` — Use `--working-dir` for custom location.

### Can I fork and customize?
Absolutely! Copy any `.photon.ts`, edit it, run it. No build config needed.

---

## Philosophy

> **"Singular focus. Precise target."**

A photon is the smallest unit of light — delivering singular focus to a precise target.

Each Photon module embodies this:

- **Singular focus** — One responsibility, executed well
- **Precise target** — Clear purpose, clean API
- **Shared interface** — Both humans and AI, together

---

## License

MIT

---

**Built for co-creation. Designed for precision.**

Made with care by [Portel](https://github.com/portel-dev)
