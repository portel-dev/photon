# Changelog

## [1.4.0](https://github.com/portel-dev/photon/compare/v1.3.0...v1.4.0) (2025-11-24)

### Features

* add content format support for CLI and MCP output ([477aae3](https://github.com/portel-dev/photon/commit/477aae3bc6b495bb787ac66b04f3312570780aef))
* add hash-based dependency cache validation ([6706ea2](https://github.com/portel-dev/photon/commit/6706ea27d9cbfccaf87406521166799a77d70fc6))
* add maker command namespace for marketplace creators ([774f6e6](https://github.com/portel-dev/photon/commit/774f6e6385adb9cd6845a8e259c1feaee8305d9b))
* add missing CLI commands and improve command discoverability ([5f85a47](https://github.com/portel-dev/photon/commit/5f85a47644239bdac80462b7d9d0b6a96872d928))
* add shared CLI output formatter for consistent table/tree formatting ([c5f81ee](https://github.com/portel-dev/photon/commit/c5f81eefb1ab5d9d79ca76c4624a64f618b78a82))
* add syntax highlighting for --json flag output ([a1fcc92](https://github.com/portel-dev/photon/commit/a1fcc92955570bd08e4cd0e61fb0a49aab39c59b))
* add update command and typo suggestions ([c060591](https://github.com/portel-dev/photon/commit/c060591d8e04f01a1218e4cce5395a4a069f8864))
* migrate to @portel/photon-core for shared functionality ([91451b6](https://github.com/portel-dev/photon/commit/91451b68b220dbafdb6fd0e555349aa1318bfc04))

### Bug Fixes

* add type definitions and fix outputFormat access ([8c741e7](https://github.com/portel-dev/photon/commit/8c741e77cc9e24a11a1675671c001353aa789bd1))
* address PR review feedback ([d926095](https://github.com/portel-dev/photon/commit/d92609588f8ccccb08032b282ac5228e3e054f52))
* remove call to nonexistent removeInstallMetadata method ([9251121](https://github.com/portel-dev/photon/commit/9251121582bbedf30e49688e11e75f1b6a2371e4))
* update test imports to use @portel/photon-core ([4a2efd3](https://github.com/portel-dev/photon/commit/4a2efd39db061bc729319c33cba587ff7304fd2b))

## [1.3.0](https://github.com/portel-dev/photon/compare/v1.2.0...v1.3.0) (2025-11-19)

### Features

* add [@format](https://github.com/format) tag system for structured output rendering ([b824088](https://github.com/portel-dev/photon/commit/b8240888c53308c25dd45c491a4ca529480a7f78))
* add {[@unique](https://github.com/unique)} constraint for array uniqueItems ([d643ed6](https://github.com/portel-dev/photon/commit/d643ed6732c48e28ae987531e1d4204481deaeb9))
* add advanced JSDoc constraints - example, multipleOf, deprecated, readOnly/writeOnly ([7194f17](https://github.com/portel-dev/photon/commit/7194f172bc65e53a868327f41256330468bde751))
* add beautified table rendering with borders and clean output ([502e9bb](https://github.com/portel-dev/photon/commit/502e9bb0108891a960cd4ea6758bf758977bb7f8))
* add CLI aliases to run photons as standalone commands ([c5de92b](https://github.com/portel-dev/photon/commit/c5de92b0e521b748a3e2007f708b3a649ec83979))
* add comprehensive CLI documentation and tests ([2d5ba17](https://github.com/portel-dev/photon/commit/2d5ba17760babde8d1a72736c83ee0c5c181025c))
* add comprehensive JSDoc constraint support ([ddd537f](https://github.com/portel-dev/photon/commit/ddd537ff082065eb337290379cb5cd1d09866f4e))
* add direct CLI invocation for photon methods ([81e4be4](https://github.com/portel-dev/photon/commit/81e4be4d299fc25768c3c82640a4ff54e5122bad))
* add JSDoc constraint tags {[@min](https://github.com/min)} and {[@max](https://github.com/max)} ([d76092c](https://github.com/portel-dev/photon/commit/d76092c65fcaf2dc75791cf83c21f5bbf88b44fa))
* extract readonly from TypeScript with JSDoc precedence ([5a0f1a1](https://github.com/portel-dev/photon/commit/5a0f1a101998279d233b3025a03e5e3fbae16a18))
* format CLI output for better readability ([de70721](https://github.com/portel-dev/photon/commit/de707212dd33af96726fe4b1c8c5bbcca84bb721))
* generate proper JSON Schema enum arrays for literal unions ([1718188](https://github.com/portel-dev/photon/commit/171818820f8711a92add5f1409c8f6a3c648372b))
* implement session management for daemon isolation ([bae22d6](https://github.com/portel-dev/photon/commit/bae22d6125cfcd5af210123fa4118409b26811cb))
* implement stateful photon daemon architecture ([783e1cc](https://github.com/portel-dev/photon/commit/783e1cc511e2601bbb8f5b57e54310a5d6579a83))
* improve CLI error messages with hints ([837d47e](https://github.com/portel-dev/photon/commit/837d47e4594c4b5cd86c21fc3361bccf6b2b03a3))
* improve CLI help to follow standard conventions ([76ba48e](https://github.com/portel-dev/photon/commit/76ba48efcad43db17d161b7fbfdabae52b6325fa))
* optimize anyOf schemas for mixed type unions ([3281f2f](https://github.com/portel-dev/photon/commit/3281f2f301c7c973b6b4675e24bc4d777536919e))

### Bug Fixes

* add type coercion for CLI arguments based on method signatures ([a2125e0](https://github.com/portel-dev/photon/commit/a2125e02b0d120656070b703370f81e702520eef))
* critical CLI bugs - exit codes and --help ([6ee6da7](https://github.com/portel-dev/photon/commit/6ee6da782fa680f83bb866753ee2280e65d464cb))
* daemon CLI pairing flow and exit behavior ([83a3233](https://github.com/portel-dev/photon/commit/83a3233f6a9147e9a150cbe36af5b2c97b3cab36))
* detect optional parameters from TypeScript signatures ([8481df6](https://github.com/portel-dev/photon/commit/8481df6580e152133dd92acf39b8bf1803b9ef5c))
* make CLI aliases truly cross-platform ([1e541c2](https://github.com/portel-dev/photon/commit/1e541c2e571c711cb18aaa18c9dfcc1056a7316d))
* preserve +/- prefix for relative adjustments in CLI arguments ([38edba4](https://github.com/portel-dev/photon/commit/38edba474f29c54fbbc3fa8c18949e6c2a06ebe4))
* properly format JSDoc constraint tags in generated documentation ([d3f07f4](https://github.com/portel-dev/photon/commit/d3f07f4012753fb2b384fa575b7959b8e2fd79fa))
* remove 'path.' prefix from MCP config default values ([2ab0d30](https://github.com/portel-dev/photon/commit/2ab0d30fa1153513a50e038945dc7855cad23505))
* remove stack traces from CLI error output ([c3bf1e2](https://github.com/portel-dev/photon/commit/c3bf1e2e5ee4e73a0eec157e7a0c927ddd1de82a))
* update tests for CLI changes ([3557c10](https://github.com/portel-dev/photon/commit/3557c10569bbef94f523cfef69bacd4553a9cbef))
* use absolute path for lg-remote credentials file ([76e2357](https://github.com/portel-dev/photon/commit/76e2357341c7e044405b0c527318150968ef9963))
* use import.meta.url instead of __dirname for ES modules ([ccabd24](https://github.com/portel-dev/photon/commit/ccabd24e13322a5f3e39ce5f761ed954aa895386))
* use PhotonLoader for CLI to share dependency cache with MCP ([f8246e3](https://github.com/portel-dev/photon/commit/f8246e3b94dcfd3e1714052dc6b480200dcd78eb))

## [Unreleased]

### Features

* **CLI Interface** - Every photon automatically becomes a CLI tool with beautiful formatted output
  - `photon cli <name>` - List all methods for a photon
  - `photon cli <name> <method> [args...]` - Call methods directly from command line
  - `--help` flag for photon-level and method-level help
  - `--json` flag for raw JSON output
  - Natural syntax with positional arguments
  - Proper exit codes (0 for success, 1 for error)

* **Format System** - Smart output formatting with 5 standard types
  - `@format primitive` - String, number, boolean values
  - `@format table` - Bordered tables for flat objects
  - `@format tree` - Hierarchical data with indentation
  - `@format list` - Bullet-pointed arrays
  - `@format none` - Void operations
  - Auto-detection when no @format tag provided

* **Beautified Output** - Professional CLI presentation
  - Unicode box-drawing characters for tables (┌─┬─┐)
  - Bullet points for lists
  - Indented trees for nested data
  - Clean, minimal output (no progress logs unless errors)

* **Stateful Daemon Architecture** - Long-running photon processes with IPC
  - Daemons automatically start when needed
  - Unix domain sockets for fast IPC
  - Shared state across multiple CLI calls
  - Daemon management commands

* **CLI Aliases** - Run photons as standalone commands (cross-platform)
  - Automatic alias creation for each photon
  - Direct invocation: `lg-remote volume 50`
  - Works on Windows, macOS, and Linux

* **Type Coercion** - Automatic argument type conversion
  - Strings → numbers/booleans based on method signature
  - Preserves +/- prefixes for relative adjustments
  - JSON parsing for complex types

### Bug Fixes

* **Exit codes** - CLI now returns proper exit codes for automation/CI/CD
* **--help flag** - Fixed to work at photon level (`photon cli <name> --help`)
* **Relative adjustments** - Preserve +/- prefix in CLI arguments (e.g., `volume +5`)
* **Error messages** - Extract and display user-friendly error messages
* **Daemon pairing** - Fixed CLI pairing flow and exit behavior
* **ES modules** - Use import.meta.url instead of __dirname

### Documentation

* **Comprehensive CLI docs** - Added CLI Interface section to README
  - Quick examples with real output
  - Format system explanation
  - CLI command reference
  - "One Codebase, Multiple Interfaces" philosophy
  - Context-aware error messages
  - Exit codes for automation
* **Updated roadmap** - Highlight MCP + CLI availability
* **Examples** - Real-world CLI usage examples

### Tests

* **CLI test suite** - 17 comprehensive tests for CLI functionality
  - Method listing and invocation
  - Format detection and rendering
  - Relative adjustments
  - Error handling and exit codes
  - Help flags
  - Type coercion
* All 106 tests passing across all suites

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
