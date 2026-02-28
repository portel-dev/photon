/**
 * CLI Utilities
 *
 * Shared readline helpers for CLI commands
 */

import * as readline from 'readline';

/**
 * Create a readline interface for CLI prompts
 * Uses stderr for output to keep stdout clean for data
 */
export function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
}

/**
 * Prompt user for text input
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
 */
export function promptChoice(
  prompt: string,
  optionCount: number,
  options: boolean | { allowCancel?: boolean; defaultChoice?: number } = true
): Promise<number | null> {
  const rl = createReadline();

  const opts = typeof options === 'boolean' ? { allowCancel: options } : options;
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
