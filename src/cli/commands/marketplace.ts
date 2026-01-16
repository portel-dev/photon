/**
 * Marketplace CLI Commands
 *
 * Manage MCP marketplaces (list, add, remove, enable, disable)
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { Logger } from '../../shared/logger.js';

const logger = new Logger({ component: 'marketplace' });

/**
 * Register marketplace subcommands
 */
export function registerMarketplaceCommands(program: Command): void {
  const marketplace = program.command('marketplace').description('Manage photon marketplaces');

  marketplace
    .command('list')
    .description('List all configured marketplaces')
    .action(async () => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const { formatOutput, printInfo, STATUS } = await import('../../cli-formatter.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        const marketplaces = manager.getAll();

        if (marketplaces.length === 0) {
          printInfo('No marketplaces configured');
          printInfo('Add one with: photon marketplace add portel-dev/photons');
          return;
        }

        // Get MCP counts
        const counts = await manager.getMarketplaceCounts();

        // Build table data
        const tableData = marketplaces.map((m) => ({
          name: m.name,
          source: m.source || m.repo || '-',
          photons: counts.get(m.name) || 0,
          status: m.enabled ? STATUS.OK : STATUS.OFF,
        }));

        printInfo(`Configured marketplaces (${marketplaces.length}):\n`);
        formatOutput(tableData, 'table');
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });

  marketplace
    .command('add')
    .argument('<repo>', 'GitHub repository (username/repo or github.com URL)')
    .description('Add a new MCP marketplace from GitHub')
    .action(async (repo: string) => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
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
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  marketplace
    .command('remove')
    .argument('<name>', 'Marketplace name')
    .description('Remove a marketplace')
    .action(async (name: string) => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        const removed = await manager.remove(name);

        if (removed) {
          console.error(`✅ Removed marketplace: ${name}`);
        } else {
          logger.error(`Marketplace '${name}' not found`);
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  marketplace
    .command('enable')
    .argument('<name>', 'Marketplace name')
    .description('Enable a marketplace')
    .action(async (name: string) => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        const success = await manager.setEnabled(name, true);

        if (success) {
          console.error(`✅ Enabled marketplace: ${name}`);
        } else {
          logger.error(`Marketplace '${name}' not found`);
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  marketplace
    .command('disable')
    .argument('<name>', 'Marketplace name')
    .description('Disable a marketplace')
    .action(async (name: string) => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        const success = await manager.setEnabled(name, false);

        if (success) {
          console.error(`✅ Disabled marketplace: ${name}`);
        } else {
          logger.error(`Marketplace '${name}' not found`);
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  marketplace
    .command('update')
    .argument('[name]', 'Marketplace name (optional, updates all if omitted)')
    .description('Update marketplace cache (fetch latest photon list)')
    .action(async (name?: string) => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        if (name) {
          // Update specific marketplace
          const marketplace = manager.get(name);
          if (!marketplace) {
            logger.error(`Marketplace '${name}' not found`);
            process.exit(1);
          }

          console.error(`Updating ${name}...`);
          const success = await manager.updateMarketplaceCache(name);
          if (success) {
            console.error(`✅ Updated marketplace: ${name}`);
          } else {
            console.error(`⚠️  Failed to update marketplace: ${name}`);
          }
        } else {
          // Update all enabled marketplaces
          console.error(`Updating all enabled marketplaces...`);
          const results = await manager.updateAllCaches();

          let successCount = 0;
          let failCount = 0;

          for (const [marketplaceName, success] of results) {
            if (success) {
              console.error(`  ✅ ${marketplaceName}`);
              successCount++;
            } else {
              console.error(`  ⚠️  ${marketplaceName} (failed)`);
              failCount++;
            }
          }

          console.error(
            `\nUpdated ${successCount} marketplace(s)${failCount > 0 ? `, ${failCount} failed` : ''}`
          );
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}
