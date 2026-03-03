/**
 * Run CLI Command
 *
 * Explicit `cli` command for directly invoking photon methods, plus the
 * implicit CLI mode (preprocessArgs) that rewrites bare photon names into
 * `cli` or `beam` subcommands before commander parses them.
 *
 * Also registers the unknown-command handler with "did you mean" suggestions.
 */

import type { Command } from 'commander';
import * as path from 'path';
import { getDefaultContext } from '../../context.js';

// ══════════════════════════════════════════════════════════════════════════════
// RESERVED COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

// Reserved commands that should NOT be treated as photon names.
// If the first arg is not in this list, it's assumed to be a photon name (implicit CLI mode).
export const RESERVED_COMMANDS = [
  // Core commands
  'serve',
  'sse',
  'beam',
  'list',
  'ls',
  'info',
  'test',
  // Photon management
  'new',
  'init',
  'validate',
  'sync',
  'add',
  'remove',
  'rm',
  // Maintenance
  'upgrade',
  'up',
  'update',
  'doctor',
  'audit',
  'clear-cache',
  'clean',
  'daemon',
  // Instance/env
  'use',
  'instances',
  'set',
  // Aliases
  'cli',
  'alias',
  'unalias',
  'aliases',
  // Marketplace
  'marketplace',
  // Packaging
  'package',
  // Hidden/advanced
  'mcp',
  'search',
  'maker',
  'host',
  'uninit',
  'diagram',
  'diagrams',
  'enable',
  'disable',
  // Help/version (handled by commander)
  'help',
  '--help',
  '-h',
  'version',
  '--version',
  '-V',
];

// All known commands for "did you mean" suggestions
const knownCommands = [
  'serve',
  'sse',
  'beam',
  'list',
  'ls',
  'info',
  'test',
  'new',
  'init',
  'validate',
  'sync',
  'add',
  'remove',
  'rm',
  'upgrade',
  'up',
  'update',
  'clear-cache',
  'clean',
  'doctor',
  'audit',
  'use',
  'instances',
  'set',
  'cli',
  'alias',
  'unalias',
  'aliases',
  'mcp',
  'search',
  'marketplace',
  'maker',
  'host',
  'shell',
  'diagram',
  'diagrams',
];

const knownSubcommands: Record<string, string[]> = {
  marketplace: ['list', 'add', 'remove', 'enable', 'disable'],
  maker: ['new', 'validate', 'sync', 'init'],
  init: ['cli', 'completions'],
  uninit: ['cli'],
};

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find closest matching command
 */
function findClosestCommand(input: string, commands: string[]): string | null {
  let closest: string | null = null;
  let minDistance = Infinity;

  for (const cmd of commands) {
    const distance = levenshteinDistance(input.toLowerCase(), cmd.toLowerCase());
    // Only suggest if distance is small enough (max 3 edits for short commands, proportional for longer)
    const maxDistance = Math.max(2, Math.floor(cmd.length / 2));
    if (distance < minDistance && distance <= maxDistance) {
      minDistance = distance;
      closest = cmd;
    }
  }

  return closest;
}

/**
 * Detect if an arg looks like a GitHub shorthand ref (owner/repo or owner/repo/photon-name).
 * Photon names are plain identifiers — no slashes — so any slash means a remote ref.
 */
function parseGitHubRef(arg: string): { owner: string; repo: string; photonName: string } | null {
  const parts = arg.split('/');
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some((p) => !p || !/^[a-zA-Z0-9._-]+$/.test(p))) return null;
  const [owner, repo, photonName] = parts;
  return { owner, repo, photonName: photonName || repo };
}

// ══════════════════════════════════════════════════════════════════════════════
// IMPLICIT CLI MODE — arg pre-processing
// ══════════════════════════════════════════════════════════════════════════════

interface PreprocessResult {
  args: string[];
  githubRef: string | null;
  photonName: string | null;
}

/**
 * Rewrite process.argv before commander parses it so that bare photon names
 * are dispatched to `cli` (when method args follow) or `beam` (focus mode).
 *
 * Also handles GitHub shorthand refs (owner/repo or owner/repo/photon-name).
 */
export function preprocessArgs(): PreprocessResult {
  const args = process.argv.slice(2);

  // No args - launch Beam (the primary interface)
  if (args.length === 0) {
    return { args: [...process.argv, 'beam'], githubRef: null, photonName: null };
  }

  // Find the first non-flag argument (skip values of flags that take a parameter)
  const flagsWithValues = ['--log-level'];
  const firstArgIndex = args.findIndex((arg, i) => {
    if (arg.startsWith('-')) return false;
    if (i > 0 && flagsWithValues.includes(args[i - 1])) return false;
    return true;
  });
  if (firstArgIndex === -1) {
    if (args.some((a) => a === '--help' || a === '-h' || a === '--version' || a === '-V')) {
      return { args: process.argv, githubRef: null, photonName: null };
    }
    return { args: [...process.argv, 'beam'], githubRef: null, photonName: null };
  }

  const firstArg = args[firstArgIndex];

  // If first arg is a reserved command, let commander handle normally
  if (RESERVED_COMMANDS.includes(firstArg)) {
    return { args: process.argv, githubRef: null, photonName: null };
  }

  // Check whether there are additional positional args after the photon name (method + args)
  // If so → CLI mode. If bare name only → beam focus mode.
  const remainingArgs = args.slice(firstArgIndex + 1);
  const hasMethodArgs = remainingArgs.some((a) => !a.startsWith('-'));

  // Check if it's a GitHub ref (owner/repo or owner/repo/photon-name)
  const ref = parseGitHubRef(firstArg);
  if (ref) {
    const newArgv = [...process.argv];
    newArgv[2 + firstArgIndex] = ref.photonName;
    // With method args → CLI. Bare ref → beam (focus on photon)
    newArgv.splice(2 + firstArgIndex, 0, hasMethodArgs ? 'cli' : 'beam');
    return { args: newArgv, githubRef: firstArg, photonName: ref.photonName };
  }

  // Regular photon name
  // With method args → CLI (e.g. photon cli lg-remote volume +5)
  // Bare name → beam focused on photon (e.g. photon beam connect-four)
  const newArgs = [...process.argv];
  newArgs.splice(2 + firstArgIndex, 0, hasMethodArgs ? 'cli' : 'beam');
  return { args: newArgs, githubRef: null, photonName: hasMethodArgs ? null : firstArg };
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the `cli` command and the unknown-command handler with "did you mean"
 * suggestions.
 *
 * The `cli` command is the explicit escape hatch for running photon methods when
 * the photon name conflicts with a reserved command. It is also the implicit
 * dispatch target for bare photon invocations rewritten by preprocessArgs().
 */
export function registerRunCommand(program: Command): void {
  // CLI command: directly invoke photon methods.
  // Also serves as escape hatch for photons with reserved names (e.g., photon cli list get).
  program
    .command('cli <photon> [method] [args...]')
    .description('Run photon methods from command line (escape hatch for reserved names)')
    .allowUnknownOption()
    .helpOption(false) // Disable default help so we can handle it ourselves
    .action(async (photon: string, method: string | undefined, args: string[]) => {
      // Handle help flag
      if (photon === '--help' || photon === '-h') {
        console.log(`USAGE:
    photon <photon-name> [method] [args...]
    photon cli <photon-name> [method] [args...]   (explicit form)

DESCRIPTION:
    Run photon methods directly from the command line. Photons provide
    a CLI interface automatically based on their exported methods.

    The 'cli' command is optional - you can run photons directly:
      photon lg-remote volume +5      (implicit)
      photon cli lg-remote volume +5  (explicit)

    Use 'photon cli' explicitly when your photon name conflicts with
    a reserved command (serve, beam, list, init, etc.)

EXAMPLES:
    # List all methods for a photon
    photon lg-remote

    # Call a method with no parameters
    photon lg-remote status

    # Call a method with parameters
    photon lg-remote volume 50
    photon lg-remote volume +5
    photon spotify play

    # Get method-specific help
    photon lg-remote volume --help

    # Output raw JSON instead of formatted text
    photon lg-remote status --json

    # Escape hatch for reserved-name photons
    photon cli list get       (photon named "list", method "get")
    photon cli serve status   (photon named "serve", method "status")

SEE ALSO:
    photon list           List all installed photons
    photon add <name>     Install a photon from marketplace
`);
        return;
      }

      const { listMethods, runMethod } = await import('../../photon-cli-runner.js');

      const cliWorkingDir = getDefaultContext().baseDir;
      if (!method) {
        // List all methods
        await listMethods(photon);
      } else {
        // Run specific method
        await runMethod(photon, method, args, cliWorkingDir);
      }
    });

  // Handle unknown commands with "did you mean" suggestions
  program.on('command:*', (operands) => {
    void (async () => {
      const { printError, printInfo } = await import('../../cli-formatter.js');
      const unknownCommand = operands[0];

      printError(`Unknown command: ${unknownCommand}`);

      // Check if it's a subcommand typo for a known parent
      const args = process.argv.slice(2);
      const parentIndex = args.findIndex((arg) => knownSubcommands[arg]);

      if (parentIndex !== -1 && parentIndex < args.indexOf(unknownCommand)) {
        const parent = args[parentIndex];
        const suggestion = findClosestCommand(unknownCommand, knownSubcommands[parent]);
        if (suggestion) {
          printInfo(`Did you mean: photon ${parent} ${suggestion}`);
        }
      } else {
        // Check for top-level command typo
        const suggestion = findClosestCommand(unknownCommand, knownCommands);
        if (suggestion) {
          printInfo(`Did you mean: photon ${suggestion}`);
        }
      }

      console.log('');
      printInfo(`Run 'photon --help' for usage`);
      process.exit(1);
    })();
  });
}
