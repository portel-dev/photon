/**
 * CLI Utilities
 *
 * Shared utilities for CLI commands to ensure consistent behavior
 */

import type { Command } from 'commander';
import { DEFAULT_PHOTON_DIR } from '@portel/photon-core';

/**
 * Global CLI options that can be set on any command
 */
export interface GlobalOptions {
  dir: string;
  logLevel?: string;
  jsonLogs?: boolean;
}

/**
 * Get global options from a command, handling parent chain
 *
 * Commander stores global options on the program root, so we need
 * to traverse up the parent chain to find them.
 */
export function getGlobalOptions(command: Command): GlobalOptions {
  // Traverse up to find the root program
  let current: Command | null = command;
  while (current?.parent) {
    current = current.parent;
  }

  const opts = current?.opts() || {};

  return {
    dir: opts.dir || DEFAULT_PHOTON_DIR,
    logLevel: opts.logLevel,
    jsonLogs: opts.jsonLogs,
  };
}

/**
 * Get the working directory from command options
 */
export function getWorkingDir(command: Command): string {
  return getGlobalOptions(command).dir;
}

/**
 * Check if we're in JSON output mode
 */
export function isJsonMode(command: Command): boolean {
  return getGlobalOptions(command).jsonLogs === true;
}

/**
 * Check if stdout is a TTY (for formatting decisions)
 */
export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

/**
 * Format output based on mode (JSON vs human-readable)
 */
export function formatOutput(data: unknown, command?: Command): string {
  if (command && isJsonMode(command)) {
    return JSON.stringify(data, null, 2);
  }

  if (typeof data === 'string') {
    return data;
  }

  return JSON.stringify(data, null, 2);
}
