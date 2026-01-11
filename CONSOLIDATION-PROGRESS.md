# Photon Consolidation Progress

This document tracks the progress of consolidating code between `@portel/photon` and `@portel/photon-core` to eliminate duplication and improve architecture.

## ✅ Completed

### 1. Progress Rendering Consolidation
**Commit:** `e7eda9e` - "Consolidate progress rendering to photon-core"

- **Issue:** Duplicate `ProgressRenderer` implementations in both photon and photon-core
- **Solution:** 
  - Enhanced photon-core's `ProgressRenderer` with full functionality (render, showSpinner, done, status methods)
  - Added proper TTY detection and readline-based line clearing
  - Removed duplicate from `photon/src/shared/progress-renderer.ts`
  - Updated photon runtime and CLI to import from `@portel/photon-core`
- **Impact:** Single source of truth for progress rendering, used by photon runtime, NCP, and Lumina

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

### 5. EmitStatus and EmitProgress Handling
**Current State:** Progress messages show but don't clear properly

The web.photon.ts example shows:
```
ℹ 🔍 Searching DuckDuckGo...
ℹ 📄 Parsing results...
Entry 1
...
```

**Expected Behavior:**
- Progress messages should appear ephemerally (spinner animation)
- They should clear automatically when done
- Only final results should remain

**Root Cause:**
The loader's `createOutputHandler` correctly handles EmitStatus/EmitProgress, but there may be issues with:
1. When progress is cleared (timing)
2. How generators vs. plain async functions are handled
3. Whether the progress renderer is being shared correctly

**Next Steps:**
1. Test the actual CLI behavior with web search
2. Debug why progress messages persist
3. Ensure progress clears before final output

## 📋 Pending Tasks

### 6. Architecture Review
- [ ] Review all shared utilities in photon/src/shared/
- [ ] Identify candidates for moving to photon-core
- [ ] Ensure clean separation: core = runtime-agnostic, photon = MCP+CLI runtime

### 7. Elicitation and Input Handling
- [ ] Review elicitation patterns across projects
- [ ] Ensure consistent ask/emit pattern usage
- [ ] Document best practices for interactive photons

### 8. Error Handling Standardization
- [ ] Review error handling patterns
- [ ] Ensure consistent error messages and hints
- [ ] Add validation utilities to core if needed

### 9. Documentation Updates
- [ ] Update architecture documentation
- [ ] Document the core vs runtime separation
- [ ] Add migration guide for photon authors

### 10. Testing
- [ ] Add tests for progress rendering
- [ ] Test ephemeral progress behavior
- [ ] Ensure all edge cases are covered

## 🎯 Next Immediate Action

**Test and fix ephemeral progress rendering:**
1. Run `photon cli web search "test query"` to see actual behavior
2. Debug why progress messages aren't clearing
3. Ensure EmitStatus yields show spinner and auto-clear
4. Ensure EmitProgress yields show progress bar and clear at 100%

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
