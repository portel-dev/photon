/**
 * Photon CLI Runner
 *
 * Allows direct invocation of Photon methods from the command line
 * Example: photon cli lg-remote discover
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { SchemaExtractor } from './schema-extractor.js';
import { resolvePhotonPath } from './path-resolver.js';
import { PhotonLoader } from './loader.js';
import { PhotonDocExtractor } from './photon-doc-extractor.js';
import { isDaemonRunning, startDaemon } from './daemon/manager.js';
import { sendCommand, pingDaemon } from './daemon/client.js';

interface MethodInfo {
  name: string;
  params: {
    name: string;
    type: string;
    optional: boolean;
    description?: string;
  }[];
  description?: string;
}

/**
 * Extract all public async methods from a photon file
 */
async function extractMethods(filePath: string): Promise<MethodInfo[]> {
  const source = await fs.readFile(filePath, 'utf-8');
  const extractor = new SchemaExtractor();
  const methods: MethodInfo[] = [];

  // Extract methods using the schema extractor
  const methodMatches = source.matchAll(/async\s+(\w+)\s*\(([^)]*)\)/g);

  for (const match of methodMatches) {
    const methodName = match[1];
    const methodParams = match[2];

    // Skip private methods and lifecycle hooks
    if (
      methodName.startsWith('_') ||
      methodName === 'onInitialize' ||
      methodName === 'onShutdown'
    ) {
      continue;
    }

    // Extract method signature
    const methodIndex = match.index!;
    const precedingContent = source.substring(0, methodIndex);

    // Find JSDoc comment
    const lastJSDocStart = precedingContent.lastIndexOf('/**');
    if (lastJSDocStart === -1) continue;

    const jsdocSection = precedingContent.substring(lastJSDocStart);
    const jsdocMatch = jsdocSection.match(/\/\*\*([\s\S]*?)\*\/\s*$/);

    if (!jsdocMatch) continue;

    const jsdoc = jsdocMatch[1];

    // Extract description
    const descMatch = jsdoc.match(/^\s*\*\s*(.+?)(?=\n\s*\*\s*@|\n\s*$)/s);
    const description = descMatch
      ? descMatch[1]
          .split('\n')
          .map(line => line.replace(/^\s*\*\s?/, '').trim())
          .join(' ')
          .trim()
      : undefined;

    // Parse TypeScript parameter types and optionality from method signature
    const tsParamTypes = new Map<string, string>();
    const tsParamOptional = new Map<string, boolean>();
    if (methodParams.trim()) {
      // Extract: params?: { mute?: boolean } | boolean
      const paramTypeMatch = methodParams.match(/(\w+)(\??):\s*(.+)/);
      if (paramTypeMatch) {
        const tsParamName = paramTypeMatch[1];
        const isParamOptional = paramTypeMatch[2] === '?';
        const paramType = paramTypeMatch[3].trim();

        // Extract base type (handle unions like "{ mute?: boolean } | boolean")
        const baseType = extractBaseType(paramType);

        // Store type for both the TS param name and any inner property names
        tsParamTypes.set(tsParamName, baseType);
        tsParamOptional.set(tsParamName, isParamOptional);

        // Also extract inner object properties: { mute?: boolean }
        const innerProps = extractObjectProperties(paramType);
        for (const [propName, propInfo] of innerProps) {
          tsParamTypes.set(propName, propInfo.type);
          // If the parent param is optional, inner properties are also optional
          tsParamOptional.set(propName, isParamOptional || propInfo.optional);
        }
      }
    }

    // Extract parameters
    const params: MethodInfo['params'] = [];
    const paramRegex = /@param\s+(\w+)\s+(.+?)(?=\n\s*\*\s*@|\n\s*\*\/|\n\s*$)/gs;
    let paramMatch;

    while ((paramMatch = paramRegex.exec(jsdoc)) !== null) {
      const paramName = paramMatch[1];
      const paramDesc = paramMatch[2].trim();

      // Remove JSDoc constraint tags for display
      const cleanDesc = paramDesc
        .replace(/\{@\w+[^}]*\}/g, '')
        .replace(/\(optional\)/gi, '')
        .replace(/\(default:.*?\)/gi, '')
        .trim();

      // Check optional from TypeScript signature first, fallback to JSDoc
      const tsOptional = tsParamOptional.get(paramName);
      const jsdocOptional = /\(optional\)/i.test(paramDesc) || /\(default:/i.test(paramDesc);
      const optional = tsOptional !== undefined ? tsOptional : jsdocOptional;

      params.push({
        name: paramName,
        type: tsParamTypes.get(paramName) || 'any',
        optional,
        description: cleanDesc,
      });
    }

    methods.push({
      name: methodName,
      params,
      description,
    });
  }

  return methods;
}

/**
 * Extract base type from TypeScript type annotation
 * Examples:
 *   "boolean | number" -> "boolean"
 *   "{ mute?: boolean } | boolean" -> "boolean"
 *   "string" -> "string"
 */
function extractBaseType(typeStr: string): string {
  // Handle object types: { mute?: boolean } -> look for type inside
  const objectMatch = typeStr.match(/\{\s*\w+\??\s*:\s*(\w+)/);
  if (objectMatch) {
    return objectMatch[1];
  }

  // Handle unions: boolean | number -> take first primitive type
  const unionTypes = typeStr.split('|').map(t => t.trim());
  for (const type of unionTypes) {
    if (/^(boolean|number|string)/.test(type)) {
      return type;
    }
  }

  return 'any';
}

/**
 * Extract object property types from TypeScript type annotation
 * Examples:
 *   "{ mute?: boolean } | boolean" -> [["mute", { type: "boolean", optional: true }]]
 *   "{ level?: number | string }" -> [["level", { type: "number", optional: true }]]
 */
function extractObjectProperties(typeStr: string): Map<string, { type: string; optional: boolean }> {
  const props = new Map<string, { type: string; optional: boolean }>();

  // Find all object type definitions: { prop?: type } or { prop: type }
  // Match individual properties within object type: prop?: type or prop: type
  const propMatches = typeStr.matchAll(/(\w+)(\??):\s*([^;,}]+)/g);

  for (const match of propMatches) {
    const propName = match[1];
    const isOptional = match[2] === '?';
    const propType = match[3].trim();

    // Extract base type from the property type (handles unions)
    const baseType = extractBaseType(propType);
    props.set(propName, { type: baseType, optional: isOptional });
  }

  return props;
}

/**
 * Parse CLI arguments into method parameters
 */
function parseCliArgs(
  args: string[],
  params: MethodInfo['params']
): Record<string, any> {
  const result: Record<string, any> = {};

  // Create a map of param names to types for quick lookup
  const paramTypes = new Map(params.map(p => [p.name, p.type]));

  // Handle both positional and --flag style arguments
  let positionalIndex = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      // Named argument: --key value or --key=value
      const eqIndex = arg.indexOf('=');

      if (eqIndex !== -1) {
        // --key=value format
        const key = arg.substring(2, eqIndex);
        const value = arg.substring(eqIndex + 1);
        const expectedType = paramTypes.get(key) || 'any';
        result[key] = coerceValue(value, expectedType);
      } else {
        // --key value format (next arg is the value)
        const key = arg.substring(2);
        i++;
        if (i < args.length) {
          const expectedType = paramTypes.get(key) || 'any';
          result[key] = coerceValue(args[i], expectedType);
        } else {
          // Boolean flag
          result[key] = true;
        }
      }
    } else {
      // Positional argument
      if (positionalIndex < params.length) {
        const param = params[positionalIndex];
        result[param.name] = coerceValue(arg, param.type);
        positionalIndex++;
      }
    }
  }

  return result;
}

/**
 * Coerce a string value to the expected type
 */
function coerceValue(value: string, expectedType: string): any {
  // Try to parse as JSON first (handles objects, arrays, true/false)
  try {
    const parsed = JSON.parse(value);
    // If we got a value and need to coerce it
    return coerceToType(parsed, expectedType);
  } catch {
    // Not valid JSON, coerce the string directly
    return coerceToType(value, expectedType);
  }
}

/**
 * Coerce a value to a specific type
 */
function coerceToType(value: any, expectedType: string): any {
  switch (expectedType) {
    case 'boolean':
      // Handle: true, false, 1, 0, "1", "0", "true", "false"
      if (typeof value === 'boolean') return value;
      if (value === 1 || value === '1' || value === 'true') return true;
      if (value === 0 || value === '0' || value === 'false') return false;
      return Boolean(value);

    case 'number':
      // Handle: 42, "42", 3.14, "3.14"
      if (typeof value === 'number') return value;
      const num = Number(value);
      return isNaN(num) ? value : num;

    case 'string':
      // Always convert to string
      return String(value);

    default:
      // For 'any' or unknown types, return as-is
      return value;
  }
}

/**
 * Print help for a specific method
 */
function printMethodHelp(photonName: string, method: MethodInfo): void {
  console.log(`\nNAME:`);
  console.log(`    ${method.name} - ${method.description || 'No description'}\n`);

  console.log(`USAGE:`);
  const requiredParams = method.params.filter(p => !p.optional);
  const optionalParams = method.params.filter(p => p.optional);

  let usage = `    photon cli ${photonName} ${method.name}`;
  if (requiredParams.length > 0) {
    usage += ' ' + requiredParams.map(p => `--${p.name} <value>`).join(' ');
  }
  if (optionalParams.length > 0) {
    usage += ' [options]';
  }
  console.log(usage + '\n');

  if (method.params.length > 0) {
    if (requiredParams.length > 0) {
      console.log(`REQUIRED:`);
      for (const param of requiredParams) {
        console.log(`    --${param.name}`);
        if (param.description) {
          console.log(`        ${param.description}`);
        }
      }
      console.log('');
    }

    if (optionalParams.length > 0) {
      console.log(`OPTIONS:`);
      for (const param of optionalParams) {
        console.log(`    --${param.name}`);
        if (param.description) {
          console.log(`        ${param.description}`);
        }
      }
      console.log('');
    }
  }

  console.log(`EXAMPLE:`);
  if (requiredParams.length > 0) {
    const exampleParams = requiredParams.map(p => `--${p.name} <value>`).join(' ');
    console.log(`    photon cli ${photonName} ${method.name} ${exampleParams}\n`);
  } else {
    console.log(`    photon cli ${photonName} ${method.name}\n`);
  }
}

/**
 * List all methods in a photon (standard CLI help format)
 */
export async function listMethods(photonName: string): Promise<void> {
  try {
    const resolvedPath = await resolvePhotonPath(photonName);

    if (!resolvedPath) {
      console.error(`❌ Photon '${photonName}' not found`);
      console.error(`\nMake sure the photon is installed in ~/.photon/`);
      process.exit(1);
    }

    const methods = await extractMethods(resolvedPath);

    // Print usage
    console.log(`\nUSAGE:`);
    console.log(`    photon cli ${photonName} <command> [options]\n`);

    // Print commands
    console.log(`COMMANDS:`);

    // Find longest method name for alignment
    const maxLength = Math.max(...methods.map(m => m.name.length));

    for (const method of methods) {
      const padding = ' '.repeat(maxLength - method.name.length + 4);
      const description = method.description || 'No description';
      console.log(`    ${method.name}${padding}${description}`);
    }

    // Print footer
    console.log(`\nFor detailed parameter information, run:`);
    console.log(`    photon cli ${photonName} <command> --help\n`);

    // Print examples if there are methods
    if (methods.length > 0) {
      console.log(`EXAMPLES:`);
      // Show first 3 methods as examples
      const exampleMethods = methods.slice(0, 3);
      for (const method of exampleMethods) {
        const requiredParams = method.params.filter(p => !p.optional);
        if (requiredParams.length > 0) {
          const paramStr = requiredParams.map(p => `--${p.name} <value>`).join(' ');
          console.log(`    photon cli ${photonName} ${method.name} ${paramStr}`);
        } else {
          console.log(`    photon cli ${photonName} ${method.name}`);
        }
      }
      console.log('');
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Run a photon method from CLI
 */
export async function runMethod(
  photonName: string,
  methodName: string,
  args: string[]
): Promise<void> {
  try {
    // Resolve photon path
    const resolvedPath = await resolvePhotonPath(photonName);

    if (!resolvedPath) {
      console.error(`❌ Photon '${photonName}' not found`);
      console.error(`\nMake sure the photon is installed in ~/.photon/`);
      process.exit(1);
    }

    // Extract MCP name from filename
    const mcpName = path.basename(resolvedPath).replace(/\.photon\.(ts|js)$/, '');

    // Extract methods to validate
    const methods = await extractMethods(resolvedPath);
    const method = methods.find(m => m.name === methodName);

    if (!method) {
      console.error(`❌ Method '${methodName}' not found in ${photonName}`);
      console.error(`\nAvailable methods: ${methods.map(m => m.name).join(', ')}`);
      console.error(`\nRun 'photon cli ${photonName}' to see all methods`);
      process.exit(1);
    }

    // Check for --help flag
    if (args.includes('--help') || args.includes('-h')) {
      printMethodHelp(photonName, method);
      return;
    }

    // Parse arguments
    const parsedArgs = parseCliArgs(args, method.params);

    // Validate required parameters
    const missing: string[] = [];
    for (const param of method.params) {
      if (!param.optional && !(param.name in parsedArgs)) {
        missing.push(param.name);
      }
    }

    if (missing.length > 0) {
      console.error(`❌ Missing required parameters: ${missing.join(', ')}`);
      console.error(`\nUsage: photon cli ${photonName} ${methodName} ${method.params.map(p =>
        p.optional ? `[--${p.name}]` : `--${p.name} <value>`
      ).join(' ')}`);
      process.exit(1);
    }

    // Check if photon is stateful
    const extractor = new PhotonDocExtractor(resolvedPath);
    const metadata = await extractor.extractFullMetadata();

    let result: any;

    if (metadata.stateful) {
      // STATEFUL PATH: Use daemon
      console.error(`🚀 Loading ${photonName}...`);

      // Check if daemon is running
      if (!isDaemonRunning(photonName)) {
        console.error(`[daemon] Starting daemon for ${photonName}...`);
        await startDaemon(photonName, resolvedPath);

        // Wait for daemon to be ready
        let ready = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          if (await pingDaemon(photonName)) {
            ready = true;
            break;
          }
        }

        if (!ready) {
          console.error(`❌ Failed to start daemon for ${photonName}`);
          process.exit(1);
        }
      }

      // Send command to daemon
      console.error(`📞 Calling ${methodName}...`);
      result = await sendCommand(photonName, methodName, parsedArgs);
    } else {
      // STATELESS PATH: Direct execution
      console.error(`🚀 Loading ${photonName}...`);
      const loader = new PhotonLoader(false); // verbose=false for CLI mode
      const photonInstance = await loader.loadFile(resolvedPath);

      // Call the method
      console.error(`📞 Calling ${methodName}...`);
      result = await loader.executeTool(photonInstance, methodName, parsedArgs);
    }

    // Display result
    console.log('\n✅ Result:\n');
    console.log(JSON.stringify(result, null, 2));

  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Convert MCP name and parameter name to environment variable name
 */
function toEnvVarName(mcpName: string, paramName: string): string {
  const mcpPrefix = mcpName.toUpperCase().replace(/-/g, '_');
  const paramSuffix = paramName
    .replace(/([A-Z])/g, '_$1')
    .toUpperCase()
    .replace(/^_/, '');
  return `${mcpPrefix}_${paramSuffix}`;
}
