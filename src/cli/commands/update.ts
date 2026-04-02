/**
 * Update CLI Command
 *
 * Refresh marketplace indexes, check for CLI updates, and show changelog.
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { runTask } from '../../shared/task-runner.js';
import { PHOTON_VERSION } from '../../version.js';
import { globalInstallCmd } from '../../shared-utils.js';

const CHANGELOG_URL = 'https://raw.githubusercontent.com/portel-dev/photon/main/CHANGELOG.md';

/**
 * Fetch and display changelog for a specific version (or latest).
 */
async function showChangelog(version?: string): Promise<void> {
  const { printHeader, printInfo, printWarning } = await import('../../cli-formatter.js');
  const https = await import('https');

  const content = await new Promise<string>((resolve, reject) => {
    https
      .get(CHANGELOG_URL, { timeout: 10000 }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (d: Buffer) => (body += d.toString()));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });

  const lines = content.split('\n');
  const targetVersion = version || undefined;
  let inVersion = false;
  let versionHeader = '';
  const entries: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inVersion) break; // Hit next version — done
      if (!targetVersion || line.includes(targetVersion)) {
        inVersion = true;
        // Extract version from header
        const match = line.match(/\[?(\d+\.\d+\.\d+)\]?/);
        versionHeader = match ? match[1] : line.replace('## ', '');
      }
      continue;
    }
    if (!inVersion) continue;
    entries.push(line);
  }

  if (!inVersion) {
    printWarning(`No changelog found for version ${targetVersion || 'latest'}`);
    return;
  }

  printHeader(`Changelog — ${versionHeader}`);
  console.log('');

  for (const line of entries) {
    if (line.startsWith('### ')) {
      // Section header (Features, Bug Fixes)
      printInfo(line.replace('### ', ''));
    } else if (line.startsWith('* ')) {
      // Bullet — clean up commit links
      const clean = line
        .slice(2)
        .replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)\s*$/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      console.log(`  · ${clean}`);
    } else if (line.trim()) {
      console.log(`  ${line.trim()}`);
    }
  }
  console.log('');
}

/**
 * Register the hidden `update` command
 */
export function registerUpdateCommand(program: Command): void {
  program
    .command('update', { hidden: true })
    .description('Update marketplace indexes and check for CLI updates')
    .option('--changelog [version]', 'Show changelog for a version (default: latest)')
    .action(async (options: { changelog?: string | boolean }) => {
      try {
        // If --changelog flag, show changelog and exit
        if (options.changelog !== undefined) {
          const version = typeof options.changelog === 'string' ? options.changelog : undefined;
          await showChangelog(version);
          return;
        }

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
            const viewCmd = `npm view @portel/photon version`;
            return execSync(viewCmd, {
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
            printInfo(`Update with: ${globalInstallCmd('@portel/photon')}`);
            printInfo(`Changelog: photon update --changelog ${latestVersion}`);
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
