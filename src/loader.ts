/**
 * Photon MCP Loader
 *
 * Loads a single .photon.ts file and extracts tools
 */

import * as fs from 'fs/promises';
import { realpathSync, existsSync, mkdirSync, symlinkSync, readFileSync, type Dirent } from 'fs';
import { readText, readJSON, writeText, writeJSON } from './shared/io.js';
import type {
  PhotonInstance,
  EventListenerEntry,
  EventFilter,
  ChannelMessage,
  ReactiveCollectionLike,
} from './types/photon-instance.js';
import { createRequire } from 'module';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as crypto from 'crypto';
import { startToolSpan } from './telemetry/otel.js';
import { spawn } from 'child_process';
import {
  SchemaExtractor,
  DependencyManager,
  ConstructorParam,
  PhotonClass,
  PhotonClassExtended,
  PhotonTool,
  TemplateInfo,
  StaticInfo,
  // Asset types (MCP Apps support)
  type PhotonAssets,
  // Generator utilities (ask/emit pattern from 1.2.0)
  isAsyncGenerator,
  executeGenerator,
  type AskYield,
  type EmitYield,
  type PhotonYield,
  type InputProvider,
  type OutputHandler,
  // Implicit stateful execution (auto-detect checkpoint yields)
  maybeStatefulExecute,
  // Elicit for fallback
  prompt as elicitPrompt,
  confirm as elicitConfirm,
  // Progress rendering
  ProgressRenderer,
  // CLI formatting
  formatOutput as cliFormatOutput,
  // MCP Client types and SDK transport
  type MCPClientFactory,
  type MCPDependency,
  type PhotonDependency,
  type CLIDependency,
  createMCPProxy,
  MCPConfigurationError,
  type MissingMCPInfo,
  type MCPSourceType,
  SDKMCPClientFactory,
  resolveMCPSource,
  type MCPConfig,
  // Photon runtime configuration
  loadPhotonMCPConfig,
  resolveEnvVars,
  type PhotonMCPConfig,
  type MCPServerConfig,
  type SettingsSchema,
  isClass as sharedIsClass,
  findPhotonClass as sharedFindPhotonClass,
  parseEnvValue as sharedParseEnvValue,
  compilePhotonTS,
  parseRuntimeRequirement,
  checkRuntimeCompatibility,
  discoverAssets as sharedDiscoverAssets,
  // Execution audit trail
  getAuditTrail,
  // Capability detection for auto-injection
  detectCapabilities,
  // Memory provider for plain class injection
  MemoryProvider,
  // Execution context for unified method wrapping
  executionContext,
  type CallerInfo,
  // Lock helper
  withLock as withLockHelper,
  // Middleware system
  builtinRegistry,
  MiddlewareRegistry,
  buildMiddlewareChain,
  type MiddlewareDefinition,
  type MiddlewareState,
  type MiddlewareContext,
  type MiddlewareDeclaration,
  type MiddlewareHandler,
  detectNamespace,
  getCacheDir,
} from '@portel/photon-core';
import { getDefaultContext } from './context.js';
import * as os from 'os';

interface DependencySpec {
  name: string;
  version: string;
  optional?: boolean;
}

import { MarketplaceManager, type Marketplace } from './marketplace-manager.js';
import { PHOTON_VERSION, getResolvedPhotonCoreVersion } from './version.js';

// Timeout for external fetch requests (marketplace, GitHub)
const FETCH_TIMEOUT_MS = 30 * 1000;
import { generateConfigErrorMessage, summarizeConstructorParams } from './shared/config-docs.js';
import { createLogger, Logger, type LogLevel } from './shared/logger.js';
import { getErrorMessage } from './shared/error-handler.js';
import { validateOrThrow, assertString, notEmpty, hasExtension } from './shared/validation.js';
import { warnIfDangerous } from './shared/security.js';
import { detectPM } from './shared-utils.js';

/** Detect preferred package manager. Prefers bun for speed, falls back to npm. */
function detectPreferredPackageManager(): string {
  return detectPM();
}

// ════════════════════════════════════════════════════════════════════════════════
// FUNCTIONAL TAG MIDDLEWARE TYPES
// ════════════════════════════════════════════════════════════════════════════════

/** Cache entry for @cached tag */
// Old middleware interfaces removed — now in photon-core/src/middleware.ts

/**
 * Render a QR code in the terminal using Unicode block characters.
 * Uses the `qrcode` npm package for generation.
 */
/**
 * CLI Render Zone — manages a clear-and-replace output area for this.render()
 *
 * Layout:
 *   [log lines - append, scroll up]
 *   [render zone - clear and replace on each this.render() call]
 *   [progress/status - ephemeral, managed by ProgressRenderer]
 *
 * Uses ANSI cursor movement to overwrite previous render output.
 * Non-TTY environments fall through to simple append.
 */
class CLIRenderZone {
  private lastLineCount = 0;

  /**
   * Clear the previous render output and write new content.
   * Captures stdout writes to count lines for next clear.
   */
  render(fn: () => void): void {
    // Clear previous render
    this.clear();

    // Capture stdout to count lines
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = '';
    process.stdout.write = (chunk: any, ...args: any[]): boolean => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString();
      output += str;
      return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
    };

    try {
      fn();
    } finally {
      process.stdout.write = originalWrite;
    }

    // Count lines written (for next clear)
    this.lastLineCount = output.split('\n').length;
    // If output ends with newline, don't count the trailing empty string
    if (output.endsWith('\n')) {
      this.lastLineCount--;
    }
  }

  /**
   * Clear the render zone (move cursor up and erase lines)
   */
  clear(): void {
    if (this.lastLineCount > 0 && process.stdout.isTTY) {
      // Move cursor up and clear each line
      for (let i = 0; i < this.lastLineCount; i++) {
        process.stdout.write('\x1b[1A'); // Move up
        process.stdout.write('\x1b[2K'); // Clear line
      }
      this.lastLineCount = 0;
    }
  }

  /** Reset without clearing (e.g., when method returns and final result takes over) */
  reset(): void {
    this.lastLineCount = 0;
  }
}

/** Singleton render zone for CLI output */
const cliRenderZone = new CLIRenderZone();

/**
 * Clear any intermediate render output before printing final results.
 * Called by CLI runner before rendering the method's return value.
 */
export function clearRenderZone(): void {
  cliRenderZone.clear();
}

/**
 * Inject emit-based convenience helpers on a plain-class instance.
 * Every helper is a thin wrapper around this.emit so generator-yield and
 * imperative-call styles produce identical wire events.
 */
function injectEmitHelpers(instance: any): void {
  const emit = (data: any) => (instance.emit as (d: any) => void)(data);
  // Mirrors photon-core base-class render(): UI-feedback formats route to their
  // dedicated emit events; all other formats go through the render channel.
  instance.render = (format?: string, value?: any) => {
    if (format === undefined) return emit({ emit: 'render:clear' });
    if (format === 'status')
      return emit(
        typeof value === 'string'
          ? { emit: 'status', message: value }
          : { emit: 'status', ...value }
      );
    if (format === 'progress')
      return emit(
        typeof value === 'number' ? { emit: 'progress', value } : { emit: 'progress', ...value }
      );
    if (format === 'toast')
      return emit(
        typeof value === 'string' ? { emit: 'toast', message: value } : { emit: 'toast', ...value }
      );
    emit({ emit: 'render', format, value });
  };
  instance.toast = (
    message: string,
    opts: { type?: 'info' | 'success' | 'warning' | 'error'; duration?: number } = {}
  ) => emit({ emit: 'toast', message, ...opts });
  instance.log = (
    message: string,
    opts: { level?: 'debug' | 'info' | 'warn' | 'error'; data?: unknown } = {}
  ) => emit({ emit: 'log', message, level: opts.level ?? 'info', data: opts.data });
  instance.status = (message: string) => emit({ emit: 'status', message });
  instance.progress = (value: number, message?: string) =>
    emit({ emit: 'progress', value, message });
  instance.thinking = (active = true) => emit({ emit: 'thinking', active });
}

/** Extra regex checks that force 'emit' capability when helper methods are used. */
function detectEmitHelperUsage(source: string): boolean {
  return /this\.(toast|log|status|progress|thinking)\s*\(/.test(source);
}

/**
 * Render a formatted value in the CLI using @portel/cli's formatOutput.
 * Uses clear-and-replace semantics — each call overwrites the previous render.
 * Synchronous to ensure proper line counting in CLIRenderZone.
 */
function renderCLIFormat(format: string, value: any): void {
  try {
    // Handle QR as a special case (async rendering)
    if (format === 'qr') {
      const qrValue = typeof value === 'string' ? value : value?.value || value?.url || value?.qr;
      if (qrValue) {
        cliRenderZone.clear();
        void renderTerminalQR(qrValue);
        cliRenderZone.reset(); // QR line count is unpredictable
      }
      return;
    }

    // Use the eagerly-imported formatter — synchronous, so line counting works
    cliRenderZone.render(() => {
      cliFormatOutput(value, format);
    });
  } catch {
    // Fallback: print as JSON
    cliRenderZone.render(() => {
      console.log(JSON.stringify(value, null, 2));
    });
  }
}

async function renderTerminalQR(text: string): Promise<void> {
  try {
    const qrcode = await import('qrcode');
    const qrString = await (
      qrcode.toString as (text: string, opts: { type: string; small: boolean }) => Promise<string>
    )(text, { type: 'terminal', small: true });
    console.log('\n' + qrString);
  } catch {
    // Fallback: just print the raw text
    console.log(`\n[QR] ${text}\n`);
  }
}

export class PhotonLoader {
  private dependencyManager: DependencyManager;
  private verbose: boolean;
  private mcpClientFactory?: MCPClientFactory;
  /** Cache of loaded Photon instances by source path */
  private loadedPhotons: Map<string, PhotonClassExtended> = new Map();

  /** Get all loaded photon instances (including sub-photons loaded via @photon). */
  getLoadedPhotons(): Map<string, PhotonClassExtended> {
    return this.loadedPhotons;
  }
  /** In-flight Photon load promises — dedup concurrent loads of the same path */
  private loadedPhotonPromises: Map<string, Promise<any>> = new Map();
  /** MCP clients cache - reuse connections */
  private mcpClients: Map<string, any> = new Map();
  /** In-flight MCP client creation promises — dedup concurrent creates for the same dep */
  private mcpClientPromises: Map<string, Promise<any>> = new Map();
  /** Cached MCP config from ~/.photon/config.json */
  private mcpConfig?: PhotonMCPConfig;
  /** Inflight config load promise (dedup concurrent calls) */
  private mcpConfigPromise?: Promise<PhotonMCPConfig>;
  /** Progress renderer for inline CLI animation */
  private progressRenderer = new ProgressRenderer();
  /** Marketplace manager for resolving remote Photons */
  private marketplaceManager?: MarketplaceManager;
  private marketplaceManagerPromise?: Promise<MarketplaceManager>;
  private logger: Logger;

  // ════════════════════════════════════════════════════════════════════════════
  // MIDDLEWARE STATE
  // ════════════════════════════════════════════════════════════════════════════

  /** Per-middleware-name state stores (caches, throttle windows, queues, etc.) */
  private middlewareStates = new Map<string, MiddlewareState>();
  /** Per-photon custom middleware definitions discovered from module exports */
  private photonMiddleware = new Map<string, MiddlewareDefinition[]>();

  /** Shadow registry of circuit breaker states, keyed by `${photon}:${instance}:${tool}` */
  private circuitHealthTracker = new Map<
    string,
    { state: 'closed' | 'open' | 'half-open'; failures: number; openedAt: number }
  >();

  /**
   * Returns all tracked circuit breaker states across all photons.
   * Each entry uses the key format `${photon}:${instance}:${tool}`.
   */
  getCircuitHealth(): Record<
    string,
    { state: 'closed' | 'open' | 'half-open'; failures: number; openedAt: number }
  > {
    const result: Record<
      string,
      { state: 'closed' | 'open' | 'half-open'; failures: number; openedAt: number }
    > = {};
    for (const [key, entry] of this.circuitHealthTracker) {
      result[key] = { ...entry };
    }
    return result;
  }

  /** Base directory for state/config/cache (defaults to ~/.photon) */
  public baseDir: string;

  /**
   * Optional resolver for @photon dependencies.
   * When set (by the daemon), the loader asks the daemon for an existing shared instance
   * instead of creating a new isolated one. This ensures injected photons share the
   * same instance as the one the daemon manages (e.g., WhatsApp socket reuse).
   */
  public photonInstanceResolver?: (
    photonName: string,
    photonPath: string,
    callerInstanceName?: string
  ) => Promise<any>;

  /**
   * Optional resolver for this.instance(name) — same-photon cross-instance access.
   * When set (by the daemon), allows a photon to get another instance of itself
   * in-process without daemon round-trips. Used for instance-per-group patterns
   * where the default instance routes to named sub-instances.
   */
  public instanceResolver?: (instanceName: string) => Promise<any>;

  /**
   * Pre-loaded dependency modules for compiled binaries.
   * Maps dependency name → { module, source } so @photon deps can be resolved
   * without file I/O when running as a standalone binary.
   */
  public preloadedDependencies?: Map<
    string,
    { module: { default: any; middleware?: any[] }; source: string; filePath: string }
  >;

  /**
   * Optional progress callback — invoked during long-running init phases
   * (dependency install, compilation, onInitialize). Used by worker-host
   * to send keepalive signals so the spawn timeout resets.
   */
  public onProgress?: (phase: string) => void;

  constructor(verbose: boolean = false, logger?: Logger, baseDir?: string) {
    this.dependencyManager = new DependencyManager();
    this.verbose = verbose;
    this.logger = logger ?? createLogger({ component: 'photon-loader', minimal: true });
    this.baseDir = baseDir || getDefaultContext().baseDir;
  }

  /**
   * Load MCP configuration from ~/.photon/config.json
   * Called lazily on first MCP injection
   */
  private async ensureMCPConfig(): Promise<PhotonMCPConfig> {
    if (this.mcpConfig) return this.mcpConfig;
    if (this.mcpConfigPromise) return this.mcpConfigPromise;

    this.mcpConfigPromise = loadPhotonMCPConfig().then((config) => {
      this.mcpConfig = config;
      this.mcpConfigPromise = undefined;
      const serverCount = Object.keys(config.mcpServers).length;
      if (serverCount > 0) {
        this.log(`Loaded ${serverCount} MCP servers from config`);
      }
      return config;
    });
    return this.mcpConfigPromise;
  }

  private async getMarketplaceManager(): Promise<MarketplaceManager> {
    if (this.marketplaceManager) {
      return this.marketplaceManager;
    }
    if (!this.marketplaceManagerPromise) {
      this.marketplaceManagerPromise = (async () => {
        const managerLogger = this.logger.child({ component: 'marketplace-manager' });
        const manager = new MarketplaceManager(managerLogger, this.baseDir);
        await manager.initialize();
        return manager;
      })();
    }
    this.marketplaceManager = await this.marketplaceManagerPromise;
    return this.marketplaceManager;
  }

  /**
   * Set MCP client factory for enabling this.mcp() in Photons
   */
  setMCPClientFactory(factory: MCPClientFactory): void {
    this.mcpClientFactory = factory;
  }

  /**
   * Log message only if verbose mode is enabled
   */
  private log(message: string, meta?: Record<string, any>): void {
    if (this.verbose) {
      this.logger.info(message, meta);
    }
  }

  /**
   * Generate deterministic cache key for an MCP + photon path
   */
  private getCacheKey(mcpName: string, photonPath: string): string {
    let normalized = path.resolve(photonPath);
    try {
      normalized = realpathSync(normalized);
    } catch {
      /* keep resolved */
    }
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
    return `${mcpName}-${hash}`;
  }

  private getPhotonCacheDir(): string {
    return path.join(this.baseDir, '.cache', 'photons');
  }

  private sanitizeCacheLabel(label: string): string {
    return label.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async writePhotonCacheFile(
    label: string,
    content: string,
    hashHint?: string
  ): Promise<string> {
    const cacheDir = this.getPhotonCacheDir();
    await fs.mkdir(cacheDir, { recursive: true });
    const hash = hashHint
      ? hashHint.replace(/^sha256:/, '').slice(0, 12)
      : crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    const safeLabel = this.sanitizeCacheLabel(label);
    const cachePath = path.join(cacheDir, `${safeLabel}.${hash}.photon.ts`);
    await writeText(cachePath, content);
    return cachePath;
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Directory where MCP-specific dependencies are cached
   */
  private getDependencyCacheDir(cacheKey: string): string {
    return path.join(getCacheDir(process.env.PHOTON_DIR), 'dependencies', cacheKey);
  }

  private getBuildCacheDir(cacheKey: string): string {
    return path.join(this.getDependencyCacheDir(cacheKey), '.build');
  }

  private async clearBuildCache(cacheKey: string): Promise<void> {
    const buildDir = this.getBuildCacheDir(cacheKey);
    await fs.rm(buildDir, { recursive: true, force: true });
  }

  private async clearDependencyCache(cacheKey: string): Promise<void> {
    await this.dependencyManager.clearCache(cacheKey);
  }

  private async clearAllCaches(cacheKey: string): Promise<void> {
    await this.clearDependencyCache(cacheKey);
    await this.clearBuildCache(cacheKey);
  }

  /**
   * Path to metadata file describing installed dependencies
   */
  private getDependencyMetadataPath(cacheKey: string): string {
    return path.join(this.getDependencyCacheDir(cacheKey), 'metadata.json');
  }

  private async readDependencyMetadata(
    cacheKey: string
  ): Promise<{ hash: string; dependencies: DependencySpec[]; photonCoreVersion?: string } | null> {
    try {
      return await readJSON(this.getDependencyMetadataPath(cacheKey));
    } catch (error) {
      this.logger.debug('Failed to read dependency metadata', { error });
      return null; // cache miss
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false; // path does not exist
    }
  }

  private dependenciesEqual(a: DependencySpec[] | undefined, b: DependencySpec[]): boolean {
    if (!a) {
      return b.length === 0;
    }
    if (a.length !== b.length) {
      return false;
    }
    const normalize = (deps: DependencySpec[]) =>
      deps
        .map((d) => `${d.name}@${d.version}${d.optional ? '?' : ''}`)
        .sort()
        .join('|');
    return normalize(a) === normalize(b);
  }

  private async writeDependencyMetadata(
    cacheKey: string,
    hash: string,
    dependencies: DependencySpec[],
    photonPath?: string,
    photonCoreVersion?: string
  ): Promise<void> {
    const metadataPath = this.getDependencyMetadataPath(cacheKey);
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await writeJSON(metadataPath, {
      hash,
      dependencies,
      photonPath: photonPath ? path.resolve(photonPath) : undefined,
      photonCoreVersion,
    });
  }

  private async ensureDependenciesWithHash(
    cacheKey: string,
    mcpName: string,
    dependencies: DependencySpec[],
    sourceHash: string,
    photonPath?: string
  ): Promise<string | null> {
    const metadata = await this.readDependencyMetadata(cacheKey);
    const hashMatches = metadata?.hash === sourceHash;
    const depsMatch = metadata
      ? this.dependenciesEqual(metadata.dependencies, dependencies)
      : false;
    const resolvedCoreVersion = getResolvedPhotonCoreVersion();
    // Compare versions tolerantly: "2.17.6" matches "^2.17.6" and vice versa
    // This prevents unnecessary cache clears when createRequire fallback returns a range
    const storedVersion = metadata?.photonCoreVersion || '';
    const coreVersionChanged =
      storedVersion !== resolvedCoreVersion &&
      storedVersion.replace(/^[\^~]/, '') !== resolvedCoreVersion.replace(/^[\^~]/, '');

    // Only clear dependency cache when deps or core version actually changed.
    // Source-only changes just need a build cache clear (recompile is fast).
    const needsDepClear = Boolean(metadata && (!depsMatch || coreVersionChanged));
    const needsBuildClear = Boolean(metadata && !hashMatches);

    if (needsDepClear) {
      if (coreVersionChanged) {
        this.log(
          `🔄 photon-core version changed (${metadata?.photonCoreVersion} → ${resolvedCoreVersion}), clearing cache for ${mcpName}`
        );
      } else {
        this.log(`🔄 Dependencies changed for ${mcpName}, reinstalling`);
      }
      await this.clearAllCaches(cacheKey);
    } else if (needsBuildClear) {
      await this.clearBuildCache(cacheKey);
    }

    let nodeModules: string | null = null;
    if (dependencies.length > 0) {
      this.onProgress?.('installing dependencies');
      nodeModules = await this.dependencyManager.ensureDependencies(cacheKey, dependencies);
      if (nodeModules) {
        this.log(`📦 Dependencies ready for ${mcpName}`, { nodeModules });
      }
    }

    // All photons need @portel/photon-core resolvable from the build cache.
    // Symlink it into the build dir's node_modules so the compiled ESM import works.
    {
      const buildDir = this.getBuildCacheDir(cacheKey);
      const coreTarget = path.join(buildDir, 'node_modules', '@portel', 'photon-core');
      if (!existsSync(coreTarget)) {
        try {
          const esmRequire = createRequire(import.meta.url);
          const coreEntry = esmRequire.resolve('@portel/photon-core');
          let corePath = path.dirname(coreEntry);
          while (corePath !== path.dirname(corePath)) {
            if (existsSync(path.join(corePath, 'package.json'))) break;
            corePath = path.dirname(corePath);
          }
          mkdirSync(path.dirname(coreTarget), { recursive: true });
          symlinkSync(corePath, coreTarget, 'dir');
          this.log(`🔗 Symlinked @portel/photon-core for ${mcpName}`);
        } catch (linkErr) {
          this.log(
            `⚠️ Failed to symlink photon-core for ${mcpName}: ${linkErr instanceof Error ? linkErr.message : String(linkErr)}`
          );
        }
      }
    }

    await this.writeDependencyMetadata(
      cacheKey,
      sourceHash,
      dependencies,
      photonPath,
      resolvedCoreVersion
    );
    return nodeModules;
  }

  private shouldRetryInstall(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Cannot find package') ||
      message.includes('ERR_MODULE_NOT_FOUND') ||
      message.includes('Cannot find module') ||
      message.includes('require is not defined')
    );
  }

  private static parseDependenciesFromSource(source: string): DependencySpec[] {
    const deps: DependencySpec[] = [];

    // Only match @dependencies inside JSDoc blocks (/** ... */)
    const jsdocBlocks = source.match(/\/\*\*[\s\S]*?\*\//g) || [];
    const jsdocText = jsdocBlocks.join('\n');

    const regex = /@dependencies\s+([^\r\n]+)/g;
    let match;
    while ((match = regex.exec(jsdocText)) !== null) {
      const entries = match[1]
        .replace(/\*\/$/, '') // strip trailing */ if on same line
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const entry of entries) {
        const atIndex = entry.lastIndexOf('@');
        let name: string;
        let version: string;
        if (atIndex <= 0) {
          // No version specified (e.g., "sharp") — default to latest
          name = entry.trim();
          version = '*';
        } else {
          name = entry.slice(0, atIndex).trim();
          version = entry.slice(atIndex + 1).trim();
        }
        // Validate: npm package names are lowercase, may have @scope/, no spaces
        if (name.includes(' ') || !/^(@[a-z0-9-]+\/)?[a-z0-9._-]+$/.test(name)) {
          continue;
        }
        // Trailing ? marks the dependency as optional (e.g. sharp@^0.33.0?)
        const optional = version.endsWith('?');
        if (optional) {
          version = version.slice(0, -1);
        }
        if (name && version) {
          deps.push({ name, version, ...(optional && { optional: true }) });
        }
      }
    }
    return deps;
  }

  private static mergeDependencySpecs(
    existing: DependencySpec[],
    additional: DependencySpec[]
  ): DependencySpec[] {
    const map = new Map<string, DependencySpec>();
    for (const dep of existing) {
      map.set(dep.name, dep);
    }
    for (const dep of additional) {
      map.set(dep.name, dep);
    }
    return Array.from(map.values());
  }

  /**
   * Load a single Photon MCP file
   */
  async loadFile(
    filePath: string,
    options?: { instanceName?: string; skipInitialize?: boolean }
  ): Promise<PhotonClassExtended> {
    // Validate input
    assertString(filePath, 'filePath');
    validateOrThrow(filePath, [
      notEmpty('Photon file path'),
      hasExtension('Photon file', ['ts', 'js']),
    ]);

    try {
      // Resolve to absolute path
      const absolutePath = path.resolve(filePath);

      // Check file exists
      await fs.access(absolutePath);

      // Convert file path to file:// URL for ESM imports
      let module: any;
      let tsContent: string | undefined;
      let dependencies: DependencySpec[] = [];
      let sourceHash: string | undefined;
      let mcpName = '';
      let cacheKey: string | null = null;

      if (absolutePath.endsWith('.ts')) {
        tsContent = await readText(absolutePath);

        // Check runtime version compatibility
        const requiredRuntime = parseRuntimeRequirement(tsContent);
        if (requiredRuntime) {
          const check = checkRuntimeCompatibility(requiredRuntime, PHOTON_VERSION);
          if (!check.compatible) {
            throw new Error(check.message);
          }
        }

        const extracted = await this.dependencyManager.extractDependencies(absolutePath);
        const parsed = PhotonLoader.parseDependenciesFromSource(tsContent);
        dependencies = PhotonLoader.mergeDependencySpecs(extracted, parsed);

        // @portel/photon-core is the runtime itself — never pass it to npm install.
        // The dependency manager's fixBrokenPhotonCoreLink() handles symlinking it
        // into the cache's node_modules after install.
        dependencies = dependencies.filter((d) => d.name !== '@portel/photon-core');

        mcpName = path.basename(absolutePath, '.ts').replace('.photon', '');
        cacheKey = this.getCacheKey(mcpName, absolutePath);
        sourceHash = crypto.createHash('sha256').update(tsContent).digest('hex');

        if (dependencies.length > 0) {
          this.log(`📦 Found ${dependencies.length} dependencies`);
        }

        await this.ensureDependenciesWithHash(
          cacheKey,
          mcpName,
          dependencies,
          sourceHash,
          absolutePath
        );
      }

      // Security: scan source for dangerous patterns before loading
      if (tsContent) {
        const warnings = warnIfDangerous(tsContent);
        for (const w of warnings) {
          this.log(`⚠️  Security: ${w} in ${absolutePath}`);
        }
      }

      const importModule = async () => {
        if (tsContent) {
          this.onProgress?.('compiling typescript');
          const cachedJsPath = await this.compileTypeScript(absolutePath, cacheKey!, tsContent);
          const cachedJsUrl = pathToFileURL(cachedJsPath).href;
          return await import(`${cachedJsUrl}?t=${Date.now()}`);
        }
        const fileUrl = pathToFileURL(absolutePath).href;
        return await import(`${fileUrl}?t=${Date.now()}`);
      };

      try {
        module = await importModule();
      } catch (error) {
        if (this.shouldRetryInstall(error) && tsContent && sourceHash && mcpName && cacheKey) {
          this.log(`⚠️  Missing dependency detected, reinstalling dependencies for ${mcpName}`);
          await this.clearAllCaches(cacheKey);
          await this.ensureDependenciesWithHash(
            cacheKey,
            mcpName,
            dependencies,
            sourceHash,
            absolutePath
          );
          module = await importModule();
        } else {
          throw error;
        }
      }

      // Find the exported class
      const MCPClass = this.findMCPClass(module);

      if (!MCPClass || !this.isClass(MCPClass)) {
        throw new Error('No class found in file. Expected a default-exported class with methods.');
      }

      // Get MCP name
      const name = this.getMCPName(MCPClass);

      // Discover custom middleware exports (export const middleware = [...])
      // Must come after getMCPName since we key by the resolved photon name
      if (module.middleware && Array.isArray(module.middleware)) {
        this.photonMiddleware.set(name, module.middleware);
        this.log(`🔧 Discovered ${module.middleware.length} custom middleware for ${name}`);
      }

      // Resolve all constructor injections using type-based detection.
      // Use the file-name-derived mcpName (e.g. 'kanban') for state path resolution,
      // not the class-name-derived name (e.g. 'kanban-photon'), so that state files
      // written by the daemon (keyed by file name) are correctly found.
      const { values, configError, injectedPhotonNames } = await this.resolveAllInjections(
        tsContent || '',
        mcpName || name,
        absolutePath,
        options?.instanceName ?? ''
      );

      // Create instance with injected dependencies
      let instance: Record<string, unknown>;
      try {
        instance = new MCPClass(...values) as Record<string, unknown>;
      } catch (error) {
        // Constructor threw an error (likely validation failure)
        const constructorParams = await this.extractConstructorParams(absolutePath);
        const enhancedError = this.enhanceConstructorError(
          error instanceof Error ? error : new Error(String(error)),
          name,
          constructorParams,
          configError
        );
        throw enhancedError;
      }

      // Store config warning for later if there were missing params
      if (configError) {
        instance._photonConfigError = configError;
        this.logger.warn(`⚠️  ${name} loaded with configuration warnings:`);
        this.logger.warn(String(configError));
      }

      // Set photon name and namespace for event source identification and data paths
      instance._photonName = name;
      instance._photonNamespace = this.resolveNamespace(absolutePath);

      // Inject instance name for named instances (runtime concept, not code)
      instance.instanceName = options?.instanceName ?? '';

      // Inject file path for storage()/assets() resolution
      instance._photonFilePath = absolutePath;

      // Inject dynamic photon resolver for this.photon.use()
      instance._photonResolver = (photonName: string, instanceName?: string) => {
        return this.resolveAndLoadPhoton(photonName, absolutePath, instanceName);
      };

      // Auto-wire ReactiveArray/Map/Set properties for zero-boilerplate reactivity
      // Developers just `import { Array } from '@portel/photon-core'` and use normally
      this.wireReactiveCollections(instance);

      // Inject format catalog — this.formats
      this.injectFormatCatalog(instance);

      // Inject @mcp dependencies from source (this.github, this.fs, etc.)
      if (tsContent) {
        await this.injectMCPDependencies(instance, tsContent, name);
      }

      // Inject MCP client factory if available (enables this.mcp() calls)
      const setMCPFactory = instance.setMCPFactory;
      if (this.mcpClientFactory && typeof setMCPFactory === 'function') {
        setMCPFactory.call(instance, this.mcpClientFactory);
        this.log(`Injected MCP factory into ${name}`);
      }

      // Inject cross-photon call handler (enables this.call() calls)
      if (typeof instance._callHandler === 'undefined' || instance._callHandler === undefined) {
        const callBaseDir = this.baseDir;
        instance._callHandler = async (
          photonName: string,
          method: string,
          params: Record<string, any>,
          targetInstance?: string
        ) => {
          // Dynamic import to avoid circular dependency
          const { sendCommand } = await import('./daemon/client.js');
          return sendCommand(photonName, method, params, {
            workingDir: callBaseDir,
            targetInstance,
          });
        };
        this.log(`Injected call handler into ${name}`);
      }

      // Auto-detect and inject capabilities for plain classes
      // Photon base class already has these built-in, so only inject for plain classes
      if (tsContent && typeof instance.executeTool !== 'function') {
        const caps = detectCapabilities(tsContent);
        if (detectEmitHelperUsage(tsContent)) caps.add('emit');
        if (caps.size > 0) {
          this.log(`🔍 Detected capabilities for ${name}: ${[...caps].join(', ')}`);
        }

        this.injectPathHelpers(instance, tsContent);

        if (caps.has('emit')) {
          // Inject emit() that reads from executionContext (set during executeTool)
          // Falls back to last known outputHandler for timer-based emits after method returns
          instance.emit = (data: any) => {
            const store = executionContext.getStore();
            const emitData =
              instance._photonName && typeof data === 'object' && data !== null
                ? { ...data, _source: instance._photonName }
                : data;
            const handler =
              store?.outputHandler ||
              (instance._lastOutputHandler as ((data: any) => void) | undefined);
            if (handler) {
              handler(emitData);
            }
            // Also publish to channel broker if channel is specified
            if (data && typeof data.channel === 'string') {
              // Auto-prefix channel with photon name if not already namespaced
              const channel = data.channel.includes(':') ? data.channel : `${name}:${data.channel}`;
              import('@portel/photon-core')
                .then(({ getBroker }) => {
                  const broker = getBroker();
                  broker
                    .publish({
                      channel,
                      event: data.event || 'message',
                      data: data.data !== undefined ? data.data : data,
                      timestamp: Date.now(),
                      source: name,
                    })
                    .catch((e: any) => {
                      this.logger.debug('Failed to publish broker event', {
                        error: e?.message || e,
                      });
                    });
                })
                .catch((e: any) => {
                  this.logger.debug('Failed to import photon-core for broker', {
                    error: e?.message || e,
                  });
                });
            }
          };

          // Inject convenience helpers (render, toast, log, status, progress, thinking)
          injectEmitHelpers(instance);
        }

        if (caps.has('memory')) {
          // Inject lazy memory provider — capture baseDir from loader context
          const memoryBaseDir = this.baseDir;
          Object.defineProperty(instance, 'memory', {
            get() {
              if (!this._memory) {
                this._memory = new MemoryProvider(
                  name,
                  this._sessionId,
                  this._photonNamespace,
                  memoryBaseDir
                );
              }
              return this._memory;
            },
            configurable: true,
          });
        }

        if (caps.has('call') && !instance.call) {
          // Inject call() for cross-photon communication
          instance.call = async (
            target: string,
            params: Record<string, any> = {},
            options?: { instance?: string }
          ) => {
            const dotIndex = target.indexOf('.');
            if (dotIndex === -1) {
              throw new Error(
                `Invalid call target: '${target}'. Expected format: 'photonName.methodName'`
              );
            }
            const photonName = target.slice(0, dotIndex);
            const methodName = target.slice(dotIndex + 1);
            if (!instance._callHandler) {
              throw new Error(`Cross-photon calls not available for ${name}.`);
            }
            return (instance._callHandler as (...args: unknown[]) => unknown)(
              photonName,
              methodName,
              params,
              options?.instance
            );
          };
        }

        if (caps.has('mcp') && !instance.mcp) {
          // Inject mcp() accessor for external MCP server access
          const mcpClients = new Map<string, any>();
          instance.mcp = (mcpName: string) => {
            if (!this.mcpClientFactory) {
              throw new Error(`MCP access not available for ${name}.`);
            }
            let client = mcpClients.get(mcpName);
            if (!client) {
              const rawClient = this.mcpClientFactory.create(mcpName);
              client = createMCPProxy(rawClient);
              mcpClients.set(mcpName, client);
            }
            return client;
          };
        }

        if (
          caps.has('caller') &&
          !Object.getOwnPropertyDescriptor(Object.getPrototypeOf(instance), 'caller')
        ) {
          // Inject caller getter that reads from executionContext
          Object.defineProperty(instance, 'caller', {
            get() {
              const store = executionContext.getStore();
              return store?.caller ?? { id: 'anonymous', anonymous: true };
            },
            configurable: true,
          });
        }

        if (caps.has('lock') && !instance.withLock) {
          // Inject withLock() helper
          instance.withLock = async <T>(
            lockName: string,
            fn: () => Promise<T>,
            timeout?: number
          ): Promise<T> => {
            return withLockHelper(lockName, fn, timeout);
          };
        }

        // Inject identity-aware lock handler for this.acquireLock/transferLock/releaseLock/getLock
        if (!instance._lockHandler) {
          const photonNameForLock = name;
          instance._lockHandler = {
            async assign(lockName: string, holder: string, lockTimeout?: number) {
              const { assignLock } = await import('./daemon/client.js');
              return assignLock(photonNameForLock, lockName, holder, lockTimeout);
            },
            async transfer(
              lockName: string,
              fromHolder: string,
              toHolder: string,
              lockTimeout?: number
            ) {
              const { transferLock } = await import('./daemon/client.js');
              return transferLock(photonNameForLock, lockName, fromHolder, toHolder, lockTimeout);
            },
            async release(lockName: string, holder: string) {
              const { releaseIdentityLock } = await import('./daemon/client.js');
              return releaseIdentityLock(photonNameForLock, lockName, holder);
            },
            async query(lockName: string) {
              const { queryLock } = await import('./daemon/client.js');
              return queryLock(photonNameForLock, lockName);
            },
          };
        }

        if (caps.has('instanceMeta')) {
          // Inject instance metadata (file-stat-based timestamps)
          const instanceName = options?.instanceName || 'default';
          const stateDir = path.join(this.baseDir, 'state', name);
          const stateFile = path.join(stateDir, `${instanceName}.json`);
          try {
            const stat = await fs.stat(stateFile);
            instance.instanceMeta = {
              name: instanceName,
              createdAt: stat.birthtime.toISOString(),
              updatedAt: stat.mtime.toISOString(),
            };
          } catch {
            // State file doesn't exist yet — provide defaults
            instance.instanceMeta = {
              name: instanceName,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          }
        }

        if (caps.has('allInstances')) {
          // Inject cross-instance iterator
          const photonName = name;
          const loaderBaseDir = this.baseDir;
          instance.allInstances = async function* () {
            const stateDir = path.join(loaderBaseDir, 'state', photonName);
            try {
              const files = await fs.readdir(stateDir);
              for (const file of files.filter((f: string) => f.endsWith('.json'))) {
                const instName = file.replace('.json', '');
                const statePath = path.join(stateDir, file);
                try {
                  const snapshot = await readJSON(statePath);
                  const stat = await fs.stat(statePath);
                  yield {
                    name: instName,
                    meta: {
                      name: instName,
                      createdAt: stat.birthtime.toISOString(),
                      updatedAt: stat.mtime.toISOString(),
                    },
                    state: snapshot,
                  };
                } catch {
                  // Skip corrupted state files
                }
              }
            } catch {
              // State dir doesn't exist yet — no instances
            }
          };
        }
      }

      // Inject this.instance(name) for same-photon cross-instance access.
      // Independent of capabilities — any photon can use instance-per-group patterns.
      if (this.instanceResolver) {
        const resolver = this.instanceResolver;
        instance.instance = async (name: string) => resolver(name);
      }

      // Channel event capability: inject on()/off()/_dispatch()/_matchesFilter()
      // when source uses this._dispatch( — the universal channel dispatch pattern.
      // Channels call this._dispatch(chatId, message, groupName?) to fire to subscribers
      // instead of manually looping through handler arrays with filter matching.
      if (
        tsContent &&
        /(?:this\._dispatch\s*\(|\(this\s+as\s+any\)\._dispatch\s*\()/.test(tsContent)
      ) {
        const inst = instance as PhotonInstance;
        if (!inst._eventListeners) {
          inst._eventListeners = [];
        }

        if (!inst.on) {
          inst.on = function (event: string, fn: (data: unknown) => void, filter?: EventFilter) {
            inst._eventListeners!.push({ event, fn, filter });
          };
        }

        if (!inst.off) {
          inst.off = function (event: string, fn: (data: unknown) => void) {
            const idx = inst._eventListeners!.findIndex(
              (e: EventListenerEntry) => e.event === event && e.fn === fn
            );
            if (idx !== -1) inst._eventListeners!.splice(idx, 1);
          };
        }

        if (!inst._matchesFilter) {
          inst._matchesFilter = function (
            filter: EventFilter | undefined,
            chatId: string,
            message: ChannelMessage,
            groupName?: string
          ): boolean {
            if (!filter) return true;
            if (filter.chatId && filter.chatId !== chatId) return false;
            if (filter.group && groupName) {
              const fg = filter.group.toLowerCase();
              if (!groupName.toLowerCase().includes(fg) && chatId !== filter.group) return false;
            }
            if (filter.trigger && message?.content && !message.content.includes(filter.trigger))
              return false;
            if (filter.fromMe !== undefined && message?.fromMe !== filter.fromMe) return false;
            return true;
          };
        }

        if (!inst._dispatch) {
          inst._dispatch = function (chatId: string, message: ChannelMessage, groupName?: string) {
            for (const entry of inst._eventListeners!) {
              if (entry.event !== 'message') continue;
              if (inst._matchesFilter!(entry.filter, chatId, message, groupName)) {
                try {
                  entry.fn({ chatId, message });
                } catch {
                  // handler error — don't crash the dispatch loop
                }
              }
            }
          };
        }

        this.log(`🔌 Injected channel event infrastructure into ${name}`);
      }

      // Inject this.channel() for channel notifications — works for both Photon
      // subclasses and plain classes. Emits on '{photonName}:channel-push' daemon
      // channel which the MCP server intercepts and translates to the client's
      // notification method (e.g. notifications/claude/channel).
      //
      // this.channel(content, meta) — send a message to the client
      // this.channel.respond(id, behavior) — respond to permission requests
      // this.channel.onPermission(handler) — register permission request handler
      if (typeof instance.emit === 'function') {
        const emitFn = (instance.emit as (data: any) => void).bind(instance);
        // Permission handler stored locally — wired by server after load
        let permissionHandler: ((request: any) => void) | undefined;
        const channelFn = Object.assign(
          (content: string, meta?: Record<string, string>) => {
            emitFn({
              channel: `${name}:channel-push`,
              event: 'channel',
              data: { content, meta },
            });
          },
          {
            respond: (requestId: string, behavior: 'allow' | 'deny') => {
              emitFn({
                channel: `${name}:channel-permission-response`,
                event: 'permission-response',
                data: { request_id: requestId, behavior },
              });
            },
            onPermission: (handler: (request: any) => void) => {
              permissionHandler = handler;
            },
            // Internal: called by the server when a permission request arrives
            _dispatchPermission: (request: any) => {
              permissionHandler?.(request);
            },
          }
        );
        instance.channel = channelFn;
      }

      // Check @cli dependencies (required system CLI tools)
      if (tsContent) {
        await this.checkCLIDependencies(tsContent, name);
      }

      // Call lifecycle hook if present with error handling
      // skipInitialize is used during hot-reload: state is transferred from the old
      // instance after loadFile returns, then onInitialize is called manually.
      const onInitialize = instance.onInitialize;
      if (typeof onInitialize === 'function' && !options?.skipInitialize) {
        this.onProgress?.('running onInitialize');
        try {
          await onInitialize.call(instance);
        } catch (error) {
          const initError = new Error(
            `Initialization failed for ${name}: ${getErrorMessage(error)}\n` +
              `\nThe onInitialize() lifecycle hook threw an error.\n` +
              `Check your constructor configuration and initialization logic.`
          );
          initError.name = 'PhotonInitializationError';
          if (error instanceof Error && error.stack) {
            initError.stack = error.stack;
          }
          throw initError;
        }
      }

      // Auto-wrap public methods in @stateful classes to emit events
      // Must happen AFTER capability injection so that emit() is available
      if (tsContent) {
        this.wrapStatefulMethods(instance, tsContent);
      }

      // Extract tools, templates, and statics (with schema override support)
      const {
        tools,
        templates,
        statics,
        settingsSchema,
        auth: extractedAuth,
      } = await this.extractTools(MCPClass, absolutePath);

      // ═══ SETTINGS INJECTION ═══
      // If the photon declared `protected settings = { ... }`, inject persistence + proxy
      if (
        settingsSchema?.hasSettings &&
        instance.settings &&
        typeof instance.settings === 'object'
      ) {
        const instanceName = options?.instanceName || 'default';
        await this.injectSettings(instance, name, instanceName, settingsSchema);

        // Auto-generate the `settings` MCP tool from the schema
        const settingsTool = this.generateSettingsTool(settingsSchema);
        tools.push(settingsTool);
        this.log(
          `⚙️  Settings tool auto-generated for ${name} (${settingsSchema.properties.length} props)`
        );
      }

      // Backward compat: warn if photon uses configure() method without settings property
      if (!settingsSchema?.hasSettings && typeof instance.configure === 'function') {
        this.logger.warn(
          `⚠️  ${name}: configure() method is deprecated. Use 'protected settings = { ... }' property instead.`
        );
      }

      // Extract assets from source and discover asset folder
      const assets = await this.discoverAssets(absolutePath, tsContent || '');
      this.attachAssetsToInstance(instance, assets);

      const counts = [
        tools.length > 0 ? `${tools.length} tools` : null,
        templates.length > 0 ? `${templates.length} templates` : null,
        statics.length > 0 ? `${statics.length} statics` : null,
        assets && (assets.ui.length > 0 || assets.prompts.length > 0 || assets.resources.length > 0)
          ? `${assets.ui.length + assets.prompts.length + assets.resources.length} assets`
          : null,
      ]
        .filter(Boolean)
        .join(', ');

      this.log(`✅ Loaded: ${name} (${counts})`);

      // Extract class-level metadata from docblock
      const classDocblock = this.extractClassDocblock(tsContent || '');
      const classIcon = classDocblock.match(/@icon\s+([^\s@*,]+)/)?.[1];
      const classDesc = classDocblock.match(/^\s*\*\s+([^@*\n][^\n]*)/m)?.[1]?.trim();
      const isStateful = /@stateful\b/.test(classDocblock);

      const result: PhotonClassExtended & {
        /* classConstructor inherited from PhotonClass */
        settingsSchema?: SettingsSchema;
        icon?: string;
        stateful?: boolean;
        auth?: string;
      } = {
        name,
        description: classDesc || `${name} MCP`,
        tools,
        templates,
        statics,
        instance,
        assets,
        injectedPhotons: injectedPhotonNames.length > 0 ? injectedPhotonNames : undefined,
      };
      if (classIcon) result.icon = classIcon;
      if (isStateful) result.stateful = true;
      if (extractedAuth) result.auth = extractedAuth;
      // Store class constructor for static method access
      result.classConstructor = MCPClass as unknown as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      // Store settings schema for Beam UI
      if (settingsSchema?.hasSettings) {
        result.settingsSchema = settingsSchema;
      }
      return result;
    } catch (error) {
      this.logger.error(`❌ Failed to load ${filePath}: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Load a photon from a pre-imported module (for compiled binaries).
   * Skips file I/O, compilation, and dependency installation — the module is
   * already bundled. Still does class extraction, constructor injection,
   * capability wiring, middleware, and metadata extraction from embedded source.
   */
  async loadFromModule(
    module: { default: any; middleware?: any[] },
    filePath: string,
    sourceCode: string,
    options?: { instanceName?: string; skipInitialize?: boolean }
  ): Promise<PhotonClassExtended> {
    const absolutePath = path.resolve(filePath);
    const mcpName = path.basename(absolutePath, '.ts').replace('.photon', '');
    const tsContent = sourceCode;

    // Find the exported class
    const MCPClass = this.findMCPClass(module);
    if (!MCPClass || !this.isClass(MCPClass)) {
      throw new Error(
        'No class found in preloaded module. Expected a default-exported class with methods.'
      );
    }

    // Prefer file-path-derived name (e.g. 'whatsapp' from whatsapp.photon.ts)
    // over class-name-derived kebab-case (e.g. 'whats-app' from WhatsApp class).
    // File path names are canonical in the photon ecosystem.
    const classNameDerived = this.getMCPName(MCPClass);
    const name = mcpName || classNameDerived;

    // Register custom middleware if exported
    if (module.middleware && Array.isArray(module.middleware)) {
      this.photonMiddleware.set(name, module.middleware);
      this.log(`🔧 Discovered ${module.middleware.length} custom middleware for ${name}`);
    }

    // Resolve constructor injections (env vars, persisted state, etc.)
    const { values, configError, injectedPhotonNames } = await this.resolveAllInjections(
      tsContent,
      name,
      absolutePath,
      options?.instanceName ?? ''
    );

    // Create instance
    let instance: Record<string, unknown>;
    try {
      instance = new MCPClass(...values) as Record<string, unknown>;
    } catch (error) {
      let constructorParams: any[] = [];
      try {
        constructorParams = await this.extractConstructorParams(absolutePath);
      } catch {
        // Source file may not exist on disk (compiled binary) — skip enhancement
      }
      throw this.enhanceConstructorError(
        error instanceof Error ? error : new Error(String(error)),
        name,
        constructorParams,
        configError
      );
    }

    if (configError) {
      instance._photonConfigError = configError;
    }

    instance._photonName = name;
    instance._photonNamespace = this.resolveNamespace(absolutePath);
    instance.instanceName = options?.instanceName ?? '';

    // Inject file path for storage()/assets() resolution.
    // For preloaded modules (compiled binaries), remap to ~/.photon/ so storage()
    // resolves under the deployment directory instead of the build machine's source tree.
    // Assets still use absolutePath (resolved from embedded source paths).
    const storagePath = path.join(os.homedir(), '.photon', path.basename(absolutePath));
    instance._photonFilePath = storagePath;

    // Inject dynamic photon resolver for this.photon.use()
    instance._photonResolver = (photonName: string, instanceName?: string) => {
      return this.resolveAndLoadPhoton(photonName, absolutePath, instanceName);
    };

    // Inject format catalog — this.formats
    this.injectFormatCatalog(instance);

    // Wire reactive collections
    this.wireReactiveCollections(instance);

    // Inject @mcp dependencies
    if (tsContent) {
      await this.injectMCPDependencies(instance, tsContent, name);
    }

    // Auto-wrap stateful methods
    if (tsContent) {
      this.wrapStatefulMethods(instance, tsContent);
    }

    // Inject MCP client factory
    const setMCPFactory = instance.setMCPFactory;
    if (this.mcpClientFactory && typeof setMCPFactory === 'function') {
      setMCPFactory.call(instance, this.mcpClientFactory);
    }

    // Inject cross-photon call handler
    if (typeof instance._callHandler === 'undefined' || instance._callHandler === undefined) {
      const callBaseDir = this.baseDir;
      instance._callHandler = async (
        photonName: string,
        method: string,
        params: Record<string, any>,
        targetInstance?: string
      ) => {
        const { sendCommand } = await import('./daemon/client.js');
        return sendCommand(photonName, method, params, {
          workingDir: callBaseDir,
          targetInstance,
        });
      };
    }

    // Detect and inject capabilities for plain classes
    if (tsContent && typeof instance.executeTool !== 'function') {
      const caps = detectCapabilities(tsContent);
      if (detectEmitHelperUsage(tsContent)) caps.add('emit');
      this.injectPathHelpers(instance, tsContent);

      if (caps.has('emit')) {
        instance.emit = (data: any) => {
          const store = executionContext.getStore();
          const emitData =
            instance._photonName && typeof data === 'object' && data !== null
              ? { ...data, _source: instance._photonName }
              : data;
          const handler =
            store?.outputHandler ||
            (instance._lastOutputHandler as ((data: any) => void) | undefined);
          if (handler) handler(emitData);
          if (data && typeof data.channel === 'string') {
            const channel = data.channel.includes(':') ? data.channel : `${name}:${data.channel}`;
            import('@portel/photon-core')
              .then(({ getBroker }) => {
                getBroker()
                  .publish({
                    channel,
                    event: data.event || 'message',
                    data: data.data !== undefined ? data.data : data,
                    timestamp: Date.now(),
                    source: name,
                  })
                  .catch((e: any) => {
                    this.logger.debug('Failed to publish broker event', { error: e?.message || e });
                  });
              })
              .catch((e: any) => {
                this.logger.debug('Failed to import photon-core for broker', {
                  error: e?.message || e,
                });
              });
          }
        };

        // Inject convenience helpers (render, toast, log, status, progress, thinking)
        injectEmitHelpers(instance);
      }

      if (caps.has('memory')) {
        const memoryBaseDir = this.baseDir;
        Object.defineProperty(instance, 'memory', {
          get() {
            if (!this._memory) {
              this._memory = new MemoryProvider(
                name,
                this._sessionId,
                this._photonNamespace,
                memoryBaseDir
              );
            }
            return this._memory;
          },
          configurable: true,
        });
      }

      if (caps.has('call') && !instance.call) {
        instance.call = async (
          target: string,
          params: Record<string, any> = {},
          opts?: { instance?: string }
        ) => {
          const dotIndex = target.indexOf('.');
          if (dotIndex === -1) {
            throw new Error(`Invalid call target: '${target}'. Expected 'photonName.methodName'`);
          }
          if (!instance._callHandler) {
            throw new Error(`Cross-photon calls not available for ${name}.`);
          }
          return (instance._callHandler as (...args: unknown[]) => unknown)(
            target.slice(0, dotIndex),
            target.slice(dotIndex + 1),
            params,
            opts?.instance
          );
        };
      }
    }

    // Channel event capability: inject on()/off()/_dispatch()/_matchesFilter()
    // when source uses this._dispatch( — the universal channel dispatch pattern.
    // (Mirrors the same injection in loadFile for disk-based loading.)
    if (
      tsContent &&
      /(?:this\._dispatch\s*\(|\(this\s+as\s+any\)\._dispatch\s*\()/.test(tsContent)
    ) {
      const inst = instance as PhotonInstance;
      if (!inst._eventListeners) {
        inst._eventListeners = [];
      }

      if (!inst.on) {
        inst.on = function (event: string, fn: (data: unknown) => void, filter?: EventFilter) {
          inst._eventListeners!.push({ event, fn, filter });
        };
      }

      if (!inst.off) {
        inst.off = function (event: string, fn: (data: unknown) => void) {
          const idx = inst._eventListeners!.findIndex(
            (e: EventListenerEntry) => e.event === event && e.fn === fn
          );
          if (idx !== -1) inst._eventListeners!.splice(idx, 1);
        };
      }

      if (!inst._matchesFilter) {
        inst._matchesFilter = function (
          filter: EventFilter | undefined,
          chatId: string,
          message: ChannelMessage,
          groupName?: string
        ): boolean {
          if (!filter) return true;
          if (filter.chatId && filter.chatId !== chatId) return false;
          if (filter.group && groupName) {
            const fg = filter.group.toLowerCase();
            if (!groupName.toLowerCase().includes(fg) && chatId !== filter.group) return false;
          }
          if (filter.trigger && message?.content && !message.content.includes(filter.trigger))
            return false;
          if (filter.fromMe !== undefined && message?.fromMe !== filter.fromMe) return false;
          return true;
        };
      }

      if (!inst._dispatch) {
        inst._dispatch = function (chatId: string, message: ChannelMessage, groupName?: string) {
          for (const entry of inst._eventListeners!) {
            if (entry.event !== 'message') continue;
            if (inst._matchesFilter!(entry.filter, chatId, message, groupName)) {
              try {
                entry.fn({ chatId, message });
              } catch {
                // handler error — don't crash the dispatch loop
              }
            }
          }
        };
      }

      this.log(`🔌 Injected channel event infrastructure into ${name}`);
    }

    // Check @cli dependencies (external tools like git, ffmpeg, etc.)
    if (tsContent) {
      await this.checkCLIDependencies(tsContent, name);
    }

    // Call lifecycle hook
    const onInitialize = instance.onInitialize;
    if (typeof onInitialize === 'function' && !options?.skipInitialize) {
      this.onProgress?.('running onInitialize');
      try {
        await onInitialize.call(instance);
      } catch (error) {
        const initError = new Error(`Initialization failed for ${name}: ${getErrorMessage(error)}`);
        initError.name = 'PhotonInitializationError';
        throw initError;
      }
    }

    // Extract tools and metadata from embedded source (no disk I/O)
    const {
      tools,
      templates,
      statics,
      settingsSchema,
      auth: extractedAuth,
    } = await this.extractTools(MCPClass, absolutePath, tsContent);

    // Settings injection
    if (settingsSchema?.hasSettings && instance.settings && typeof instance.settings === 'object') {
      const instanceName = options?.instanceName || 'default';
      await this.injectSettings(instance, name, instanceName, settingsSchema);
      tools.push(this.generateSettingsTool(settingsSchema));
    }

    // Discover assets (for @ui)
    const assets = await this.discoverAssets(absolutePath, tsContent);
    this.attachAssetsToInstance(instance, assets);

    this.log(`✅ Loaded (preloaded): ${name} (${tools.length} tools)`);

    // Extract class-level metadata from docblock (icon, description, stateful)
    const classDocblock = this.extractClassDocblock(tsContent);
    const classIcon = classDocblock.match(/@icon\s+([^\s@*,]+)/)?.[1];
    const classDesc = classDocblock.match(/^\s*\*\s+([^@*\n][^\n]*)/m)?.[1]?.trim();
    const isStateful = /@stateful\b/.test(classDocblock);

    const result: PhotonClassExtended & {
      classConstructor?: Record<string, unknown>;
      settingsSchema?: SettingsSchema;
      icon?: string;
      stateful?: boolean;
      auth?: string;
    } = {
      name,
      description: classDesc || `${name} MCP`,
      tools,
      templates,
      statics,
      instance,
      assets,
      injectedPhotons: injectedPhotonNames.length > 0 ? injectedPhotonNames : undefined,
    };
    if (classIcon) result.icon = classIcon;
    if (isStateful) result.stateful = true;
    if (extractedAuth) result.auth = extractedAuth;
    result.classConstructor = MCPClass as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    if (settingsSchema?.hasSettings) {
      result.settingsSchema = settingsSchema;
    }
    return result;
  }

  /**
   * Extract the class-level JSDoc comment block from source code.
   * Returns the raw docblock content (between the last comment before `class` and the class keyword).
   */
  private extractClassDocblock(source: string): string {
    // Match the JSDoc comment immediately preceding `export default class`
    const match = source.match(/\/\*\*([\s\S]*?)\*\/\s*export\s+default\s+class\b/);
    return match ? match[1] : '';
  }

  private extractAuthTag(source: string): string | undefined {
    const docblock = this.extractClassDocblock(source);
    // Use \b to avoid matching @author, @authorize, etc.
    const match = docblock.match(/@auth\b(?:\s+(\S+))?/i);
    if (!match) return undefined;
    return match[1]?.trim() || 'required';
  }

  /**
   * Reload a Photon MCP file (for hot reload)
   */
  async reloadFile(filePath: string): Promise<PhotonClassExtended> {
    // Invalidate the cache for this file
    const absolutePath = path.resolve(filePath);

    if (absolutePath.endsWith('.ts')) {
      // Clear the compiled cache
      const tsContent = await readText(absolutePath);
      const hash = crypto.createHash('sha256').update(tsContent).digest('hex').slice(0, 16);
      const mcpName = path.basename(absolutePath, '.ts').replace('.photon', '');
      const cacheKey = this.getCacheKey(mcpName, absolutePath);
      const buildDir = this.getBuildCacheDir(cacheKey);
      const fileName = path.basename(absolutePath, '.ts');
      const cachedJsPath = path.join(buildDir, `${fileName}.${hash}.mjs`);

      try {
        await fs.unlink(cachedJsPath);
      } catch {
        // Ignore if file doesn't exist
      }

      // Clean stale cache files (old content hashes)
      const files = await fs.readdir(buildDir).catch(() => [] as string[]);
      for (const f of files) {
        if (f.startsWith(fileName) && f.endsWith('.mjs')) {
          await fs.unlink(path.join(buildDir, f)).catch(() => {});
        }
      }
    }

    return this.loadFile(filePath);
  }

  /**
   * Compile TypeScript file to JavaScript and cache it
   * Delegates to shared compilePhotonTS from photon-core
   */
  private async compileTypeScript(
    tsFilePath: string,
    cacheKey: string,
    tsContent?: string
  ): Promise<string> {
    const cacheDir = this.getBuildCacheDir(cacheKey);
    const result = await compilePhotonTS(tsFilePath, { cacheDir, content: tsContent });
    this.log(`Compiled: ${path.basename(tsFilePath)}`, { cached: result });
    return result;
  }

  /**
   * Find the MCP class in a module
   * Delegates to shared findPhotonClass from photon-core
   */
  private findMCPClass(module: Record<string, unknown>): unknown {
    return sharedFindPhotonClass(module);
  }

  /**
   * Check if a function is a class constructor
   * Delegates to shared isClass from photon-core
   */
  private isClass(fn: unknown): fn is new (...args: unknown[]) => unknown {
    return sharedIsClass(fn);
  }

  /**
   * Get MCP name from class
   */
  private getMCPName(mcpClass: new (...args: unknown[]) => unknown): string {
    // Try to use Photon base class's method if available
    const classWithStatic = mcpClass as { getMCPName?: () => string; name: string };
    if (typeof classWithStatic.getMCPName === 'function') {
      return classWithStatic.getMCPName();
    }

    // Fallback: implement convention for plain classes
    // Convert PascalCase to kebab-case (e.g., MyAwesomeMCP → my-awesome-mcp)
    return classWithStatic.name
      .replace(/MCP$/, '') // Remove "MCP" suffix if present
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, ''); // Remove leading dash
  }

  /**
   * Get tool methods from class
   */
  private getToolMethods(mcpClass: new (...args: unknown[]) => unknown): string[] {
    // Try to use Photon base class's method if available
    const classWithStatic = mcpClass as {
      getToolMethods?: () => string[];
      prototype: Record<string, unknown>;
    };
    if (typeof classWithStatic.getToolMethods === 'function') {
      return classWithStatic.getToolMethods();
    }

    // Fallback: implement convention for plain classes
    const prototype = classWithStatic.prototype;
    const methods: string[] = [];
    const conventionMethods = new Set(['constructor', 'onInitialize', 'onShutdown']);
    const builtInStatics = new Set(['length', 'name', 'prototype', 'getToolMethods']);

    // Get instance methods from prototype
    // Use getOwnPropertyDescriptor to avoid triggering getters (which may call storage())
    Object.getOwnPropertyNames(prototype).forEach((name) => {
      if (name.startsWith('_') || conventionMethods.has(name)) return;
      const desc = Object.getOwnPropertyDescriptor(prototype, name);
      if (desc && typeof desc.value === 'function') {
        methods.push(name);
      }
    });

    // Get static methods from class constructor
    const classAsRecord = mcpClass as unknown as Record<string, unknown>;
    Object.getOwnPropertyNames(mcpClass).forEach((name) => {
      if (
        !name.startsWith('_') &&
        !builtInStatics.has(name) &&
        !conventionMethods.has(name) &&
        typeof classAsRecord[name] === 'function'
      ) {
        methods.push(name);
      }
    });

    return methods;
  }

  /**
   * Strip JSDoc tags from descriptions (e.g., @emits, @internal, @deprecated)
   */
  private stripJSDocTags(description: string | undefined): string {
    if (!description) return '';
    if (description.includes('@emits') && process.env.PHOTON_DEBUG_EXTRACT) {
      console.log(`[stripJSDocTags] Input: "${description}"`);
    }
    // Remove lines that start with @ (full line removal)
    let cleaned = description
      .split('\n')
      .filter((line) => !line.trim().startsWith('@'))
      .join('\n')
      .trim();
    // Also remove inline @ tags (e.g., "text @emits ... " at end of line)
    cleaned = cleaned.replace(/\s*@\w+.*$/gm, '').trim();
    if (description.includes('@emits') && process.env.PHOTON_DEBUG_EXTRACT) {
      console.log(`[stripJSDocTags] Output: "${cleaned}"`);
    }
    return cleaned;
  }

  /**
   * Extract tools, templates, and statics from a class
   */
  private async extractTools(
    mcpClass: new (...args: unknown[]) => unknown,
    sourceFilePath: string,
    sourceContent?: string
  ): Promise<{
    tools: PhotonTool[];
    templates: TemplateInfo[];
    statics: StaticInfo[];
    settingsSchema?: SettingsSchema;
    auth?: string;
  }> {
    const methodNames = this.getToolMethods(mcpClass);
    let tools: PhotonTool[] = [];
    let templates: TemplateInfo[] = [];
    let statics: StaticInfo[] = [];

    try {
      // First, try loading from manual schema override file
      const schemaJsonPath = sourceFilePath.replace(/\.ts$/, '.schema.json');
      try {
        const schemas = await readJSON(schemaJsonPath);

        // Process tools
        if (schemas.tools) {
          for (const schema of schemas.tools) {
            if (methodNames.includes(schema.name)) {
              tools.push({
                name: schema.name,
                description: schema.description || `${schema.name} tool`,
                inputSchema: schema.inputSchema || { type: 'object', properties: {} },
              });
            }
          }
        }

        // Process templates
        if (schemas.templates) {
          for (const schema of schemas.templates) {
            if (methodNames.includes(schema.name)) {
              templates.push({
                name: schema.name,
                description: schema.description || `${schema.name} template`,
                inputSchema: schema.inputSchema || { type: 'object', properties: {} },
              });
            }
          }
        }

        // Process statics
        if (schemas.statics) {
          for (const schema of schemas.statics) {
            if (methodNames.includes(schema.name)) {
              statics.push({
                name: schema.name,
                uri: schema.uri || `static://${schema.name}`,
                description: schema.description || `${schema.name} resource`,
                mimeType: schema.mimeType,
                inputSchema: schema.inputSchema || { type: 'object', properties: {} },
              });
            }
          }
        }

        this.log(
          `Loaded ${tools.length} tools, ${templates.length} templates, ${statics.length} statics from .schema.json override`
        );
        // Clean JSDoc tags from descriptions
        tools = tools.map((t) => ({ ...t, description: this.stripJSDocTags(t.description) }));
        templates = templates.map((t) => ({
          ...t,
          description: this.stripJSDocTags(t.description),
        }));
        statics = statics.map((s) => ({ ...s, description: this.stripJSDocTags(s.description) }));
        return { tools, templates, statics };
      } catch (jsonError: unknown) {
        // .schema.json doesn't exist, try extracting from .ts source
        const isNotFound =
          jsonError instanceof Error &&
          'code' in jsonError &&
          (jsonError as NodeJS.ErrnoException).code === 'ENOENT';
        if (isNotFound) {
          const extractor = new SchemaExtractor();
          const source = sourceContent || (await readText(sourceFilePath));
          const metadata = extractor.extractAllFromSource(source);

          // Filter by method names that exist in the class
          tools = metadata.tools.filter((t) => methodNames.includes(t.name));
          templates = metadata.templates.filter((t) => methodNames.includes(t.name));
          statics = metadata.statics.filter((s) => methodNames.includes(s.name));

          this.log(
            `Extracted ${tools.length} tools, ${templates.length} templates, ${statics.length} statics from source`
          );
          // Clean JSDoc tags from descriptions
          if (process.env.PHOTON_DEBUG_EXTRACT) {
            tools.forEach((t) => {
              if (t.description?.includes('@')) {
                console.log(`[EXTRACTOR] Before clean: ${t.name}: "${t.description}"`);
              }
            });
          }
          tools = tools.map((t) => ({ ...t, description: this.stripJSDocTags(t.description) }));
          templates = templates.map((t) => ({
            ...t,
            description: this.stripJSDocTags(t.description),
          }));
          statics = statics.map((s) => ({ ...s, description: this.stripJSDocTags(s.description) }));
          if (process.env.PHOTON_DEBUG_EXTRACT) {
            tools.forEach((t) => {
              if (t.name === 'clear') {
                console.log(`[EXTRACTOR] After clean: ${t.name}: "${t.description}"`);
              }
            });
          }
          return {
            tools,
            templates,
            statics,
            settingsSchema: metadata.settingsSchema,
            auth: this.extractAuthTag(source),
          };
        }
        throw jsonError;
      }
    } catch (error) {
      this.logger.warn(
        `⚠️  Failed to extract schemas: ${getErrorMessage(error)}. Using basic tools.`
      );

      // Fallback: create basic tools without detailed schemas
      for (const methodName of methodNames) {
        tools.push({
          name: methodName,
          description: `${methodName} tool`,
          inputSchema: {
            type: 'object',
            properties: {},
          },
        });
      }
    }

    // Clean JSDoc tags from all descriptions (final safety net)
    tools = tools.map((t) => ({ ...t, description: this.stripJSDocTags(t.description) }));
    templates = templates.map((t) => ({ ...t, description: this.stripJSDocTags(t.description) }));
    statics = statics.map((s) => ({ ...s, description: this.stripJSDocTags(s.description) }));
    return { tools, templates, statics };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SETTINGS — property-driven configuration with auto-persistence
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get the settings persistence path for a photon instance
   */
  private getSettingsPath(photonName: string, instanceName: string): string {
    return path.join(this.baseDir, 'state', photonName, `${instanceName}-settings.json`);
  }

  /**
   * Load persisted settings from disk
   */
  private async loadSettings(
    photonName: string,
    instanceName: string
  ): Promise<Record<string, any>> {
    const settingsPath = this.getSettingsPath(photonName, instanceName);
    try {
      return await readJSON(settingsPath);
    } catch {
      return {};
    }
  }

  /**
   * Persist settings to disk
   */
  private async persistSettings(
    photonName: string,
    instanceName: string,
    values: Record<string, any>
  ): Promise<void> {
    const settingsPath = this.getSettingsPath(photonName, instanceName);
    const dir = path.dirname(settingsPath);
    await fs.mkdir(dir, { recursive: true });
    await writeJSON(settingsPath, values);
  }

  /**
   * Inject settings into a photon instance:
   * - Load persisted values (persisted wins over defaults)
   * - Replace instance.settings with a read-only Proxy
   * - Store writable backing object for the settings tool
   */
  private async injectSettings(
    instance: Record<string, unknown>,
    photonName: string,
    instanceName: string,
    schema: SettingsSchema
  ): Promise<void> {
    const defaults = instance.settings as Record<string, any>;
    const persisted = await this.loadSettings(photonName, instanceName);

    // Merge: persisted values over defaults
    const backing: Record<string, any> = { ...defaults };
    for (const key of Object.keys(persisted)) {
      if (persisted[key] !== undefined) {
        backing[key] = persisted[key];
      }
    }

    // Store the writable backing object for the settings tool to update
    instance._settingsBacking = backing;
    instance._settingsPhotonName = photonName;
    instance._settingsInstanceName = instanceName;
    instance._settingsSchema = schema;

    // Replace with read-only Proxy
    instance.settings = new Proxy(backing, {
      get(target, prop) {
        if (typeof prop === 'string') {
          return target[prop];
        }
        return undefined;
      },
      set(_target, prop, _value) {
        throw new Error(
          `Cannot directly set settings.${String(prop)}. ` +
            `Use the 'settings' tool to change settings (e.g., settings({ ${String(prop)}: newValue })).`
        );
      },
      deleteProperty(_target, prop) {
        throw new Error(`Cannot delete settings.${String(prop)}. Use the 'settings' tool instead.`);
      },
    });
  }

  /**
   * Generate an MCP tool definition from a SettingsSchema
   */
  private generateSettingsTool(schema: SettingsSchema): PhotonTool {
    const properties: Record<string, any> = {};

    for (const prop of schema.properties) {
      const propSchema: Record<string, any> = { type: prop.type };
      if (prop.description) {
        propSchema.description = prop.description;
      }
      if (prop.default !== undefined) {
        propSchema.default = prop.default;
      }
      properties[prop.name] = propSchema;
    }

    return {
      name: 'settings',
      description:
        'View or update photon settings. Call with no arguments to view current settings. Pass parameters to update specific settings.',
      inputSchema: {
        type: 'object',
        properties,
        // No required params — all settings are optional when calling the tool
      },
    };
  }

  /**
   * Execute the auto-generated settings tool:
   * - No params → return current settings
   * - Params with values → update those settings, persist, emit change
   * - Params with undefined + no default → trigger elicitation
   */
  async executeSettingsTool(
    instance: Record<string, unknown>,
    parameters: Record<string, any> | undefined,
    options?: { outputHandler?: OutputHandler; inputProvider?: InputProvider }
  ): Promise<Record<string, any>> {
    const backing = instance._settingsBacking as Record<string, any>;
    const photonName = instance._settingsPhotonName as string;
    const instanceName = instance._settingsInstanceName as string;
    const schema = instance._settingsSchema as SettingsSchema;

    if (!backing || !photonName || !schema) {
      throw new Error('Settings not initialized for this photon');
    }

    // No params or empty params → return current settings
    if (!parameters || Object.keys(parameters).length === 0) {
      // Check if any required settings (undefined defaults) need elicitation
      const needsElicitation = schema.properties.filter(
        (p) => p.required && backing[p.name] === undefined
      );

      if (needsElicitation.length > 0 && options?.inputProvider) {
        for (const prop of needsElicitation) {
          const result = await options.inputProvider({
            ask: prop.type === 'number' ? 'number' : 'text',
            message: prop.description || `Enter value for ${prop.name}:`,
          } as AskYield);
          if (result !== undefined && result !== null) {
            const oldValue = backing[prop.name];
            backing[prop.name] = result;
            this.log(`⚙️  Settings: ${prop.name} = ${JSON.stringify(result)} (elicited)`);
            this.emitSettingsChange(instance, prop.name, oldValue, result);
          }
        }
        await this.persistSettings(photonName, instanceName, backing);
      }

      return { ...backing };
    }

    // Update specified settings
    const changes: Array<{ property: string; oldValue: any; newValue: any }> = [];

    for (const [key, value] of Object.entries(parameters)) {
      // Verify this is a valid setting
      const prop = schema.properties.find((p) => p.name === key);
      if (!prop) continue;

      if (value === undefined && prop.required) {
        // Elicit value from user
        if (options?.inputProvider) {
          const result = await options.inputProvider({
            ask: prop.type === 'number' ? 'number' : 'text',
            message: prop.description || `Enter value for ${key}:`,
          } as AskYield);
          if (result !== undefined && result !== null) {
            const oldValue = backing[key];
            backing[key] = result;
            changes.push({ property: key, oldValue, newValue: result });
          }
        }
      } else {
        const oldValue = backing[key];
        backing[key] = value;
        changes.push({ property: key, oldValue, newValue: value });
      }
    }

    // Persist if anything changed
    if (changes.length > 0) {
      await this.persistSettings(photonName, instanceName, backing);

      for (const change of changes) {
        this.log(
          `⚙️  Settings: ${change.property}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`
        );
        this.emitSettingsChange(instance, change.property, change.oldValue, change.newValue);
      }
    }

    // Re-apply proxy (backing object is already updated in place, proxy still references it)
    return { ...backing };
  }

  /**
   * Emit a settings:changed event through the photon's emit system
   */
  private emitSettingsChange(
    instance: Record<string, unknown>,
    property: string,
    oldValue: any,
    newValue: any
  ): void {
    if (typeof instance.emit === 'function') {
      try {
        (instance.emit as (...args: unknown[]) => void)({
          event: 'settings:changed',
          data: {
            property,
            oldValue,
            newValue,
            timestamp: Date.now(),
          },
        });
      } catch {
        // Best-effort emit
      }
    }
  }

  /**
   * Extract constructor parameters from source file
   */
  async extractConstructorParams(filePath: string): Promise<ConstructorParam[]> {
    try {
      const source = await readText(filePath);
      const extractor = new SchemaExtractor();
      return extractor.extractConstructorParams(source);
    } catch (error) {
      this.logger.warn(`Failed to extract constructor params: ${getErrorMessage(error)}`);
      return [];
    }
  }

  /**
   * Resolve all constructor injections using type-based detection
   * - Primitives (string, number, boolean) → env var
   * - Non-primitives matching @mcp → MCP client
   * - Non-primitives matching @photon → Photon instance
   *
   * Throws MCPConfigurationError if MCP dependencies are missing
   */
  private async resolveAllInjections(
    source: string,
    mcpName: string,
    photonPath: string,
    instanceName: string = ''
  ): Promise<{ values: any[]; configError: string | null; injectedPhotonNames: string[] }> {
    // Detect optional dependencies: @photon name source? or @mcp name source?
    // The ? suffix on the source marks the dependency as optional — inject null on failure
    const optionalPhotons = new Set<string>();
    const optionalMCPs = new Set<string>();
    for (const m of source.matchAll(/@photon\s+(\w+)\s+\S+\?/g)) {
      optionalPhotons.add(m[1]);
    }
    for (const m of source.matchAll(/@mcp\s+(\w+)\s+\S+\?/g)) {
      optionalMCPs.add(m[1]);
    }

    // Strip ? from @photon/@mcp sources before passing to photon-core's parser,
    // which doesn't understand the optional suffix
    const cleanedSource = source
      .replace(/@photon\s+(\w+)\s+(\S+)\?/g, '@photon $1 $2')
      .replace(/@mcp\s+(\w+)\s+(\S+)\?/g, '@mcp $1 $2');

    const extractor = new SchemaExtractor();
    const injections = extractor.resolveInjections(cleanedSource, mcpName);

    // Lazy-load env store and instance state path
    const { EnvStore, getInstanceStatePath } = await import('./context-store.js');
    const envStore = new EnvStore(this.baseDir);

    const values: any[] = [];
    const missingEnvVars: Array<{ paramName: string; envVarName: string; type: string }> = [];
    const missingMCPs: MissingMCPInfo[] = [];
    const missingPhotons: string[] = [];
    const injectedPhotonNames: string[] = [];

    for (const injection of injections) {
      const { param, injectionType } = injection;

      switch (injectionType) {
        case 'env': {
          // All primitive params are env: check EnvStore first, then process.env
          const envVarName = injection.envVarName!;
          const storedValue = envStore.resolve(mcpName, param.name, envVarName);

          if (storedValue !== undefined) {
            values.push(this.parseEnvValue(storedValue, param.type));
            this.log(
              `  ✅ Env: ${param.name} (from ${storedValue === process.env[envVarName] ? 'process.env' : 'env store'})`
            );
          } else if (param.hasDefault || param.isOptional) {
            values.push(undefined); // constructor default applies
          } else {
            missingEnvVars.push({
              paramName: param.name,
              envVarName,
              type: param.type,
            });
            values.push(undefined);
          }
          break;
        }

        case 'mcp': {
          // Inject MCP client
          const mcpDep = injection.mcpDependency!;
          const isOptionalMCP = optionalMCPs.has(mcpDep.name);
          try {
            const client = await this.getMCPClient(mcpDep);
            values.push(client);
            this.log(`  ✅ Injected MCP: ${mcpDep.name} (${mcpDep.source})`);
          } catch (error) {
            // If it's already an MCPConfigurationError and not optional, re-throw it directly
            if (error instanceof MCPConfigurationError && !isOptionalMCP) {
              throw error;
            }

            if (isOptionalMCP) {
              this.log(`  ⚠️ Optional MCP ${mcpDep.name} unavailable, injecting null`);
              values.push(null);
            } else {
              this.log(
                `  ⚠️ Failed to create MCP client for ${mcpDep.name}: ${getErrorMessage(error)}`
              );
              missingMCPs.push({
                name: mcpDep.name,
                source: mcpDep.source,
                sourceType: mcpDep.sourceType as MCPSourceType,
                declaredIn: path.basename(photonPath),
                originalError: getErrorMessage(error),
              });
              values.push(undefined);
            }
          }
          break;
        }

        case 'photon': {
          // Inject Photon instance
          const photonDep = injection.photonDependency!;
          const isOptionalPhoton = optionalPhotons.has(photonDep.name);
          try {
            const photonInstance = await this.getPhotonInstance(
              photonDep,
              photonPath,
              instanceName
            );
            values.push(photonInstance);
            injectedPhotonNames.push(photonDep.name);
            this.log(`  ✅ Injected Photon: ${photonDep.name} (${photonDep.source})`);
          } catch (error) {
            if (isOptionalPhoton) {
              this.log(`  ⚠️ Optional Photon ${photonDep.name} unavailable, injecting null`);
              values.push(null);
            } else {
              this.log(`  ⚠️ Failed to load Photon ${photonDep.name}: ${getErrorMessage(error)}`);
              missingPhotons.push(
                `@photon ${photonDep.name} ${photonDep.source}: ${getErrorMessage(error)}`
              );
              values.push(undefined);
            }
          }
          break;
        }

        case 'state': {
          // Inject persisted state from instance-specific state file
          const stateKey = injection.stateKey!;
          const stateFile = getInstanceStatePath(mcpName, instanceName, this.baseDir, photonPath);
          try {
            const snapshot = await readJSON(stateFile);
            if (stateKey in snapshot) {
              values.push(snapshot[stateKey]);
              this.log(`  ✅ Restored state: ${stateKey} (from ${stateFile})`);
            } else {
              values.push(undefined); // constructor default applies
              this.log(`  ℹ️ No saved state for key '${stateKey}', using default`);
            }
          } catch {
            // No snapshot file → first run, constructor default applies
            values.push(undefined);
            this.log(`  ℹ️ No state snapshot for ${mcpName}, using defaults`);
          }
          break;
        }
      }
    }

    // Throw MCPConfigurationError immediately if MCP dependencies are missing
    // This provides actionable guidance to users
    if (missingMCPs.length > 0) {
      throw new MCPConfigurationError(missingMCPs);
    }

    // Build config error for env vars and photon dependencies
    let configError: string | null = null;
    if (missingEnvVars.length > 0 || missingPhotons.length > 0) {
      const parts: string[] = [];

      if (missingEnvVars.length > 0) {
        parts.push(generateConfigErrorMessage(mcpName, missingEnvVars));
      }

      if (missingPhotons.length > 0) {
        parts.push(
          `Missing Photon dependencies:\n` +
            missingPhotons.map((d) => `  • ${d}`).join('\n') +
            `\n\nEnsure these Photons are installed and accessible.`
        );
      }

      configError = parts.join('\n\n');
    }

    return { values, configError, injectedPhotonNames };
  }

  /**
   * Get or create an MCP client for a dependency
   *
   * Resolution order:
   * 1. Check ~/.photon/config.json for configured server
   * 2. Fall back to resolving from @mcp declaration source
   *
   * Validates connection on first use - throws MCPConfigurationError if connection fails
   */
  private async getMCPClient(dep: MCPDependency): Promise<any> {
    // Check cache first
    if (this.mcpClients.has(dep.name)) {
      return this.mcpClients.get(dep.name);
    }

    // Dedup concurrent loads: if another call is already creating this client, wait for it
    if (this.mcpClientPromises.has(dep.name)) {
      return this.mcpClientPromises.get(dep.name);
    }

    const promise = this._createMCPClient(dep);
    this.mcpClientPromises.set(dep.name, promise);
    try {
      return await promise;
    } finally {
      this.mcpClientPromises.delete(dep.name);
    }
  }

  private async _createMCPClient(dep: MCPDependency): Promise<any> {
    // Try to get config from ~/.photon/config.json first
    const photonConfig = await this.ensureMCPConfig();
    let serverConfig: MCPServerConfig;
    let isFromConfig = false;

    if (photonConfig.mcpServers[dep.name]) {
      // Use pre-configured server from config.json
      serverConfig = resolveEnvVars(photonConfig.mcpServers[dep.name]);
      isFromConfig = true;
      this.log(`  Using configured MCP: ${dep.name} from config.json`);
    } else {
      // Fall back to resolving from @mcp declaration
      serverConfig = resolveMCPSource(dep.name, dep.source, dep.sourceType);
      this.log(`  Resolving MCP: ${dep.name} from @mcp declaration (${dep.source})`);
    }

    // Build config with this MCP
    const mcpConfig: MCPConfig = {
      mcpServers: {
        [dep.name]: serverConfig,
      },
    };

    // Create a factory for this MCP
    // Note: Each MCP gets its own factory for isolation
    const factory = new SDKMCPClientFactory(mcpConfig, this.verbose);

    // Create client and proxy
    const client = factory.create(dep.name);
    const proxy = createMCPProxy(client);

    // Validate connection by attempting to list tools
    // This catches configuration errors early (missing env vars, wrong command, etc.)
    try {
      this.log(`  Connecting to MCP: ${dep.name}...`);
      await client.list();
      this.log(`  ✅ Connected to MCP: ${dep.name}`);
    } catch (error) {
      const errorMsg = getErrorMessage(error) || 'Unknown connection error';

      // If not configured in mcp-servers.json, throw configuration error
      if (!isFromConfig) {
        throw new MCPConfigurationError([
          {
            name: dep.name,
            source: dep.source,
            sourceType: dep.sourceType as MCPSourceType,
            originalError: errorMsg,
          },
        ]);
      }

      // If configured but failed, provide more specific error
      throw new Error(
        `MCP "${dep.name}" is configured but failed to connect: ${errorMsg}\n` +
          `Check your config.json configuration and ensure:\n` +
          `  • The command/URL is correct\n` +
          `  • Required environment variables are set\n` +
          `  • The MCP server is accessible`
      );
    }

    // Cache it
    this.mcpClients.set(dep.name, proxy);

    return proxy;
  }

  /**
   * Get or load a Photon instance for a dependency.
   * When dep.instanceName is set, loads a named instance (separate state).
   * When callerInstanceName is set and dep has no explicit instanceName,
   * the caller's instance name is inherited (multi-tenancy support).
   */
  private async getPhotonInstance(
    dep: PhotonDependency,
    currentPhotonPath: string,
    callerInstanceName?: string
  ): Promise<any> {
    // Check preloaded dependencies first (compiled binary mode)
    if (this.preloadedDependencies) {
      const preloaded =
        this.preloadedDependencies.get(dep.name) || this.preloadedDependencies.get(dep.source);
      if (preloaded) {
        // Stub modules (failed native deps like sharp on wrong arch) have default: null
        if (!preloaded.module?.default) {
          this.log(`  ⚠️ Skipping stub dependency: ${dep.name} (module failed to load)`);
          return undefined;
        }
        const cacheKey = dep.instanceName
          ? `preloaded:${dep.name}::${dep.instanceName}`
          : `preloaded:${dep.name}`;
        if (this.loadedPhotons.has(cacheKey)) {
          return this.loadedPhotons.get(cacheKey)!.instance;
        }
        this.log(`  📦 Loading preloaded dependency: ${dep.name}`);
        const loaded = await this.loadFromModule(
          preloaded.module,
          preloaded.filePath,
          preloaded.source,
          dep.instanceName ? { instanceName: dep.instanceName } : undefined
        );
        this.loadedPhotons.set(cacheKey, loaded);
        return loaded.instance;
      }
    }

    // Resolve the Photon path
    const resolvedPath = await this.resolvePhotonPath(dep, currentPhotonPath);
    await this.materializeSiblingDependencySymlink(dep, currentPhotonPath, resolvedPath);

    // Cache key includes instance name to allow multiple instances of the same photon
    const cacheKey = dep.instanceName ? `${resolvedPath}::${dep.instanceName}` : resolvedPath;

    // Check cache
    if (this.loadedPhotons.has(cacheKey)) {
      return this.loadedPhotons.get(cacheKey)!.instance;
    }

    // Ask the daemon for a shared instance (avoids duplicate WhatsApp sockets, etc.)
    // Pass effective instance name: explicit dep.instanceName takes priority,
    // otherwise inherit from the caller (multi-tenancy: claw[arul] → whatsapp[arul])
    if (this.photonInstanceResolver) {
      const effectiveInstance = dep.instanceName || callerInstanceName;
      const shared = await this.photonInstanceResolver(dep.name, resolvedPath, effectiveInstance);
      if (shared) {
        const label = effectiveInstance ? ` (instance: ${effectiveInstance})` : '';
        this.log(`  ♻️ Reusing shared instance for @photon ${dep.name}${label}`);
        return shared;
      }
    }

    // Dedup concurrent loads: if another call is already loading this path, wait for it
    if (this.loadedPhotonPromises.has(cacheKey)) {
      const loaded = await this.loadedPhotonPromises.get(cacheKey);
      return loaded.instance;
    }

    // Load the Photon (recursive call)
    const instanceLabel = dep.instanceName ? ` (instance: ${dep.instanceName})` : '';
    this.log(`  📦 Loading Photon dependency: ${dep.name} from ${resolvedPath}${instanceLabel}`);
    const loadPromise = this.loadFile(
      resolvedPath,
      dep.instanceName ? { instanceName: dep.instanceName } : undefined
    );
    this.loadedPhotonPromises.set(cacheKey, loadPromise);
    try {
      const loaded = await loadPromise;
      // Cache it
      this.loadedPhotons.set(cacheKey, loaded);
      return loaded.instance;
    } finally {
      this.loadedPhotonPromises.delete(cacheKey);
    }
  }

  /**
   * Dynamic photon resolution for this.photon.use().
   *
   * Supports:
   * - Short names: 'whatsapp' → resolves via marketplace path
   * - Namespace-qualified: 'portel-dev:whatsapp' → resolves in specific namespace dir
   *
   * Uses the same resolution pipeline as @photon DI but with dynamic names.
   */
  async resolveAndLoadPhoton(
    name: string,
    callerPhotonPath: string,
    instanceName?: string
  ): Promise<any> {
    // Build a synthetic PhotonDependency for reuse of existing resolution
    const dep: PhotonDependency = {
      name: name.replace(/.*:/, ''), // strip namespace prefix for the dep name
      source: name, // full name including namespace
      sourceType: 'marketplace', // resolveMarketplacePhoton handles namespace:name
    };
    if (instanceName) {
      dep.instanceName = instanceName;
    }
    return this.getPhotonInstance(dep, callerPhotonPath);
  }

  /**
   * Resolve Photon dependency path based on source type
   */
  private async resolvePhotonPath(
    dep: PhotonDependency,
    currentPhotonPath: string
  ): Promise<string> {
    const resolvedCurrentPhotonPath = await this.resolveRealPhotonPath(currentPhotonPath);

    switch (dep.sourceType) {
      case 'local':
        if (dep.source.startsWith('./') || dep.source.startsWith('../')) {
          return path.resolve(path.dirname(resolvedCurrentPhotonPath), dep.source);
        }
        return dep.source;

      case 'marketplace':
        return await this.resolveMarketplacePhoton(dep, resolvedCurrentPhotonPath);

      case 'github':
        return await this.fetchGithubPhoton(dep);

      case 'npm':
        return await this.resolveNpmPhoton(dep);

      default:
        throw new Error(
          `Unknown Photon source type: ${String((dep as { sourceType: string }).sourceType)}`
        );
    }
  }

  private async resolveMarketplacePhoton(
    dep: PhotonDependency,
    currentPhotonPath: string
  ): Promise<string> {
    // Check for namespace:name format in the source
    const colonIndex = dep.source.indexOf(':');
    let explicitNamespace: string | undefined;
    let sourceForSlug = dep.source;
    if (colonIndex !== -1 && !dep.source.startsWith('.') && !dep.source.startsWith('/')) {
      explicitNamespace = dep.source.slice(0, colonIndex);
      sourceForSlug = dep.source.slice(colonIndex + 1);
    }

    const { slug, fileName, marketplaceHint } = this.normalizeMarketplaceSource(sourceForSlug);
    const photonDir = path.dirname(currentPhotonPath);

    // If explicit namespace, search only that namespace dir
    if (explicitNamespace) {
      const nsPath = path.join(this.baseDir, explicitNamespace, fileName);
      if (await this.pathExists(nsPath)) {
        return nsPath;
      }
      throw new Error(
        `Photon "${dep.source}" not found at ${nsPath}. ` +
          `Ensure the photon is installed in the '${explicitNamespace}' namespace.`
      );
    }

    const candidates = [
      // Same directory as calling photon (same namespace)
      path.resolve(photonDir, fileName),
      path.resolve(photonDir, 'photons', fileName),
      path.resolve(photonDir, 'templates', fileName),
      // Current working directory
      path.join(process.cwd(), fileName),
      path.join(process.cwd(), 'photons', fileName),
      path.join(process.cwd(), 'templates', fileName),
      // Base dir flat files (backward compat)
      path.join(this.baseDir, fileName),
      path.join(this.baseDir, 'photons', fileName),
      path.join(this.baseDir, 'marketplace', fileName),
    ];

    // Also add namespace subdirectory candidates (marketplace/GitHub-installed photons)
    const namespaceCandidates: string[] = [];
    try {
      const { readdir } = await import('fs/promises');
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isDirectory() &&
          ![
            'state',
            'context',
            'env',
            '.cache',
            '.config',
            'node_modules',
            'marketplace',
            'photons',
            'templates',
          ].includes(entry.name) &&
          !entry.name.startsWith('.')
        ) {
          namespaceCandidates.push(path.join(this.baseDir, entry.name, fileName));
        }
      }
    } catch {
      // baseDir doesn't exist yet
    }
    candidates.push(...namespaceCandidates);

    for (const candidate of candidates) {
      if (await this.pathExists(candidate)) {
        return candidate;
      }
    }

    const downloaded = await this.fetchPhotonFromMarketplace(slug, marketplaceHint);
    if (downloaded) {
      return downloaded;
    }

    throw new Error(
      `Photon "${dep.source}" not found in local paths or configured marketplaces. ` +
        `Checked: ${candidates.join(', ')}`
    );
  }

  private async resolveRealPhotonPath(currentPhotonPath: string): Promise<string> {
    try {
      return await fs.realpath(currentPhotonPath);
    } catch {
      return currentPhotonPath;
    }
  }

  private async materializeSiblingDependencySymlink(
    dep: PhotonDependency,
    currentPhotonPath: string,
    resolvedPath: string
  ): Promise<void> {
    if (dep.sourceType !== 'marketplace') return;
    if (dep.source.includes(':')) return;
    if (dep.source.includes('/')) return;

    const realCurrentPhotonPath = await this.resolveRealPhotonPath(currentPhotonPath);
    if (realCurrentPhotonPath === currentPhotonPath) return;
    if (path.dirname(realCurrentPhotonPath) !== path.dirname(resolvedPath)) return;

    // Symlink into the directory where the current photon's symlink lives
    // (e.g. ~/.photon/), NOT this.baseDir which may be a different workspace.
    const symlinkDir = path.dirname(currentPhotonPath);
    const linkPath = path.join(symlinkDir, path.basename(resolvedPath));
    await this.createSymlinkIfMissing(resolvedPath, linkPath);

    const depName = path.basename(resolvedPath).replace(/\.photon\.(ts|js)$/, '');
    const sourceAssetDir = path.join(path.dirname(resolvedPath), depName);
    const targetAssetDir = path.join(symlinkDir, depName);
    if (existsSync(sourceAssetDir)) {
      await this.createSymlinkIfMissing(sourceAssetDir, targetAssetDir, 'dir');
    }
  }

  private async createSymlinkIfMissing(
    sourcePath: string,
    targetPath: string,
    type?: 'dir' | 'file'
  ): Promise<void> {
    try {
      const existing = await fs.lstat(targetPath).catch(() => null);
      if (existing) return;

      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      symlinkSync(sourcePath, targetPath, type);
      this.log(`🔗 Materialized sibling photon symlink: ${path.basename(targetPath)}`);
    } catch (error) {
      this.log(
        `⚠️ Failed to materialize sibling symlink ${path.basename(targetPath)}: ${getErrorMessage(error)}`
      );
    }
  }

  private normalizeMarketplaceSource(source: string): {
    slug: string;
    fileName: string;
    marketplaceHint?: string;
  } {
    let slugSource = source;
    let marketplaceHint: string | undefined;

    if (source.includes('/')) {
      const [hint, rest] = source.split('/', 2);
      if (hint && rest) {
        marketplaceHint = hint;
        slugSource = rest;
      }
    }

    const slug = slugSource
      .replace(/\.photon\.ts$/, '')
      .replace(/\.photon$/, '')
      .replace(/\.ts$/, '')
      .trim();

    const normalizedSlug = slug || slugSource.replace(/[\\/]/g, '-');
    const fileName = `${normalizedSlug}.photon.ts`;
    return { slug: normalizedSlug, fileName, marketplaceHint };
  }

  private async fetchPhotonFromMarketplace(
    slug: string,
    marketplaceHint?: string
  ): Promise<string | null> {
    try {
      const manager = await this.getMarketplaceManager();
      try {
        await manager.autoUpdateStaleCaches();
      } catch {
        // Best effort; stale caches are acceptable
      }

      if (marketplaceHint) {
        const hinted = manager.get(marketplaceHint);
        if (hinted) {
          const hintedPath = await this.fetchPhotonFromSpecificMarketplace(hinted, slug);
          if (hintedPath) {
            return hintedPath;
          }
        }
      }

      const result = await manager.fetchMCP(slug);
      if (result?.content) {
        return await this.writePhotonCacheFile(
          `${result.marketplace.name}-${slug}`,
          result.content,
          result.metadata?.hash
        );
      }
    } catch (error) {
      this.log(`  ⚠️ Marketplace lookup failed for ${slug}: ${getErrorMessage(error)}`);
    }

    return null;
  }

  private async fetchPhotonFromSpecificMarketplace(
    marketplace: Marketplace,
    slug: string
  ): Promise<string | null> {
    try {
      if (marketplace.sourceType === 'local') {
        const localPath = marketplace.url.replace('file://', '');
        const photonPath = path.join(localPath, `${slug}.photon.ts`);
        if (await this.pathExists(photonPath)) {
          return photonPath;
        }
        return null;
      }

      const baseUrl = marketplace.url.replace(/\/$/, '');
      const response = await fetch(`${baseUrl}/${slug}.photon.ts`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        const content = await response.text();
        return await this.writePhotonCacheFile(`${marketplace.name}-${slug}`, content);
      }
    } catch (error) {
      this.log(
        `  ⚠️ Failed to fetch ${slug} from marketplace ${marketplace.name}: ${getErrorMessage(error)}`
      );
    }

    return null;
  }

  private async fetchGithubPhoton(dep: PhotonDependency): Promise<string> {
    const info = this.parseGithubSource(dep);
    const url = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.ref}/${info.filePath}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download Photon from GitHub (${dep.source}): HTTP ${response.status}`
      );
    }
    const content = await response.text();
    const label = `${info.owner}-${info.repo}-${info.filePath.replace(/[\\/]/g, '_')}`;
    return await this.writePhotonCacheFile(label, content);
  }

  private parseGithubSource(dep: PhotonDependency): {
    owner: string;
    repo: string;
    ref: string;
    filePath: string;
  } {
    let source = dep.source
      .replace(/^github:/, '')
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/^git@github\.com:/, '')
      .replace(/\.git$/, '');

    const parts = source.split('/');
    if (parts.length < 2) {
      throw new Error(`Invalid GitHub source: ${dep.source}`);
    }

    const owner = parts.shift()!;
    let repoPart = parts.shift()!;
    let ref = 'main';

    const repoRefMatch = repoPart.match(/([^@]+)@(.+)/);
    if (repoRefMatch) {
      repoPart = repoRefMatch[1];
      ref = repoRefMatch[2];
    }

    if (parts[0] === 'blob' && parts.length >= 2) {
      parts.shift();
      ref = parts.shift()!;
    }

    let filePath: string;
    if (parts.length === 0) {
      const slug = dep.name
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
      filePath = `${slug || 'photon'}.photon.ts`;
    } else {
      filePath = parts.join('/');
      if (!filePath.endsWith('.ts')) {
        filePath = filePath.endsWith('.photon') ? `${filePath}.ts` : `${filePath}.photon.ts`;
      }
    }

    return { owner, repo: repoPart, ref, filePath };
  }

  private async resolveNpmPhoton(dep: PhotonDependency): Promise<string> {
    const { packageSpec, packageName, filePath } = this.parseNpmSource(dep.source);
    const cacheDir = path.join(this.baseDir, '.cache', 'npm', this.sanitizeCacheLabel(packageSpec));
    await fs.mkdir(cacheDir, { recursive: true });
    await this.ensureNpmPackageInstalled(cacheDir, packageSpec, packageName);

    const packageRoot = this.getPackageInstallPath(cacheDir, packageName);
    if (!(await this.pathExists(packageRoot))) {
      throw new Error(`npm package "${packageSpec}" did not install correctly.`);
    }

    if (filePath) {
      const normalized = filePath.replace(/^\//, '');
      const explicitCandidates = [path.join(packageRoot, normalized)];
      if (!normalized.endsWith('.ts')) {
        explicitCandidates.push(path.join(packageRoot, `${normalized}.photon.ts`));
      }
      for (const candidate of explicitCandidates) {
        if (await this.pathExists(candidate)) {
          return candidate;
        }
      }
    }

    const discovered = await this.findPhotonFile(packageRoot);
    if (discovered) {
      return discovered;
    }

    throw new Error(`Unable to locate a .photon.ts file within npm package ${packageSpec}.`);
  }

  private parseNpmSource(source: string): {
    packageSpec: string;
    packageName: string;
    filePath?: string;
  } {
    let cleaned = source.replace(/^npm:/, '');
    const [specPart, filePath] = cleaned.split('#', 2);
    return {
      packageSpec: specPart,
      packageName: this.extractPackageName(specPart),
      filePath,
    };
  }

  private extractPackageName(spec: string): string {
    if (spec.startsWith('@')) {
      const idx = spec.indexOf('@', 1);
      return idx === -1 ? spec : spec.slice(0, idx);
    }
    const idx = spec.indexOf('@');
    return idx === -1 ? spec : spec.slice(0, idx);
  }

  private getPackageInstallPath(cacheDir: string, packageName: string): string {
    if (packageName.startsWith('@')) {
      const segments = packageName.split('/');
      return path.join(cacheDir, 'node_modules', segments[0], segments[1] || '');
    }
    return path.join(cacheDir, 'node_modules', packageName);
  }

  private async ensureNpmPackageInstalled(
    cacheDir: string,
    packageSpec: string,
    packageName: string
  ): Promise<void> {
    const packageJsonPath = path.join(cacheDir, 'package.json');
    if (!(await this.pathExists(packageJsonPath))) {
      const pkgName = `photon-npm-${this.sanitizeCacheLabel(packageSpec)}`;
      await writeJSON(packageJsonPath, { name: pkgName, version: PHOTON_VERSION });
    }

    const packageRoot = this.getPackageInstallPath(cacheDir, packageName);
    if (await this.pathExists(packageRoot)) {
      return;
    }

    const pm = detectPreferredPackageManager();
    const pmArgs =
      pm === 'bun'
        ? ['add', packageSpec, '--production', '--silent']
        : ['install', packageSpec, '--omit=dev', '--silent', '--no-save'];
    await this.runCommand(pm, pmArgs, cacheDir);
  }

  private async findPhotonFile(dir: string, depth = 0): Promise<string | null> {
    if (depth > 4) {
      return null;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      this.logger.debug('Failed to read directory', { error });
      return null; // directory inaccessible
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.photon.ts')) {
        return path.join(dir, entry.name);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue;
        }
        const child = await this.findPhotonFile(path.join(dir, entry.name), depth + 1);
        if (child) {
          return child;
        }
      }
    }

    return null;
  }

  /**
   * Parse environment variable value based on TypeScript type
   * Delegates to shared parseEnvValue from photon-core
   */
  private parseEnvValue(value: string, type: string): any {
    return sharedParseEnvValue(value, type);
  }

  /**
   * Enhance constructor error with configuration guidance
   */
  private enhanceConstructorError(
    error: Error,
    mcpName: string,
    constructorParams: ConstructorParam[],
    configError: string | null
  ): Error {
    const originalMessage = getErrorMessage(error);

    // Build detailed env var documentation with examples
    const { docs: envVarDocs, exampleEnv: envExample } = summarizeConstructorParams(
      constructorParams,
      mcpName
    );

    const enhancedMessage = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Configuration Error: ${mcpName} MCP failed to initialize

${originalMessage}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Configuration Parameters:

${envVarDocs}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 How to Fix:

Option 1: Set environment variables in your MCP client config
(Claude Desktop, Cursor, etc.)

{
  "mcpServers": {
    "${mcpName}": {
      "command": "npx",
      "args": ["@portel/photon", "${mcpName}"],
      "env": ${JSON.stringify(envExample, null, 8).replace(/\n/g, '\n      ')}
    }
  }
}

Option 2: Check configuration
Run: photon mcp ${mcpName} --validate

Option 3: Generate config template
Run: photon mcp ${mcpName} --config

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

    const enhanced = new Error(enhancedMessage);
    enhanced.name = 'PhotonConfigError';
    enhanced.stack = error.stack;
    return enhanced;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FUNCTIONAL TAG MIDDLEWARE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Apply functional tag middleware to an execution function.
   * Tags become composable wrappers applied in the correct order via phase-sorted middleware.
   * All middleware (built-in and custom) follows the same code path — no if-chain.
   */
  private applyMiddleware(
    execute: () => Promise<any>,
    toolMeta: any,
    photonName: string,
    toolName: string,
    parameters: any,
    instanceName?: string
  ): () => Promise<any> {
    // Build middleware context
    const ctx: MiddlewareContext = {
      photon: photonName,
      tool: toolName,
      instance: instanceName || 'default',
      params: parameters,
    };

    // Get declarations from the new middleware[] field
    const declarations: MiddlewareDeclaration[] = toolMeta.middleware || [];
    if (declarations.length === 0) {
      return execute;
    }

    // Build a combined registry: photon-specific middleware + builtins
    const combinedRegistry = new MiddlewareRegistry();
    // Register builtins first
    for (const name of builtinRegistry.names()) {
      combinedRegistry.register(builtinRegistry.get(name)!);
    }
    // Register photon-specific custom middleware (overrides builtins if same name)
    const photonDefs = this.photonMiddleware.get(photonName);
    if (photonDefs) {
      for (const def of photonDefs) {
        combinedRegistry.register(def);
      }
    }

    // Handler override for locked middleware — inject real lock manager
    const handlerOverrides = new Map<
      string,
      (config: any, state: MiddlewareState) => MiddlewareHandler
    >();
    handlerOverrides.set('locked', (config: { name: string }) => {
      return async (_ctx: MiddlewareContext, next: () => Promise<any>) => {
        const lockName = config.name || `${photonName}:${toolName}`;

        // Identity-aware lock check: if caller is authenticated, verify they hold the lock
        const store = executionContext.getStore();
        const caller = store?.caller;
        if (caller && !caller.anonymous) {
          // Query who holds this lock
          try {
            const { queryLock: queryLockFn } = await import('./daemon/client.js');
            const lockInfo = await queryLockFn(photonName, lockName);
            if (lockInfo.holder && lockInfo.holder !== caller.id) {
              throw new Error(`Not your turn. Lock "${lockName}" is held by ${lockInfo.holder}`);
            }
            if (!lockInfo.holder) {
              // No one holds the lock — allow the call (lock not yet assigned)
            }
          } catch (e: any) {
            // If daemon is not running, fall through to withLockHelper
            if (!e.message?.includes('Not your turn')) {
              return withLockHelper(lockName, next);
            }
            throw e;
          }
          return next();
        }

        // No auth — fall back to binary mutex
        return withLockHelper(lockName, next);
      };
    });

    // Handler override for circuitBreaker — mirror state into circuitHealthTracker for introspection
    handlerOverrides.set(
      'circuitBreaker',
      (config: { threshold: number; resetAfterMs: number }, _state: MiddlewareState) => {
        const tracker = this.circuitHealthTracker;
        return async (ctx: MiddlewareContext, next: () => Promise<any>) => {
          const key = `${ctx.photon}:${ctx.instance}:${ctx.tool}`;
          let circuit = tracker.get(key);
          if (!circuit) {
            circuit = { failures: 0, state: 'closed', openedAt: 0 };
            tracker.set(key, circuit);
          }

          if (circuit.state === 'open') {
            if (Date.now() - circuit.openedAt >= config.resetAfterMs) {
              circuit.state = 'half-open';
            } else {
              const error = new Error(
                `Circuit open: ${ctx.photon}.${ctx.tool} has failed ${config.threshold} consecutive times. Resets in ${Math.ceil((config.resetAfterMs - (Date.now() - circuit.openedAt)) / 1000)}s`
              );
              (error as any).name = 'PhotonCircuitOpenError';
              throw error;
            }
          }

          try {
            const result = await next();
            circuit.failures = 0;
            circuit.state = 'closed';
            return result;
          } catch (error) {
            circuit.failures++;
            if (circuit.failures >= config.threshold) {
              circuit.state = 'open';
              circuit.openedAt = Date.now();
            }
            throw error;
          }
        };
      }
    );

    return buildMiddlewareChain(
      execute,
      declarations,
      combinedRegistry,
      this.middlewareStates,
      ctx,
      handlerOverrides
    );
  }

  /**
   * Execute a tool on the loaded MCP instance
   * Handles both regular async methods and async generators
   *
   * For generators with checkpoint yields, automatically uses stateful execution
   * with JSONL persistence. The run ID is returned in the result for stateful workflows.
   *
   * @param mcp - The loaded Photon MCP
   * @param toolName - Name of the tool to execute
   * @param parameters - Input parameters for the tool
   * @param options - Optional execution options
   * @returns Tool result, or wrapped result with runId for stateful workflows
   */
  async executeTool(
    mcp: PhotonClass,
    toolName: string,
    parameters: any,
    options?: {
      resumeRunId?: string;
      outputHandler?: OutputHandler;
      inputProvider?: InputProvider;
      caller?: CallerInfo;
      traceId?: string;
    }
  ): Promise<any> {
    // Start audit trail recording
    const audit = getAuditTrail();
    const { finish: auditFinish } = audit.start(mcp.name, toolName, parameters || {});

    // Start OTel span for tool execution (no-op if SDK not installed)
    const span = startToolSpan(mcp.name, toolName, parameters, options?.traceId);
    if (mcp.instance?.instanceName) {
      span.setAttribute('photon.instance', mcp.instance.instanceName);
    }
    if (options?.caller) {
      span.setAttribute('photon.caller', JSON.stringify(options.caller));
    }

    try {
      // Extract _clientState from args before schema validation
      // This is auto-injected by the bridge when custom UI has widgetState set
      let clientState: Record<string, unknown> | undefined;
      if (parameters && typeof parameters === 'object' && '_clientState' in parameters) {
        clientState = parameters._clientState as Record<string, unknown>;
        parameters = { ...parameters };
        delete parameters._clientState;
      }

      // Extract _meta system hints before schema validation.
      // _meta is a transport-agnostic namespace for format, viewport, fields, locale.
      // Methods never see it — it drives post-processing of the result.
      let _meta: import('./meta.js').MetaParams | undefined;
      if (parameters && typeof parameters === 'object' && '_meta' in parameters) {
        _meta = parameters._meta as import('./meta.js').MetaParams;
        parameters = { ...parameters };
        delete parameters._meta;
      }

      // Make client state available on the instance for this execution
      if (mcp.instance && clientState !== undefined) {
        mcp.instance._clientState = clientState;
      }

      // Check for configuration errors before executing tool
      if (mcp.instance._photonConfigError) {
        throw new Error(mcp.instance._photonConfigError);
      }

      // Enforce @auth at method level — works across ALL transports (CLI, STDIO, HTTP, daemon)
      const photonAuth = (mcp as any).auth as string | undefined;
      if (photonAuth === 'required') {
        const caller = options?.caller;
        if (!caller || caller.anonymous) {
          const inputProvider = options?.inputProvider || this.createInputProvider();
          try {
            const token = await inputProvider({
              ask: 'password',
              message: `${mcp.name} requires authentication. Enter your access token:`,
            });
            if (token && typeof token === 'string') {
              options = {
                ...options,
                caller: {
                  id: token.slice(0, 8),
                  name: 'authenticated-user',
                  anonymous: false,
                  claims: { token },
                },
              };
            } else {
              throw new Error(
                `Authentication required: ${mcp.name} has @auth required but no credentials were provided`
              );
            }
          } catch (e: any) {
            if (e.message?.includes('Authentication required')) throw e;
            throw new Error(
              `Authentication required: ${mcp.name} has @auth required. Provide credentials via Authorization header, MCP elicitation, or CLI prompt.`
            );
          }
        }
      }

      // Intercept auto-generated settings tool
      if (toolName === 'settings' && mcp.instance._settingsBacking) {
        const result = await this.executeSettingsTool(mcp.instance, parameters, {
          outputHandler: options?.outputHandler,
          inputProvider: options?.inputProvider,
        });
        span.setStatus('OK');
        auditFinish(result);
        return result;
      }

      // Get tool metadata for functional tags
      const rawToolMeta: any = mcp.tools.find((t: any) => t.name === toolName) || {};
      const normalized = this.normalizeNestedParamsTool(rawToolMeta, parameters);
      const toolMeta = normalized.toolMeta;
      parameters = normalized.parameters;
      const hasFunctionalTags = toolMeta.middleware?.length > 0;

      // Validate required parameters before execution
      const requiredParams: string[] = toolMeta.inputSchema?.required || [];
      if (requiredParams.length > 0 && parameters) {
        const missing = requiredParams.filter(
          (p: string) => !(p in parameters) || parameters[p] === undefined
        );
        if (missing.length > 0) {
          throw new Error(
            `Missing required parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
          );
        }
      }

      // Log deprecation warning if tool is deprecated
      if (toolMeta.deprecated) {
        const msg =
          typeof toolMeta.deprecated === 'string'
            ? `DEPRECATED: ${mcp.name}.${toolName} — ${toolMeta.deprecated}`
            : `DEPRECATED: ${mcp.name}.${toolName}`;
        this.logger.warn(`⚠️  ${msg}`);
      }

      // Check if instance has Photon base class's executeTool method
      if (typeof mcp.instance.executeTool === 'function') {
        // Photon base class handles execution
        const outputHandler = options?.outputHandler || this.createOutputHandler();
        const inputProvider = options?.inputProvider || this.createInputProvider();

        let executeBase = async () => {
          const result = await mcp.instance.executeTool(toolName, parameters, { outputHandler });

          // Handle generator result (if tool returns a generator)
          if (isAsyncGenerator(result)) {
            return executeGenerator(result as AsyncGenerator<PhotonYield, any, any>, {
              inputProvider,
              outputHandler,
            });
          }
          return result;
        };

        // Apply functional tag middleware if any tags present
        if (hasFunctionalTags) {
          executeBase = this.applyMiddleware(
            executeBase,
            toolMeta,
            mcp.name,
            toolName,
            parameters,
            mcp.instance.instanceName
          );
        }

        const result = await executeBase();
        this.progressRenderer.done();
        span.setStatus('OK');
        auditFinish(result);

        // CRITICAL FIX: Emit @stateful events at executeTool level
        // The method wrapper approach is bypassed by Photon.executeTool(),
        // so we must emit events here where ALL tool executions are guaranteed to pass through
        if (mcp.instance && typeof mcp.instance.emit === 'function') {
          try {
            const photonName = mcp.name;

            // Attach __meta to result if it's an object and doesn't already have it
            if (result && typeof result === 'object' && !Array.isArray(result) && !result.__meta) {
              const timestamp = new Date().toISOString();
              Object.defineProperty(result, '__meta', {
                value: {
                  createdAt: timestamp,
                  createdBy: toolName,
                  modifiedAt: null,
                  modifiedBy: null,
                  modifications: [],
                },
                enumerable: false,
                writable: true,
                configurable: true,
              });
            }

            // Construct CloudEvents 1.0 envelope for @stateful event emissions.
            // The `data` field carries the photon-specific payload; `channel` and `event`
            // are transport metadata used by the daemon pub/sub router.
            const cloudEventData: Record<string, any> = {
              method: toolName,
              params: parameters,
              result,
              instance: mcp.instance.instanceName ?? null,
            };

            // Add index/pagination info if result is from items array
            if (result && typeof result === 'object' && Array.isArray(mcp.instance.items)) {
              const index = mcp.instance.items.findIndex((item: any) => item === result);
              if (index !== -1) {
                cloudEventData.index = index;
                cloudEventData.totalCount = mcp.instance.items.length;
                cloudEventData.affectedRange = {
                  start: index,
                  end: index + 1,
                };
              }
            }

            // CloudEvents 1.0 envelope (https://cloudevents.io)
            const eventPayload = {
              specversion: '1.0',
              id: crypto.randomUUID(),
              source: `photon/${photonName}`,
              type: `photon.${photonName}.${toolName}.executed`,
              time: new Date().toISOString(),
              data: cloudEventData,
            };

            // Wrap in daemon pub/sub format: { channel, event, data }
            const eventData = {
              channel: `${photonName}:${toolName}`, // For daemon pub/sub routing
              event: 'tool-executed',
              data: eventPayload,
            };

            // Send event through outputHandler for daemon pub/sub routing
            // This is the critical path that routes events to subscribers through the daemon
            if (options?.outputHandler) {
              try {
                if (process.env.PHOTON_DEBUG_EMIT === '1') {
                  console.error(
                    `[EMIT-DEBUG] Sending event: method=${eventPayload.data.method}, channel=${eventData.channel}, hasMeta=${!!result?.__meta}`
                  );
                }
                // Cast to DaemonEventEnvelope - outputHandler is flexible and routes any object with channel property
                void Promise.resolve(
                  options.outputHandler(eventData as unknown as EmitYield)
                ).catch((e) => {
                  this.logger.debug('Output handler failed for event', { error: e?.message || e });
                });
                if (process.env.PHOTON_DEBUG_EMIT === '1') {
                  console.error(`[EMIT-DEBUG] Event transmitted to outputHandler`);
                }
              } catch (e) {
                console.error(
                  `[EMIT-ERROR] Failed to send event through outputHandler: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            } else if (mcp.instance && typeof mcp.instance.emit === 'function') {
              // Fallback for cases where outputHandler isn't available
              // (this path won't route to daemon pub/sub, but at least calls emit)
              try {
                if (process.env.PHOTON_DEBUG_EMIT === '1') {
                  console.error(`[EMIT-DEBUG] No outputHandler, falling back to instance.emit`);
                }
                mcp.instance.emit(eventData);
              } catch (e) {
                console.error(
                  `[EMIT-ERROR] Failed to emit: ${e instanceof Error ? e.message : String(e)}`
                );
              }
            }
          } catch (e) {
            // Log emit errors but don't break tool execution
            console.error(
              `[EMIT-ERROR] Failed to emit @stateful event: ${e instanceof Error ? e.message : String(e)}`
            );
            this.logger.debug(
              `Failed to emit @stateful event: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }

        // Apply _meta post-processing (format transformation, field selection)
        if (_meta) {
          const { applyMeta } = await import('./meta.js');
          return applyMeta(result, _meta, toolMeta?.exportFormats);
        }
        return result;
      }

      // Plain class - call method directly with implicit stateful support
      // Check instance first, then prototype, then static methods on class
      let method = mcp.instance[toolName];
      let isStatic = false;

      if (typeof method !== 'function') {
        method = Object.getPrototypeOf(mcp.instance)?.[toolName];
      }

      // Check for static method on class constructor
      if (typeof method !== 'function' && mcp.classConstructor) {
        method = mcp.classConstructor[toolName];
        isStatic = true;
      }

      if (!method || typeof method !== 'function') {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Check if this tool uses simple params (e.g., add(item: string) vs add(params: { item: string }))
      // Simple params need to be destructured from the params object into individual arguments
      let args: any[];
      if (toolMeta.simpleParams && parameters && typeof parameters === 'object') {
        // Get param names from schema to preserve order
        const paramNames = Object.keys(toolMeta.inputSchema?.properties || {});
        args = paramNames.map((name) => parameters[name]);
      } else {
        args = [parameters];
      }

      // Create a generator factory for maybeStatefulExecute
      // This allows re-execution on resume
      // For static methods, call on the class itself; for instance methods, bind to instance
      const outputHandler = options?.outputHandler || this.createOutputHandler();
      const inputProvider = options?.inputProvider || this.createInputProvider();

      // Wrap ALL plain class execution in executionContext for unified observability
      // This enables this.emit() to read outputHandler from context
      // Also stash outputHandler on instance for timer-based emits after method returns
      if (!isStatic && mcp.instance) {
        mcp.instance._lastOutputHandler = outputHandler;
      }
      let generatorFn = isStatic
        ? () => method.call(null, ...args)
        : () =>
            executionContext.run(
              {
                outputHandler: outputHandler as ((data: unknown) => void) | undefined,
                caller: options?.caller,
              },
              () => {
                return method.call(mcp.instance, ...args) as unknown;
              }
            );

      // Apply functional tag middleware if any tags present
      if (hasFunctionalTags) {
        generatorFn = this.applyMiddleware(
          generatorFn,
          toolMeta,
          mcp.name,
          toolName,
          parameters,
          mcp.instance.instanceName
        );
      }

      // Use maybeStatefulExecute for all executions
      // It handles both regular async and generators, detecting checkpoint yields
      const execResult = await maybeStatefulExecute(generatorFn, {
        photon: mcp.name,
        tool: toolName,
        params: parameters,
        inputProvider,
        outputHandler,
        resumeRunId: options?.resumeRunId,
      });

      // Clear any lingering progress
      this.progressRenderer.done();

      // If there was an error, throw it
      if (execResult.error) {
        // Preserve the original error if it's an Error instance (keeps .name like PhotonTimeoutError)
        const error =
          execResult.originalError instanceof Error
            ? (execResult.originalError as Error & { runId?: string })
            : (new Error(execResult.error) as Error & { runId?: string });
        if (execResult.runId) {
          error.runId = execResult.runId;
        }
        span.setStatus('ERROR', error.message);
        auditFinish(null, error);
        throw error;
      }

      // For stateful workflows, wrap result with metadata
      if (execResult.isStateful && execResult.runId) {
        const wrappedResult = {
          _stateful: true,
          runId: execResult.runId,
          resumed: execResult.resumed,
          resumedFromStep: execResult.resumedFromStep,
          checkpointsCompleted: execResult.checkpointsCompleted,
          status: execResult.status,
          result: execResult.result,
        };
        span.setStatus('OK');
        auditFinish(execResult.result);
        return wrappedResult;
      }

      // For ephemeral execution, return result directly
      span.setStatus('OK');
      auditFinish(execResult.result);
      // Apply _meta post-processing (format transformation, field selection)
      if (_meta) {
        const { applyMeta } = await import('./meta.js');
        return applyMeta(execResult.result, _meta, toolMeta?.exportFormats);
      }
      return execResult.result;
    } catch (error) {
      // Clear progress on error too
      this.progressRenderer.done();
      span.setStatus('ERROR', error instanceof Error ? error.message : String(error));
      auditFinish(null, error as Error);
      this.logger.error(`Tool execution failed: ${toolName} - ${getErrorMessage(error)}`);
      throw error;
    } finally {
      span.end();
    }
  }

  private normalizeNestedParamsTool(
    toolMeta: any,
    parameters: Record<string, unknown> | undefined
  ): { toolMeta: any; parameters: Record<string, unknown> | undefined } {
    const schema = toolMeta?.inputSchema;
    if (!schema?.properties || typeof schema.properties !== 'object') {
      return { toolMeta, parameters };
    }

    const propNames = Object.keys(schema.properties);
    if (propNames.length !== 1 || propNames[0] !== 'params') {
      return { toolMeta, parameters };
    }

    const nested = schema.properties.params;
    if (
      !nested ||
      nested.type !== 'object' ||
      !nested.properties ||
      typeof nested.properties !== 'object'
    ) {
      return { toolMeta, parameters };
    }

    const normalizedToolMeta = {
      ...toolMeta,
      inputSchema: {
        type: 'object',
        properties: nested.properties,
        ...(Array.isArray(nested.required) ? { required: nested.required } : {}),
      },
      // Named object params should stay as a single object argument at runtime.
      simpleParams: false,
    };

    if (
      parameters &&
      typeof parameters === 'object' &&
      'params' in parameters &&
      parameters.params &&
      typeof parameters.params === 'object'
    ) {
      return {
        toolMeta: normalizedToolMeta,
        parameters: parameters.params as Record<string, unknown>,
      };
    }

    return {
      toolMeta: normalizedToolMeta,
      parameters,
    };
  }

  /**
   * Create an input provider for generator ask yields
   * Supports the new ask/emit pattern from photon-core 1.2.0
   */
  private createInputProvider(): InputProvider {
    return async (ask: AskYield): Promise<any> => {
      switch (ask.ask) {
        case 'text':
        case 'password':
          return await elicitPrompt(ask.message, 'default' in ask ? ask.default : undefined);

        case 'confirm':
          return await elicitConfirm(ask.message);

        case 'select': {
          const options = (ask.options || []).map((o: any) =>
            typeof o === 'string' ? o : o.label
          );
          const result = await elicitPrompt(`${ask.message}\nOptions: ${options.join(', ')}`);
          return result;
        }

        case 'number': {
          const result = await elicitPrompt(ask.message, ask.default?.toString());
          return result ? parseFloat(result) : (ask.default ?? 0);
        }

        case 'date': {
          const result = await elicitPrompt(ask.message, ask.default);
          return result || ask.default || new Date().toISOString();
        }

        case 'file':
          // File selection not supported in CLI readline
          this.logger.warn(`⚠️ File selection not supported in CLI: ${ask.message}`);
          return null;

        default: {
          const unknownAsk = ask as { ask?: string };
          this.logger.warn(`⚠️ Unknown ask type: ${unknownAsk.ask || 'unknown'}`);
          return undefined;
        }
      }
    };
  }

  /**
   * Create an output handler for generator emit yields
   * Supports the new ask/emit pattern from photon-core 1.2.0
   * Uses inline progress animation for CLI
   */
  private createOutputHandler(): OutputHandler {
    return (emit: EmitYield) => {
      // Handle render:clear before the typed switch
      if (emit.emit === 'render:clear') {
        cliRenderZone.clear();
        return;
      }

      switch (emit.emit) {
        case 'progress':
          // Use inline progress bar with spinner animation
          this.progressRenderer.render(emit.value, emit.message);
          // Clear progress line when complete
          if (emit.value >= 1) {
            this.progressRenderer.done();
          }
          break;

        case 'status':
          // Status shows as ephemeral spinner with auto-animation
          // Updates the message if already spinning, or starts a new spinner
          if (this.progressRenderer.active) {
            this.progressRenderer.updateMessage(emit.message);
          } else {
            this.progressRenderer.startSpinner(emit.message);
          }
          break;

        case 'log': {
          // Logs clear progress first to avoid overlap
          this.progressRenderer.done();
          const level = (emit.level || 'info') as LogLevel;
          const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ';
          this.logger[level](`${prefix} ${emit.message}`);
          break;
        }

        case 'toast':
          this.progressRenderer.done();
          const icon =
            emit.type === 'error'
              ? '❌'
              : emit.type === 'warning'
                ? '⚠️'
                : emit.type === 'success'
                  ? '✅'
                  : 'ℹ';
          process.stdout.write(`${icon} ${emit.message}\n`);
          break;

        case 'thinking':
          if (emit.active) {
            // Show thinking as indeterminate progress
            this.progressRenderer.render(0, 'Processing...');
          } else {
            this.progressRenderer.done();
          }
          break;

        case 'stream':
          // Stream clears progress first
          this.progressRenderer.done();
          if (typeof emit.data === 'string') {
            process.stdout.write(emit.data);
          } else {
            process.stdout.write(JSON.stringify(emit.data));
          }
          break;

        case 'artifact':
          this.progressRenderer.done();
          this.logger.info(`📦 ${emit.title || emit.type}: ${emit.mimeType}`);
          break;

        case 'qr': {
          // Render QR code in terminal
          this.progressRenderer.done();
          if (emit.message) {
            this.logger.info(emit.message);
          }
          if (emit.value) {
            void renderTerminalQR(emit.value);
          }
          break;
        }

        case 'render': {
          // Render formatted intermediate result in terminal
          this.progressRenderer.done();
          renderCLIFormat(emit.format, emit.value);
          break;
        }
      }
    };
  }

  /**
   * Auto-wire ReactiveArray/Map/Set properties for zero-boilerplate reactivity
   *
   * When a photon developer imports { Array } from '@portel/photon-core',
   * it shadows the global Array. The runtime then auto-wires these properties:
   * - Sets _propertyName to the property key (e.g., 'items')
   * - Sets _emitter to instance.emit.bind(instance)
   *
   * This enables the pattern:
   * ```typescript
   * import { Array } from '@portel/photon-core';
   *
   * export default class TodoList {
   *   items: Array<Task> = [];  // Just use it normally
   *
   *   add(text: string) {
   *     this.items.push({ id: crypto.randomUUID(), text });
   *     // Auto-emits 'items:added' - no manual wiring needed!
   *   }
   * }
   * ```
   */
  private _formatCatalogCache: Record<string, unknown> | null = null;

  private injectFormatCatalog(instance: Record<string, unknown>): void {
    if (instance.formats) return;
    // Eagerly load once per loader, cached across all photon instances
    if (!this._formatCatalogCache) {
      try {
        const loaderDir = path.dirname(fileURLToPath(import.meta.url));
        const renderersPath = path.join(loaderDir, 'auto-ui', 'bridge', 'renderers.js');
        const esmRequire = createRequire(import.meta.url);
        this._formatCatalogCache = esmRequire(renderersPath).FORMAT_CATALOG;
      } catch (e) {
        this.logger.debug('Failed to load format catalog', { error: (e as Error)?.message });
        this._formatCatalogCache = {};
      }
    }
    Object.defineProperty(instance, 'formats', {
      value: this._formatCatalogCache,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  private wireReactiveCollections(instance: Record<string, unknown>): void {
    // Get the emit function if available
    const emit =
      typeof instance.emit === 'function'
        ? (instance.emit as (event: string, data: unknown) => void).bind(instance)
        : null;

    if (!emit) {
      return; // No emit function, skip wiring
    }

    // Iterate over instance properties
    for (const key of Object.keys(instance)) {
      const value = instance[key];
      if (!value || typeof value !== 'object') continue;

      // Check by constructor name since different module instances break instanceof
      // (photon uses npm-cached module, runtime uses linked module)
      const ctorName = value.constructor?.name;

      if (
        ctorName === 'ReactiveArray' ||
        ctorName === 'ReactiveMap' ||
        ctorName === 'ReactiveSet' ||
        ctorName === 'Collection'
      ) {
        (value as ReactiveCollectionLike)._propertyName = key;
        (value as ReactiveCollectionLike)._emitter = emit;
        this.log(`Wired ${ctorName}: ${key}`);
      }
    }
  }

  /**
   * Wrap all public methods in @stateful classes to automatically emit events
   *
   * Event structure: { method, params, result, timestamp, instance }
   * Every public method call produces an event with the method name, input parameters,
   * return value, and timestamp. This enables real-time UI sync and event-driven architectures.
   */
  private wrapStatefulMethods(instance: Record<string, unknown>, source: string): void {
    // Check if this class has @stateful decorator
    if (!/@stateful\b/i.test(source)) {
      return; // Not a @stateful class
    }

    // Get the emit function if available
    const emit =
      typeof instance.emit === 'function'
        ? (instance.emit as (data: unknown) => void).bind(instance)
        : null;

    if (!emit) {
      return; // No emit function, can't wrap methods
    }

    // Get all public method names from the instance
    // Skip runtime-injected methods (emit, render, push, ask) — these are
    // capability methods injected by the loader, not user-defined tools
    const RUNTIME_METHODS = new Set([
      'emit',
      'render',
      'channel',
      'ask',
      'call',
      'toast',
      'log',
      'status',
      'progress',
      'thinking',
    ]);
    const proto = Object.getPrototypeOf(instance);
    const methodNames = Object.getOwnPropertyNames(proto).filter((name) => {
      // Skip constructor and private/protected methods
      if (name === 'constructor' || name.startsWith('_')) {
        return false;
      }
      // Skip runtime-injected capability methods
      if (RUNTIME_METHODS.has(name)) {
        return false;
      }

      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      return descriptor && typeof descriptor.value === 'function';
    });

    if (methodNames.length === 0) {
      return; // No public methods to wrap
    }

    const photonName = (instance._photonName as string) || 'photon';
    this.log(`📡 Wrapping ${methodNames.length} methods in @stateful ${photonName}`);

    // Wrap each public method
    for (const methodName of methodNames) {
      const original = instance[methodName] as ((...args: unknown[]) => unknown) | undefined;
      if (typeof original !== 'function') continue;

      instance[methodName] = function (...args: any[]) {
        const result = original.apply(this, args);

        const attachMeta = (obj: any) => {
          if (obj && typeof obj === 'object' && !Array.isArray(obj) && !obj.__meta) {
            Object.defineProperty(obj, '__meta', {
              value: {
                createdAt: new Date().toISOString(),
                createdBy: methodName,
                modifiedAt: null,
                modifiedBy: null,
                modifications: [],
              },
              enumerable: false,
              writable: true,
              configurable: true,
            });
          }
        };

        // Generators must pass through unwrapped - .then() would kill the iterator protocol
        if (result && typeof (result as any)[Symbol.asyncIterator] === 'function') {
          return result;
        }

        // For async methods, attach __meta to the resolved value, not the Promise
        if (result && typeof (result as any).then === 'function') {
          return (result as Promise<any>).then((resolved: any) => {
            attachMeta(resolved);
            return resolved;
          });
        }

        attachMeta(result);
        return result;
      };
    }
  }

  /**
   * Extract @mcp dependencies from source and inject them as instance properties
   *
   * This enables the pattern:
   * ```typescript
   * /**
   *  * @mcp github anthropics/mcp-server-github
   *  *\/
   * export default class MyPhoton extends Photon {
   *   async doSomething() {
   *     const issues = await this.github.list_issues({ repo: 'owner/repo' });
   *   }
   * }
   * ```
   */
  private async injectMCPDependencies(
    instance: any,
    source: string,
    photonName: string
  ): Promise<void> {
    const extractor = new SchemaExtractor();
    const mcpDeps = extractor.extractMCPDependencies(source);

    if (mcpDeps.length === 0) {
      return;
    }

    this.log(`🔌 Found ${mcpDeps.length} @mcp dependencies`);

    // Build MCP config from declarations
    const mcpServers: Record<string, any> = {};
    for (const dep of mcpDeps) {
      try {
        const config = resolveMCPSource(dep.name, dep.source, dep.sourceType);
        mcpServers[dep.name] = config;
        this.log(`  - ${dep.name}: ${dep.source} (${dep.sourceType})`);
      } catch (error) {
        this.logger.warn(`⚠️  Failed to resolve MCP ${dep.name}: ${getErrorMessage(error)}`);
      }
    }

    if (Object.keys(mcpServers).length === 0) {
      return;
    }

    // Create factory for these MCPs
    const mcpConfig: MCPConfig = { mcpServers };
    const factory = new SDKMCPClientFactory(mcpConfig, this.verbose);

    // Inject each MCP as an instance property with proxy
    for (const dep of mcpDeps) {
      if (mcpServers[dep.name]) {
        const client = factory.create(dep.name);
        const proxy = createMCPProxy(client);

        // Inject as instance property: this.github, this.fs, etc.
        Object.defineProperty(instance, dep.name, {
          value: proxy,
          writable: false,
          enumerable: true,
          configurable: false,
        });

        this.log(`  ✅ Injected this.${dep.name}`);
      }
    }

    // Store factory reference for cleanup
    instance._mcpClientFactory = factory;
  }

  /**
   * Check CLI dependencies declared via @cli tags
   *
   * Validates that required command-line tools are available on the system.
   * Throws a helpful error with install URLs if any are missing.
   *
   * Format: @cli <name> - <install_url>
   *
   * Example:
   * ```typescript
   * /**
   *  * @cli git - https://git-scm.com/downloads
   *  * @cli ffmpeg - https://ffmpeg.org/download.html
   *  *\/
   * ```
   */
  private async checkCLIDependencies(source: string, photonName: string): Promise<void> {
    const extractor = new SchemaExtractor();
    const cliDeps = extractor.extractCLIDependencies(source);

    if (cliDeps.length === 0) {
      return;
    }

    this.log(`🔧 Checking ${cliDeps.length} CLI dependencies`);

    const missing: CLIDependency[] = [];

    for (const dep of cliDeps) {
      const exists = await this.checkCLIExists(dep.name);
      if (exists) {
        this.log(`  ✅ ${dep.name}`);
      } else {
        this.log(`  ❌ ${dep.name} not found`);
        missing.push(dep);
      }
    }

    if (missing.length > 0) {
      const lines = missing.map((dep) => {
        if (dep.installUrl) {
          return `  - ${dep.name}: Install from ${dep.installUrl}`;
        }
        return `  - ${dep.name}`;
      });

      const error = new Error(
        `${photonName} requires the following CLI tools to be installed:\n${lines.join('\n')}`
      );
      error.name = 'CLIDependencyError';
      throw error;
    }
  }

  /**
   * Check if a CLI command exists on the system
   */
  private async checkCLIExists(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn(process.platform === 'win32' ? 'where' : 'which', [command], {
        stdio: 'ignore',
      });
      check.on('close', (code) => resolve(code === 0));
      check.on('error', () => resolve(false));
    });
  }

  /**
   * Resolve the namespace for a photon based on its file path.
   * Extracts the directory name between baseDir and the photon file.
   *
   * Examples:
   *   ~/.photon/portel-dev/todo.photon.ts → 'portel-dev'
   *   ~/.photon/acme/todo.photon.ts       → 'acme'
   *   ~/.photon/todo.photon.ts            → detected from git or 'local'
   */
  private resolveNamespace(absolutePath: string): string {
    const rel = path.relative(this.baseDir, absolutePath);
    const parts = rel.split(path.sep);

    // If file is in a subdirectory (namespace/photon.ts), use that as namespace
    if (parts.length >= 2) {
      return parts[0];
    }

    // Flat file at root — detect from git remote or default to 'local'
    return detectNamespace(this.baseDir);
  }

  /**
   * Discover and extract assets from a Photon file
   * Uses shared discoverAssets from photon-core for core logic,
   * then applies photon-specific extensions (method UI links, URI generation).
   */
  private async discoverAssets(
    photonPath: string,
    source: string
  ): Promise<PhotonAssets | undefined> {
    const basename = path.basename(photonPath, '.photon.ts');

    // Use shared discovery from photon-core
    const assets = await sharedDiscoverAssets(photonPath, source);
    if (!assets) {
      return undefined;
    }

    // Apply method-level @ui links AFTER auto-discovery
    this.applyMethodUILinks(source, assets);

    // Generate ui:// URIs for MCP Apps Extension support (SEP-1865)
    this.generateAssetURIs(basename, assets);

    return assets;
  }

  /**
   * Expose discovered asset metadata on the instance without breaking Photon.assets().
   *
   * Photon subclasses inherit an `assets(subpath)` method from photon-core. We bind that
   * method and decorate the function object with discovered metadata so both of these work:
   * - `this.assets('templates')`
   * - `this.assets.ui`
   *
   * Plain classes don't have the inherited method, so they receive the metadata object directly.
   */
  private attachAssetsToInstance(
    instance: Record<string, unknown>,
    assets: PhotonAssets | undefined
  ): void {
    if (!assets) {
      return;
    }

    const existingAssets = instance.assets;

    if (typeof existingAssets === 'function') {
      const boundAssets = existingAssets.bind(instance) as typeof existingAssets & PhotonAssets;
      Object.assign(boundAssets, assets);
      Object.defineProperty(instance, 'assets', {
        value: boundAssets,
        configurable: true,
        enumerable: false,
        writable: false,
      });
      return;
    }

    Object.defineProperty(instance, 'assets', {
      value: assets,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  /**
   * Inject Photon path helpers for plain classes that use them without extending Photon.
   */
  private injectPathHelpers(instance: Record<string, unknown>, source: string): void {
    if (!source) {
      return;
    }

    if (/this\.storage\s*\(/.test(source) && typeof instance.storage !== 'function') {
      instance.storage = (subpath: string) => {
        if (!instance._photonFilePath || typeof instance._photonFilePath !== 'string') {
          throw new Error(
            'storage() requires _photonFilePath to be set by the runtime loader. ' +
              'Ensure this photon is loaded through the standard runtime.'
          );
        }
        const dir = path.dirname(instance._photonFilePath);
        const name = path.basename(instance._photonFilePath).replace(/\.photon\.(ts|js)$/, '');
        const target = path.join(dir, name, subpath);
        mkdirSync(target, { recursive: true });
        return target;
      };
    }

    if (/this\.assets\s*\(/.test(source) && typeof instance.assets !== 'function') {
      instance.assets = (
        subpath: string,
        options?: boolean | { load?: boolean; encoding?: BufferEncoding | null }
      ) => {
        const normalized = typeof options === 'boolean' ? { load: options } : (options ?? {});
        if (!instance._photonFilePath || typeof instance._photonFilePath !== 'string') {
          throw new Error(
            'assets() requires _photonFilePath to be set by the runtime loader. ' +
              'Ensure this photon is loaded through the standard runtime.'
          );
        }
        const realPath = realpathSync(instance._photonFilePath);
        const dir = path.dirname(realPath);
        const name = path.basename(realPath).replace(/\.photon\.(ts|js)$/, '');
        const root = path.join(dir, name);
        const legacyRoot = path.join(root, 'assets');
        const assetRoot = existsSync(root) ? root : existsSync(legacyRoot) ? legacyRoot : root;
        const assetPath = path.join(assetRoot, subpath);

        if (!normalized.load) {
          return assetPath;
        }
        if (normalized.encoding === null) {
          return readFileSync(assetPath);
        }
        return readFileSync(assetPath, normalized.encoding ?? 'utf-8');
      };
    }

    if (/this\.assetUrl\s*\(/.test(source) && typeof instance.assetUrl !== 'function') {
      instance.assetUrl = (subpath: string) => {
        const name = (
          typeof instance._photonName === 'string' && instance._photonName
            ? instance._photonName
            : instance.constructor?.name || ''
        )
          .replace(/MCP$/, '')
          .replace(/([A-Z])/g, '-$1')
          .toLowerCase()
          .replace(/^-/, '');
        return `/api/assets/${encodeURIComponent(name)}/${subpath}`;
      };
    }
  }

  /**
   * Generate ui:// URIs for all UI assets (MCP Apps Extension support)
   * URI format: ui://<photon-name>/<asset-id>
   */
  private generateAssetURIs(photonName: string, assets: PhotonAssets): void {
    for (const ui of assets.ui) {
      // Add uri field for MCP Apps compatibility
      ui.uri = `ui://${photonName}/${ui.id}`;
      this.log(`  🔗 URI: ${ui.uri}`);
    }
  }

  /**
   * Apply method-level @ui annotations to link UI assets to tools
   * Called after auto-discovery so all UI assets are available
   */
  private applyMethodUILinks(source: string, assets: PhotonAssets): void {
    // Match method JSDoc with @ui annotation: /** ... @ui <id> ... */ async methodName
    const methodUiRegex = /\/\*\*[\s\S]*?@ui\s+(\w[\w-]*)[\s\S]*?\*\/\s*(?:async\s+)?\*?\s*(\w+)/g;

    let match;
    while ((match = methodUiRegex.exec(source)) !== null) {
      const [, uiId, methodName] = match;
      const asset = assets.ui.find((u) => u.id === uiId);
      if (asset) {
        // First method wins as primary (used for app detection)
        if (!asset.linkedTool) {
          asset.linkedTool = methodName;
          this.log(`  🔗 UI ${uiId} → ${methodName}`);
        }
        // Track all methods that reference this UI
        if (!asset.linkedTools) asset.linkedTools = [];
        if (!asset.linkedTools.includes(methodName)) {
          asset.linkedTools.push(methodName);
          if (asset.linkedTools.length > 1) {
            this.log(`  🔗 UI ${uiId} → ${methodName} (shared)`);
          }
        }
      } else {
        this.log(`  ⚠️ @ui ${uiId} on ${methodName}: asset not found (check file exists)`);
      }
    }
  }
}
