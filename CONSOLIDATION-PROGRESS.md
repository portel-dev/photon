# Photon Consolidation Progress

This document tracks the progress of consolidating code between `@portel/photon` and `@portel/photon-core` to eliminate duplication and improve architecture.

## ✅ Completed

### 1. Progress Rendering Consolidation  
**Commits:** `e7eda9e`, `a7a81db`

- **Issue:** Duplicate `ProgressRenderer` implementations in both photon and photon-core
- **Solution:** 
  - Enhanced photon-core's `ProgressRenderer` with full functionality (render, showSpinner, done, status methods)
  - Added proper TTY detection and readline-based line clearing
  - Removed duplicate from `photon/src/shared/progress-renderer.ts`
  - Updated photon runtime and CLI to import from `@portel/photon-core`
  - Fixed EmitStatus handling to use `startSpinner()` for auto-animation
  - Updates messages when spinner is already active for smooth transitions
- **Impact:** Single source of truth for progress rendering, used by photon runtime, NCP, and Lumina
- **Status:** ✅ Complete - all tests pass, progress rendering works correctly in TTY mode

### 2. CLI Formatter (Already Done)
- CLI formatting utilities already consolidated in photon-core
- Photon runtime re-exports from core

### 3. Path Resolver (Already Done)
- Path resolution utilities already in photon-core
- Photon runtime uses it correctly

### 4. MCP Client (Already Done)
- MCP client interfaces and SDK transport in photon-core
- Photon runtime re-exports with backward compatibility aliases

## 🔄 In Progress

None currently - consolidation phase 1 complete!

## 📋 Pending Tasks

### 5. Additional Shared Utilities Review
- [ ] Review all shared utilities in photon/src/shared/
- [ ] Identify candidates for moving to photon-core
- [ ] Ensure clean separation: core = runtime-agnostic, photon = MCP+CLI runtime

### 6. Elicitation and Input Handling
- [ ] Review elicitation patterns across projects
- [ ] Ensure consistent ask/emit pattern usage
- [ ] Document best practices for interactive photons

### 7. Error Handling Standardization
- [ ] Review error handling patterns
- [ ] Ensure consistent error messages and hints
- [ ] Add validation utilities to core if needed

### 8. Documentation Updates
- [ ] Update architecture documentation
- [ ] Document the core vs runtime separation
- [ ] Add migration guide for photon authors

### 9. Testing
- [ ] Add tests for progress rendering
- [ ] Test ephemeral progress behavior
- [ ] Ensure all edge cases are covered

## 🎯 Next Steps

The consolidation work is complete! Progress rendering is now unified across all Photon-based projects. Future work can focus on:

1. **Reviewing other shared utilities** - Look for more opportunities to consolidate
2. **Improving documentation** - Document the core vs runtime architecture clearly
3. **Enhancing DX** - Make it easier for contributors to know where code belongs

## Architecture Principles

### Photon Core (`@portel/photon-core`)
**Purpose:** Runtime-agnostic foundation for building custom photon runtimes

**Contains:**
- Base `PhotonMCP` class with lifecycle hooks
- Schema extraction and dependency management
- Generator utilities (ask/emit pattern)
- Progress rendering (ephemeral spinners/bars)
- CLI formatting utilities
- Path resolution
- MCP client interfaces and SDK transport
- Elicitation (cross-platform user input)
- Stateful workflow execution

**Does NOT contain:**
- MCP server implementation
- CLI command handlers
- Daemon/process management
- Marketplace integration

### Photon Runtime (`@portel/photon`)
**Purpose:** Complete MCP server + CLI tool runtime

**Contains:**
- `PhotonLoader` - loads and manages .photon.ts files
- `PhotonServer` - MCP server implementation
- CLI commands (maker, info, marketplace, etc.)
- Daemon management for stateful photons
- Marketplace integration
- Template management
- Version checking

**Re-exports:** Everything from `@portel/photon-core` for convenience

### Other Runtimes (NCP, Lumina, etc.)
These projects depend on `@portel/photon-core` and implement their own:
- Server/orchestration logic
- Protocol support (REST, GraphQL, RPC, etc.)
- Runtime-specific features

## Benefits of Consolidation

1. **Single Source of Truth:** No duplicate implementations to keep in sync
2. **Easier Maintenance:** Fix bugs once, benefit everywhere
3. **Better Testing:** Test shared code once comprehensively
4. **Cleaner Architecture:** Clear separation of concerns
5. **Easier Contribution:** Contributors know where code belongs
6. **Smaller Bundle Sizes:** No duplicate code in final packages
