/**
 * Test CLI Command
 *
 * Run test methods defined in photons (direct unit, CLI integration, or MCP integration).
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { getDefaultContext } from '../../context.js';

// ══════════════════════════════════════════════════════════════════════════════
// COMMAND
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the `test` command.
 *
 * Runs test methods in one or all photons, with selectable execution modes:
 * direct (unit), cli (integration via CLI), mcp (integration via MCP), or all.
 */
export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .argument('[photon]', 'Photon to test (tests all if omitted)')
    .argument('[test]', 'Specific test to run')
    .option('--json', 'Output results as JSON')
    .option(
      '--mode <mode>',
      'Test mode: direct (unit), cli (integration via CLI), mcp (integration via MCP), all',
      'direct'
    )
    .description('Run test methods in photons')
    .action(
      async (
        photon: string | undefined,
        test: string | undefined,
        options: any,
        command: Command
      ) => {
        try {
          const workingDir = getDefaultContext().baseDir;
          const { runTests } = await import('../../test-runner.js');

          // Validate mode
          const validModes = ['direct', 'cli', 'mcp', 'all'];
          if (!validModes.includes(options.mode)) {
            logger.error(`Invalid mode: ${options.mode}. Valid modes: ${validModes.join(', ')}`);
            process.exit(1);
          }

          const summary = await runTests(workingDir, photon, test, {
            json: options.json,
            mode: options.mode,
          });

          // Exit with error code if any tests failed
          if (summary.failed > 0) {
            process.exit(1);
          }
        } catch (error) {
          logger.error(`Error: ${getErrorMessage(error)}`);
          process.exit(1);
        }
      }
    );
}
