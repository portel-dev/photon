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

/**
 * Get OS-specific MCP client config path
 */
function getConfigPath(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/Claude/claude_desktop_config.json');
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json');
  } else {
    // Linux/other
    return path.join(os.homedir(), '.config/Claude/claude_desktop_config.json');
  }
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
  .description('Universal runtime for single-file TypeScript programs')
  .version(version)
  .option('--working-dir <dir>', 'Working directory for Photons (default: ~/.photon)', DEFAULT_WORKING_DIR);

// MCP Runtime: run a .photon.ts file as MCP server
program
  .command('mcp')
  .argument('<name>', 'MCP name (without .photon.ts extension)')
  .description('Run a Photon as MCP server')
  .option('--dev', 'Enable development mode with hot reload')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = program.opts().workingDir || DEFAULT_WORKING_DIR;

      // Resolve file path from name in working directory
      const filePath = await resolvePhotonPath(name, workingDir);

      if (!filePath) {
        console.error(`[Photon] ❌ MCP not found: ${name}`);
        console.error(`[Photon] Searched in: ${workingDir}`);
        console.error(`[Photon] Tip: Use 'photon list' to see available MCPs`);
        process.exit(1);
      }

      // Start MCP server
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

      console.error(`✅ Created ${fileName} in ${workingDir}`);
      console.error(`Run with: photon mcp ${name} --dev`);
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

      console.error(`Validating ${path.basename(filePath)}...\n`);

      // Import loader and try to load
      const { PhotonLoader } = await import('./loader.js');
      const loader = new PhotonLoader();

      const mcp = await loader.loadFile(filePath);

      console.error(`✅ Valid Photon MCP`);
      console.error(`Name: ${mcp.name}`);
      console.error(`Tools: ${mcp.tools.length}`);

      for (const tool of mcp.tools) {
        console.error(`  - ${tool.name}: ${tool.description}`);
      }

      process.exit(0);
    } catch (error: any) {
      console.error(`[Photon] ❌ Validation failed: ${error.message}`);
      process.exit(1);
    }
  });

// Get command: list all Photons or show details for one
program
  .command('get')
  .argument('[name]', 'Photon name to show details for (shows all if omitted)')
  .option('--mcp', 'Output as MCP server configuration')
  .description('List Photons or show details for one')
  .action(async (name: string | undefined, options: any, command: Command) => {
    try {
      // Get working directory from global/parent options
      const parentOpts = command.parent?.opts() || {};
      const workingDir = parentOpts.workingDir || DEFAULT_WORKING_DIR;
      const asMcp = options.mcp || false;

      const mcps = await listPhotonMCPs(workingDir);

      if (mcps.length === 0) {
        console.error(`No Photons found in ${workingDir}`);
        console.error(`Create one with: photon init <name>`);
        return;
      }

      // Show single Photon details
      if (name) {
        const filePath = await resolvePhotonPath(name, workingDir);
        if (!filePath) {
          console.error(`❌ Photon not found: ${name}`);
          console.error(`Searched in: ${workingDir}`);
          console.error(`Tip: Use 'photon get' to see available Photons`);
          process.exit(1);
        }

        if (asMcp) {
          // Show as MCP config for single Photon
          const constructorParams = await extractConstructorParams(filePath);
          const env: Record<string, string> = {};
          for (const param of constructorParams) {
            const envVarName = toEnvVarName(name, param.name);
            const defaultDisplay = param.defaultValue !== undefined
              ? formatDefaultValue(param.defaultValue)
              : `<your-${param.name}>`;
            env[envVarName] = defaultDisplay;
          }

          const config = {
            command: 'npx',
            args: ['@portel/photon', 'mcp', name],
            ...(Object.keys(env).length > 0 && { env }),
          };

          // Get OS-specific config path
          const configPath = getConfigPath();
          console.log(`# Photon MCP Server Configuration: ${name}`);
          console.log(`# Add to mcpServers in: ${configPath}\n`);
          console.log(JSON.stringify({ [name]: config }, null, 2));
        } else {
          // Show Photon details
          const { PhotonLoader } = await import('./loader.js');
          const loader = new PhotonLoader();
          const mcp = await loader.loadFile(filePath);

          console.error(`📦 ${name}\n`);
          console.error(`Location: ${filePath}`);
          console.error(`Tools: ${mcp.tools.length}`);
          console.error(`Templates: ${mcp.templates.length}`);
          console.error(`Resources: ${mcp.statics.length}\n`);

          if (mcp.tools.length > 0) {
            console.error('Tools:');
            for (const tool of mcp.tools) {
              console.error(`  • ${tool.name}: ${tool.description || 'No description'}`);
            }
            console.error('');
          }

          if (mcp.templates.length > 0) {
            console.error('Templates:');
            for (const template of mcp.templates) {
              console.error(`  • ${template.name}: ${template.description || 'No description'}`);
            }
            console.error('');
          }

          if (mcp.statics.length > 0) {
            console.error('Resources:');
            for (const resource of mcp.statics) {
              console.error(`  • ${resource.uri}: ${resource.name || 'No name'}`);
            }
            console.error('');
          }

          console.error(`Run with: photon mcp ${name} --dev`);
        }
        return;
      }

      // Show all Photons
      if (asMcp) {
        // MCP config mode for all Photons
        const allConfigs: Record<string, any> = {};

        for (const mcpName of mcps) {
          const filePath = await resolvePhotonPath(mcpName, workingDir);
          if (!filePath) continue;

          const constructorParams = await extractConstructorParams(filePath);
          const env: Record<string, string> = {};
          for (const param of constructorParams) {
            const envVarName = toEnvVarName(mcpName, param.name);
            const defaultDisplay = param.defaultValue !== undefined
              ? formatDefaultValue(param.defaultValue)
              : `<your-${param.name}>`;
            env[envVarName] = defaultDisplay;
          }

          allConfigs[mcpName] = {
            command: 'npx',
            args: ['@portel/photon', 'mcp', mcpName],
            ...(Object.keys(env).length > 0 && { env }),
          };
        }

        // Get OS-specific config path
        const configPath = getConfigPath();
        console.log(`# Photon MCP Server Configuration (${mcps.length} servers)`);
        console.log(`# Add to mcpServers in: ${configPath}\n`);
        console.log(JSON.stringify({ mcpServers: allConfigs }, null, 2));
        return;
      }

      // Normal list mode
      console.error(`Photons in ${workingDir} (${mcps.length}):\n`);
      for (const mcp of mcps) {
        console.error(`  📦 ${mcp}`);
      }
      console.error(`\nRun: photon mcp <name> --dev`);
      console.error(`Details: photon get <name>`);
      console.error(`MCP config: photon get --mcp`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Search command: search for MCPs across marketplaces
program
  .command('search')
  .argument('<query>', 'MCP name or keyword to search for')
  .description('Search for MCP in all enabled marketplaces')
  .action(async (query: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Auto-update stale caches
      const updated = await manager.autoUpdateStaleCaches();
      if (updated) {
        console.error('🔄 Refreshed marketplace data...\n');
      }

      console.error(`Searching for '${query}' in marketplaces...`);

      const results = await manager.search(query);

      if (results.size === 0) {
        console.error(`❌ No results found for '${query}'`);
        console.error(`Tip: Run 'photon marketplace update' to manually refresh marketplace data`);
        return;
      }

      console.error('');
      for (const [mcpName, entries] of results) {
        for (const entry of entries) {
          if (entry.metadata) {
            console.error(`  📦 ${mcpName} (v${entry.metadata.version})`);
            console.error(`     ${entry.metadata.description}`);
            console.error(`     ${entry.marketplace.name} (${entry.marketplace.repo})`);
            if (entry.metadata.tags && entry.metadata.tags.length > 0) {
              console.error(`     Tags: ${entry.metadata.tags.join(', ')}`);
            }
          } else {
            console.error(`  📦 ${mcpName}`);
            console.error(`     ✓ ${entry.marketplace.name} (${entry.marketplace.repo})`);
          }
        }
      }
      console.error('');
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Info command: show detailed MCP information
program
  .command('info')
  .argument('<name>', 'MCP name to show information for')
  .description('Show detailed MCP information from marketplaces')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      // Auto-update stale caches
      await manager.autoUpdateStaleCaches();

      const result = await manager.getPhotonMetadata(name);

      if (!result) {
        console.error(`[Photon] ❌ MCP '${name}' not found in any marketplace`);
        console.error(`[Photon] Tip: Use 'photon search ${name}' to find similar MCPs`);
        process.exit(1);
      }

      const { metadata, marketplace } = result;

      console.error('');
      console.error(`  📦 ${metadata.name} (v${metadata.version})`);
      console.error(`     ${metadata.description}`);
      console.error('');
      console.error(`  Marketplace: ${marketplace.name} (${marketplace.repo})`);
      if (metadata.author) {
        console.error(`  Author: ${metadata.author}`);
      }
      if (metadata.license) {
        console.error(`  License: ${metadata.license}`);
      }
      if (metadata.homepage) {
        console.error(`  Homepage: ${metadata.homepage}`);
      }
      if (metadata.tags && metadata.tags.length > 0) {
        console.error(`  Tags: ${metadata.tags.join(', ')}`);
      }
      if (metadata.tools && metadata.tools.length > 0) {
        console.error(`  Tools: ${metadata.tools.join(', ')}`);
      }
      console.error('');
      console.error(`  To add: photon add ${metadata.name}`);
      console.error('');
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Marketplace command: manage MCP marketplaces
const marketplace = program
  .command('marketplace')
  .description('Manage MCP marketplaces');

marketplace
  .command('list')
  .description('List all configured marketplaces')
  .action(async () => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const marketplaces = manager.getAll();

      if (marketplaces.length === 0) {
        console.error('No marketplaces configured');
        return;
      }

      // Get MCP counts
      const counts = await manager.getMarketplaceCounts();

      console.error(`Configured marketplaces (${marketplaces.length}):\n`);

      for (const marketplace of marketplaces) {
        const status = marketplace.enabled ? '✅' : '❌';
        const count = counts.get(marketplace.name) || 0;
        const countStr = count > 0 ? `${count} available` : 'no manifest';

        console.error(`  ${status} ${marketplace.name}`);
        console.error(`     ${marketplace.repo}`);
        console.error(`     ${countStr}`);
        if (marketplace.lastUpdated) {
          const date = new Date(marketplace.lastUpdated);
          console.error(`     Updated ${date.toLocaleDateString()}`);
        }
      }

      console.error('');
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

marketplace
  .command('add')
  .argument('<repo>', 'GitHub repository (username/repo or github.com URL)')
  .description('Add a new MCP marketplace from GitHub')
  .action(async (repo: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const { marketplace: result, added } = await manager.add(repo);

      if (added) {
        console.error(`✅ Added marketplace: ${result.name}`);
        console.error(`Source: ${repo}`);
        console.error(`URL: ${result.url}`);

        // Auto-fetch marketplace.json
        console.error(`Fetching marketplace metadata...`);
        const success = await manager.updateMarketplaceCache(result.name);
        if (success) {
          console.error(`✅ Marketplace ready to use`);
        }
      } else {
        console.error(`ℹ️  Marketplace already exists: ${result.name}`);
        console.error(`Source: ${result.source}`);
        console.error(`Skipping duplicate addition`);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

marketplace
  .command('remove')
  .argument('<name>', 'Marketplace name')
  .description('Remove a marketplace')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const removed = await manager.remove(name);

      if (removed) {
        console.error(`✅ Removed marketplace: ${name}`);
      } else {
        console.error(`❌ Marketplace '${name}' not found`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

marketplace
  .command('enable')
  .argument('<name>', 'Marketplace name')
  .description('Enable a marketplace')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const success = await manager.setEnabled(name, true);

      if (success) {
        console.error(`✅ Enabled marketplace: ${name}`);
      } else {
        console.error(`❌ Marketplace '${name}' not found`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

marketplace
  .command('disable')
  .argument('<name>', 'Marketplace name')
  .description('Disable a marketplace')
  .action(async (name: string) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      const success = await manager.setEnabled(name, false);

      if (success) {
        console.error(`✅ Disabled marketplace: ${name}`);
      } else {
        console.error(`❌ Marketplace '${name}' not found`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

marketplace
  .command('update')
  .argument('[name]', 'Marketplace name to update (updates all if omitted)')
  .description('Update marketplace metadata from remote')
  .action(async (name: string | undefined) => {
    try {
      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      if (name) {
        // Update specific marketplace
        console.error(`Updating ${name}...`);
        const success = await manager.updateMarketplaceCache(name);

        if (success) {
          console.error(`✅ Updated ${name}`);
        } else {
          console.error(`❌ Failed to update ${name} (not found or no manifest)`);
          process.exit(1);
        }
      } else {
        // Update all enabled marketplaces
        console.error(`Updating all marketplaces...\n`);
        const results = await manager.updateAllCaches();

        for (const [marketplaceName, success] of results) {
          if (success) {
            console.error(`  ✅ ${marketplaceName}`);
          } else {
            console.error(`  ⚠️  ${marketplaceName} (no manifest)`);
          }
        }

        const successCount = Array.from(results.values()).filter(Boolean).length;
        console.error(`\nUpdated ${successCount}/${results.size} marketplaces`);
      }
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Add command: add MCP from marketplace
program
  .command('add')
  .argument('<name>', 'MCP name to add')
  .option('--marketplace <name>', 'Specific marketplace to use')
  .description('Add an MCP from a marketplace')
  .action(async (name: string, options: any, command: Command) => {
    try {
      // Get working directory from global options
      const workingDir = command.parent?.opts().workingDir || DEFAULT_WORKING_DIR;
      await ensureWorkingDir(workingDir);

      const { MarketplaceManager } = await import('./marketplace-manager.js');
      const manager = new MarketplaceManager();
      await manager.initialize();

      console.error(`Adding ${name}...`);

      const result = await manager.fetchMCP(name);

      if (!result) {
        console.error(`❌ MCP '${name}' not found in any enabled marketplace`);
        console.error(`Tip: Use 'photon search ${name}' to find it`);
        process.exit(1);
      }

      const filePath = path.join(workingDir, `${name}.photon.ts`);
      const fileName = `${name}.photon.ts`;

      // Check if already exists
      if (existsSync(filePath)) {
        console.error(`⚠️  MCP '${name}' already exists`);
        console.error(`Use 'photon upgrade ${name}' to update it`);
        process.exit(1);
      }

      // Write file
      await fs.writeFile(filePath, result.content, 'utf-8');

      // Save installation metadata if we have it
      if (result.metadata) {
        const { calculateHash } = await import('./marketplace-manager.js');
        const contentHash = calculateHash(result.content);
        await manager.savePhotonMetadata(fileName, result.marketplace, result.metadata, contentHash);
      }

      console.error(`✅ Added ${name} from ${result.marketplace.name}`);
      if (result.metadata?.version) {
        console.error(`Version: ${result.metadata.version}`);
      }
      console.error(`Location: ${filePath}`);
      console.error(`Run with: photon mcp ${name} --dev`);
    } catch (error: any) {
      console.error(`[Photon] ❌ Error: ${error.message}`);
      process.exit(1);
    }
  });

// Upgrade command: update MCPs from marketplace
program
  .command('upgrade')
  .argument('[name]', 'MCP name to upgrade (upgrades all if omitted)')
  .option('--check', 'Check for updates without upgrading')
  .description('Upgrade MCP(s) from marketplaces')
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

        console.error(`Checking ${name} for updates...`);
        const versionInfo = await checker.checkForUpdate(name, filePath);

        if (!versionInfo.local) {
          console.error(`⚠️  Could not determine local version`);
          return;
        }

        if (!versionInfo.remote) {
          console.error(`⚠️  Not found in any marketplace. This might be a local-only MCP.`);
          return;
        }

        if (options.check) {
          if (versionInfo.needsUpdate) {
            console.error(`🔄 Update available: ${versionInfo.local} → ${versionInfo.remote}`);
          } else {
            console.error(`✅ Already up to date (${versionInfo.local})`);
          }
          return;
        }

        if (!versionInfo.needsUpdate) {
          console.error(`✅ Already up to date (${versionInfo.local})`);
          return;
        }

        console.error(`🔄 Upgrading ${name}: ${versionInfo.local} → ${versionInfo.remote}`);

        const success = await checker.updateMCP(name, filePath);

        if (success) {
          console.error(`✅ Successfully upgraded ${name} to ${versionInfo.remote}`);
        } else {
          console.error(`❌ Failed to upgrade ${name}`);
          process.exit(1);
        }
      } else {
        // Check/upgrade all MCPs
        console.error(`Checking all MCPs in ${workingDir}...\n`);
        const updates = await checker.checkAllUpdates(workingDir);

        if (updates.size === 0) {
          console.error(`No MCPs found`);
          return;
        }

        const needsUpdate: string[] = [];

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

        if (needsUpdate.length === 0) {
          console.error(`\nAll MCPs are up to date!`);
          return;
        }

        if (options.check) {
          console.error(`\n${needsUpdate.length} MCP(s) have updates available`);
          console.error(`Run 'photon upgrade' to upgrade all`);
          return;
        }

        // Upgrade all that need updates
        console.error(`\nUpgrading ${needsUpdate.length} MCP(s)...`);

        for (const mcpName of needsUpdate) {
          const filePath = path.join(workingDir, `${mcpName}.photon.ts`);
          const success = await checker.updateMCP(mcpName, filePath);

          if (success) {
            console.error(`✅ Upgraded ${mcpName}`);
          } else {
            console.error(`❌ Failed to upgrade ${mcpName}`);
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
