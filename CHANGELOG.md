# Changelog

## [1.2.0] - 2025-11-11

### Features

* **Unified info command** - `photon info` now shows both installed AND available photons from marketplaces
  - `photon info` - Lists all installed photons with marketplace availability in tree structure
  - `photon info <name>` - Shows details for photon (installed or available)
  - Tree format clearly shows which marketplace offers what photons
  - Install status marked with ✓ for easy identification

* **Smart global detection** - Automatically detects and uses global photon installation
  - Uses `photon` command if installed globally (cross-platform)
  - Falls back to `npx @portel/photon` if not installed globally
  - No manual configuration needed

* **Smart --dev guidance** - Contextual recommendations based on photon origin
  - Marketplace photons: Run without --dev, suggests copying to customize
  - Modified marketplace photons: Run with --dev, warns about upgrade conflicts
  - Local/custom photons: Run with --dev for hot reload

### Bug Fixes

* **Static analysis** - Use PhotonDocExtractor for `info` command to avoid instantiation errors
  - No longer requires constructor parameters to view photon details
  - Works for any photon regardless of configuration requirements

* **Cross-platform compatibility** - Use `photon` command instead of full path
  - Generated MCP configs now use `"command": "photon"` instead of platform-specific paths
  - Works consistently across macOS, Linux, and Windows

### Changed

* **Command renamed** - `photon get` → `photon info` for clarity
  - More intuitive naming (info shows information, add downloads)
  - Removed duplicate marketplace `info` command (now unified)
  - All documentation updated to reflect new command

### Tests

* Updated all test suites to use `info` command
* All tests passing (schema, marketplace, loader, server, integration, README validation)

## [1.1.0](https://github.com/portel-dev/photon/compare/v1.0.0...v1.1.0) (2025-11-09)

### Features

* add --claude-code flag to sync marketplace command ([1940535](https://github.com/portel-dev/photon/commit/1940535f5ed3c61378889280a8affe81b8fed7ac))
* add Claude Code integration section to README template ([eb0bd09](https://github.com/portel-dev/photon/commit/eb0bd093ccefdea63cc977d3c362c2aa6bd272a4))
* add photon marketplace init command with automatic git hooks ([0600756](https://github.com/portel-dev/photon/commit/06007567b72dab82e28b83f652bc1ecc73f22c45))
* generate individual plugin for each photon ([1d3c50c](https://github.com/portel-dev/photon/commit/1d3c50c5db048e892bb735bd5b1f3deff316acfb))

### Bug Fixes

* ensure owner field is always present in Claude Code plugin manifest ([2740c03](https://github.com/portel-dev/photon/commit/2740c036899acb3acf2b42fa492d679f2d2af7cf))
* switch npm badges from shields.io to badgen.net ([1f7e544](https://github.com/portel-dev/photon/commit/1f7e5440e6664d1d548ac08837f2d8e2381ae35c))
* update contact email from contact@portel.dev to arul@luracast.com ([96a195d](https://github.com/portel-dev/photon/commit/96a195dd21d57539d9a51116d2de93b9744c3518))
* use absolute path for CLI in tests to work after cd operations ([54ca674](https://github.com/portel-dev/photon/commit/54ca674c76a41bfe1a82f8e6ba453b9fc44d97a9))

## [Unreleased]

### Changed

**CLI Structure Overhaul:**
- `photon <name>` → `photon mcp <name>` - More explicit MCP server invocation
- `photon list` → `photon info` - Unified command for local and marketplace info
- `photon list --config` → `photon info <name> --mcp` - Generate MCP config
- `photon info` - List all Photons (local + marketplace availability)
- `photon info <name>` - Show Photon details with metadata
- `photon info --mcp` - MCP config for all Photons
- `photon info <name> --mcp` - MCP config for one Photon

**Marketplace System (replacing Registry):**
- `photon registry:*` → `photon marketplace *` - Simpler, clearer naming
- Marketplace structure: `.marketplace/photons.json` (was `.photon/marketplace.json`)
- Added `photon marketplace init` - Generate marketplace manifest from directory
- Marketplace manifest includes SHA-256 hashes for integrity verification
- Source paths relative to `.marketplace/` directory (use `../` prefix)

### Added

**Metadata Tracking:**
- Installation metadata stored in `~/.photon/.metadata.json`
- Track marketplace source, version, installation date for each Photon
- SHA-256 hash calculation for modification detection
- `photon info <name>` shows version, marketplace, and modification status
- ⚠️ Modified indicator when file hash doesn't match original

**Commands:**
- `photon marketplace init [path]` - Generate marketplace manifest
- `photon add <name>` - Install Photon from marketplace
- `photon search <query>` - Search across marketplaces

**Logging:**
- Conditional logging in PhotonLoader (verbose mode)
- Server mode shows compilation logs (verbose=true)
- CLI inspection commands are quiet (verbose=false)
- Errors always display regardless of verbose setting

### Removed

- `[Photon]` prefix from all log messages - cleaner output
- Old registry commands (`photon registry:add`, etc.)
- Old list command format

### Documentation

- Updated README.md with new CLI structure
- Updated GUIDE.md with new commands and marketplace system
- Updated COMPARISON.md with new command references
- Added marketplace structure and creation documentation
- Added metadata tracking documentation

## [1.0.0] - 2025-01-04

### Initial Release

**Photon MCP** - Zero-install CLI for running single-file TypeScript MCPs

#### Features

- ✅ Single-file `.photon.ts` MCP server format
- ✅ Convention over configuration (no base classes required)
- ✅ Auto schema extraction from TypeScript types and JSDoc
- ✅ Hot reload in development mode (`--dev`)
- ✅ Production mode for MCP clients
- ✅ Template generation (`photon init`)
- ✅ Validation command (`photon validate`)
- ✅ Claude Desktop config generation (`--config`)
- ✅ Global installation support (`npm install -g @portel/photon`)
- ✅ Zero-install support (`npx @portel/photon`)
- ✅ **Name-only references** - Run `photon calculator` (no paths, no extensions)
- ✅ **Working directory** - Default to `~/.photon/`, override with `--working-dir`
- ✅ **Simple mental model** - All MCPs in one directory, accessible from anywhere
- ✅ **List command** - `photon list` shows all MCPs in working directory
- ✅ **Zero configuration** - Just create, run, done!

#### Package

- **Name**: `@portel/photon` (scoped package)
- **Binary**: `photon`
- **Version**: 1.0.0
- **License**: MIT

#### Installation

```bash
# Global install
npm install -g @portel/photon

# Or use with npx (zero install)
npx @portel/photon --help
```

#### Usage

```bash
# Create new MCP (stored in ~/.photon/)
photon init my-tool

# Run from anywhere (just the name!)
photon my-tool --dev

# Generate Claude Desktop config
photon my-tool --config

# List all MCPs
photon list

# Custom directory
photon --working-dir ./mcps init project-tool
photon --working-dir ./mcps project-tool --dev
```

**Note:** Reference MCPs by name only—no paths, no extensions needed!

#### Examples

Three example Photon MCPs included:
- `calculator.photon.ts` - Arithmetic operations
- `string.photon.ts` - Text manipulation utilities
- `workflow.photon.ts` - Task management

#### Documentation

- `README.md` - Complete user guide
- `GUIDE.md` - Developer guide for creating Photon MCPs
- `LICENSE` - MIT license

#### Architecture

Built on:
- `@modelcontextprotocol/sdk` - Official MCP SDK
- `esbuild` - Fast TypeScript compilation
- `chokidar` - File watching for hot reload
- `commander` - CLI framework
