/**
 * Update CLI Command
 *
 * Refresh marketplace indexes and check for CLI updates
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { runTask } from '../../shared/task-runner.js';
import { PHOTON_VERSION } from '../../version.js';

/**
 * Register the hidden `update` command
 */
export function registerUpdateCommand(program: Command, defaultDir: string): void {
  program
    .command('update', { hidden: true })
    .description('Update marketplace indexes and check for CLI updates')
    .action(async () => {
      try {
        const { printInfo, printSuccess, printWarning, printHeader } =
          await import('../../cli-formatter.js');
        const { MarketplaceManager } = await import('../../marketplace-manager.js');
        const manager = new MarketplaceManager();
        await manager.initialize();

        const results = await runTask('Refreshing marketplace indexes', async () => {
          return manager.updateAllCaches();
        });

        console.log('');
        const entries = Array.from(results.entries());
        let successCount = 0;
        for (const [marketplaceName, success] of entries) {
          if (success) {
            printSuccess(marketplaceName);
            successCount++;
          } else {
            printWarning(`${marketplaceName} (no manifest)`);
          }
        }
        printInfo(`\nUpdated ${successCount}/${entries.length} marketplaces`);

        let latestVersion: string | null = null;
        try {
          latestVersion = await runTask('Checking for Photon CLI updates', async () => {
            const { execSync } = await import('child_process');
            return execSync('npm view @portel/photon version', {
              encoding: 'utf-8',
              timeout: 10000,
            }).trim();
          });
        } catch {
          printWarning('\nCould not check for CLI updates');
        }

        if (latestVersion) {
          const version = PHOTON_VERSION;
          console.log('');
          if (latestVersion !== version) {
            printHeader('Update available');
            printWarning(`Current: ${version}`);
            printInfo(`Latest:  ${latestVersion}`);
            printInfo(`Update with: npm install -g @portel/photon`);
          } else {
            printSuccess(`Photon CLI is up to date (${version})`);
          }
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}
