/**
 * Update CLI Command
 *
 * Actually upgrades @portel/photon to the latest version,
 * refreshes marketplace indexes, and shows what's new.
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { runTask } from '../../shared/task-runner.js';
import { PHOTON_VERSION } from '../../version.js';
import { globalInstallCmd, detectPM } from '../../shared-utils.js';

/**
 * Register the `update` command
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('Update Photon CLI to the latest version')
    .option('--dry-run', 'Show the planned version change without installing')
    .action(async (options: { dryRun?: boolean }) => {
      try {
        const { printInfo, printSuccess, printWarning, printHeader, printError } =
          await import('../../cli-formatter.js');
        const { execSync } = await import('child_process');

        // 1. Check latest version
        let latestVersion: string | null = null;
        try {
          latestVersion = await runTask('Checking for updates', async () => {
            return execSync('npm view @portel/photon version', {
              encoding: 'utf-8',
              timeout: 10000,
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
          });
        } catch {
          printError('Could not reach npm registry');
          process.exit(1);
        }

        if (!latestVersion) {
          printError('Could not determine latest version');
          process.exit(1);
        }

        if (latestVersion === PHOTON_VERSION) {
          printSuccess(`Already on the latest version (${PHOTON_VERSION})`);
          printInfo('Run `photon changelog` to see what shipped in this release');
          return;
        }

        // 2. Show what's coming
        printHeader(`Updating ${PHOTON_VERSION} → ${latestVersion}`);
        console.log('');

        // 3. Dry-run: stop here before any install side effects
        if (options.dryRun) {
          const pm = detectPM();
          const cmd = globalInstallCmd('@portel/photon');
          printInfo(`Dry run. Would install via ${pm}:`);
          printInfo(`  ${cmd}`);
          printInfo(`Run without --dry-run to apply.`);
          return;
        }

        // 4. Run the actual install
        const pm = detectPM();
        const cmd = globalInstallCmd('@portel/photon');

        await runTask(`Installing via ${pm}`, async () => {
          execSync(cmd, {
            encoding: 'utf-8',
            timeout: 120000,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        });

        console.log('');
        printSuccess(`Updated to ${latestVersion}`);
        printInfo("Run `photon changelog` to see what's new");

        // 5. Refresh marketplace indexes
        try {
          const { MarketplaceManager } = await import('../../marketplace-manager.js');
          const manager = new MarketplaceManager();
          await manager.initialize();
          await runTask('Refreshing marketplace indexes', async () => {
            await manager.updateAllCaches();
          });
        } catch {
          printWarning('Could not refresh marketplace indexes');
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}
