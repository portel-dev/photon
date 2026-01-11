# Photon Architecture Audit

## Overview

This document analyzes the current architecture of the Photon ecosystem, identifies issues, and proposes improvements.

## Ecosystem Structure

```
@portel/photon-core (foundation)
  ├── Used by: @portel/photon (this repo)
  ├── Used by: @portel/ncp (MCP hub)
  └── Used by: @portel/lumina (API server)
```

### Current photon-core (v1.4.0)

**Purpose**: Runtime-agnostic foundation for building custom Photon runtimes

**Core Modules**:
- `base.ts` - Base photon class
- `context.ts` - Execution context
- `dependency-manager.ts` - NPM dependency management
- `elicit.ts` - Cross-platform user input
- `generator.ts` - Generator function utilities
- `progress.ts` - Progress indicators (spinners, bars)
- `schema-extractor.ts` - Extract schemas from TypeScript
- `cli-formatter.ts` - Output formatting
- `stateful.ts` - Stateful photon support
- `types.ts` - Shared types
- `photon-config.ts` - Configuration
- `path-resolver.ts` - Path utilities
- `mcp-client.ts` - MCP client
- `mcp-sdk-transport.ts` - MCP transport

### Current photon (v1.4.1)

**Purpose**: Photon runtime - loads and executes .photon.ts files

**Runtime Modules**:
- `loader.ts` - Load and execute .photon.ts files
- `server.ts` - MCP server implementation
- `cli.ts` - CLI interface
- `photon-cli-runner.ts` - CLI execution
- `marketplace-manager.ts` - Photon marketplace
- `version-checker.ts` - Version management
- `watcher.ts` - File watching
- `security-scanner.ts` - Security scanning

**Re-exports from core**:
- ✅ `cli-formatter.ts` - Correctly re-exports from core

**Duplicate/Problematic**:
- ❌ `shared/progress-renderer.ts` - Duplicates core's `progress.ts`
- ❌ Some utilities might belong in core

---

## Issues Identified

### 1. Code Duplication

**Problem**: `photon/src/shared/progress-renderer.ts` duplicates `photon-core/src/progress.ts`

**Evidence**:
- Both implement `ProgressRenderer` class
- Both have spinner/progress bar functionality
- photon-core version is more complete (has `startSpinner`, `updateMessage`, etc.)
- photon version is simpler but less feature-complete

**Impact**:
- Maintenance burden (fix bugs in two places)
- Inconsistency between implementations
- Violates DRY principle

**Solution**:
1. Delete `photon/src/shared/progress-renderer.ts`
2. Import from `@portel/photon-core` instead
3. Update all references

### 2. Inconsistent Imports

**Problem**: Some files import from local `shared/` folder instead of core

**Files to check**:
```bash
grep -r "from.*shared/progress" src/
grep -r "from.*\./.*progress" src/
```

**Solution**: Standardize all imports to use `@portel/photon-core`

### 3. Unclear Module Boundaries

**Question**: What belongs in core vs runtime?

**Guideline**:
- **Core**: Used by .photon.ts files OR multiple runtimes (photon, ncp, lumina)
- **Runtime**: Specific to photon runtime (loading, watching, CLI, marketplace)

**Review needed**:
- [ ] Is `cli-formatter` used by .photon.ts files? → If yes, stays in core ✓
- [ ] Is `progress` used by .photon.ts files? → If yes, stays in core ✓
- [ ] Is `elicit` used by .photon.ts files? → If yes, stays in core ✓
- [ ] Should runtime-specific CLI utilities be in core? → No

### 4. Progress API Design

**Current in photon-core/progress.ts**:
```typescript
export class ProgressRenderer {
  startSpinner(message: string): void
  showProgress(value: number, message?: string): void
  updateMessage(message: string): void
  stop(): void
  get active(): boolean
}

// Global helpers
export function startSpinner(message: string): void
export function showProgress(value: number, message?: string): void
export function updateProgressMessage(message: string): void
export function stopProgress(): void
export function isProgressActive(): boolean
```

**Current in photon/progress-renderer.ts**:
```typescript
export class ProgressRenderer {
  showSpinner(message: string): void
  startSpinner(message: string): void
  stopSpinner(): void
  render(value: number, message?: string): void
  clearLine(): void
  done(): void
  status(message: string): void
  get active(): boolean
}
```

**Issues**:
- Different method names (`showProgress` vs `render`, `stop` vs `done`)
- photon version has `status()` method (useful!)
- photon version has `clearLine()` (internal detail)
- No consistent pattern

**Proposed unified API** (for core):
```typescript
export class ProgressRenderer {
  // Indeterminate progress (spinner)
  startSpinner(message: string): void
  updateSpinner(message: string): void
  stopSpinner(): void
  
  // Determinate progress (0-1)
  showProgress(value: number, message?: string): void
  
  // Control
  clear(): void
  done(): void
  
  // Status
  get active(): boolean
  
  // Persistent messages (clears progress, prints to stderr)
  status(message: string): void
}

// Global singleton helpers
export function startSpinner(message: string): void
export function updateSpinner(message: string): void
export function showProgress(value: number, message?: string): void
export function clearProgress(): void
export function stopProgress(): void
export function progressStatus(message: string): void
export function isProgressActive(): boolean
```

### 5. Generator Progress Pattern

**Use case**: `.photon.ts` files yield progress updates

**Current pattern** (should be in core):
```typescript
async function* myTool() {
  yield { type: 'status', message: 'Starting...' };
  // do work
  yield { type: 'progress', value: 0.5, message: 'Halfway...' };
  // more work
  yield { type: 'data', value: result };
}
```

**Runtime responsibility** (photon, ncp, lumina):
- Subscribe to generator
- Render progress based on `type`
- Clear progress when done
- Show final result

**Should be in core**:
- Generator types (`ProgressUpdate`, `StatusUpdate`, etc.)
- Helper to create progress updates
- Documentation on the pattern

**Should be in runtime**:
- Actual rendering (CLI uses ProgressRenderer, Web UI uses different renderer)

---

## Recommended Actions

### Phase 1: Eliminate Duplication (Immediate)

1. **Delete duplicate progress renderer**
   ```bash
   rm src/shared/progress-renderer.ts
   ```

2. **Update imports**
   ```typescript
   // Before
   import { ProgressRenderer } from './shared/progress-renderer.js';
   
   // After
   import { ProgressRenderer, startSpinner, stopProgress } from '@portel/photon-core';
   ```

3. **Verify photon-core exports**
   Check `photon-core/src/index.ts` exports:
   ```typescript
   export { 
     ProgressRenderer,
     startSpinner,
     showProgress,
     updateProgressMessage,
     stopProgress,
     isProgressActive
   } from './progress.js';
   ```

### Phase 2: Unify Progress API (Near-term)

1. **Add `status()` method to core's ProgressRenderer**
   - Port from photon's version
   - Clears progress, prints persistent message

2. **Standardize method names**
   - Use consistent naming across all projects
   - Document the API clearly

3. **Add generator progress types to core**
   ```typescript
   // In core/types.ts
   export type ProgressUpdate = 
     | { type: 'status'; message: string }
     | { type: 'progress'; value: number; message?: string }
     | { type: 'data'; value: any; format?: OutputFormat };
   ```

### Phase 3: Document Architecture (Ongoing)

1. **Update core README**
   - Explain what belongs in core
   - Document progress rendering pattern
   - Show generator + progress example

2. **Update photon README**
   - Link to core documentation
   - Explain runtime vs core separation
   - Migration guide for .photon.ts authors

3. **Create ARCHITECTURE.md** in both repos
   - Design principles
   - Module boundaries
   - Extension points

### Phase 4: Audit Other Modules

**Questions to answer**:

1. **CLI Runner**
   - Is `photon-cli-runner.ts` runtime-specific? → Yes, stays in photon
   - Should it use more utilities from core? → Review

2. **Path Resolution**
   - Both have `path-resolver.ts` - are they different? → Check
   - If same, consolidate to core

3. **MCP Client**
   - Core has `mcp-client.ts` and `mcp-sdk-transport.ts`
   - Are these used by .photon.ts files? → If no, might move to runtime
   - But: NCP might need them → Stays in core

4. **Formatting**
   - `cli-formatter` in core is correct (used by .photon.ts)
   - `formatOutput()` allows .photon.ts to format responses
   - Runtime renders format hints appropriately

---

## Design Principles (Going Forward)

### 1. Core is Runtime-Agnostic

**Core provides**:
- Types and interfaces
- Utilities usable from .photon.ts files
- Shared logic used by multiple runtimes

**Core does NOT provide**:
- CLI commands
- Server implementations
- Build/deployment tools

### 2. Runtime is Specific

**Runtime provides**:
- CLI interface (photon cli)
- MCP server (photon mcp)
- File watching, hot reload
- Marketplace, version checking
- Security scanning

### 3. Clear Extension Points

**.photon.ts files can**:
- Call `prompt()` / `elicit()` for user input (core)
- Yield progress updates (core types)
- Return format hints (core types)
- Use `formatOutput()` helper (core)

**Runtimes must**:
- Implement progress rendering (using core's ProgressRenderer)
- Handle generator progress updates
- Respect format hints

### 4. DRY - Don't Repeat Yourself

**If code is in both**:
1. Determine which project owns it (core vs runtime)
2. Delete from one, import from other
3. Add tests to prevent regression

**If unsure**:
- Ask: "Will multiple runtimes (photon, ncp, lumina) need this?"
- If yes → core
- If no → runtime

---

## Testing Strategy

### Core Tests
- [ ] Progress rendering (spinners, bars)
- [ ] Elicitation (readline, native dialogs)
- [ ] Generator utilities
- [ ] Schema extraction
- [ ] Dependency management
- [ ] CLI formatting

### Runtime Tests
- [ ] Loader (load .photon.ts files)
- [ ] Server (MCP protocol)
- [ ] CLI (commands, args)
- [ ] Marketplace (list, install)
- [ ] Watcher (hot reload)
- [ ] Integration (end-to-end)

### Cross-cutting Tests
- [ ] Ensure no duplicate code between repos
- [ ] Verify correct imports (core vs runtime)
- [ ] Test generator + progress pattern
- [ ] Verify format hints work in CLI and MCP

---

## Migration Checklist

### For photon repo:
- [ ] Delete `src/shared/progress-renderer.ts`
- [ ] Update imports to use `@portel/photon-core`
- [ ] Add any missing methods to core's ProgressRenderer (like `status()`)
- [ ] Verify all tests pass
- [ ] Update documentation

### For photon-core repo:
- [ ] Add `status()` method to ProgressRenderer
- [ ] Export all progress utilities from `index.ts`
- [ ] Add generator progress types to `types.ts`
- [ ] Document progress rendering pattern in README
- [ ] Version bump and publish

### For dependent projects (ncp, lumina):
- [ ] Update to latest photon-core
- [ ] Verify progress rendering works
- [ ] Test generator + progress pattern
- [ ] Update any custom progress code

---

## Open Questions

1. **Generator Progress Types**
   - Should `ProgressUpdate` be in core's `types.ts`?
   - How do we version this interface?

2. **Web UI Progress**
   - Should core provide a `WebProgressRenderer` for Lumina?
   - Or is that too UI-specific?

3. **MCP Elicitation**
   - Does MCP protocol support progress updates?
   - If yes, should core know about it?

4. **Error Handling**
   - Should progress errors (timeout, cancel) be in core?
   - How do runtimes handle failed elicitation?

---

## Summary

The Photon ecosystem has good separation between core and runtime, but has some duplication and inconsistencies. By eliminating duplicate code, unifying APIs, and documenting architecture, we can make the codebase more maintainable and easier to extend.

**Priority**:
1. **High**: Delete duplicate progress-renderer (blocks development)
2. **Medium**: Unify progress API (improves UX)
3. **Medium**: Document architecture (helps contributors)
4. **Low**: Audit other modules (continuous improvement)

**Next Steps**:
1. Review this document
2. Get consensus on proposed changes
3. Execute Phase 1 (eliminate duplication)
4. Update photon-core and republish
5. Update photon runtime
6. Update dependent projects
