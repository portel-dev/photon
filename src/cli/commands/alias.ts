/**
 * Alias CLI Commands
 *
 * Create, remove, and list CLI shortcuts (aliases) for photons.
 */

import type { Command } from 'commander';

// ══════════════════════════════════════════════════════════════════════════════
// COMMANDS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Register the `alias`, `unalias`, and `aliases` commands.
 *
 * These are hidden commands that manage CLI shortcut aliases for photons,
 * delegating all logic to the cli-alias module.
 */
export function registerAliasCommands(program: Command, _defaultDir: string): void {
  program
    .command('alias', { hidden: true })
    .argument('<photon>', 'Photon to create alias for')
    .argument('[alias-name]', 'Custom alias name (defaults to photon name)')
    .description('Create a CLI alias for a photon')
    .action(async (photon: string, aliasName: string | undefined) => {
      const { createAlias } = await import('../../cli-alias.js');
      await createAlias(photon, aliasName);
    });

  program
    .command('unalias', { hidden: true })
    .argument('<alias-name>', 'Alias to remove')
    .description('Remove a CLI alias')
    .action(async (aliasName: string) => {
      const { removeAlias } = await import('../../cli-alias.js');
      await removeAlias(aliasName);
    });

  program
    .command('aliases', { hidden: true })
    .description('List all CLI aliases')
    .action(async () => {
      const { listAliases } = await import('../../cli-alias.js');
      await listAliases();
    });
}
