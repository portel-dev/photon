/**
 * Changelog CLI Command
 *
 * Shows what changed in the current or latest version.
 * If behind, shows the diff. If current, shows this release's changes.
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { PHOTON_VERSION } from '../../version.js';
import { globalInstallCmd } from '../../shared-utils.js';

const CHANGELOG_URL = 'https://raw.githubusercontent.com/portel-dev/photon/main/CHANGELOG.md';

/**
 * Fetch CHANGELOG.md from GitHub and parse a specific version's entry.
 */
async function fetchVersionEntry(version: string): Promise<string[]> {
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
  const entries: string[] = [];
  let inVersion = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (inVersion) break;
      if (line.includes(version)) {
        inVersion = true;
      }
      continue;
    }
    if (!inVersion) continue;
    entries.push(line);
  }

  return entries;
}

function formatEntries(entries: string[]): void {
  for (const line of entries) {
    if (line.startsWith('### ')) {
      // Section header
      console.log(`\n  ${line.replace('### ', '')}`);
    } else if (line.startsWith('* ')) {
      // Clean up commit links
      const clean = line
        .slice(2)
        .replace(/\s*\(\[[a-f0-9]+\]\([^)]+\)\)\s*$/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .trim();
      console.log(`    · ${clean}`);
    }
  }
  console.log('');
}

export function registerChangelogCommand(program: Command): void {
  program
    .command('changelog')
    .description("Show what's new in the current or latest version")
    .argument('[version]', 'Show changelog for a specific version')
    .action(async (requestedVersion?: string) => {
      try {
        const { printHeader, printInfo, printSuccess, printWarning } =
          await import('../../cli-formatter.js');
        const { execSync } = await import('child_process');

        // If specific version requested, just show it
        if (requestedVersion) {
          const entries = await fetchVersionEntry(requestedVersion);
          if (entries.length === 0) {
            printWarning(`No changelog found for v${requestedVersion}`);
            return;
          }
          printHeader(`Changelog — ${requestedVersion}`);
          formatEntries(entries);
          return;
        }

        // Check latest version
        let latestVersion: string | null = null;
        try {
          latestVersion = execSync('npm view @portel/photon version', {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {
          // Offline — just show current version's changelog
        }

        if (latestVersion && latestVersion !== PHOTON_VERSION) {
          // Behind — show what's in the new version
          printHeader(`Update available: ${PHOTON_VERSION} → ${latestVersion}`);
          console.log('');

          const entries = await fetchVersionEntry(latestVersion);
          if (entries.length > 0) {
            printInfo("What's new:");
            formatEntries(entries);
          } else {
            printWarning(`No changelog found for v${latestVersion}`);
            console.log('');
          }

          printInfo(`Update with: ${globalInstallCmd('@portel/photon')}`);
        } else {
          // Current — show what shipped in this release
          printSuccess(`You're on the latest version (${PHOTON_VERSION})`);
          console.log('');

          const entries = await fetchVersionEntry(PHOTON_VERSION);
          if (entries.length > 0) {
            printInfo("What's new in this release:");
            formatEntries(entries);
          } else {
            printWarning(`No changelog found for v${PHOTON_VERSION}`);
          }
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}
