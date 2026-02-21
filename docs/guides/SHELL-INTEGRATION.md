# Shell Integration

Run photons as direct terminal commands with full tab completion.

## Quick Start

```bash
photon init cli
```

This auto-detects your shell, adds the hook to your profile, and generates the completion cache. Then activate it:

```bash
source ~/.zshrc   # or source ~/.bashrc
```

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
| `lis⇥` | `list` (photon name) |
| `list ⇥` | `add`, `get`, `remove` (methods) |
| `list add --⇥` | `--item` (parameters) |
| `photon ⇥` | `cli`, `use`, `beam`, `serve`, ... (subcommands) |
| `photon cli ⇥` | `list`, `kanban`, `git-box`, ... (photon names with descriptions) |
| `photon cli list ⇥` | `add`, `get`, `remove` (methods) |
| `photon use list ⇥` | `workouts`, `groceries` (instances) |

## Supported Shells

| Shell | Profile | Completion System | Hook Line |
|-------|---------|-------------------|-----------|
| **zsh** | `~/.zshrc` | `compdef` + `_arguments` | `eval "$(photon init cli --hook)"` |
| **bash** | `~/.bashrc` | `complete -F` + `compgen` | `eval "$(photon init cli --hook)"` |
| **PowerShell** | `$PROFILE` | `Register-ArgumentCompleter` | `Invoke-Expression (& photon init cli --hook)` |

Detection is automatic:
- **zsh/bash**: Detected via `$SHELL` environment variable
- **PowerShell**: Detected via `$PSModulePath` environment variable or Windows platform

Running `photon init cli` on an unsupported shell (e.g., fish, nushell) shows the supported list and exits with an error.

## How It Works

### Shell Hook

`photon init cli` appends a single line to your shell profile. When your shell starts, this line:

1. **Creates shell functions** for each installed photon (e.g., `list() { photon cli list "$@"; }` or `function list { photon cli list @Args }` in PowerShell). These functions are what enable tab completion.

2. **Registers a command-not-found handler** as a fallback. If a new photon is installed between shell restarts, the handler catches it and routes to `photon cli`.
   - zsh: `command_not_found_handler`
   - bash: `command_not_found_handle`
   - PowerShell 7.4+: `$ExecutionContext.InvokeCommand.CommandNotFoundAction`

3. **Registers completion functions** that read from a cache file for fast tab completion of methods, parameters, and instances.

### Completion Cache

Tab completion reads from `~/.photon/cache/completions.cache` — a grep-friendly text file (or parsed via `Get-Content` on PowerShell). No Node.js process is spawned during tab completion, so it's fast (< 10ms).

The cache contains:
- Photon names and descriptions
- Method names and descriptions per photon
- Parameter names and types per method
- Instance names for stateful photons

### Cache Freshness

The cache is automatically regenerated when:
- `photon init cli` is run (first install)
- `photon add <name>` installs a new photon
- `photon remove <name>` removes a photon
- `photon use <photon> <instance>` switches instances

To manually refresh:

```bash
photon init completions --generate
```

To check cache status:

```bash
photon init completions
```

## Commands Reference

| Command | Description |
|---------|-------------|
| `photon init cli` | Install shell integration into your profile |
| `photon init cli --hook` | Output the hook script (used by eval/Invoke-Expression, not run directly) |
| `photon init completions` | Show cache status |
| `photon init completions --generate` | Regenerate the completions cache |
| `photon uninit cli` | Remove shell integration from your profile |

## Uninstall

```bash
photon uninit cli
```

This removes the hook line and marker from your shell profile. Then restart your shell or run `exec $SHELL`.

## Troubleshooting

**"Unsupported shell" error:**
Photon shell integration supports zsh, bash, and PowerShell. If your shell isn't detected correctly, set `$SHELL` explicitly: `SHELL=/bin/zsh photon init cli`.

**Tab completion not working after installing a new photon:**
Run `photon init completions --generate` to rebuild the cache, then restart your shell.

**Shell functions conflict with existing commands:**
The command-not-found handler only fires when no real command exists. Shell functions created by the hook will shadow commands with the same name. If a photon name conflicts with a system command, remove the photon or rename it.

**PowerShell: CommandNotFoundAction not working:**
The fallback handler requires PowerShell 7.4+. On older versions, only pre-registered photon functions work (new photons need a shell restart). Tab completion works on all PowerShell versions via `Register-ArgumentCompleter`.

**Slow shell startup:**
The hook scans `~/.photon/` for photon files and reads a cache file. This typically takes < 50ms. If startup is slow, check for a large number of installed photons or disk issues.
