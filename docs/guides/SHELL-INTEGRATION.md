# Shell Integration

Run photons as direct terminal commands with full tab completion.

## Quick Start

```bash
photon shell init
```

This detects your shell (bash/zsh), adds the hook to your rc file, and generates the completion cache. Restart your terminal or run `source ~/.zshrc` (or `~/.bashrc`).

## What It Does

After setup, every installed photon becomes a direct command:

```bash
# Instead of:
photon cli list add "Push-ups"

# Just type:
list add "Push-ups"
list get
kanban board
git-box status ~/my-repo
```

### Tab Completion

Tab completion works at every level:

| Context | TAB completes |
|---------|---------------|
| `lis⇥` | → `list` (photon name) |
| `list ⇥` | → `add`, `get`, `remove` (methods) |
| `list add --⇥` | → `--item` (parameters) |
| `photon ⇥` | → `cli`, `use`, `beam`, `serve`, ... (subcommands) |
| `photon cli ⇥` | → `list`, `kanban`, `git-box`, ... (photon names with descriptions) |
| `photon cli list ⇥` | → `add`, `get`, `remove` (methods) |
| `photon use list ⇥` | → `workouts`, `groceries` (instances) |

## How It Works

### Shell Hook

`photon shell init` appends this line to your rc file:

```bash
eval "$(photon shell init --hook)"
```

When your shell starts, this eval:

1. **Creates shell functions** for each installed photon (e.g., `list() { photon cli list "$@"; }`). These functions are what enable tab completion — the shell knows they exist.

2. **Registers a `command_not_found` handler** as a fallback. If a new photon is installed between shell restarts, the handler catches it and routes to `photon cli`.

3. **Registers completion functions** (`compdef` for zsh, `complete -F` for bash) that read from a cache file for fast tab completion of methods, parameters, and instances.

### Completion Cache

Tab completion reads from `~/.photon/cache/completions.cache` — a grep-friendly text file. No Node.js process is spawned during tab completion, so it's fast (< 10ms).

The cache contains:
- Photon names and descriptions
- Method names and descriptions per photon
- Parameter names and types per method
- Instance names for stateful photons

### Cache Freshness

The cache is automatically regenerated when:
- `photon shell init` is run (first install)
- `photon add <name>` installs a new photon
- `photon remove <name>` removes a photon
- `photon use <photon> <instance>` switches instances

To manually refresh:

```bash
photon shell completions --generate
```

To check cache status:

```bash
photon shell completions
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `photon shell init` | Install shell integration into your rc file |
| `photon shell init --hook` | Output the hook script (used by eval, not run directly) |
| `photon shell completions` | Show cache status |
| `photon shell completions --generate` | Regenerate the completions cache |

## Supported Shells

| Shell | RC File | Completion System |
|-------|---------|-------------------|
| **zsh** | `~/.zshrc` | `compdef` + `_arguments` |
| **bash** | `~/.bashrc` | `complete -F` + `compgen` |

Detection is automatic via the `$SHELL` environment variable.

## Uninstall

Remove the eval line from your rc file:

```bash
# Remove this line from ~/.zshrc or ~/.bashrc:
eval "$(photon shell init --hook)"
```

## Troubleshooting

**Tab completion not working after installing a new photon:**
Run `photon shell completions --generate` to rebuild the cache, then restart your shell.

**Shell functions conflict with existing commands:**
The `command_not_found` handler only fires when no real command exists. Shell functions created by the hook will shadow commands with the same name. If a photon name conflicts with a system command, remove the photon or rename it.

**Slow shell startup:**
The hook scans `~/.photon/` for photon files and reads a cache file. This typically takes < 50ms. If startup is slow, check for a large number of installed photons or disk issues.
