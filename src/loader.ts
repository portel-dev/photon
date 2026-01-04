/**
 * Photon MCP Loader
 *
 * Loads a single .photon.ts file and extracts tools
 */

import * as fs from 'fs/promises';
import { accessSync } from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as crypto from 'crypto';
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

/**
 * Inline progress renderer for CLI
 * Shows progress bar with animation on a single line
 */
class ProgressRenderer {
  private lastLength = 0;
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private spinnerIndex = 0;
  private isActive = false;

  /**
   * Render progress inline (overwrites current line)
   */
  render(value: number, message?: string): void {
    this.isActive = true;
    const pct = Math.round(value * 100);
    const barWidth = 20;
    const filled = Math.round(value * barWidth);
    const empty = barWidth - filled;

    // Progress bar: [████████░░░░░░░░░░░░]
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    const spinner = pct < 100 ? this.spinnerFrames[this.spinnerIndex++ % this.spinnerFrames.length] : '✓';

    const text = `${spinner} [${bar}] ${pct.toString().padStart(3)}%${message ? ` ${message}` : ''}`;

    // Clear previous line and write new content
    this.clearLine();
    process.stderr.write(text);
    this.lastLength = text.length;
  }

  /**
   * Clear the progress line
   */
  clearLine(): void {
    if (this.lastLength > 0) {
      process.stderr.write('\r' + ' '.repeat(this.lastLength) + '\r');
    }
  }

  /**
   * End progress display (clears the line)
   */
  done(): void {
    if (this.isActive) {
      this.clearLine();
      this.isActive = false;
      this.lastLength = 0;
    }
  }

  /**
   * Print a status message (clears progress first)
   */
  status(message: string): void {
    this.done();
    console.error(`ℹ ${message}`);
  }
}

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

  constructor(verbose: boolean = false) {
    this.dependencyManager = new DependencyManager();
    this.verbose = verbose;
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

  /**
   * Set MCP client factory for enabling this.mcp() in Photons
   */
  setMCPClientFactory(factory: MCPClientFactory): void {
    this.mcpClientFactory = factory;
  }

  /**
   * Log message only if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.verbose) {
      console.error(message);
    }
  }

  /**
   * Directory where MCP-specific dependencies are cached
   */
  private getDependencyCacheDir(mcpName: string): string {
    return path.join(os.homedir(), '.cache', 'photon-mcp', 'dependencies', mcpName);
  }

  /**
   * Path to metadata file describing installed dependencies
   */
  private getDependencyMetadataPath(mcpName: string): string {
    return path.join(this.getDependencyCacheDir(mcpName), 'metadata.json');
  }

  private async readDependencyMetadata(mcpName: string): Promise<{ hash: string; dependencies: DependencySpec[] } | null> {
    try {
      const data = await fs.readFile(this.getDependencyMetadataPath(mcpName), 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
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

  private async writeDependencyMetadata(mcpName: string, hash: string, dependencies: DependencySpec[]): Promise<void> {
    const metadataPath = this.getDependencyMetadataPath(mcpName);
    await fs.mkdir(path.dirname(metadataPath), { recursive: true });
    await fs.writeFile(metadataPath, JSON.stringify({ hash, dependencies }, null, 2), 'utf-8');
  }

  private async ensureDependenciesWithHash(
    mcpName: string,
    dependencies: DependencySpec[],
    sourceHash: string
  ): Promise<string | null> {
    const metadata = await this.readDependencyMetadata(mcpName);
    const hashMatches = metadata?.hash === sourceHash;
    const depsMatch = metadata ? this.dependenciesEqual(metadata.dependencies, dependencies) : false;
    const needsClear = Boolean(metadata && (!hashMatches || !depsMatch));

    if (needsClear) {
      this.log(`🔄 Dependencies changed for ${mcpName}, clearing cache`);
      await this.dependencyManager.clearCache(mcpName);
    }

    let nodeModules: string | null = null;
    if (dependencies.length > 0) {
      nodeModules = await this.dependencyManager.ensureDependencies(mcpName, dependencies);
    }

    await this.writeDependencyMetadata(mcpName, sourceHash, dependencies);
    return nodeModules;
  }

  private shouldRetryInstall(error: any): boolean {
    const message = error?.message?.toString() || '';
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
   * Load a single Photon MCP file
   */
  async loadFile(filePath: string): Promise<PhotonMCPClassExtended> {
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

      if (absolutePath.endsWith('.ts')) {
        tsContent = await fs.readFile(absolutePath, 'utf-8');
        const extracted = await this.dependencyManager.extractDependencies(absolutePath);
        const parsed = PhotonLoader.parseDependenciesFromSource(tsContent);
        dependencies = PhotonLoader.mergeDependencySpecs(extracted, parsed);
        mcpName = path.basename(absolutePath, '.ts').replace('.photon', '');
        sourceHash = crypto.createHash('sha256').update(tsContent).digest('hex');

        if (dependencies.length > 0) {
          this.log(`📦 Found ${dependencies.length} dependencies`);
        }

        await this.ensureDependenciesWithHash(mcpName, dependencies, sourceHash);
      }

      const importModule = async () => {
        if (tsContent) {
          const cachedJsPath = await this.compileTypeScript(absolutePath, mcpName, tsContent);
          const cachedJsUrl = pathToFileURL(cachedJsPath).href;
          return await import(`${cachedJsUrl}?t=${Date.now()}`);
        }
        const fileUrl = pathToFileURL(absolutePath).href;
        return await import(`${fileUrl}?t=${Date.now()}`);
      };

      try {
        module = await importModule();
      } catch (error: any) {
        if (this.shouldRetryInstall(error) && tsContent && sourceHash && mcpName) {
          this.log(`⚠️  Missing dependency detected, reinstalling dependencies for ${mcpName}`);
          await this.dependencyManager.clearCache(mcpName);
          await this.ensureDependenciesWithHash(mcpName, dependencies, sourceHash);
          module = await importModule();
        } else {
          throw error;
        }
      }

      // Find the exported class
      const MCPClass = this.findMCPClass(module);

      if (!MCPClass) {
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
      let instance;
      try {
        instance = new MCPClass(...values);
      } catch (error: any) {
        // Constructor threw an error (likely validation failure)
        const constructorParams = await this.extractConstructorParams(absolutePath);
        const enhancedError = this.enhanceConstructorError(error, name, constructorParams, configError);
        throw enhancedError;
      }

      // Store config warning for later if there were missing params
      if (configError) {
        instance._photonConfigError = configError;
        console.error(`⚠️  ${name} loaded with configuration warnings:`);
        console.error(configError);
      }

      // Inject MCP client factory if available (enables this.mcp() calls)
      if (this.mcpClientFactory && typeof instance.setMCPFactory === 'function') {
        instance.setMCPFactory(this.mcpClientFactory);
        this.log(`Injected MCP factory into ${name}`);
      }

      // Call lifecycle hook if present with error handling
      if (instance.onInitialize) {
        try {
          await instance.onInitialize();
        } catch (error: any) {
          const initError = new Error(
            `Initialization failed for ${name}: ${error.message}\n` +
            `\nThe onInitialize() lifecycle hook threw an error.\n` +
            `Check your constructor configuration and initialization logic.`
          );
          initError.name = 'PhotonInitializationError';
          initError.stack = error.stack;
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
    } catch (error: any) {
      console.error(`❌ Failed to load ${filePath}: ${error.message}`);
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
      const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'dependencies', mcpName);
      const fileName = path.basename(absolutePath, '.ts');
      const cachedJsPath = path.join(cacheDir, `${fileName}.${hash}.mjs`);

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
  private async compileTypeScript(tsFilePath: string, mcpName: string, tsContent?: string): Promise<string> {
    const source = tsContent ?? await fs.readFile(tsFilePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

    // Store compiled files in the same directory as dependencies for module resolution
    const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'dependencies', mcpName);
    const fileName = path.basename(tsFilePath, '.ts');
    const cachedJsPath = path.join(cacheDir, `${fileName}.${hash}.mjs`);

    // Check if cached version exists
    try {
      await fs.access(cachedJsPath);
      this.log(`Using cached compiled version`);
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
    this.log(`Compiled and cached`);

    return cachedJsPath;
  }

  /**
   * Find the MCP class in a module
   * Looks for default export or any class with async methods
   */
  private findMCPClass(module: any): any {
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
  private isClass(fn: any): boolean {
    return typeof fn === 'function' && /^\s*class\s+/.test(fn.toString());
  }

  /**
   * Check if a class has async methods
   */
  private hasAsyncMethods(ClassConstructor: any): boolean {
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
  private getMCPName(mcpClass: any): string {
    // Try to use PhotonMCP's method if available
    if (typeof mcpClass.getMCPName === 'function') {
      return mcpClass.getMCPName();
    }

    // Fallback: implement convention for plain classes
    // Convert PascalCase to kebab-case (e.g., MyAwesomeMCP → my-awesome-mcp)
    return mcpClass.name
      .replace(/MCP$/, '') // Remove "MCP" suffix if present
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, ''); // Remove leading dash
  }

  /**
   * Get tool methods from class
   */
  private getToolMethods(mcpClass: any): string[] {
    // Try to use PhotonMCP's method if available
    if (typeof mcpClass.getToolMethods === 'function') {
      return mcpClass.getToolMethods();
    }

    // Fallback: implement convention for plain classes
    const prototype = mcpClass.prototype;
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
  private async extractTools(mcpClass: any, sourceFilePath: string): Promise<{
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
      } catch (jsonError: any) {
        // .schema.json doesn't exist, try extracting from .ts source
        if (jsonError.code === 'ENOENT') {
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
    } catch (error: any) {
      console.error(`⚠️  Failed to extract schemas: ${error.message}. Using basic tools.`);

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
    } catch (error: any) {
      console.error(`Failed to extract constructor params: ${error.message}`);
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
          } catch (error: any) {
            // If it's already an MCPConfigurationError, re-throw it directly
            if (error instanceof MCPConfigurationError) {
              throw error;
            }

            this.log(`  ⚠️ Failed to create MCP client for ${mcpDep.name}: ${error.message}`);
            missingMCPs.push({
              name: mcpDep.name,
              source: mcpDep.source,
              sourceType: mcpDep.sourceType as MCPSourceType,
              declaredIn: path.basename(photonPath),
              originalError: error.message,
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
          } catch (error: any) {
            this.log(`  ⚠️ Failed to load Photon ${photonDep.name}: ${error.message}`);
            missingPhotons.push(`@photon ${photonDep.name} ${photonDep.source}: ${error.message}`);
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
        parts.push(this.generateConfigErrorMessage(mcpName, missingEnvVars));
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
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown connection error';

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
    const resolvedPath = this.resolvePhotonPath(dep, currentPhotonPath);

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
  private resolvePhotonPath(dep: PhotonDependency, currentPhotonPath: string): string {
    switch (dep.sourceType) {
      case 'local':
        // Relative to current Photon
        if (dep.source.startsWith('./') || dep.source.startsWith('../')) {
          return path.resolve(path.dirname(currentPhotonPath), dep.source);
        }
        return dep.source;

      case 'marketplace':
        // TODO: Resolve from configured marketplace
        // For now, try common locations
        const marketplacePaths = [
          path.join(os.homedir(), '.photon', `${dep.source}.photon.ts`),
          path.join(os.homedir(), '.photon', 'marketplace', `${dep.source}.photon.ts`),
          path.join(process.cwd(), 'photons', `${dep.source}.photon.ts`),
          path.join(process.cwd(), `${dep.source}.photon.ts`),
        ];
        for (const p of marketplacePaths) {
          try {
            accessSync(p);
            return p;
          } catch {
            // Continue to next path
          }
        }
        throw new Error(`Photon "${dep.source}" not found in marketplace. Available locations checked: ${marketplacePaths.join(', ')}`);

      case 'github':
        // TODO: Download from GitHub
        throw new Error(`GitHub Photon source not yet implemented: ${dep.source}`);

      case 'npm':
        // TODO: Install from npm
        throw new Error(`npm Photon source not yet implemented: ${dep.source}`);

      default:
        throw new Error(`Unknown Photon source type: ${dep.sourceType}`);
    }
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
      const envVarName = this.toEnvVarName(mcpName, param.name);
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
      ? this.generateConfigErrorMessage(mcpName, missing)
      : null;

    return { values, configError };
  }

  /**
   * Convert MCP name and parameter name to environment variable name
   * Example: filesystem, workdir → FILESYSTEM_WORKDIR
   */
  private toEnvVarName(mcpName: string, paramName: string): string {
    const mcpPrefix = mcpName.toUpperCase().replace(/-/g, '_');
    const paramSuffix = paramName
      .replace(/([A-Z])/g, '_$1')
      .toUpperCase()
      .replace(/^_/, '');
    return `${mcpPrefix}_${paramSuffix}`;
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
    const originalMessage = error.message;

    // Build detailed env var documentation with examples
    const envVarDocs = constructorParams.map(param => {
      const envVarName = this.toEnvVarName(mcpName, param.name);
      const required = !param.isOptional && !param.hasDefault;
      const status = required ? '[REQUIRED]' : '[OPTIONAL]';

      // Generate helpful example values based on type and name
      const exampleValue = this.generateExampleValue(param.name, param.type);
      const defaultInfo = param.hasDefault
        ? ` (default: ${JSON.stringify(param.defaultValue)})`
        : '';

      let line = `  • ${envVarName} ${status}`;
      line += `\n    Type: ${param.type}${defaultInfo}`;
      if (exampleValue) {
        line += `\n    Example: ${envVarName}="${exampleValue}"`;
      }

      return line;
    }).join('\n\n');

    // Build example config with placeholder values
    const envExample: Record<string, string> = {};
    constructorParams.forEach(param => {
      const envVarName = this.toEnvVarName(mcpName, param.name);
      if (!param.isOptional && !param.hasDefault) {
        envExample[envVarName] = this.generateExampleValue(param.name, param.type) || `your-${param.name}`;
      }
    });

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
   * Generate helpful example values based on parameter name and type
   */
  private generateExampleValue(paramName: string, paramType: string): string | null {
    const lowerName = paramName.toLowerCase();

    // API keys and tokens
    if (lowerName.includes('apikey') || lowerName.includes('api_key')) {
      return 'sk_your_api_key_here';
    }
    if (lowerName.includes('token') || lowerName.includes('secret')) {
      return 'your_secret_token';
    }

    // URLs and endpoints
    if (lowerName.includes('url') || lowerName.includes('endpoint')) {
      return 'https://api.example.com';
    }
    if (lowerName.includes('host') || lowerName.includes('server')) {
      return 'localhost';
    }

    // Ports
    if (lowerName.includes('port')) {
      return '5432';
    }

    // Database
    if (lowerName.includes('database') || lowerName.includes('db')) {
      return 'my_database';
    }
    if (lowerName.includes('user') || lowerName.includes('username')) {
      return 'admin';
    }
    if (lowerName.includes('password')) {
      return 'your_secure_password';
    }

    // Paths
    if (lowerName.includes('path') || lowerName.includes('dir')) {
      return '/path/to/directory';
    }

    // Common names
    if (lowerName.includes('name')) {
      return 'my-service';
    }
    if (lowerName.includes('region')) {
      return 'us-east-1';
    }

    // Type-based defaults
    if (paramType === 'boolean') {
      return 'true';
    }
    if (paramType === 'number') {
      return '3000';
    }

    return null;
  }

  /**
   * Generate user-friendly configuration error message
   */
  private generateConfigErrorMessage(
    mcpName: string,
    missing: Array<{ paramName: string; envVarName: string; type: string }>
  ): string {
    const envVarList = missing.map(m => `  • ${m.envVarName} (${m.paramName}: ${m.type})`).join('\n');

    const exampleEnv = Object.fromEntries(
      missing.map(m => [m.envVarName, `<your-${m.paramName}>`])
    );

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Configuration Warning: ${mcpName} MCP

Missing required environment variables:
${envVarList}

Tools will fail until configuration is fixed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

To fix, add environment variables to your MCP client config:

{
  "mcpServers": {
    "${mcpName}": {
      "command": "npx",
      "args": ["@portel/photon", "${mcpName}"],
      "env": ${JSON.stringify(exampleEnv, null, 8).replace(/\n/g, '\n      ')}
    }
  }
}

Or run: photon ${mcpName} --config

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();
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
    options?: { resumeRunId?: string }
  ): Promise<any> {
    try {
      // Check for configuration errors before executing tool
      if (mcp.instance._photonConfigError) {
        throw new Error(mcp.instance._photonConfigError);
      }

      // Check if instance has PhotonMCP's executeTool method
      if (typeof mcp.instance.executeTool === 'function') {
        // PhotonMCP base class handles execution
        return await mcp.instance.executeTool(toolName, parameters);
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
        outputHandler: this.createOutputHandler(),
        resumeRunId: options?.resumeRunId,
      });

      // If there was an error, throw it
      if (execResult.error) {
        const error = new Error(execResult.error);
        if (execResult.runId) {
          (error as any).runId = execResult.runId;
        }
        throw error;
      }

      // For stateful workflows, wrap result with metadata
      if (execResult.isStateful && execResult.runId) {
        return {
          _stateful: true,
          runId: execResult.runId,
          resumed: execResult.resumed,
          status: execResult.status,
          result: execResult.result,
        };
      }

      // For ephemeral execution, return result directly
      return execResult.result;
    } catch (error: any) {
      console.error(`Tool execution failed: ${toolName} - ${error.message}`);
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
          console.error(`⚠️ File selection not supported in CLI: ${ask.message}`);
          return null;

        default:
          console.error(`⚠️ Unknown ask type: ${(ask as any).ask}`);
          return undefined;
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
          // Status clears progress and prints message
          this.progressRenderer.status(emit.message);
          break;

        case 'log': {
          // Logs clear progress first to avoid overlap
          this.progressRenderer.done();
          const level = emit.level || 'info';
          const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ';
          console.error(`${prefix} ${emit.message}`);
          break;
        }

        case 'toast':
          this.progressRenderer.done();
          const icon = emit.type === 'error' ? '❌' : emit.type === 'warning' ? '⚠️' : emit.type === 'success' ? '✅' : 'ℹ';
          console.error(`${icon} ${emit.message}`);
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
            console.log(JSON.stringify(emit.data));
          }
          break;

        case 'artifact':
          this.progressRenderer.done();
          console.error(`📦 ${emit.title || emit.type}: ${emit.mimeType}`);
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
      } catch (error: any) {
        console.error(`⚠️  Failed to resolve MCP ${dep.name}: ${error.message}`);
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
          console.warn(`⚠️  UI asset not found: ${ui.path}`);
        }
      }

      for (const prompt of assets.prompts) {
        prompt.resolvedPath = path.resolve(assetFolder, prompt.path.replace(/^\.\//, ''));
        if (await this.fileExists(prompt.resolvedPath)) {
          this.log(`  📝 Prompt: ${prompt.id} → ${prompt.path}`);
        } else {
          console.warn(`⚠️  Prompt asset not found: ${prompt.path}`);
        }
      }

      for (const resource of assets.resources) {
        resource.resolvedPath = path.resolve(assetFolder, resource.path.replace(/^\.\//, ''));
        if (await this.fileExists(resource.resolvedPath)) {
          this.log(`  📦 Resource: ${resource.id} → ${resource.path}`);
        } else {
          console.warn(`⚠️  Resource asset not found: ${resource.path}`);
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
