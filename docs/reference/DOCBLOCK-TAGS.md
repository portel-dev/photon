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
| `@dependencies` | NPM packages to auto-install on first run. | `@dependencies axios@^1.0.0, lodash` |
| `@mcp` | Declares an MCP dependency for constructor injection. | `@mcp github anthropics/mcp-server-github` |
| `@photon` | Declares a Photon dependency (auto-install + auto-load). | `@photon billing billing-photon` |
| `@cli` | Declares a system CLI tool dependency. | `@cli git - https://git-scm.com/downloads` |
| `@mcps` | Lists MCP dependencies (for diagram generation). | `@mcps filesystem, git` |
| `@photons` | Lists Photon dependencies (for diagram generation). | `@photons calculator` |
| `@stateful` | Set to `true` if the photon maintains state between calls. | `@stateful true` |
| `@idleTimeout` | Idle timeout in milliseconds before process termination. | `@idleTimeout 300000` |
| `@ui` | Defines a UI template asset for MCP Apps. | `@ui my-view ./ui/view.html` |
| `@prompt` | Defines a static prompt asset. | `@prompt greet ./prompts/greet.txt` |
| `@resource` | Defines a static resource asset. | `@resource data ./data.json` |
| `@icon` | Sets the photon icon (emoji). | `@icon 🔧` |
| `@tags` | Comma-separated tags for categorization and search. | `@tags database, sql, postgresql` |
| `@label` | Custom display name for the photon in BEAM sidebar. | `@label My Custom Tool` |
| `@persist` | Enables settings UI persistence for the photon. | `@persist` |
| `@internal` | Marks photon as internal (hidden from main UI). | `@internal` |

### Runtime Version Ranges

The `@runtime` tag supports semver-style version ranges:

| Range | Meaning | Example |
|-------|---------|---------|
| `^1.5.0` | Compatible with 1.5.0 and above, below 2.0.0 | `@runtime ^1.5.0` |
| `~1.5.0` | Compatible with 1.5.x only | `@runtime ~1.5.0` |
| `>=1.5.0` | Any version 1.5.0 or higher | `@runtime >=1.5.0` |
| `1.5.0` | Exact version match required | `@runtime 1.5.0` |

## Method-Level Tags

These tags are placed in the JSDoc comment immediately before a tool method.

| Tag | Description | Example |
|-----|-------------|---------|
| `@param` | Describes a tool parameter. | `@param name User's full name` |
| `@returns` | Describes the return value. Can include `{@label}`. | `@returns The greeting message {@label Say Hello}` |
| `@example` | Provides a code example. | `@example await tool.greet({ name: 'World' })` |
| `@format` | Hints the output format for CLI/Web interfaces. | `@format table` |
| `@icon` | Sets the tool icon (emoji or icon name). | `@icon calculator` or `@icon 🧮` |
| `@autorun` | Auto-execute when selected in Beam UI (for idempotent methods). | `@autorun` |
| `@async` | Run in background, return execution ID immediately. | `@async` |
| `@ui` | Links a tool to a UI template defined at class level. | `@ui my-view` |
| `@cached` | **Functional.** Memoize results with TTL. | `@cached 5m` |
| `@timeout` | **Functional.** Execution time limit. | `@timeout 30s` |
| `@retryable` | **Functional.** Auto-retry on failure. | `@retryable 3 1s` |
| `@throttled` | **Functional.** Rate limit per method. | `@throttled 10/min` |
| `@debounced` | **Functional.** Collapse rapid repeated calls. | `@debounced 500ms` |
| `@queued` | **Functional.** Sequential execution queue. | `@queued 1` |
| `@validate` | **Functional.** Runtime input validation rules. | `@validate params.email must be a valid email` |
| `@deprecated` | **Functional.** Mark tool as deprecated. | `@deprecated Use v2 instead` |

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

**How results are stored:** The execution audit trail (`~/.photon/logs/{photonId}/executions.jsonl`) records the full result, timing, and any errors once the background task completes.

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
| `table` | Array of objects as a table |
| `list` | Array as a styled list (iOS-inspired) |
| `grid` | Array as a visual grid |
| `tree` | Hierarchical/nested data |
| `card` | Single object as a card |
| `none` | No special formatting |

### Content Formats

| Value | Description |
|-------|-------------|
| `json` | JSON syntax highlighting |
| `markdown` | Markdown rendering |
| `yaml` | YAML syntax highlighting |
| `xml` | XML syntax highlighting |
| `html` | HTML rendering |
| `mermaid` | Mermaid diagram rendering |

### Visualization Formats

| Value | Description |
|-------|-------------|
| `chart` | Auto-detect chart type from data shape |
| `chart:bar` | Bar chart |
| `chart:line` | Line chart |
| `chart:pie` | Pie chart |
| `chart:area` | Area chart (line with fill) |
| `chart:scatter` | Scatter plot |
| `chart:donut` | Donut chart |
| `chart:radar` | Radar/spider chart |
| `metric` | KPI display (big number + label + delta) |
| `gauge` | Circular gauge/progress indicator |
| `timeline` | Vertical timeline of events |
| `dashboard` | Composite grid of auto-detected panels |
| `cart` | Shopping cart with item rows + totals |

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
| `code` | Generic code block |
| `code:javascript` | JavaScript syntax highlighting |
| `code:typescript` | TypeScript syntax highlighting |
| `code:python` | Python syntax highlighting |
| `code:lang` | Any language (replace `lang`) |

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

The `{@format}` inline tag on parameters controls validation and Auto UI:

| Value | Description |
|-------|-------------|
| `email` | Email input with validation |
| `url` / `uri` | URL input with validation |
| `date` | Date picker |
| `date-time` | Date and time picker |
| `time` | Time picker |
| `password` | Password input (masked) |
| `textarea` / `multiline` | Multi-line text area |
| `uuid` | UUID validation |

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
| `photon` (default) | `~/.photon/data/{photonId}/` | Private state for this photon |
| `session` | `~/.photon/sessions/{sessionId}/{photonId}/` | Per-user session data |
| `global` | `~/.photon/data/_global/` | Shared across all photons |

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

## Functional Tags (Runtime-Enforced)

These method-level tags are **automatically enforced by the runtime** — no manual code needed. They compose as middleware in the execution pipeline.

| Tag | Description | Example |
|-----|-------------|---------|
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
