
<div align="center">

<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-logo.png" alt="Photon" width="500">

**Build MCP servers from single TypeScript files.**

Write business logic. Get an MCP server, CLI, and web UI — automatically.

[![npm version](https://img.shields.io/npm/v/@portel/photon?color=cb3837&label=npm)](https://www.npmjs.com/package/@portel/photon)
[![npm downloads](https://img.shields.io/npm/dm/@portel/photon?color=cb3837)](https://www.npmjs.com/package/@portel/photon)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/portel-dev/photon/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178c6.svg)](https://www.typescriptlang.org)
[![Node](https://img.shields.io/badge/node-%3E%3D18-43853d.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-7c3aed.svg)](https://modelcontextprotocol.io)

[Quick Start](#quick-start) · [Features](#features) · [Beam UI](#beam) · [Marketplace](#marketplace) · [Docs](#documentation)

</div>

---

## Quick Start

```bash
npm install -g @portel/photon
photon init my-tool
photon                        # Open Beam UI in your browser
```

Create `analytics.photon.ts` — no boilerplate, no config files:

```typescript
/**
 * Analytics - Query company analytics
 * @dependencies pg@^8.11.0
 */
import { Client } from 'pg';

export default class Analytics {
  private db: Client;

  constructor(private host: string, private database: string, private password: string) {}

  async onInitialize() {
    this.db = new Client({ host: this.host, database: this.database, password: this.password });
    await this.db.connect();
  }

  /** Get revenue by date range */
  async revenue(params: { startDate: string; endDate: string }) {
    return (await this.db.query(
      'SELECT date, SUM(amount) FROM orders WHERE date BETWEEN $1 AND $2 GROUP BY date',
      [params.startDate, params.endDate]
    )).rows;
  }
}
```

Same file, three interfaces:

```bash
photon mcp analytics              # MCP server for Claude, Cursor, Zed
photon cli analytics revenue      # CLI for humans
photon                            # Beam web UI
```

<div align="center">
<img src="https://raw.githubusercontent.com/portel-dev/photon/main/assets/photon-concept.jpg" alt="Photon — One file, three interfaces" width="700">
</div>

---

## Beam

Beam is the human interface to MCP — browse, configure, test, and execute tools visually.

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

Constructor parameters become form fields, environment variables, and CLI flags automatically:

```typescript
constructor(
  private host: string,      // → ANALYTICS_HOST env var → text field
  private database: string,  // → ANALYTICS_DATABASE    → text field
  private password: string   // → ANALYTICS_PASSWORD    → password field
) {}
```

---

## Features

### Convention Over Configuration

| What You Write | What Photon Does |
|----------------|-----------------|
| `analytics.photon.ts` | MCP server name: `analytics` |
| `async revenue()` | MCP tool: `revenue` |
| TypeScript types | JSON Schema (auto-generated) |
| JSDoc comments | Tool descriptions |
| Constructor params | Env vars + config UI |
| `@dependencies pg@^8.11.0` | Auto-install on first run |

### Full Platform

- **Hot Reload** — `--dev` flag watches for changes and reloads instantly
- **Daemon Protocol** — Pub/sub channels, distributed locks, scheduled jobs, webhooks
- **Custom UIs** — Build rich interfaces with `window.photon` API
- **OAuth** — Built-in OAuth 2.1 with Google, GitHub, Microsoft providers
- **MCP Composition** — Call other MCP servers with `@mcp` tag
- **Deployment** — Docker, Cloudflare Workers, AWS Lambda, Systemd

### Why Single File?

Traditional MCPs scatter logic across 4-6 files. Photon keeps everything in one:

| | Traditional MCP | Photon |
|---|---|---|
| **Files** | 4-6 (server, transport, schemas, types, config) | 1 |
| **Boilerplate** | 150+ lines before business logic | 0 |
| **Security audit** | Hours across multiple files | Minutes, one file |
| **Fork and customize** | Build config, dependency management | Copy, edit, run |
| **AI context** | Scattered, multi-file coordination | Complete in one read |

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

**Available:** PostgreSQL, MongoDB, Redis, SQLite, AWS S3, Docker, Filesystem, Git, GitHub, Email, Slack, Google Calendar, Jira, and more.

```bash
# Create a team marketplace
photon sync marketplace --claude-code
git push origin main
# Team members: photon marketplace add company/photons
```

---

## Commands

```bash
# Run
photon                            # Open Beam UI
photon mcp <name>                 # MCP server
photon mcp <name> --dev           # MCP server with hot reload
photon cli <name> [method]        # CLI interface

# Manage
photon init <name>                # Create new photon
photon info                       # List all photons
photon info <name> --mcp          # Get MCP client config
photon validate <name>            # Check for errors

# Marketplace
photon add <name>                 # Install photon
photon search <query>             # Search
photon upgrade                    # Upgrade all

# Ops
photon doctor                     # Diagnose environment
photon audit                      # Security audit
photon test                       # Run tests
photon deploy                     # Deploy to production
```

---

## Documentation

**Start here:**

| Guide | |
|-------|-|
| [Getting Started](https://github.com/portel-dev/photon/blob/main/GUIDE.md) | Create your first photon, step by step |
| [Advanced](https://github.com/portel-dev/photon/blob/main/ADVANCED.md) | Lifecycle hooks, performance, testing |
| [Docblock Tags](https://github.com/portel-dev/photon/blob/main/DOCBLOCK-TAGS.md) | Complete JSDoc tag reference |
| [Troubleshooting](https://github.com/portel-dev/photon/blob/main/TROUBLESHOOTING.md) | Common issues and solutions |

**Deep dives:**

| Topic | |
|-------|-|
| [Custom UI](https://github.com/portel-dev/photon/blob/main/CUSTOM-UI.md) | Build rich interactive interfaces |
| [Auth](https://github.com/portel-dev/photon/blob/main/AUTH.md) | OAuth 2.1 with built-in providers |
| [Daemon Pub/Sub](https://github.com/portel-dev/photon/blob/main/DAEMON-PUBSUB.md) | Real-time cross-process messaging |
| [Webhooks](https://github.com/portel-dev/photon/blob/main/WEBHOOKS.md) | HTTP endpoints for external services |
| [Deployment](https://github.com/portel-dev/photon/blob/main/DEPLOYMENT.md) | Docker, Lambda, Workers, Systemd |
| [Security](https://github.com/portel-dev/photon/blob/main/SECURITY.md) | Best practices and audit checklist |
| [Marketplace Publishing](https://github.com/portel-dev/photon/blob/main/MARKETPLACE-PUBLISHING.md) | Create and share marketplaces |

**Reference:** [Architecture](https://github.com/portel-dev/photon/blob/main/ARCHITECTURE.md) · [Best Practices](https://github.com/portel-dev/photon/blob/main/PHOTON_BEST_PRACTICES.md) · [Naming Conventions](https://github.com/portel-dev/photon/blob/main/NAMING-CONVENTIONS.md) · [Comparison](https://github.com/portel-dev/photon/blob/main/COMPARISON.md) · [Changelog](https://github.com/portel-dev/photon/blob/main/CHANGELOG.md)

---

## Contributing

See [CONTRIBUTING.md](https://github.com/portel-dev/photon/blob/main/CONTRIBUTING.md) and [ARCHITECTURE.md](https://github.com/portel-dev/photon/blob/main/ARCHITECTURE.md).

## License

[MIT](https://github.com/portel-dev/photon/blob/main/LICENSE)

---

<div align="center">

*Singular focus. Precise target.*

Made by [Portel](https://github.com/portel-dev)

</div>
