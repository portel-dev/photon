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

// ══════════════════════════════════════════════════════════════════════════════
// READLINE UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

import * as readline from 'readline';

/**
 * Readline interface type for reuse
 */
export type ReadlineInterface = readline.Interface;

/**
 * Create a readline interface for CLI prompts
 * Uses stderr for output to keep stdout clean for data
 */
export function createReadline(): ReadlineInterface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

/**
 * Prompt user for text input
 * @param prompt - The prompt to display
 * @returns User's input
 */
export function promptText(prompt: string): Promise<string> {
  const rl = createReadline();
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Prompt user for confirmation (yes/no)
 * @param message - The message to display
 * @param defaultYes - Whether default is yes (true) or no (false)
 * @returns true for yes, false for no
 */
export function promptConfirm(message: string, defaultYes = false): Promise<boolean> {
  const rl = createReadline();
  const hint = defaultYes ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    rl.question(`${message} ${hint}: `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultYes);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

/**
 * Prompt user to select from numbered options
 * @param prompt - The prompt to display
 * @param optionCount - Number of options available
 * @param options - Configuration options
 * @param options.allowCancel - Whether empty input cancels (returns null). Default: true
 * @param options.defaultChoice - Default choice (1-based) to use on empty input
 * @returns Selected option number (1-based) or null if cancelled
 */
export function promptChoice(
  prompt: string,
  optionCount: number,
  options: boolean | { allowCancel?: boolean; defaultChoice?: number } = true
): Promise<number | null> {
  const rl = createReadline();

  // Handle legacy boolean parameter
  const opts = typeof options === 'boolean'
    ? { allowCancel: options }
    : options;
  const { allowCancel = true, defaultChoice } = opts;

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(prompt, (answer) => {
        const trimmed = answer.trim();

        if (trimmed === '') {
          if (defaultChoice !== undefined && defaultChoice >= 1 && defaultChoice <= optionCount) {
            rl.close();
            resolve(defaultChoice);
          } else if (allowCancel) {
            rl.close();
            resolve(null);
          } else {
            console.error(`Please enter a number between 1 and ${optionCount}`);
            ask();
          }
          return;
        }

        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= optionCount) {
          rl.close();
          resolve(num);
        } else {
          console.error(`Please enter a number between 1 and ${optionCount}`);
          ask();
        }
      });
    };
    ask();
  });
}

/**
 * Prompt user to wait and press Enter
 * @param message - Optional message (defaults to "Press Enter to continue")
 * @param allowCancel - Whether typing "cancel" aborts
 * @returns true to continue, false if cancelled
 */
export function promptWait(
  message = 'Press Enter to continue',
  allowCancel = true
): Promise<boolean> {
  const rl = createReadline();
  const suffix = allowCancel ? ' (or type "cancel" to abort)' : '';

  return new Promise((resolve) => {
    rl.question(`${message}${suffix}: `, (answer) => {
      rl.close();
      if (allowCancel && answer.toLowerCase().trim() === 'cancel') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
