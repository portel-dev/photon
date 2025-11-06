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
        console.error('[Photon] 🔄 Refreshed marketplace data...\n');
      }

      console.error(`[Photon] Searching for '${query}' in marketplaces...`);

      const results = await manager.search(query);

      if (results.size === 0) {
        console.error(`[Photon] ❌ No results found for '${query}'`);
        console.error(`[Photon] Tip: Run 'photon marketplace update' to manually refresh marketplace data`);
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
        console.error('[Photon] No marketplaces configured');
        return;
      }

      // Get MCP counts
      const counts = await manager.getMarketplaceCounts();

      console.error(`[Photon] Configured marketplaces (${marketplaces.length}):`);
      console.error('');

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

      const result = await manager.add(repo);

      console.error(`[Photon] ✅ Added marketplace: ${result.name}`);
      console.error(`[Photon] GitHub: ${repo}`);
      console.error(`[Photon] URL: ${result.url}`);

      // Auto-fetch marketplace.json
      console.error(`[Photon] Fetching marketplace metadata...`);
      const success = await manager.updateMarketplaceCache(result.name);
      if (success) {
        console.error(`[Photon] ✅ Marketplace ready to use`);
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
        console.error(`[Photon] ✅ Removed marketplace: ${name}`);
      } else {
        console.error(`[Photon] ❌ Marketplace '${name}' not found`);
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
        console.error(`[Photon] ✅ Enabled marketplace: ${name}`);
      } else {
        console.error(`[Photon] ❌ Marketplace '${name}' not found`);
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
        console.error(`[Photon] ✅ Disabled marketplace: ${name}`);
      } else {
        console.error(`[Photon] ❌ Marketplace '${name}' not found`);
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
        console.error(`[Photon] Updating ${name}...`);
        const success = await manager.updateMarketplaceCache(name);

        if (success) {
          console.error(`[Photon] ✅ Updated ${name}`);
        } else {
          console.error(`[Photon] ❌ Failed to update ${name} (not found or no manifest)`);
          process.exit(1);
        }
      } else {
        // Update all enabled marketplaces
        console.error(`[Photon] Updating all marketplaces...`);
        const results = await manager.updateAllCaches();

        console.error('');
        for (const [marketplaceName, success] of results) {
          if (success) {
            console.error(`  ✅ ${marketplaceName}`);
          } else {
            console.error(`  ⚠️  ${marketplaceName} (no manifest)`);
          }
        }
        console.error('');

        const successCount = Array.from(results.values()).filter(Boolean).length;
        console.error(`[Photon] Updated ${successCount}/${results.size} marketplaces`);
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

      console.error(`[Photon] Adding ${name}...`);

      const result = await manager.fetchMCP(name);

      if (!result) {
        console.error(`[Photon] ❌ MCP '${name}' not found in any enabled marketplace`);
        console.error(`[Photon] Tip: Use 'photon marketplace:search ${name}' to find it`);
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

      console.error(`[Photon] ✅ Added ${name} from ${result.marketplace.name}`);
      console.error(`[Photon] Location: ${filePath}`);
      console.error(`[Photon] Run with: photon ${name} --dev`);
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

        console.error(`[Photon] Checking ${name} for updates...`);
        const versionInfo = await checker.checkForUpdate(name, filePath);

        if (!versionInfo.local) {
          console.error(`[Photon] ⚠️  Could not determine local version`);
          return;
        }

        if (!versionInfo.remote) {
          console.error(`[Photon] ⚠️  Not found in any marketplace. This might be a local-only MCP.`);
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
