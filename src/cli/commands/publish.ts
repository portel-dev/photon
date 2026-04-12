/**
 * Publish CLI — thin driver over the `publish` bundled photon.
 *
 * The actual wizard lives in `src/photons/publish.photon.ts`. This file:
 *   1. imports that photon's default class
 *   2. drives its async generator
 *   3. translates `ask:*` yields into readline prompts
 *   4. prints `emit:*` yields to stderr
 *
 * Same pattern Beam/MCP use — the wizard definition is source-of-truth.
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { promptText, promptConfirm, promptChoice } from '../../shared/cli-utils.js';
import Publish, { type PublishParams } from '../../photons/publish.photon.js';

async function driveWizard(params: PublishParams): Promise<void> {
  const gen = Publish.wizard(params);
  let next = await gen.next();

  while (!next.done) {
    const step: any = next.value;

    if (step?.emit === 'status') {
      console.error(step.message);
      if (step.data?.changes) {
        const rows = step.data.changes as Array<{
          name: string;
          status: string;
          current: string;
          suggested: string;
          added: string[];
          removed: string[];
        }>;
        console.error('');
        console.error(
          `  ${'NAME'.padEnd(24)} ${'STATUS'.padEnd(9)} ${'CURRENT'.padEnd(10)} ${'SUGGESTED'.padEnd(10)} NOTES`
        );
        for (const r of rows) {
          const notes: string[] = [];
          if (r.added.length) notes.push(`+${r.added.length} methods`);
          if (r.removed.length) notes.push(`-${r.removed.length} methods`);
          console.error(
            `  ${r.name.padEnd(24)} ${r.status.padEnd(9)} ${r.current.padEnd(10)} ${r.suggested.padEnd(10)} ${notes.join(', ')}`
          );
        }
        console.error('');
      }
      next = await gen.next();
      continue;
    }

    if (step?.emit === 'result') {
      const d = step.data ?? {};
      if (d.error) {
        console.error(`❌ ${d.error}`);
        if (d.hint) console.error(`   ${d.hint}`);
        process.exit(1);
      }
      if (d.cancelled) {
        console.error(`Cancelled${d.atStep ? ` at ${d.atStep}` : ''}.`);
        if (d.hint) console.error(`  ${d.hint}`);
        process.exit(0);
      }
      console.error('\n🎉 Published!');
      if (d.repoUrl) console.error(`   Repo: ${d.repoUrl}`);
      if (d.installCommand) {
        console.error(`\n   Teammates install with:`);
        console.error(`     ${d.installCommand}`);
      }
      if (Array.isArray(d.next) && d.next.length > 0) {
        console.error(`\n   Next:`);
        for (const n of d.next) console.error(`     • ${n}`);
      }
      console.error('');
      next = await gen.next();
      continue;
    }

    if (step?.ask === 'text') {
      const hint = step.default ? ` [${step.default}]` : '';
      const answer = (await promptText(`${step.message}${hint}: `)).trim();
      next = await gen.next(answer || step.default || '');
      continue;
    }

    if (step?.ask === 'confirm') {
      const answer = await promptConfirm(step.message, step.default ?? false);
      next = await gen.next(answer);
      continue;
    }

    if (step?.ask === 'select') {
      const opts = step.options as Array<{ value: string; label: string }>;
      console.error(`\n${step.message}`);
      opts.forEach((o, i) => console.error(`  [${i + 1}] ${o.label}`));
      const defaultIdx = step.default ? opts.findIndex((o) => o.value === step.default) + 1 : 1;
      const idx = await promptChoice(`Choice [${defaultIdx}]: `, opts.length, {
        defaultChoice: defaultIdx,
        allowCancel: false,
      });
      next = await gen.next(opts[(idx ?? defaultIdx) - 1]?.value);
      continue;
    }

    // Unknown step shape — advance without user input
    next = await gen.next();
  }
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description(
      'Publish your photons as a marketplace (init → bump versions → commit → push → share)'
    )
    .option('--dir <path>', 'Directory to publish (defaults to current)')
    .option('--name <name>', 'Marketplace name')
    .option('--owner <github-user>', 'GitHub owner')
    .option('--description <desc>', 'Marketplace description')
    .option('--bump <level>', 'Version bump: patch | minor | major | auto')
    .option('--public', 'Create remote as public (default: private)')
    .option('--dry-run', 'Show plan without touching anything')
    .action(async (options: any) => {
      try {
        await driveWizard({
          dir: options.dir,
          name: options.name,
          owner: options.owner,
          description: options.description,
          bump: options.bump,
          public: options.public === true,
          dryRun: options.dryRun === true,
        });
      } catch (err) {
        logger.error(`publish failed: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
