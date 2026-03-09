
<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-logo.png" alt="Photon" width="500">
</div>

[![npm version](https://img.shields.io/npm/v/@portel/photon?color=cb3837&label=npm)](https://www.npmjs.com/package/@portel/photon)
[![npm downloads](https://img.shields.io/npm/dm/@portel/photon?color=cb3837)](https://www.npmjs.com/package/@portel/photon)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/portel-dev/photon/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D20-43853d.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed.svg)](https://modelcontextprotocol.io)

### Define intent once. Deliver everywhere.

Photon turns a single TypeScript file into:

- **MCP server** for AI agents  
- **CLI tool** for automation  
- **Web interface** for humans

Photon is free and open source software released under the [MIT license](./LICENSE).

*Interfaces are optional. Intent is mandatory.*

---

## One definition. Multiple interfaces.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-ecosystem.png" alt="Photon: one file, three surfaces" width="100%">
</div>

---

### Example

```typescript
// hello.photon.ts
export default class Hello {
  greet(name: string) {
    return `Hello, ${name}!`;
  }
}
```

That's a complete photon. From this single file, you get:

```
$ photon cli hello greet --name Ada        # CLI
$ photon                                    # Web UI at localhost:3008
$ photon mcp hello                          # MCP server for Claude, Cursor, etc.
```

No decorators. No registration. No server boilerplate.
Just define the intent.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-1.png" alt="One file, three interfaces" width="100%">
</div>

---

## Why Photon Exists

Most software is built around interfaces. We build separate systems for web apps, CLI tools, APIs, and now MCP servers for AI agents. But the underlying logic is often the same.

Photon starts from a different place: capture the intent once in a TypeScript file and let the system expose it through multiple interfaces — CLI tools, web interfaces, and MCP servers.

One definition. Multiple surfaces.

---

### Quick Start

```bash
npm install -g @portel/photon
photon maker new my-tool      # Scaffold a new photon
photon                        # Open Beam, the web UI
```

Or try without installing:

```bash
npx @portel/photon maker new my-tool
npx @portel/photon
```

> Requires [Node.js 20+](https://nodejs.org). TypeScript is compiled internally; no `tsconfig.json` needed.

<div align="center">

<a href="https://www.youtube.com/watch?v=FI0M8s6ZKv4">
  <img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/video-preview.png" alt="Watch: Why Photon? (2 min)" width="100%">
</a>

</div>

---

### How It Works

You write a TypeScript class. Methods are your capabilities. Types describe what's valid. Comments explain the intent. Photon reads all of it and generates three interfaces from one file. Same logic. Same validation. Same data.

```
analytics.photon.ts  →  Web UI (Beam)  ·  CLI  ·  MCP Server for AI
```

The more you express, the more Photon derives:

| What you write | What Photon derives |
|---|---|
| Method signatures | Tool definitions: names, inputs, outputs |
| Type annotations | Input validation rules, UI field types |
| JSDoc comments | Documentation for AI clients and human users |
| Constructor parameters | Config UI, environment variable mapping |
| `@tags` | Validation, formatting, scheduling, webhooks |

When you add a `@param city {@pattern ^[a-zA-Z\s]+$}` annotation, Beam validates it in the form, the CLI validates it before running, and the MCP schema enforces it for the AI. One annotation. Three consumers.

---

## Beam: Human Exploration

Beam is the web dashboard. Every photon becomes an interactive form. Run `photon`. That's the whole command.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-dashboard.png" alt="Beam Dashboard" width="100%">
</div>

The UI is **fully auto-generated** from your method signatures: field types, validation, defaults, layouts. You never write frontend code. When you add a `{@choice a,b,c}` tag to a parameter, Beam renders a dropdown. When you mark a string as `{@format email}`, the field validates email format. The UI evolves as your code does.

When forms aren't the right interface for what you're building, you can replace Beam's auto-generated view with your own HTML. A global named after your photon is auto-injected (e.g., `analytics.onResult(data => ...)`) — no framework required.

> Custom UIs follow the [MCP Apps Extension (SEP-1865)](https://github.com/nicolo-ribaudo/modelcontextprotocol/blob/nicolo/sep-1865/docs/specification/draft/extensions/apps.mdx) standard and work across compatible hosts. See the [Custom UI Guide](./docs/guides/CUSTOM-UI.md).

---

## AI Agents: Machine Invocation

```bash
photon info analytics --mcp
```

```json
{
  "mcpServers": {
    "analytics": {
      "command": "photon",
      "args": ["mcp", "analytics"]
    }
  }
}
```

Paste into your AI client's config. Your photon is now an MCP server. Claude can call your methods. Cursor can call your methods. Any MCP-compatible host can call your methods.

The AI sees the same thing a human sees in Beam: the method names, the parameter descriptions from your JSDoc, the validation rules from your types. The JSDoc comment you wrote to document the tool for yourself is what Claude reads to decide when and how to call it.

The MCP tools themselves work with [Claude Desktop](https://claude.ai/download), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor](https://cursor.com), and any MCP-compatible client.

When your photon has a custom UI, clients that support the [MCP Apps Extension](https://github.com/nicolo-ribaudo/modelcontextprotocol/blob/nicolo/sep-1865/docs/specification/draft/extensions/apps.mdx) render it natively, no separate app needed. The photon below is running inside Claude Desktop, same UI, same data as Beam.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/claude-desktop.png" alt="Photon running as an MCP App with custom UI inside Claude Desktop" width="100%">
</div>

---

## The Progression

Here is how a photon grows. Each step adds one thing and gets multiple capabilities from it.

### Add comments: AI understands your intent

```typescript
/**
 * Weather - Check weather forecasts worldwide
 */
export default class Weather {
  /**
   * Get the weather forecast for a city
   * @param city City name (e.g., "London")
   */
  async forecast(params: { city: string }) { ... }
}
```

The class description becomes how AI clients introduce the tool to users. The `@param` description is what the AI reads before deciding what value to pass. Same comments. Human help text and AI contract at once.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-2.png" alt="Step 2" width="100%">
</div>

### Add a constructor: configuration appears

```typescript
export default class Weather {
  constructor(
    private apiKey: string,
    private units: string = 'metric'
  ) {}

  async forecast(params: { city: string }) {
    const res = await fetch(`...?appid=${this.apiKey}&units=${this.units}`);
    return await res.json();
  }
}
```

`apiKey` becomes a password field in the Beam settings panel and maps to the `WEATHER_API_KEY` environment variable. `units` gets a text input with `'metric'` pre-filled. You declared what you need. Photon built the configuration surface.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-3.png" alt="Step 3" width="100%">
</div>

### Add tags: behavior extends across all surfaces

```typescript
/**
 * @dependencies node-fetch@^3.0.0
 */
export default class Weather {
  /**
   * @param city City name {@example London} {@pattern ^[a-zA-Z\s]+$}
   * @param days Number of days {@min 1} {@max 7}
   * @format table
   */
  async forecast(params: { city: string; days?: number }) { ... }
}
```

`@dependencies` installs `node-fetch` automatically on first run, no `npm install` needed. The `{@pattern}` validates in the form, the CLI, and the MCP schema simultaneously. `days` becomes a number spinner with bounds. `@format table` renders the result as a table in Beam. One annotation, three surfaces.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-4.png" alt="Step 4" width="100%">
</div>

### System CLI dependencies

If your photon wraps a command-line tool, declare it and Photon enforces it at load time:

```typescript
/**
 * @cli ffmpeg - https://ffmpeg.org/download.html
 */
export default class VideoProcessor {
  async convert({ input, format }: { input: string; format: string }) {
    // ffmpeg is guaranteed to exist when this runs
  }
}
```

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/readme-step-5.png" alt="Step 5" width="100%">
</div>

---

## What Comes for Free

Things you don't build because Photon handles them:

| | |
|---|---|
| **Auto-UI** | Forms, field types, validation, layouts generated from your signatures |
| **Stateful instances** | Multiple named instances of the same photon, each with isolated state |
| **Persistent memory** | `this.memory` gives your photon per-instance key-value storage, no database needed |
| **Scheduled execution** | `@scheduled` runs any method on a cron schedule |
| **Webhooks** | `@webhook` exposes any method as an HTTP endpoint |
| **OAuth** | Built-in OAuth 2.0 flows for Google, GitHub, Microsoft |
| **Distributed locks** | `@locked` serializes access: one caller at a time, across processes |
| **Cross-photon calls** | `this.call()` invokes another photon's methods |
| **Real-time events** | `this.emit()` fires named events to the browser UI with zero wiring |
| **Dependency management** | `@dependencies` auto-installs npm packages on first run |

---

## Coordination: Locks + Events

Two primitives. Together they unlock a class of things that are surprisingly hard to build today.

**Locks** serialize access. When a method is marked `@locked`, only one caller can execute at a time, whether that caller is a human in Beam, a CLI script, or an AI agent. Everyone else waits their turn.

**Events** push state changes to any browser UI in real time. `this.emit('boardUpdated', data)` on the server becomes `chess.onBoardUpdated(handler)` in your custom UI — named after your photon file. No WebSockets to configure. No polling. Events are delivered via SSE through the MCP Streamable HTTP transport.

Together: **turn-based coordination with live state**.

```typescript
export default class Chess {
  /** Make a move. Locks ensure human and AI alternate turns. */
  /** @locked */
  async move(params: { from: string; to: string }) {
    const result = await this.applyMove(params.from, params.to);

    // Browser UI updates instantly, no polling needed
    this.emit('boardUpdated', result.board);
    this.emit('turnChanged', { next: result.nextPlayer });

    return result;
  }
}
```

```javascript
// In your custom UI (ui/chess.html)
// The global `chess` is auto-injected, named after your photon file
chess.onBoardUpdated(board => renderBoard(board));
chess.onTurnChanged(({ next }) => showTurn(next));

// Call server methods directly
chess.move({ from: 'e2', to: 'e4' });
```

A human moves through Beam. Claude is configured with the MCP server. The lock ensures they truly alternate. Events keep the board live on both sides. That's a fully functional turn-based chess game, human vs AI, in about 50 lines of application logic.

The same pattern applies beyond games: approval workflows where a human reviews before AI continues, collaborative tools where edits from any source appear instantly, simulations where steps must execute in strict sequence, any system where **who acts next matters**.

---

## Marketplace

32 photons ready to install: databases, APIs, developer tools, and more.

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/beam-marketplace.png" alt="Marketplace" width="100%">
</div>

```bash
photon search postgres
photon add postgres
```

Browse the full catalog in the [official photons repository](https://github.com/portel-dev/photons). You can also host a private marketplace for your team: internal tools that stay off the public internet.

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

| Tag | Where | What it does |
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

> See the full [Tag Reference](./docs/reference/DOCBLOCK-TAGS.md) for all 30+ tags with examples.

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
| [Custom UI](./docs/guides/CUSTOM-UI.md) | Build rich interactive interfaces with the photon bridge API |
| [OAuth](./docs/guides/AUTH.md) | Built-in OAuth 2.0 with Google, GitHub, Microsoft |
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

## Open Source

Photon is free and open source under the [MIT license](./LICENSE).

The project is still evolving and contributions are welcome.

- Star the repository if the idea resonates
- [Report issues](https://github.com/portel-dev/photon/issues)
- [Contribute improvements or examples](./CONTRIBUTING.md)
