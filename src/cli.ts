#!/usr/bin/env node

/**
 * Photon MCP CLI
 *
 * Command-line interface for running .photon.ts files as MCP servers
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import { PhotonServer } from './server.js';
import { FileWatcher } from './watcher.js';
import { resolvePhotonPath, listPhotonMCPs, ensureWorkingDir, DEFAULT_WORKING_DIR } from './path-resolver.js';
import { SchemaExtractor } from './schema-extractor.js';
import { ConstructorParam } from './types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Extract constructor parameters from a Photon MCP file
 */
async function extractConstructorParams(filePath: string): Promise<ConstructorParam[]> {
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

/**
 * Format default value for display in config
 */
function formatDefaultValue(value: any): string {
  if (typeof value === 'string') {
    // Check if it's a function call expression
    if (value.includes('homedir()')) {
      // Replace homedir() with actual home directory
      return value.replace(/join\(homedir\(\),\s*['"]([^'"]+)['"]\)/g, (_, folderName) => {
        return path.join(os.homedir(), folderName);
      });
    }
    if (value.includes('process.cwd()')) {
      return process.cwd();
    }
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // For other complex expressions
  return String(value);
}

// Get version from package.json
let version = '1.0.0';
try {
  const packageJson = require('../package.json');
  version = packageJson.version;
} catch {
  // Fallback version
}

const program = new Command();

program
  .name('photon')
  .description('Run single-file TypeScript MCPs')
  .version(version)
  .option('--working-dir <dir>', 'Working directory for MCPs (default: ~/.photon)', DEFAULT_WORKING_DIR);

// Main command: run a .photon.ts file
program
  .argument('<name>', 'MCP name (without .photon.ts extension)')
  .option('--dev', 'Enable development mode with hot reload')
  .option('--config', 'Output Claude Desktop config snippet')
  .option('--verbose', 'Show detailed logs')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`[Photon] ❌ MCP not found: ${name}`);
        console.error(`[Photon] Searched in: ${workingDir}`);
        console.error(`[Photon] Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      // Config mode: output Claude Desktop config
      if (options.config) {
        const mcpName = path.basename(filePath, path.extname(filePath)).replace('.photon', '');

        // Extract constructor parameters from source
        const constructorParams = await extractConstructorParams(filePath);

        // Build env vars object with defaults
        const env: Record<string, string> = {};
        const envFlags: string[] = [];

        for (const param of constructorParams) {
          const envVarName = toEnvVarName(mcpName, param.name);
          const defaultDisplay = param.defaultValue !== undefined
            ? formatDefaultValue(param.defaultValue)
            : `<your-${param.name}>`;

          env[envVarName] = defaultDisplay;
          envFlags.push(`--env ${envVarName}="${defaultDisplay}"`);
        }

        // Claude Desktop JSON config
        const config = {
          [mcpName]: {
            command: 'npx',
            args: ['@portel/photon', mcpName],
            ...(Object.keys(env).length > 0 && { env }),
          },
        };

        console.log('# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('# Claude Desktop Configuration');
        console.log('# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('#');
        console.log('# Add this to: ~/Library/Application Support/Claude/claude_desktop_config.json');
        console.log('# (macOS) or %APPDATA%\\Claude\\claude_desktop_config.json (Windows)');
        console.log('#');
        console.log(JSON.stringify({ mcpServers: config }, null, 2));
        console.log('');

        // Claude Code CLI
        if (envFlags.length > 0) {
          console.log('# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('# Claude Code');
          console.log('# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('#');
          console.log(`claude-code mcp add ${mcpName} npx @portel/photon ${mcpName} \\`);
          envFlags.forEach((flag, i) => {
            console.log(`  ${flag}${i < envFlags.length - 1 ? ' \\' : ''}`);
          });
          console.log('');
        }

        // Cursor (if needed)
        console.log('# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('# Cursor / Windsurf');
        console.log('# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('#');
        console.log(`# Use the MCP config UI or add to settings manually`);
        console.log('');

        return;
      }

      // Normal mode: start server
      const server = new PhotonServer({
        filePath,
        devMode: options.dev,
      });

      // Handle shutdown signals
      const shutdown = async () => {
        console.error('\n[Photon] Shutting down...');
        await server.stop();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // Start the server
      await server.start();

      // Start file watcher in dev mode
      if (options.dev) {
        const watcher = new FileWatcher(server, filePath);
        watcher.start();

        // Clean up watcher on shutdown
        process.on('SIGINT', async () => {
          await watcher.stop();
        });
        process.on('SIGTERM', async () => {
          await watcher.stop();
        });
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Init command: create a new .photon.ts from template
program
  .command('init')
  .argument('<name>', 'Name for the new Photon MCP')
  .description('Create a new .photon.ts from template')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      // Ensure working directory exists
      await ensureWorkingDir(workingDir);

      const fileName = `${name}.photon.ts`;
      const filePath = path.join(workingDir, fileName);

      // Check if file already exists
      try {
        await fs.access(filePath);
        console.error(`[Photon] ❌ File already exists: ${filePath}`);
        process.exit(1);
      } catch {
        // File doesn't exist, good
      }

      // Read template
      const templatePath = path.join(__dirname, '..', 'templates', 'photon.template.ts');
      let template: string;

      try {
        template = await fs.readFile(templatePath, 'utf-8');
      } catch {
        // Fallback inline template if file not found
        template = getInlineTemplate();
      }

      // Replace placeholders
      // Convert kebab-case to PascalCase for class name
      const className = name
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
      const content = template
        .replace(/TemplateName/g, className)
        .replace(/template-name/g, name);

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');

      console.error(`[Photon] ✅ Created ${fileName} in ${workingDir}`);
      console.error(`[Photon] Run with: photon ${name} --dev`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Validate command: check syntax and schemas
program
  .command('validate')
  .argument('<name>', 'MCP name (without .photon.ts extension)')
  .description('Validate syntax and schemas without running')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`[Photon] ❌ MCP not found: ${name}`);
        console.error(`[Photon] Searched in: ${workingDir}`);
        console.error(`[Photon] Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      console.error(`[Photon] Validating ${path.basename(filePath)}...`);

      // Import loader and try to load
      const { PhotonLoader } = await import('./loader.js');
      const loader = new PhotonLoader();

      const mcp = await loader.loadFile(filePath);

      console.error(`[Photon] ✅ Valid Photon MCP`);
      console.error(`[Photon] Name: ${mcp.name}`);
      console.error(`[Photon] Tools: ${mcp.tools.length}`);

      for (const tool of mcp.tools) {
        console.error(`  - ${tool.name}: ${tool.description}`);
      }

      process.exit(0);
    } catch (error: any) {
      console.error(`[Photon] ❌ Validation failed: ${error.message}`);
      process.exit(1);
    }
  });

// List command: show all MCPs in working directory
program
  .command('list')
  .description('List all Photon MCPs in working directory')
  .action(async (options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      const mcps = await listPhotonMCPs(workingDir);

      if (mcps.length === 0) {
        console.error(`[Photon] No MCPs found in ${workingDir}`);
        console.error(`[Photon] Create one with: photon init <name>`);
        return;
      }

      console.error(`[Photon] MCPs in ${workingDir} (${mcps.length}):`);
      console.error('');
      for (const mcp of mcps) {
        console.error(`  📦 ${mcp}`);
      }
      console.error('');
      console.error(`[Photon] Run any MCP with: photon <name> --dev`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Registry command: manage MCP registries
program
  .command('registry')
  .description('Manage MCP registries')
  .action(() => {
    // Show help if no subcommand
    program.outputHelp();
  });

program
  .command('registry:list')
  .description('List all configured registries')
  .action(async () => {
    try {
      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      const registries = manager.getAll();

      if (registries.length === 0) {
        console.error('[Photon] No registries configured');
        return;
      }

      console.error(`[Photon] Configured registries (${registries.length}):`);
      console.error('');

      for (const registry of registries) {
        const status = registry.enabled ? '✅' : '❌';
        console.error(`  ${status} ${registry.name}`);
        console.error(`     ${registry.url}`);
      }

      console.error('');
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('registry:add')
  .argument('<name>', 'Registry name')
  .argument('<url>', 'Registry base URL')
  .description('Add a new MCP registry')
  .action(async (name: string, url: string) => {
    try {
      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      const added = await manager.add(name, url);

      if (added) {
        console.error(`[Photon] ✅ Added registry: ${name}`);
        console.error(`[Photon] URL: ${url}`);
      } else {
        console.error(`[Photon] ❌ Registry '${name}' already exists`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('registry:remove')
  .argument('<name>', 'Registry name')
  .description('Remove a registry')
  .action(async (name: string) => {
    try {
      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      const removed = await manager.remove(name);

      if (removed) {
        console.error(`[Photon] ✅ Removed registry: ${name}`);
      } else {
        console.error(`[Photon] ❌ Registry '${name}' not found`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('registry:enable')
  .argument('<name>', 'Registry name')
  .description('Enable a registry')
  .action(async (name: string) => {
    try {
      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      const success = await manager.setEnabled(name, true);

      if (success) {
        console.error(`[Photon] ✅ Enabled registry: ${name}`);
      } else {
        console.error(`[Photon] ❌ Registry '${name}' not found`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('registry:disable')
  .argument('<name>', 'Registry name')
  .description('Disable a registry')
  .action(async (name: string) => {
    try {
      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      const success = await manager.setEnabled(name, false);

      if (success) {
        console.error(`[Photon] ✅ Disabled registry: ${name}`);
      } else {
        console.error(`[Photon] ❌ Registry '${name}' not found`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('registry:search')
  .argument('<query>', 'MCP name to search for')
  .description('Search for MCP in all enabled registries')
  .action(async (query: string) => {
    try {
      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      console.error(`[Photon] Searching for '${query}' in registries...`);

      const results = await manager.search(query);

      if (results.size === 0) {
        console.error(`[Photon] ❌ No results found for '${query}'`);
        return;
      }

      console.error('');
      for (const [mcpName, registries] of results) {
        console.error(`  📦 ${mcpName}`);
        for (const registry of registries) {
          console.error(`     ✓ ${registry.name} (${registry.url})`);
        }
      }
      console.error('');
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Install command: install MCP from registry
program
  .command('install')
  .argument('<name>', 'MCP name to install')
  .option('--registry <name>', 'Specific registry to use')
  .description('Install an MCP from a registry')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
      await ensureWorkingDir(workingDir);

      const { RegistryManager } = await import('./registry-manager.js');
      const manager = new RegistryManager();
      await manager.initialize();

      console.error(`[Photon] Installing ${name}...`);

      const result = await manager.fetchMCP(name);

      if (!result) {
        console.error(`[Photon] ❌ MCP '${name}' not found in any enabled registry`);
        console.error(`[Photon] Tip: Use 'photon registry:search ${name}' to find it`);
        process.exit(1);
      }

      const filePath = path.join(workingDir, `${name}.photon.ts`);

      // Check if already exists
      if (existsSync(filePath)) {
        console.error(`[Photon] ⚠️  MCP '${name}' already exists`);
        console.error(`[Photon] Use 'photon upgrade ${name}' to update it`);
        process.exit(1);
      }

      await fs.writeFile(filePath, result.content, 'utf-8');

      console.error(`[Photon] ✅ Installed ${name} from ${result.registry.name}`);
      console.error(`[Photon] Location: ${filePath}`);
      console.error(`[Photon] Run with: photon ${name} --dev`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Upgrade command: update MCPs from registry
program
  .command('upgrade')
  .argument('[name]', 'MCP name to upgrade (upgrades all if omitted)')
  .option('--check', 'Check for updates without upgrading')
  .description('Upgrade MCP(s) from the Photons registry')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;

      const { VersionChecker } = await import('./version-checker.js');
      const checker = new VersionChecker();
      await checker.initialize();

      if (name) {
        // Upgrade single MCP
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          console.error(`[Photon] ❌ MCP not found: ${name}`);
          console.error(`[Photon] Searched in: ${workingDir}`);
          process.exit(1);
        }

        console.error(`[Photon] Checking ${name} for updates...`);
        const versionInfo = await checker.checkForUpdate(name, filePath);

        if (!versionInfo.local) {
          console.error(`[Photon] ⚠️  Could not determine local version`);
          return;
        }

        if (!versionInfo.remote) {
          console.error(`[Photon] ⚠️  Not found in registry. This might be a local-only MCP.`);
          return;
        }

        if (options.check) {
          if (versionInfo.needsUpdate) {
            console.error(`[Photon] 🔄 Update available: ${versionInfo.local} → ${versionInfo.remote}`);
          } else {
            console.error(`[Photon] ✅ Already up to date (${versionInfo.local})`);
          }
          return;
        }

        if (!versionInfo.needsUpdate) {
          console.error(`[Photon] ✅ Already up to date (${versionInfo.local})`);
          return;
        }

        console.error(`[Photon] 🔄 Upgrading ${name}: ${versionInfo.local} → ${versionInfo.remote}`);

        const success = await checker.updateMCP(name, filePath);

        if (success) {
          console.error(`[Photon] ✅ Successfully upgraded ${name} to ${versionInfo.remote}`);
        } else {
          console.error(`[Photon] ❌ Failed to upgrade ${name}`);
          process.exit(1);
        }
      } else {
        // Check/upgrade all MCPs
        console.error(`[Photon] Checking all MCPs in ${workingDir}...`);
        const updates = await checker.checkAllUpdates(workingDir);

        if (updates.size === 0) {
          console.error(`[Photon] No MCPs found`);
          return;
        }

        const needsUpdate: string[] = [];

        console.error('');
        for (const [mcpName, info] of updates) {
          const status = checker.formatVersionInfo(info);

          if (info.needsUpdate) {
            console.error(`  🔄 ${mcpName}: ${status}`);
            needsUpdate.push(mcpName);
          } else if (info.local && info.remote) {
            console.error(`  ✅ ${mcpName}: ${status}`);
          } else {
            console.error(`  📦 ${mcpName}: ${status}`);
          }
        }
        console.error('');

        if (needsUpdate.length === 0) {
          console.error(`[Photon] All MCPs are up to date!`);
          return;
        }

        if (options.check) {
          console.error(`[Photon] ${needsUpdate.length} MCP(s) have updates available`);
          console.error(`[Photon] Run 'photon upgrade' to upgrade all`);
          return;
        }

        // Upgrade all that need updates
        console.error(`[Photon] Upgrading ${needsUpdate.length} MCP(s)...`);

        for (const mcpName of needsUpdate) {
          const filePath = path.join(workingDir, `${mcpName}.photon.ts`);
          const success = await checker.updateMCP(mcpName, filePath);

          if (success) {
            console.error(`[Photon] ✅ Upgraded ${mcpName}`);
          } else {
            console.error(`[Photon] ❌ Failed to upgrade ${mcpName}`);
          }
        }
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

program.parse();

/**
 * Inline template fallback
 */
function getInlineTemplate(): string {
  return `/**
 * TemplateName Photon MCP
 *
 * Single-file MCP server using Photon
 */

export default class TemplateName {
  /**
   * Example tool
   * @param message Message to echo
   */
  async echo(params: { message: string }) {
    return \`Echo: \${params.message}\`;
  }

  /**
   * Add two numbers
   * @param a First number
   * @param b Second number
   */
  async add(params: { a: number; b: number }) {
    return params.a + params.b;
  }
}
`;
}
