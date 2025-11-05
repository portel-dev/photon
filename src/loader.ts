/**
 * Photon MCP Loader
 *
 * Loads a single .photon.ts file and extracts tools
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as crypto from 'crypto';
import { PhotonMCP } from './base.js';
import { SchemaExtractor } from './schema-extractor.js';
import { PhotonMCPClass, PhotonTool } from './types.js';
import * as os from 'os';

export class PhotonLoader {
  /**
   * Load a single Photon MCP file
   */
  async loadFile(filePath: string): Promise<PhotonMCPClass> {
    try {
      // Resolve to absolute path
      const absolutePath = path.resolve(filePath);

      // Check file exists
      await fs.access(absolutePath);

      // Convert file path to file:// URL for ESM imports
      let module: any;

      if (absolutePath.endsWith('.ts')) {
        // Compile TypeScript to JavaScript using esbuild
        const cachedJsPath = await this.compileTypeScript(absolutePath);
        const cachedJsUrl = pathToFileURL(cachedJsPath).href;

        // Add cache busting to avoid stale imports
        module = await import(`${cachedJsUrl}?t=${Date.now()}`);
      } else {
        // Regular JavaScript import
        const fileUrl = pathToFileURL(absolutePath).href;
        module = await import(`${fileUrl}?t=${Date.now()}`);
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
        console.error(`[Photon] ⚠️  ${name} MCP loaded with configuration warnings`);
        console.error(configError);
      }

      // Call lifecycle hook if present
      if (instance.onInitialize) {
        await instance.onInitialize();
      }

      // Extract tools
      const tools = await this.extractTools(MCPClass, absolutePath);

      console.error(`[Photon] ✅ Loaded: ${name} (${tools.length} tools)`);

      return {
        name,
        description: `${name} MCP`,
        tools,
        instance,
      };
    } catch (error: any) {
      console.error(`[Photon] ❌ Failed to load ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Reload a Photon MCP file (for hot reload)
   */
  async reloadFile(filePath: string): Promise<PhotonMCPClass> {
    // Invalidate the cache for this file
    const absolutePath = path.resolve(filePath);

    if (absolutePath.endsWith('.ts')) {
      // Clear the compiled cache
      const tsContent = await fs.readFile(absolutePath, 'utf-8');
      const hash = crypto.createHash('sha256').update(tsContent).digest('hex').slice(0, 16);
      const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
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
  private async compileTypeScript(tsFilePath: string): Promise<string> {
    // Generate cache path based on file content hash
    const tsContent = await fs.readFile(tsFilePath, 'utf-8');
    const hash = crypto.createHash('sha256').update(tsContent).digest('hex').slice(0, 16);

    const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
    const fileName = path.basename(tsFilePath, '.ts');
    const cachedJsPath = path.join(cacheDir, `${fileName}.${hash}.mjs`);

    // Check if cached version exists
    try {
      await fs.access(cachedJsPath);
      console.error(`[Photon] Using cached compiled version`);
      return cachedJsPath;
    } catch {
      // Cache miss - compile it
    }

    // Compile TypeScript to JavaScript
    console.error(`[Photon] Compiling ${path.basename(tsFilePath)} with esbuild...`);

    const esbuild = await import('esbuild');
    const result = await esbuild.transform(tsContent, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: 'inline'
    });

    // Ensure cache directory exists
    await fs.mkdir(cacheDir, { recursive: true });

    // Write compiled JavaScript to cache
    await fs.writeFile(cachedJsPath, result.code, 'utf-8');
    console.error(`[Photon] Compiled and cached`);

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
   * Extract tools from a class
   */
  private async extractTools(mcpClass: any, sourceFilePath: string): Promise<PhotonTool[]> {
    const methodNames = this.getToolMethods(mcpClass);
    const tools: PhotonTool[] = [];

    try {
      // First, try loading from pre-generated .schema.json file
      const schemaJsonPath = sourceFilePath.replace(/\.ts$/, '.photon.schema.json');
      try {
        const schemaContent = await fs.readFile(schemaJsonPath, 'utf-8');
        const schemas = JSON.parse(schemaContent);

        for (const schema of schemas) {
          if (methodNames.includes(schema.name)) {
            tools.push({
              name: schema.name,
              description: schema.description,
              inputSchema: schema.inputSchema,
            });
          }
        }

        console.error(`[Photon] Loaded ${tools.length} schemas from .schema.json`);
        return tools;
      } catch (jsonError: any) {
        // .schema.json doesn't exist, try extracting from .ts source
        if (jsonError.code === 'ENOENT') {
          const extractor = new SchemaExtractor();
          const schemas = await extractor.extractFromFile(sourceFilePath);

          for (const schema of schemas) {
            if (methodNames.includes(schema.name)) {
              tools.push({
                name: schema.name,
                description: schema.description,
                inputSchema: schema.inputSchema,
              });
            }
          }

          console.error(`[Photon] Extracted ${tools.length} schemas from source`);
          return tools;
        }
        throw jsonError;
      }
    } catch (error: any) {
      console.error(`[Photon] ⚠️  Failed to extract schemas: ${error.message}. Using basic tools.`);

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

    return tools;
  }

  /**
   * Extract constructor parameters from source file
   */
  private async extractConstructorParams(filePath: string): Promise<import('./types.js').ConstructorParam[]> {
    try {
      const source = await fs.readFile(filePath, 'utf-8');
      const extractor = new SchemaExtractor();
      return extractor.extractConstructorParams(source);
    } catch (error: any) {
      console.error(`[Photon] Failed to extract constructor params: ${error.message}`);
      return [];
    }
  }

  /**
   * Resolve constructor arguments from environment variables
   */
  private resolveConstructorArgs(
    params: import('./types.js').ConstructorParam[],
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
    constructorParams: import('./types.js').ConstructorParam[],
    configError: string | null
  ): Error {
    const originalMessage = error.message;

    // Build env var documentation
    const envVarDocs = constructorParams.map(param => {
      const envVarName = this.toEnvVarName(mcpName, param.name);
      const required = !param.isOptional && !param.hasDefault;
      const status = required ? '[REQUIRED]' : '[OPTIONAL]';
      return `  • ${envVarName} ${status} (${param.name}: ${param.type})`;
    }).join('\n');

    const enhancedMessage = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Configuration Error: ${mcpName} MCP failed to initialize

Original error: ${originalMessage}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Configuration parameters:
${envVarDocs}

To fix this, set environment variables in your MCP client:

{
  "mcpServers": {
    "${mcpName}": {
      "command": "npx",
      "args": ["@portel/photon", "${mcpName}"],
      "env": {
        // Add required environment variables here
      }
    }
  }
}

Or run: photon ${mcpName} --config

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

    const enhanced = new Error(enhancedMessage);
    enhanced.name = 'PhotonConfigError';
    enhanced.stack = error.stack;
    return enhanced;
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

        return await method.call(mcp.instance, parameters);
      }
    } catch (error: any) {
      console.error(`[Photon] Tool execution failed: ${toolName} - ${error.message}`);
      throw error;
    }
  }
}
