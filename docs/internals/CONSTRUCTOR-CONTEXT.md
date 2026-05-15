# Constructor Context: `photon use`, `photon set`, and `photon config`

Constructor parameters serve three distinct purposes based on their signature. Two CLI commands — `use` and `set` — manage them.

## The Three Injection Types

```typescript
/**
 * Incident tracker
 * @mcp slack anthropics/mcp-server-slack
 * @stateful true
 */
export default class Tracker {
  constructor(
    private apiKey: string,              // 1. Config — no default → `photon config set`
    private region: string = 'us-east',  // 2. Context — has default → `photon use`
    private incidents: Incident[] = []   // 3. Dependency — non-primitive → auto-injected
  ) {}
}
```

| # | Type | Trigger | Managed by | Storage |
|---|------|---------|------------|---------|
| 1 | **Config** | Primitive, no default | `photon config set` or `photon set` | `~/.photon/.data/{photon}/env.json` |
| 2 | **Context** | Primitive, has default | `photon use` | `~/.photon/.data/{photon}/context.json` |
| 3 | **Dependency** | Non-primitive (or matches `@mcp`/`@photon`) | Runtime | MCP client / photon instance / state snapshot |

### Resolution Order (updated)

For each constructor parameter, the runtime resolves:

1. **Matches `@mcp` tag?** → MCP client proxy
2. **Matches `@photon` tag?** → Photon instance
3. **Primitive, no default?** → Photon config (`~/.photon/.data/{photon}/env.json`, then `process.env`)
4. **Primitive, has default?** → Context value (`~/.photon/.data/{photon}/context.json`, falls back to default)
5. **Non-primitive with default on `@stateful`?** → Persisted state snapshot
6. **Fallback** → `undefined` (constructor default applies)

---

## `photon config` — Daemon-Safe Runtime Config

Use `photon config` for values that must be available to background daemon work regardless of which shell launched the daemon:

```bash
photon config set kith-remind KITH_USER_EMAIL=you@example.com
photon config get kith-remind KITH_USER_EMAIL
photon config list kith-remind
```

Photon instances can read the same store at runtime:

```typescript
const email = this.config.require('KITH_USER_EMAIL');
```

The store is under Photon data, not `.zshrc`, so scheduled jobs and daemon sessions see the same values after restart.

## `photon set` — Configure Constructor Params

For constructor params without defaults (required config like API keys, tokens).

### Interactive Mode

```
$ photon set tracker

  tracker — Environment

  apiKey (required)
  API key for authentication
  Current: sk-***456
  > sk-new-key-789

  ✓ Environment saved
```

Prompts for ALL environment params. Blank input keeps the current value. Sensitive values are masked in display.

### Direct Mode

```
$ photon set tracker apiKey sk-new-key-789
✓ Environment saved: apiKey
```

When some values are given directly, prompts for the remaining unset ones.

### Positional Args

```
$ photon set tracker sk-new-key-789
```

Values without a param name are mapped positionally to constructor parameter order.

### Storage

```
~/.photon/.data/tracker/env.json
{
  "apiKey": "sk-new-key-789"
}
```

The loader reads from this file first by constructor param name (`apiKey`), then by env-style key (`TRACKER_API_KEY`), then falls back to `process.env.TRACKER_API_KEY`. This means Photon config values take precedence over shell environment variables. (Legacy path `~/.photon/env/tracker.json` is also checked as a fallback for migration.)

---

## `photon use` — Switch Context

For constructor params with defaults (switchable runtime context).

### Interactive Mode

```
$ photon use tracker

  tracker — Context

  region (default: 'us-east')
  Deployment region
  Current: us-east
  > eu-west

  ✓ Context switched
```

Shows all context params with current values pre-filled and editable. Press Enter to keep the current value. Only shown when called with no arguments.

### Direct Mode

```
$ photon use tracker eu-west
✓ Context: region=eu-west
```

Sets only the specified values. Does NOT prompt for the rest — they already have values (either previously set or their defaults).

### Positional Args

Values map to constructor parameter order (context params only):

```typescript
constructor(
  private region: string = 'us-east',    // 1st context param
  private tier: string = 'standard',     // 2nd context param
) {}
```

```
$ photon use tracker eu-west premium
✓ Context: region=eu-west, tier=premium
```

### Named Args

If a value matches a known param name, the next value is its value:

```
$ photon use tracker tier premium
✓ Context: tier=premium
```

Detection logic:
1. Read next arg
2. Does it match a context param name? → next arg is its value
3. Doesn't match? → positional value for the next unset param

### Storage

```
~/.photon/.data/tracker/context.json
{
  "region": "eu-west",
  "tier": "premium"
}
```

---

## Context + Stateful = State Partitioning

When a `@stateful` photon has context params, the context values determine which state partition to use.

```typescript
/**
 * @stateful true
 */
export default class TodoList {
  constructor(
    private name: string = 'default',  // Context param → partition key
    public items: Task[] = []          // Persisted state → per-partition
  ) {}

  add(text: string) {
    this.items.push({ id: crypto.randomUUID(), text });
  }
}
```

### State Directory Structure

```
~/.photon/.data/
  todo-list/
    state/
      default/            # default partition
        state.json        # { "items": [...] }
      work/               # "work" partition
        state.json        # { "items": [...] }
      family/             # "family" partition
        state.json        # { "items": [...] }
```

Each partition gets its own subdirectory under `state/`: `.data/{photon}/state/{value}/state.json`. Multiple context params are joined: `.data/{photon}/state/{val1}--{val2}/state.json`.

### Workflow

```
$ photon use todo-list workouts
✓ Context: name=workouts

$ photon cli todo-list add "Push-ups"
# → loads state from ~/.photon/.data/todo-list/state/workouts/state.json
# → runs add("Push-ups")
# → persists updated state

$ photon use todo-list groceries
✓ Context: name=groceries

$ photon cli todo-list add "Milk"
# → loads state from ~/.photon/.data/todo-list/state/groceries/state.json
# → completely separate list
```

### Beam UI

In Beam, context params appear as a selector bar above the method form. Switching the selector re-loads the view with that partition's state. The LIVE indicator and warmth animations work per-partition.

---

## Behavior Differences: `set` vs `use`

| Aspect | `photon set` | `photon use` |
|--------|-------------|-------------|
| **Purpose** | Configure environment | Switch context |
| **Target params** | Primitive, no default | Primitive, has default |
| **Interactive (no args)** | Prompts for ALL params | Prompts for ALL params |
| **Partial args** | Sets given, prompts for rest | Sets given, skips rest |
| **Frequency** | Rarely (setup, key rotation) | Often (switching lists, regions) |
| **Sensitivity** | May contain secrets (masked) | Non-sensitive (shown plainly) |
| **Effect on @stateful** | None (env config is global) | Switches state partition |

---

## Developer Experience

The developer writes standard TypeScript. No new concepts:

```typescript
/**
 * @stateful true
 */
export default class TodoList {
  constructor(
    private name: string = 'default',
    public items: Task[] = []
  ) {}

  add(text: string) { this.items.push({ id: crypto.randomUUID(), text }); }
  list() { return this.items; }
  clear() { this.items.length = 0; }
}
```

The user manages partitions:

```
photon use todo-list work       # switch to "work" list
photon cli todo-list add "task" # adds to "work" list
photon use todo-list            # interactive — see/change current context
photon set todo-list            # interactive — configure env vars (if any)
```

Zero partitioning code. Zero framework APIs. The constructor signature is the entire contract.
