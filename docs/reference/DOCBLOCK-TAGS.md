# Supported Docblock Tags

Photon uses JSDoc-style docblock tags to extract metadata, configure tools, and generate documentation. This page lists all supported tags organized by where they can be used.

## Class-Level Tags

These tags are placed in the JSDoc comment at the top of your `.photon.ts` file, before the class declaration.

| Tag | Description | Example |
|-----|-------------|---------|
| `@version` | Photon version. Defaults to runtime version if omitted. | `@version 1.0.0` |
| `@author` | Author of the photon. | `@author Jane Doe` |
| `@license` | License type. | `@license MIT` |
| `@repository` | Source repository URL. | `@repository https://github.com/user/repo` |
| `@homepage` | Project homepage URL. | `@homepage https://example.com` |
| `@runtime` | **Required runtime version.** The photon will refuse to load if the runtime doesn't match. | `@runtime ^1.5.0` |
| `@dependencies` | NPM packages to auto-install on first run. Append `?` to the version to mark optional — install is best-effort and the photon should handle the dep being unavailable at runtime. | `@dependencies axios@^1.0.0, sharp@^0.33.0?` |
| `@mcp` | Declares an MCP dependency for constructor injection. Append `?` to the source to mark optional — injects `null` if the server can't connect. | `@mcp github anthropics/mcp-server-github` or `@mcp analytics my-analytics?` |
| `@photon` | Declares a Photon dependency (auto-install + auto-load). Append `:instance` to pin a named instance. Append `?` to the source to mark optional — injects `null` if the photon can't load. | `@photon billing billing-photon` or `@photon whatsapp ./whatsapp.photon.ts?` |
| `@cli` | Declares a system CLI tool dependency. | `@cli git - https://git-scm.com/downloads` |
| `@mcps` | Lists MCP dependencies (for diagram generation). | `@mcps filesystem, git` |
| `@photons` | Lists Photon dependencies (for diagram generation). | `@photons calculator` |
| `@stateful` | Set to `true` if the photon maintains state between calls. | `@stateful true` |
| `@idleTimeout` | Idle timeout in milliseconds before process termination. | `@idleTimeout 300000` |
| `@ui` | Defines a UI template asset for MCP Apps. Use `.photon.html` extension for declarative mode (auto-binding via data attributes, no JS required). Use `.html` for full-control mode. UIs run in a sandboxed `blob:` iframe — see [Custom UI → Sandbox Constraints](../guides/CUSTOM-UI.md#sandbox-constraints) before adding client-side AI models, WebGPU, or cross-origin fetches. | `@ui my-view ./ui/view.html` or `@ui my-view ./ui/view.photon.html` |
| `@prompt` | Defines a static prompt asset. | `@prompt greet ./prompts/greet.txt` |
| `@resource` | Defines a static resource asset. | `@resource data ./data.json` |
| `@icon` | Sets the photon icon (emoji or image path). | `@icon 🔧` or `@icon ./icons/tool.png` |
| `@icons` | Declares icon image variants with size/theme. | `@icons ./icons/tool-48.png 48x48 dark` |
| `@tags` | Comma-separated tags for categorization and search. | `@tags database, sql, postgresql` |
| `@label` | Custom display name for the photon in BEAM sidebar. | `@label My Custom Tool` |
| `@persist` | Enables settings UI persistence for the photon. | `@persist` |
| `@internal` | Marks entire photon as internal (hidden from sidebar). | `@internal` |
| `@worker` | Forces the photon to run in an isolated worker thread. See [Worker Isolation](#worker-isolation). | `@worker` |
| `@noworker` | Forces the photon to run in-process even if it has lifecycle hooks. See [Worker Isolation](#worker-isolation). | `@noworker` |
| `@auth` | MCP OAuth auth requirement. Enables `this.caller` for identity-aware methods. | `@auth required` or `@auth optional` |
| `@forkedFrom` | Origin reference for forked photons. Auto-injected on install. | `@forkedFrom portel-dev/photons#kanban` |

### Worker Isolation

By default, all photons run in the main daemon process. Photons that manage long-running resources (WebSocket connections, polling loops, auth sessions) benefit from **worker thread isolation** — if another photon crashes or a hot-reload fails, isolated photons are unaffected.

**Auto-detection:** Photons with both `onShutdown()` and `onInitialize()` lifecycle methods are automatically placed in worker threads. These methods signal that the photon manages runtime resources that need careful handoff during reloads.

**Explicit control:**

| Tag | Effect |
|-----|--------|
| `@worker` | Force worker isolation (even without lifecycle hooks) |
| `@noworker` | Force in-process execution (even with lifecycle hooks) |

**Priority:** `@noworker` > `@worker` > auto-detect (lifecycle hooks) > default (in-process)

**What happens in a worker:**
- The photon runs in a dedicated Node.js `Worker` thread
- Tool calls are routed via IPC (adds ~1-2ms overhead)
- `@photon` cross-dependencies are resolved via RPC through the main thread
- Pub/sub events are bridged between workers automatically
- A crash only affects that worker — other photons keep running
- Hot-reload sends a reload message to the worker; failure preserves the old instance

**When NOT to use workers:**
- Simple stateless photons (overhead with no benefit)
- Photons under active development (faster hot-reload in-process)
- Photons that only use `this.memory` for state (disk-backed, survives restarts)

### Runtime Version Ranges

The `@runtime` tag supports semver-style version ranges:

| Range | Meaning | Example |
|-------|---------|---------|
| `^1.5.0` | Compatible with 1.5.0 and above, below 2.0.0 | `@runtime ^1.5.0` |
| `~1.5.0` | Compatible with 1.5.x only | `@runtime ~1.5.0` |
| `>=1.5.0` | Any version 1.5.0 or higher | `@runtime >=1.5.0` |
| `1.5.0` | Exact version match required | `@runtime 1.5.0` |

### MCP OAuth Authentication

The `@auth` tag enables MCP OAuth 2.1 authentication, making `this.caller` available in every method. The runtime handles the full OAuth flow per the [MCP authorization spec](https://modelcontextprotocol.io/specification/latest/basic/authorization).

| Value | Behavior |
|-------|----------|
| `@auth required` | All methods require a valid JWT. Anonymous callers get 401. |
| `@auth optional` | Caller populated if token present, anonymous allowed (default without tag). |
| `@auth https://accounts.google.com` | OIDC provider URL (implies required). Advertised in PRM metadata. |

**What the runtime does when `@auth` is set:**
1. Serves `/.well-known/oauth-protected-resource` (RFC 9728 Protected Resource Metadata)
2. Returns `401 WWW-Authenticate` challenge when no Bearer token is present
3. Decodes JWT claims from `Authorization: Bearer` header
4. Populates `this.caller` with `{ id, name, anonymous, scope, claims }`
5. Upgrades `@locked` middleware to check `this.caller.id` against lock holder

**`this.caller` properties:**

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Stable user ID (JWT `sub` claim). `'anonymous'` if no token. |
| `name` | `string?` | Display name from OIDC profile |
| `anonymous` | `boolean` | `true` if no valid JWT was provided |
| `scope` | `string?` | OAuth scopes granted |
| `claims` | `Record<string, unknown>?` | Full JWT claims for custom fields |

```typescript
/**
 * Multiplayer game
 * @stateful
 * @auth required
 */
export default class Game {
  async join() {
    return { playerId: this.caller.id, name: this.caller.name };
  }
}
```

### Resolving Paths Against the User's Invocation Directory

Use **`this.callerCwd`** (not `process.cwd()`) when defaulting parameters that point at project files.

Stateful photons run inside a daemon worker thread. `process.cwd()` inside the worker is the *daemon's* cwd, which is rarely where the user ran `photon cli ...` from. The same divergence applies to cross-photon `this.call('other.method', ...)` invocations: the callee runs in a different worker entirely. `this.callerCwd` returns the originating CLI directory and propagates through every cross-call boundary.

```typescript
export default class KithFilter {
  async score(params: { mePath?: string }) {
    // Defaults to <user's invocation dir>/me.md, regardless of where the
    // daemon was launched or whether this method was invoked directly or
    // through `this.call('kith-filter.score', ...)`.
    const mePath = params.mePath ?? path.join(this.callerCwd, 'me.md');
    // ...
  }
}
```

`this.callerCwd` falls back to `process.cwd()` when no caller context is attached (e.g., direct in-process loads with no CLI invocation), so it is always safe to read.

## Method-Level Tags

These tags are placed in the JSDoc comment immediately before a tool method.

| Tag | Description | Example |
|-----|-------------|---------|
| `@param` | Describes a tool parameter. | `@param name User's full name` |
| `@returns` | Describes the return value. Can include `{@label}`. | `@returns The greeting message {@label Say Hello}` |
| `@example` | Provides a code example. | `@example await tool.greet({ name: 'World' })` |
| `@format` | Hints the output format for CLI/Web interfaces. Values: `table`, `list`, `card`, `grid`, `tree`, `json`, `markdown`, `mermaid`, `code`, `slides`, `chart:bar`, `chart:hbar`, `chart:scatter`, `chart:radar`, `chart:histogram`, `metric`, `gauge`, `ring`, `stat-group`, `heatmap`, `calendar`, `map`, `network`, `cron`, `timeline`, `steps`, `kanban`, `comparison`, `diff`, `log`, `embed`, `image`, `carousel`, `gallery`, `masonry`, `hero`, `banner`, `quote`, `profile`, `feature-grid`, `invoice`, `dashboard`, `panels`, `tabs`, `qr`, etc. | `@format table` |
| `@export` | Declares supported export formats for `_meta.format` client requests. Comma-separated. If absent, `json` and `yaml` are always available. | `@export csv,json,yaml,markdown` |
| `@icon` | Sets the tool icon (emoji, icon name, or image path). | `@icon 🧮` or `@icon ./calc.png` |
| `@icons` | Declares icon image variants with size/theme. | `@icons ./calc-48.png 48x48 dark` |
| `@autorun` | Auto-execute when selected in Beam UI (for idempotent methods). | `@autorun` |
| `@async` | Run in background, return execution ID immediately. | `@async` |
| `@ui` | Links a tool to a UI template defined at class level. | `@ui my-view` |
| `@fallback` | **Functional.** Return default value on error. | `@fallback []` |
| `@logged` | **Functional.** Auto-log execution with timing. | `@logged` or `@logged debug` |
| `@circuitBreaker` | **Functional.** Fast-reject after consecutive failures. | `@circuitBreaker 5 30s` |
| `@cached` | **Functional.** Memoize results with TTL. | `@cached 5m` |
| `@timeout` | **Functional.** Execution time limit. | `@timeout 30s` |
| `@retryable` | **Functional.** Auto-retry on failure. | `@retryable 3 1s` |
| `@throttled` | **Functional.** Rate limit per method. | `@throttled 10/min` |
| `@debounced` | **Functional.** Collapse rapid repeated calls. | `@debounced 500ms` |
| `@queued` | **Functional.** Sequential execution queue. | `@queued 1` |
| `@validate` | **Functional.** Runtime input validation rules. | `@validate params.email must be a valid email` |
| `@deprecated` | **Functional.** Mark tool as deprecated. | `@deprecated Use v2 instead` |
| `@internal` | Hide method from LLM and sidebar. Still callable by the runtime (e.g. scheduled jobs, system callbacks). | `@internal` |
| `@use` | **Functional.** Apply custom or built-in middleware with inline config. | `@use audit {@level info}` |
| `@title` | **MCP.** Human-readable display name for the tool. | `@title Create New Task` |
| `@readOnly` | **MCP.** Tool has no side effects — safe for auto-approval. | `@readOnly` |
| `@destructive` | **MCP.** Tool performs destructive operations — requires confirmation. | `@destructive` |
| `@idempotent` | **MCP.** Tool is safe to retry — multiple calls produce same effect. | `@idempotent` |
| `@openWorld` | **MCP.** Tool interacts with external systems beyond local data. | `@openWorld` |
| `@closedWorld` | **MCP.** Tool operates only on local data (sets openWorldHint to false). | `@closedWorld` |
| `@audience` | **MCP.** Who sees tool results: `user`, `assistant`, or both. | `@audience user` |
| `@priority` | **MCP.** Content importance hint (0.0-1.0). | `@priority 0.8` |

### MCP Tool Annotations

Tags prefixed with **MCP.** map directly to MCP protocol `Tool.annotations` fields (spec 2025-11-25). These hints help clients make UX decisions:

- **`@readOnly`** → `annotations.readOnlyHint: true` — Client may auto-approve without user confirmation
- **`@destructive`** → `annotations.destructiveHint: true` — Client should require explicit confirmation
- **`@idempotent`** → `annotations.idempotentHint: true` — Client may safely retry on failure
- **`@openWorld`** / **`@closedWorld`** → `annotations.openWorldHint: true/false` — Informs client about external side effects
- **`@title`** → `annotations.title` — Display name shown in tool selection UI
- **`@audience`** → Content block `annotations.audience` — Controls who sees results:
  - `@audience user` — Results are for the human user (e.g. dashboard data)
  - `@audience assistant` — Results are for the LLM only (e.g. internal context)
  - Both/default — Results are for both audiences
- **`@priority`** → Content block `annotations.priority` — Importance weighting for result display

**Note:** Method-level `@readOnly` (no curly braces) is distinct from parameter-level `{@readOnly}` (inside `@param` tags). They serve different purposes and do not conflict.

```typescript
/**
 * List all tasks — no side effects, safe to auto-approve
 * @readOnly
 * @idempotent
 * @title List All Tasks
 * @audience user
 * @priority 0.9
 */
list() { ... }

/**
 * Permanently delete a task — requires confirmation
 * @destructive
 * @openWorld
 * @title Delete Task
 */
remove({ id }: { id: string }) { ... }
```

### UI-Only Methods Pattern

Combine `@internal` + `@audience user` to create methods that are callable by custom UI templates (via `window.photon.callTool()`) but hidden from the LLM tool listing:

```typescript
/**
 * View the agent's journal — dashboard use only.
 *
 * @title Agent Journal
 * @internal
 * @audience user
 * @readOnly
 */
async journal(params: { agent: string }): Promise<JournalEntry[]> { ... }
```

- **`@internal`** hides the method from `tools/list` — the LLM never sees it as an available tool
- **`@audience user`** adds content annotations so the transport marks results as human-only
- The UI can still call it directly via `window.photon.callTool('journal', { agent: 'lura' })`

This pattern is useful for dashboard panels, admin controls, and evolution management methods that humans manage through a UI rather than through LLM conversation.

| Combination | LLM sees tool? | UI can call? | Use case |
|-------------|---------------|-------------|----------|
| *(no tags)* | Yes | Yes | Standard tools (both audiences) |
| `@internal` | No | Yes | Scheduled jobs, system callbacks |
| `@internal` + `@audience user` | No | Yes | Dashboard-only methods |
| `@audience assistant` | Yes | Yes | LLM-facing data the human doesn't need |

### Structured Output

Photon automatically generates `Tool.outputSchema` from your TypeScript return type — no tags needed:

```typescript
// Just write TypeScript — schema is auto-inferred
async create(params: { title: string }): Promise<{ id: string; title: string; done: boolean }> {
  return { id: 'task-001', title: params.title, done: false };
}
```

When you want field descriptions, use an interface or type with JSDoc on properties:

```typescript
interface Task {
  /** Unique task identifier */
  id: string;
  /** Task title */
  title: string;
  /** Whether the task is complete */
  done: boolean;
}

async create(params: { title: string }): Promise<Task> { ... }
```

When `outputSchema` is present, MCP responses include `structuredContent` alongside text content, giving AI clients typed data instead of stringified JSON.

### Icon Images

The `@icon` tag supports both emoji/icon names and image file paths. When a file path is detected (starts with `./` or `../`, or ends with an image extension), Photon reads the file at load time and converts it to a `data:` URI for the MCP `Tool.icons[]` field.

Use `@icons` for explicit size/theme variants:

```typescript
/**
 * @icon ./icons/calc.png                  ← single image, auto-detected MIME
 * @icons ./icons/calc-48.png 48x48        ← explicit size
 * @icons ./icons/calc-dark.svg dark        ← theme variant
 * @icons ./icons/calc-96.png 96x96 dark   ← size + theme
 */
```

Supported formats: PNG, JPEG, GIF, SVG, WebP, ICO. Paths are resolved relative to the photon file.

Emoji icons (`@icon 🧮`) continue to work as before via `x-icon` for Beam UI backward compatibility.

### Async Execution

Methods tagged with `@async` run in the background. The client receives an execution ID immediately while the method continues executing. Results are recorded in the execution audit trail.

```typescript
/**
 * Generate a quarterly report — takes several minutes
 * @async
 * @param quarter The quarter to generate (e.g., "Q1-2026")
 */
async generate({ quarter }: { quarter: string }) {
  const data = await this.fetchAllData(quarter);
  const report = await this.buildReport(data);
  await this.memory.set('latest_report', report);
  return report; // Stored in audit trail, retrievable by execution ID
}
```

**Client response (immediate):**
```json
{
  "executionId": "exec_a1b2c3d4e5f6g7h8",
  "status": "running",
  "photon": "report-generator",
  "method": "generate",
  "message": "Task started in background. Use execution ID to check status."
}
```

**When to use `@async`:**
- Data processing or report generation that takes minutes
- Batch operations across large datasets
- Any operation where the client shouldn't block waiting

**How results are stored:** The execution audit trail (`~/.photon/.data/{photonId}/logs/executions.jsonl`) records the full result, timing, and any errors once the background task completes.

## Daemon Feature Tags

These tags enable daemon-specific features like webhooks, scheduled jobs, and distributed locks. They are extracted at build time and used by the Photon daemon to register handlers and schedule tasks.

| Tag | Description | Example |
|-----|-------------|---------|
| `@webhook` | Exposes method as an HTTP webhook endpoint. | `@webhook` or `@webhook stripe` |
| `@scheduled` | Schedules method to run on a cron schedule. | `@scheduled 0 0 * * *` |
| `@cron` | Alias for `@scheduled`. | `@cron 30 2 * * 1-5` |
| `@locked` | Acquires a distributed lock before executing. | `@locked` or `@locked board:write` |

### Webhook Endpoints

Methods can be exposed as HTTP webhook endpoints using the `@webhook` tag or the `handle*` prefix convention.

```typescript
/**
 * Handle Stripe payment events
 * @webhook stripe
 */
async handleStripePayment(params: { event: any }) {
  // Accessible at POST /webhook/stripe
}

/**
 * Auto-detected as webhook from handle* prefix
 */
async handleGithubIssue(params: { action: string; issue: any }) {
  // Accessible at POST /webhook/handleGithubIssue
}
```

**Conventions:**
- `@webhook` - Uses method name as endpoint path
- `@webhook <path>` - Uses custom path
- `handle*` prefix - Auto-detected as webhook (uses method name)

### Scheduled Jobs

Methods can be scheduled to run periodically using cron expressions.

```typescript
/**
 * Archive old tasks daily at midnight
 * @scheduled 0 0 * * *
 */
async scheduledArchiveOldTasks(): Promise<{ archived: number }> {
  // Runs daily at 00:00
}

/**
 * Run cleanup every weekday at 2:30 AM
 * @cron 30 2 * * 1-5
 */
async weekdayCleanup(): Promise<void> {
  // Runs Mon-Fri at 02:30
}
```

**Cron Format:** Standard 5-field cron expression: `minute hour day-of-month month day-of-week`

| Field | Values | Special Characters |
|-------|--------|-------------------|
| Minute | 0-59 | `,` `-` |
| Hour | 0-23 | `,` `-` |
| Day of Month | 1-31 | `,` `-` |
| Month | 1-12 | `,` `-` |
| Day of Week | 0-6 (Sun=0) | `,` `-` |

**Common Patterns:**
- `0 0 * * *` - Daily at midnight
- `0 * * * *` - Every hour
- `0 0 * * 0` - Weekly on Sunday
- `0 9-17 * * 1-5` - Every hour during business hours (Mon-Fri)
- `0,30 * * * *` - Every 30 minutes

### Distributed Locks

Use `@locked` to ensure only one instance of a method runs at a time across all processes.

```typescript
/**
 * Update board with exclusive access
 * @locked
 */
async updateBoard(params: { board: string; data: any }) {
  // Lock name: "updateBoard"
}

/**
 * Batch process with custom lock name
 * @locked board:write
 */
async batchUpdate(params: { taskIds: string[] }) {
  // Lock name: "board:write"
}
```

**Lock Behavior:**
- `@locked` - Uses method name as lock name
- `@locked <name>` - Uses custom lock name
- Lock is held for the duration of method execution
- Other processes/requests wait for lock release

> **Single-node only:** The built-in lock uses the daemon's Unix socket and is scoped to a single machine/process group. For multi-node deployments, implement a custom lock backend (Redis Redlock, etcd leases, etc.) by overriding the lock manager via `applyMiddleware` in your custom middleware configuration.

**Now auto-enforced:** Since v1.9.0, `@locked` is automatically enforced by the runtime. You no longer need to manually call `this.withLock()` — just add the tag and the runtime wraps execution with the lock.

For programmatic locking with dynamic lock names, use `this.withLock()` (available on all `PhotonMCP` subclasses):

```typescript
async moveTask(params: { taskId: string; column: string }) {
  return this.withLock(`task:${params.taskId}`, async () => {
    const task = await this.loadTask(params.taskId);
    task.column = params.column;
    await this.saveTask(task);
    return task;
  });
}
```

Alternatively, `withLock` can be imported directly from `@portel/photon-core` for use outside class methods:

```typescript
import { withLock } from '@portel/photon-core';
```

## Custom Middleware (`@use` Tag)

The `@use` tag applies middleware to a method. All built-in functional tags (`@cached`, `@timeout`, etc.) are middleware — `@use` lets you apply custom middleware with the same API.

### Syntax

```typescript
/** @use middlewareName {@prop value} {@prop2 value2} */
```

### Sugar Equivalence

Every built-in shorthand has an equivalent `@use` form:

| Shorthand | `@use` equivalent |
|-----------|-------------------|
| `@fallback []` | `@use fallback {@value []}` |
| `@logged debug` | `@use logged {@level debug}` |
| `@circuitBreaker 5 30s` | `@use circuitBreaker {@threshold 5} {@resetAfter 30s}` |
| `@cached 5m` | `@use cached {@ttl 5m}` |
| `@timeout 30s` | `@use timeout {@ms 30s}` |
| `@retryable 3 1s` | `@use retryable {@count 3} {@delay 1s}` |
| `@throttled 10/min` | `@use throttled {@rate 10/min}` |
| `@debounced 500ms` | `@use debounced {@delay 500ms}` |
| `@queued 3` | `@use queued {@concurrency 3}` |
| `@locked board:write` | `@use locked {@name board:write}` |

### Defining Custom Middleware

Export a `middleware` array from your `.photon.ts` file:

```typescript
import { defineMiddleware } from '@portel/photon-core';

export const middleware = [
  defineMiddleware({
    name: 'audit',
    phase: 5,  // lower = runs first (outermost wrapper)
    create(config, state) {
      return async (ctx, next) => {
        const start = Date.now();
        const result = await next();
        console.log(`[${config.level}] ${ctx.tool} ${Date.now() - start}ms`);
        return result;
      };
    }
  })
];

export default class MyPhoton {
  /** @use audit {@level debug} */
  async charge(params: { amount: number }) {
    return { charged: params.amount };
  }
}
```

### Phase Ordering

Middleware runs in phase order (lower = outer wrapper, executes first):

| Phase | Middleware | Role |
|-------|-----------|------|
| 3 | `fallback` | Catch-all — return default on any error |
| 5 | `logged` | Observe execution timing and errors |
| 8 | `circuitBreaker` | Fast-reject after consecutive failures |
| 10 | `throttled` | Cheapest rejection |
| 20 | `debounced` | Collapse rapid calls |
| 30 | `cached` | Skip everything on cache hit |
| 40 | `validate` | Reject bad input |
| **45** | **custom (default)** | **Custom middleware default phase** |
| 50 | `queued` | Concurrency control |
| 60 | `locked` | Distributed lock |
| 70 | `timeout` | Race timer |
| 80 | `retryable` | Retry loop — innermost |

### MiddlewareDefinition API

```typescript
interface MiddlewareDefinition<C = Record<string, any>> {
  name: string;
  phase?: number;                         // default: 45
  parseShorthand?(value: string): C;      // for sugar tags
  parseConfig?(raw: Record<string, string>): C;  // for {@prop value} syntax
  create(config: C, state: MiddlewareState): MiddlewareHandler;
}
```

- **`name`** — unique identifier, used in `@use name`
- **`phase`** — determines execution order (lower = outer)
- **`parseShorthand`** — optional, parses sugar like `@cached 5m`
- **`parseConfig`** — optional, parses inline `{@prop value}` configs
- **`create`** — returns a handler function `(ctx, next) => Promise<any>`
- **`state`** — per-middleware persistent state (survives across calls)

## Inline Parameter Tags

These tags are placed within `@param` descriptions to add validation and UI hints.

| Tag | Description | Example |
|-----|-------------|---------|
| `{@min N}` | Minimum value for numeric parameters. | `@param age Age {@min 0}` |
| `{@max N}` | Maximum value for numeric parameters. | `@param score Score {@max 100}` |
| `{@format type}` | Data format for validation/input type. | `@param email Email {@format email}` |
| `{@pattern regex}` | Regex pattern the parameter must match. | `@param zip Zip code {@pattern ^[0-9]{5}$}` |
| `{@example value}` | Example value for the parameter. | `@param city City {@example London}` |
| `{@choice a,b,c}` | Allowed values (renders as dropdown). | `@param status Status {@choice pending,approved,rejected}` |
| `{@choice-from tool}` | Dynamic values from another tool (renders as dropdown). The tool is called at `tools/list` time and results populate the enum. Use `tool.field` to extract a specific field from object results. | `@param group Group {@choice-from groups.name}` |
| `{@field type}` | Explicit HTML input type for Auto UI. | `@param bio Bio {@field textarea}` |
| `{@label name}` | Custom display label for the parameter. | `@param firstName First Name {@label Your First Name}` |
| `{@default value}` | Default value for the parameter. | `@param limit Max results {@default 10}` |
| `{@placeholder text}` | Placeholder text for input fields. | `@param query Search term {@placeholder Enter search...}` |
| `{@hint text}` | Help text shown below/beside the field. | `@param apiKey API Key {@hint Found in your dashboard}` |
| `{@readOnly}` | Marks the parameter as read-only. | `@param id Record ID {@readOnly}` |
| `{@writeOnly}` | Marks the parameter as write-only. | `@param password Password {@writeOnly}` |
| `{@unique}` | Marks array items as unique (uniqueItems). | `@param tags Tags {@unique}` |
| `{@multipleOf N}` | Number must be a multiple of N. | `@param quantity Qty {@multipleOf 5}` |
| `{@deprecated message}` | Marks parameter as deprecated. | `@param oldField Old field {@deprecated Use newField instead}` |
| `{@accept pattern}` | File type filter for file picker. | `@param file Upload {@accept .ts,.js}` |

### Dynamic Enums with `{@choice-from}`

The `{@choice-from}` tag populates a dropdown dynamically from the return value of another method. The enum values are resolved server-side at `tools/list` time, so MCP clients and Beam both see the current options.

```typescript
export default class ProjectManager {
  /** List all projects */
  async projects() {
    return [
      { id: 'proj-1', name: 'Frontend' },
      { id: 'proj-2', name: 'Backend' },
    ];
  }

  /**
   * Assign a task to a project
   * @param project Project {@choice-from projects.name}
   */
  async assign({ project, task }: { project: string; task: string }) {
    return `Assigned "${task}" to ${project}`;
  }
}
```

The `projects.name` syntax calls the `projects` method and extracts the `name` field from each result. If the method returns a flat array of strings, use just the method name: `{@choice-from projects}`.

## Return Value Tags

The `{@label}` tag can be used within `@returns` to customize the button label in BEAM:

```typescript
/**
 * Send a greeting message
 * @returns The greeting {@label Say Hello}
 */
async greet(): Promise<string> { ... }
```

## Output Format Values

The `@format` tag on methods supports multiple format types:

### Structural Formats

| Value | Description |
|-------|-------------|
| `primitive` | Single value (string, number, boolean) |
| `table` | Array of objects as a table (sortable, paginated, with expandable row details) |
| `list` | Array as a styled list (iOS-inspired) |
| `grid` | Array as a visual grid |
| `tree` | Hierarchical/nested data |
| `card` | Single object as a card |
| `none` | No special formatting |
| `steps` / `stepper` | Step-by-step progress indicator with status per step |
| `kanban` | Kanban board with columns and cards |
| `comparison` | Side-by-side feature/property comparison table |

**`steps` data shape:**
```json
[{ "label": "Install", "status": "complete", "detail": "optional note" },
 { "label": "Configure", "status": "current" },
 { "label": "Deploy", "status": "pending" }]
```
`status` values: `"complete"`, `"current"`, `"pending"`

**`kanban` data shape:**
```json
{ "columns": [{ "title": "Todo", "items": [{ "title": "Fix bug", "assignee": "alice", "priority": "high" }] }] }
```

**`comparison` data shape:**
```json
{ "items": [{ "name": "Plan A", "price": "$9", "storage": "10GB" }, { "name": "Plan B", "price": "$29", "storage": "100GB" }], "highlight": "Plan B" }
```

### Content Formats

| Value | Description |
|-------|-------------|
| `json` | JSON syntax highlighting |
| `markdown` | Markdown rendering |
| `yaml` | YAML syntax highlighting |
| `xml` | XML syntax highlighting |
| `html` | HTML rendering |
| `mermaid` | Mermaid diagram rendering |
| `diff` | Unified diff or before/after comparison |
| `log` | Structured log viewer with level-based coloring |
| `embed` | Embed an external URL in an iframe |
| `a2ui` | [A2UI v0.9](https://a2ui.org) declarative UI — emits a JSONL message stream over AG-UI as `CUSTOM` events named `a2ui.message`. Auto-maps arrays, objects, card-shaped results; escape hatch via `{ __a2ui: true, components, data }`. See [formats guide](../formats.md#declarative-ui-a2ui-v09) for details. |

**`diff` data shape:** Unified diff string, or `{ before, after, filename? }`

**`log` data shape:**
```json
[{ "level": "info", "message": "Server started", "timestamp": "2026-03-20T09:00:00Z", "source": "api" }]
```
`level` values: `"info"`, `"warn"`, `"error"`

**`embed` data shape:** URL string, or `{ url, title? }`

### Visualization Formats

| Value | Description |
|-------|-------------|
| `chart` | Auto-detect chart type from data shape |
| `chart:bar` | Bar chart |
| `chart:hbar` | Horizontal bar chart (same data shape as `chart:bar`) |
| `chart:line` | Line chart |
| `chart:pie` | Pie chart |
| `chart:area` | Area chart (line with fill) |
| `chart:scatter` | Scatter plot (auto-detected when data has 2+ numeric fields and no string fields) |
| `chart:donut` | Donut chart |
| `chart:radar` | Radar/spider chart (auto-detected for single items with 5+ numeric fields, or few items with many dimensions) |
| `chart:histogram` | Histogram — bins numeric values into a bar chart (explicit only, no auto-detection) |
| `metric` | KPI display (big number + label + delta) |
| `gauge` | Semicircular gauge/progress indicator |
| `ring` | Full-circle progress ring (SVG) with center value text |
| `progress` | Animated progress bar with percentage |
| `badge` | Colored status badge (auto-detects variant from text) |
| `timeline` | Vertical timeline of events |
| `qr` | QR code from URL/text |
| `slides` | Marp-style slide presentation |
| `dashboard` | Composite grid of auto-detected panels |
| `cart` | Shopping cart with item rows + totals |
| `stat-group` | Row of KPI stat cards |
| `heatmap` | Color-intensity grid (activity heatmap) |
| `calendar` | Monthly/weekly calendar view with events |
| `map` | Interactive map with markers |
| `network` / `graph` | Node-edge graph diagram |
| `cron` | Human-readable cron expression display |

**`ring` data shape:** A number (0-100), `{ value, max?, label? }`, or `{ progress }` (0-1 normalized). Color gradient: green → yellow → red based on value/max ratio.

**`chart:histogram` data shape:** Array of objects with at least one numeric field. The runtime bins the values using `sqrt(n)` buckets and renders as a bar chart. Use `{@x fieldName}` hint to specify which field to bin.

**`chart:scatter` data shape:** Array of objects with 2+ numeric fields. First two numeric fields map to x/y axes. Use `{@x fieldName, @y fieldName}` hints to specify axes explicitly.

**`stat-group` data shape:**
```json
[{ "label": "Revenue", "value": "$14,283", "delta": "+12%", "trend": "up", "prefix": "$", "suffix": "" }]
```
`trend` values: `"up"`, `"down"`, `"flat"`

**`heatmap` data shape:** `{ rows, cols, values }` grid, or flat array `[{ rowKey, colKey, value }]`

**`calendar` data shape:**
```json
[{ "title": "Sprint Review", "start": "2026-03-20", "end": "2026-03-20", "allDay": true, "color": "#6366f1" }]
```

**`map` data shape:**
```json
[{ "lat": 37.7749, "lng": -122.4194, "label": "SF Office", "popup": "HQ" }]
```

**`network` / `graph` data shape:**
```json
{ "nodes": [{ "id": "1", "label": "Alice", "group": "admin" }], "edges": [{ "from": "1", "to": "2", "label": "manages" }] }
```

**`cron` data shape:** Cron expression string `"0 9 * * 1-5"`, or `{ expression, description? }`

### Container Formats (Composable)

Container formats wrap inner content renderers. Data must be an **object** — keys become section titles/tab labels/panel headers, and each value is rendered using the `@inner` layout type (or auto-detected if omitted).

| Value | Description |
|-------|-------------|
| `panels` | CSS grid of titled panels |
| `tabs` | Tab bar switching between items |
| `accordion` | Collapsible sections |
| `stack` | Vertical stack with spacing |
| `columns` | Side-by-side columns (2-4) |

### Code Formats

| Value | Description |
|-------|-------------|
| `code` | Syntax-highlighted code block (auto-detects keywords, strings, numbers, comments) |
| `code:javascript` | JavaScript syntax highlighting |
| `code:typescript` | TypeScript syntax highlighting |
| `code:python` | Python syntax highlighting |
| `code:lang` | Any language (replace `lang`) |

Colors use `--syntax-*` CSS variables from the theme, adapting to light/dark and OKLCH presets.

### Design / Layout Formats

| Value | Description |
|-------|-------------|
| `image` | Single image, or array of images with optional captions |
| `carousel` | Horizontally scrolling image carousel |
| `gallery` | Thumbnail grid with lightbox expand |
| `masonry` | Pinterest-style masonry image grid |
| `hero` | Full-width hero section with title, subtitle, and CTA |
| `banner` | Dismissable notification banner |
| `quote` | Styled pull-quote with optional attribution |
| `profile` | User/entity profile card with avatar, role, bio, and stats |
| `feature-grid` | Marketing feature grid with icons and descriptions |
| `invoice` / `receipt` | Itemized invoice or receipt with totals |

**`image` data shape:** URL string, `{ src, caption? }`, or `[{ src, caption? }]`

**`carousel` / `gallery` / `masonry` data shape:** `[{ src, caption? }]`
(`gallery` items also accept `full` for the lightbox URL)

**`hero` data shape:**
```json
{ "title": "Ship faster", "subtitle": "One platform for everything", "image": "/hero.png", "cta": "Get started", "url": "/signup" }
```

**`banner` data shape:**
```json
{ "message": "Scheduled maintenance on Sunday", "type": "warning", "icon": "⚠️" }
```
`type` values: `"info"`, `"success"`, `"error"`, `"warning"`

**`quote` data shape:**
```json
{ "text": "Build things people want.", "author": "PG", "source": "YC", "avatar": "/pg.jpg" }
```

**`profile` data shape:**
```json
{ "name": "Alice Chen", "avatar": "/alice.png", "role": "Engineer", "bio": "Works on runtime.", "stats": { "commits": 342, "reviews": 89 } }
```

**`feature-grid` data shape:**
```json
[{ "icon": "⚡", "title": "Fast", "description": "Sub-millisecond routing" }]
```

**`invoice` / `receipt` data shape:**
```json
{
  "number": "INV-001", "date": "2026-03-20",
  "from": "Acme Corp", "to": "Customer Ltd",
  "items": [{ "description": "Photon Pro", "quantity": 1, "rate": 99, "amount": 99 }],
  "subtotal": 99, "tax": 9.9, "total": 108.9, "notes": "Due in 30 days"
}
```

```typescript
/**
 * Example usage snippet
 * @format code
 */
example() {
  return `const data = await monitor.cpu();
console.log(data.value);

// Subscribe to events
monitor.on('alert', (data) => {
  notify(data.message);
});`;
}
```

### Advanced List/Grid Formatting

For `list`, `table`, and `grid` formats, you can specify layout hints using nested syntax:

```typescript
/**
 * Get all users
 * @format list {@title name, @subtitle email, @icon avatar, @badge status, @style inset}
 */
async getUsers(): Promise<User[]>
```

Available layout hints:

| Hint | Description |
|------|-------------|
| `@title fieldName` | Primary display field |
| `@subtitle fieldName` | Secondary text field |
| `@icon fieldName` | Leading visual field (avatar, image) |
| `@badge fieldName` | Status badge field |
| `@detail fieldName` | Trailing detail value |
| `@style styleName` | List style: `plain`, `grouped`, `inset`, `inset-grouped` |
| `@columns N` | Number of columns (for grid) |

Field names can include renderers with `:suffix`:
- `email:link` - Render as mailto link
- `createdAt:date` - Format as date
- `price:currency` - Format as currency

### Chart Layout Hints

For `chart` formats, you can map data fields to chart axes:

```typescript
/**
 * Revenue by region
 * @format chart:bar {@label region, @value revenue}
 */
async revenueByRegion(): Promise<{ region: string; revenue: number }[]>

/**
 * Daily signups over time
 * @format chart:line {@x date, @y signups}
 */
async signupTrend(): Promise<{ date: string; signups: number }[]>

/**
 * Category breakdown
 * @format chart:pie {@label category, @value amount}
 */
async breakdown(): Promise<{ category: string; amount: number }[]>
```

| Hint | Description |
|------|-------------|
| `@label fieldName` | Chart labels (pie segments, x-axis categories) |
| `@value fieldName` | Chart values (y-axis, pie sizes) |
| `@x fieldName` | X-axis field |
| `@y fieldName` | Y-axis field |
| `@series fieldName` | Field to group into multiple series |

### Gauge Layout Hints

```typescript
/**
 * CPU usage
 * @format gauge {@min 0, @max 100, @title CPU}
 */
async cpuUsage(): Promise<{ value: number; max: number; label: string }>
```

| Hint | Description |
|------|-------------|
| `@min N` | Minimum gauge value (default: 0) |
| `@max N` | Maximum gauge value (default: 100) |

### Ring Layout Hints

```typescript
/**
 * Upload progress
 * @format ring {@max 100, @title Upload}
 */
async uploadProgress(): Promise<{ value: number; label: string }>
```

| Hint | Description |
|------|-------------|
| `@max N` | Maximum ring value (default: 100) |
| `@title label` | Label displayed below the ring |

### Table Column Format Pipes

Apply per-column formatting to table cells using the `@columnFormats` hint:

```typescript
/**
 * Sales report
 * @format table {@columnFormats revenue:currency,margin:percent,name:truncate(25),count:compact}
 */
async salesReport(): Promise<{ name: string; revenue: number; margin: number; count: number }[]>
```

**Syntax:** `@columnFormats field1:pipe,field2:pipe(arg)` — comma-separated `fieldName:pipeName` pairs.

| Pipe | Description | Example |
|------|-------------|---------|
| `currency` | Locale currency format (default USD). Pass currency code as arg: `currency(EUR)` | `$1,234.00` |
| `percent` | Percentage (values ≤1 are multiplied by 100). Arg = decimal places | `75.0%` |
| `date` | Locale date format | `3/20/2026` |
| `truncate(N)` | Truncate to N characters with ellipsis | `Long text…` |
| `number` | Locale number with grouping | `1,234,567` |
| `compact` | Compact notation (K/M/B) | `1.2M` |

**Note:** Table rows are expandable — clicking any row reveals a detail panel showing all fields as key-value pairs. This is automatic and requires no configuration.

### Timeline Layout Hints

```typescript
/**
 * Recent activity log
 * @format timeline {@date createdAt, @title event, @description details}
 */
async activityLog(): Promise<{ createdAt: string; event: string; details: string }[]>
```

| Hint | Description |
|------|-------------|
| `@date fieldName` | Date field for ordering and display |
| `@title fieldName` | Event title field |
| `@description fieldName` | Event description field |

### Cart Layout

The `cart` format displays e-commerce cart data with item rows and a summary section.

```typescript
/**
 * Get shopping cart
 * @format cart
 */
async cart(): Promise<{
  items: { name: string; price: number; quantity: number; image?: string }[];
  subtotal: number;
  tax: number;
  total: number;
}>
```

**Supported data shapes:**
- Object with `items` array + numeric summary fields (`subtotal`, `tax`, `discount`, `shipping`, `total`)
- Flat array where all items have `price` + (`quantity` or `qty`) fields

**Auto-detection:** Data with `price` + `quantity`/`qty` fields is automatically detected as a cart without needing `@format cart`.

### Checklist

```typescript
/**
 * @format checklist
 */
async list(): Promise<{ text: string; done: boolean }[]>
```

Interactive checkbox list. Done items sink below a "Completed" separator. Supports drag-and-drop reorder, progress bar, and hide-done toggle. Clicking a checkbox calls `check(text, done)` on the photon.

**Auto-detection:** Arrays where every item has a text-like field (`text`, `title`, `name`, `task`, `label`) AND a boolean done field (`done`, `completed`, `checked`) are automatically detected as checklist.

### Article

```typescript
/**
 * @format article
 */
async story(): Promise<{ text: string; images?: { url: string; position?: 'left' | 'right'; caption?: string }[] }>
```

Magazine-style text layout. With images: text flows around positioned images. Without images: automatic two-column layout with column-rule divider and drop cap.

### Container Layout Hints

Containers accept the `@inner` hint to specify how each value is rendered:

```typescript
/**
 * User dashboard with panels
 * @format panels {@inner card, @columns 3}
 */
async overview(): Promise<{ users: User[]; orders: Order[]; stats: Stats }>

/**
 * Settings organized in tabs
 * @format tabs {@inner kv, @style pills}
 */
async settings(): Promise<{ general: object; advanced: object; security: object }>

/**
 * FAQ sections
 * @format accordion {@inner list, @style bordered}
 */
async faq(): Promise<{ billing: string[]; shipping: string[]; returns: string[] }>

/**
 * KPI metrics stacked vertically
 * @format stack {@inner metric}
 */
async kpis(): Promise<{ revenue: object; users: object; conversion: object }>

/**
 * Side-by-side comparison
 * @format columns {@inner chart:pie, @columns 2}
 */
async compare(): Promise<{ planA: object; planB: object }>
```

| Hint | Description |
|------|-------------|
| `@inner layoutType` | Render each value using this layout (e.g., `card`, `list`, `kv`, `metric`, `chart:pie`) |
| `@columns N` | Number of columns for `panels` and `columns` (2-4) |
| `@style pills` | Pill-style tabs (for `tabs`) |
| `@style bordered` | Bordered sections (for `accordion`) |

If `@inner` is omitted, each value auto-detects its own layout (like `dashboard` does).

### Auto-Detection

When no `@format` is specified, the auto-UI detects visualization types from data shape:

| Data Shape | Detected Layout |
|------------|----------------|
| Array where all items have `price` + `quantity`/`qty` | `cart` |
| Object with `items` array where items have `price` + `quantity`/`qty` | `cart` |
| Array with 1 string + 1 numeric field | `chart` (pie/bar) |
| Array with date + numeric fields | `chart` (line) |
| Array with date + title/description fields (3+ items) | `timeline` |
| Object with 1 numeric + few string fields | `metric` |
| Object with `value` + `max`/`min` or `progress` | `gauge` |
| Object with 3+ keys mixing arrays, objects, numbers | `dashboard` |

## Input Format Values

The `{@format}` inline tag on parameters controls validation and the input widget rendered in the Beam auto-form.

### Validation-Only Formats

These add format validation but render as a standard text input:

| Value | Description | Allowed Characters |
|-------|-------------|-------------------|
| `uuid` | UUID validation | Hex digits and hyphens (0-9a-f, -) |
| `ipv4` | IPv4 address | Digits and dots |
| `ipv6` | IPv6 address | Hex digits and colons |
| `slug` | URL slug | Lowercase letters, digits, hyphens |
| `hex` | Hexadecimal color/code | Hex digits and # prefix |
| `textarea` / `multiline` | Multi-line text area | Any characters |

**Custom Patterns:** Use `{@pattern regex}` for custom validation:
```typescript
@param code Product code {@pattern ^[A-Z]{3}\d{3}$}
```

### Input Widget Formats

These control how the field renders in the Beam auto-form UI. Many are **auto-detected** from the parameter name — explicit `{@format}` overrides auto-detection.

#### Enhanced Basic Inputs

Auto-detected from the param name OR set explicitly with `{@format}`.

| Value | Widget | Auto-detected param names |
|-------|--------|--------------------------|
| `password` / `secret` | Masked text input with show/hide eye toggle | `password`, `secret`, `token`, `apikey` |
| `email` | `type="email"` with placeholder | `email` |
| `url` | `type="url"` with live "open link" button | `url`, `website`, `homepage` |
| `phone` / `tel` | `type="tel"` with phone placeholder | `phone`, `tel`, `mobile` |
| `color` / `colour` | Color swatch picker + hex text input side by side | `color`, `colour` |
| `search` | `type="search"` | `search`, `query`, `q` |

#### Rich Input Components

These require explicit `{@format}` (no auto-detection from param name, except where noted).

| Value | Widget | Notes |
|-------|--------|-------|
| `tags` | Chip/pill input — Enter or comma to add, Backspace to remove last, deduplicates | Also auto-detected for `string[]` array params |
| `rating` | 1–5 star rating with hover preview, numeric fallback | Use `{@multipleOf 0.5}` for half-stars. Auto-detected: `rating`, `stars` |
| `segmented` | Horizontal pill bar for enum params (2–4 values) | Use with `{@choice}` or `enum` type |
| `radio` | Vertical radio buttons for enum params | Use with `{@choice}` or `enum` type |
| `code` | Code editor with line numbers, tab-to-indent (2 spaces), char/line count | Use `code:typescript`, `code:python`, `code:css`, etc. for language label |
| `markdown` | Split-pane markdown editor with toolbar (Bold, Italic, Code, Link, Heading, List, Quote) and Write/Split/Preview modes | Built-in renderer, word count |

#### Date & Time Pickers

Custom calendar component replacing the native browser date input. Supports typed input (`"2026-03-20"`, `"Mar 20 2026"`, `"03/20/2026"`), Today and Clear buttons, and a 3-layer drill-down: click month name → month grid, click year → year grid with decade paging.

**Smart positioning:** params named `birthday`/`dob` open the year view ~25 years in the past; params named `expiry`/`expires` start 2 years in the future.

| Value | Widget |
|-------|--------|
| `date` | Calendar date picker |
| `date-time` | Calendar + hour:minute inputs |
| `time` | Time text input |
| `date-range` | Two date pickers side by side |
| `datetime-range` | Two date-time pickers side by side |

#### Example — all input widgets in one method

```typescript
/**
 * Register a new user
 * @param name Full name
 * @param email Email address {@format email}
 * @param password Account password {@format password}
 * @param birthday Date of birth {@format date}
 * @param phone Phone number {@format phone}
 * @param website Personal website {@format url}
 * @param color Preferred color {@format color}
 * @param tags Interest tags {@format tags}
 * @param rating Experience level (1-5) {@format rating}
 * @param role User role {@choice admin,user,guest} {@format segmented}
 * @param bio About yourself {@format markdown}
 * @param code Custom CSS {@format code:css}
 */
async register(params: {
  name: string;
  email: string;
  password: string;
  birthday: string;
  phone: string;
  website: string;
  color: string;
  tags: string[];
  rating: number;
  role: string;
  bio: string;
  code: string;
}): Promise<User> { ... }
```

## Field Types

The `{@field}` inline tag explicitly sets the HTML input type:

| Value | Description |
|-------|-------------|
| `text` | Single-line text input (default) |
| `textarea` | Multi-line text area |
| `number` | Number input with spinner |
| `password` | Password input (masked) |
| `checkbox` | Boolean checkbox |
| `select` | Dropdown (use with `{@choice}`) |
| `hidden` | Hidden field |

## Complete Example

```typescript
/**
 * User Management Photon
 *
 * Provides tools for managing users in the system.
 *
 * @version 1.0.0
 * @author Jane Doe
 * @license MIT
 * @runtime ^1.5.0
 * @dependencies uuid@^9.0.0
 * @mcp database postgres-mcp
 */
export default class UserManager {
  /**
   * List all users
   * @format list {@title name, @subtitle email, @icon avatar, @badge role}
   * @returns List of users {@label Fetch Users}
   * @icon 👥
   */
  async listUsers(): Promise<User[]> { ... }

  /**
   * Create a new user
   * @param name Full name {@label Your Name} {@min 2} {@max 100}
   * @param email Email address {@format email} {@example john@example.com}
   * @param role User role {@choice admin,user,guest}
   * @returns The created user
   * @icon ➕
   */
  async createUser(params: {
    name: string;
    email: string;
    role: string;
  }): Promise<User> { ... }

  /**
   * Get current status
   * @autorun
   * @format json
   * @icon 📊
   */
  async status(): Promise<SystemStatus> { ... }
}
```

## MCP Configuration Schema

When connecting via MCP (Streamable HTTP transport), Photon exposes configuration requirements in the `initialize` response. This allows MCP clients like Claude Desktop to prompt users for missing configuration values.

### How It Works

1. **Constructor parameters** define what configuration a photon needs
2. **Environment variables** are auto-generated: `PHOTON_<NAME>_<PARAM>`
3. **configurationSchema** is returned in MCP `initialize` response
4. **beam/configure** tool allows setting values at runtime

### Constructor Parameter Mapping

```typescript
export default class MyPhoton {
  constructor(
    private apiKey: string,           // Required, sensitive
    private dataPath?: string,        // Optional path
    private region: string = 'us-east-1'  // Has default
  ) {}
}
```

This generates the following configuration schema:

```json
{
  "MyPhoton": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "format": "password",
        "writeOnly": true,
        "x-env-var": "PHOTON_MYPHOTON_APIKEY"
      },
      "dataPath": {
        "type": "string",
        "format": "path",
        "x-env-var": "PHOTON_MYPHOTON_DATAPATH"
      },
      "region": {
        "type": "string",
        "default": "us-east-1",
        "x-env-var": "PHOTON_MYPHOTON_REGION"
      }
    },
    "required": ["apiKey"]
  }
}
```

### JSON Schema Format Values

Photon uses OpenAPI-compliant `format` values for special field types:

| Parameter Name Pattern | Format | Behavior |
|------------------------|--------|----------|
| `*key`, `*secret`, `*token`, `*password`, `*credential` | `password` | Masked input, `writeOnly: true` |
| `*path`, `*file`, `*dir`, `*directory`, `*folder` | `path` | File/folder picker in UI |
| TypeScript union types | `enum` | Dropdown selector |

### Configuration Tools

#### beam/configure

Sets configuration values for unconfigured photons:

```typescript
// MCP tools/call
{
  "name": "beam/configure",
  "arguments": {
    "photon": "my-photon",
    "config": {
      "apiKey": "sk-xxx",
      "dataPath": "/data"
    }
  }
}
```

#### beam/browse

Browse the filesystem for path selection:

```typescript
// MCP tools/call
{
  "name": "beam/browse",
  "arguments": {
    "path": "/home/user",    // Optional, defaults to cwd
    "showHidden": false      // Optional
  }
}
// Returns: { path: "/home/user", items: [...] }
```

### Environment Variables

Configuration can also be set via environment variables:

```bash
export PHOTON_MYPHOTON_APIKEY="sk-xxx"
export PHOTON_MYPHOTON_DATAPATH="/data"
photon beam
```

The naming convention is: `PHOTON_<PHOTONNAME>_<PARAMNAME>` (uppercase, no hyphens).

## Scoped Memory (`this.memory`)

Every photon that extends `PhotonMCP` gets a built-in `this.memory` provider — zero-config persistent key-value storage that eliminates manual file I/O.

### Three Scopes

| Scope | Storage | Use Case |
|-------|---------|----------|
| `photon` (default) | `~/.photon/.data/{photonId}/memory/` | Private state for this photon |
| `session` | `~/.photon/.data/_sessions/{sessionId}/{photonId}/` | Per-user session data |
| `global` | `~/.photon/.data/_global/` | Shared across all photons |

### Example: Bookmark Manager

```typescript
/**
 * Bookmark Manager
 * @tags bookmarks, productivity
 */
export default class Bookmarks extends PhotonMCP {
  /**
   * Save a bookmark
   * @param url The URL to bookmark
   * @param title Display title
   * @param tags Comma-separated tags
   */
  async save({ url, title, tags }: { url: string; title: string; tags?: string }) {
    const bookmarks = await this.memory.get<Bookmark[]>('bookmarks') ?? [];

    bookmarks.push({
      id: crypto.randomUUID(),
      url,
      title,
      tags: tags?.split(',').map(t => t.trim()) ?? [],
      savedAt: new Date().toISOString(),
    });

    await this.memory.set('bookmarks', bookmarks);
    return { saved: true, total: bookmarks.length };
  }

  /**
   * List all bookmarks, optionally filtered by tag
   * @param tag Filter by tag
   * @format list {@title title, @subtitle url, @badge tags}
   */
  async list({ tag }: { tag?: string } = {}) {
    const bookmarks = await this.memory.get<Bookmark[]>('bookmarks') ?? [];
    if (tag) return bookmarks.filter(b => b.tags.includes(tag));
    return bookmarks;
  }

  /**
   * Track total bookmarks saved — shared counter across all photons
   * @autorun
   */
  async stats() {
    // Update a global counter that any photon can read
    const count = (await this.memory.get<Bookmark[]>('bookmarks'))?.length ?? 0;
    await this.memory.set('bookmark-count', count, 'global');
    return { bookmarks: count };
  }
}

interface Bookmark {
  id: string;
  url: string;
  title: string;
  tags: string[];
  savedAt: string;
}
```

### API Reference

| Method | Description |
|--------|-------------|
| `get<T>(key, scope?)` | Retrieve a value (returns `null` if not found) |
| `set(key, value, scope?)` | Store a JSON-serializable value |
| `delete(key, scope?)` | Remove a key |
| `has(key, scope?)` | Check if key exists |
| `keys(scope?)` | List all keys in scope |
| `clear(scope?)` | Remove all keys in scope |
| `getAll(scope?)` | Get all key-value pairs |
| `update(key, fn, scope?)` | Atomic read-modify-write |

The `scope` parameter defaults to `'photon'` for all methods.

## Photon Dependencies (`@photon`)

The `@photon` tag declares a dependency on another photon. This ensures the dependency is **auto-installed** when the current photon is installed and **auto-loaded** when the runtime starts.

There are two ways to use a declared photon dependency:

### Approach 1: Constructor Injection (Direct Instance)

The dependency is instantiated and injected into the constructor as a live object. You call methods directly on it.

```typescript
/**
 * Order Processor
 * @photon billing billing-photon
 * @photon shipping shipping-photon
 */
export default class OrderProcessor extends PhotonMCP {
  constructor(
    private billing: any,   // Injected: live billing photon instance
    private shipping: any   // Injected: live shipping photon instance
  ) { super(); }

  async process({ orderId }: { orderId: string }) {
    const invoice = await this.billing.generate({ orderId });
    const label = await this.shipping.createLabel({ orderId });
    return { invoice, label };
  }
}
```

### Approach 2: `this.call()` (Daemon-Routed)

Declare the dependency with `@photon` (so it's auto-installed and loaded), but use `this.call()` to invoke methods through the daemon. No constructor parameter needed.

```typescript
/**
 * Order Processor
 * @photon billing billing-photon
 * @photon shipping shipping-photon
 */
export default class OrderProcessor extends PhotonMCP {
  async process({ orderId }: { orderId: string }) {
    const invoice = await this.call('billing.generate', { orderId });
    const label = await this.call('shipping.createLabel', { orderId });
    return { invoice, label };
  }
}
```

### When to Use Which

| | Constructor Injection | `this.call()` |
|---|---|---|
| **Setup** | Declare `@photon` + constructor param | Declare `@photon` only |
| **Execution** | In-process, direct method call | Via daemon, cross-process |
| **Speed** | Faster (no IPC overhead) | Slight overhead (daemon routing) |
| **Isolation** | Shares process with parent | Runs in its own daemon session |
| **Use case** | Tightly coupled helpers | Loosely coupled services |

Both approaches benefit from `@photon` ensuring the dependency is installed and available. The `@photon` tag is what triggers auto-installation — without it, `this.call()` would fail if the target photon isn't loaded.

### Instance Selection

For `@stateful` photon dependencies, you can target a specific named instance using three mechanisms:

#### 1. Declarative (Colon Syntax in `@photon` Tag)

Append `:instanceName` to the photon source to pin the dependency to a specific instance at declaration time:

```typescript
/**
 * Home Dashboard
 * @photon homeTodos todo:home
 * @photon workTodos todo:work
 */
export default class Dashboard {
  constructor(
    private homeTodos: any,  // Injected: "home" instance of todo photon
    private workTodos: any   // Injected: "work" instance of todo photon
  ) {}

  async overview() {
    const home = await this.homeTodos.list();
    const work = await this.workTodos.list();
    return { home, work };
  }
}
```

Both `homeTodos` and `workTodos` reference the same `todo` photon but receive different instances, each with their own persisted state.

#### 2. Runtime API (`this.photon.use()`)

Dynamically load and switch to a specific photon instance at runtime:

```typescript
async switchWorkspace({ workspace }: { workspace: string }) {
  const todo = await this.photon.use('todo', workspace);
  return todo.list();
}
```

`this.photon.use(name, instance?)` returns a live in-process proxy to the requested instance. If no instance name is given, the default instance is returned. Supports namespace-qualified names: `this.photon.use('portel:todo', 'home')`.

#### 3. Daemon-Routed (`this.call()` with Instance Option)

Pass `instance` as a third-argument option for one-shot cross-process calls:

```typescript
async getHomeTasks() {
  return this.call('todo.list', {}, { instance: 'home' });
}
```

#### Comparison

| | Declarative | `this.photon.use()` | `this.call()` with instance |
|---|---|---|---|
| **Binding** | Compile-time (fixed in tag) | Runtime (dynamic) | Runtime (dynamic) |
| **Returns** | Live instance (constructor) | Live instance (proxy) | Method result only |
| **Execution** | In-process | In-process | Cross-process (daemon) |
| **Use case** | Known instances at design time | Dynamic instance switching | One-shot calls to specific instances |
| **Multiple calls** | Natural (`this.dep.methodA()`, `this.dep.methodB()`) | Natural (returned proxy) | One call per invocation |

**Do NOT consolidate `this.call()` and `this.photon.use()`** — they serve fundamentally different purposes. `this.photon.use()` returns a live object for direct interaction (multiple method calls, property access). `this.call()` is a one-shot RPC through the daemon. The instance option on `this.call()` is convenience for cases where you need a single cross-process call to a named instance without loading it in-process.

## Functional Tags (Runtime-Enforced)

These method-level tags are **automatically enforced by the runtime** — no manual code needed. They compose as middleware in the execution pipeline.

| Tag | Description | Example |
|-----|-------------|---------|
| `@fallback` | Return default value on error. | `@fallback []` |
| `@logged` | Auto-log execution with timing. | `@logged` or `@logged debug` |
| `@circuitBreaker` | Fast-reject after consecutive failures. | `@circuitBreaker 5 30s` |
| `@cached` | Memoize results with TTL. | `@cached 5m` |
| `@timeout` | Execution time limit. | `@timeout 30s` |
| `@retryable` | Auto-retry on failure. | `@retryable 3 1s` |
| `@throttled` | Rate limit per method. | `@throttled 10/min` |
| `@debounced` | Collapse rapid calls. | `@debounced 500ms` |
| `@queued` | Sequential execution queue. | `@queued 1` |
| `@validate` | Runtime input validation. | `@validate params.email must be a valid email` |
| `@deprecated` | Mark tool as deprecated. | `@deprecated Use addV2 instead` |

### Duration Format

Tags that accept durations support these units: `ms`, `s`/`sec`, `m`/`min`, `h`/`hr`, `d`/`day`. Examples: `30s`, `5m`, `1h`, `500ms`.

Rate expressions use `count/unit`: `10/min`, `100/h`, `5/s`.

### `@fallback` — Graceful Degradation

Return a default value instead of throwing when the method fails. Wraps the entire pipeline — catches errors from timeouts, rate limits, retries exhausted, or the method itself.

```typescript
/** @fallback [] */
async loadHistory(params: { path: string }) {
  return JSON.parse(await fs.readFile(params.path, 'utf-8'));
}

/** @fallback null */
async findUser(params: { id: string }) {
  return await this.db.findOne({ id: params.id });
}

/** @fallback 0 */
async getCount(params: { collection: string }) {
  return await this.db.count(params.collection);
}
```

**Supported values:** Any JSON-parseable value — `[]`, `{}`, `null`, `0`, `false`, `"default"`. Non-JSON strings are returned as-is.

**Pipeline position:** Phase 3 — outermost wrapper. If `@retryable` exhausts all attempts, `@fallback` catches the final error. If `@throttled` rejects, `@fallback` returns the default instead of throwing a rate limit error.

**When to use:**
- Reading config/state files that may not exist yet
- Querying external services where partial failure is acceptable
- Methods where callers expect data, not errors

### `@logged` — Observability

Auto-log method execution with timing, without manual instrumentation. Logs to `stderr` so it doesn't interfere with MCP output.

```typescript
/** @logged */
async charge(params: { amount: number }) {
  return await this.stripe.charge(params.amount);
}
// stderr: [info] billing.charge 142ms

/** @logged debug */
async syncData(params: { source: string }) {
  return await this.sync(params.source);
}
// stderr: [debug] data-sync.syncData 3402ms

/** On failure: */
// stderr: [info] billing.charge FAILED 52ms — card declined
```

**Default level:** `info` (if no level specified)

**Inline config:** `@logged {@level debug} {@tags api,billing}` — adds tags to log output: `[debug] billing.charge [api,billing] 142ms`

**Pipeline position:** Phase 5 — after `@fallback` (so failures are logged even when fallback catches them), before `@throttled` (so rate-limited calls aren't logged as attempts).

### `@circuitBreaker` — Fail Fast on Repeated Failures

Stop calling a method that keeps failing. After N consecutive failures, the circuit "opens" and immediately rejects subsequent calls without executing the method. After a reset period, one probe call is allowed through — if it succeeds, the circuit closes and normal execution resumes.

```typescript
/** @circuitBreaker 5 30s */
async fetchPrices(params: { symbol: string }) {
  return await fetch(`https://api.prices.com/${params.symbol}`).then(r => r.json());
}
```

The shorthand format is `@circuitBreaker <threshold> <resetAfter>`:
- `@circuitBreaker 5 30s` — open after 5 failures, probe after 30 seconds
- `@circuitBreaker 3 1m` — open after 3 failures, probe after 1 minute

**States:**
- **Closed** (normal) — all calls pass through. Failures increment the counter. Counter resets on success.
- **Open** — calls are immediately rejected with `PhotonCircuitOpenError`. No execution happens.
- **Half-open** — after the reset period, one probe call is allowed. Success → closed. Failure → open again.

**Inline config:** `@circuitBreaker {@threshold 5} {@resetAfter 30s}`

**Pipeline position:** Phase 8 — after `@logged` (so circuit rejections are observable), before `@throttled` (so rate limiting doesn't count as circuit failures).

### `@cached` — Memoize Results

Cache return values. Subsequent calls with identical parameters within TTL return the cached result without re-executing.

```typescript
/** @cached 5m */
async getExchangeRates() {
  return await fetch('https://api.exchange.com/rates').then(r => r.json());
}

/** @cached 1h */
async getUser(params: { id: string }) {
  return await this.db.findUser(params.id);
}
```

- **Default TTL:** 5 minutes (if no duration specified)
- **Cache key:** `photon:instance:method:sha256(params)`
- **Storage:** In-memory per process (shared across sessions in daemon mode)

### `@timeout` — Execution Time Limit

Reject with `TimeoutError` if the method doesn't resolve within the specified duration.

```typescript
/** @timeout 30s */
async fetchRemoteData(params: { url: string }) {
  return await fetch(params.url).then(r => r.json());
}
```

- Prevents hung tool calls from blocking MCP clients
- Pairs well with `@retryable` — timeout applies per attempt

### `@retryable` — Auto-Retry on Failure

Retry the method on error with configurable count and delay.

```typescript
/** @retryable 3 1s */
async callExternalAPI(params: { query: string }) {
  return await this.api.search(params.query);
}

/** @retryable 5 2s */
async sendWebhook(params: { url: string; payload: any }) {
  const res = await fetch(params.url, { method: 'POST', body: JSON.stringify(params.payload) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { status: res.status };
}
```

- **Default:** 3 retries, 1 second delay
- Only retries on thrown errors, not on successful returns
- Delay is fixed (not exponential) between attempts

### `@throttled` — Rate Limiting

Allow at most N calls per time window. Excess calls are rejected.

```typescript
/** @throttled 10/min */
async sendNotification(params: { message: string }) {
  await this.mailer.send(params.message);
}

/** @throttled 100/h */
async apiCall(params: { endpoint: string }) {
  return await fetch(params.endpoint).then(r => r.json());
}
```

- Rate is tracked per method across all sessions (daemon mode)
- Window is rolling — oldest calls expire as time passes
- Rejects with a rate limit error when exceeded

### `@debounced` — Collapse Rapid Calls

If called again within the delay window, the previous pending call is cancelled and only the latest executes.

```typescript
/** @debounced 500ms */
async savePreferences(params: { prefs: Record<string, any> }) {
  await this.storage.write('prefs', params.prefs);
}
```

- Useful for auto-save, search-as-you-type
- Returns a promise that resolves when the debounced call finally executes
- Key is per-method (all calls to the same method share one debounce timer)

### `@queued` — Sequential Execution Queue

At most N concurrent executions. Additional calls wait in a FIFO queue.

```typescript
/** @queued 1 */
async processPayment(params: { orderId: string }) {
  return await this.stripe.charge(params.orderId);
}

/** @queued 3 */
async processImage(params: { url: string }) {
  return await this.imageService.resize(params.url);
}
```

- **Default concurrency:** 1 (strict sequential)
- Different from `@locked` — queue is ordered and never fails; lock is binary hold/wait
- Queue lives in the daemon (shared across sessions)

### `@validate` — Runtime Input Validation

Custom validation rules beyond JSON Schema. Runs before method execution.

```typescript
/**
 * @validate params.email must be a valid email
 * @validate params.amount must be positive
 */
async charge(params: { email: string; amount: number }) {
  // Only reached if email is valid and amount > 0
}
```

**Built-in validators:**

| Rule | Matches |
|------|---------|
| `email` | Valid email format |
| `url` | Valid URL |
| `positive` | Number > 0 |
| `non-negative` | Number >= 0 |
| `non-empty` | Non-empty string |
| `uuid` | UUID format |
| `integer` | Whole number |

### `@deprecated` — Mark Tool as Deprecated

Tool still works but surfaces deprecation notices across all interfaces.

```typescript
/** @deprecated Use addV2 instead */
async add(params: { title: string }) {
  return this.addV2({ title: params.title, priority: 'medium' });
}
```

- **MCP tools/list:** Description prefixed with `[DEPRECATED: message]`
- **Beam UI:** Gray badge with strikethrough styling
- **CLI:** Warning logged before execution
- **LLM context:** Deprecation notice in tool description guides model to prefer alternatives

### Execution Pipeline Order

When multiple functional tags are present on the same method, they compose as middleware in this order (cheapest checks first):

```
@fallback   → catch any error below, return default value
@throttled  → reject if over rate limit
@debounced  → cancel previous, delay execution
@cached     → return cached result if TTL valid (skips everything below)
@validate   → reject if custom rules fail
@queued     → wait for concurrency slot
@locked     → acquire distributed lock
@timeout    → start race timer
@retryable  → retry loop on failure
  → actual method execution
```

Example combining tags:

```typescript
/**
 * Fetch and cache weather data with rate limiting
 * @cached 15m
 * @timeout 10s
 * @retryable 2 500ms
 * @throttled 30/min
 */
async getWeather(params: { city: string }) {
  return await fetch(`https://api.weather.com/${params.city}`).then(r => r.json());
}
```

## Notes

- **Class-level tags** must be in the JSDoc comment at the top of your `.photon.ts` file before the class.
- **Method-level tags** must be in the JSDoc comment immediately preceding the tool method.
- **Inline tags** use curly braces `{@tag}` and are placed within parameter descriptions.
- The first paragraph of the class-level JSDoc becomes the photon description.
- The first line of each method's JSDoc becomes the tool description.
