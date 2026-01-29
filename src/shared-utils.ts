/**
 * Shared utilities for Photon
 *
 * Centralized utility functions to eliminate code duplication
 * across cli.ts, beam.ts, and photon-cli-runner.ts.
 */

import { existsSync } from 'fs';
import * as path from 'path';

// ════════════════════════════════════════════════════════════════════════════════
// BUNDLED PHOTON RESOLUTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Default bundled photons that ship with the runtime
 */
export const DEFAULT_BUNDLED_PHOTONS = ['maker'];

/**
 * Extended bundled photons for beam (includes tunnel)
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

/**
 * Execute an async operation with error context wrapping
 *
 * @param operation - Async function to execute
 * @param context - Context string for error messages
 * @param logger - Optional logger for error output
 * @returns Result of operation
 * @throws Wrapped error with context
 *
 * @example
 * ```typescript
 * const result = await withErrorContext(
 *   () => loader.loadFile(photonPath),
 *   `Loading photon: ${photonPath}`
 * );
 * ```
 */
export async function withErrorContext<T>(
  operation: () => Promise<T>,
  context: string,
  logger?: { error: (msg: string) => void }
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = `${context}: ${getErrorMessage(error)}`;
    if (logger) {
      logger.error(message);
    }
    throw new Error(message);
  }
}

/**
 * Synchronous version of withErrorContext
 */
export function withErrorContextSync<T>(
  operation: () => T,
  context: string,
  logger?: { error: (msg: string) => void }
): T {
  try {
    return operation();
  } catch (error) {
    const message = `${context}: ${getErrorMessage(error)}`;
    if (logger) {
      logger.error(message);
    }
    throw new Error(message);
  }
}
