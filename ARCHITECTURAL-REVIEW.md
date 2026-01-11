# Photon Architecture Review & Improvement Plan

**Date:** January 11, 2026  
**Scope:** Comprehensive review of Photon Runtime and Photon Core architecture  
**Goal:** Identify design issues, code quality problems, and propose elegant, extensible solutions

---

## Executive Summary

After reviewing the Photon ecosystem (photon-core and photon runtime), I've identified **critical architectural decisions** that need reconsideration. While the project has a solid foundation, several areas lack elegance, extensibility, and proper separation of concerns.

### Key Findings

✅ **What's Working Well:**
- Single-file `.photon.ts` concept is brilliant
- Generator-based ask/emit pattern is elegant
- Stateful workflow with checkpoints is innovative
- Clear separation between core (parser/loader) and runtime (MCP/CLI)

❌ **Critical Issues:**
- Progress reporting is duplicated across layers
- Logger is runtime-specific (should be in core)
- Dependency management lacks progress hooks
- CLI-specific code polluting core concerns
- Error handling inconsistency
- No clear extension points for new runtimes

---

## 1. Progress Reporting Architecture

### Current State: FRAGMENTED

**Problems:**
1. **`progress-renderer.ts`** in photon runtime - CLI-specific implementation
2. **`progress.ts`** in photon-core - but underutilized
3. **No unified progress interface** - each consumer reinvents the wheel
4. **Dependency manager doesn't emit progress** - users see nothing during npm install

### The Right Way: Event-Driven Progress from Core

```
┌─────────────────────────────────────────────────────────────┐
│ photon-core: Progress Event Emitter (runtime-agnostic)     │
├─────────────────────────────────────────────────────────────┤
│ - ProgressEmitter base class                                │
│ - Emits: 'progress' | 'status' | 'spinner' events           │
│ - Used by: DependencyManager, SchemaExtractor, Loader       │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ photon runtime: Progress Renderer (CLI-specific)            │
├─────────────────────────────────────────────────────────────┤
│ - Subscribes to core events                                 │
│ - Renders spinners, bars, ephemeral output                  │
│ - Clears on completion                                      │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ NCP/Lumina: Custom Progress Handlers                        │
├─────────────────────────────────────────────────────────────┤
│ - Subscribe to same events                                  │
│ - Render in web UI, send to clients, etc.                  │
└─────────────────────────────────────────────────────────────┘
```

**Proposed Refactor:**

1. **Move to photon-core:** Event-based progress emitter
   ```typescript
   // photon-core/src/progress.ts
   export class ProgressEmitter extends EventEmitter {
     emitProgress(value: number, message?: string): void;
     emitStatus(message: string): void;
     emitSpinner(message: string): void;
     complete(): void;
   }
   ```

2. **Update DependencyManager** to emit progress:
   ```typescript
   class DependencyManager extends ProgressEmitter {
     async ensureDependencies(name: string, deps: DependencySpec[]): Promise<string> {
       this.emitSpinner('Checking dependencies...');
       // check installed
       
       this.emitStatus('Installing axios@^1.0.0...');
       this.emitProgress(0.3);
       // install
       
       this.emitProgress(1.0, 'Dependencies installed');
       this.complete();
     }
   }
   ```

3. **Photon runtime subscribes:**
   ```typescript
   // photon/src/loader.ts
   const depManager = new DependencyManager();
   depManager.on('spinner', (msg) => this.progressRenderer.startSpinner(msg));
   depManager.on('progress', (val, msg) => this.progressRenderer.showProgress(val, msg));
   depManager.on('complete', () => this.progressRenderer.stop());
   ```

4. **NCP/Lumina can do the same:**
   ```typescript
   // ncp/orchestrator.ts
   depManager.on('status', (msg) => this.sendToWebUI({ type: 'progress', msg }));
   ```

---

## 2. Logging Architecture

### Current State: SPLIT INCORRECTLY

**Problems:**
1. **Logger in photon runtime** (`shared/logger.ts`) - but core needs logging too!
2. **photon-core uses `console.log`** - inconsistent, no control
3. **No structured logging** - can't send logs to external systems

### The Right Way: Core Logger with Runtime Adapters

```
┌─────────────────────────────────────────────────────────────┐
│ photon-core: Abstract Logger Interface                      │
├─────────────────────────────────────────────────────────────┤
│ interface Logger {                                           │
│   debug(msg: string, meta?: object): void;                  │
│   info(msg: string, meta?: object): void;                   │
│   warn(msg: string, meta?: object): void;                   │
│   error(msg: string, meta?: object): void;                  │
│ }                                                            │
│                                                              │
│ class ConsoleLogger implements Logger { ... }               │
└─────────────────────────────────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ photon runtime: CLI Logger (with colors, formatting)        │
│ NCP: Structured Logger (JSON output)                        │
│ Lumina: HTTP Logger (send to observability)                 │
└─────────────────────────────────────────────────────────────┘
```

**Proposed Refactor:**

1. **Move logger interface to photon-core:**
   ```typescript
   // photon-core/src/logger.ts
   export interface Logger {
     debug(message: string, meta?: Record<string, any>): void;
     info(message: string, meta?: Record<string, any>): void;
     warn(message: string, meta?: Record<string, any>): void;
     error(message: string, meta?: Record<string, any>): void;
   }
   
   export class ConsoleLogger implements Logger {
     // Simple console implementation
   }
   ```

2. **DependencyManager, SchemaExtractor accept logger:**
   ```typescript
   class DependencyManager {
     constructor(private logger: Logger = new ConsoleLogger()) {}
   }
   ```

3. **Photon runtime provides fancy logger:**
   ```typescript
   // photon/src/shared/logger.ts
   export class CLILogger implements Logger {
     // Colorful, formatted output with emoji
   }
   ```

---

## 3. Dependency Management Visibility

### Current State: BLACK BOX

**Problem:** `npm install` can take 10-30 seconds, users see nothing.

**Solution:** Progress events + streaming npm output

```typescript
class DependencyManager extends ProgressEmitter {
  async ensureDependencies(name: string, deps: DependencySpec[]): Promise<string> {
    if (deps.length === 0) return null;
    
    this.emitStatus('Checking dependencies...');
    const installed = await this.checkInstalled(mcpDir, deps);
    if (installed) {
      this.emitStatus('Dependencies already installed');
      this.complete();
      return nodeModules;
    }
    
    this.emitSpinner('Installing dependencies...');
    
    // Stream npm output
    const npm = spawn('npm', ['install', ...deps.map(d => `${d.name}@${d.version}`)]);
    npm.stdout.on('data', (data) => {
      const line = data.toString().trim();
      if (line.includes('added')) {
        this.emitStatus(`Installed ${line.match(/added \d+/)?.[0]}`);
      }
    });
    
    await new Promise((resolve, reject) => {
      npm.on('close', (code) => code === 0 ? resolve(null) : reject());
    });
    
    this.emitProgress(1.0, 'Dependencies installed');
    this.complete();
  }
}
```

---

## 4. CLI Output Clarity

### Current State: CONFUSING

**Problems from user feedback:**
```
ℹ 🔍 Searching DuckDuckGo...
ℹ 📄 Parsing results...
Entry 1
...
```

- Progress messages stay visible after completion
- User has to mentally filter what's done vs. what matters
- Not how professional CLIs work (npm, yarn, pnpm all clear progress)

### The Right Way: Ephemeral Progress

**Before (current):**
```
ℹ 🔍 Searching DuckDuckGo...
ℹ 📄 Parsing results...
Entry 1: GitHub - portel-dev/ncp...
```

**After (proposed):**
```
⠋ Searching DuckDuckGo...          # Spinner while searching
⠙ Parsing results...                # Spinner while parsing
Entry 1: GitHub - portel-dev/ncp...  # Progress cleared, only result visible
```

**Implementation:**
- Use `ProgressRenderer` for ALL temporary status
- Only print final results with `console.log`
- Progress messages should be ephemeral (cleared on completion)

---

## 5. Code Organization & Duplication

### Current State: OVERLAPPING CONCERNS

**Issues:**

| Feature | photon-core | photon runtime | Issue |
|---------|-------------|----------------|-------|
| Progress | `progress.ts` (unused) | `progress-renderer.ts` | Duplication |
| Logger | ❌ Uses console | `shared/logger.ts` | Missing in core |
| CLI Formatter | `cli-formatter.ts` | `cli-formatter.ts` | DUPLICATED! |
| Path Resolution | `path-resolver.ts` | `path-resolver.ts` | DUPLICATED! |

**Why This Happened:**
- photon started as monolith, then core extracted
- Incomplete refactor left duplicate code
- No clear "what belongs where" guidelines

### The Right Way: Clear Boundaries

**photon-core (runtime-agnostic):**
```
src/
├── base.ts              # PhotonMCP base class
├── types.ts             # All type definitions
├── schema-extractor.ts  # TypeScript parsing
├── dependency-manager.ts # npm dependency handling
├── generator.ts         # Ask/emit pattern
├── stateful.ts          # Checkpoint/resume
├── mcp-client.ts        # MCP SDK wrapper
├── mcp-sdk-transport.ts # MCP transports
├── photon-config.ts     # Config loading
├── context.ts           # Execution context
├── logger.ts            # ✅ NEW: Logger interface
├── progress.ts          # ✅ ENHANCED: Progress emitter
└── index.ts             # Public exports
```

**photon runtime (CLI/MCP specific):**
```
src/
├── cli.ts               # CLI entry point
├── server.ts            # MCP server
├── loader.ts            # Photon loader (uses core)
├── watcher.ts           # File watching
├── marketplace-manager.ts # Marketplace integration
├── shared/
│   ├── logger.ts        # ✅ CLI logger (implements core interface)
│   ├── progress-renderer.ts # ✅ Terminal rendering
│   ├── cli-sections.ts  # CLI formatting
│   ├── error-handler.ts # Error display
│   └── validation.ts    # Input validation
└── ...
```

**Deduplication Plan:**
1. Remove `cli-formatter.ts` from photon-core (move to runtime)
2. Remove `path-resolver.ts` from runtime (use core's version)
3. Move logger interface to core
4. Enhance progress emitter in core

---

## 6. Error Handling Consistency

### Current State: MIXED APPROACHES

**Problems:**
- Some places throw errors directly
- Some use `getErrorMessage()` helper
- Some log errors, some don't
- No structured error types

### The Right Way: Error Classes + Consistent Handling

```typescript
// photon-core/src/errors.ts
export class PhotonError extends Error {
  constructor(message: string, public code: string, public meta?: any) {
    super(message);
    this.name = 'PhotonError';
  }
}

export class PhotonConfigError extends PhotonError {
  constructor(message: string, meta?: any) {
    super(message, 'CONFIG_ERROR', meta);
  }
}

export class PhotonLoadError extends PhotonError {
  constructor(message: string, meta?: any) {
    super(message, 'LOAD_ERROR', meta);
  }
}

export class PhotonDependencyError extends PhotonError {
  constructor(message: string, meta?: any) {
    super(message, 'DEPENDENCY_ERROR', meta);
  }
}
```

**Usage:**
```typescript
// In core code
if (!fs.existsSync(photonPath)) {
  throw new PhotonLoadError(`Photon not found: ${photonPath}`);
}

// In runtime code
try {
  await loader.load(photonPath);
} catch (error) {
  if (error instanceof PhotonLoadError) {
    logger.error(`Failed to load photon: ${error.message}`);
    // Show helpful suggestion
  } else {
    logger.error(`Unexpected error: ${error.message}`);
  }
}
```

---

## 7. Extension Points for New Runtimes

### Current State: UNCLEAR HOW TO BUILD NEW RUNTIMES

**Problem:** NCP and Lumina teams will struggle to figure out:
- What to import from core?
- How to handle progress?
- How to wire up logging?
- How to implement custom transports?

### The Right Way: Clear Runtime Template

```typescript
// Example: Building a new runtime
import {
  PhotonMCP,
  DependencyManager,
  SchemaExtractor,
  ProgressEmitter,
  Logger,
  ConsoleLogger,
} from '@portel/photon-core';

class MyCustomRuntime {
  private depManager: DependencyManager;
  private logger: Logger;
  
  constructor(options: RuntimeOptions) {
    // 1. Setup logger (or use default)
    this.logger = options.logger ?? new ConsoleLogger();
    
    // 2. Setup dependency manager
    this.depManager = new DependencyManager(this.logger);
    
    // 3. Subscribe to progress events
    this.depManager.on('spinner', (msg) => this.handleSpinner(msg));
    this.depManager.on('progress', (val, msg) => this.handleProgress(val, msg));
    this.depManager.on('complete', () => this.handleComplete());
  }
  
  async loadPhoton(path: string): Promise<any> {
    // 4. Extract dependencies
    const deps = await this.depManager.extractDependencies(path);
    
    // 5. Install dependencies (progress events fire automatically)
    await this.depManager.ensureDependencies('my-photon', deps);
    
    // 6. Load the photon
    const PhotonClass = (await import(path)).default;
    const instance = new PhotonClass();
    await instance.onInitialize?.();
    
    return instance;
  }
  
  // Implement these based on your runtime's needs
  private handleSpinner(message: string): void {
    // For web UI: send WebSocket message
    // For CLI: render spinner
    // For logs: just log
  }
  
  private handleProgress(value: number, message?: string): void {
    // Similar - adapt to your runtime
  }
  
  private handleComplete(): void {
    // Clear progress indicators
  }
}
```

**Documentation Needed:**
- "Building Custom Runtimes" guide in photon-core README
- Template repository: `photon-runtime-template`
- Examples: REST API server, GraphQL server, gRPC server

---

## 8. Testing Strategy

### Current State: GOOD COVERAGE, BUT...

**Problems:**
- Tests for progress rendering are hard (terminal output)
- Tests for dependency installation are slow (real npm)
- No integration tests across photon-core + photon runtime

### Improvements:

1. **Mock progress events in tests:**
   ```typescript
   test('DependencyManager emits progress', async () => {
     const depManager = new DependencyManager();
     const events: string[] = [];
     
     depManager.on('spinner', (msg) => events.push(`spinner: ${msg}`));
     depManager.on('complete', () => events.push('complete'));
     
     await depManager.ensureDependencies('test', [{ name: 'axios', version: '^1.0.0' }]);
     
     expect(events).toContain('spinner: Installing dependencies...');
     expect(events).toContain('complete');
   });
   ```

2. **Mock npm install in tests:**
   ```typescript
   // Use dependency injection for spawn
   class DependencyManager {
     constructor(
       private logger: Logger = new ConsoleLogger(),
       private spawner: Spawner = childProcess.spawn
     ) {}
   }
   
   // In tests
   const mockSpawner = (cmd: string, args: string[]) => mockChildProcess;
   const depManager = new DependencyManager(logger, mockSpawner);
   ```

3. **Integration tests:**
   ```typescript
   test('Full workflow: load photon → install deps → execute tool', async () => {
     // Test the entire stack
   });
   ```

---

## 9. Type Safety Improvements

### Current Issues:

1. **`any` types scattered everywhere:**
   ```typescript
   instance: any;  // In PhotonMCPClass
   value: any;     // In state logs
   ```

2. **No runtime validation:**
   - User passes wrong param type → error at execution
   - Should validate against inputSchema

3. **Weak inference:**
   - Can't infer tool return types
   - Can't type-check ask/emit yields

### Improvements:

1. **Generic PhotonMCPClass:**
   ```typescript
   export interface PhotonMCPClass<T = any> {
     name: string;
     description?: string;
     tools: PhotonTool[];
     instance: T;
   }
   ```

2. **Runtime validation using inputSchema:**
   ```typescript
   async executeTool(name: string, params: Record<string, any>): Promise<any> {
     const tool = this.tools.find(t => t.name === name);
     if (!tool) throw new PhotonError(`Tool not found: ${name}`);
     
     // Validate params against inputSchema
     const errors = validateAgainstSchema(params, tool.inputSchema);
     if (errors.length > 0) {
       throw new PhotonValidationError(`Invalid params: ${errors.join(', ')}`);
     }
     
     return await this.instance[name](params);
   }
   ```

3. **Typed generators:**
   ```typescript
   type PhotonGenerator<T> = AsyncGenerator<PhotonYield, T, any>;
   
   async function* myTool(): PhotonGenerator<{ success: boolean }> {
     const confirmed = yield { ask: 'confirm', message: 'Continue?' };
     return { success: confirmed };
   }
   ```

---

## 10. Configuration Management

### Current Issues:

1. **Config files scattered:**
   - `~/.photon/mcp-servers.json`
   - `~/.cache/photon-mcp/dependencies/`
   - `PHOTON_MCP_CONFIG` env var
   - `./photon.mcp.json` (local override)

2. **No single source of truth**

3. **Hard to debug config issues**

### Improvement: Unified Config System

```typescript
// photon-core/src/config.ts
export interface PhotonConfig {
  // Paths
  cacheDir: string;        // ~/.cache/photon-mcp
  configDir: string;       // ~/.photon
  dataDir: string;         // ~/.photon/data
  
  // MCP Servers
  mcpServers: Record<string, MCPServerConfig>;
  
  // Marketplace
  marketplaces: Marketplace[];
  
  // Behavior
  autoInstall: boolean;    // Auto-install dependencies
  verbose: boolean;        // Verbose logging
  offline: boolean;        // Offline mode
}

export async function loadPhotonConfig(): Promise<PhotonConfig> {
  // 1. Load defaults
  // 2. Merge ~/.photon/config.json
  // 3. Merge ./photon.config.json (local override)
  // 4. Merge env vars
  // 5. Validate and return
}
```

**Validation:**
```bash
photon config validate   # Check config validity
photon config show       # Display merged config
photon config path       # Show config file locations
```

---

## Summary: Prioritized Action Items

### P0 (Critical - Do Now):
1. ✅ **Move progress to event-driven architecture**
   - Refactor `DependencyManager` to emit events
   - Update runtime to subscribe
   - Remove hardcoded console logs

2. ✅ **Fix CLI output clarity**
   - Make all progress messages ephemeral
   - Clear spinners/bars on completion
   - Only show final results

3. ✅ **Deduplicate code**
   - Remove duplicate `cli-formatter.ts` from core
   - Remove duplicate `path-resolver.ts` from runtime
   - Consolidate into one location

### P1 (High - Do This Week):
4. ⚠️ **Move logger interface to core**
   - Define `Logger` interface in photon-core
   - Update `DependencyManager`, `SchemaExtractor` to accept logger
   - Implement CLI logger in runtime

5. ⚠️ **Structured error types**
   - Create `PhotonError` hierarchy
   - Update all error throwing/catching
   - Add error codes for programmatic handling

6. ⚠️ **Add progress to dependency installation**
   - Stream npm output
   - Show which package is being installed
   - Display progress bar for multi-package installs

### P2 (Medium - Do This Month):
7. 📝 **Runtime extension guide**
   - Document how to build custom runtimes
   - Create template repository
   - Add examples (REST, GraphQL, gRPC)

8. 📝 **Type safety improvements**
   - Add generics to `PhotonMCPClass`
   - Runtime schema validation
   - Typed generator returns

9. 📝 **Unified config system**
   - Consolidate config loading
   - Add validation commands
   - Better error messages for misconfig

### P3 (Nice to Have):
10. 🎯 **Performance monitoring**
    - Add timing to dependency install
    - Track photon load time
    - Report slow operations

11. 🎯 **Better testing infrastructure**
    - Mock npm install
    - Integration test suite
    - Performance benchmarks

---

## Conclusion

The Photon architecture is **fundamentally sound**, but needs **refinement** in these areas:

1. **Separation of concerns:** Core should be truly runtime-agnostic
2. **Progress visibility:** Users should see what's happening
3. **Extensibility:** New runtimes (NCP, Lumina) should be easy to build
4. **Code quality:** Eliminate duplication, improve types, consistent errors

The proposed changes will make Photon:
- ✅ **More professional** - CLI output like npm/yarn
- ✅ **More extensible** - Clear extension points for new runtimes
- ✅ **More maintainable** - Less duplication, better structure
- ✅ **More robust** - Proper error handling, validation, logging

**Next Steps:**
1. Review this document with team
2. Prioritize which items to tackle first
3. Create issues/tasks for each improvement
4. Start with P0 items (progress + CLI clarity)

