# Changelog

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
