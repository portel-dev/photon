# Constructor Context: `photon use` and `photon set`

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
    private apiKey: string,              // 1. Environment — no default → `photon set`
    private region: string = 'us-east',  // 2. Context — has default → `photon use`
    private incidents: Incident[] = []   // 3. Dependency — non-primitive → auto-injected
  ) {}
}
```

| # | Type | Trigger | Managed by | Storage |
|---|------|---------|------------|---------|
| 1 | **Environment** | Primitive, no default | `photon set` | `~/.photon/env/{photon}.json` |
| 2 | **Context** | Primitive, has default | `photon use` | `~/.photon/context/{photon}.json` |
| 3 | **Dependency** | Non-primitive (or matches `@mcp`/`@photon`) | Runtime | MCP client / photon instance / state snapshot |

### Resolution Order (updated)

For each constructor parameter, the runtime resolves:

1. **Matches `@mcp` tag?** → MCP client proxy
2. **Matches `@photon` tag?** → Photon instance
3. **Primitive, no default?** → Environment variable (`~/.photon/env/{photon}.json` or `process.env`)
4. **Primitive, has default?** → Context value (`~/.photon/context/{photon}.json`, falls back to default)
5. **Non-primitive with default on `@stateful`?** → Persisted state snapshot
6. **Fallback** → `undefined` (constructor default applies)

---

## `photon set` — Configure Environment Variables

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
~/.photon/env/tracker.json
{
  "apiKey": "sk-new-key-789"
}
```

The loader reads from this file first, falls back to `process.env.TRACKER_API_KEY`. This means `photon set` values take precedence over shell environment variables.

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
~/.photon/context/tracker.json
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
~/.photon/state/
  todo-list/              # default partition
    snapshot.json         # { "items": [...] }
  todo-list--work/        # "work" partition
    snapshot.json         # { "items": [...] }
  todo-list--family/      # "family" partition
    snapshot.json         # { "items": [...] }
```

The partition suffix is derived from context param values: `{photon}--{value}`. Multiple context params are joined: `{photon}--{val1}--{val2}`.

### Workflow

```
$ photon use todo-list workouts
✓ Context: name=workouts

$ photon cli todo-list add "Push-ups"
# → loads state from ~/.photon/state/todo-list--workouts/snapshot.json
# → runs add("Push-ups")
# → persists updated state

$ photon use todo-list groceries
✓ Context: name=groceries

$ photon cli todo-list add "Milk"
# → loads state from ~/.photon/state/todo-list--groceries/snapshot.json
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
