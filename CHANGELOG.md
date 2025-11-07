# Changelog

## [Unreleased]

### Changed

**CLI Structure Overhaul:**
- `photon <name>` → `photon mcp <name>` - More explicit MCP server invocation
- `photon list` → `photon get` - Follows kubectl/gh CLI patterns
- `photon list --config` → `photon get <name> --mcp` - Generate MCP config
- `photon get` - List all Photons
- `photon get <name>` - Show Photon details with metadata
- `photon get --mcp` - MCP config for all Photons
- `photon get <name> --mcp` - MCP config for one Photon

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
- `photon get <name>` shows version, marketplace, and modification status
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
