# Constructor Context: Env Capture, Instances, and Config

Constructor parameters are Photon’s runtime contract. Photon resolves them when a photon is loaded, stores the values it owns under the current `PHOTON_DIR`, and replays those values when daemon-hosted photons are reconstructed after restart.

## Injection Types

```typescript
/**
 * Incident tracker
 * @mcp slack anthropics/mcp-server-slack
 * @stateful true
 */
export default class Tracker {
  constructor(
    private apiKey: string,              // 1. Constructor env -> captured on load
    private region: string = 'us-east',  // 2. Constructor env with default
    private slack: any,                  // 3. MCP dependency
    private incidents: Incident[] = []   // 4. Stateful snapshot
  ) {}
}
```

| Type | Trigger | Managed by | Storage |
|------|---------|------------|---------|
| Constructor env | Primitive constructor param | Existing env-var mapping, captured by loader | `.data/{ns}/{photon}/env.json` |
| Constructor env with default | Primitive constructor param with default | Same mapping; default applies when unset | `.data/{ns}/{photon}/env.json` when captured |
| MCP / photon dependency | Matches `@mcp` or `@photon` | Runtime | Proxy / loaded photon instance |
| Stateful snapshot | Non-primitive with default on `@stateful` photon | Runtime | `.data/{ns}/{photon}/state/{instance}/state.json` |

## Resolution Order

For each constructor parameter, the runtime resolves:

1. Matches `@mcp` tag -> MCP client proxy.
2. Matches `@photon` tag -> Photon instance.
3. Primitive constructor param -> current `process.env` when present, captured into `.data`, otherwise stored value from `.data`.
4. Non-primitive with default on `@stateful` -> persisted state snapshot.
5. Fallback -> `undefined`, so the TypeScript constructor default applies.

Current process env wins during a load because it is the operator’s explicit current input. The loader captures that value so later daemon restarts can replay the same constructor input even when the shell environment is gone.

## Constructor Env Capture

Set constructor environment values normally before first loading the photon:

```bash
export KITH_REMIND_KITH_USER_EMAIL=you@example.com
photon beam
```

When Photon resolves that constructor injection, it writes the declared env value under the current `PHOTON_DIR`, namespace, and photon name:

```text
{PHOTON_DIR}/.data/{namespace-or-local}/{photon}/env.json
```

On daemon restart, the loader replays the stored constructor values if the original shell environment is unavailable. This is what makes stateful photons and scheduled jobs daemon-safe without requiring users to maintain daemon-specific shell startup files.

Daemon IPC also carries a narrow constructor env snapshot from the caller to the daemon. It includes only env vars declared by primitive constructor parameters for that photon, not the caller’s whole environment. This handles the case where a daemon is already running and a later CLI or Beam process has the required env values.

## Manual Repair: `photon config`

`photon config` writes to the same runtime-owned store. It is a repair or override surface, not the normal setup path:

```bash
photon config get kith-remind KITH_REMIND_KITH_USER_EMAIL
photon config set kith-remind KITH_REMIND_KITH_USER_EMAIL=you@example.com
```

Use it when a captured value needs to be corrected without restarting from an environment that contains the desired variable.

## Named Instances: `photon use`

`photon use` does not configure primitive constructor defaults. It selects the named runtime instance for a stateful photon session.

```bash
photon use todo-list work
photon cli todo-list add "Review release notes"

photon use todo-list personal
photon cli todo-list add "Buy milk"
```

The instance name scopes state:

```text
{PHOTON_DIR}/.data/{namespace-or-local}/todo-list/state/work/state.json
{PHOTON_DIR}/.data/{namespace-or-local}/todo-list/state/personal/state.json
```

This keeps the developer contract simple:

```typescript
/**
 * @stateful true
 */
export default class TodoList {
  constructor(public items: string[] = []) {}

  add(text: string) {
    this.items.push(text);
  }
}
```

Photon owns the instance switch and state partition. The photon code only declares state through the constructor.

## `@requiresConfig`

Scheduled methods can declare keys that must be present in the runtime-owned store before Photon arms the schedule:

```typescript
/**
 * @scheduled 0 9 * * *
 * @requiresConfig KITH_USER_EMAIL
 */
async remind() {
  const email = this.config.require('KITH_USER_EMAIL');
}
```

If the key is missing, the schedule is not enabled. Constructor env capture normally populates the store during first load; `photon config set` remains available for repair.
