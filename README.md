
<div align="center">

<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-logo.png" alt="Photon" width="500">

**Simplify the creation of CLI tools, MCP servers, and web applications.**

A framework, runtime, and ecosystem — batteries included.

[![npm version](https://img.shields.io/npm/v/@portel/photon?color=cb3837&label=npm)](https://www.npmjs.com/package/@portel/photon)
[![npm downloads](https://img.shields.io/npm/dm/@portel/photon?color=cb3837)](https://www.npmjs.com/package/@portel/photon)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/portel-dev/photon/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Beam UI](#beam) · [Marketplace](#marketplace) · [Docs](#documentation)

</div>

---

## What Is Photon?

Photon lets you write a single TypeScript file and get three things at once:

- **An MCP server** — so AI assistants like [Claude](https://claude.ai), [Cursor](https://cursor.com), or any [MCP client](https://modelcontextprotocol.io) can use your tools
- **A CLI tool** — so you can run the same tools from your terminal
- **A web application** — via [Beam](#beam), a visual dashboard that auto-generates forms and renders results

```
  analytics.photon.ts  →  MCP Server  |  CLI Tool  |  Web UI
```

You write business logic. Photon handles the protocol, schema, interface, and distribution.

### Key Concepts (at a glance)

| Concept | What it is | Learn more |
|---------|-----------|------------|
| **MCP** | Model Context Protocol — a standard way for AI to call external tools | [modelcontextprotocol.io](https://modelcontextprotocol.io/introduction) |
| **Photon file** | A single `.photon.ts` file that defines your tools as class methods | [Guide](./GUIDE.md) |
| **Beam** | A web-based dashboard that renders your tools visually — forms, results, config | [Beam UI](#beam) |
| **Marketplace** | Install community or team photons in one command | [Marketplace](#marketplace) |
| **Daemon** | Background process that powers pub/sub, scheduled jobs, webhooks, and locks | [Daemon Pub/Sub](./DAEMON-PUBSUB.md) |
| **Tags** | JSDoc annotations that control behavior — dependencies, UI, scheduling, validation | [Tag Reference](./DOCBLOCK-TAGS.md) |
| **Custom UI** | Rich HTML interfaces that replace auto-generated forms, using `window.photon` API | [Custom UI Guide](./CUSTOM-UI.md) |

### Who Is This For?

- **Developers** who want to give AI assistants access to APIs, databases, or internal tools
- **Teams** who want to share tooling through a private marketplace
- **Anyone** who wants a CLI + web UI without writing boilerplate

No prior knowledge of MCP is required. If you can write a TypeScript class, you can build a photon.

---

## Quick Start

```bash
npm install -g @portel/photon
photon maker new my-tool
photon                        # Open Beam UI in your browser
```

> **Prerequisites:** [Node.js 18+](https://nodejs.org) and [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm). TypeScript knowledge is helpful but not required — Photon handles compilation.

---

## How It Works

A photon is a TypeScript class where **public methods become tools**. Photon reads your code and automatically generates everything else — JSON schemas from types, descriptions from comments, config from constructor parameters.

This section walks through building a photon step by step, showing what Beam renders at each stage.

### Step 1: The Bare Minimum

A class with one method. That's a working photon.

```typescript
export default class Weather {
  async forecast(params: { city: string }) {
    return `Weather for ${params.city}: Sunny, 72°F`;
  }
}
```

**What Beam renders:** A form with a single text input labeled "city" and a button to execute. The result appears as plain text below.

**What you get:**
- `photon mcp weather` — an MCP server any AI client can connect to
- `photon cli weather forecast --city Paris` — a CLI command
- `photon` — the form above in Beam

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-1.png" alt="Step 1 — Bare method in Beam" width="600">
</div>

### Step 2: Add Descriptions with JSDoc

[JSDoc comments](https://jsdoc.app/) become tool descriptions — visible to both humans in Beam and AI clients via MCP.

```typescript
/**
 * Weather - Check weather forecasts worldwide
 *
 * Provides current conditions and multi-day forecasts
 * for any city. Data sourced from OpenWeather API.
 */
export default class Weather {
  /**
   * Get the weather forecast for a city
   * @param city City name (e.g., "London", "Tokyo")
   */
  async forecast(params: { city: string }) {
    return `Weather for ${params.city}: Sunny, 72°F`;
  }
}
```

**What changes in Beam:** The tool now shows a description. The city input has placeholder text. AI clients see richer context to decide when and how to call the tool.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-2.png" alt="Step 2 — JSDoc descriptions in Beam" width="600">
</div>

### Step 3: Add Configuration via Constructor

Constructor parameters automatically become environment variables and config fields in Beam.

```typescript
export default class Weather {
  constructor(
    private apiKey: string,
    private units: string = 'metric'
  ) {}

  async forecast(params: { city: string }) {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${params.city}&appid=${this.apiKey}&units=${this.units}`
    );
    return await res.json();
  }
}
```

**What changes in Beam:** Before the tool form, Beam shows a configuration panel. `apiKey` appears as a password field (Photon detects sensitive names). `units` has a default value pre-filled. These map to env vars `WEATHER_API_KEY` and `WEATHER_UNITS`.

> Constructor parameters follow a naming convention for env vars: `{PHOTON_NAME}_{PARAM_NAME}` in SCREAMING_SNAKE_CASE. See [Configuration Convention](./GUIDE.md#constructor-configuration).

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-3.png" alt="Step 3 — Configuration panel in Beam" width="600">
</div>

### Step 4: Add Validation and Formatting with Tags

[Inline tags](./DOCBLOCK-TAGS.md#inline-parameter-tags) add validation rules and UI hints. [Format tags](./DOCBLOCK-TAGS.md#output-format-values) control how results render.

```typescript
/**
 * Weather - Check weather forecasts worldwide
 * @dependencies node-fetch@^3.0.0
 */
export default class Weather {
  constructor(
    private apiKey: string,
    private units: string = 'metric'
  ) {}

  /**
   * Get the weather forecast for a city
   * @param city City name {@example London} {@pattern ^[a-zA-Z\s]+$}
   * @param days Number of days {@min 1} {@max 7}
   * @format table
   */
  async forecast(params: { city: string; days?: number }) {
    // fetch and return forecast data...
  }
}
```

**What changes in Beam:**
- The city input shows "London" as a placeholder and validates against the regex pattern
- The days input has a number spinner constrained to 1–7
- Results render as a formatted table instead of raw JSON
- `@dependencies` tells Photon to auto-install `node-fetch` on first run — no `npm install` needed

> See the full [Tag Reference](./DOCBLOCK-TAGS.md) for all available tags — there are 30+ covering validation, UI hints, scheduling, webhooks, and more.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-4.png" alt="Step 4 — Validation and formatting in Beam" width="600">
</div>

### Step 5: Add a Custom UI

When auto-generated forms aren't enough, define an HTML template. It receives tool results and can call tools back.

```typescript
/**
 * Weather - Check weather forecasts worldwide
 * @dependencies node-fetch@^3.0.0
 * @ui dashboard ./ui/weather.html
 */
export default class Weather {
  constructor(private apiKey: string, private units: string = 'metric') {}

  /**
   * Get the weather forecast for a city
   * @ui dashboard
   * @format table
   */
  async forecast(params: { city: string; days?: number }) {
    // returns structured weather data
  }
}
```

```html
<!-- ui/weather.html -->
<div id="weather-app">
  <div id="forecast"></div>
</div>
<script>
  window.photon.onResult(data => {
    document.getElementById('forecast').innerHTML = renderWeather(data);
  });
</script>
```

**What changes in Beam:** Instead of the auto-generated table, results render inside your custom HTML — a weather dashboard with icons, charts, or any visualization you build. The `window.photon` API bridges your UI to the tool system.

> Custom UIs follow the [MCP Apps Extension (SEP-1865)](https://github.com/nicolo-ribaudo/modelcontextprotocol/blob/nicolo/sep-1865/docs/specification/draft/extensions/apps.mdx) standard and work across compatible hosts. See the [Custom UI Guide](./CUSTOM-UI.md).

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-5.png" alt="Step 5 — Custom UI result in Beam" width="600">
</div>

### The Full Picture

From bare class to rich application, each step adds a layer:

| Step | You add | Photon generates |
|------|---------|-----------------|
| **1. Methods** | Public async methods with typed params | MCP tools + CLI commands + Beam forms |
| **2. JSDoc** | Comments on class and methods | Descriptions for AI and humans |
| **3. Constructor** | Parameters with types and defaults | Env var mapping + config UI + CLI flags |
| **4. Tags** | `@format`, `@dependencies`, inline tags | Validation, auto-install, rich rendering |
| **5. Custom UI** | HTML template with `window.photon` | Full interactive application |

---

## Beam

Beam is the human interface to your photons — browse, configure, test, and execute tools visually.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-dashboard.png" alt="Beam Dashboard" width="700">
</div>

<br>

<table>
<tr>
<td width="50%">

<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-tool-form.png" alt="Auto-generated forms" width="100%">

**Auto-generated forms** — Built from your TypeScript types. Required fields marked, types validated.

</td>
<td width="50%">

<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-execute.png" alt="Tool execution" width="100%">

**Execute and verify** — Test every tool before deploying to AI. See exactly what AI will see.

</td>
</tr>
</table>

Run `photon` to open Beam. It discovers all installed photons and renders them with auto-generated forms, configuration panels, and result views — no frontend code required.

---

## Why Single File?

Traditional MCP servers require 4–6 files, 150+ lines of boilerplate, and manual dependency management before you write any business logic. Photon eliminates all of that.

| | Traditional MCP | Photon |
|---|---|---|
| **Files** | 4-6 (server, transport, schemas, types, config) | 1 |
| **Boilerplate** | 150+ lines before business logic | 0 |
| **Dependencies** | Manual `npm install` and import | Auto-install via `@dependencies` tag |
| **Schema** | Hand-written JSON Schema | Auto-generated from TypeScript types |
| **Config** | Manual env var parsing | Constructor params → env vars automatically |
| **Security audit** | Hours across multiple files | Minutes, one file |

> For detailed benchmarks, see [Comparison with Official MCPs](./COMPARISON.md).

---

## Marketplace

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-marketplace.png" alt="Marketplace" width="700">
</div>

<br>

Install production-ready photons or create team marketplaces:

```bash
photon search postgres            # Find photons
photon add postgres               # Install
photon upgrade                    # Keep current
```

**30+ photons available:** PostgreSQL, MongoDB, Redis, SQLite, AWS S3, Docker, Filesystem, Git, GitHub, Email, Slack, Google Calendar, Jira, and more.

Create a private marketplace for your team:

```bash
photon sync marketplace --claude-code
git push origin main
# Team members: photon marketplace add company/photons
```

> See [Marketplace Publishing](./MARKETPLACE-PUBLISHING.md) for setup details.

---

## Commands

```bash
# Run
photon                            # Open Beam UI
photon mcp <name>                 # Run as MCP server
photon mcp <name> --dev           # MCP server with hot reload
photon cli <name> [method]        # Run as CLI tool

# Create
photon maker new <name>           # Scaffold a new photon

# Manage
photon info                       # List all photons
photon info <name> --mcp          # Get MCP client config (paste into Claude/Cursor)
photon validate <name>            # Check for errors

# Marketplace
photon add <name>                 # Install photon
photon search <query>             # Search marketplace
photon upgrade                    # Upgrade all

# Ops
photon doctor                     # Diagnose environment
photon audit                      # Security audit
photon test                       # Run tests
```

---

## Tag Reference (Quick Overview)

Tags are JSDoc annotations that control how Photon processes your code. Here are the most commonly used ones:

| Tag | Where | What it does |
|-----|-------|-------------|
| `@dependencies` | Class | Auto-install npm packages on first run |
| `@format` | Method | Control result rendering (table, list, markdown, code, etc.) |
| `@param ... {@choice a,b,c}` | Param | Dropdown selection in Beam |
| `@param ... {@format email}` | Param | Input validation and field type |
| `@param ... {@min N} {@max N}` | Param | Numeric range constraints |
| `@ui` | Class/Method | Link a custom HTML template |
| `@webhook` | Method | Expose as HTTP endpoint |
| `@scheduled` | Method | Run on a cron schedule |
| `@locked` | Method | Distributed lock across processes |
| `@autorun` | Method | Auto-execute when selected in Beam |
| `@mcp` | Class | Inject another MCP server as a dependency |
| `@icon` | Class/Method | Set emoji icon |

> This is a subset. See the full [Tag Reference](./DOCBLOCK-TAGS.md) for all 30+ tags with examples.

---

## Documentation

**Start here:**

| Guide | |
|-------|-|
| [Getting Started](./GUIDE.md) | Create your first photon, step by step |
| [Tag Reference](./DOCBLOCK-TAGS.md) | Complete JSDoc tag reference with examples |
| [Naming Conventions](./NAMING-CONVENTIONS.md) | How to name methods so they read naturally as CLI commands |
| [Troubleshooting](./TROUBLESHOOTING.md) | Common issues and solutions |

**Build more:**

| Topic | |
|-------|-|
| [Custom UI](./CUSTOM-UI.md) | Build rich interactive interfaces with `window.photon` |
| [OAuth](./AUTH.md) | Built-in OAuth 2.1 with Google, GitHub, Microsoft |
| [Daemon Pub/Sub](./DAEMON-PUBSUB.md) | Real-time cross-process messaging |
| [Webhooks](./WEBHOOKS.md) | HTTP endpoints for external services |
| [Locks](./LOCKS.md) | Distributed locks for exclusive access |
| [Advanced Patterns](./ADVANCED.md) | Lifecycle hooks, dependency injection, interactive workflows |
| [Deployment](./DEPLOYMENT.md) | Docker, Cloudflare Workers, AWS Lambda, Systemd |

**Operate:**

| Topic | |
|-------|-|
| [Security](./SECURITY.md) | Best practices and audit checklist |
| [Marketplace Publishing](./MARKETPLACE-PUBLISHING.md) | Create and share team marketplaces |
| [Best Practices](./PHOTON_BEST_PRACTICES.md) | Patterns for production photons |
| [Comparison](./COMPARISON.md) | Benchmarks vs official MCP implementations |

**Reference:** [Architecture](./ARCHITECTURE.md) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [ARCHITECTURE.md](./ARCHITECTURE.md).

## License

[MIT](./LICENSE)

---

<div align="center">

*Singular focus. Precise target.*

Made by [Portel](https://github.com/portel-dev)

</div>

<!-- PHOTON_MARKETPLACE_START -->
# photon

> **Singular focus. Precise target.**

**Photons** are single-file TypeScript MCP servers that supercharge AI assistants with focused capabilities. Each photon delivers ONE thing exceptionally well - from filesystem operations to cloud integrations.

Built on the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction), photons are:
- **One-command install** via [Photon CLI](https://github.com/portel-dev/photon)
- **Laser-focused** on singular capabilities
- **Zero-config** with auto-dependency management
- **Universal** - works with Claude Desktop, Claude Code, and any MCP client

## Available Photons

Browse all available photons:

```bash
photon search <query>             # Search by keyword
photon info                       # List all available photons
```

**30+ photons** covering databases, cloud services, developer tools, messaging, and more.

---

## Quick Start

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
photon info filesystem --mcp
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

**That's it!** Your AI assistant now has focused tools at its fingertips.

---

## Claude Code Integration

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

- **Granular Installation**: Install only the photons you need
- **Auto-Updates**: Plugin stays synced with marketplace
- **Zero Config**: Photon CLI auto-installs on first use
- **Secure**: No credentials shared with AI (interactive setup available)
- **Individual MCPs**: Each photon is a separate installable plugin

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

## What Are Photons?

**Photons** are laser-focused modules - each does ONE thing exceptionally well:
- **Filesystem** - File operations
- **Git** - Repository management
- **AWS S3** - Cloud storage
- **Google Calendar** - Calendar integration
- **Time** - Timezone operations
- ... and more

Each photon delivers **singular focus** to a **precise target**.

**Key Features:**
- Each photon does one thing perfectly
- 30+ production-ready photons available
- Auto-installs dependencies
- Works out of the box
- Single-file design (easy to fork and customize)

## The Value Proposition

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
photon info filesystem --mcp
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
- One CLI, one command
- Zero configuration
- Instant installation
- Auto-dependencies
- Consistent experience

## Use Cases

**For Claude Users:**
```bash
photon add filesystem git github-issues
photon info --mcp  # Get config for all three
```
Add to Claude Desktop — Now Claude can read files, manage repos, create issues

**For Teams:**
```bash
photon add postgres mongodb redis
photon info --mcp
```
Give Claude access to your data infrastructure

**For Developers:**
```bash
photon add docker git slack
photon info --mcp
```
Automate your workflow through AI

## Browse & Search

```bash
# List all photons
photon info

# Search by keyword
photon search calendar

# View details
photon info google-calendar

# Upgrade all
photon upgrade
```

## For Enterprises

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

Made by [Portel](https://github.com/portel-dev)

<!-- PHOTON_MARKETPLACE_END -->
