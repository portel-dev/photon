/**
 * Package CLI Commands
 *
 * Commands for managing photon packages: add, remove, upgrade, clear-cache
 */

import type { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as os from 'os';
import {
  SchemaExtractor,
  loadPhotonMCPConfig,
  setMCPServerConfig,
  resolveMCPSource,
  type MCPServerConfig,
} from '@portel/photon-core';
import { resolvePhotonPath, ensureWorkingDir } from '../../path-resolver.js';
import { getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { createReadline, promptConfirm, promptChoice } from '../../shared/cli-utils.js';

// ══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Prompt for yes/no with default
 */
async function promptYesNo(message: string, defaultYes: boolean = true): Promise<boolean> {
  return promptConfirm(message, defaultYes);
}

/**
 * Prompt for environment variables for an MCP
 */
async function promptEnvVars(
  mcpName: string,
  serverConfig: MCPServerConfig
): Promise<Record<string, string>> {
  const envVars: Record<string, string> = {};

  // Common env var patterns based on MCP name
  const commonPatterns: Record<string, string[]> = {
    slack: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    github: ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN'],
    filesystem: [], // No tokens needed
    postgres: ['POSTGRES_CONNECTION_STRING', 'DATABASE_URL'],
    sqlite: [], // No tokens needed
    brave: ['BRAVE_API_KEY'],
    fetch: [], // No tokens needed
    memory: [], // No tokens needed
    puppeteer: [], // No tokens needed
    google: ['GOOGLE_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    anthropic: ['ANTHROPIC_API_KEY'],
  };

  // Find matching pattern
  const lowerName = mcpName.toLowerCase();
  let suggestedVars: string[] = [];

  for (const [pattern, vars] of Object.entries(commonPatterns)) {
    if (lowerName.includes(pattern)) {
      suggestedVars = vars;
      break;
    }
  }

  if (suggestedVars.length === 0) {
    // No known env vars needed
    return envVars;
  }

  console.error(`\n   Environment variables for ${mcpName}:`);

  const rl = createReadline();

  for (const varName of suggestedVars) {
    const existingValue = process.env[varName];
    const hint = existingValue ? ` (found in env)` : '';

    const value = await new Promise<string>((resolve) => {
      rl.question(`   ${varName}${hint}: `, (answer) => {
        resolve(answer.trim());
      });
    });

    if (value) {
      // Store as reference if it looks like an env var reference
      if (value.startsWith('$')) {
        envVars[varName] = value.replace('$', '${') + '}';
      } else {
        envVars[varName] = value;
      }
    } else if (existingValue) {
      // Use env var reference
      envVars[varName] = `\${${varName}}`;
    }
  }

  rl.close();
  return envVars;
}

/**
 * Setup MCP dependencies for a photon
 */
async function setupMCPDependencies(
  source: string,
  photonName: string,
  options: { skipPrompts?: boolean } = {}
): Promise<{ configured: string[]; skipped: string[] }> {
  const extractor = new SchemaExtractor();
  const mcpDeps = extractor.extractMCPDependencies(source);

  if (mcpDeps.length === 0) {
    return { configured: [], skipped: [] };
  }

  // Load existing config
  const config = await loadPhotonMCPConfig();
  const configured: string[] = [];
  const skipped: string[] = [];

  // Check which MCPs need configuration
  const unconfigured = mcpDeps.filter(dep => !config.mcpServers[dep.name]);

  if (unconfigured.length === 0) {
    console.error(`\n✓ All ${mcpDeps.length} MCP dependencies already configured`);
    return { configured: mcpDeps.map(d => d.name), skipped: [] };
  }

  console.error(`\n📦 Found ${mcpDeps.length} MCP dependencies:`);
  for (const dep of mcpDeps) {
    const status = config.mcpServers[dep.name] ? '✓' : '○';
    console.error(`   ${status} ${dep.name} (${dep.source})`);
  }

  if (options.skipPrompts) {
    // Auto-configure all without prompting
    for (const dep of unconfigured) {
      const serverConfig = resolveMCPSource(dep.name, dep.source, dep.sourceType);
      await setMCPServerConfig(dep.name, serverConfig);
      configured.push(dep.name);
    }
    console.error(`\n✓ Auto-configured ${configured.length} MCP(s) in ~/.photon/mcp-servers.json`);
    return { configured, skipped };
  }

  // Interactive setup for each unconfigured MCP
  console.error(`\n${unconfigured.length} MCP(s) need configuration:\n`);

  for (const dep of unconfigured) {
    const shouldConfigure = await promptYesNo(
      `Configure ${dep.name}? (${dep.source})`,
      true
    );

    if (!shouldConfigure) {
      skipped.push(dep.name);
      console.error(`   Skipped ${dep.name}`);
      continue;
    }

    // Generate default config from @mcp source
    const serverConfig = resolveMCPSource(dep.name, dep.source, dep.sourceType);

    // Ask for environment variables
    const envVars = await promptEnvVars(dep.name, serverConfig);
    if (Object.keys(envVars).length > 0) {
      serverConfig.env = { ...serverConfig.env, ...envVars };
    }

    // Save to config
    await setMCPServerConfig(dep.name, serverConfig);
    configured.push(dep.name);
    console.error(`   ✓ Configured ${dep.name}`);
  }

  if (configured.length > 0) {
    console.error(`\n✓ Saved ${configured.length} MCP(s) to ~/.photon/mcp-servers.json`);
  }

  if (skipped.length > 0) {
    console.error(`\n⚠️  Skipped MCPs can be configured later with:`);
    console.error(`   photon config mcp <name>`);
  }

  return { configured, skipped };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register package management commands
 */
export function registerPackageCommands(program: Command, defaultWorkingDir: string): void {
  // Add command: add an MCP from a marketplace
  program
    .command('add', { hidden: true })
    .argument('<name>', 'MCP name to add')
    .option('--marketplace <name>', 'Specific marketplace to use')
    .option('-y, --yes', 'Automatically select first suggestion without prompting')
    .option('--skip-mcp-setup', 'Skip MCP dependency configuration')
    .description('Add an MCP from a marketplace')
    .action(async (name: string, options: any, command: Command) => {
      try {
        // Get working directory from global options
        const workingDir = command.parent?.opts().dir || defaultWorkingDir;
        await ensureWorkingDir(workingDir);

        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        // Check for conflicts
        let conflict = await manager.checkConflict(name, options.marketplace);

        if (!conflict.sources || conflict.sources.length === 0) {
          logger.error(`MCP '${name}' not found in any enabled marketplace\n`);

          // Search for similar names
          const searchResults = await manager.search(name);

          if (searchResults.size > 0) {
            console.error(`Did you mean one of these?\n`);

            // Convert search results to array for selection
            const suggestions: Array<{ name: string; version: string; description: string }> = [];
            let count = 0;
            for (const [mcpName, sources] of searchResults) {
              if (count >= 5) break; // Limit to 5 suggestions
              const source = sources[0]; // Use first marketplace
              const version = source.metadata?.version || 'unknown';
              const description = source.metadata?.description || 'No description';
              suggestions.push({ name: mcpName, version, description });
              console.error(`  [${count + 1}] ${mcpName} (v${version})`);
              console.error(`      ${description}`);
              count++;
            }

            // Interactive selection or auto-select with -y
            let selectedIndex: number | null;

            if (options.yes) {
              // Auto-select first suggestion
              selectedIndex = 0;
            } else {
              // Interactive selection
              const choice = await promptChoice(
                `\nWhich one? [1-${suggestions.length}] (or press Enter to cancel): `,
                suggestions.length,
                true
              );

              if (choice === null) {
                console.error('\nCancelled.');
                process.exit(0);
              }
              selectedIndex = choice - 1;
            }

            // Update name to the selected MCP
            name = suggestions[selectedIndex].name;
            console.error(`\n✓ Selected: ${name}`);

            // Re-check for conflicts with the new name
            conflict = await manager.checkConflict(name, options.marketplace);
            if (!conflict.sources || conflict.sources.length === 0) {
              logger.error(`MCP '${name}' is no longer available`);
              process.exit(1);
            }
          } else {
            console.error(`Run 'photon info' to see all available MCPs`);
            process.exit(1);
          }
        }

        // Check if already exists locally
        const filePath = path.join(workingDir, `${name}.photon.ts`);
        const fileName = `${name}.photon.ts`;

        if (existsSync(filePath)) {
          console.error(`⚠️  MCP '${name}' already exists`);
          console.error(`Use 'photon upgrade ${name}' to update it`);
          process.exit(1);
        }

        // Handle conflicts
        let selectedMarketplace: typeof conflict.sources[0]['marketplace'];
        let selectedMetadata: typeof conflict.sources[0]['metadata'];

        if (conflict.hasConflict) {
          console.error(`⚠️  MCP '${name}' found in multiple marketplaces:\n`);

          conflict.sources.forEach((source, index) => {
            const marker = source.marketplace.name === conflict.recommendation ? '→' : ' ';
            const version = source.metadata?.version || 'unknown';
            console.error(`  ${marker} [${index + 1}] ${source.marketplace.name} (v${version})`);
            console.error(`      ${source.marketplace.repo || source.marketplace.url}`);
          });

          if (conflict.recommendation) {
            console.error(`\n💡 Recommended: ${conflict.recommendation} (newest version)`);
          }

          // Get default choice (recommended or first)
          const recommendedIndex = conflict.sources.findIndex(s => s.marketplace.name === conflict.recommendation);
          const defaultChoice = recommendedIndex !== -1 ? recommendedIndex + 1 : 1;

          // Interactive selection
          const choice = await promptChoice(
            `\nWhich marketplace? [1-${conflict.sources.length}] (default: ${defaultChoice}): `,
            conflict.sources.length,
            { defaultChoice }
          );
          const selectedIndex = (choice ?? defaultChoice) - 1;

          const selectedSource = conflict.sources[selectedIndex];
          selectedMarketplace = selectedSource.marketplace;
          selectedMetadata = selectedSource.metadata;

          console.error(`\n✓ Using: ${selectedMarketplace.name}`);
        } else {
          selectedMarketplace = conflict.sources[0].marketplace;
          selectedMetadata = conflict.sources[0].metadata;
          console.error(`Adding ${name} from ${selectedMarketplace.name}...`);
        }

        // Fetch content from selected marketplace
        const result = await manager.fetchMCP(name);
        if (!result) {
          logger.error(`Failed to fetch MCP content`);
          process.exit(1);
        }
        const content = result.content;

        // Write file
        await fs.writeFile(filePath, content, 'utf-8');

        // Save installation metadata if we have it
        if (selectedMetadata) {
          const { calculateHash } = await import('../../marketplace-manager.js');
          const contentHash = calculateHash(content);
          await manager.savePhotonMetadata(fileName, selectedMarketplace, selectedMetadata, contentHash);
        }

        console.error(`✅ Added ${name} from ${selectedMarketplace.name}`);
        if (selectedMetadata?.version) {
          console.error(`Version: ${selectedMetadata.version}`);
        }
        console.error(`Location: ${filePath}`);

        // Setup MCP dependencies if present
        if (!options.skipMcpSetup) {
          const { configured, skipped } = await setupMCPDependencies(content, name, {
            skipPrompts: options.yes,
          });

          if (skipped.length > 0) {
            console.error(`\n⚠️  Some MCPs were not configured. Run:`);
            console.error(`   photon mcp ${name}`);
            console.error(`   to see configuration requirements.`);
          }
        }

        console.error(`\nRun with: photon mcp ${name}`);
        console.error(`\nTo customize: Copy to a new name and run with --dev for hot reload`);
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  // Remove command: remove an installed photon
  program
    .command('remove', { hidden: true })
    .argument('<name>', 'MCP name to remove')
    .alias('rm')
    .option('--keep-cache', 'Keep compiled cache for this photon')
    .description('Remove an installed photon')
    .action(async (name: string, options: any, command: Command) => {
      try {
        const { printInfo, printSuccess, printError } = await import('../../cli-formatter.js');
        const workingDir = command.parent?.opts().dir || defaultWorkingDir;

        // Find the photon file
        const filePath = await resolvePhotonPath(name, workingDir);

        if (!filePath) {
          printError(`Photon not found: ${name}`);
          printInfo(`Searched in: ${workingDir}`);
          printInfo(`Tip: Use 'photon info' to see installed photons`);
          process.exit(1);
        }

        printInfo(`Removing ${name}...`);

        // Remove the .photon.ts file
        await fs.unlink(filePath);
        printSuccess(`Removed ${name}.photon.ts`);

        // Clear compiled cache unless --keep-cache
        if (!options.keepCache) {
          const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');
          const cachedFiles = [
            path.join(cacheDir, `${name}.js`),
            path.join(cacheDir, `${name}.js.map`),
          ];

          for (const cachedFile of cachedFiles) {
            try {
              await fs.unlink(cachedFile);
            } catch {
              // Ignore if cache doesn't exist
            }
          }
          printSuccess(`Cleared cache`);
        }

        console.log('');
        printSuccess(`Successfully removed ${name}`);
        printInfo(`To reinstall: photon add ${name}`);

      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });

  // Upgrade command: update MCPs from marketplace
  program
    .command('upgrade', { hidden: true })
    .argument('[name]', 'MCP name to upgrade (upgrades all if omitted)')
    .option('--check', 'Check for updates without upgrading')
    .alias('up')
    .description('Upgrade MCP(s) from marketplaces')
    .action(async (name: string | undefined, options: any, command: Command) => {
      try {
        const { formatOutput, printInfo, printSuccess, printWarning, printError, STATUS } = await import('../../cli-formatter.js');
        // Get working directory from global options
        const workingDir = command.parent?.opts().dir || defaultWorkingDir;

        const { VersionChecker } = await import('../../version-checker.js');
        const checker = new VersionChecker();
        await checker.initialize();

        if (name) {
          // Upgrade single MCP
          const filePath = await resolvePhotonPath(name, workingDir);

          if (!filePath) {
            printError(`MCP not found: ${name}`);
            printInfo(`Searched in: ${workingDir}`);
            process.exit(1);
          }

          printInfo(`Checking ${name} for updates...`);
          const versionInfo = await checker.checkForUpdate(name, filePath);

          if (!versionInfo.local) {
            printWarning('Could not determine local version');
            return;
          }

          if (!versionInfo.remote) {
            printWarning('Not found in any marketplace. This might be a local-only MCP.');
            return;
          }

          if (options.check) {
            const tableData = [{
              name,
              local: versionInfo.local,
              remote: versionInfo.remote,
              status: versionInfo.needsUpdate ? STATUS.UPDATE : STATUS.OK,
            }];
            formatOutput(tableData, 'table');
            return;
          }

          if (!versionInfo.needsUpdate) {
            printSuccess(`Already up to date (${versionInfo.local})`);
            return;
          }

          printInfo(`Upgrading ${name}: ${versionInfo.local} → ${versionInfo.remote}`);

          const success = await checker.updateMCP(name, filePath);

          if (success) {
            printSuccess(`Successfully upgraded ${name} to ${versionInfo.remote}`);
          } else {
            printError(`Failed to upgrade ${name}`);
            process.exit(1);
          }
        } else {
          // Check/upgrade all MCPs
          printInfo(`Checking all MCPs in ${workingDir}...\n`);
          const updates = await checker.checkAllUpdates(workingDir);

          if (updates.size === 0) {
            printInfo('No MCPs found');
            return;
          }

          const needsUpdate: string[] = [];

          // Build table data
          const tableData: Array<{ name: string; local: string; remote: string; status: string }> = [];

          for (const [mcpName, info] of updates) {
            if (info.needsUpdate) {
              needsUpdate.push(mcpName);
              tableData.push({
                name: mcpName,
                local: info.local || '-',
                remote: info.remote || '-',
                status: STATUS.UPDATE,
              });
            } else if (info.local && info.remote) {
              tableData.push({
                name: mcpName,
                local: info.local,
                remote: info.remote,
                status: STATUS.OK,
              });
            } else {
              tableData.push({
                name: mcpName,
                local: info.local || '-',
                remote: info.remote || 'local only',
                status: STATUS.UNKNOWN,
              });
            }
          }

          formatOutput(tableData, 'table');

          if (needsUpdate.length === 0) {
            console.log('');
            printSuccess('All MCPs are up to date!');
            return;
          }

          if (options.check) {
            console.log('');
            printInfo(`${needsUpdate.length} MCP(s) have updates available`);
            printInfo(`Run 'photon upgrade' to upgrade all`);
            return;
          }

          // Upgrade all that need updates
          console.log('');
          printInfo(`Upgrading ${needsUpdate.length} MCP(s)...`);

          for (const mcpName of needsUpdate) {
            const filePath = path.join(workingDir, `${mcpName}.photon.ts`);
            const success = await checker.updateMCP(mcpName, filePath);

            if (success) {
              printSuccess(`Upgraded ${mcpName}`);
            } else {
              printError(`Failed to upgrade ${mcpName}`);
            }
          }
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });

  // Clear-cache command: clear compiled photon cache
  program
    .command('clear-cache', { hidden: true })
    .argument('[name]', 'MCP name to clear cache for (clears all if omitted)')
    .alias('clean')
    .description('Clear compiled photon cache')
    .action(async (name: string | undefined, options: any, command: Command) => {
      try {
        const { printInfo, printSuccess, printError } = await import('../../cli-formatter.js');
        const cacheDir = path.join(os.homedir(), '.cache', 'photon-mcp', 'compiled');

        if (name) {
          // Clear cache for specific photon
          const workingDir = command.parent?.opts().dir || defaultWorkingDir;
          const filePath = await resolvePhotonPath(name, workingDir);

          if (!filePath) {
            printError(`Photon not found: ${name}`);
            printInfo(`Tip: Use 'photon info' to see installed photons`);
            process.exit(1);
          }

          printInfo(`Clearing cache for ${name}...`);

          const cachedFiles = [
            path.join(cacheDir, `${name}.js`),
            path.join(cacheDir, `${name}.js.map`),
          ];

          let cleared = false;
          for (const cachedFile of cachedFiles) {
            try {
              await fs.unlink(cachedFile);
              cleared = true;
            } catch {
              // Ignore if file doesn't exist
            }
          }

          if (cleared) {
            printSuccess(`Cleared cache for ${name}`);
          } else {
            printInfo(`No cache found for ${name}`);
          }
        } else {
          // Clear all cache
          printInfo('Clearing all compiled photon cache...');

          try {
            const files = await fs.readdir(cacheDir);
            let count = 0;

            for (const file of files) {
              const filePath = path.join(cacheDir, file);
              try {
                await fs.unlink(filePath);
                count++;
              } catch {
                // Ignore errors
              }
            }

            if (count > 0) {
              printSuccess(`Cleared ${count} cached file(s)`);
            } else {
              printInfo(`Cache is already empty`);
            }
          } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
              printInfo(`No cache directory found`);
            } else {
              throw error;
            }
          }
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}
