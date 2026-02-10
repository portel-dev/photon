# Constructor Injection

Photon uses a single mechanism for all dependency injection: **constructor parameters**. The runtime inspects each parameter and determines what to inject based on its type and matching docblock declarations.

## The Four Injection Types

```typescript
/**
 * DevOps Dashboard
 * @mcp github anthropics/mcp-server-github
 * @photon billing billing-photon
 * @stateful true
 */
export default class Dashboard {
  constructor(
    apiKey: string,                  // 1. Environment variable
    private github: any,             // 2. MCP client (matches @mcp github)
    private billing: any,            // 3. Photon instance (matches @photon billing)
    private incidents: Incident[] = [] // 4. Persisted state (restored on restart)
  ) {}
}
```

| # | Type | Trigger | Managed by | Source |
|---|------|---------|------------|--------|
| 1 | **Environment** | Primitive, no default | `photon set` | `~/.photon/env/` or `process.env` |
| 2 | **Context** | Primitive, has default | `photon use` | `~/.photon/context/` |
| 3 | **MCP client** | Name matches `@mcp` declaration | Runtime | Proxy to running MCP server |
| 4 | **Photon instance** | Name matches `@photon` declaration | Runtime | Loaded photon class instance |
| 5 | **Persisted state** | Non-primitive with default, on `@stateful` photon | Runtime | `~/.photon/state/` |

> **See [CONSTRUCTOR-CONTEXT.md](CONSTRUCTOR-CONTEXT.md)** for full details on `photon use` and `photon set` commands, including context-based state partitioning for `@stateful` photons.

### Resolution Order

For each constructor parameter, the runtime resolves in this order:

1. **Matches `@mcp` tag?** → Create/reuse MCP client proxy
2. **Matches `@photon` tag?** → Load/reuse photon instance
3. **Primitive, no default?** → Environment variable (`~/.photon/env/` then `process.env`)
4. **Primitive, has default?** → Context value (`~/.photon/context/`, falls back to default)
5. **Non-primitive with default on `@stateful`?** → Restore from state snapshot
6. **Fallback** → `undefined` (constructor default applies)

---

## 1. Environment Variables

Primitive constructor parameters are automatically mapped to environment variables.

```typescript
export default class Mailer {
  constructor(
    private smtpHost: string = 'localhost',
    private smtpPort: number = 587,
    private useTls: boolean = true
  ) {}
}
```

| Parameter | Environment Variable | Conversion |
|-----------|---------------------|------------|
| `smtpHost` | `MAILER_SMTP_HOST` | String (as-is) |
| `smtpPort` | `MAILER_SMTP_PORT` | `Number("587")` → `587` |
| `useTls` | `MAILER_USE_TLS` | `"true"` → `true` |

If the env var is not set and the parameter has a default, the default applies. If the env var is not set and the parameter is required (no default), the runtime reports a configuration error.

---

## 2. MCP Client Injection

Declare MCP dependencies with `@mcp` and receive ready-to-use client proxies.

```typescript
/**
 * @mcp github anthropics/mcp-server-github
 * @mcp filesystem npm:@modelcontextprotocol/server-filesystem
 */
export default class Manager {
  constructor(
    private github: any,     // Injected: proxy to GitHub MCP
    private filesystem: any  // Injected: proxy to Filesystem MCP
  ) {}

  async listRepos() {
    return await this.github.list_repos({ org: 'my-org' });
  }

  async readFile(path: string) {
    return await this.filesystem.read_file({ path });
  }
}
```

The injected proxy supports:
- **`client.<tool>(params)`** — Call any tool directly
- **`client.list()`** — List available tools
- **`client.find(query)`** — Search tools by name
- **`client.call(name, params)`** — Call tool by string name

MCP clients are cached and reused across the photon's lifetime.

### Source Types

| Format | Example | Description |
|--------|---------|-------------|
| GitHub | `anthropics/mcp-server-github` | Cloned and run via npx |
| npm | `npm:@modelcontextprotocol/server-filesystem` | Installed from npm |
| URL | `https://api.example.com/mcp` | Remote Streamable HTTP |
| Local | `./my-local-mcp` | Local file path |

---

## 3. Photon Instance Injection

Declare photon dependencies with `@photon` and receive initialized instances.

```typescript
/**
 * @photon rss rss-feed
 * @photon weather ./weather.photon.ts
 */
export default class NewsDigest {
  constructor(
    private rss: any,     // Injected: loaded rss-feed photon instance
    private weather: any  // Injected: loaded local weather photon instance
  ) {}

  async digest() {
    const articles = await this.rss.fetch({ url: 'https://news.ycombinator.com/rss' });
    const forecast = await this.weather.today();
    return { articles, forecast };
  }
}
```

Photon dependencies are resolved recursively — an injected photon can itself have dependencies that get injected.

### Source Types

| Format | Example | Description |
|--------|---------|-------------|
| Marketplace | `rss-feed` | Installed from photon marketplace |
| GitHub | `portel-dev/photons/rss-feed` | Cloned from GitHub |
| npm | `npm:@portel/rss-feed-photon` | Installed from npm |
| Local | `./weather.photon.ts` | Local file path |

---

## 4. Stateful Persistence

When a photon is marked `@stateful true`, non-primitive constructor parameters with defaults become **automatically persisted**. The runtime snapshots their values on every mutation and restores them on restart.

### How It Works

```typescript
/**
 * A simple list
 * @stateful true
 */
export default class List {
  items: string[];

  constructor(items: string[] = []) {
    this.items = items;
  }

  add(item: string): void {
    this.items.push(item);
  }

  remove(item: string): boolean {
    const idx = this.items.indexOf(item);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      return true;
    }
    return false;
  }

  getAll(): string[] {
    return this.items;
  }
}
```

**First run:**
1. No snapshot exists → `new List()` → default `items = []` applies
2. User calls `add("apples")` → reactive array detects `.push()`
3. Runtime persists `{ "items": ["apples"] }` to `~/.photon/state/list.json`

**Daemon restarts:**
1. Runtime reads `~/.photon/state/list.json` → `{ "items": ["apples"] }`
2. Instantiates `new List(["apples"])` — constructor default overridden
3. State is fully restored, user sees their data

**Ongoing:**
- Every mutation to `items` triggers a debounced persist
- The same mutation also emits events for auto-UI (via reactive array)
- Persistence is a side-effect of reactivity, not a separate mechanism

### Why Constructor Injection

The constructor already serves as the dependency injection point for env vars, MCPs, and photons. Adding persisted state to the same mechanism means:

- **No new API** — constructors with defaults are standard TypeScript
- **No `@persist` tag** — `@stateful true` already declares the intent
- **Testable** — pass mock data to the constructor in tests
- **Explicit** — the constructor signature documents what state the photon holds

### Sync Methods Work

Reactive arrays work with synchronous methods. The layers are:

```
items.push('hello')           ← sync, in your method
  → Proxy intercepts push()   ← sync, reactive array
  → emitter('items:added')    ← sync, queues the event
                                ↓
  daemon broadcasts via SSE    ← async, runtime handles it
  runtime persists to disk     ← async, debounced, runtime handles it
```

Your method is sync, returns void, finishes immediately. The reactive machinery captures the mutation synchronously, but network delivery (SSE to auto-UI) and disk persistence happen asynchronously in the runtime — the photon never needs to know or wait.

### Shared State Across Clients

Because `@stateful` photons live in the daemon, all clients share the same instance:

```
CLI: photon cli list add --item "apples"
                    │
                    ▼
              Daemon instance ← single List instance
                    │
                    ▼
Beam auto-UI sees 'items:added' event → re-renders
```

Add from CLI → see it in Beam. Add from Beam → see it in CLI. One instance, multiple clients.

---

## Combining All Four

A real-world photon might use all four injection types:

```typescript
/**
 * Incident tracker
 * @mcp slack anthropics/mcp-server-slack
 * @photon pagerduty pagerduty-photon
 * @stateful true
 */
export default class IncidentTracker {
  incidents: Incident[];

  constructor(
    private webhookUrl: string,            // ENV: INCIDENTTRACKER_WEBHOOK_URL
    private slack: any,                    // MCP: Slack client proxy
    private pagerduty: any,               // Photon: PagerDuty instance
    incidents: Incident[] = []            // State: restored from snapshot
  ) {
    this.incidents = incidents;
  }

  report(title: string, severity: string): Incident {
    const incident = { id: crypto.randomUUID(), title, severity, status: 'open' };
    this.incidents.push(incident);
    // Reactive array: auto-emits 'incidents:added'
    // Runtime: auto-persists to disk
    return incident;
  }

  async escalate(id: string) {
    const incident = this.incidents.find(i => i.id === id);
    await this.slack.send_message({ channel: '#incidents', text: `Escalating: ${incident.title}` });
    await this.pagerduty.trigger({ service: 'backend', description: incident.title });
    return { escalated: true };
  }
}
```

The runtime resolves each parameter independently:
1. `webhookUrl` — primitive string → reads `INCIDENTTRACKER_WEBHOOK_URL` env var
2. `slack` — matches `@mcp slack` → creates Slack MCP client proxy
3. `pagerduty` — matches `@photon pagerduty` → loads pagerduty photon instance
4. `incidents` — non-primitive with default on `@stateful` → restores from snapshot
