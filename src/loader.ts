/**
 * Photon MCP Loader
 *
 * Loads a single .photon.ts file and extracts tools
 */

import * as fs from 'fs/promises';
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
  // Generator utilities
  isAsyncGenerator,
  executeGenerator,
  isInputYield,
  type PhotonYield,
  type InputProvider,
  type OutputHandler,
  // Elicit for fallback
  prompt as elicitPrompt,
  confirm as elicitConfirm,
} from '@portel/photon-core';
import * as os from 'os';

interface DependencySpec {
  name: string;
  version: string;
}

export class PhotonLoader {
  private dependencyManager: DependencyManager;
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.dependencyManager = new DependencyManager();
    this.verbose = verbose;
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

      // Extract constructor parameters from source
      const constructorParams = await this.extractConstructorParams(absolutePath);

      // Resolve values from environment variables
      const { values, configError } = this.resolveConstructorArgs(constructorParams, name);

      // Create instance with injected config
      let instance;
      try {
        instance = new MCPClass(...values);
      } catch (error: any) {
        // Constructor threw an error (likely validation failure)
        // Enhance the error message with config information
        const enhancedError = this.enhanceConstructorError(error, name, constructorParams, configError);
        throw enhancedError;
      }

      // Store config warning for later if there were missing params
      // (constructor didn't throw, but params were missing - they had defaults)
      if (configError) {
        instance._photonConfigError = configError;
        console.error(`⚠️  ${name} loaded with configuration warnings:`);
        console.error(configError);
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

      const counts = [
        tools.length > 0 ? `${tools.length} tools` : null,
        templates.length > 0 ? `${templates.length} templates` : null,
        statics.length > 0 ? `${statics.length} statics` : null,
      ].filter(Boolean).join(', ');

      this.log(`✅ Loaded: ${name} (${counts})`);

      return {
        name,
        description: `${name} MCP`,
        tools,
        templates,
        statics,
        instance,
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
        // Check if it's an async function
        const fn = descriptor.value;
        if (fn.constructor.name === 'AsyncFunction') {
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
   * Resolve constructor arguments from environment variables
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
   */
  async executeTool(mcp: PhotonMCPClass, toolName: string, parameters: any): Promise<any> {
    try {
      // Check for configuration errors before executing tool
      if (mcp.instance._photonConfigError) {
        throw new Error(mcp.instance._photonConfigError);
      }

      // Check if instance has PhotonMCP's executeTool method
      if (typeof mcp.instance.executeTool === 'function') {
        return await mcp.instance.executeTool(toolName, parameters);
      } else {
        // Plain class - call method directly
        const method = mcp.instance[toolName];

        if (!method || typeof method !== 'function') {
          throw new Error(`Tool not found: ${toolName}`);
        }

        const result = method.call(mcp.instance, parameters);

        // Check if result is an async generator
        if (isAsyncGenerator(result)) {
          // Execute the generator with input/output handling
          // Cast to expected type (generator methods should yield PhotonYield)
          return await executeGenerator(result as AsyncGenerator<PhotonYield, any, any>, {
            inputProvider: this.createInputProvider(),
            outputHandler: this.createOutputHandler(),
          });
        }

        return await result;
      }
    } catch (error: any) {
      console.error(`Tool execution failed: ${toolName} - ${error.message}`);
      throw error;
    }
  }

  /**
   * Create an input provider for generator yields
   * Uses the global prompt handler or falls back to native dialogs
   */
  private createInputProvider(): InputProvider {
    return async (yielded: PhotonYield) => {
      if (!isInputYield(yielded)) return undefined;

      if ('prompt' in yielded) {
        // Use global prompt handler (set by CLI/MCP) or fallback to elicit
        return await elicitPrompt(yielded.prompt, yielded.default);
      }

      if ('confirm' in yielded) {
        return await elicitConfirm(yielded.confirm);
      }

      if ('select' in yielded) {
        // For select, show options and get selection
        // TODO: Implement select handling
        const options = yielded.options.map((o: string | { value: string; label: string }) =>
          typeof o === 'string' ? o : o.label
        );
        const result = await elicitPrompt(
          `${yielded.select}\nOptions: ${options.join(', ')}`
        );
        return result;
      }

      return undefined;
    };
  }

  /**
   * Create an output handler for generator yields (progress, stream, log)
   */
  private createOutputHandler(): OutputHandler {
    return (yielded: PhotonYield) => {
      if ('progress' in yielded) {
        console.error(`[progress] ${yielded.progress}% ${yielded.status || ''}`);
      } else if ('stream' in yielded) {
        // Stream data to stdout
        if (typeof yielded.stream === 'string') {
          process.stdout.write(yielded.stream);
        } else {
          console.log(JSON.stringify(yielded.stream));
        }
      } else if ('log' in yielded) {
        const level = yielded.level || 'info';
        console.error(`[${level}] ${yielded.log}`);
      }
    };
  }
}
