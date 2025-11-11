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
  const methodMatches = source.matchAll(/async\s+(\w+)\s*\([^)]*\)/g);

  for (const match of methodMatches) {
    const methodName = match[1];

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

      const optional = /\(optional\)/i.test(paramDesc) || /\(default:/i.test(paramDesc);

      params.push({
        name: paramName,
        type: 'any',
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
 * Parse CLI arguments into method parameters
 */
function parseCliArgs(
  args: string[],
  params: MethodInfo['params']
): Record<string, any> {
  const result: Record<string, any> = {};

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
        result[key] = parseValue(value);
      } else {
        // --key value format (next arg is the value)
        const key = arg.substring(2);
        i++;
        if (i < args.length) {
          result[key] = parseValue(args[i]);
        } else {
          // Boolean flag
          result[key] = true;
        }
      }
    } else {
      // Positional argument
      if (positionalIndex < params.length) {
        result[params[positionalIndex].name] = parseValue(arg);
        positionalIndex++;
      }
    }
  }

  return result;
}

/**
 * Parse a string value into appropriate type
 */
function parseValue(value: string): any {
  // Try to parse as JSON first (handles objects, arrays, numbers, booleans)
  try {
    return JSON.parse(value);
  } catch {
    // Return as string if not valid JSON
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

    // Load the photon using PhotonLoader (handles dependencies and compilation)
    console.error(`🚀 Loading ${photonName}...`);
    const loader = new PhotonLoader(false); // verbose=false for CLI mode
    const photonInstance = await loader.loadFile(resolvedPath);

    // Call the method
    console.error(`📞 Calling ${methodName}...`);
    const result = await loader.executeTool(photonInstance, methodName, parsedArgs);

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
