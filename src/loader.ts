/**
 * Photon MCP Loader
 *
 * Loads a single .photon.ts file and extracts tools
 */

import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import {
  PhotonMCP,
  SchemaExtractor,
  DependencyManager,
  ConstructorParam,
  PhotonMCPClass,
  PhotonMCPClassExtended,
  PhotonTool,
  TemplateInfo,
  StaticInfo,
  // Asset types (MCP Apps support)
  type PhotonAssets,
  type UIAsset,
  type PromptAsset,
  type ResourceAsset,
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
  type MaybeStatefulResult,
  // Elicit for fallback
  prompt as elicitPrompt,
  confirm as elicitConfirm,
  // Progress rendering
  ProgressRenderer,
  // MCP Client types and SDK transport
  type MCPClientFactory,
  type MCPDependency,
  type PhotonDependency,
  type ResolvedInjection,
  createMCPProxy,
  MCPClient,
  MCPConfigurationError,
  type MissingMCPInfo,
  type MCPSourceType,
  SDKMCPClientFactory,
  resolveMCPSource,
  type MCPConfig,
  // Photon runtime configuration
  loadPhotonMCPConfig,
  getMCPServerConfig,
  resolveEnvVars,
  type PhotonMCPConfig,
  type MCPServerConfig,
} from '@portel/photon-core';
import * as os from 'os';

interface DependencySpec {
  name: string;
  version: string;
}

import { MarketplaceManager, type Marketplace } from './marketplace-manager.js';
import { PHOTON_VERSION } from './version.js';
import { generateConfigErrorMessage, summarizeConstructorParams, toEnvVarName } from './shared/config-docs.js';
import { createLogger, Logger, type LogLevel } from './shared/logger.js';
import { getErrorMessage, wrapError } from './shared/error-handler.js';
import { validateOrThrow, assertString, notEmpty, hasExtension } from './shared/validation.js';

export class PhotonLoader {
  private dependencyManager: DependencyManager;
  private verbose: boolean;
  private mcpClientFactory?: MCPClientFactory;
  /** Cache of loaded Photon instances by source path */
  private loadedPhotons: Map<string, PhotonMCPClassExtended> = new Map();
  /** MCP clients cache - reuse connections */
  private mcpClients: Map<string, any> = new Map();
  /** SDK factory for MCP connections */
  private sdkFactory?: SDKMCPClientFactory;
  /** Cached MCP config from ~/.photon/mcp-servers.json */
  private mcpConfig?: PhotonMCPConfig;
  /** Progress renderer for inline CLI animation */
  private progressRenderer = new ProgressRenderer();
  /** Marketplace manager for resolving remote Photons */
  private marketplaceManager?: MarketplaceManager;
  private marketplaceManagerPromise?: Promise<MarketplaceManager>;
  private logger: Logger;

  constructor(verbose: boolean = false, logger?: Logger) {
    this.dependencyManager = new DependencyManager();
    this.verbose = verbose;
    this.logger = logger ?? createLogger({ component: 'photon-loader', minimal: true });
  }

  /**
   * Load MCP configuration from ~/.photon/mcp-servers.json
   * Called lazily on first MCP injection
   */
  private async ensureMCPConfig(): Promise<PhotonMCPConfig> {
    if (!this.mcpConfig) {
      this.mcpConfig = await loadPhotonMCPConfig();
      const serverCount = Object.keys(this.mcpConfig.mcpServers).length;
      if (serverCount > 0) {
        this.log(`Loaded ${serverCount} MCP servers from config`);
      }
    }
    return this.mcpConfig;
  }

  private async getMarketplaceManager(): Promise<MarketplaceManager> {
    if (this.marketplaceManager) {
      return this.marketplaceManager;
    }
    if (!this.marketplaceManagerPromise) {
      this.marketplaceManagerPromise = (async () => {
        const managerLogger = this.logger.child({ component: 'marketplace-manager' });
        const manager = new MarketplaceManager(managerLogger);
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
    const normalized = path.resolve(photonPath);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 8);
    return `${mcpName}-${hash}`;
  }
 
  private getPhotonCacheDir(): string {
    return path.join(os.homedir(), '.photon', '.cache', 'photons');
  }
 
  private sanitizeCacheLabel(label: string): string {
    return label.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
 
  private async writePhotonCacheFile(label: string, content: string, hashHint?: string): Promise<string> {
    const cacheDir = this.getPhotonCacheDir();
    await fs.mkdir(cacheDir, { recursive: true });
    const hash = hashHint
      ? hashHint.replace(/^sha256:/, '').slice(0, 12)
      : crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    const safeLabel = this.sanitizeCacheLabel(label);
    const cachePath = path.join(cacheDir, `${safeLabel}.${hash}.photon.ts`);
    await fs.writeFile(cachePath, content, 'utf-8');
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
    return path.join(os.homedir(), '.cache', 'photon-mcp', 'dependencies', cacheKey);
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

  private async readDependencyMetadata(cacheKey: string): Promise<{ hash: string; dependencies: DependencySpec[] } | null> {
    try {
      const data = await fs.readFile(this.getDependencyMetadataPath(cacheKey), 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
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
      deps.map(d => `${d.name}@${d.version}`).sort().join('|');
    return normalize(a) === normalize(b);
  }

  private async writeDependencyMetadata(cacheKey: string, hash: string, dependencies: DependencySpec[], photonPath?: string): Promise<void> {
    const metadataPath = this.getDependencyMetadataPath(cacheKey);
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(
      metadataPath,
      JSON.stringify({ hash, dependencies, photonPath: photonPath ? path.resolve(photonPath) : undefined }, null, 2),
      'utf-8'
    );
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
    const depsMatch = metadata ? this.dependenciesEqual(metadata.dependencies, dependencies) : false;
    const needsClear = Boolean(metadata && (!hashMatches || !depsMatch));

    if (needsClear) {
      const depDir = this.getDependencyCacheDir(cacheKey);
      const buildDir = this.getBuildCacheDir(cacheKey);
      this.log(`🔄 Dependencies changed for ${mcpName} (${cacheKey}), clearing caches`, {
        dependencyCache: depDir,
        buildCache: buildDir,
      });
      await this.clearAllCaches(cacheKey);
    }

    let nodeModules: string | null = null;
    if (dependencies.length > 0) {
      nodeModules = await this.dependencyManager.ensureDependencies(cacheKey, dependencies);
      if (nodeModules) {
        this.log(`📦 Dependencies ready for ${mcpName}`, { nodeModules });
      }
    }

    await this.writeDependencyMetadata(cacheKey, sourceHash, dependencies, photonPath);
    return nodeModules;
  }

  private shouldRetryInstall(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('Cannot find package') ||
      message.includes('ERR_MODULE_NOT_FOUND') ||
      message.includes('Cannot find module')
    );
  }

  private static parseDependenciesFromSource(source: string): DependencySpec[] {
    const deps: DependencySpec[] = [];
    const regex = /@dependencies\s+([^\r\n]+)/g;
    let match;
    while ((match = regex.exec(source)) !== null) {
      const entries = match[1].split(',').map(entry => entry.trim()).filter(Boolean);
      for (const entry of entries) {
        const atIndex = entry.lastIndexOf('@');
        if (atIndex <= 0) {
          continue;
        }
        const name = entry.slice(0, atIndex).trim();
        const version = entry.slice(atIndex + 1).trim();
        if (name && version) {
          deps.push({ name, version });
        }
      }
    }
    return deps;
  }

  private static mergeDependencySpecs(existing: DependencySpec[], additional: DependencySpec[]): DependencySpec[] {
    const map = new Map<string, string>();
    for (const dep of existing) {
      map.set(dep.name, dep.version);
    }
    for (const dep of additional) {
      map.set(dep.name, dep.version);
    }
    return Array.from(map.entries()).map(([name, version]) => ({ name, version }));
  }

  /**
   * Parse @runtime tag from source code
   * @example @runtime ^1.5.0
   * @example @runtime >=1.4.0
   */
  private static parseRuntimeRequirement(source: string): string | undefined {
    const match = source.match(/@runtime\s+([^\r\n\s]+)/);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Check if current runtime version satisfies the required version range
   * Supports: ^1.5.0, >=1.5.0, 1.5.0, ~1.5.0
   */
  private static checkRuntimeCompatibility(required: string, current: string): { compatible: boolean; message?: string } {
    // Parse version components
    const parseVersion = (v: string): [number, number, number] => {
      const clean = v.replace(/^[~^>=<]+/, '');
      const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };

    const [reqMajor, reqMinor, reqPatch] = parseVersion(required);
    const [curMajor, curMinor, curPatch] = parseVersion(current);

    // Determine range type
    const isExact = !required.match(/^[~^>=<]/);
    const isCaret = required.startsWith('^');
    const isTilde = required.startsWith('~');
    const isGte = required.startsWith('>=');
    const isGt = required.startsWith('>') && !isGte;

    let compatible = false;

    if (isExact) {
      // Exact match required
      compatible = curMajor === reqMajor && curMinor === reqMinor && curPatch === reqPatch;
    } else if (isCaret) {
      // ^1.5.0 means >=1.5.0 and <2.0.0
      if (curMajor === reqMajor) {
        if (curMinor > reqMinor) {
          compatible = true;
        } else if (curMinor === reqMinor) {
          compatible = curPatch >= reqPatch;
        }
      }
    } else if (isTilde) {
      // ~1.5.0 means >=1.5.0 and <1.6.0
      compatible = curMajor === reqMajor && curMinor === reqMinor && curPatch >= reqPatch;
    } else if (isGte) {
      // >=1.5.0
      if (curMajor > reqMajor) {
        compatible = true;
      } else if (curMajor === reqMajor) {
        if (curMinor > reqMinor) {
          compatible = true;
        } else if (curMinor === reqMinor) {
          compatible = curPatch >= reqPatch;
        }
      }
    } else if (isGt) {
      // >1.5.0
      if (curMajor > reqMajor) {
        compatible = true;
      } else if (curMajor === reqMajor) {
        if (curMinor > reqMinor) {
          compatible = true;
        } else if (curMinor === reqMinor) {
          compatible = curPatch > reqPatch;
        }
      }
    }

    if (!compatible) {
      return {
        compatible: false,
        message: `This photon requires runtime version ${required}, but you have ${current}. Please upgrade: npm install -g @portel/photon@latest`,
      };
    }

    return { compatible: true };
  }

  /**
   * Load a single Photon MCP file
   */
  async loadFile(filePath: string): Promise<PhotonMCPClassExtended> {
    // Validate input
    assertString(filePath, 'filePath');
    validateOrThrow(filePath, [
      notEmpty('Photon file path'),
      hasExtension('Photon file', ['ts', 'js'])
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
        tsContent = await fs.readFile(absolutePath, 'utf-8');

        // Check runtime version compatibility
        const requiredRuntime = PhotonLoader.parseRuntimeRequirement(tsContent);
        if (requiredRuntime) {
          const check = PhotonLoader.checkRuntimeCompatibility(requiredRuntime, PHOTON_VERSION);
          if (!check.compatible) {
            throw new Error(check.message);
          }
        }

        const extracted = await this.dependencyManager.extractDependencies(absolutePath);
        const parsed = PhotonLoader.parseDependenciesFromSource(tsContent);
        dependencies = PhotonLoader.mergeDependencySpecs(extracted, parsed);

        // Auto-include @portel/photon-core if imported (it's the runtime, always available)
        if (tsContent.includes('@portel/photon-core') && !dependencies.some(d => d.name === '@portel/photon-core')) {
          dependencies.push({ name: '@portel/photon-core', version: `^${PHOTON_VERSION.split('.').slice(0, 2).join('.')}.0` });
        }

        mcpName = path.basename(absolutePath, '.ts').replace('.photon', '');
        cacheKey = this.getCacheKey(mcpName, absolutePath);
        sourceHash = crypto.createHash('sha256').update(tsContent).digest('hex');

        if (dependencies.length > 0) {
          this.log(`📦 Found ${dependencies.length} dependencies`);
        }

        await this.ensureDependenciesWithHash(cacheKey!, mcpName, dependencies, sourceHash, absolutePath);
      }

      const importModule = async () => {
        if (tsContent) {
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
          await this.ensureDependenciesWithHash(cacheKey, mcpName, dependencies, sourceHash, absolutePath);
          module = await importModule();
        } else {
          throw error;
        }
      }

      // Find the exported class
      const MCPClass = this.findMCPClass(module);

      if (!MCPClass || !this.isClass(MCPClass)) {
        throw new Error('No MCP class found in file. Expected a class with async methods.');
      }

      // Get MCP name
      const name = this.getMCPName(MCPClass);

      // Resolve all constructor injections using type-based detection
      const { values, configError } = await this.resolveAllInjections(
        tsContent || '',
        name,
        absolutePath
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

      // Inject MCP client factory if available (enables this.mcp() calls)
      const setMCPFactory = instance.setMCPFactory;
      if (this.mcpClientFactory && typeof setMCPFactory === 'function') {
        setMCPFactory.call(instance, this.mcpClientFactory);
        this.log(`Injected MCP factory into ${name}`);
      }

      // Call lifecycle hook if present with error handling
      const onInitialize = instance.onInitialize;
      if (typeof onInitialize === 'function') {
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

      // Extract tools, templates, and statics (with schema override support)
      const { tools, templates, statics } = await this.extractTools(MCPClass, absolutePath);

      // Extract assets from source and discover asset folder
      const assets = await this.discoverAssets(absolutePath, tsContent || '');

      const counts = [
        tools.length > 0 ? `${tools.length} tools` : null,
        templates.length > 0 ? `${templates.length} templates` : null,
        statics.length > 0 ? `${statics.length} statics` : null,
        assets && (assets.ui.length > 0 || assets.prompts.length > 0 || assets.resources.length > 0)
          ? `${assets.ui.length + assets.prompts.length + assets.resources.length} assets`
          : null,
      ].filter(Boolean).join(', ');

      this.log(`✅ Loaded: ${name} (${counts})`);

      return {
        name,
        description: `${name} MCP`,
        tools,
        templates,
        statics,
        instance,
        assets,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to load ${filePath}: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Reload a Photon MCP file (for hot reload)
   */
  async reloadFile(filePath: string): Promise<PhotonMCPClassExtended> {
    // Invalidate the cache for this file
    const absolutePath = path.resolve(filePath);

    if (absolutePath.endsWith('.ts')) {
      // Clear the compiled cache
      const tsContent = await fs.readFile(absolutePath, 'utf-8');
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
    }

    return this.loadFile(filePath);
  }

  /**
   * Compile TypeScript file to JavaScript and cache it
   */
  private async compileTypeScript(tsFilePath: string, cacheKey: string, tsContent?: string): Promise<string> {
    const source = tsContent ?? await fs.readFile(tsFilePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

    // Store compiled files in dedicated build cache directory
    const cacheDir = this.getBuildCacheDir(cacheKey);
    const fileName = path.basename(tsFilePath, '.ts');
    const cachedJsPath = path.join(cacheDir, `${fileName}.${hash}.mjs`);

    // Check if cached version exists
    try {
      await fs.access(cachedJsPath);
      this.log(`Using cached compiled version`, { cachedJsPath });
      return cachedJsPath;
    } catch {
      // Cache miss - compile it
    }

    // Compile TypeScript to JavaScript
    this.log(`Compiling ${path.basename(tsFilePath)} with esbuild...`);

    const esbuild = await import('esbuild');
    const result = await esbuild.transform(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: 'inline'
    });

    // Ensure cache directory exists
    await fs.mkdir(cacheDir, { recursive: true });

    // Write compiled JavaScript to cache
    await fs.writeFile(cachedJsPath, result.code, 'utf-8');
    this.log(`Compiled and cached`, { cachedJsPath });

    return cachedJsPath;
  }

  /**
   * Find the MCP class in a module
   * Looks for default export or any class with async methods
   */
  private findMCPClass(module: Record<string, unknown>): unknown {
    // Try default export first
    if (module.default && this.isClass(module.default)) {
      if (this.hasAsyncMethods(module.default)) {
        return module.default;
      }
    }

    // Try named exports
    for (const exportedItem of Object.values(module)) {
      if (this.isClass(exportedItem) && this.hasAsyncMethods(exportedItem)) {
        return exportedItem;
      }
    }

    return null;
  }

  /**
   * Check if a function is a class constructor
   */
  private isClass(fn: unknown): fn is new (...args: unknown[]) => unknown {
    return typeof fn === 'function' && /^\s*class\s+/.test(fn.toString());
  }

  /**
   * Check if a class has async methods
   */
  private hasAsyncMethods(ClassConstructor: new (...args: unknown[]) => unknown): boolean {
    const prototype = ClassConstructor.prototype;

    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor && typeof descriptor.value === 'function') {
        // Check if it's an async function or async generator
        const fn = descriptor.value;
        const ctorName = fn.constructor.name;
        if (ctorName === 'AsyncFunction' || ctorName === 'AsyncGeneratorFunction') {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get MCP name from class
   */
  private getMCPName(mcpClass: new (...args: unknown[]) => unknown): string {
    // Try to use PhotonMCP's method if available
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
    // Try to use PhotonMCP's method if available
    const classWithStatic = mcpClass as { getToolMethods?: () => string[]; prototype: Record<string, unknown> };
    if (typeof classWithStatic.getToolMethods === 'function') {
      return classWithStatic.getToolMethods();
    }

    // Fallback: implement convention for plain classes
    const prototype = classWithStatic.prototype;
    const methods: string[] = [];

    Object.getOwnPropertyNames(prototype).forEach((name) => {
      // Skip constructor, private methods (starting with _), and lifecycle hooks
      if (
        name !== 'constructor' &&
        !name.startsWith('_') &&
        name !== 'onInitialize' &&
        name !== 'onShutdown' &&
        typeof prototype[name] === 'function'
      ) {
        methods.push(name);
      }
    });

    return methods;
  }

  /**
   * Extract tools, templates, and statics from a class
   */
  private async extractTools(mcpClass: new (...args: unknown[]) => unknown, sourceFilePath: string): Promise<{
    tools: PhotonTool[];
    templates: TemplateInfo[];
    statics: StaticInfo[];
  }> {
    const methodNames = this.getToolMethods(mcpClass);
    let tools: PhotonTool[] = [];
    let templates: TemplateInfo[] = [];
    let statics: StaticInfo[] = [];

    try {
      // First, try loading from manual schema override file
      const schemaJsonPath = sourceFilePath.replace(/\.ts$/, '.schema.json');
      try {
        const schemaContent = await fs.readFile(schemaJsonPath, 'utf-8');
        const schemas = JSON.parse(schemaContent);

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

        this.log(`Loaded ${tools.length} tools, ${templates.length} templates, ${statics.length} statics from .schema.json override`);
        return { tools, templates, statics };
      } catch (jsonError: unknown) {
        // .schema.json doesn't exist, try extracting from .ts source
        const isNotFound = jsonError instanceof Error && 'code' in jsonError && (jsonError as NodeJS.ErrnoException).code === 'ENOENT';
        if (isNotFound) {
          const extractor = new SchemaExtractor();
          const source = await fs.readFile(sourceFilePath, 'utf-8');
          const metadata = extractor.extractAllFromSource(source);

          // Filter by method names that exist in the class
          tools = metadata.tools.filter(t => methodNames.includes(t.name));
          templates = metadata.templates.filter(t => methodNames.includes(t.name));
          statics = metadata.statics.filter(s => methodNames.includes(s.name));

          this.log(`Extracted ${tools.length} tools, ${templates.length} templates, ${statics.length} statics from source`);
          return { tools, templates, statics };
        }
        throw jsonError;
      }
    } catch (error) {
      this.logger.warn(`⚠️  Failed to extract schemas: ${getErrorMessage(error)}. Using basic tools.`);

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

    return { tools, templates, statics };
  }

  /**
   * Extract constructor parameters from source file
   */
  private async extractConstructorParams(filePath: string): Promise<ConstructorParam[]> {
    try {
      const source = await fs.readFile(filePath, 'utf-8');
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
    photonPath: string
  ): Promise<{ values: any[]; configError: string | null }> {
    const extractor = new SchemaExtractor();
    const injections = extractor.resolveInjections(source, mcpName);

    const values: any[] = [];
    const missingEnvVars: Array<{ paramName: string; envVarName: string; type: string }> = [];
    const missingMCPs: MissingMCPInfo[] = [];
    const missingPhotons: string[] = [];

    for (const injection of injections) {
      const { param, injectionType } = injection;

      switch (injectionType) {
        case 'env': {
          // Inject from environment variable
          const envVarName = injection.envVarName!;
          const envValue = process.env[envVarName];

          if (envValue !== undefined) {
            values.push(this.parseEnvValue(envValue, param.type));
          } else if (param.hasDefault || param.isOptional) {
            values.push(undefined);
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
          try {
            const client = await this.getMCPClient(mcpDep);
            values.push(client);
            this.log(`  ✅ Injected MCP: ${mcpDep.name} (${mcpDep.source})`);
          } catch (error) {
            // If it's already an MCPConfigurationError, re-throw it directly
            if (error instanceof MCPConfigurationError) {
              throw error;
            }

            this.log(`  ⚠️ Failed to create MCP client for ${mcpDep.name}: ${getErrorMessage(error)}`);
            missingMCPs.push({
              name: mcpDep.name,
              source: mcpDep.source,
              sourceType: mcpDep.sourceType as MCPSourceType,
              declaredIn: path.basename(photonPath),
              originalError: getErrorMessage(error),
            });
            values.push(undefined);
          }
          break;
        }

        case 'photon': {
          // Inject Photon instance
          const photonDep = injection.photonDependency!;
          try {
            const photonInstance = await this.getPhotonInstance(photonDep, photonPath);
            values.push(photonInstance);
            this.log(`  ✅ Injected Photon: ${photonDep.name} (${photonDep.source})`);
          } catch (error) {
            this.log(`  ⚠️ Failed to load Photon ${photonDep.name}: ${getErrorMessage(error)}`);
            missingPhotons.push(`@photon ${photonDep.name} ${photonDep.source}: ${getErrorMessage(error)}`);
            values.push(undefined);
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
          missingPhotons.map(d => `  • ${d}`).join('\n') +
          `\n\nEnsure these Photons are installed and accessible.`
        );
      }

      configError = parts.join('\n\n');
    }

    return { values, configError };
  }

  /**
   * Get or create an MCP client for a dependency
   *
   * Resolution order:
   * 1. Check ~/.photon/mcp-servers.json for configured server
   * 2. Fall back to resolving from @mcp declaration source
   *
   * Validates connection on first use - throws MCPConfigurationError if connection fails
   */
  private async getMCPClient(dep: MCPDependency): Promise<any> {
    // Check cache first
    if (this.mcpClients.has(dep.name)) {
      return this.mcpClients.get(dep.name);
    }

    // Try to get config from ~/.photon/mcp-servers.json first
    const photonConfig = await this.ensureMCPConfig();
    let serverConfig: MCPServerConfig;
    let isFromConfig = false;

    if (photonConfig.mcpServers[dep.name]) {
      // Use pre-configured server from mcp-servers.json
      serverConfig = resolveEnvVars(photonConfig.mcpServers[dep.name]);
      isFromConfig = true;
      this.log(`  Using configured MCP: ${dep.name} from mcp-servers.json`);
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
        throw new MCPConfigurationError([{
          name: dep.name,
          source: dep.source,
          sourceType: dep.sourceType as MCPSourceType,
          originalError: errorMsg,
        }]);
      }

      // If configured but failed, provide more specific error
      throw new Error(
        `MCP "${dep.name}" is configured but failed to connect: ${errorMsg}\n` +
        `Check your ~/.photon/mcp-servers.json configuration and ensure:\n` +
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
   * Get or load a Photon instance for a dependency
   */
  private async getPhotonInstance(dep: PhotonDependency, currentPhotonPath: string): Promise<any> {
    // Resolve the Photon path
    const resolvedPath = await this.resolvePhotonPath(dep, currentPhotonPath);

    // Check cache
    if (this.loadedPhotons.has(resolvedPath)) {
      return this.loadedPhotons.get(resolvedPath)!.instance;
    }

    // Load the Photon (recursive call)
    this.log(`  📦 Loading Photon dependency: ${dep.name} from ${resolvedPath}`);
    const loaded = await this.loadFile(resolvedPath);

    // Cache it
    this.loadedPhotons.set(resolvedPath, loaded);

    return loaded.instance;
  }

  /**
   * Resolve Photon dependency path based on source type
   */
  private async resolvePhotonPath(dep: PhotonDependency, currentPhotonPath: string): Promise<string> {
    switch (dep.sourceType) {
      case 'local':
        if (dep.source.startsWith('./') || dep.source.startsWith('../')) {
          return path.resolve(path.dirname(currentPhotonPath), dep.source);
        }
        return dep.source;

      case 'marketplace':
        return await this.resolveMarketplacePhoton(dep, currentPhotonPath);

      case 'github':
        return await this.fetchGithubPhoton(dep);

      case 'npm':
        return await this.resolveNpmPhoton(dep);

      default:
        throw new Error(`Unknown Photon source type: ${dep.sourceType}`);
    }
  }

  private async resolveMarketplacePhoton(dep: PhotonDependency, currentPhotonPath: string): Promise<string> {
    const { slug, fileName, marketplaceHint } = this.normalizeMarketplaceSource(dep.source);
    const photonDir = path.dirname(currentPhotonPath);
    const candidates = [
      path.resolve(photonDir, fileName),
      path.resolve(photonDir, 'photons', fileName),
      path.resolve(photonDir, 'templates', fileName),
      path.join(process.cwd(), fileName),
      path.join(process.cwd(), 'photons', fileName),
      path.join(process.cwd(), 'templates', fileName),
      path.join(os.homedir(), '.photon', fileName),
      path.join(os.homedir(), '.photon', 'photons', fileName),
      path.join(os.homedir(), '.photon', 'marketplace', fileName),
    ];

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

  private normalizeMarketplaceSource(source: string): { slug: string; fileName: string; marketplaceHint?: string } {
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

  private async fetchPhotonFromMarketplace(slug: string, marketplaceHint?: string): Promise<string | null> {
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

  private async fetchPhotonFromSpecificMarketplace(marketplace: Marketplace, slug: string): Promise<string | null> {
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
      const response = await fetch(`${baseUrl}/${slug}.photon.ts`);
      if (response.ok) {
        const content = await response.text();
        return await this.writePhotonCacheFile(`${marketplace.name}-${slug}`, content);
      }
    } catch (error) {
      this.log(`  ⚠️ Failed to fetch ${slug} from marketplace ${marketplace.name}: ${getErrorMessage(error)}`);
    }

    return null;
  }

  private async fetchGithubPhoton(dep: PhotonDependency): Promise<string> {
    const info = this.parseGithubSource(dep);
    const url = `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.ref}/${info.filePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download Photon from GitHub (${dep.source}): HTTP ${response.status}`);
    }
    const content = await response.text();
    const label = `${info.owner}-${info.repo}-${info.filePath.replace(/[\\/]/g, '_')}`;
    return await this.writePhotonCacheFile(label, content);
  }

  private parseGithubSource(dep: PhotonDependency): { owner: string; repo: string; ref: string; filePath: string } {
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
        filePath = filePath.endsWith('.photon')
          ? `${filePath}.ts`
          : `${filePath}.photon.ts`;
      }
    }

    return { owner, repo: repoPart, ref, filePath };
  }

  private async resolveNpmPhoton(dep: PhotonDependency): Promise<string> {
    const { packageSpec, packageName, filePath } = this.parseNpmSource(dep.source);
    const cacheDir = path.join(os.homedir(), '.photon', '.cache', 'npm', this.sanitizeCacheLabel(packageSpec));
    await fs.mkdir(cacheDir, { recursive: true });
    await this.ensureNpmPackageInstalled(cacheDir, packageSpec, packageName);

    const packageRoot = this.getPackageInstallPath(cacheDir, packageName);
    if (!(await this.pathExists(packageRoot))) {
      throw new Error(`npm package "${packageSpec}" did not install correctly.`);
    }

    if (filePath) {
      const normalized = filePath.replace(/^\//, '');
      const explicitCandidates = [
        path.join(packageRoot, normalized),
      ];
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

  private parseNpmSource(source: string): { packageSpec: string; packageName: string; filePath?: string } {
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

  private async ensureNpmPackageInstalled(cacheDir: string, packageSpec: string, packageName: string): Promise<void> {
    const packageJsonPath = path.join(cacheDir, 'package.json');
    if (!(await this.pathExists(packageJsonPath))) {
      const pkgName = `photon-npm-${this.sanitizeCacheLabel(packageSpec)}`;
      await fs.writeFile(packageJsonPath, JSON.stringify({ name: pkgName, version: PHOTON_VERSION }, null, 2), 'utf-8');
    }

    const packageRoot = this.getPackageInstallPath(cacheDir, packageName);
    if (await this.pathExists(packageRoot)) {
      return;
    }

    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await this.runCommand(npmCmd, ['install', packageSpec, '--omit=dev', '--silent', '--no-save'], cacheDir);
  }

  private async findPhotonFile(dir: string, depth = 0): Promise<string | null> {
    if (depth > 4) {
      return null;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
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
   * Resolve constructor arguments from environment variables
   * @deprecated Use resolveAllInjections instead
   */
  private resolveConstructorArgs(
    params: ConstructorParam[],
    mcpName: string
  ): { values: any[]; configError: string | null } {
    const values: any[] = [];
    const missing: Array<{ paramName: string; envVarName: string; type: string }> = [];

    for (const param of params) {
      const envVarName = toEnvVarName(mcpName, param.name);
      const envValue = process.env[envVarName];

      if (envValue !== undefined) {
        // Environment variable provided - parse and use it
        values.push(this.parseEnvValue(envValue, param.type));
      } else if (param.hasDefault || param.isOptional) {
        // Has default value or is optional - use undefined (constructor default will apply)
        values.push(undefined);
      } else {
        // Required parameter missing!
        missing.push({
          paramName: param.name,
          envVarName,
          type: param.type,
        });
        // Push undefined anyway so constructor doesn't break
        values.push(undefined);
      }
    }

    const configError = missing.length > 0
      ? generateConfigErrorMessage(mcpName, missing)
      : null;

    return { values, configError };
  }


  /**
   * Parse environment variable value based on TypeScript type
   */
  private parseEnvValue(value: string, type: string): any {
    switch (type) {
      case 'number':
        return parseFloat(value);
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'string':
      default:
        return value;
    }
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
    const { docs: envVarDocs, exampleEnv: envExample } = summarizeConstructorParams(constructorParams, mcpName);

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
    mcp: PhotonMCPClass,
    toolName: string,
    parameters: any,
    options?: { resumeRunId?: string; outputHandler?: OutputHandler }
  ): Promise<any> {
    try {
      // Check for configuration errors before executing tool
      if (mcp.instance._photonConfigError) {
        throw new Error(mcp.instance._photonConfigError);
      }

      // Check if instance has PhotonMCP's executeTool method
      if (typeof mcp.instance.executeTool === 'function') {
        // PhotonMCP base class handles execution
        const outputHandler = options?.outputHandler || this.createOutputHandler();
        const result = await mcp.instance.executeTool(toolName, parameters, { outputHandler });

        // Handle generator result (if tool returns a generator)
        if (isAsyncGenerator(result)) {
          const finalResult = await executeGenerator(result as AsyncGenerator<PhotonYield, any, any>, {
            inputProvider: this.createInputProvider(),
            outputHandler
          });
          // Clear any lingering progress
          this.progressRenderer.done();
          return finalResult;
        }
        // Clear any lingering progress
        this.progressRenderer.done();
        return result;
      }

      // Plain class - call method directly with implicit stateful support
      const method = mcp.instance[toolName];

      if (!method || typeof method !== 'function') {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Create a generator factory for maybeStatefulExecute
      // This allows re-execution on resume
      const generatorFn = () => method.call(mcp.instance, parameters);

      // Use maybeStatefulExecute for all executions
      // It handles both regular async and generators, detecting checkpoint yields
      const execResult = await maybeStatefulExecute(generatorFn, {
        photon: mcp.name,
        tool: toolName,
        params: parameters,
        inputProvider: this.createInputProvider(),
        outputHandler: options?.outputHandler || this.createOutputHandler(),
        resumeRunId: options?.resumeRunId,
      });

      // Clear any lingering progress
      this.progressRenderer.done();

      // If there was an error, throw it
      if (execResult.error) {
        const error = new Error(execResult.error) as Error & { runId?: string };
        if (execResult.runId) {
          error.runId = execResult.runId;
        }
        throw error;
      }

      // For stateful workflows, wrap result with metadata
      if (execResult.isStateful && execResult.runId) {
        return {
          _stateful: true,
          runId: execResult.runId,
          resumed: execResult.resumed,
          resumedFromStep: execResult.resumedFromStep,
          checkpointsCompleted: execResult.checkpointsCompleted,
          status: execResult.status,
          result: execResult.result,
        };
      }

      // For ephemeral execution, return result directly
      return execResult.result;
    } catch (error) {
      // Clear progress on error too
      this.progressRenderer.done();
      this.logger.error(`Tool execution failed: ${toolName} - ${getErrorMessage(error)}`);
      throw error;
    }
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
          const result = await elicitPrompt(
            `${ask.message}\nOptions: ${options.join(', ')}`
          );
          return result;
        }

        case 'number': {
          const result = await elicitPrompt(ask.message, ask.default?.toString());
          return result ? parseFloat(result) : ask.default ?? 0;
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
          const icon = emit.type === 'error' ? '❌' : emit.type === 'warning' ? '⚠️' : emit.type === 'success' ? '✅' : 'ℹ';
          this.logger.info(`${icon} ${emit.message}`);
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
      }
    };
  }

  /**
   * Extract @mcp dependencies from source and inject them as instance properties
   *
   * This enables the pattern:
   * ```typescript
   * /**
   *  * @mcp github anthropics/mcp-server-github
   *  *\/
   * export default class MyPhoton extends PhotonMCP {
   *   async doSomething() {
   *     const issues = await this.github.list_issues({ repo: 'owner/repo' });
   *   }
   * }
   * ```
   */
  private async injectMCPDependencies(instance: any, source: string, photonName: string): Promise<void> {
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
   * Discover and extract assets from a Photon file
   *
   * Convention:
   * - Asset folder: {photon-name}/ next to {photon-name}.photon.ts
   * - Example: my-tool.photon.ts → my-tool/ (contains ui/, prompts/, resources/)
   *
   * Assets are declared via JSDoc annotations:
   * - @ui <id> <path> - UI templates for MCP Apps
   * - @prompt <id> <path> - Static prompts
   * - @resource <id> <path> - Static resources
   */
  private async discoverAssets(photonPath: string, source: string): Promise<PhotonAssets | undefined> {
    const extractor = new SchemaExtractor();
    const dir = path.dirname(photonPath);
    const basename = path.basename(photonPath, '.photon.ts');

    // Convention: asset folder has same name as photon (without .photon.ts)
    const assetFolder = path.join(dir, basename);

    // Check if asset folder exists
    let folderExists = false;
    try {
      const stat = await fs.stat(assetFolder);
      folderExists = stat.isDirectory();
    } catch {
      // Folder doesn't exist
    }

    // Extract explicit asset declarations from source annotations
    const assets = extractor.extractAssets(source, folderExists ? assetFolder : undefined);

    // If no folder exists and no explicit declarations, skip
    if (!folderExists && assets.ui.length === 0 && assets.prompts.length === 0 && assets.resources.length === 0) {
      return undefined;
    }

    if (folderExists) {
      // Resolve paths for explicitly declared assets
      for (const ui of assets.ui) {
        ui.resolvedPath = path.resolve(assetFolder, ui.path.replace(/^\.\//, ''));
        if (await this.fileExists(ui.resolvedPath)) {
          this.log(`  📄 UI: ${ui.id} → ${ui.path}`);
        } else {
          this.logger.warn(`⚠️  UI asset not found: ${ui.path}`);
        }
      }

      for (const prompt of assets.prompts) {
        prompt.resolvedPath = path.resolve(assetFolder, prompt.path.replace(/^\.\//, ''));
        if (await this.fileExists(prompt.resolvedPath)) {
          this.log(`  📝 Prompt: ${prompt.id} → ${prompt.path}`);
        } else {
          this.logger.warn(`⚠️  Prompt asset not found: ${prompt.path}`);
        }
      }

      for (const resource of assets.resources) {
        resource.resolvedPath = path.resolve(assetFolder, resource.path.replace(/^\.\//, ''));
        if (await this.fileExists(resource.resolvedPath)) {
          this.log(`  📦 Resource: ${resource.id} → ${resource.path}`);
        } else {
          this.logger.warn(`⚠️  Resource asset not found: ${resource.path}`);
        }
      }

      // Auto-discover assets from folder structure (convention-based)
      await this.autoDiscoverAssets(assetFolder, assets);

      // Apply method-level @ui links AFTER auto-discovery
      // This allows linking auto-discovered UI to specific tools
      this.applyMethodUILinks(source, assets);
    }

    return assets;
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
      const asset = assets.ui.find(u => u.id === uiId);
      if (asset && !asset.linkedTool) {
        asset.linkedTool = methodName;
        this.log(`  🔗 UI ${uiId} → ${methodName}`);
      }
    }
  }

  /**
   * Auto-discover assets from folder structure
   * Scans ui/, prompts/, resources/ subdirectories
   */
  private async autoDiscoverAssets(assetFolder: string, assets: PhotonAssets): Promise<void> {
    const extractor = new SchemaExtractor();

    // Auto-discover UI files
    const uiDir = path.join(assetFolder, 'ui');
    if (await this.fileExists(uiDir)) {
      try {
        const files = await fs.readdir(uiDir);
        for (const file of files) {
          const id = path.basename(file, path.extname(file));
          // Skip if already declared
          if (!assets.ui.find(u => u.id === id)) {
            const resolvedPath = path.join(uiDir, file);
            assets.ui.push({
              id,
              path: `./ui/${file}`,
              resolvedPath,
              mimeType: this.getMimeType(file),
            });
            this.log(`  📄 UI (auto): ${id} → ./ui/${file}`);
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Auto-discover prompt files
    const promptsDir = path.join(assetFolder, 'prompts');
    if (await this.fileExists(promptsDir)) {
      try {
        const files = await fs.readdir(promptsDir);
        for (const file of files) {
          if (file.endsWith('.md') || file.endsWith('.txt')) {
            const id = path.basename(file, path.extname(file));
            // Skip if already declared
            if (!assets.prompts.find(p => p.id === id)) {
              const resolvedPath = path.join(promptsDir, file);
              assets.prompts.push({
                id,
                path: `./prompts/${file}`,
                resolvedPath,
              });
              this.log(`  📝 Prompt (auto): ${id} → ./prompts/${file}`);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Auto-discover resource files
    const resourcesDir = path.join(assetFolder, 'resources');
    if (await this.fileExists(resourcesDir)) {
      try {
        const files = await fs.readdir(resourcesDir);
        for (const file of files) {
          const id = path.basename(file, path.extname(file));
          // Skip if already declared
          if (!assets.resources.find(r => r.id === id)) {
            const resolvedPath = path.join(resourcesDir, file);
            assets.resources.push({
              id,
              path: `./resources/${file}`,
              resolvedPath,
              mimeType: this.getMimeType(file),
            });
            this.log(`  📦 Resource (auto): ${id} → ./resources/${file}`);
          }
        }
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get MIME type from file extension
   */
  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase().slice(1);
    const mimeTypes: Record<string, string> = {
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'mjs': 'application/javascript',
      'jsx': 'text/jsx',
      'ts': 'text/typescript',
      'tsx': 'text/tsx',
      'json': 'application/json',
      'yaml': 'application/yaml',
      'yml': 'application/yaml',
      'xml': 'application/xml',
      'md': 'text/markdown',
      'txt': 'text/plain',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'webp': 'image/webp',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}
