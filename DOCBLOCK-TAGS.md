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
| `@photon` | Declares a Photon dependency for constructor injection. | `@photon helper ./helper.photon.ts` |
| `@mcps` | Lists MCP dependencies (for diagram generation). | `@mcps filesystem, git` |
| `@photons` | Lists Photon dependencies (for diagram generation). | `@photons calculator` |
| `@stateful` | Set to `true` if the photon maintains state between calls. | `@stateful true` |
| `@idleTimeout` | Idle timeout in milliseconds before process termination. | `@idleTimeout 300000` |
| `@ui` | Defines a UI template asset for MCP Apps. | `@ui my-view ./ui/view.html` |
| `@prompt` | Defines a static prompt asset. | `@prompt greet ./prompts/greet.txt` |
| `@resource` | Defines a static resource asset. | `@resource data ./data.json` |
| `@icon` | Sets the photon icon (emoji). | `@icon 🔧` |
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
| `@ui` | Links a tool to a UI template defined at class level. | `@ui my-view` |

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

For programmatic locking with dynamic lock names, use `withLock()`:

```typescript
import { withLock } from '@portel/photon-core';

async moveTask(params: { taskId: string; column: string }) {
  return withLock(`task:${params.taskId}`, async () => {
    const task = await this.loadTask(params.taskId);
    task.column = params.column;
    await this.saveTask(task);
    return task;
  });
}
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

## Notes

- **Class-level tags** must be in the JSDoc comment at the top of your `.photon.ts` file before the class.
- **Method-level tags** must be in the JSDoc comment immediately preceding the tool method.
- **Inline tags** use curly braces `{@tag}` and are placed within parameter descriptions.
- The first paragraph of the class-level JSDoc becomes the photon description.
- The first line of each method's JSDoc becomes the tool description.
