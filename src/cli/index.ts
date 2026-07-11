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
import { registerChangelogCommand } from './commands/changelog.js';
import { registerMCPCommand } from './commands/mcp.js';
import { registerSSECommand, registerBeamCommand } from './commands/beam.js';
import { registerServeCommand } from './commands/serve.js';
import { registerHostCommand } from './commands/host.js';
import { registerCfCommands } from './commands/cf.js';
import { registerSearchCommand } from './commands/search.js';
import { registerMakerCommands, registerNewCommand } from './commands/maker.js';
import { registerMarketplaceCommands } from './commands/marketplace.js';
import { registerInfoCommand } from './commands/info.js';
import { registerPackageCommands } from './commands/package.js';
import { registerPublishCommand } from './commands/publish.js';
import { registerPackageAppCommand } from './commands/package-app.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerRunCommand } from './commands/run.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDaemonCommands } from './commands/daemon.js';
import { registerPsCommands } from './commands/ps.js';
import { registerInitCommands, registerUninitCommands } from './commands/init.js';
import { registerTestCommand } from './commands/test.js';
import { registerAliasCommands } from './commands/alias.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerBuildCommand } from './commands/build.js';
import { registerClaimCommands } from './commands/claim.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerDevCommand } from './commands/dev.js';
import { registerOpenAPICommand } from './commands/openapi.js';
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
  mcp install <name>      Register a photon in an MCP client (e.g. Claude Desktop)
  cli <photon> [method]   Run photon methods from command line
                          Example: photon cli kanban stats
  sse <name>              Run Photon as HTTP server with SSE transport
  beam                    Launch Photon Beam (interactive control panel)
  serve                   Start local multi-tenant MCP hosting for development

Configuration:
  use <photon> [instance]  Switch to a named instance of a stateful photon
  instances <photon>       List all instances of a stateful photon
  set <photon> [values]    Configure environment for a photon
  config <command>          Manage daemon-safe photon config/secrets

Hosting:
  host <command>          Manage cloud hosting (preview, deploy)
  cf <command>            Manage Cloudflare binding overrides
    cf bindings <name>      Show declared + override bindings for a photon
    cf set <name> <path> <value>    Override a single binding
    cf reset <name>         Remove the override file

Daemon & Scheduling:
  ps                      List scheduled jobs, webhook routes, active sessions
    ps enable <photon>:<method>     Activate a declared @scheduled method
    ps disable <photon>:<method>    Drop a schedule from the active list
    ps pause <photon>:<method>      Pause without removing
    ps resume <photon>:<method>     Re-enable a paused schedule
    ps history <photon>:<method>    Show recent firings of a scheduled method
  daemon <command>        Manage the Photon background daemon
    daemon start            Start the daemon (no-op if already running)
    daemon stop             Stop the running daemon
    daemon restart          Restart the daemon
    daemon status           Show daemon status and health info
    daemon prune-bases      Remove stale entries from bases registry

Package Management:
  add <name>              Install a photon from marketplace
  remove <name>           Remove an installed photon
  upgrade, up [name]      Upgrade installed photons (not the CLI itself)
  search <query>          Search marketplaces for photons
  info, list [name]       Show installed photons and details
  publish                 Publish your photons as a marketplace (wizard)

Development:
  new <name>              Create a new photon from template (shortcut)
  maker new <name>        Create a new photon from template
  maker validate <name>   Validate photon syntax and schemas
  maker sync              Generate marketplace manifest
  maker init              Initialize marketplace with git hooks
  build <file>            Compile a photon into a standalone executable binary
  test [photon] [test]    Run test methods in photons
    --mode <mode>         Test mode: direct, cli, mcp, all (default: direct)
  openapi <name>          Generate OpenAPI JSON for a photon
  init <command>          Setup and shell integration
    init cli                Set up shell integration for direct photon commands
    init daemon             Set up daemon auto-start on login (launchd/systemd)
    init all                Run all setup steps
    init completions        Manage shell completion cache
  uninit <command>        Remove integrations
    uninit cli              Remove shell integration
    uninit daemon           Remove daemon auto-start
  package <name>          Generate cross-platform PWA launchers for a photon

Publishing:
  claim                   Scope a remote MCP session to photons via claim code
    claim list              List active claim codes
    claim revoke <code>     Remove a claim code
  auth <command>          Manage deployed MCP OAuth/JWT auth
    auth init <name>        Create a local ES256 issuer
    auth token <name>       Sign a short-lived scoped JWT
    auth verify <name>      Verify a local-issuer JWT

Maintenance:
  update                  Update the Photon CLI itself (not installed photons)
  changelog [version]     Show what's new in the current or latest version
  doctor [name]           Diagnose environment and installations
  audit                   View persistent tool execution audit log

Advanced:
  marketplace             Manage marketplace sources
  alias <photon>          Create CLI shortcuts for photons

Run 'photon <command> --help' for detailed usage.
`
    );

  // Register all command modules
  registerUpdateCommand(program);
  registerChangelogCommand(program);
  registerMCPCommand(program);
  registerSSECommand(program);
  registerBeamCommand(program);
  registerServeCommand(program);
  registerHostCommand(program);
  registerCfCommands(program);
  registerSearchCommand(program);
  registerMakerCommands(program);
  registerNewCommand(program);
  registerMarketplaceCommands(program);
  registerInfoCommand(program);
  registerPackageCommands(program);
  registerPublishCommand(program);
  registerPackageAppCommand(program);
  registerDoctorCommand(program);
  registerRunCommand(program);
  registerConfigCommands(program);
  registerDaemonCommands(program);
  registerPsCommands(program);
  registerInitCommands(program);
  registerUninitCommands(program);
  registerTestCommand(program);
  registerAliasCommands(program);
  registerAuditCommand(program);
  registerBuildCommand(program);
  registerClaimCommands(program);
  registerAuthCommands(program);
  registerDevCommand(program);
  registerOpenAPICommand(program);

  return program;
}

/**
 * Main CLI execution — preprocess args and parse.
 */
export async function main(): Promise<void> {
  // Run migrations on first startup (fast no-op if already done)
  try {
    const { runNamespaceMigration } = await import('../namespace-migration.js');
    await runNamespaceMigration();
    const { runDataMigration } = await import('../data-migration.js');
    await runDataMigration();
  } catch {
    // Non-critical — don't block startup
  }

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

  // Check for updates (non-blocking, cache-based)
  try {
    const { refreshUpdateCache, showUpdateNotice } = await import('../version-notify.js');
    refreshUpdateCache();
    showUpdateNotice();
  } catch {
    // Non-critical
  }
}
