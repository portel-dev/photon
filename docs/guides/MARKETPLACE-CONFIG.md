# Sharing Configuration Across a Marketplace of Photons

When you build a set of related photons that work together, they often need to agree on a few values: a data directory, an API base URL, a tenant ID, a sync interval. This guide covers how to do that today, the patterns to avoid, and the open enhancement that will eventually make it ergonomic.

## What is a marketplace?

A **marketplace** is a directory of `.photon.ts` files marked by a `.marketplace/` folder (containing a `photons.json` manifest). Photons in the same marketplace can call each other by name and are typically published, installed, and updated as a unit. See [Marketplace Publishing](MARKETPLACE-PUBLISHING.md) for the full setup.

A real example: a "kith" marketplace might contain 28 photons, all reading from and writing to one shared `~/kith-data/` directory.

## The trap to avoid

Every photon's first instinct, when it needs config, is to reach for `process.env.MY_DATA_DIR`. This works for one photon. It does not work for a marketplace, because:

- The user has to set the env var separately for every photon.
- The env var is invisible from inside Beam, the CLI, and the MCP UI. The user can change runtime behavior only by editing shell config and restarting the daemon.
- Each photon ends up with its own slightly-different copy of the path-resolution logic, and they drift.

If you find yourself writing `process.env.SOMETHING` inside a class extending `Photon`, that is the symptom. The cure is `protected settings`.

## Pattern 1: each photon declares its own settings

The simplest shape. Every photon in the marketplace declares the same setting independently:

```typescript
// kith-mail.photon.ts
export default class KithMail extends Photon {
  /** User-tunable knobs */
  protected settings = {
    /** Directory where kith data lives */
    dataDir: '~/kith-data',
  };
}
```

```typescript
// kith-contacts.photon.ts
export default class KithContacts extends Photon {
  /** User-tunable knobs */
  protected settings = {
    /** Directory where kith data lives */
    dataDir: '~/kith-data',
  };
}
```

The user has to set `dataDir` once per photon (`photon cli kith-mail settings --dataDir ...`, then `kith-contacts settings --dataDir ...`, etc.). This is verbose, but it works on day one without any other moving parts.

Use this pattern when:
- The marketplace is small (2-3 photons).
- The shared knob has a sensible default that most users won't change.

## Pattern 2: one config photon, others delegate

When the marketplace is bigger, designate one photon as the source of truth and have the rest call it.

```typescript
// kith-config.photon.ts
export default class KithConfig extends Photon {
  /** Marketplace-wide configuration. Other kith photons read these via this.call. */
  protected settings = {
    /** Root directory where all kith photons read and write */
    dataDir: '~/kith-data',
    /** Base URL for the upstream sync API */
    apiBaseUrl: 'https://api.kith.example.com',
  };

  /** Read the shared data directory */
  getDataDir() {
    return { dataDir: this.settings.dataDir };
  }

  /** Read the shared API base URL */
  getApiBaseUrl() {
    return { apiBaseUrl: this.settings.apiBaseUrl };
  }
}
```

```typescript
// kith-mail.photon.ts
/**
 * @photon config ./kith-config.photon.ts
 */
export default class KithMail extends Photon {
  constructor(private config: any) {}  // injected from @photon config

  async sync() {
    const { dataDir } = await this.config.getDataDir();
    // ...use dataDir
  }
}
```

The user changes `dataDir` once on `kith-config` and every photon that depends on it picks up the new value on the next call. The `@photon` tag declares the dependency so the daemon loads `kith-config` first; `this.call` (or the injected proxy) routes the request through the same daemon process.

Use this pattern when:
- More than three photons share the same knob.
- You want a single command to change a marketplace-wide setting.
- You want the shared values to appear in only one settings tool, not N.

## Known gap: marketplace-level shared settings

There is no first-class `@sharedSetting` or `marketplace.json` settings block today. Pattern 2 is the manual equivalent. A future enhancement is tracked: declaring a setting at the marketplace level, with all member photons reading the same persisted value via `this.settings`, with no config-photon boilerplate.

If you hit a case where Pattern 2 is awkward (for example, you want every photon's read to be lock-free and synchronous), file an issue describing the use case so it can inform the design.

## Cross-photon calls: known reliability constraint

Inside the same daemon, `this.call('peer.method', args)` and `@photon`-injected proxies route through the daemon's RPC bus. There has been a class of bugs where a photon calling a sibling in the same marketplace would fall back to a slow path or, in rare cases, end up with a stale instance. If you see strange behavior on cross-photon calls inside one marketplace:

1. Check `~/.photon/.data/daemon.log` for routing warnings.
2. As a temporary workaround, photons can write to the shared filesystem layout directly (see Pattern 1 for setting `dataDir`). This sidesteps the RPC path entirely.
3. File an issue with reproduction steps. The fix belongs in the runtime, not your photon.

The bypass is a workaround, not a recommended pattern. It splits write logic across photons and makes the data layout drift over time. Always prefer `this.call` once the underlying issue is resolved for your case.

## Checklist for a multi-photon marketplace

When designing a set of related photons:

- [ ] Identify every value that should be runtime-configurable. Each goes on `protected settings`, not `process.env`.
- [ ] Decide which knobs are per-photon and which are marketplace-wide.
- [ ] If you have more than two marketplace-wide knobs, build a config photon (Pattern 2).
- [ ] Document the shared knobs in the marketplace's CLAUDE.md or README so future readers know where to set them.
- [ ] If your photons share a data directory, define the layout in one place (the config photon's docs or a top-level `LAYOUT.md`) so every writer agrees.

## See also

- [Settings: User-Configurable Knobs](../GUIDE.md#settings-user-configurable-knobs)
- [Marketplace Publishing](MARKETPLACE-PUBLISHING.md)
- [Dependency Injection](../GUIDE.md#dependency-injection)
- [How Photon Works](../GUIDE.md#how-photon-works)
