/**
 * Path Resolver for Photon MCPs
 *
 * Uses a working directory approach (defaults to ~/.photon)
 * All MCPs are referenced by name only (no paths, no extensions)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export const DEFAULT_WORKING_DIR = path.join(os.homedir(), '.photon');

/**
 * Resolve a Photon MCP file path from name
 * Looks in the specified working directory, or uses absolute path if provided
 */
export async function resolvePhotonPath(
  name: string,
  workingDir: string = DEFAULT_WORKING_DIR
): Promise<string | null> {
  // If absolute path provided, check if it exists
  if (path.isAbsolute(name)) {
    try {
      await fs.access(name);
      return name;
    } catch {
      return null;
    }
  }

  // Remove extension if provided
  const basename = name.replace(/\.photon\.(ts|js)$/, '');

  // Try .photon.ts first, then .photon.js
  const extensions = ['.photon.ts', '.photon.js'];

  for (const ext of extensions) {
    const filePath = path.join(workingDir, `${basename}${ext}`);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // Continue to next extension
    }
  }

  // Not found
  return null;
}

/**
 * List all Photon MCP files in a directory
 */
export async function listPhotonMCPs(workingDir: string = DEFAULT_WORKING_DIR): Promise<string[]> {
  try {
    // Ensure directory exists
    await fs.mkdir(workingDir, { recursive: true });

    const entries = await fs.readdir(workingDir, { withFileTypes: true });
    const mcps: string[] = [];

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.photon.ts') || entry.name.endsWith('.photon.js'))) {
        // Remove extension for display
        const name = entry.name.replace(/\.photon\.(ts|js)$/, '');
        mcps.push(name);
      }
    }

    return mcps.sort();
  } catch (error: any) {
    return [];
  }
}

/**
 * Ensure working directory exists
 */
export async function ensureWorkingDir(workingDir: string = DEFAULT_WORKING_DIR): Promise<void> {
  await fs.mkdir(workingDir, { recursive: true });
}
