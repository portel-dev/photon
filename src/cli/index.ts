/**
 * CLI Entry Point — Program Setup + Command Registration
 *
 * This module creates the Commander program, sets up global options,
 * registers all command modules, and handles argv preprocessing.
 * The actual `cli.ts` bin entry point is a thin wrapper around this.
 */

import { Command } from 'commander';
import { PHOTON_VERSION } from '../version.js';
import { getDefaultContext } from '../context.js';

// Command registrations (all lazy-loaded inside their actions)
import { registerUpdateCommand } from './commands/update.js';
import { registerMCPCommand } from './commands/mcp.js';
import { registerSSECommand, registerBeamCommand } from './commands/beam.js';
import { registerServeCommand } from './commands/serve.js';
import { registerHostCommand } from './commands/host.js';
import { registerSearchCommand } from './commands/search.js';
import { registerMakerCommands } from './commands/maker.js';
import { registerMarketplaceCommands } from './commands/marketplace.js';
import { registerInfoCommand } from './commands/info.js';
import { registerPackageCommands } from './commands/package.js';
import { registerPackageAppCommand } from './commands/package-app.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerRunCommand } from './commands/run.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDaemonCommands } from './commands/daemon.js';
import { registerInitCommands, registerUninitCommands } from './commands/init.js';
import { registerTestCommand } from './commands/test.js';
import { registerAliasCommands } from './commands/alias.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerBuildCommand } from './commands/build.js';
import { preprocessArgs } from './commands/run.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('photon')
    .description('Universal runtime for single-file TypeScript programs')
    .version(PHOTON_VERSION)
    .option('--log-level <level>', 'Set log verbosity (error|warn|info|debug)', 'info')
    .option('--json-logs', 'Emit newline-delimited JSON logs for runtime output')
    .configureHelp({
      sortSubcommands: false,
      sortOptions: false,
      visibleCommands: () => [],
    })
    .addHelpText(
      'after',
      `
Runtime Commands:
  mcp <name>              Run a photon as MCP server (for AI assistants)
  cli <photon> [method]   Run photon methods from command line
                          Example: photon cli kanban stats
  sse <name>              Run Photon as HTTP server with SSE transport
  beam                    Launch Photon Beam (interactive control panel)
  serve                   Start local multi-tenant MCP hosting for development

Configuration:
  use <photon> [instance]  Switch to a named instance of a stateful photon
  instances <photon>       List all instances of a stateful photon
  set <photon> [values]    Configure environment for a photon

Hosting:
  host <command>          Manage cloud hosting (preview, deploy)

Package Management:
  add <name>              Install a photon from marketplace
  remove <name>           Remove an installed photon
  upgrade [name]          Upgrade photon(s) to latest version
  search <query>          Search marketplaces for photons
  info [name]             Show installed photons and details

Maintenance:
  update                  Refresh marketplace indexes & check CLI version
  doctor [name]           Diagnose environment and installations
  audit                   View persistent tool execution audit log

Development:
  maker new <name>        Create a new photon from template
  maker validate <name>   Validate photon syntax and schemas
  maker sync              Generate marketplace manifest
  maker init              Initialize marketplace with git hooks

Advanced:
  marketplace             Manage marketplace sources
  alias <photon>          Create CLI shortcuts for photons

Run 'photon <command> --help' for detailed usage.
`
    );

  // Register all command modules
  registerUpdateCommand(program);
  registerMCPCommand(program);
  registerSSECommand(program);
  registerBeamCommand(program);
  registerServeCommand(program);
  registerHostCommand(program);
  registerSearchCommand(program);
  registerMakerCommands(program);
  registerMarketplaceCommands(program);
  registerInfoCommand(program);
  registerPackageCommands(program);
  registerPackageAppCommand(program);
  registerDoctorCommand(program);
  registerRunCommand(program);
  registerConfigCommands(program);
  registerDaemonCommands(program);
  registerInitCommands(program);
  registerUninitCommands(program);
  registerTestCommand(program);
  registerAliasCommands(program);
  registerAuditCommand(program);
  registerBuildCommand(program);

  return program;
}

/**
 * Main CLI execution — preprocess args and parse.
 */
export async function main(): Promise<void> {
  const program = createProgram();
  const { args, githubRef, photonName } = preprocessArgs();

  // If preprocessArgs detected a GitHub ref, auto-install before parse
  if (githubRef && photonName) {
    try {
      const workingDir = getDefaultContext().baseDir;
      const { existsSync } = await import('fs');
      const path = await import('path');
      const photonFile = path.join(workingDir, `${photonName}.photon.ts`);
      if (!existsSync(photonFile)) {
        const { MarketplaceManager } = await import('../marketplace-manager.js');
        const manager = new MarketplaceManager(undefined, workingDir);
        await manager.initialize();
        await manager.fetchAndInstallFromRef(githubRef, workingDir);
        console.error(`✅ Installed ${photonName} from ${githubRef}`);
      }
    } catch (err) {
      const { printError } = await import('../cli-formatter.js');
      printError(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  program.parse(args);
}
