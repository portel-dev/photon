/**
 * CLI Alias Manager
 *
 * Creates executable aliases for photons so they can be called directly
 * Example: Instead of `photon cli lg-remote discover`
 *          Run: `lg-remote discover`
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { resolvePhotonPath } from './path-resolver.js';

const ALIAS_DIR = path.join(os.homedir(), '.photon', 'bin');

/**
 * Create a CLI alias for a photon
 */
export async function createAlias(photonName: string, aliasName?: string): Promise<void> {
  try {
    // Verify photon exists
    const photonPath = await resolvePhotonPath(photonName);
    if (!photonPath) {
      console.error(`❌ Photon '${photonName}' not found`);
      console.error(`\nInstall it first with: photon add ${photonName}`);
      process.exit(1);
    }

    // Use provided alias name or default to photon name
    const cmdName = aliasName || photonName;

    // Create bin directory if it doesn't exist
    await fs.mkdir(ALIAS_DIR, { recursive: true });

    const aliasPath = path.join(ALIAS_DIR, cmdName);

    // Check if alias already exists
    if (existsSync(aliasPath)) {
      console.error(`⚠️  Alias '${cmdName}' already exists`);
      console.error(`\nRemove it first with: photon unalias ${cmdName}`);
      process.exit(1);
    }

    // Determine which photon executable to use
    const photonCmd = await findPhotonExecutable();

    // Create the alias script
    const script = `#!/bin/bash
# Auto-generated alias for photon: ${photonName}
${photonCmd} cli ${photonName} "$@"
`;

    await fs.writeFile(aliasPath, script, { mode: 0o755 });

    console.log(`✅ Created alias: ${cmdName}`);
    console.log(`\nYou can now run:`);
    console.log(`    ${cmdName} <command> [options]`);
    console.log(`\nInstead of:`);
    console.log(`    photon cli ${photonName} <command> [options]`);

    // Check if bin directory is in PATH
    const pathEnv = process.env.PATH || '';
    if (!pathEnv.split(':').includes(ALIAS_DIR)) {
      console.log(`\n⚠️  ${ALIAS_DIR} is not in your PATH`);
      console.log(`\nAdd this to your ~/.bashrc or ~/.zshrc:`);
      console.log(`    export PATH="$PATH:${ALIAS_DIR}"`);
      console.log(`\nThen reload your shell:`);
      console.log(`    source ~/.bashrc  # or source ~/.zshrc`);
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Remove a CLI alias
 */
export async function removeAlias(aliasName: string): Promise<void> {
  try {
    const aliasPath = path.join(ALIAS_DIR, aliasName);

    if (!existsSync(aliasPath)) {
      console.error(`❌ Alias '${aliasName}' not found`);
      process.exit(1);
    }

    await fs.unlink(aliasPath);
    console.log(`✅ Removed alias: ${aliasName}`);
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List all CLI aliases
 */
export async function listAliases(): Promise<void> {
  try {
    if (!existsSync(ALIAS_DIR)) {
      console.log('No aliases created yet.');
      console.log(`\nCreate one with: photon alias <photon-name>`);
      return;
    }

    const files = await fs.readdir(ALIAS_DIR);

    if (files.length === 0) {
      console.log('No aliases created yet.');
      console.log(`\nCreate one with: photon alias <photon-name>`);
      return;
    }

    console.log(`\nCLI Aliases (${ALIAS_DIR}):\n`);

    for (const file of files) {
      const aliasPath = path.join(ALIAS_DIR, file);
      const stat = await fs.stat(aliasPath);

      if (stat.isFile()) {
        // Read the script to find which photon it points to
        const content = await fs.readFile(aliasPath, 'utf-8');
        const match = content.match(/photon cli (\S+)/);
        const photonName = match ? match[1] : 'unknown';

        console.log(`    ${file} → photon cli ${photonName}`);
      }
    }

    console.log('');

    // Check if bin directory is in PATH
    const pathEnv = process.env.PATH || '';
    if (!pathEnv.split(':').includes(ALIAS_DIR)) {
      console.log(`⚠️  ${ALIAS_DIR} is not in your PATH`);
      console.log(`\nAdd this to your ~/.bashrc or ~/.zshrc:`);
      console.log(`    export PATH="$PATH:${ALIAS_DIR}"`);
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Find the photon executable path
 */
async function findPhotonExecutable(): Promise<string> {
  // Check if running from global installation
  const globalPhoton = await findInPath('photon');
  if (globalPhoton) {
    return globalPhoton;
  }

  // Fallback to npx
  return 'npx @portel/photon';
}

/**
 * Find a command in PATH
 */
async function findInPath(cmd: string): Promise<string | null> {
  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(':');

  for (const dir of paths) {
    const fullPath = path.join(dir, cmd);
    if (existsSync(fullPath)) {
      try {
        await fs.access(fullPath, fs.constants.X_OK);
        return fullPath;
      } catch {
        continue;
      }
    }
  }

  return null;
}
