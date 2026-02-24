/**
 * Config CLI Commands
 *
 * Commands for managing photon instances and environment configuration:
 * - use: Switch to a named instance of a stateful photon
 * - instances: List all instances of a stateful photon
 * - set: Configure environment variables for a photon
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';

/**
 * Register config-related commands: use, instances, set
 */
export function registerConfigCommands(program: Command, defaultDir: string): void {
  // Use command: switch to a named instance of a stateful photon
  program
    .command('use')
    .argument('<photon>', 'Photon name')
    .argument('[instance]', 'Instance name (omit for default)')
    .description('Switch to a named instance of a stateful photon')
    .action(async (photonName: string, instance?: string) => {
      try {
        const { printSuccess, printError } = await import('../../cli-formatter.js');
        const { CLISessionStore } = await import('../../context-store.js');

        // Write to CLI session store only — each client manages its own instance
        new CLISessionStore().setCurrentInstance(photonName, instance || '');

        const label = instance || 'default';
        printSuccess(`${photonName} → instance: ${label}`);

        // Refresh completions cache (picks up new instance)
        try {
          const { generateCompletionCache } = await import('../../shell-completions.js');
          await generateCompletionCache();
        } catch {
          // Best-effort: don't break the use command if cache refresh fails
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });

  // Instances command: list all instances of a stateful photon
  program
    .command('instances')
    .argument('<photon>', 'Photon name')
    .description('List all instances of a stateful photon')
    .action(async (photonName: string, _options: unknown, command: Command) => {
      try {
        const { printInfo, printError, printHeader } = await import('../../cli-formatter.js');
        const parentOpts = command.parent?.opts() || {};
        const workingDir = parentOpts.dir || defaultDir;
        const { InstanceStore } = await import('../../context-store.js');
        const store = new InstanceStore(workingDir);

        const instances = store.listInstances(photonName);
        const current = store.getCurrentInstance(photonName) || 'default';

        if (instances.length === 0) {
          printInfo(`No instances found for ${photonName}.`);
          return;
        }

        console.log('');
        printHeader(`${photonName} — Instances`);
        console.log('');
        for (const name of instances) {
          const marker = name === current ? ' ← current' : '';
          console.log(`  ${name}${marker}`);
        }
        console.log('');
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });

  // Set command: configure environment for photons (primitive params without defaults)
  program
    .command('set')
    .argument('<photon>', 'Photon name')
    .argument('[args...]', 'Environment values (name=value pairs)')
    .description('Configure environment for a photon (params without defaults)')
    .action(async (photonName: string, args: string[], _options: unknown, command: Command) => {
      try {
        const { printInfo, printSuccess, printError, printHeader } =
          await import('../../cli-formatter.js');
        const parentOpts = command.parent?.opts() || {};
        const workingDir = parentOpts.dir || defaultDir;

        // Resolve photon path (including bundled photons)
        const { getBundledPhotonPath } = await import('../../shared-utils.js');
        const { resolvePhotonPath } = await import('../../path-resolver.js');
        const { fileURLToPath } = await import('url');
        const path = await import('path');
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        // Go up two levels: commands/ -> cli/ -> src/
        const distDir = path.resolve(__dirname, '..', '..');
        const bundledPath = getBundledPhotonPath(photonName, distDir);
        const filePath = bundledPath || (await resolvePhotonPath(photonName, workingDir));

        if (!filePath) {
          printError(`Photon not found: ${photonName}`);
          process.exit(1);
        }

        // Extract constructor params and filter env params
        const { SchemaExtractor } = await import('@portel/photon-core');
        const fs = await import('fs/promises');
        const source = await fs.readFile(filePath, 'utf-8');
        const extractor = new SchemaExtractor();
        const allParams = extractor.extractConstructorParams(source);
        const { getEnvParams, EnvStore } = await import('../../context-store.js');
        const envParams = getEnvParams(allParams);

        if (envParams.length === 0) {
          printInfo(`${photonName} has no environment parameters.`);
          return;
        }

        const store = new EnvStore();

        // Parse name=value pairs from args
        const values: Record<string, string> = {};
        const paramNames = new Set(envParams.map((p: { name: string }) => p.name));

        for (const arg of args) {
          const eqIdx = arg.indexOf('=');
          if (eqIdx > 0) {
            const key = arg.slice(0, eqIdx);
            const val = arg.slice(eqIdx + 1);
            if (paramNames.has(key)) {
              values[key] = val;
            }
          } else if (envParams.length === 1) {
            // Single env param: positional value
            values[envParams[0].name] = arg;
          }
        }

        // Find params that still need values
        const remaining = envParams.filter((p: { name: string }) => !(p.name in values));

        if (remaining.length > 0) {
          // Interactive mode for remaining params
          console.log('');
          printHeader(`${photonName} — Environment`);
          console.log('');

          const masked = store.getMasked(photonName);
          const { promptText } = await import('../../shared/cli-utils.js');

          for (const param of remaining) {
            const currentDisplay = masked[param.name]
              ? `Current: ${masked[param.name]}`
              : 'Not set';
            const answer = await promptText(
              `  ${param.name} (required)\n  ${currentDisplay}\n  > `
            );
            if (answer.trim() !== '') {
              values[param.name] = answer.trim();
            }
          }
        }

        if (Object.keys(values).length > 0) {
          store.write(photonName, values);
          const summary = Object.keys(values).join(', ');
          printSuccess(`Environment saved: ${summary}`);
        } else {
          printInfo('No changes.');
        }
      } catch (error) {
        const { printError } = await import('../../cli-formatter.js');
        printError(getErrorMessage(error));
        process.exit(1);
      }
    });
}
