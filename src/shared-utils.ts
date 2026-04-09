/**
 * Shared utilities for Photon
 *
 * Centralized utility functions to eliminate code duplication
 * across cli.ts, beam.ts, and photon-cli-runner.ts.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════════
// BUNDLED PHOTON RESOLUTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Default bundled photons that ship with the runtime.
 * Available in CLI, STDIO, and Beam.
 */
export const DEFAULT_BUNDLED_PHOTONS = ['maker', 'marketplace'];

/**
 * Extended bundled photons for Beam (includes tunnel for port forwarding UI)
 */
export const BEAM_BUNDLED_PHOTONS = ['maker', 'marketplace', 'tunnel'];

/**
 * Get path to a bundled photon (ships with runtime)
 *
 * @param name - Photon name (without .photon.ts extension)
 * @param callerDir - __dirname of the calling module (used to resolve relative paths)
 * @param bundledList - List of bundled photon names to check against
 * @returns Absolute path to photon file, or null if not found
 *
 * @example
 * ```typescript
 * // From cli.ts (dist/cli.js)
 * const photonPath = getBundledPhotonPath('maker', __dirname);
 *
 * // From beam.ts (dist/auto-ui/beam.js)
 * const photonPath = getBundledPhotonPath('tunnel', __dirname, BEAM_BUNDLED_PHOTONS);
 * ```
 */
export function getBundledPhotonPath(
  name: string,
  callerDir: string,
  bundledList: string[] = DEFAULT_BUNDLED_PHOTONS
): string | null {
  if (!bundledList.includes(name)) {
    return null;
  }

  const filename = `${name}.photon.ts`;

  // Build list of potential paths based on different module locations
  // The paths vary depending on whether we're running from:
  // - dist/cli.js
  // - dist/auto-ui/beam.js
  // - src/ during development
  const searchPaths = [
    // Standard dist layout: dist/photons/
    path.join(callerDir, 'photons', filename),
    // Dev layout from dist: ../src/photons/
    path.join(callerDir, '..', 'src', 'photons', filename),
    // Nested dist (auto-ui): ../photons/
    path.join(callerDir, '..', 'photons', filename),
    // Deep nested dev: ../../src/photons/
    path.join(callerDir, '..', '..', 'src', 'photons', filename),
  ];

  for (const searchPath of searchPaths) {
    if (existsSync(searchPath)) {
      return searchPath;
    }
  }

  return null;
}

// ════════════════════════════════════════════════════════════════════════════════
// PACKAGE MANAGER DETECTION
// ════════════════════════════════════════════════════════════════════════════════

let _cachedPM: 'bun' | 'npm' | 'npm.cmd' | null = null;

/**
 * Detect the available package manager — prefers bun, falls back to npm.
 * Result is cached for the process lifetime.
 */
export function detectPM(): 'bun' | 'npm' | 'npm.cmd' {
  if (_cachedPM) return _cachedPM;
  try {
    execSync('bun --version', { stdio: 'ignore' });
    _cachedPM = 'bun';
  } catch {
    _cachedPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  }
  return _cachedPM;
}

/**
 * Get the package runner command (bunx/npx) matching the detected PM.
 */
export function detectRunner(): 'bunx' | 'npx' {
  return detectPM() === 'bun' ? 'bunx' : 'npx';
}

/**
 * Build the MCP server command+args for a photon.
 * Prefers `photon` if globally installed (shorter, no registry fetch),
 * otherwise falls back to npx/bunx.
 */
let _photonOnPath: boolean | null = null;
export function mcpCommand(photonName: string): { command: string; args: string[] } {
  if (_photonOnPath === null) {
    try {
      execSync('photon --version', { stdio: 'ignore' });
      _photonOnPath = true;
    } catch {
      _photonOnPath = false;
    }
  }
  if (_photonOnPath) {
    return { command: 'photon', args: ['mcp', photonName] };
  }
  const runner = detectRunner();
  return { command: runner, args: ['-y', '@portel/photon', 'mcp', photonName] };
}

/**
 * Get the install command for a global package.
 */
export function globalInstallCmd(pkg: string): string {
  return detectPM() === 'bun' ? `bun add -g ${pkg}` : `npm install -g ${pkg}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING UTILITIES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Safely extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}
