/**
 * CLI Alias Manager (Cross-Platform)
 *
 * Creates executable aliases for photons so they can be called directly
 * Supports: Windows, macOS, Linux
 * Example: Instead of `photon cli lg-remote discover`
 *          Run: `lg-remote discover`
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { resolvePhotonPath } from './path-resolver.js';

const ALIAS_DIR = path.join(os.homedir(), '.photon', 'bin');
const IS_WINDOWS = process.platform === 'win32';
const PATH_SEPARATOR = IS_WINDOWS ? ';' : ':';

/**
 * Create a CLI alias for a photon (cross-platform)
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

    // Determine which photon executable to use
    const photonCmd = await findPhotonExecutable();

    // Create platform-specific alias file
    if (IS_WINDOWS) {
      await createWindowsAlias(cmdName, photonName, photonCmd);
    } else {
      await createUnixAlias(cmdName, photonName, photonCmd);
    }

    console.log(`✅ Created alias: ${cmdName}`);
    console.log(`\nYou can now run:`);
    console.log(`    ${cmdName} <command> [options]`);
    console.log(`\nInstead of:`);
    console.log(`    photon cli ${photonName} <command> [options]`);

    // Check if bin directory is in PATH and provide instructions
    await checkAndInstructPath();
  } catch (error: any) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Create Unix-style alias (bash script)
 */
async function createUnixAlias(cmdName: string, photonName: string, photonCmd: string): Promise<void> {
  const aliasPath = path.join(ALIAS_DIR, cmdName);

  // Check if alias already exists
  if (existsSync(aliasPath)) {
    console.error(`⚠️  Alias '${cmdName}' already exists`);
    console.error(`\nRemove it first with: photon unalias ${cmdName}`);
    process.exit(1);
  }

  const script = `#!/bin/bash
# Auto-generated alias for photon: ${photonName}
${photonCmd} cli ${photonName} "$@"
`;

  await fs.writeFile(aliasPath, script, { mode: 0o755 });
}

/**
 * Create Windows-style alias (batch file)
 */
async function createWindowsAlias(cmdName: string, photonName: string, photonCmd: string): Promise<void> {
  const aliasPath = path.join(ALIAS_DIR, `${cmdName}.cmd`);

  // Check if alias already exists
  if (existsSync(aliasPath)) {
    console.error(`⚠️  Alias '${cmdName}' already exists`);
    console.error(`\nRemove it first with: photon unalias ${cmdName}`);
    process.exit(1);
  }

  const script = `@echo off
REM Auto-generated alias for photon: ${photonName}
${photonCmd} cli ${photonName} %*
`;

  await fs.writeFile(aliasPath, script);
}

/**
 * Check if alias directory is in PATH and provide platform-specific instructions
 */
async function checkAndInstructPath(): Promise<void> {
  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(PATH_SEPARATOR);

  if (paths.includes(ALIAS_DIR)) {
    // Already in PATH
    return;
  }

  console.log(`\n⚠️  ${ALIAS_DIR} is not in your PATH`);

  if (IS_WINDOWS) {
    console.log(`\nTo add it permanently, run this in PowerShell (as Administrator):`);
    console.log(`    [Environment]::SetEnvironmentVariable("Path", $env:Path + ";${ALIAS_DIR}", "User")`);
    console.log(`\nOr add it manually:`);
    console.log(`    1. Open "Environment Variables" in Windows settings`);
    console.log(`    2. Edit the "Path" variable for your user`);
    console.log(`    3. Add: ${ALIAS_DIR}`);
    console.log(`    4. Restart your terminal`);
  } else {
    // Detect shell
    const shell = process.env.SHELL || '';
    let configFile = '~/.bashrc';

    if (shell.includes('zsh')) {
      configFile = '~/.zshrc';
    } else if (shell.includes('fish')) {
      configFile = '~/.config/fish/config.fish';
    }

    console.log(`\nAdd this to your ${configFile}:`);
    console.log(`    export PATH="$PATH:${ALIAS_DIR}"`);
    console.log(`\nThen reload your shell:`);
    console.log(`    source ${configFile}`);
  }
}

/**
 * Remove a CLI alias (cross-platform)
 */
export async function removeAlias(aliasName: string): Promise<void> {
  try {
    // Try both Unix and Windows formats
    const unixPath = path.join(ALIAS_DIR, aliasName);
    const windowsPath = path.join(ALIAS_DIR, `${aliasName}.cmd`);

    let aliasPath: string | null = null;

    if (existsSync(unixPath)) {
      aliasPath = unixPath;
    } else if (existsSync(windowsPath)) {
      aliasPath = windowsPath;
    }

    if (!aliasPath) {
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
 * List all CLI aliases (cross-platform)
 */
export async function listAliases(): Promise<void> {
  try {
    const { formatOutput, printInfo, printWarning } = await import('./cli-formatter.js');

    if (!existsSync(ALIAS_DIR)) {
      printInfo('No aliases created yet.');
      printInfo('Create one with: photon alias <photon-name>');
      return;
    }

    const files = await fs.readdir(ALIAS_DIR);

    if (files.length === 0) {
      printInfo('No aliases created yet.');
      printInfo('Create one with: photon alias <photon-name>');
      return;
    }

    // Build table data
    const tableData: Array<{ alias: string; photon: string }> = [];

    for (const file of files) {
      const aliasPath = path.join(ALIAS_DIR, file);
      const stat = await fs.stat(aliasPath);

      if (stat.isFile()) {
        // Read the script to find which photon it points to
        const content = await fs.readFile(aliasPath, 'utf-8');
        const match = content.match(/photon cli (\S+)/);
        const photonName = match ? match[1] : 'unknown';

        // Display name without .cmd extension on Windows
        const displayName = file.replace(/\.cmd$/, '');
        tableData.push({ alias: displayName, photon: photonName });
      }
    }

    printInfo(`CLI Aliases (${tableData.length}):\n`);
    formatOutput(tableData, 'table');

    // Check if bin directory is in PATH
    const pathEnv = process.env.PATH || '';
    const paths = pathEnv.split(PATH_SEPARATOR);

    if (!paths.includes(ALIAS_DIR)) {
      printWarning(`${ALIAS_DIR} is not in your PATH`);
      await checkAndInstructPath();
    }
  } catch (error: any) {
    const { printError } = await import('./cli-formatter.js');
    printError(error.message);
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
