/**
 * Search CLI Command
 *
 * Search for photons across all enabled marketplaces
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { PHOTON_VERSION } from '../../version.js';

/**
 * Register the `search` command
 */
export function registerSearchCommand(program: Command): void {
  program
    .command('search', { hidden: true })
    .argument('<query>', 'MCP name or keyword to search for')
    .description('Search for MCP in all enabled marketplaces')
    .action(async (query: string) => {
      try {
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const { formatOutput, printInfo, printError } = await import('../../cli-formatter.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        // Auto-update stale caches
        const updated = await manager.autoUpdateStaleCaches();
        if (updated) {
          printInfo('Refreshed marketplace data...\n');
        }

        printInfo(`Searching for '${query}' in marketplaces...`);

        const results = await manager.search(query);

        if (results.size === 0) {
          printError(`No results found for '${query}'`);
          printInfo(`Tip: Run 'photon marketplace update' to manually refresh marketplace data`);
          return;
        }

        // Build table data from search results
        const tableData: any[] = [];
        for (const [mcpName, entries] of results) {
          for (const entry of entries) {
            tableData.push({
              name: mcpName,
              version: entry.metadata?.version || PHOTON_VERSION,
              description: entry.metadata?.description
                ? entry.metadata.description.substring(0, 50) +
                  (entry.metadata.description.length > 50 ? '...' : '')
                : '-',
              marketplace: entry.marketplace.name,
            });
          }
        }

        console.log('');
        formatOutput(tableData, 'table');
        printInfo(`\nInstall with: photon add <name>`);
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}
