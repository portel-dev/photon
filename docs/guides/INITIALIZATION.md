# Photon Initialization: Complete Setup Guide

The `photon init` command suite configures your system for optimal Photon usage with shell integration, tab completion, and daemon auto-start.

## Quick Setup

```bash
# One-command setup: shell integration + daemon auto-start
photon init all

# Activate shell integration (zsh/bash)
source ~/.zshrc  # or ~/.bashrc
```

After this, restart your terminal and photons work as direct commands:
```bash
list add "Buy milk"          # instead of: photon cli list add "Buy milk"
kanban board                 # instead of: photon cli kanban board
photon use todo shopping-list
```

---

## Commands Overview

| Command | Purpose |
|---------|---------|
| `photon init cli` | Shell integration + completion cache setup |
| `photon init daemon` | Auto-start daemon on login |
| `photon init all` | Run both `cli` and `daemon` |
| `photon init completions` | Show/regenerate completion cache |
| `photon uninit cli` | Remove shell integration |
| `photon uninit daemon` | Remove daemon auto-start |

---

## `photon init cli` — Shell Integration

Sets up your shell to run photons as direct commands with full tab completion.

### What It Does

```bash
photon init cli
```

This command:
1. **Detects your shell** — zsh, bash, or PowerShell (auto-detection via `$SHELL` or Windows platform)
2. **Adds shell hook** — Appends a single eval/invoke line to your rc file
3. **Generates completion cache** — Creates `~/.photon/.data/.cache/completions.cache` with all photon metadata
4. **Creates shell functions** — Generates one function per installed photon (e.g., `list()`, `kanban()`)
5. **Sets up fallback handler** — New photons work immediately without shell restart

### Installation

```bash
# Auto-detects shell, updates rc file
photon init cli

# Activate the hook
source ~/.zshrc  # zsh
source ~/.bashrc # bash
. $PROFILE       # PowerShell
```

### Supported Shells

| Shell | Profile | Completion | Hook |
|-------|---------|-----------|------|
| **zsh** | `~/.zshrc` | `compdef` + `_arguments` | `eval "$(photon init cli --hook)"` |
| **bash** | `~/.bashrc` | `complete -F` + `compgen` | `eval "$(photon init cli --hook)"` |
| **PowerShell** | `$PROFILE` | `Register-ArgumentCompleter` | `Invoke-Expression (& photon init cli --hook)` |

### Shell Detection

Auto-detection works via:
- **zsh/bash** — `$SHELL` environment variable
- **PowerShell** — `$PSModulePath` or Windows platform

If detection fails, set `$SHELL` explicitly:
```bash
SHELL=/bin/zsh photon init cli
```

### What Gets Installed

The hook creates three things in your shell:

**1. Shell Functions** (for direct invocation)
```bash
# After init, these functions are created for each photon:
list() { photon cli list "$@"; }
kanban() { photon cli kanban "$@"; }
git-box() { photon cli git-box "$@"; }
```

**2. Tab Completion** (reads from cache)
```bash
# Tab completion cache at ~/.photon/.data/.cache/completions.cache
# Contains: photon names, methods, parameters, instances
# Updated when `photon init cli` runs or when you add new photons
```

**3. Fallback Handler** (for new photons before shell restart)
```bash
# zsh: command_not_found_handler()
# bash: command_not_found_handle()
# Falls back to: photon cli "$@" if file exists
```

### Internal Completion Initialization

**Key point:** `photon init cli` automatically initializes the completion cache.

```typescript
// From init.ts lines 418-426:
const { CACHE_FILE } = await import('../../shell-completions.js');
try {
  await fs.access(CACHE_FILE);
} catch {
  // Cache doesn't exist yet — generate it
  const { generateCompletionCache } = await import('../../shell-completions.js');
  await generateCompletionCache();
}
```

This means:
- ✅ First run of `photon init cli` automatically generates completions
- ✅ You don't need to run `photon init completions --generate` separately
- ✅ Completion cache is always up-to-date after setup

### Tab Completion Examples

After setup, tab completion works at multiple levels:

```bash
# Photon name completion
lis⇥         → list (from ~/ .photon/cache/completions.cache)

# Method completion
list ⇥       → add, get, remove (methods of list photon)

# Parameter completion
list add --⇥ → --item, --priority (parameters of list.add)

# Instance completion
photon use list ⇥  → shopping-list, groceries (named instances)

# Full photon command
photon cli ⇥        → list, kanban, git-box (installed photons)
photon cli list ⇥   → add, get, remove (methods)
```

---

## `photon init daemon` — Auto-Start on Login

Registers Photon daemon to start automatically when you log in.

### What It Does

```bash
photon init daemon
```

Creates a platform-specific auto-start entry:
- **macOS** — launchd plist in `~/Library/LaunchAgents/dev.photon.daemon.plist`
- **Linux** — systemd service in `~/.config/systemd/user/photon-daemon.service`
- **Windows** — Task Scheduler entry `PhotonDaemon`

The daemon:
- Starts automatically at login
- Persists photon state across sessions
- Broadcasts state changes to multiple connected clients
- Enables real-time sync across CLI, Beam UI, and Claude Desktop

### Platform-Specific Setup

#### macOS (launchd)

```bash
photon init daemon

# Start it now without logging out:
launchctl load ~/Library/LaunchAgents/dev.photon.daemon.plist

# Check if it's running:
launchctl list | grep photon

# View logs:
tail -f ~/.photon/daemon-init.log
```

#### Linux (systemd)

```bash
photon init daemon

# Enable and start the service:
systemctl --user enable photon-daemon
systemctl --user start photon-daemon

# Check status:
systemctl --user status photon-daemon

# View logs:
journalctl --user -u photon-daemon -f

# Note: Requires lingering enabled
loginctl enable-linger
```

#### Windows (Task Scheduler)

```powershell
photon init daemon

# Verify in Task Scheduler:
Get-ScheduledTask -TaskName "PhotonDaemon"

# Start it now:
Start-ScheduledTask -TaskName "PhotonDaemon"
```

---

## `photon init all` — Complete Setup

Runs all setup steps in sequence: shell integration + daemon auto-start.

### What It Does

```bash
photon init all
```

Equivalent to:
```bash
photon init cli     # Install shell integration + cache
photon init daemon  # Register daemon auto-start
```

### Output

```
Setting up Photon...

Step 1/2: Shell integration
  ✓ Installed shell integration into /Users/arul/.zshrc

    Activate now:  source /Users/arul/.zshrc
    Then type any photon name directly:
      list get
      list add "Milk"
    Tab completion is enabled for: Photon names, methods, parameters, and instances.

Step 2/2: Daemon auto-start
  ✓ Daemon auto-start registered: /Users/arul/Library/LaunchAgents/dev.photon.daemon.plist
    The daemon will start automatically at next login.
    To start it now without logging out:
      launchctl load /Users/arul/Library/LaunchAgents/dev.photon.daemon.plist

✓ Photon setup complete.
```

---

## `photon init completions` — Completion Cache Management

Manages the shell completion cache at `~/.photon/.data/.cache/completions.cache`.

### Show Cache Status

```bash
photon init completions

# Output:
Cache: /Users/arul/.photon/cache/completions.cache
  Last updated: 2h ago
  Run `photon init completions --generate` to refresh
```

### Regenerate Cache

```bash
photon init completions --generate

# Output:
✓ Completions cache updated: /Users/arul/.photon/cache/completions.cache
```

### When to Regenerate

The cache is automatically generated by `photon init cli`. Manually regenerate if:
- You installed new photons and they're not in completions
- You modified a photon's methods/parameters
- The cache became corrupted

### Cache Contents

The cache file contains one entry per line:

```
photon:list:List management
photon:kanban:Kanban board
method:list:add:Add an item
method:list:get:Get all items
param:list:add:--item:string:true
param:list:add:--priority:choice:false
instance:list:shopping-list
instance:list:groceries
```

Format: `type:name:description` or `type:photon:method:name:description`

---

## `photon uninit cli` — Remove Shell Integration

Removes the shell hook and completion setup.

### What It Does

```bash
photon uninit cli
```

Removes from your rc file:
- Eval/invoke line for the hook
- Old shell hook references (migrations from previous versions)
- Comments and markers

### After Removal

```bash
# Run to apply changes
exec $SHELL    # zsh/bash
. $PROFILE     # PowerShell

# Or restart your terminal
```

### Important

Removes only the integration line — doesn't delete:
- `~/.photon/` directory
- `~/.photon/.data/.cache/completions.cache`
- Any photon data or state

---

## `photon uninit daemon` — Remove Auto-Start

Removes daemon auto-start registration.

### macOS

```bash
photon uninit daemon

# Unloads and removes:
launchctl unload ~/Library/LaunchAgents/dev.photon.daemon.plist
rm ~/Library/LaunchAgents/dev.photon.daemon.plist
```

### Linux

```bash
photon uninit daemon

# Disables and removes:
systemctl --user disable photon-daemon
rm ~/.config/systemd/user/photon-daemon.service
```

### Windows

```powershell
photon uninit daemon

# Removes Task Scheduler entry:
schtasks /delete /tn "PhotonDaemon" /f
```

---

## Setup Architecture

### Phase 1: Shell Integration (`photon init cli`)

```
photon init cli
    ↓
[Shell Detection]
    ├─ $SHELL env var → zsh/bash
    ├─ $PSModulePath → PowerShell
    └─ Windows platform → PowerShell
    ↓
[Generate Hook Script]
    ├─ Shell functions for each photon
    ├─ Tab completion logic
    └─ Fallback handler for new photons
    ↓
[Install to RC File]
    ├─ ~/.zshrc  (zsh)
    ├─ ~/.bashrc (bash)
    └─ $PROFILE  (PowerShell)
    ↓
[Generate Completion Cache]
    └─ ~/.photon/.data/.cache/completions.cache
       (Contains: photons, methods, params, instances)
    ↓
User runs: source ~/.zshrc
    ↓
✓ Direct photon invocation works
✓ Tab completion enabled
```

### Phase 2: Daemon Auto-Start (`photon init daemon`)

```
photon init daemon
    ↓
[Detect Platform]
    ├─ macOS → launchd plist
    ├─ Linux → systemd service
    └─ Windows → Task Scheduler
    ↓
[Resolve photon binary]
    └─ Uses `which photon` or `where photon`
    ↓
[Create Auto-Start Entry]
    ├─ Command: photon daemon start
    └─ Startup trigger: Login / system boot
    ↓
[Log location]
    └─ ~/.photon/daemon-init.log (macOS/Linux)
    ↓
✓ Daemon starts automatically at next login
✓ State persisted and shared across clients
```

### Phase 3: Full Setup (`photon init all`)

```
photon init all
    ↓
    ├─ Run: photon init cli (step 1/2)
    │   └─ Shell integration + completion cache
    │
    └─ Run: photon init daemon (step 2/2)
        └─ Auto-start registration
    ↓
✓ Both phases complete
```

---

## Troubleshooting

### Shell Integration Not Working

**Symptom:** Photons still require `photon cli` prefix

**Fixes:**
```bash
# 1. Verify hook was installed
cat ~/.zshrc | grep "photon init cli"

# 2. Re-run setup
photon init cli

# 3. Activate changes
source ~/.zshrc

# 4. Check functions exist
declare -f list  # should show function definition
```

### Tab Completion Not Working

**Symptom:** No suggestions when pressing TAB

**Fixes:**
```bash
# 1. Check cache file exists
ls -la ~/.photon/.data/.cache/completions.cache

# 2. Regenerate cache
photon init completions --generate

# 3. Restart shell
exec $SHELL
```

### Daemon Not Starting

**Symptom:** `photon daemon` doesn't respond

**Fixes (macOS):**
```bash
# 1. Check plist is loaded
launchctl list | grep photon

# 2. Manually load plist
launchctl load ~/Library/LaunchAgents/dev.photon.daemon.plist

# 3. Check for errors
tail -f ~/.photon/daemon-init.log
```

**Fixes (Linux):**
```bash
# 1. Check service status
systemctl --user status photon-daemon

# 2. Enable lingering (if needed)
loginctl enable-linger

# 3. Check logs
journalctl --user -u photon-daemon -n 50
```

### Shell Detection Fails

**Symptom:** "Unsupported shell: fish"

**Fix:**
```bash
# Set $SHELL explicitly
SHELL=/bin/zsh photon init cli
```

---

## Verification Checklist

After running `photon init all`:

- [ ] Shell hook installed in rc file (`~/.zshrc`, `~/.bashrc`, or `$PROFILE`)
- [ ] Completion cache created at `~/.photon/.data/.cache/completions.cache`
- [ ] Shell restarted or sourced (eval line activated)
- [ ] Photon name works directly without `photon cli` prefix (e.g., `list add`)
- [ ] Tab completion works (try: `list ⇥`)
- [ ] Daemon auto-start registered (check platform-specific location)
- [ ] Daemon can be started manually (macOS: `launchctl load ...`, Linux: `systemctl --user start ...`)

---

## Related Guides

- [Shell Integration](./SHELL-INTEGRATION.md) — Detailed tab completion reference
- [Getting Started](./GETTING-STARTED.md) — First-time setup guide
- [Daemon Architecture](../core/DAEMON.md) — How the daemon works internally

