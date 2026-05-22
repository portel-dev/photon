/**
 * Host CLI Command
 *
 * Manage cloud hosting and deployment (preview, deploy)
 */

import type { Command } from 'commander';
import { getErrorMessage } from '../../shared/error-handler.js';
import { logger } from '../../shared/logger.js';
import { resolvePhotonPath } from '../../path-resolver.js';
import { getDefaultContext } from '../../context.js';

/**
 * Register the `host` command group (host preview, host deploy)
 */
export function registerHostCommand(program: Command): void {
  const host = program
    .command('host', { hidden: true })
    .description('Manage cloud hosting and deployment')
    .configureHelp({
      sortSubcommands: false,
      sortOptions: false,
    });

  host
    .command('preview')
    .argument('<target>', 'Deployment target: cloudflare (or cf)')
    .argument('<name>', 'Photon name (without .photon.ts extension)')
    .option('--output <dir>', 'Output directory for generated project')
    .description('Run Photon locally in a simulated deployment environment')
    .action(async (target: string, name: string, options: any, command: Command) => {
      try {
        // Get working directory from global options
        const workingDir = getDefaultContext().baseDir;
        const { announceContext } = await import('../../shared/announce-context.js');
        announceContext({ action: 'Previewing', photon: name, target: workingDir });

        // Resolve file path from name
        const photonPath = await resolvePhotonPath(name, workingDir);

        if (!photonPath) {
          logger.error(`Photon not found: ${name}`);
          console.error(`Searched in: ${workingDir}`);
          console.error(`Tip: Use 'photon info' to see available photons`);
          process.exit(1);
        }

        const normalizedTarget = target.toLowerCase();

        if (normalizedTarget === 'cloudflare' || normalizedTarget === 'cf') {
          const { devCloudflare } = await import('../../deploy/cloudflare.js');
          await devCloudflare({
            photonPath,
            outputDir: options.output,
          });
        } else {
          logger.error(`Unknown target: ${target}`);
          console.error('Supported targets: cloudflare (cf)');
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Error: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });

  host
    .command('deploy')
    .argument('<target>', 'Deployment target: cloudflare (or cf)')
    .argument('<name>', 'Photon name (without .photon.ts extension)')
    .option('--dev', 'Enable Beam UI in deployment')
    .option('--dry-run', 'Generate project without deploying')
    .option('--output <dir>', 'Output directory for generated project')
    .option('--logs', 'Enable Workers Logs (Cloudflare dashboard observability)')
    .option('--mcp-auth <mode>', 'MCP auth mode: jwt, bearer, or open')
    .option(
      '--mcp-audience <url>',
      'Expected MCP JWT audience URL, for example https://app.example.com/mcp'
    )
    .description('Deploy a Photon to cloud platforms')
    .action(async (target: string, name: string, options: any, command: Command) => {
      try {
        // Get working directory from global options
        const workingDir = getDefaultContext().baseDir;
        const { announceContext } = await import('../../shared/announce-context.js');
        announceContext({ action: 'Deploying', photon: name, target: workingDir });

        // Resolve file path from name
        const photonPath = await resolvePhotonPath(name, workingDir);

        if (!photonPath) {
          logger.error(`Photon not found: ${name}`);
          console.error(`Searched in: ${workingDir}`);
          console.error(`Tip: Use 'photon info' to see available photons`);
          process.exit(1);
        }

        const normalizedTarget = target.toLowerCase();

        if (normalizedTarget === 'cloudflare' || normalizedTarget === 'cf') {
          if (options.mcpAuth && !['jwt', 'bearer', 'open'].includes(String(options.mcpAuth))) {
            logger.error(`Unknown MCP auth mode: ${options.mcpAuth}`);
            console.error('Supported MCP auth modes: jwt, bearer, open');
            process.exit(1);
          }
          const { deployToCloudflare } = await import('../../deploy/cloudflare.js');
          await deployToCloudflare({
            photonPath,
            devMode: options.dev,
            dryRun: options.dryRun,
            outputDir: options.output,
            withLogs: options.logs,
            mcpAuth: options.mcpAuth,
            mcpAudience: options.mcpAudience,
          });
        } else {
          logger.error(`Unknown deployment target: ${target}`);
          console.error('Supported targets: cloudflare (cf)');
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Deployment failed: ${getErrorMessage(error)}`);
        process.exit(1);
      }
    });
}
