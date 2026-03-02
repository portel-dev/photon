
<div align="center">

<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-logo.png" alt="Photon" width="500">

**One TypeScript file. Used by humans. Invoked by AI.**

A framework for intent, a runtime for continuity, an ecosystem for reuse.

[![npm version](https://img.shields.io/npm/v/@portel/photon?color=cb3837&label=npm)](https://www.npmjs.com/package/@portel/photon)
[![npm downloads](https://img.shields.io/npm/dm/@portel/photon?color=cb3837)](https://www.npmjs.com/package/@portel/photon)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/portel-dev/photon/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Beam UI](#beam) · [Tags](#tag-reference) · [Docs](#documentation)

[![Watch: Why Photon? (2 min)](https://img.youtube.com/vi/FI0M8s6ZKv4/maxresdefault.jpg)](https://www.youtube.com/watch?v=FI0M8s6ZKv4)

</div>

---

## The Claim

You write one TypeScript file. Photon reads it and generates three interfaces: a CLI tool, an MCP server for AI clients, and a web dashboard called Beam.

```
analytics.photon.ts  →  CLI Tool  |  MCP Server  |  Web UI (Beam)
```

The same capability. Same logic. Same data. Available to humans from the terminal, to you through a browser, and to AI through the MCP protocol — all without writing any of that infrastructure yourself.

---

## What You Write

A photon is a TypeScript class. Public methods become tools. That's the whole contract.

```typescript
export default class Analytics {
  async report(params: { period: string }) {
    return await db.query(`SELECT * FROM events WHERE period = $1`, [params.period]);
  }
}
```

This is a complete photon. No decorators. No registration. No server setup. Photon reads the class and derives everything else from it.

---

## The Intent Interpretation Model

Photon doesn't treat your file as code to execute. It treats it as **intent to interpret**.

Every construct in your TypeScript class carries meaning that Photon reads and acts on:

| What you write | What Photon interprets |
|---|---|
| Method signatures | Tool definitions — name, inputs, outputs |
| Type annotations | Input validation rules, UI field types |
| JSDoc comments | Documentation for AI clients and human users |
| Constructor parameters | Configuration — environment variables, settings UI |
| JSDoc `@tags` | Control surfaces — formatting, validation, scheduling, webhooks |

You encode intent once. Photon derives the interfaces. This is the core idea everything else builds on.

---

## What Photon Generates

From the same source file, Photon produces three execution surfaces:

**MCP Server** — AI clients (Claude, Cursor, any MCP host) call your methods as tools. Type annotations become input schemas. JSDoc descriptions help the AI understand what each tool does and when to use it.

**CLI Tool** — Every method is a command. `photon cli analytics report --period 2024-Q4`. Same validation, same logic, runs from your terminal.

**Beam (Web UI)** — A dashboard that generates forms from your method signatures. You open it, fill in parameters, run tools, and see results. No frontend code required.

```bash
photon mcp analytics          # MCP server for Claude/Cursor
photon cli analytics report   # CLI invocation
photon                        # Open Beam dashboard
```

---

## Quick Start

```bash
npm install -g @portel/photon
photon maker new my-tool      # Create a photon
photon                        # Open Beam
```

Or without installing:

```bash
npx @portel/photon maker new my-tool
npx @portel/photon
```

> Requires [Node.js 18+](https://nodejs.org). TypeScript is handled internally — no `tsconfig.json` needed.

---

## Beam

Beam is the web dashboard. Run `photon`. It shows all your photons as forms you can invoke directly.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-dashboard.png" alt="Beam Dashboard" width="100%">
</div>

---

## How It Works

Here is the interpretation model in practice, step by step.

### Step 1: Methods become tools

```typescript
export default class Weather {
  async forecast(params: { city: string }) {
    return `Weather for ${params.city}: Sunny, 72°F`;
  }
}
```

Photon reads this and derives: one tool named `forecast`, one required string input named `city`. Beam generates a form. The CLI gets a `--city` flag. The MCP schema is generated automatically.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-1.png" alt="Step 1 — Method as tool" width="100%">
</div>

### Step 2: Comments become contracts

```typescript
/**
 * Weather - Check weather forecasts worldwide
 *
 * Provides current conditions and multi-day forecasts.
 */
export default class Weather {
  /**
   * Get the weather forecast for a city
   * @param city City name (e.g., "London")
   */
  async forecast(params: { city: string }) {
    return `Weather for ${params.city}: Sunny, 72°F`;
  }
}
```

JSDoc comments become the description in the MCP schema — what AI clients read to decide when and how to call your tool. They also render as help text in Beam and the CLI.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-2.png" alt="Step 2 — Comments as contracts" width="100%">
</div>

### Step 3: Constructors become configuration

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

Constructor parameters become configuration. `apiKey` maps to the `WEATHER_API_KEY` environment variable and renders as a password field in Beam. `units` gets a default and a text input. Photon handles the mapping — you just declare what you need.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-3.png" alt="Step 3 — Constructor as configuration" width="100%">
</div>

### Step 4: Tags become control surfaces

```typescript
/**
 * Weather - Check weather forecasts worldwide
 * @dependencies node-fetch@^3.0.0
 */
export default class Weather {
  constructor(private apiKey: string, private units: string = 'metric') {}

  /**
   * Get the weather forecast for a city
   * @param city City name {@example London} {@pattern ^[a-zA-Z\s]+$}
   * @param days Number of days {@min 1} {@max 7}
   * @format table
   */
  async forecast(params: { city: string; days?: number }) {
    // fetch and return forecast data
  }
}
```

Tags extend the interpretation model. `@dependencies` auto-installs npm packages on first run. `{@pattern}` adds regex validation. `{@min}` and `{@max}` create a number spinner with bounds. `@format table` renders the result as a table in Beam.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-4.png" alt="Step 4 — Tags as control surfaces" width="100%">
</div>

#### CLI tool dependencies

If your photon wraps a system command-line tool, declare it with `@cli`. Photon checks at load time and refuses to start if the tool is missing.

```typescript
/**
 * Video processor
 * @cli ffmpeg - https://ffmpeg.org/download.html
 */
export default class VideoProcessor {
  async convert({ input, format }: { input: string; format: string }) {
    // ffmpeg is guaranteed to exist when this runs
  }
}
```

### Step 5: Custom interfaces (when forms aren't enough)

If the auto-generated form isn't the right interface for your tool, you can write your own HTML. The `window.photon` bridge connects your UI to the tool system.

```typescript
/**
 * Weather - Check weather forecasts worldwide
 * @ui dashboard ./ui/weather.html
 */
export default class Weather {
  /**
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
<div id="forecast"></div>
<script>
  window.photon.onResult(data => {
    document.getElementById('forecast').innerHTML = renderWeather(data);
  });
</script>
```

The result renders in your custom HTML instead of the generated table. The tool call itself — via CLI, MCP, or Beam — works identically. The UI is a view, not logic.

> Custom UIs follow the [MCP Apps Extension (SEP-1865)](https://github.com/nicolo-ribaudo/modelcontextprotocol/blob/nicolo/sep-1865/docs/specification/draft/extensions/apps.mdx) standard. See the [Custom UI Guide](./docs/guides/CUSTOM-UI.md).

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-5.png" alt="Step 5 — Custom interface" width="100%">
</div>

---

## Runtime Systems

Beyond tool execution, Photon includes coordination primitives for building more complex systems.

| System | What it does |
|---|---|
| **Daemon** | Background process that handles pub/sub messaging across photons and processes |
| **Named instances** | Multiple isolated instances of the same photon, each with its own state |
| **Webhooks** | Expose any method as an HTTP endpoint with `@webhook` |
| **Scheduled runs** | Execute methods on a cron schedule with `@scheduled` |
| **Distributed locks** | Prevent concurrent execution of a method with `@locked` |
| **OAuth** | Built-in OAuth 2.1 flows for Google, GitHub, Microsoft |
| **Memory** | Per-photon persistent storage via `this.memory` |
| **Cross-photon calls** | Call another photon's methods via `this.call()` |

These exist because durable tools need more than just execution — they need persistence, coordination, and the ability to receive external signals.

---

## Connecting to AI

```bash
photon info weather --mcp
```

Outputs the config block for your AI client:

```json
{
  "mcpServers": {
    "weather": {
      "command": "photon",
      "args": ["mcp", "weather"]
    }
  }
}
```

Paste it into your client's config. Works with [Claude Desktop](https://claude.ai/download), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.com), and any MCP-compatible host.

---

## Marketplace

Installable photons for common use cases.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-marketplace.png" alt="Marketplace" width="100%">
</div>

```bash
photon search postgres
photon add postgres
```

Browse the full catalog in the [official photons repository](https://github.com/portel-dev/photons). You can also host a private marketplace for your team.

---

## Summary

| What you write | What Photon derives |
|---|---|
| Methods | Tools, CLI commands, Beam forms |
| Type annotations | Input validation, field types |
| JSDoc comments | AI and human documentation |
| Constructor parameters | Config UI, environment variable mapping |
| `@tags` | Validation, formatting, scheduling, webhooks, dependencies |
| HTML templates | Custom interfaces for results |

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-ecosystem.png" alt="Photon Ecosystem" width="100%">
</div>

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
photon info <name> --mcp          # Get MCP client config
photon maker validate <name>      # Check for errors

# Marketplace
photon add <name>                 # Install photon
photon search <query>             # Search marketplace
photon upgrade                    # Upgrade all

# Ops
photon doctor                     # Diagnose environment
photon test                       # Run tests
```

---

## Tag Reference

Tags are JSDoc annotations that extend what Photon interprets from your code:

| Tag | Where | What it controls |
|---|---|---|
| `@dependencies` | Class | Auto-install npm packages on first run |
| `@cli` | Class | Declare system CLI dependencies, checked at load time |
| `@format` | Method | Result rendering (table, list, markdown, code, etc.) |
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

> This is a subset. See the full [Tag Reference](./docs/reference/DOCBLOCK-TAGS.md) for all 30+ tags.

---

## Documentation

**Start here:**

| Guide | |
|---|---|
| [Getting Started](./docs/GUIDE.md) | Create your first photon, step by step |
| [Tag Reference](./docs/reference/DOCBLOCK-TAGS.md) | Complete JSDoc tag reference with examples |
| [Naming Conventions](./docs/guides/NAMING-CONVENTIONS.md) | How to name methods so they read naturally as CLI commands |
| [Troubleshooting](./docs/TROUBLESHOOTING.md) | Common issues and solutions |

**Build more:**

| Topic | |
|---|---|
| [Custom UI](./docs/guides/CUSTOM-UI.md) | Build rich interactive interfaces with `window.photon` |
| [OAuth](./docs/guides/AUTH.md) | Built-in OAuth 2.1 with Google, GitHub, Microsoft |
| [Daemon Pub/Sub](./docs/core/DAEMON-PUBSUB.md) | Real-time cross-process messaging |
| [Webhooks](./docs/reference/WEBHOOKS.md) | HTTP endpoints for external services |
| [Locks](./docs/reference/LOCKS.md) | Distributed locks for exclusive access |
| [Advanced Patterns](./docs/guides/ADVANCED.md) | Lifecycle hooks, dependency injection, interactive workflows |
| [Deployment](./docs/guides/DEPLOYMENT.md) | Docker, Cloudflare Workers, AWS Lambda, Systemd |

**Operate:**

| Topic | |
|---|---|
| [Security](./SECURITY.md) | Best practices and audit checklist |
| [Marketplace Publishing](./docs/guides/MARKETPLACE-PUBLISHING.md) | Create and share team marketplaces |
| [Best Practices](./docs/guides/BEST-PRACTICES.md) | Patterns for production photons |
| [Comparison](./docs/COMPARISON.md) | Benchmarks vs official MCP implementations |

**Reference:** [Architecture](./docs/core/ARCHITECTURE.md) · [Changelog](./CHANGELOG.md) · [Contributing](./CONTRIBUTING.md)

---

## Contributing

Open an issue or a PR. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE).

---

<div align="center">

*Singular focus. Precise target.*

Made by [Portel](https://github.com/portel-dev)

</div>
